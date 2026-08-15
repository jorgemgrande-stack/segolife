/**
 * nativeCheckinService.ts — check-in de un event_ticket NATIVO por parte
 * del STAFF (Fase 8, spec puntos 11-14; búsqueda manual añadida en SEGOLIFE
 * — Native Ticket Sales, spec §27). Dominio explícitamente distinto de
 * StudentScan (Fase 3) y del scanner de Benefits (Fase 4) — NUNCA se
 * reutiliza ese QR/flujo (ver comentario de event_attendance en
 * drizzle/schema.ts, ya reservaba `provider='segolife'` para esto).
 *
 * ATÓMICO: igual que benefitRedemptionService.ts, el single-use se resuelve
 * con un UPDATE condicional (`WHERE status='issued'`, comprobando
 * affectedRows=1) — dos escaneos simultáneos del mismo ticket nunca pueden
 * ganar ambos (spec punto 12, test de concurrencia obligatorio).
 *
 * El scanner NUNCA llama a earnTokens()/evaluateBenefitsForOrigin()
 * directamente (spec punto 13) — solo a `ingestAttendance()` del pipeline
 * ya existente de Fase 5, con `resolvedUserId` porque el comprador YA es
 * conocido (event_tickets.user_id), sin heurística de email/teléfono.
 *
 * BÚSQUEDA MANUAL (spec §27): `checkInTicketById` es una segunda PUERTA DE
 * ENTRADA al MISMO código de validación que `checkInTicket` (QR) — nunca un
 * bypass "marcar asistente" que salte las comprobaciones (spec: "no crear
 * bypass que evite las protecciones del scanner"). `searchTickets` solo
 * ENCUENTRA el ticket — nunca lo valida ni lo marca como usado.
 */
import { eq, and, or, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eventTickets, events, users, type EventTicket, type SegolifeEvent } from "../../../drizzle/schema";
import { hashTicketQrToken } from "./ticketQrService";
import { ingestAttendance } from "./attendancePipeline";
import { emitEngagementEvent } from "../engagement/engagementEvents";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class CheckinError extends Error {
  /** SEGOLIFE — UNIFIED CHECK-IN (spec §9): en NO_OWNER lleva `{ ticketId }` para que la capa de arriba pueda ofrecer el fallback de dos escaneos (vincular identidad) sin tener que volver a buscar el ticket por token. Vacío/undefined para el resto de códigos — nunca ha llevado datos hasta ahora, cambio puramente aditivo. */
  constructor(public code: string, message: string, public data?: { ticketId?: number }) {
    super(message);
    this.name = "CheckinError";
  }
}

export interface CheckInTicketInput {
  token: string;
  staffUserId: number;
  /** "all" = admin global; number[] = venues concretos donde el staff tiene fila en venue_staff (ver venueStaffAccess.ts). */
  staffAuthorizedVenueIds: number[] | "all";
}

export interface CheckInTicketResult {
  ticket: EventTicket;
  event: SegolifeEvent;
  studentName: string;
}

export async function checkInTicket(input: CheckInTicketInput, db?: DbHandle): Promise<CheckInTicketResult> {
  const conn = db ?? (await getDb());
  const tokenHash = hashTicketQrToken(input.token);

  const [ticket] = await conn.select().from(eventTickets).where(eq(eventTickets.qrTokenHash, tokenHash)).limit(1);
  if (!ticket) throw new CheckinError("NOT_FOUND", "Código no válido");

  return performCheckIn(ticket, input.staffUserId, input.staffAuthorizedVenueIds, conn);
}

export interface CheckInTicketByIdInput {
  ticketId: number;
  staffUserId: number;
  staffAuthorizedVenueIds: number[] | "all";
}

/** Segunda puerta de entrada al MISMO flujo de validación (spec §27: "búsqueda manual... EXACTAMENTE el mismo backend que el QR") — para cuando el QR no carga o el estudiante no encuentra su entrada. `searchTickets` localiza el `ticketId`; esta función lo valida y lo marca usado con las mismas reglas, sin excepciones. */
export async function checkInTicketById(input: CheckInTicketByIdInput, db?: DbHandle): Promise<CheckInTicketResult> {
  const conn = db ?? (await getDb());
  const [ticket] = await conn.select().from(eventTickets).where(eq(eventTickets.id, input.ticketId)).limit(1);
  if (!ticket) throw new CheckinError("NOT_FOUND", "Entrada no encontrada");

  return performCheckIn(ticket, input.staffUserId, input.staffAuthorizedVenueIds, conn);
}

async function performCheckIn(ticket: EventTicket, _staffUserId: number, staffAuthorizedVenueIds: number[] | "all", conn: DbHandle): Promise<CheckInTicketResult> {
  if (ticket.salesChannel !== "native" || ticket.provider !== "segolife_native") {
    throw new CheckinError("NOT_NATIVE", "Este código no corresponde a una entrada nativa de Segolife");
  }

  const [event] = await conn.select().from(events).where(eq(events.id, ticket.eventId)).limit(1);
  if (!event) throw new CheckinError("NOT_FOUND", "Evento no encontrado");

  if (ticket.status === "cancelled") throw new CheckinError("CANCELLED", "Esta entrada ha sido cancelada");
  if (ticket.status === "refunded") throw new CheckinError("REFUNDED", "Esta entrada ha sido reembolsada");
  if (ticket.status === "used") throw new CheckinError("ALREADY_USED", "Esta entrada ya ha sido validada");

  // Alcance del staff — ANTES de tocar la fila (mismo criterio que
  // benefitRedemptionService.ts: rechazar por falta de permiso general
  // antes de revelar/mutar nada del ticket concreto).
  const staffAuthorized = staffAuthorizedVenueIds === "all"
    || (event.venueId != null && staffAuthorizedVenueIds.includes(event.venueId));
  if (!staffAuthorized) throw new CheckinError("UNAUTHORIZED_STAFF", "No tienes autorización para validar entradas de este evento");

  if (!ticket.userId) throw new CheckinError("NO_OWNER", "Esta entrada no tiene un comprador identificado", { ticketId: ticket.id });

  const [updateResult] = await conn.update(eventTickets)
    .set({ status: "used" })
    .where(and(eq(eventTickets.id, ticket.id), eq(eventTickets.status, "issued")));
  if ((updateResult as unknown as { affectedRows: number }).affectedRows === 0) {
    throw new CheckinError("ALREADY_USED", "Esta entrada ya ha sido validada");
  }

  await ingestAttendance({
    provider: "segolife",
    eventId: ticket.eventId,
    venueId: event.venueId ?? null,
    communityId: null,
    ticketId: ticket.id,
    resolvedUserId: ticket.userId,
    attendance: {
      externalAttendanceId: `native_checkin:${ticket.id}`,
      externalEventId: String(ticket.eventId),
      externalTicketId: ticket.externalTicketId ?? null,
      participant: { email: null, phone: null, name: null },
      occurredAt: new Date(),
    },
  }, conn);

  emitEngagementEvent("ticket_checked_in", { userId: ticket.userId, communityId: null, ticketId: ticket.id, eventId: ticket.eventId, venueId: event.venueId ?? null });

  const [updatedTicket] = await conn.select().from(eventTickets).where(eq(eventTickets.id, ticket.id)).limit(1);
  const [student] = await conn.select({ name: users.name }).from(users).where(eq(users.id, ticket.userId)).limit(1);

  return { ticket: updatedTicket, event, studentName: student?.name ?? "—" };
}

export interface SearchTicketsInput {
  query: string;
  staffAuthorizedVenueIds: number[] | "all";
}

export interface TicketSearchResult {
  ticketId: number;
  eventId: number;
  eventName: string;
  studentName: string;
  status: EventTicket["status"];
}

const SEARCH_MIN_QUERY_LENGTH = 3;
const SEARCH_RESULT_LIMIT = 10;

/**
 * Búsqueda manual (spec §27) — SOLO localiza, nunca valida. Acotada a
 * entradas nativas de eventos en venues autorizados para este staff (mismo
 * alcance que el check-in real). Nombre/email vía `users`, nunca datos
 * abiertos de `event_tickets.metadata`. Longitud mínima de consulta para
 * evitar enumeración trivial (spec §37/§41).
 */
export async function searchTickets(input: SearchTicketsInput, db?: DbHandle): Promise<TicketSearchResult[]> {
  const conn = db ?? (await getDb());
  const q = input.query.trim();
  if (q.length < SEARCH_MIN_QUERY_LENGTH) return [];

  const rows = await conn.select({ ticket: eventTickets, event: events, studentName: users.name })
    .from(eventTickets)
    .innerJoin(events, eq(eventTickets.eventId, events.id))
    .innerJoin(users, eq(eventTickets.userId, users.id))
    .where(and(
      eq(eventTickets.provider, "segolife_native"),
      or(like(users.name, `%${q}%`), like(users.email, `%${q}%`))
    ))
    .limit(SEARCH_RESULT_LIMIT * 4); // sobre-pedir antes de filtrar por venue en memoria (pocas filas reales esperadas)

  const scoped = rows.filter(r => input.staffAuthorizedVenueIds === "all" || (r.event.venueId != null && input.staffAuthorizedVenueIds.includes(r.event.venueId)));

  return scoped.slice(0, SEARCH_RESULT_LIMIT).map(r => ({
    ticketId: r.ticket.id,
    eventId: r.event.id,
    eventName: r.event.name,
    studentName: r.studentName ?? "—",
    status: r.ticket.status,
  }));
}
