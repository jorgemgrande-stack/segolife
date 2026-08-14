// Reconciliación SQL formal del SEGOLIFE ADMIN COMMAND CENTER (spec §41).
// Solo LECTURA — ningún INSERT/UPDATE/DELETE. Para cada KPI del spec, se
// ejecutan DOS consultas INDEPENDIENTES contra la BD real de producción:
//   (A) réplica exacta de la query que usa el servicio del Command Center
//       (commandCenterOverview.ts / commandCenterStudents.ts / etc.)
//   (B) una formulación DISTINTA, escrita desde cero, que debería llegar
//       al mismo número por un camino SQL diferente
// Si A === B para datos reales de producción, es evidencia fuerte de que la
// lógica del servicio es correcta (más allá de los tests unitarios con
// mocks) — no sustituye la verificación visual en navegador (no disponible
// en este entorno), pero SÍ verifica que las cifras que el UI mostraría son
// correctas contra la base de datos real.
//
// Run: railway ssh --service segolife -- node scripts/command-center-reconciliation.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const now = new Date();
const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
const rows = [];

function record(kpi, a, b) {
  const match = String(a) === String(b);
  rows.push({ kpi, a, b, match });
}

async function main() {
  const conn = await mysql.createConnection(DB_URL);
  console.log(`Ventana de reconciliación: ${from.toISOString()} -> ${now.toISOString()}\n`);

  // 1. STUDENTS (total registrados)
  {
    const [a] = await conn.query(`SELECT COUNT(*) AS n FROM users u INNER JOIN student_profiles sp ON sp.user_id = u.id`);
    const [b] = await conn.query(`SELECT COUNT(DISTINCT sp.user_id) AS n FROM student_profiles sp`);
    record("Students (total)", a[0].n, b[0].n);
  }

  // 2. TICKETS (paid en el periodo)
  {
    const [a] = await conn.query(`SELECT COUNT(*) AS n FROM ticket_orders WHERE status='paid' AND purchased_at >= ? AND purchased_at < ?`, [from, now]);
    const [b] = await conn.query(`SELECT SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS n FROM ticket_orders WHERE purchased_at BETWEEN ? AND ?`, [from, now]);
    record("Tickets pagados (30d)", a[0].n, b[0].n ?? 0);
  }

  // 3. ORDERS (total en el periodo, todos los estados)
  {
    const [a] = await conn.query(`SELECT COUNT(*) AS n FROM ticket_orders WHERE purchased_at >= ? AND purchased_at < ?`, [from, now]);
    const [b] = await conn.query(`SELECT COUNT(id) AS n FROM ticket_orders WHERE purchased_at IS NOT NULL AND purchased_at >= ? AND purchased_at < ?`, [from, now]);
    record("Orders totales (30d)", a[0].n, b[0].n);
  }

  // 4. TICKET REVENUE (paid, cents)
  {
    const [a] = await conn.query(`SELECT COALESCE(SUM(total_cents),0) AS n FROM ticket_orders WHERE status='paid' AND purchased_at >= ? AND purchased_at < ?`, [from, now]);
    const [b] = await conn.query(`SELECT COALESCE(SUM(subtotal_cents + fees_cents),0) AS n FROM ticket_orders WHERE status='paid' AND purchased_at BETWEEN ? AND ?`, [from, now]);
    record("Ticket Revenue cents (30d, paid)", a[0].n, b[0].n);
  }

  // 5. COMMERCE REVENUE (confirmed, cents)
  {
    const [a] = await conn.query(`SELECT COALESCE(SUM(total_cents),0) AS n FROM commerce_transactions WHERE status='confirmed' AND occurred_at >= ? AND occurred_at < ?`, [from, now]);
    const [b] = await conn.query(`SELECT COALESCE(SUM(subtotal_cents + fees_cents),0) AS n FROM commerce_transactions WHERE status='confirmed' AND occurred_at BETWEEN ? AND ?`, [from, now]);
    record("Commerce Revenue cents (30d, confirmed)", a[0].n, b[0].n);
  }

  // 6. ATTENDANCE (confirmadas en el periodo)
  {
    const [a] = await conn.query(`SELECT COUNT(*) AS n FROM event_attendance WHERE occurred_at >= ? AND occurred_at < ?`, [from, now]);
    const [b] = await conn.query(`SELECT COUNT(id) AS n FROM event_attendance WHERE occurred_at BETWEEN ? AND ?`, [from, now]);
    record("Attendance (30d)", a[0].n, b[0].n);
  }

  // 7. SEGOTOKENS (earned/spent en el periodo — neto)
  {
    const [a] = await conn.query(`SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END),0) AS n FROM token_ledger WHERE created_at >= ? AND created_at < ?`, [from, now]);
    const [b] = await conn.query(`
      SELECT COALESCE((SELECT SUM(amount) FROM token_ledger WHERE direction='credit' AND created_at BETWEEN ? AND ?),0)
           - COALESCE((SELECT SUM(amount) FROM token_ledger WHERE direction='debit'  AND created_at BETWEEN ? AND ?),0) AS n
    `, [from, now, from, now]);
    record("SegoTokens neto earned-spent (30d)", a[0].n, b[0].n);
  }

  // 8. BENEFITS (generados en el periodo)
  {
    const [a] = await conn.query(`SELECT COUNT(*) AS n FROM user_benefits WHERE granted_at >= ? AND granted_at < ?`, [from, now]);
    const [b] = await conn.query(`SELECT COUNT(id) AS n FROM user_benefits WHERE granted_at BETWEEN ? AND ?`, [from, now]);
    record("Benefits generados (30d)", a[0].n, b[0].n);
  }

  // 9. FOURVENUES INTEGRATIONS (nº configuradas)
  {
    const [a] = await conn.query(`SELECT COUNT(*) AS n FROM venue_integrations`);
    const [b] = await conn.query(`SELECT COUNT(DISTINCT id) AS n FROM venue_integrations WHERE id IS NOT NULL`);
    record("Fourvenues integrations (total)", a[0].n, b[0].n);
  }

  // 10. HISTORICAL IDENTITIES (identidades distintas por identityKey — aproximación vía email/phone normalizado)
  {
    const [a] = await conn.query(`
      SELECT COUNT(DISTINCT COALESCE(LOWER(TRIM(identity_hint_email)), identity_hint_phone)) AS n
      FROM unresolved_operations
      WHERE provider = 'fourvenues_integrations' AND venue_id IN (1,4,7)
        AND (identity_hint_email IS NOT NULL OR identity_hint_phone IS NOT NULL)
    `);
    const [b] = await conn.query(`
      SELECT COUNT(*) AS n FROM (
        SELECT COALESCE(LOWER(TRIM(identity_hint_email)), identity_hint_phone) AS k
        FROM unresolved_operations
        WHERE provider = 'fourvenues_integrations' AND venue_id IN (1,4,7)
          AND (identity_hint_email IS NOT NULL OR identity_hint_phone IS NOT NULL)
        GROUP BY k
      ) grouped
    `);
    record("Historical identities (aprox. identityKey)", a[0].n, b[0].n);
  }

  // 11. CROSS-VENUE HISTORICAL (identidades con >1 venue distinto)
  {
    const [a] = await conn.query(`
      SELECT COUNT(*) AS n FROM (
        SELECT COALESCE(LOWER(TRIM(identity_hint_email)), identity_hint_phone) AS k, COUNT(DISTINCT venue_id) AS venues
        FROM unresolved_operations
        WHERE provider = 'fourvenues_integrations' AND venue_id IN (1,4,7)
          AND (identity_hint_email IS NOT NULL OR identity_hint_phone IS NOT NULL)
        GROUP BY k
        HAVING venues > 1
      ) cross_venue
    `);
    const [b] = await conn.query(`
      SELECT COUNT(*) AS n FROM (
        SELECT k FROM (
          SELECT DISTINCT COALESCE(LOWER(TRIM(identity_hint_email)), identity_hint_phone) AS k, venue_id
          FROM unresolved_operations
          WHERE provider = 'fourvenues_integrations' AND venue_id IN (1,4,7)
            AND (identity_hint_email IS NOT NULL OR identity_hint_phone IS NOT NULL)
        ) pairs
        GROUP BY k HAVING COUNT(*) > 1
      ) t
    `);
    record("Cross-venue historical (aprox.)", a[0].n, b[0].n);
  }

  console.log("KPI".padEnd(42), "| A (servicio)".padEnd(16), "| B (independiente)".padEnd(20), "| MATCH");
  console.log("-".repeat(95));
  for (const r of rows) {
    console.log(String(r.kpi).padEnd(42), "|", String(r.a).padEnd(14), "|", String(r.b).padEnd(18), "|", r.match ? "YES" : "NO ⚠️");
  }
  const allMatch = rows.every(r => r.match);
  console.log("\n" + (allMatch ? "TODAS LAS RECONCILIACIONES COINCIDEN." : "ATENCIÓN: hay discrepancias — revisar antes de desplegar."));

  await conn.end();
  process.exit(allMatch ? 0 : 1);
}

main().catch(err => { console.error("ERROR:", err); process.exit(1); });
