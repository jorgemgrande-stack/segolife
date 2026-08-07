/**
 * tokenScheduleService.ts — horarios de earn/spend por venue (Fase 2).
 *
 * Sin ninguna fila para un venue+operationType = SIN RESTRICCIÓN (permitido
 * siempre) — ver drizzle/schema.ts, comentario de venue_token_schedules.
 * Un rango `startTime === endTime` se interpreta como "todo el día". Un
 * rango con `endTime < startTime` cruza medianoche (p.ej. 22:00–02:00).
 *
 * La hora "actual" se calcula en Europe/Madrid vía Intl.DateTimeFormat (sin
 * añadir una librería de zonas horarias nueva) — cada fila tiene su propia
 * columna `timezone` para un futuro venue fuera de Madrid, pero hoy todos
 * los venues reales son Europe/Madrid, así que el cálculo del "momento
 * actual" usa esa zona de forma fija; el día que exista un venue en otra
 * zona, esta función deberá leer `row.timezone` en vez de la constante.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and } from "drizzle-orm";
import { venueTokenSchedules, type VenueTokenSchedule } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type OperationType = "earn" | "spend";

interface ScheduleMoment {
  dayOfWeek: number; // 0=domingo..6=sábado, igual que JS Date#getDay()
  time: string; // "HH:MM"
  date: string; // "YYYY-MM-DD"
}

const WEEKDAY_TO_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function resolveMadridMoment(at: Date = new Date()): ScheduleMoment {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map(p => [p.type, p.value]));
  return {
    dayOfWeek: WEEKDAY_TO_INDEX[parts.weekday],
    time: `${parts.hour}:${parts.minute}`,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function isWithinTimeRange(time: string, start: string, end: string): boolean {
  const t = timeToMinutes(time);
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === e) return true; // rango de 24h completo
  if (s < e) return t >= s && t < e;
  return t >= s || t < e; // cruza medianoche
}

function isWithinValidDateRange(date: string, validFrom: string | null, validTo: string | null): boolean {
  if (validFrom && date < validFrom) return false;
  if (validTo && date > validTo) return false;
  return true;
}

/** true si el venue permite earn/spend en este instante — true también si no hay ninguna franja configurada. */
export async function isWithinSchedule(
  venueId: number,
  operationType: OperationType,
  at: Date = new Date(),
  db?: DbHandle
): Promise<boolean> {
  const conn = db ?? (await getDb());
  const rows = await conn.select().from(venueTokenSchedules).where(and(
    eq(venueTokenSchedules.venueId, venueId),
    eq(venueTokenSchedules.operationType, operationType),
    eq(venueTokenSchedules.active, true)
  ));
  if (rows.length === 0) return true;

  const moment = resolveMadridMoment(at);
  return rows.some(row =>
    row.dayOfWeek === moment.dayOfWeek &&
    isWithinValidDateRange(moment.date, row.validFrom, row.validTo) &&
    isWithinTimeRange(moment.time, row.startTime, row.endTime)
  );
}

export async function listSchedulesByVenue(venueId: number, db?: DbHandle): Promise<VenueTokenSchedule[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(venueTokenSchedules)
    .where(eq(venueTokenSchedules.venueId, venueId))
    .orderBy(venueTokenSchedules.operationType, venueTokenSchedules.dayOfWeek, venueTokenSchedules.startTime);
}

export interface CreateScheduleInput {
  venueId: number;
  operationType: OperationType;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  active?: boolean;
  timezone?: string;
  validFrom?: string | null;
  validTo?: string | null;
}

export async function createSchedule(input: CreateScheduleInput, db?: DbHandle): Promise<VenueTokenSchedule> {
  const conn = db ?? (await getDb());
  const insertResult = await conn.insert(venueTokenSchedules).values(input);
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [created] = await conn.select().from(venueTokenSchedules).where(eq(venueTokenSchedules.id, insertId)).limit(1);
  return created;
}

export async function deleteSchedule(id: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.delete(venueTokenSchedules).where(eq(venueTokenSchedules.id, id));
}

export async function setScheduleActive(id: number, active: boolean, db?: DbHandle): Promise<VenueTokenSchedule | null> {
  const conn = db ?? (await getDb());
  await conn.update(venueTokenSchedules).set({ active }).where(eq(venueTokenSchedules.id, id));
  const [updated] = await conn.select().from(venueTokenSchedules).where(eq(venueTokenSchedules.id, id)).limit(1);
  return updated ?? null;
}
