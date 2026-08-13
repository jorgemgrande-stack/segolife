/**
 * _investigate-paymentless-reconciliation.ts — SOLO LECTURA. Snapshot de
 * loyalty + integridad de tickets con/sin order, para comparar antes/
 * después de los 2 syncs reales de reconciliación de Paymentless Tickets &
 * Admissions Hardening. Nunca escribe nada.
 *
 * Uso (Railway Console, servicio segolife):
 *   npx tsx scripts/_investigate-paymentless-reconciliation.ts <label>
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
  const [[ticketsTotal]] = await db.execute(sql`SELECT COUNT(*) as cnt FROM event_tickets WHERE provider = ${PROVIDER}`) as any;
  const [[ticketsWithOrder]] = await db.execute(sql`SELECT COUNT(*) as cnt FROM event_tickets WHERE provider = ${PROVIDER} AND order_id IS NOT NULL`) as any;
  const [[ticketsWithoutOrder]] = await db.execute(sql`SELECT COUNT(*) as cnt FROM event_tickets WHERE provider = ${PROVIDER} AND order_id IS NULL`) as any;
  const [[paymentlessWithIdentity]] = await db.execute(sql`SELECT COUNT(*) as cnt FROM event_tickets WHERE provider = ${PROVIDER} AND order_id IS NULL AND user_id IS NOT NULL`) as any;
  const [paymentlessByStatus] = await db.execute(sql`
    SELECT status, COUNT(*) as cnt FROM event_tickets WHERE provider = ${PROVIDER} AND order_id IS NULL GROUP BY status
  `) as any;

  const [dupTickets] = await db.execute(sql`
    SELECT provider, external_ticket_id, COUNT(*) as cnt FROM event_tickets
    WHERE provider = ${PROVIDER} AND external_ticket_id IS NOT NULL
    GROUP BY provider, external_ticket_id HAVING COUNT(*) > 1
  `) as any;

  const [[orphanTicketsOrder]] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM event_tickets t
    LEFT JOIN ticket_orders o ON o.id = t.order_id
    WHERE t.provider = ${PROVIDER} AND t.order_id IS NOT NULL AND o.id IS NULL
  `) as any;

  const [[attendanceLinked]] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM event_attendance WHERE provider = ${PROVIDER} AND ticket_id IS NOT NULL
  `) as any;
  const [[attendanceTotal]] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM event_attendance WHERE provider = ${PROVIDER}
  `) as any;
  const [[orphanAttendanceTicket]] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM event_attendance a
    LEFT JOIN event_tickets t ON t.id = a.ticket_id
    WHERE a.provider = ${PROVIDER} AND a.ticket_id IS NOT NULL AND t.id IS NULL
  `) as any;

  const [[unresolvedAgg]] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM unresolved_operations WHERE provider = ${PROVIDER} AND status = 'unresolved'
  `) as any;
  const [[unresolvedTicketRefs]] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM unresolved_operations WHERE provider = ${PROVIDER} AND reference_type = 'event_ticket' AND status = 'unresolved'
  `) as any;

  console.log(`\n=== SNAPSHOT PAYMENTLESS: ${label} ===`);
  console.log(JSON.stringify({
    loyalty: {
      tokenLedger: { count: Number(ledgerAgg.cnt), maxId: Number(ledgerAgg.maxId) },
      userBenefits: { count: Number(benefitsAgg.cnt), maxId: Number(benefitsAgg.maxId) },
      wallets: (wallets as any[]).map(w => ({ userId: w.user_id, balance: w.balance, lifetimeEarned: w.lifetime_earned, lifetimeSpent: w.lifetime_spent })),
    },
    tickets: {
      total: Number(ticketsTotal.cnt),
      withOrder: Number(ticketsWithOrder.cnt),
      withoutOrder: Number(ticketsWithoutOrder.cnt),
      paymentlessWithIdentityResolved: Number(paymentlessWithIdentity.cnt),
      paymentlessByStatus,
    },
    duplicates: { duplicateExternalTicketIds: dupTickets },
    orphans: { orphanTicketsWithMissingOrder: Number(orphanTicketsOrder.cnt), orphanAttendanceWithMissingTicket: Number(orphanAttendanceTicket.cnt) },
    attendance: { total: Number(attendanceTotal.cnt), linkedToTicket: Number(attendanceLinked.cnt) },
    unresolvedOperations: { unresolvedTotal: Number(unresolvedAgg.cnt), unresolvedEventTicketRefs: Number(unresolvedTicketRefs.cnt) },
  }, null, 2));

  process.exit(0);
}

main().catch(err => { console.error("Snapshot falló:", err instanceof Error ? err.message : err); process.exit(1); });
