/**
 * venueAppService.ts — SEGOLIFE VENUE & PARTNER APP (spec §4/§5/§8).
 * Agregador de solo lectura para la operación diaria de un venue — UN
 * único punto de composición en vez de que la UI dispare 6+ queries
 * independientes (mismo principio que homeSummaryService.ts en el Student
 * App). Todo dato es real: si un motor no tiene nada que mostrar, el campo
 * queda vacío/null, nunca se rellena con un placeholder (spec §41).
 *
 * "Hoy" (checkInsToday/uniqueStudentsToday) usa una ventana rodante de 24h
 * sobre event_attendance.occurredAt — una aproximación deliberada y
 * documentada (spec §4: "operational snapshot", no BI final) en vez de
 * construir límites horarios exactos en Europe/Madrid sin una librería de
 * timezones ya presente en el repo. venue_visits SÍ filtra por
 * operationalDate exacto (columna ya calculada, sin aproximación) porque
 * ya existe barato.
 */
import { eq, and, gte, desc, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  eventAttendance, venueVisits, events, users, userBenefits, benefitDefinitions,
  type SegolifeEvent,
} from "../../../drizzle/schema";
import { resolveOperationalDate } from "./venueVisitService";
import { isEventCurrentlyOpen } from "../ticketing/unifiedCheckinService";
import { getWalletByUserId } from "../tokens/tokenLedgerService";
import { getUserCommunitiesWithDetails } from "../../db/communitiesDb";
import { getStudentPhotoDataUri } from "../students/studentPhotoService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

const ROLLING_TODAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_ACTIVITY_LIMIT = 20;

export interface VenueActivityItem {
  type: "event_checkin" | "venue_visit" | "benefit_redeemed";
  studentName: string;
  at: Date;
  eventName?: string | null;
  benefitName?: string | null;
}

export interface VenueTodaySnapshot {
  currentEvent: SegolifeEvent | null;
  nextEvent: SegolifeEvent | null;
  checkInsToday: number;
  uniqueStudentsToday: number;
  recentActivity: VenueActivityItem[];
}

/** Elige, entre los eventos "activos" del venue, el que está en curso AHORA (spec §14) — reutiliza isEventCurrentlyOpen, la misma regla nightlife-aware que ya protege el check-in, nunca una segunda definición de "en curso". */
function pickCurrent(candidates: SegolifeEvent[], at: Date): SegolifeEvent | null {
  const open = candidates.filter(e => isEventCurrentlyOpen(e, at));
  return open[0] ?? null;
}

function pickNext(candidates: SegolifeEvent[], at: Date): SegolifeEvent | null {
  const upcoming = candidates.filter(e => e.startsAt.getTime() > at.getTime()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return upcoming[0] ?? null;
}

export async function getVenueTodaySnapshot(venueId: number, at: Date = new Date(), db?: DbHandle): Promise<VenueTodaySnapshot> {
  const conn = db ?? (await getDb());
  const windowStart = new Date(at.getTime() - ROLLING_TODAY_WINDOW_MS);
  const todayOperationalDate = resolveOperationalDate(at);

  const [venueEvents, attendanceRows, visitRows] = await Promise.all([
    conn.select().from(events).where(and(eq(events.venueId, venueId), eq(events.status, "active"))),
    conn.select({ userId: eventAttendance.userId, occurredAt: eventAttendance.occurredAt, eventId: eventAttendance.eventId })
      .from(eventAttendance).where(and(eq(eventAttendance.venueId, venueId), gte(eventAttendance.occurredAt, windowStart))),
    conn.select({ userId: venueVisits.userId, occurredAt: venueVisits.occurredAt })
      .from(venueVisits).where(and(eq(venueVisits.venueId, venueId), eq(venueVisits.operationalDate, todayOperationalDate))),
  ]);

  const currentEvent = pickCurrent(venueEvents, at);
  const nextEvent = pickNext(venueEvents, at);

  const uniqueStudents = new Set<number>([...attendanceRows.map(r => r.userId), ...visitRows.map(r => r.userId)]);

  const recentActivity = await buildRecentActivity(venueId, windowStart, todayOperationalDate, conn);

  return {
    currentEvent,
    nextEvent,
    checkInsToday: attendanceRows.length + visitRows.length,
    uniqueStudentsToday: uniqueStudents.size,
    recentActivity,
  };
}

async function buildRecentActivity(venueId: number, windowStart: Date, todayOperationalDate: string, conn: DbHandle): Promise<VenueActivityItem[]> {
  const [attendanceRows, visitRows, benefitRows] = await Promise.all([
    conn.select({ userId: eventAttendance.userId, occurredAt: eventAttendance.occurredAt, eventId: eventAttendance.eventId })
      .from(eventAttendance).where(and(eq(eventAttendance.venueId, venueId), gte(eventAttendance.occurredAt, windowStart)))
      .orderBy(desc(eventAttendance.occurredAt)).limit(RECENT_ACTIVITY_LIMIT),
    conn.select({ userId: venueVisits.userId, occurredAt: venueVisits.occurredAt })
      .from(venueVisits).where(and(eq(venueVisits.venueId, venueId), eq(venueVisits.operationalDate, todayOperationalDate)))
      .orderBy(desc(venueVisits.occurredAt)).limit(RECENT_ACTIVITY_LIMIT),
    conn.select({ userId: userBenefits.userId, usedAt: userBenefits.usedAt, name: benefitDefinitions.name })
      .from(userBenefits).innerJoin(benefitDefinitions, eq(userBenefits.benefitDefinitionId, benefitDefinitions.id))
      .where(and(eq(userBenefits.usedAtVenueId, venueId), gte(userBenefits.usedAt, windowStart)))
      .orderBy(desc(userBenefits.usedAt)).limit(RECENT_ACTIVITY_LIMIT),
  ]);

  const userIds = Array.from(new Set([...attendanceRows.map(r => r.userId), ...visitRows.map(r => r.userId), ...benefitRows.map(r => r.userId)]));
  const eventIds = Array.from(new Set(attendanceRows.map(r => r.eventId)));

  const [userRows, eventRows] = await Promise.all([
    userIds.length ? conn.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([]),
    eventIds.length ? conn.select({ id: events.id, name: events.name }).from(events).where(inArray(events.id, eventIds)) : Promise.resolve([]),
  ]);
  const nameById = new Map(userRows.map(u => [u.id, u.name ?? "—"]));
  const eventNameById = new Map(eventRows.map(e => [e.id, e.name]));

  const items: VenueActivityItem[] = [
    ...attendanceRows.map(r => ({ type: "event_checkin" as const, studentName: nameById.get(r.userId) ?? "—", at: r.occurredAt, eventName: eventNameById.get(r.eventId) ?? null })),
    ...visitRows.map(r => ({ type: "venue_visit" as const, studentName: nameById.get(r.userId) ?? "—", at: r.occurredAt })),
    ...benefitRows.filter(r => r.usedAt != null).map(r => ({ type: "benefit_redeemed" as const, studentName: nameById.get(r.userId) ?? "—", at: r.usedAt as Date, benefitName: r.name })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, RECENT_ACTIVITY_LIMIT);
}

// ─── Vista operativa de eventos del venue (spec §13) ────────────────────────

export interface VenueEventsView {
  current: SegolifeEvent[];
  upcoming: SegolifeEvent[];
  recentlyCompleted: SegolifeEvent[];
}

const RECENTLY_COMPLETED_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function getVenueEventsView(venueId: number, at: Date = new Date(), db?: DbHandle): Promise<VenueEventsView> {
  const conn = db ?? (await getDb());
  const all = await conn.select().from(events).where(and(eq(events.venueId, venueId), eq(events.status, "active")));

  const current: SegolifeEvent[] = [];
  const upcoming: SegolifeEvent[] = [];
  const recentlyCompleted: SegolifeEvent[] = [];
  for (const e of all) {
    if (isEventCurrentlyOpen(e, at)) { current.push(e); continue; }
    if (e.startsAt.getTime() > at.getTime()) { upcoming.push(e); continue; }
    const effectiveEnd = e.endsAt ?? new Date(e.startsAt.getTime() + 8 * 60 * 60 * 1000);
    if (at.getTime() - effectiveEnd.getTime() <= RECENTLY_COMPLETED_WINDOW_MS) recentlyCompleted.push(e);
  }
  upcoming.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  recentlyCompleted.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  return { current, upcoming, recentlyCompleted };
}

// ─── Estadísticas operativas de UN evento — spec §14, "live door screen" ───

export interface EventLiveStats {
  event: SegolifeEvent;
  checkInsTotal: number;
  checkInsNative: number;
  checkInsExternal: number;
  ticketsIssued: number;
}

export async function getEventLiveStats(eventId: number, db?: DbHandle): Promise<EventLiveStats | null> {
  const conn = db ?? (await getDb());
  const [event] = await conn.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return null;

  const [attendanceRows, ticketCountRow] = await Promise.all([
    conn.select({ provider: eventAttendance.provider }).from(eventAttendance).where(eq(eventAttendance.eventId, eventId)),
    conn.execute(sql`SELECT COUNT(*) as c FROM event_tickets WHERE event_id = ${eventId} AND status IN ('issued','used')`),
  ]);
  const native = attendanceRows.filter(r => r.provider === "segolife").length;
  const ticketsIssued = Number(((ticketCountRow as unknown as [{ c: number }[]])[0]?.[0]?.c) ?? 0);

  return {
    event,
    checkInsTotal: attendanceRows.length,
    checkInsNative: native,
    checkInsExternal: attendanceRows.length - native,
    ticketsIssued,
  };
}

// ─── Ficha operativa de UN Student en ESTE venue — spec §8/§32 ─────────────
// NUNCA Student 360: sin email/teléfono/notas/historial global. Solo lo que
// el staff necesita para operar en este venue concreto, ahora mismo.

export interface VenueStudentCardActivity {
  type: "event_checkin" | "venue_visit" | "benefit_redeemed";
  at: Date;
  label: string | null;
}

export interface VenueStudentCard {
  userId: number;
  name: string;
  /**
   * MG-03 — data URI base64 ya lista para <img src>, o null sin foto
   * (fallback a iniciales en el frontend). Nunca una URL: esta respuesta ya
   * está autorizada por requireVenueAccess() + el token QR recién escaneado
   * (ver venueApp.ts::studentCard) — la foto reutiliza EXACTAMENTE esa
   * misma autorización en vez de exponer un endpoint nuevo que el Venue
   * pudiera usar para enumerar Students (spec §10/§13).
   */
  photoDataUri: string | null;
  communities: string[];
  checkedInToday: boolean;
  walletBalance: number;
  benefitsHere: Array<{ id: number; name: string; status: string; validUntil: Date | null }>;
  recentActivityHere: VenueStudentCardActivity[];
}

export async function getVenueStudentCard(userId: number, venueId: number, at: Date = new Date(), db?: DbHandle): Promise<VenueStudentCard> {
  const conn = db ?? (await getDb());
  const todayOperationalDate = resolveOperationalDate(at);
  const windowStart = new Date(at.getTime() - ROLLING_TODAY_WINDOW_MS);
  const activityWindowStart = new Date(at.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 días — "reciente en este venue", nunca el historial completo

  const [userRow, communities, wallet, attendanceToday, visitToday, benefits, recentAttendance, recentVisits, recentBenefitUses, photoDataUri] = await Promise.all([
    conn.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
    getUserCommunitiesWithDetails(userId, conn as never),
    getWalletByUserId(userId, conn as never),
    conn.select({ id: eventAttendance.id }).from(eventAttendance).where(and(eq(eventAttendance.userId, userId), eq(eventAttendance.venueId, venueId), gte(eventAttendance.occurredAt, windowStart))).limit(1),
    conn.select({ id: venueVisits.id }).from(venueVisits).where(and(eq(venueVisits.userId, userId), eq(venueVisits.venueId, venueId), eq(venueVisits.operationalDate, todayOperationalDate))).limit(1),
    conn.select({ id: userBenefits.id, status: userBenefits.status, validUntil: userBenefits.validUntil, name: benefitDefinitions.name })
      .from(userBenefits).innerJoin(benefitDefinitions, eq(userBenefits.benefitDefinitionId, benefitDefinitions.id))
      .where(and(eq(userBenefits.userId, userId), eq(benefitDefinitions.destinationVenueId, venueId), eq(userBenefits.status, "active"))),
    conn.select({ occurredAt: eventAttendance.occurredAt, eventId: eventAttendance.eventId }).from(eventAttendance)
      .where(and(eq(eventAttendance.userId, userId), eq(eventAttendance.venueId, venueId), gte(eventAttendance.occurredAt, activityWindowStart)))
      .orderBy(desc(eventAttendance.occurredAt)).limit(5),
    conn.select({ occurredAt: venueVisits.occurredAt }).from(venueVisits)
      .where(and(eq(venueVisits.userId, userId), eq(venueVisits.venueId, venueId), gte(venueVisits.occurredAt, activityWindowStart)))
      .orderBy(desc(venueVisits.occurredAt)).limit(5),
    conn.select({ usedAt: userBenefits.usedAt, name: benefitDefinitions.name }).from(userBenefits)
      .innerJoin(benefitDefinitions, eq(userBenefits.benefitDefinitionId, benefitDefinitions.id))
      .where(and(eq(userBenefits.userId, userId), eq(userBenefits.usedAtVenueId, venueId), gte(userBenefits.usedAt, activityWindowStart)))
      .orderBy(desc(userBenefits.usedAt)).limit(5),
    getStudentPhotoDataUri(userId),
  ]);

  const eventIds = Array.from(new Set(recentAttendance.map(r => r.eventId)));
  const eventNameRows = eventIds.length ? await conn.select({ id: events.id, name: events.name }).from(events).where(inArray(events.id, eventIds)) : [];
  const eventNameById = new Map(eventNameRows.map(e => [e.id, e.name]));

  const recentActivityHere: VenueStudentCardActivity[] = [
    ...recentAttendance.map(r => ({ type: "event_checkin" as const, at: r.occurredAt, label: eventNameById.get(r.eventId) ?? null })),
    ...recentVisits.map(r => ({ type: "venue_visit" as const, at: r.occurredAt, label: null })),
    ...recentBenefitUses.filter(r => r.usedAt != null).map(r => ({ type: "benefit_redeemed" as const, at: r.usedAt as Date, label: r.name })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 5);

  return {
    userId,
    name: userRow[0]?.name ?? "—",
    photoDataUri,
    communities: communities.map(c => c.name),
    checkedInToday: attendanceToday.length > 0 || visitToday.length > 0,
    walletBalance: wallet?.balance ?? 0,
    benefitsHere: benefits.map(b => ({ id: b.id, name: b.name, status: b.status, validUntil: b.validUntil })),
    recentActivityHere,
  };
}
