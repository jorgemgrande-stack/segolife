/**
 * _investigate-reconciliation.ts — SOLO LECTURA. Snapshot de loyalty +
 * integridad de datos Fourvenues, para comparar "antes"/"después" de cada
 * sync real de reconciliación (Pagination Hardening, spec §49-55). Nunca
 * escribe nada. Se ejecuta 3 veces (before / after1 / after2) y se compara
 * manualmente la salida — no persiste el resultado en BD.
 *
 * Uso (Railway Console, servicio segolife):
 *   npx tsx scripts/_investigate-reconciliation.ts <label>
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const label = process.argv[2] ?? "snapshot";
  const db = await getDb();
  if (!db) { console.error("No DB connection"); process.exit(1); }

  const [[ledgerAgg]] = await db.execute(sql`SELECT COUNT(*) as cnt, COALESCE(MAX(id),0) as maxId FROM token_ledger`) as any;
  const [[benefitsAgg]] = await db.execute(sql`SELECT COUNT(*) as cnt, COALESCE(MAX(id),0) as maxId FROM user_benefits`) as any;
  const [wallets] = await db.execute(sql`SELECT user_id, balance, lifetime_earned, lifetime_spent FROM token_wallets ORDER BY user_id`) as any;

  const PROVIDER = "fourvenues_integrations";
  const [[ordersAgg]] = await db.execute(sql`SELECT COUNT(*) as cnt FROM ticket_orders WHERE provider = ${PROVIDER}`) as any;
  const [[ticketsAgg]] = await db.execute(sql`SELECT COUNT(*) as cnt FROM event_tickets WHERE provider = ${PROVIDER}`) as any;
  const [[attendanceAgg]] = await db.execute(sql`SELECT COUNT(*) as cnt FROM event_attendance WHERE provider = ${PROVIDER}`) as any;

  const [dupTickets] = await db.execute(sql`
    SELECT provider, external_ticket_id, COUNT(*) as cnt FROM event_tickets
    WHERE provider = ${PROVIDER} AND external_ticket_id IS NOT NULL
    GROUP BY provider, external_ticket_id HAVING COUNT(*) > 1
  `) as any;
  const [dupOrders] = await db.execute(sql`
    SELECT provider, external_order_id, COUNT(*) as cnt FROM ticket_orders
    WHERE provider = ${PROVIDER} AND external_order_id IS NOT NULL
    GROUP BY provider, external_order_id HAVING COUNT(*) > 1
  `) as any;
  const [dupAttendance] = await db.execute(sql`
    SELECT provider, external_attendance_id, COUNT(*) as cnt FROM event_attendance
    WHERE provider = ${PROVIDER} AND external_attendance_id IS NOT NULL
    GROUP BY provider, external_attendance_id HAVING COUNT(*) > 1
  `) as any;

  const [[orphanItems]] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM ticket_order_items toi
    LEFT JOIN ticket_orders o ON o.id = toi.order_id
    WHERE o.id IS NULL
  `) as any;
  const [[orphanTicketsOrder]] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM event_tickets t
    LEFT JOIN ticket_orders o ON o.id = t.order_id
    WHERE t.provider = ${PROVIDER} AND t.order_id IS NOT NULL AND o.id IS NULL
  `) as any;
  const [[orphanAttendanceTicket]] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM event_attendance a
    LEFT JOIN event_tickets t ON t.id = a.ticket_id
    WHERE a.provider = ${PROVIDER} AND a.ticket_id IS NOT NULL AND t.id IS NULL
  `) as any;

  const [[identityAgg]] = await db.execute(sql`SELECT COUNT(*) as cnt FROM external_identity_mappings WHERE provider = ${PROVIDER}`) as any;
  const [unresolvedByStatus] = await db.execute(sql`
    SELECT status, COUNT(*) as cnt FROM unresolved_operations WHERE provider = ${PROVIDER} GROUP BY status
  `) as any;

  console.log(`\n=== SNAPSHOT: ${label} ===`);
  console.log(JSON.stringify({
    loyalty: {
      tokenLedger: { count: Number(ledgerAgg.cnt), maxId: Number(ledgerAgg.maxId) },
      userBenefits: { count: Number(benefitsAgg.cnt), maxId: Number(benefitsAgg.maxId) },
      wallets: (wallets as any[]).map(w => ({ userId: w.user_id, balance: w.balance, lifetimeEarned: w.lifetime_earned, lifetimeSpent: w.lifetime_spent })),
    },
    fourvenuesCounts: {
      ticketOrders: Number(ordersAgg.cnt),
      eventTickets: Number(ticketsAgg.cnt),
      eventAttendance: Number(attendanceAgg.cnt),
    },
    duplicates: {
      duplicateExternalTicketIds: dupTickets,
      duplicateExternalOrderIds: dupOrders,
      duplicateExternalAttendanceIds: dupAttendance,
    },
    orphans: {
      orphanOrderItems: Number(orphanItems.cnt),
      orphanTicketsWithMissingOrder: Number(orphanTicketsOrder.cnt),
      orphanAttendanceWithMissingTicket: Number(orphanAttendanceTicket.cnt),
    },
    identity: {
      externalIdentityMappings: Number(identityAgg.cnt),
      unresolvedOperationsByStatus: unresolvedByStatus,
    },
  }, null, 2));

  process.exit(0);
}

main().catch(err => { console.error("Snapshot falló:", err instanceof Error ? err.message : err); process.exit(1); });
