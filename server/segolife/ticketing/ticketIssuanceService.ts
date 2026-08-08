/**
 * ticketIssuanceService.ts — emisión de event_tickets al confirmar el pago
 * de un ticket_order nativo (Fase 8, spec puntos 9, 34). REUTILIZA
 * `event_tickets` (nunca una tabla `native_tickets` paralela). Idempotente
 * SIN añadir una columna nueva: cada ticket individual usa
 * `provider="segolife_native"` + `external_ticket_id="native:<orderId>:<itemId>:<n>"`,
 * reaprovechando el UNIQUE (`provider`, `external_ticket_id`) que Fase 5 ya
 * definía para tickets EXTERNOS — aquí sirve exactamente igual de límite de
 * duplicados. Reemitir para el mismo order nunca crea tickets de más.
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eventTickets, ticketOrderItems, type EventTicket, type TicketOrder } from "../../../drizzle/schema";
import { generateTicketQrToken, hashTicketQrToken } from "./ticketQrService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export const NATIVE_TICKET_PROVIDER = "segolife_native";

/** Emite (o recupera, si ya se emitieron) todos los event_tickets de un order YA PAGADO. Nunca se llama fuera de checkoutService.confirmPayment(). */
export async function issueTicketsForOrder(order: TicketOrder, db?: DbHandle): Promise<EventTicket[]> {
  const conn = db ?? (await getDb());
  const items = await conn.select().from(ticketOrderItems).where(eq(ticketOrderItems.orderId, order.id));

  const issued: EventTicket[] = [];
  for (const item of items) {
    for (let n = 1; n <= item.quantity; n++) {
      const externalTicketId = `native:${order.id}:${item.id}:${n}`;

      const [existing] = await conn.select().from(eventTickets)
        .where(and(eq(eventTickets.provider, NATIVE_TICKET_PROVIDER), eq(eventTickets.externalTicketId, externalTicketId)))
        .limit(1);
      if (existing) { issued.push(existing); continue; }

      const qrToken = generateTicketQrToken();
      const qrTokenHash = hashTicketQrToken(qrToken);

      const [insertResult] = await conn.insert(eventTickets).ignore().values({
        eventId: order.eventId,
        ticketTypeId: item.ticketTypeId,
        orderId: order.id,
        userId: order.userId,
        salesChannel: "native",
        provider: NATIVE_TICKET_PROVIDER,
        externalTicketId,
        status: "issued",
        qrToken,
        qrTokenHash,
        issuedAt: new Date(),
        metadata: {},
      });
      const insertId = (insertResult as unknown as { insertId: number }).insertId;

      if (!insertId) {
        // Carrera real: otra llamada concurrente ganó el INSERT — recuperar la suya, nunca la nuestra (el qrToken recién generado aquí nunca se persistió).
        const [winner] = await conn.select().from(eventTickets)
          .where(and(eq(eventTickets.provider, NATIVE_TICKET_PROVIDER), eq(eventTickets.externalTicketId, externalTicketId)))
          .limit(1);
        if (winner) issued.push(winner);
        continue;
      }

      const [row] = await conn.select().from(eventTickets).where(eq(eventTickets.id, insertId)).limit(1);
      issued.push(row);
    }
  }
  return issued;
}
