/**
 * _production-qa-cleanup.ts — SEGOLIFE QA/TEST DATA CLEANUP (2026-08-13).
 * Script temporal, ejecución única, controlado por --target=MySQL-zWz9.
 *
 * Limpia 2 fuentes de datos de prueba confirmadas con evidencia objetiva:
 *
 * A) Simulación "student360_course_demo_2025_26" (scripts/seed-student360-course-demo.ts)
 *    — confirmada en ejecución real contra producción. Usa el --rollback
 *    oficial del script como base, PERO ese rollback tiene 2 lagunas reales
 *    detectadas en auditoría (spec §2/§8 de este encargo):
 *      1. consumption_qr_codes se marca vía `source_type`, NO vía
 *         `metadata.simulation` — el rollback oficial las deja huérfanas.
 *      2. commerce_transactions se enlaza vía `loyalty_ledger_id` (FK a
 *         token_ledger), NUNCA lleva `metadata.simulation` — el rollback
 *         oficial no las toca en absoluto (100% de la tabla, 39/39 filas).
 *    Este script borra AMBAS explícitamente antes de token_ledger, además
 *    de las 8 tablas que sí cubre el rollback oficial, MÁS el segundo paso
 *    manual que el propio script deja documentado como pendiente
 *    (event_tickets/event_attendance huérfanos), MÁS student_login_events
 *    (identificados por rango de fecha exacto de la simulación, nunca por
 *    user_id a secas — 15 de 132 logins de los 3 usuarios son reales y NO
 *    se tocan), MÁS las wallets de los 3 usuarios reales afectados
 *    (recalculadas desde el ledger que SOBREVIVE, nunca puestas a 0 a
 *    ciegas — 2 usuarios tienen actividad real fuera de la simulación).
 *
 *    NUNCA se borra: users, student_profiles (el backdate de createdAt NO
 *    se revierte — no hay valor original conocido, ver informe), token_rules,
 *    benefit_definitions (configuración real de plataforma, decisión ya
 *    documentada en el rollback oficial).
 *
 * B) Manifest QA original (scripts/qa-events-manifest.json, 10 eventos,
 *    2026-08-10) — 8 sin matices, 2 con dependencias verificadas
 *    individualmente (evento #6 tenía un sales_channel sin marcar pero
 *    inerte; evento #10 tenía 5 pedidos reales abandonados de 2 usuarios
 *    reales, nunca completados, 0 tickets emitidos).
 *
 * NUNCA toca: Fourvenues real (Casanova/Tía Felisa/Limoncello sincronizados,
 * verificado 0 filas con external_entity_mappings en cualquier entidad
 * borrada), multimedia/media_files (solo relaciones, nunca assets), usuarios
 * reales (solo sus filas huérfanas/de simulación, nunca la cuenta).
 *
 * DRY-RUN REAL: cada operación de borrado calcula su conteo mediante un
 * SELECT COUNT(*) contra la MISMA condición WHERE que usaría el DELETE real
 * — nunca un contador llevado a mano en el propio script (bug real detectado
 * y corregido en la primera ejecución de este script: la versión inicial
 * solo reportaba conteo correcto en las 2 llamadas que recibían un array de
 * ids explícito; el resto mostraba "0" en dry-run pase lo que pase).
 *
 * Uso: npx tsx scripts/_production-qa-cleanup.ts --target=MySQL-zWz9 [--dry-run]
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql as drizzleSql } from "drizzle-orm";

const EXPECTED_TARGET = "MySQL-zWz9";
const SIM_TAG = "student360_course_demo_2025_26";

function parseArgs() {
  const args = process.argv.slice(2);
  const target = args.find(a => a.startsWith("--target="))?.split("=")[1] ?? "";
  const dryRun = args.includes("--dry-run");
  return { target, dryRun };
}

async function main() {
  const { target, dryRun } = parseArgs();
  if (!dryRun && target !== EXPECTED_TARGET) {
    console.error(`--target debe ser "${EXPECTED_TARGET}". Recibido: "${target || "(vacío)"}". Aborta.`);
    process.exit(1);
  }
  console.log(`=== SEGOLIFE QA/TEST DATA CLEANUP — modo: ${dryRun ? "DRY-RUN" : "ESCRITURA REAL"} ===\n`);

  const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
  const db = drizzle(pool);
  const manifest: Array<{ entity: string; id: number; reason: string }> = [];

  /** table: nombre de tabla literal (nunca input externo). where: fragmento SOLO de la condición (sin "WHERE"). */
  async function del(label: string, table: string, where: ReturnType<typeof drizzleSql>, idsForManifest: number[] = []) {
    if (dryRun) {
      const [rows] = await db.execute(drizzleSql`SELECT COUNT(*) as cnt FROM ${drizzleSql.raw(table)} WHERE ${where}`);
      const cnt = Number((rows as unknown as Array<{ cnt: number }>)[0].cnt);
      console.log(`[dry-run] ${label}: ${cnt} fila(s) se borrarían`);
      return cnt;
    }
    const [result] = await db.execute(drizzleSql`DELETE FROM ${drizzleSql.raw(table)} WHERE ${where}`);
    const affected = (result as unknown as { affectedRows: number }).affectedRows ?? 0;
    console.log(`${label}: ${affected} fila(s) borradas`);
    for (const id of idsForManifest) manifest.push({ entity: label, id, reason: SIM_TAG });
    return affected;
  }

  // ── PARTE A: SIMULACIÓN STUDENT360 ──────────────────────────────────────
  console.log("--- A. Simulación student360_course_demo_2025_26 ---\n");

  const [simOrders] = await db.execute(drizzleSql`SELECT id FROM ticket_orders WHERE JSON_EXTRACT(metadata, '$.simulation') = ${SIM_TAG}`);
  const simOrderIds = (simOrders as unknown as Array<{ id: number }>).map(r => r.id);
  console.log(`Pedidos de simulación identificados: ${simOrderIds.length}`);

  const [simLedger] = await db.execute(drizzleSql`SELECT id FROM token_ledger WHERE JSON_EXTRACT(metadata, '$.simulation') = ${SIM_TAG}`);
  const simLedgerIds = (simLedger as unknown as Array<{ id: number }>).map(r => r.id);
  console.log(`Movimientos de ledger de simulación identificados: ${simLedgerIds.length}\n`);

  // A1. consumption_qr_codes (laguna real del rollback oficial — vía source_type)
  await del("consumption_qr_codes (source_type)", "consumption_qr_codes", drizzleSql`source_type = ${SIM_TAG}`);

  // A2. commerce_transactions (laguna real del rollback oficial — vía loyalty_ledger_id)
  if (simLedgerIds.length > 0) {
    await del("commerce_transactions (loyalty_ledger_id)", "commerce_transactions", drizzleSql`loyalty_ledger_id IN (${drizzleSql.join(simLedgerIds, drizzleSql`,`)})`);
  }

  // A3. notifications, user_benefits (cubiertas por metadata.simulation, igual que el rollback oficial)
  await del("notifications (metadata.simulation)", "notifications", drizzleSql`JSON_EXTRACT(metadata, '$.simulation') = ${SIM_TAG}`);
  await del("user_benefits (metadata.simulation)", "user_benefits", drizzleSql`JSON_EXTRACT(metadata, '$.simulation') = ${SIM_TAG}`);

  // A4. token_ledger
  await del("token_ledger (metadata.simulation)", "token_ledger", drizzleSql`JSON_EXTRACT(metadata, '$.simulation') = ${SIM_TAG}`);

  // A5. Recalcular wallets de los 3 usuarios afectados (4=Cristina, 5=Javier, 6=Tono)
  //     — NUNCA a 0 a ciegas: se recalcula desde lo que sobrevive en el ledger real.
  //     En dry-run se simula sobre el ledger ACTUAL menos las filas de simulación
  //     (todavía no borradas), para mostrar el resultado final esperado.
  for (const uid of [4, 5, 6]) {
    const ledgerCondition = dryRun
      ? drizzleSql`user_id = ${uid} AND (JSON_EXTRACT(metadata, '$.simulation') IS NULL OR JSON_EXTRACT(metadata, '$.simulation') != ${SIM_TAG})`
      : drizzleSql`user_id = ${uid}`;
    const [rows] = await db.execute(drizzleSql`
      SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END),0) as earned,
             COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END),0) as spent
      FROM token_ledger WHERE ${ledgerCondition}
    `);
    const { earned, spent } = (rows as unknown as Array<{ earned: number; spent: number }>)[0];
    const balance = Number(earned) - Number(spent);
    console.log(`  ${dryRun ? "[dry-run] " : ""}wallet user_id=${uid} ${dryRun ? "resultaría en" : "recalculada:"} balance=${balance} lifetimeEarned=${earned} lifetimeSpent=${spent}`);
    if (!dryRun) {
      await db.execute(drizzleSql`UPDATE token_wallets SET balance = ${balance}, lifetime_earned = ${earned}, lifetime_spent = ${spent} WHERE user_id = ${uid}`);
    }
  }

  // A6. ticket_payments, ticket_order_items, event_attendance/event_tickets huérfanos, ticket_orders
  await del("ticket_payments (metadata.simulation)", "ticket_payments", drizzleSql`JSON_EXTRACT(metadata, '$.simulation') = ${SIM_TAG}`);

  if (simOrderIds.length > 0) {
    await del("ticket_order_items (huérfanos de pedidos de simulación)", "ticket_order_items", drizzleSql`order_id IN (${drizzleSql.join(simOrderIds, drizzleSql`,`)})`);

    const [simTickets] = await db.execute(drizzleSql`SELECT id FROM event_tickets WHERE order_id IN (${drizzleSql.join(simOrderIds, drizzleSql`,`)})`);
    const simTicketIds = (simTickets as unknown as Array<{ id: number }>).map(r => r.id);
    if (simTicketIds.length > 0) {
      await del("event_attendance (huérfanas de tickets de simulación)", "event_attendance", drizzleSql`ticket_id IN (${drizzleSql.join(simTicketIds, drizzleSql`,`)})`);
      await del("event_tickets (huérfanos de pedidos de simulación)", "event_tickets", drizzleSql`id IN (${drizzleSql.join(simTicketIds, drizzleSql`,`)})`);
    } else {
      console.log("  event_attendance / event_tickets huérfanos: 0 (sin tickets de simulación restantes)");
    }

    await del("ticket_orders (metadata.simulation)", "ticket_orders", drizzleSql`id IN (${drizzleSql.join(simOrderIds, drizzleSql`,`)})`);
  }

  // A7. venue_products
  await del("venue_products (metadata.simulation)", "venue_products", drizzleSql`JSON_EXTRACT(metadata, '$.simulation') = ${SIM_TAG}`);

  // A8. student_login_events — SOLO dentro de la ventana exacta de la simulación (2025-09-01..2026-07-31),
  //     nunca "todo lo de estos 3 usuarios" (15/132 son accesos reales, fuera de esa ventana).
  await del(
    "student_login_events (user 4/5/6, ventana simulación)",
    "student_login_events",
    drizzleSql`user_id IN (4,5,6) AND occurred_at BETWEEN '2025-09-01' AND '2026-07-31 23:59:59'`
  );

  // A9. Los 30 "eventos históricos" fabricados (FASE D) — verificados 100% simulación
  //     (tickets=orders=simulación en cada uno, 0 external_entity_mappings). El rollback
  //     oficial los deja adrede (spec propio del script: "borrar un evento con posibles
  //     ticket_orders reales de otros usuarios sería peligroso") — aquí SÍ se borran
  //     porque la auditoría de esta fase confirmó, evento por evento, actividad 100% simulada.
  const HISTORICAL_EVENT_IDS = [11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40];
  await del("sales_channels (30 eventos históricos)", "sales_channels", drizzleSql`event_id IN (${drizzleSql.join(HISTORICAL_EVENT_IDS, drizzleSql`,`)})`);
  await del("event_ticket_types (30 eventos históricos)", "event_ticket_types", drizzleSql`event_id IN (${drizzleSql.join(HISTORICAL_EVENT_IDS, drizzleSql`,`)})`);
  await del("community_events (30 eventos históricos)", "community_events", drizzleSql`event_id IN (${drizzleSql.join(HISTORICAL_EVENT_IDS, drizzleSql`,`)})`);
  await del("events (30 eventos históricos)", "events", drizzleSql`id IN (${drizzleSql.join(HISTORICAL_EVENT_IDS, drizzleSql`,`)})`, HISTORICAL_EVENT_IDS);

  // ── PARTE B: MANIFEST QA ORIGINAL (10 eventos) ──────────────────────────
  console.log("\n--- B. Manifest QA original (scripts/qa-events-manifest.json) ---\n");

  // B1. Evento #10 (Limoncello) — 5 pedidos reales abandonados (nunca completados, 0 tickets emitidos)
  // BUG real detectado tras la primera ejecución (integridad post-cleanup, huérfano #1): esta
  // sección borraba ticket_order_items/ticket_orders pero nunca comprobaba ticket_payments — el
  // pedido #5 (cancelado) tenía un intento de pago real fallido (provider="unconfigured", el
  // checkout nativo nunca tuvo un PaymentProvider configurado) que quedó huérfano tras borrar su
  // order_id. Mismo evento QA, mismo pedido ya auditado — se añade aquí, nunca con un DELETE manual.
  const EVENT10_ORDER_IDS = [1, 2, 3, 4, 5];
  await del("ticket_payments (evento QA #10)", "ticket_payments", drizzleSql`order_id IN (${drizzleSql.join(EVENT10_ORDER_IDS, drizzleSql`,`)})`);
  await del("ticket_order_items (evento QA #10)", "ticket_order_items", drizzleSql`order_id IN (${drizzleSql.join(EVENT10_ORDER_IDS, drizzleSql`,`)})`);
  await del("ticket_orders (evento QA #10, abandonados)", "ticket_orders", drizzleSql`id IN (${drizzleSql.join(EVENT10_ORDER_IDS, drizzleSql`,`)})`, EVENT10_ORDER_IDS);

  // B2. Los 10 eventos del manifest — sales_channels + event_ticket_types + community_events + events
  const QA_MANIFEST_EVENT_IDS = [1,2,3,4,5,6,7,8,9,10];
  await del("sales_channels (manifest QA, incl. #12 inerte)", "sales_channels", drizzleSql`event_id IN (${drizzleSql.join(QA_MANIFEST_EVENT_IDS, drizzleSql`,`)})`);
  await del("event_ticket_types (manifest QA)", "event_ticket_types", drizzleSql`event_id IN (${drizzleSql.join(QA_MANIFEST_EVENT_IDS, drizzleSql`,`)})`);
  await del("community_events (manifest QA)", "community_events", drizzleSql`event_id IN (${drizzleSql.join(QA_MANIFEST_EVENT_IDS, drizzleSql`,`)})`);
  await del("events (manifest QA, 10 eventos)", "events", drizzleSql`id IN (${drizzleSql.join(QA_MANIFEST_EVENT_IDS, drizzleSql`,`)})`, QA_MANIFEST_EVENT_IDS);

  if (!dryRun) {
    const fs = await import("fs");
    fs.writeFileSync("/tmp/production-qa-cleanup-manifest.json", JSON.stringify(manifest, null, 2));
    console.log(`\nManifest de limpieza escrito en /tmp/production-qa-cleanup-manifest.json (${manifest.length} entidades)`);
  }

  await pool.end();
  console.log(`\n=== ${dryRun ? "DRY-RUN COMPLETADO (nada escrito)" : "CLEANUP COMPLETADO"} ===`);
}

main().catch(err => { console.error("Cleanup falló:", err.message); process.exit(1); });
