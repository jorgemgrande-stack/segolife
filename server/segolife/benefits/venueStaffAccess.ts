/**
 * venueStaffAccess.ts — alcance por VENUE del staff que valida Benefits en
 * puerta/caja (Fase 4). Dimensión NUEVA, distinta de communityAccess.ts
 * (que escopa por comunidad): un miembro del staff de un venue no debe
 * poder validar beneficios destinados a otro venue salvo que tenga permiso
 * global — ver drizzle/schema.ts, comentario de venue_staff.
 *
 * GLOBAL: mismo criterio que communityAccess.ts (permiso `benefits.manage`
 * con fallback al rol legacy admin) — un admin global no necesita filas en
 * venue_staff, ve/valida cualquier venue.
 * STAFF ACOTADO: sin permiso global, el alcance son EXACTAMENTE los venues
 * con una fila `venue_staff.active=true` para ese user_id. Sin ninguna fila
 * = sin ningún venue (nunca "todos" por omisión) — un flujo de puerta
 * restrictivo por defecto es la opción segura.
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { venueStaff } from "../../../drizzle/schema";
import { checkRbacOrLegacy } from "../../_core/rbac";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

/** "all" = sin restricción (admin global). number[] = solo esos venues. */
export type VenueStaffAccess = "all" | number[];

/**
 * `permissionKey` es parametrizable (Fase 8, spec punto 14) — Benefits sigue
 * usando "benefits.manage" (valor por defecto, compatibilidad con todas las
 * llamadas ya existentes sin tocarlas), Ticketing check-in usa
 * "event_ticketing.manage" y Commerce/POS usa "commerce.manage". La tabla
 * `venue_staff` en sí es genérica (userId+venueId) — un mismo miembro de
 * staff puede tener alcance de Benefits Y de Ticketing en el mismo venue
 * con una única fila, el permiso GLOBAL es lo único que cambia por dominio.
 */
export async function getVenueStaffAccess(userId: number, legacyRole: string, db?: DbHandle, permissionKey: string = "benefits.manage"): Promise<VenueStaffAccess> {
  const isGlobal = await checkRbacOrLegacy(userId, legacyRole, permissionKey, ["admin"]);
  if (isGlobal) return "all";

  const conn = db ?? (await getDb());
  const rows = await conn.select({ venueId: venueStaff.venueId }).from(venueStaff)
    .where(and(eq(venueStaff.userId, userId), eq(venueStaff.active, true)));
  return rows.map(r => r.venueId);
}
