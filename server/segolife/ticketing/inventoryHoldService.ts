/**
 * inventoryHoldService.ts — reserva temporal de inventario sin overselling
 * (Fase 8, spec punto 4). Mantiene la decisión de Fase 5 (inventory =
 * capacity − comprometido, SIEMPRE calculado en caliente, nunca un contador
 * mutable) mientras resuelve concurrencia real:
 *
 *  - "Comprometido" ahora incluye tanto `status='paid'` COMO holds vigentes
 *    (`status IN ('pending','awaiting_payment')` con `expires_at > NOW()`).
 *  - La comprobación de aforo + creación del hold ocurren dentro de UNA
 *    transacción que toma `SELECT ... FOR UPDATE` sobre las filas de
 *    `event_ticket_types` implicadas — el motor MySQL serializa así dos
 *    intentos concurrentes sobre el MISMO tipo de entrada sin necesitar
 *    ningún contador aparte (mismo patrón que tokenLedgerService.ts con
 *    token_wallets). Tipos de entrada DISTINTOS no se bloquean entre sí.
 *  - Los ticket_type_id implicados se bloquean siempre en orden ascendente
 *    para evitar deadlocks entre holds concurrentes multi-item.
 *  - Un hold "expira" simplemente dejando de contar como comprometido en
 *    cuanto pasa `expires_at` — no hace falta ningún job/cron que lo
 *    libere activamente. `expireStaleHoldsForUser()` solo actualiza el
 *    `status` visible a "expired" de forma perezosa (al listar pedidos),
 *    por higiene, nunca por corrección de inventario (ya es correcto sin
 *    ella).
 */
import { eq, and, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  eventTicketTypes, ticketOrders, ticketOrderItems,
  type EventTicketType, type TicketOrder,
} from "../../../drizzle/schema";
import { transitionOrderStatus } from "./orderStateMachine";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 5 });
const _db = drizzle(_pool);

export type DbHandle = typeof _db;
// El callback de `.transaction()` recibe un tipo distinto (MySqlTransaction),
// incompatible en TypeScript con MySql2Database aunque comparten la misma
// API en tiempo de ejecución — mismo workaround que tokenLedgerService.ts.
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export const HOLD_DURATION_MINUTES = 15;
export const MAX_QUANTITY_PER_TICKET_TYPE = 10; // anti-abuso básico, no es un límite de negocio real

export class CheckoutError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "CheckoutError";
  }
}

export interface HoldItemInput {
  ticketTypeId: number;
  quantity: number;
}

export interface CreateHoldInput {
  eventId: number;
  userId: number;
  items: HoldItemInput[];
  buyerName?: string | null;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
  salesChannelId?: number | null;
  idempotencyKey: string;
}

export type CreateHoldResult =
  | { status: "created"; order: TicketOrder }
  | { status: "already_exists"; order: TicketOrder };

/** Cantidad ya comprometida (paid + holds vigentes) para un tipo de entrada — DEBE llamarse dentro de la misma transacción que ya tiene el FOR UPDATE sobre event_ticket_types. */
async function committedQuantity(tx: AnyDbHandle, ticketTypeId: number): Promise<number> {
  const [row] = await tx.select({
    committed: sql<number>`COALESCE(SUM(${ticketOrderItems.quantity}), 0)`,
  }).from(ticketOrderItems)
    .innerJoin(ticketOrders, eq(ticketOrderItems.orderId, ticketOrders.id))
    .where(and(
      eq(ticketOrderItems.ticketTypeId, ticketTypeId),
      sql`(${ticketOrders.status} = 'paid' OR (${ticketOrders.status} IN ('pending', 'awaiting_payment') AND ${ticketOrders.expiresAt} > NOW()))`
    ));
  return Number(row?.committed ?? 0);
}

export async function createHold(input: CreateHoldInput, db?: DbHandle): Promise<CreateHoldResult> {
  const conn = db ?? (await getDb());

  const [existing] = await conn.select().from(ticketOrders).where(eq(ticketOrders.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing) return { status: "already_exists", order: existing };

  if (!input.items.length) throw new CheckoutError("EMPTY_CART", "El carrito está vacío");
  for (const item of input.items) {
    if (item.quantity < 1 || item.quantity > MAX_QUANTITY_PER_TICKET_TYPE) {
      throw new CheckoutError("INVALID_QUANTITY", `Cantidad no válida para el tipo de entrada ${item.ticketTypeId}`);
    }
  }

  const order = await conn.transaction(async (tx) => {
    const ticketTypeIds = Array.from(new Set(input.items.map(i => i.ticketTypeId))).sort((a, b) => a - b);
    const lockedTypes = await tx.select().from(eventTicketTypes)
      .where(inArray(eventTicketTypes.id, ticketTypeIds))
      .for("update");

    const typeById = new Map<number, EventTicketType>(lockedTypes.map(t => [t.id, t]));
    const now = new Date();
    let subtotalCents = 0;

    for (const item of input.items) {
      const type = typeById.get(item.ticketTypeId);
      if (!type || type.eventId !== input.eventId || type.status !== "active") {
        throw new CheckoutError("TICKET_TYPE_UNAVAILABLE", "Este tipo de entrada ya no está disponible");
      }
      if (type.salesStart && type.salesStart > now) throw new CheckoutError("SALES_NOT_STARTED", `Las ventas de "${type.name}" todavía no han empezado`);
      if (type.salesEnd && type.salesEnd < now) throw new CheckoutError("SALES_ENDED", `Las ventas de "${type.name}" ya han terminado`);

      if (type.capacity != null) {
        const committed = await committedQuantity(tx, item.ticketTypeId);
        if (committed + item.quantity > type.capacity) {
          throw new CheckoutError("SOLD_OUT", `No quedan suficientes entradas de "${type.name}" (disponibles: ${Math.max(0, type.capacity - committed)})`);
        }
      }

      // El PRECIO se calcula SIEMPRE en backend desde event_ticket_types — nunca se confía en un importe enviado por el frontend (spec punto 8).
      subtotalCents += type.priceCents * item.quantity;
    }

    const expiresAt = new Date(now.getTime() + HOLD_DURATION_MINUTES * 60_000);
    const [insertResult] = await tx.insert(ticketOrders).values({
      userId: input.userId,
      eventId: input.eventId,
      salesChannelId: input.salesChannelId ?? null,
      provider: "segolife",
      status: "pending",
      subtotalCents,
      feesCents: 0,
      totalCents: subtotalCents,
      currency: "EUR",
      buyerName: input.buyerName ?? null,
      buyerEmail: input.buyerEmail ?? null,
      buyerPhone: input.buyerPhone ?? null,
      expiresAt,
      idempotencyKey: input.idempotencyKey,
      metadata: {},
    });
    const orderId = (insertResult as unknown as { insertId: number }).insertId;

    await tx.insert(ticketOrderItems).values(
      input.items.map(item => {
        const type = typeById.get(item.ticketTypeId)!;
        return {
          orderId,
          ticketTypeId: item.ticketTypeId,
          quantity: item.quantity,
          unitPriceCents: type.priceCents,
          totalPriceCents: type.priceCents * item.quantity,
        };
      })
    );

    const [row] = await tx.select().from(ticketOrders).where(eq(ticketOrders.id, orderId)).limit(1);
    return row;
  });

  return { status: "created", order };
}

/** Marca visualmente como "expired" los holds de un usuario cuyo expiresAt ya pasó — nunca afecta a la corrección del inventario (ya se calcula excluyéndolos), solo a lo que ve el propio usuario/admin. Perezoso, sin cron. */
export async function expireStaleHoldsForUser(userId: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  const stale = await conn.select({ id: ticketOrders.id, status: ticketOrders.status }).from(ticketOrders)
    .where(and(
      eq(ticketOrders.userId, userId),
      inArray(ticketOrders.status, ["pending", "awaiting_payment"]),
      sql`${ticketOrders.expiresAt} < NOW()`
    ));
  for (const row of stale) {
    await transitionOrderStatus(row.id, [row.status as "pending" | "awaiting_payment"], "expired", {}, conn).catch(() => null);
  }
}
