/**
 * tokenClawbackReconciliationService.ts — FIX-01 (REFUND → SEGOTOKENS
 * MANDATORY CLAWBACK, spec §13/§14).
 *
 * Red de seguridad para el caso "el dinero ya se confirmó reembolsado, pero
 * el clawback de SegoTokens falló por un error transitorio" — antes de este
 * fix ese fallo solo se logueaba (`console.error`) y la deuda se perdía en
 * silencio para siempre (ver ticketCancellationService.ts,
 * doorSaleService.ts, ticketPurchasePipeline.ts). Ahora, cada intento
 * fallido deja `metadata.loyaltyReconciliationRequired = true` en el
 * ticket_order — esta función es el ÚNICO reconciliador, reutilizado tanto
 * por el job programado (tokenClawbackReconciliationJob.ts) como por el
 * procedimiento admin de reintento manual (routers/tokens.ts).
 *
 * Nunca reimplementa la reversión: reutiliza `findActiveGrantBySource` +
 * `reverseTransaction` (idempotentes, ver tokenLedgerService.ts) y
 * `reverseTokenSpend` (idempotente, ver tokenSpendService.ts) — el MISMO
 * mecanismo canónico que ya usa el intento eager en el momento del refund.
 * Seguro de ejecutar repetidamente: un order ya reconciliado simplemente no
 * vuelve a aparecer en la consulta (su marca se limpia al resolverse).
 */
import { eq, inArray, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { ticketOrders, type TicketOrder } from "../../../drizzle/schema";
import { findActiveGrantBySource, reverseTransaction } from "./tokenLedgerService";
import { reverseTokenSpend } from "./tokenSpendService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

// Tope defensivo por ejecución — este es un caso de borde raro (fallo
// transitorio tras un refund confirmado), nunca se espera un volumen real
// alto; el tope evita una consulta sin límite si algún día lo hubiera.
const MAX_CANDIDATES_PER_RUN = 200;

export interface ReconciliationResult {
  processed: number;
  resolved: number;
  stillPending: number;
  candidateOrderIds: number[];
}

function hasPendingClawback(order: TicketOrder): boolean {
  return (order.metadata as Record<string, unknown> | null)?.loyaltyReconciliationRequired === true;
}

async function clearPendingMarker(orderId: number, conn: DbHandle): Promise<void> {
  const [order] = await conn.select({ metadata: ticketOrders.metadata }).from(ticketOrders).where(eq(ticketOrders.id, orderId)).limit(1);
  await conn.update(ticketOrders).set({
    metadata: {
      ...(order?.metadata ?? {}),
      loyaltyReconciliationRequired: false,
      loyaltyReversalReconciledAt: new Date().toISOString(),
    },
  }).where(eq(ticketOrders.id, orderId));
}

async function markStillPending(orderId: number, detail: string, conn: DbHandle): Promise<void> {
  const [order] = await conn.select({ metadata: ticketOrders.metadata }).from(ticketOrders).where(eq(ticketOrders.id, orderId)).limit(1);
  await conn.update(ticketOrders).set({
    metadata: {
      ...(order?.metadata ?? {}),
      loyaltyReconciliationRequired: true,
      loyaltyReversalError: detail,
      loyaltyReversalErrorAt: new Date().toISOString(),
    },
  }).where(eq(ticketOrders.id, orderId));
}

/**
 * Reintenta el clawback pendiente de un único order — reutilizado tanto por
 * el barrido (`retryPendingTokenClawbacks`) como, en el futuro, por
 * cualquier resolución manual puntual. Nunca lanza: cada fallo queda
 * marcado para el siguiente intento en vez de interrumpir el barrido.
 */
async function retryOneOrder(order: TicketOrder, conn: DbHandle): Promise<boolean> {
  try {
    if (order.userId != null) {
      const grant = await findActiveGrantBySource(order.userId, "ticket", order.id, conn);
      if (grant) {
        await reverseTransaction({
          ledgerId: grant.ledgerId,
          reason: `Reconciliación automática — clawback de SegoTokens pendiente tras reembolso confirmado (order #${order.id})`,
          adminUserId: null,
        }, conn);
      }
    }
    if (order.tokenReservationId != null) {
      await reverseTokenSpend({
        reservationId: order.tokenReservationId,
        reason: `Reconciliación automática — clawback de SegoTokens pendiente tras reembolso confirmado (order #${order.id})`,
        adminUserId: null,
      }, conn);
    }
    await clearPendingMarker(order.id, conn);
    return true;
  } catch (err) {
    await markStillPending(order.id, err instanceof Error ? err.message : String(err), conn);
    return false;
  }
}

/**
 * Barrido completo — encuentra todo order `refunded`/`partially_refunded`
 * con `metadata.loyaltyReconciliationRequired=true` y reintenta su
 * clawback. Sin índice JSON dedicado (spec §28, "no crees migración por
 * defecto") — el volumen esperado es mínimo (solo fallos transitorios), así
 * que se filtra en JS sobre un conjunto ya acotado por estado + límite.
 */
export async function retryPendingTokenClawbacks(db?: DbHandle): Promise<ReconciliationResult> {
  const conn = db ?? (await getDb());
  const candidates = await conn.select().from(ticketOrders)
    .where(inArray(ticketOrders.status, ["refunded", "partially_refunded"]))
    .orderBy(desc(ticketOrders.updatedAt))
    .limit(MAX_CANDIDATES_PER_RUN);

  const pending = candidates.filter(hasPendingClawback);
  let resolved = 0;
  for (const order of pending) {
    if (await retryOneOrder(order, conn)) resolved++;
  }
  return {
    processed: pending.length,
    resolved,
    stillPending: pending.length - resolved,
    candidateOrderIds: pending.map(o => o.id),
  };
}
