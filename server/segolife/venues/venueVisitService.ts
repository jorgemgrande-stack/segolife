/**
 * venueVisitService.ts — SEGOLIFE VENUE & PARTNER APP (spec §10/§11).
 * Hecho canónico "Student estuvo en VENUE" para cuando NO hay ningún evento
 * vigente que resolver (unifiedCheckinService.ts::checkInStudentIdentity
 * llama aquí solo en ese caso — nunca junto a un event_attendance para el
 * mismo escaneo). Ver drizzle/schema.ts, comentario de venue_visits, para
 * el razonamiento completo de por qué es una tabla nueva y no una
 * reutilización forzada de event_attendance.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { venueVisits, type VenueVisit } from "../../../drizzle/schema";
import { resolveMadridMoment } from "../tokens/tokenScheduleService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

/**
 * Día operativo de nightlife — límite a las 06:00 Europe/Madrid, NUNCA
 * medianoche de calendario. Una visita a las 23:55 y un rescan a las 00:20
 * devuelven el MISMO operationalDate ("ayer") — ver comentario de schema.
 */
const OPERATIONAL_DAY_BOUNDARY_HOURS = 6;

export function resolveOperationalDate(at: Date): string {
  const shifted = new Date(at.getTime() - OPERATIONAL_DAY_BOUNDARY_HOURS * 60 * 60 * 1000);
  return resolveMadridMoment(shifted).date;
}

export interface RecordVenueVisitInput {
  userId: number;
  venueId: number;
  occurredAt: Date;
  source: string;
  operatorUserId?: number | null;
  eventAttendanceId?: number | null;
}

export type RecordVenueVisitResult =
  | { status: "recorded"; visit: VenueVisit }
  | { status: "already_recorded"; visit: VenueVisit };

/**
 * Idempotente vía UNIQUE(idempotency_key) + insert().ignore() — dos
 * escaneos concurrentes del mismo Student en el mismo venue dentro del
 * mismo día operativo nunca crean dos filas (mismo patrón que
 * ingestAttendance/attendancePipeline.ts, nunca un motor paralelo de
 * asistencia — este es su hermano venue-only, no un sustituto).
 */
export async function recordVenueVisit(input: RecordVenueVisitInput, db?: DbHandle): Promise<RecordVenueVisitResult> {
  const conn = db ?? (await getDb());
  const operationalDate = resolveOperationalDate(input.occurredAt);
  const idempotencyKey = `venue_visit:${input.venueId}:${input.userId}:${operationalDate}`;

  const [existing] = await conn.select().from(venueVisits).where(eq(venueVisits.idempotencyKey, idempotencyKey)).limit(1);
  if (existing) return { status: "already_recorded", visit: existing };

  const [insertResult] = await conn.insert(venueVisits).ignore().values({
    userId: input.userId,
    venueId: input.venueId,
    eventAttendanceId: input.eventAttendanceId ?? null,
    occurredAt: input.occurredAt,
    operationalDate,
    source: input.source,
    operatorUserId: input.operatorUserId ?? null,
    idempotencyKey,
  });
  const insertId = (insertResult as unknown as { insertId: number }).insertId;
  if (!insertId) {
    // Carrera real (dos escaneos concurrentes) — el otro ya la insertó, devolver esa fila.
    const [row] = await conn.select().from(venueVisits).where(eq(venueVisits.idempotencyKey, idempotencyKey)).limit(1);
    return { status: "already_recorded", visit: row };
  }
  const [row] = await conn.select().from(venueVisits).where(eq(venueVisits.id, insertId)).limit(1);
  return { status: "recorded", visit: row };
}
