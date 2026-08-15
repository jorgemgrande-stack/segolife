/**
 * unifiedCheckinService.ts — SEGOLIFE STUDENT IDENTITY, UNIVERSAL QR & UNIFIED
 * CHECK-IN. Orquesta el "un solo escaneo" cuando es posible, sin duplicar
 * ninguno de los motores ya existentes y auditados:
 *
 *   - Ticket nativo → sigue siendo nativeCheckinService.ts (sin tocar su
 *     lógica de validación/single-use/ingestAttendance).
 *   - QR permanente de identidad del Student → studentIdentityService.ts
 *     (sin tocar su generación/rotación).
 *   - El hecho canónico de asistencia sigue siendo, únicamente,
 *     attendancePipeline.ts::ingestAttendance() — este archivo NUNCA llama a
 *     earnTokens()/evaluateBenefitsForOrigin() directamente.
 *
 * Lo único nuevo aquí es la CAPA DE RESOLUCIÓN: dado un credential escaneado
 * en la puerta, decidir de qué tipo es (ticket vs identidad) y, para el caso
 * "Student sin entrada previa", resolver a qué evento corresponde su
 * asistencia — sin adivinar nunca si es ambiguo.
 */
import { eq, and, gte, lte, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eventTickets, events, type SegolifeEvent } from "../../../drizzle/schema";
import { hashTicketQrToken } from "./ticketQrService";
import { lookupStudentByIdentityToken, type IdentifiedStudent } from "../commerce/studentIdentityService";
import { ingestAttendance } from "./attendancePipeline";
import { checkInTicket, checkInTicketById, CheckinError, type CheckInTicketResult } from "./nativeCheckinService";
import { recordVenueVisit } from "../venues/venueVisitService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

// ─── 1. RESOLUCIÓN DE CREDENCIAL (spec §17) ─────────────────────────────────

export type CredentialResolution =
  | { type: "native_ticket" }
  | { type: "student_identity"; student: IdentifiedStudent }
  | { type: "unknown" };

/**
 * Determina de qué tipo es un credential escaneado — por HASH exacto contra
 * cada tabla, nunca por heurística de formato de string (spec §17: "prefer
 * cryptographic/type prefixes or database resolution"). Un token de ticket y
 * uno de identidad son ambos random(32)+base64url — indistinguibles por
 * forma, por eso la resolución es siempre "probar el hash contra cada
 * dominio", nunca "adivinar por longitud/prefijo".
 */
export async function resolveScannedCredential(token: string, db?: DbHandle): Promise<CredentialResolution> {
  const conn = db ?? (await getDb());
  const tokenHash = hashTicketQrToken(token); // mismo sha256 que studentIdentityService — verificado, ambos usan sha256(token) sin sal.

  const [ticket] = await conn.select({ id: eventTickets.id }).from(eventTickets).where(eq(eventTickets.qrTokenHash, tokenHash)).limit(1);
  if (ticket) return { type: "native_ticket" };

  const student = await lookupStudentByIdentityToken(token, conn);
  if (student) return { type: "student_identity", student };

  return { type: "unknown" };
}

// ─── 2. RESOLUCIÓN DE EVENTO ACTUAL DE UN VENUE (spec §10) ──────────────────

/** Margen antes del inicio en el que la puerta ya considera "válido para esta entrada" (llegadas tempranas habituales en nightlife). */
const DOOR_OPENS_BEFORE_MINUTES = 90;
/** Si el evento no tiene endsAt, cuánto se considera "en curso" desde el inicio — ventana generosa para eventos de madrugada (23:30→05:00+) sin endsAt registrado. */
const DEFAULT_EVENT_DURATION_HOURS = 8;

export type CurrentEventResolution =
  | { status: "resolved"; event: SegolifeEvent }
  | { status: "none" }
  | { status: "ambiguous"; candidates: SegolifeEvent[] };

/**
 * "Si existe EXACTAMENTE un evento vigente para este venue, se puede asociar
 * la asistencia; si es ambiguo, nunca se adivina" (spec §10). El cruce de
 * medianoche NUNCA es el límite de negocio aquí — se compara contra la
 * ventana [startsAt - buffer, endsAt ?? startsAt + duración por defecto],
 * nunca contra "el día de calendario de hoy" (spec §21/§34 invariante 9). La
 * deduplicación real de asistencia no depende de esta función — depende del
 * idempotencyKey anclado al eventId ya resuelto (ver ingestAttendance) — esta
 * función solo decide A QUÉ evento pertenece un walk-in, nunca decide si ya
 * se registró.
 */
/**
 * Predicado puro (spec §21/§30, invariante 9) — ¿este evento está "en
 * curso" en el instante `at`? Compara contra la ventana real del evento
 * [startsAt - margen de apertura, endsAt ?? startsAt + duración por
 * defecto], NUNCA contra el día de calendario — así un evento 23:30→05:00
 * se evalúa igual a las 23:45 que a las 00:15, sin que el cruce de
 * medianoche lo parta en dos.
 */
export function isEventCurrentlyOpen(event: Pick<SegolifeEvent, "startsAt" | "endsAt">, at: Date): boolean {
  const doorOpensAt = new Date(event.startsAt.getTime() - DOOR_OPENS_BEFORE_MINUTES * 60 * 1000);
  const effectiveEnd = event.endsAt ?? new Date(event.startsAt.getTime() + DEFAULT_EVENT_DURATION_HOURS * 60 * 60 * 1000);
  return doorOpensAt <= at && at <= effectiveEnd;
}

/** Disambiguación pura (spec §10) — 0 eventos vigentes: "none"; exactamente 1: resuelto; 2+: nunca se adivina, "ambiguous". */
export function pickCurrentEvent<T extends Pick<SegolifeEvent, "startsAt" | "endsAt">>(candidates: T[], at: Date): { status: "none" } | { status: "resolved"; event: T } | { status: "ambiguous"; candidates: T[] } {
  const reallyCurrent = candidates.filter(e => isEventCurrentlyOpen(e, at));
  if (reallyCurrent.length === 0) return { status: "none" };
  if (reallyCurrent.length === 1) return { status: "resolved", event: reallyCurrent[0] };
  return { status: "ambiguous", candidates: reallyCurrent };
}

export async function resolveCurrentEventForVenue(venueId: number, at: Date, db?: DbHandle): Promise<CurrentEventResolution> {
  const conn = db ?? (await getDb());

  // Pre-filtro SQL amplio, solo para evitar un table scan — la ventana real
  // y exacta (puerta abierta / evento en curso) la aplica pickCurrentEvent
  // en memoria. 36h de margen a cada lado cubre con holgura cualquier
  // evento nightlife real.
  const wideWindowStart = new Date(at.getTime() - 36 * 60 * 60 * 1000);
  const wideWindowEnd = new Date(at.getTime() + 36 * 60 * 60 * 1000);

  const candidates = await conn.select().from(events).where(and(
    eq(events.venueId, venueId),
    eq(events.status, "active"),
    gte(events.startsAt, wideWindowStart),
    lte(events.startsAt, wideWindowEnd),
  ));

  return pickCurrentEvent(candidates, at);
}

// ─── 3. CHECK-IN DE IDENTIDAD SIN ENTRADA PREVIA (spec §10) ─────────────────

export class UnifiedCheckinError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "UnifiedCheckinError";
  }
}

export interface CheckInStudentIdentityInput {
  token: string;
  venueId: number;
  /** Si el staff ya eligió un evento concreto (p. ej. tras un estado "ambiguous") — se usa tal cual, sin volver a resolver. */
  eventId?: number;
  staffAuthorizedVenueIds: number[] | "all";
}

export type CheckInStudentIdentityResult =
  | { status: "checked_in"; studentName: string; event: SegolifeEvent | null }
  | { status: "already_checked_in"; studentName: string; event: SegolifeEvent | null }
  | { status: "visit_recorded"; studentName: string; event: null }
  | { status: "visit_already_recorded"; studentName: string; event: null }
  | { status: "event_resolution_required"; studentName: string; candidates: SegolifeEvent[] };

/**
 * Flujo NUEVO — Student sin ticket (spec §10). Nunca toca event_tickets.
 * Autoriza venue ANTES de revelar nada (mismo orden que Benefits/Tickets),
 * resuelve el evento vigente (o usa el explícito si el staff ya lo eligió).
 * Con evento resuelto → event_attendance vía ingestAttendance() (nunca
 * earnTokens directo). SIN evento vigente (spec §10/§34 VENUE & PARTNER
 * APP: "create/use Venue Visit if the new canonical model supports it") →
 * venue_visits vía recordVenueVisit(), el hecho canónico hermano — ya no se
 * rechaza con NO_CURRENT_EVENT, cierra la limitación documentada en Fase 4.
 */
export async function checkInStudentIdentity(input: CheckInStudentIdentityInput, db?: DbHandle): Promise<CheckInStudentIdentityResult> {
  const conn = db ?? (await getDb());

  const staffAuthorized = input.staffAuthorizedVenueIds === "all" || input.staffAuthorizedVenueIds.includes(input.venueId);
  if (!staffAuthorized) throw new UnifiedCheckinError("UNAUTHORIZED_STAFF", "No tienes autorización para operar en este venue");

  const student = await lookupStudentByIdentityToken(input.token, conn);
  if (!student) throw new UnifiedCheckinError("NOT_FOUND", "Código no válido");

  const now = new Date();
  let event: SegolifeEvent | null = null;

  if (input.eventId != null) {
    const [explicit] = await conn.select().from(events).where(and(eq(events.id, input.eventId), eq(events.venueId, input.venueId))).limit(1);
    if (!explicit) throw new UnifiedCheckinError("WRONG_VENUE", "El evento indicado no pertenece a este venue");
    event = explicit;
  } else {
    const resolution = await resolveCurrentEventForVenue(input.venueId, now, conn);
    if (resolution.status === "ambiguous") {
      return { status: "event_resolution_required", studentName: student.name, candidates: resolution.candidates };
    }
    if (resolution.status === "resolved") event = resolution.event;
    // status "none": sin evento vigente en este venue ahora mismo — cae al
    // flujo de venue_visits más abajo, no es un error.
  }

  if (!event) {
    const visitResult = await recordVenueVisit({
      userId: student.userId,
      venueId: input.venueId,
      occurredAt: now,
      source: "segolife_identity",
    }, conn);
    // eslint-disable-next-line no-console
    console.log(`[checkin.success] method=identity_visit userId=${student.userId} venueId=${input.venueId} status=${visitResult.status}`);
    return {
      status: visitResult.status === "already_recorded" ? "visit_already_recorded" : "visit_recorded",
      studentName: student.name,
      event: null,
    };
  }

  const result = await ingestAttendance({
    provider: "segolife",
    eventId: event.id,
    venueId: input.venueId,
    communityId: null,
    ticketId: null,
    resolvedUserId: student.userId,
    attendance: {
      externalAttendanceId: `identity_checkin:${event.id}:${student.userId}`,
      externalEventId: String(event.id),
      externalTicketId: null,
      participant: { email: null, phone: null, name: null },
      occurredAt: now,
    },
  }, conn);

  // No emite "ticket_checked_in" (spec engagementEvents.ts exige ticketId:
  // number — este flujo, por definición, no tiene ticket). Log estructurado
  // en su lugar (spec §34) — nunca el token crudo, solo el resultado.
  // eslint-disable-next-line no-console
  console.log(`[checkin.success] method=identity userId=${student.userId} eventId=${event.id} venueId=${input.venueId} status=${result.status}`);

  return {
    status: result.status === "already_processed" ? "already_checked_in" : "checked_in",
    studentName: student.name,
    event,
  };
}

// ─── 4. VINCULACIÓN EN DOS ESCANEOS — ticket sin comprador identificado (spec §9) ──

export interface LinkTicketToIdentityInput {
  ticketId: number;
  identityToken: string;
  staffUserId: number;
  staffAuthorizedVenueIds: number[] | "all";
}

/**
 * Fallback de DOS escaneos (spec §9) — únicamente para el caso real ya
 * existente de un event_ticket con userId=null (nativeCheckinService.ts ya
 * rechazaba esto con NO_OWNER; ahora, en vez de un callejón sin salida, se
 * ofrece vincular con el QR permanente del Student). Vincula
 * event_tickets.userId de forma persistente (spec §8: "persist linkage once
 * safe relationship has been established") y a continuación reutiliza
 * checkInTicketById — el MISMO backend de validación que el escaneo normal,
 * nunca un atajo que se salte las comprobaciones de estado/venue.
 */
export async function linkTicketToIdentityAndCheckIn(input: LinkTicketToIdentityInput, db?: DbHandle): Promise<CheckInTicketResult> {
  const conn = db ?? (await getDb());

  const [ticket] = await conn.select().from(eventTickets).where(eq(eventTickets.id, input.ticketId)).limit(1);
  if (!ticket) throw new CheckinError("NOT_FOUND", "Entrada no encontrada");
  if (ticket.userId != null) throw new CheckinError("ALREADY_LINKED", "Esta entrada ya tiene un Student identificado");

  // Autorización de venue ANTES de mutar nada (mismo orden que
  // performCheckIn) — sin esto, un staff no autorizado podría vincular una
  // identidad a un ticket de otro venue aunque el check-in posterior lo
  // rechace; la escritura en sí ya sería un IDOR.
  const [event] = await conn.select({ venueId: events.venueId }).from(events).where(eq(events.id, ticket.eventId)).limit(1);
  if (!event) throw new CheckinError("NOT_FOUND", "Evento no encontrado");
  const staffAuthorized = input.staffAuthorizedVenueIds === "all"
    || (event.venueId != null && input.staffAuthorizedVenueIds.includes(event.venueId));
  if (!staffAuthorized) throw new CheckinError("UNAUTHORIZED_STAFF", "No tienes autorización para validar entradas de este evento");

  const student = await lookupStudentByIdentityToken(input.identityToken, conn);
  if (!student) throw new UnifiedCheckinError("NOT_FOUND", "Código de identidad no válido");

  await conn.update(eventTickets).set({ userId: student.userId }).where(and(eq(eventTickets.id, input.ticketId), isNull(eventTickets.userId)));

  return checkInTicketById({ ticketId: input.ticketId, staffUserId: input.staffUserId, staffAuthorizedVenueIds: input.staffAuthorizedVenueIds }, conn);
}

export type { IdentifiedStudent };
export { checkInTicket, checkInTicketById };
