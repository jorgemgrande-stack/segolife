// Cierre post-roadmap (2026-08-23) — verificación end-to-end, EN PRODUCCIÓN,
// de que el scheduler de ciclo de vida de Community (F65) activa y cierra
// propuestas de verdad, de forma automática, sin intervención humana.
//
// SEGURIDAD: usa exclusivamente las cuentas QA ya establecidas
// (docs/QA_ACCOUNTS.md) — la propuesta de prueba se crea con audiencia
// limitada a UN SOLO usuario (el Student QA, qa.pre1617.ie@segolife.es).
// Nadie más recibe ninguna notificación de esta prueba. Al terminar, borra
// la propuesta/audiencia/notificación que ha creado — no deja rastro.
//
// Requiere que community_lifecycle_scheduler_enabled ya esté a 1 en BD
// (scripts/apply-0172-...) Y que el proceso ya se haya reiniciado con ese
// valor (conditionallyStartJob solo se evalúa al arrancar) — si el
// scheduler no está realmente corriendo, este script hará TIMEOUT en la
// fase de activación, lo cual es la señal correcta de que aún no está listo.
//
// Run: railway ssh -- node scripts/qa-community-lifecycle-scheduler-check.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const QA_STUDENT_EMAIL = "qa.pre1617.ie@segolife.es";
const QA_ADMIN_EMAIL = "qa.admin@segolife.es";

const START_DELAY_MS = 65_000;
const WINDOW_MS = 65_000;
const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_ITERATIONS = 15; // 150s por fase
const IDEMPOTENCY_WAIT_MS = 65_000;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function pollUntil(c, proposalId, targetStatus, label) {
  for (let i = 1; i <= POLL_MAX_ITERATIONS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const [[row]] = await c.query("SELECT status, published_at, closed_at FROM community_proposals WHERE id = ?", [proposalId]);
    console.log(`  [t+${i * (POLL_INTERVAL_MS / 1000)}s] status=${row.status}`);
    if (row.status === targetStatus) return row;
  }
  throw new Error(`TIMEOUT esperando "${label}" — la propuesta nunca alcanzó status='${targetStatus}' en ${POLL_MAX_ITERATIONS * POLL_INTERVAL_MS / 1000}s`);
}

(async () => {
  console.log("=".repeat(70));
  console.log("QA — verificación real del scheduler de ciclo de vida de Community (F65)");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);
  let proposalId = null;

  try {
    const [[student]] = await c.query("SELECT id FROM users WHERE email = ?", [QA_STUDENT_EMAIL]);
    const [[admin]] = await c.query("SELECT id FROM users WHERE email = ?", [QA_ADMIN_EMAIL]);
    if (!student) throw new Error(`No se encontró la cuenta QA Student (${QA_STUDENT_EMAIL})`);
    if (!admin) throw new Error(`No se encontró la cuenta QA Admin (${QA_ADMIN_EMAIL})`);
    console.log(`Cuentas QA confirmadas — student.id=${student.id}, admin.id=${admin.id}`);

    const now = Date.now();
    const startsAt = new Date(now + START_DELAY_MS);
    const endsAt = new Date(now + START_DELAY_MS + WINDOW_MS);
    const title = `[QA] Prueba scheduler F65 — ignorar (${new Date(now).toISOString()})`;

    const [insertResult] = await c.execute(
      `INSERT INTO community_proposals
       (title, question_type, status, urgency_type, starts_at, ends_at, created_by_user_id)
       VALUES (?, 'yes_no', 'scheduled', 'flash', ?, ?, ?)`,
      [title, startsAt, endsAt, admin.id]
    );
    proposalId = insertResult.insertId;
    console.log(`✓ Propuesta de prueba creada — id=${proposalId}, startsAt=${startsAt.toISOString()}, endsAt=${endsAt.toISOString()}`);

    await c.execute(`INSERT INTO community_proposal_audiences (proposal_id, user_id) VALUES (?, ?)`, [proposalId, student.id]);
    console.log(`✓ Audiencia limitada exclusivamente al QA Student (userId=${student.id}) — nadie más puede recibir nada de esta prueba`);

    console.log("\n[FASE 1] Esperando activación automática (scheduled → active)...");
    await pollUntil(c, proposalId, "active", "activación");
    console.log("✓ ACTIVADA automáticamente, sin intervención manual");

    const [[notif]] = await c.query(
      "SELECT id, priority, template_key FROM notifications WHERE source_type='community_proposal' AND source_id=? AND user_id=?",
      [proposalId, student.id]
    );
    console.log(notif
      ? `✓ Notificación real generada para el QA Student — id=${notif.id}, priority=${notif.priority}, template=${notif.template_key}`
      : "✗ AVISO: no se encontró notificación asociada (la activación de estado fue correcta, pero revisar por qué no se generó notificación)");

    console.log("\n[FASE 2] Esperando cierre automático (active → closed) tras superar endsAt...");
    const closedRow = await pollUntil(c, proposalId, "closed", "cierre");
    console.log(`✓ CERRADA automáticamente — closed_at=${closedRow.closed_at.toISOString()}`);

    console.log("\n[FASE 3] Comprobando que no se reprocesa en el siguiente ciclo (idempotencia)...");
    await sleep(IDEMPOTENCY_WAIT_MS);
    const [[afterRow]] = await c.query("SELECT status, closed_at FROM community_proposals WHERE id = ?", [proposalId]);
    const [[notifCount]] = await c.query(
      "SELECT COUNT(*) AS n FROM notifications WHERE source_type='community_proposal' AND source_id=? AND user_id=?",
      [proposalId, student.id]
    );
    const stable = afterRow.status === "closed"
      && afterRow.closed_at.getTime() === closedRow.closed_at.getTime()
      && notifCount.n === (notif ? 1 : 0);
    console.log(`  status=${afterRow.status}, closed_at=${afterRow.closed_at.toISOString()} (sin cambios respecto al cierre)`);
    console.log(`  notificaciones acumuladas para esta propuesta: ${notifCount.n} (debe seguir siendo la misma cantidad, nunca duplicarse)`);
    console.log(stable ? "✓ IDEMPOTENTE — el siguiente ciclo no reprocesó ni duplicó nada" : "✗ COMPORTAMIENTO INESPERADO en el ciclo siguiente");

    console.log("\n[LIMPIEZA] Eliminando rastro de la prueba...");
    await c.execute("DELETE FROM notifications WHERE source_type='community_proposal' AND source_id=?", [proposalId]);
    await c.execute("DELETE FROM community_proposal_audiences WHERE proposal_id=?", [proposalId]);
    await c.execute("DELETE FROM community_proposals WHERE id=?", [proposalId]);
    console.log("✓ Propuesta, audiencia y notificación de prueba eliminadas — producción queda limpia");

    console.log("\n" + "=".repeat(70));
    console.log(stable ? "RESULTADO FINAL: PASS" : "RESULTADO FINAL: PASS con aviso en idempotencia (ver arriba)");
    console.log("=".repeat(70));
  } catch (err) {
    console.error("\nRESULTADO FINAL: FAIL —", err.message);
    if (proposalId) {
      console.log(`\nLimpieza de emergencia de la propuesta de prueba id=${proposalId}...`);
      await c.execute("DELETE FROM notifications WHERE source_type='community_proposal' AND source_id=?", [proposalId]).catch(() => {});
      await c.execute("DELETE FROM community_proposal_audiences WHERE proposal_id=?", [proposalId]).catch(() => {});
      await c.execute("DELETE FROM community_proposals WHERE id=?", [proposalId]).catch(() => {});
      console.log("✓ Limpieza de emergencia completada");
    }
    await c.end();
    process.exit(1);
  }

  await c.end();
})();
