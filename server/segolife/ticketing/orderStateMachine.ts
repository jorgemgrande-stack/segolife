/**
 * orderStateMachine.ts — transiciones válidas de `ticket_orders.status`
 * (Fase 8, spec punto 5). Nunca se permite un cambio arbitrario desde
 * frontend/admin — todo cambio de estado pasa por `transitionOrderStatus()`,
 * que aplica un UPDATE condicional (`WHERE status IN (from)`) comprobando
 * `affectedRows`, mismo patrón de concurrencia que benefitRedemptionService.ts.
 *
 * Transiciones documentadas explícitamente (nunca "cualquier estado a
 * cualquier estado"):
 *   (creación)          → pending
 *   pending             → awaiting_payment | expired | cancelled
 *   awaiting_payment    → paid | expired | failed | cancelled
 *   paid                → refunded | partially_refunded | reconciliation_required
 *   cualquier no-final  → reconciliation_required (caso excepcional, ver cancelaciones)
 *
 * `paid` NUNCA transiciona directamente a `cancelled` — una vez pagado, la
 * única salida es un refund (spec punto 18: "nunca DELETE, nunca cancelar
 * un ticket ya pagado sin pasar por reembolso").
 */
import { eq, and, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { ticketOrders, type TicketOrder } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type TicketOrderStatus = TicketOrder["status"];

const VALID_TRANSITIONS: Record<TicketOrderStatus, TicketOrderStatus[]> = {
  pending: ["awaiting_payment", "expired", "cancelled"],
  awaiting_payment: ["paid", "expired", "failed", "cancelled"],
  paid: ["refunded", "partially_refunded", "reconciliation_required"],
  refunded: [],
  partially_refunded: ["refunded", "reconciliation_required"],
  cancelled: [],
  expired: [],
  failed: [],
  reconciliation_required: ["refunded", "cancelled"], // resolución manual admin, ver ticketCancellationService.ts
};

export class OrderStateError extends Error {
  constructor(public code: "NOT_FOUND" | "INVALID_TRANSITION", message: string) {
    super(message);
    this.name = "OrderStateError";
  }
}

export function isValidTransition(from: TicketOrderStatus, to: TicketOrderStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Aplica la transición SOLO si el estado actual en BD sigue siendo uno de
 * los `from` esperados (concurrencia — dos llamadas simultáneas, p.ej. un
 * webhook de pago y una expiración de hold procesándose a la vez, nunca
 * pueden "ganar" ambas). Lanza OrderStateError si la fila no existe o si la
 * transición no es válida desde el estado ya persistido.
 */
export async function transitionOrderStatus(
  orderId: number,
  from: TicketOrderStatus[],
  to: TicketOrderStatus,
  extraFields: Partial<TicketOrder> = {},
  db?: DbHandle
): Promise<TicketOrder> {
  const conn = db ?? (await getDb());

  for (const f of from) {
    if (!isValidTransition(f, to)) {
      throw new OrderStateError("INVALID_TRANSITION", `Transición no permitida: ${f} → ${to}`);
    }
  }

  const [result] = await conn.update(ticketOrders)
    .set({ status: to, ...extraFields })
    .where(and(eq(ticketOrders.id, orderId), inArray(ticketOrders.status, from)));

  if ((result as unknown as { affectedRows: number }).affectedRows === 0) {
    const [existing] = await conn.select().from(ticketOrders).where(eq(ticketOrders.id, orderId)).limit(1);
    if (!existing) throw new OrderStateError("NOT_FOUND", "Order no encontrado");
    throw new OrderStateError("INVALID_TRANSITION", `El order ya no está en un estado válido para esta transición (estado actual: ${existing.status})`);
  }

  const [updated] = await conn.select().from(ticketOrders).where(eq(ticketOrders.id, orderId)).limit(1);
  return updated;
}
