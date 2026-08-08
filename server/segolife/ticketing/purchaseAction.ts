/**
 * purchaseAction.ts — deriva el CTA "Buy Tickets" del Event Detail público
 * (Fase 5, puntos 59-60). El frontend NUNCA pregunta `if provider ===
 * "fourvenues"` — recibe un `PurchaseAction` ya resuelto y renderiza según
 * su `type`, sin conocer proveedores.
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { salesChannels } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type PurchaseAction =
  | { type: "external_url"; url: string }
  | { type: "native_checkout" }
  | { type: "unavailable" };

/** El canal activo con menor sort_order (o is_primary=true) gana. Sin canales activos → unavailable, nunca un checkout falso. */
export async function computePurchaseAction(eventId: number, db?: DbHandle): Promise<PurchaseAction> {
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
    // Preparado, no activado en esta fase (spec punto 45) — nunca se
    // ofrece un checkout real todavía, aunque exista una fila "native".
    return { type: "unavailable" };
  }
  return { type: "unavailable" };
}
