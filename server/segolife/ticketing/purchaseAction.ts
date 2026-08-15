/**
 * purchaseAction.ts — deriva el CTA "Buy Tickets" del Event Detail público
 * (Fase 5, puntos 59-60; activado en Fase 8, spec punto 3). El frontend
 * NUNCA pregunta `if provider === "fourvenues"` — recibe un `PurchaseAction`
 * ya resuelto y renderiza según su `type`, sin conocer proveedores.
 *
 * FASE 8: `native_checkout` deja de forzar siempre `unavailable` — cuando el
 * canal primario es realmente `salesMode="native"` Y hay al menos un tipo
 * de entrada activo, se devuelve la lista de tipos de entrada + inventory
 * ya calculado (el checkout backend vuelve a validar todo igualmente — el
 * frontend nunca decide disponibilidad, solo la muestra). Esto NO activa un
 * pago real: sin PaymentProvider configurado, el checkout puede crear el
 * hold pero nunca completar el pago (ver checkoutService.ts).
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { salesChannels } from "../../../drizzle/schema";
import { getTicketTypeInventory, listTicketTypes } from "./ticketingDb";
import { isEventPast, type EventTimingInput } from "../../../shared/segolife/eventTiming";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface PurchaseActionTicketType {
  id: number;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  available: number | null;
}

export type PurchaseAction =
  | { type: "external_url"; url: string }
  | { type: "native_checkout"; eventId: number; ticketTypes: PurchaseActionTicketType[] }
  | { type: "unavailable" };

/**
 * El canal activo con menor sort_order (o is_primary=true) gana. Sin
 * canales activos → unavailable, nunca un checkout falso.
 *
 * Fase 8.6, puntos 25/90: un evento ya terminado (`isEventPast`, ver
 * shared/segolife/eventTiming.ts) nunca debe mostrar CTA de compra —
 * comprobación aquí, no en cada pantalla, porque el backend decide (spec
 * punto 55) y esta es la única función que calcula purchaseAction.
 */
export async function computePurchaseAction(eventId: number, eventTiming: EventTimingInput, db?: DbHandle): Promise<PurchaseAction> {
  if (isEventPast(eventTiming)) return { type: "unavailable" };

  const conn = db ?? (await getDb());
  const channels = await conn.select().from(salesChannels)
    .where(and(eq(salesChannels.eventId, eventId), eq(salesChannels.status, "active")))
    .orderBy(salesChannels.sortOrder);

  if (!channels.length) return { type: "unavailable" };

  const primary = channels.find(c => c.isPrimary) ?? channels[0];

  if (primary.salesMode === "external_redirect" && primary.externalUrl) {
    return { type: "external_url", url: primary.externalUrl };
  }
  if (primary.salesMode === "native") {
    const now = new Date();
    const [types, inventory] = await Promise.all([listTicketTypes(eventId, conn), getTicketTypeInventory(eventId, conn)]);
    const onSale = types.filter(t =>
      t.status === "active"
      && !t.isDoorEntry // SEGOLIFE — COMMERCE CORE (Fase 9, spec §14): un tipo de entrada de puerta nunca aparece en la compra online pública, solo en el picker de venta de puerta de Venue App.
      && (!t.salesStart || t.salesStart <= now)
      && (!t.salesEnd || t.salesEnd >= now)
    );
    if (!onSale.length) return { type: "unavailable" };

    return {
      type: "native_checkout",
      eventId,
      ticketTypes: onSale.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        priceCents: t.priceCents,
        currency: t.currency,
        available: inventory.find(i => i.ticketTypeId === t.id)?.available ?? null,
      })),
    };
  }
  return { type: "unavailable" };
}
