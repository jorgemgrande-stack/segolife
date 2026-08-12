/**
 * studentActivityAggregator.ts — Activity Aggregator de Student 360.
 *
 * Construye el timeline unificado de un estudiante fusionando fuentes ya
 * existentes (nunca duplica datos, ver docs/students/student-360-audit-and-
 * architecture.md §4). Patrón replicado de `crm.clients.getHistory`
 * (server/routers/crm.ts) — fan-out de queries en paralelo por fuente +
 * fusión/orden final, sin tabla materializada nueva (decisión justificada:
 * volumen actual de piloto, revisar solo si el profiling real muestra un
 * problema de latencia).
 *
 * Cada fuente se trae ACOTADA (SOURCE_FETCH_LIMIT por fuente) — a esta
 * escala cubre de sobra el histórico completo de un estudiante; si algún día
 * un estudiante individual supera ese volumen por fuente, la página más
 * antigua del timeline podría no reflejar el 100% de esa fuente — trade-off
 * documentado, no un bug oculto.
 */
import {
  listMyTickets,
  listAttendanceByUserId,
} from "../ticketing/ticketingDb";
import { listCommerceTransactionsByUserId } from "../commerce/commerceDb";
import { listQrRedemptionsByUser } from "../../db/consumptionQrDb";
import { listLedgerByUserId } from "../tokens/tokenLedgerService";
import { listGrantedBenefits } from "../../db/benefitsDb";
import { listStudentNotes, listStudentTagAssignmentEvents } from "../../db/studentsDb";
import { listLoginEventsByUserId } from "./studentLoginEventsDb";
import { listAdminActionsByStudentProfileId } from "./studentAdminActionsDb";
import { listResponsesByUserId } from "../community/communityResponseService";
import { listSupportsByUserId, listStudentProposalsByUserId } from "../community/communityStudentProposalDb";
import type { TimelineEventDTO, TimelineFilters, TimelineCursor, TimelinePage } from "../../../shared/segolife/student360";

const SOURCE_FETCH_LIMIT = 300;

function toIso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

/**
 * Fusión de todas las fuentes en eventos normalizados, ordenados desc por
 * fecha — sin paginar. Público a propósito: el caller (router de
 * students360) debe pedir el snapshot UNA SOLA VEZ por request y reutilizarlo
 * tanto para el timeline paginado como para el servicio de intelligence
 * (SegoScore/afinidades) — nunca dos fan-outs completos en la misma
 * respuesta (ver docs/students/student-360-audit-and-architecture.md §5).
 */
export async function getStudentActivitySnapshot(userId: number, studentProfileId: number): Promise<TimelineEventDTO[]> {
  const events = await collectAllEvents(userId, studentProfileId);
  events.sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0));
  return events;
}

async function collectAllEvents(userId: number, studentProfileId: number): Promise<TimelineEventDTO[]> {
  const [tickets, attendance, commerce, qrRedemptions, ledger, benefits, notes, tagEvents, logins, adminActions, communityResponses, communitySupports, communityStudentProposals] =
    await Promise.all([
      listMyTickets(userId),
      listAttendanceByUserId(userId),
      listCommerceTransactionsByUserId(userId),
      listQrRedemptionsByUser(userId, SOURCE_FETCH_LIMIT),
      listLedgerByUserId(userId, { limit: SOURCE_FETCH_LIMIT }),
      listGrantedBenefits({ communityIds: "all", userId, limit: SOURCE_FETCH_LIMIT }),
      listStudentNotes(studentProfileId),
      listStudentTagAssignmentEvents(studentProfileId),
      listLoginEventsByUserId(userId, SOURCE_FETCH_LIMIT),
      listAdminActionsByStudentProfileId(studentProfileId, SOURCE_FETCH_LIMIT),
      listResponsesByUserId(userId, SOURCE_FETCH_LIMIT),
      listSupportsByUserId(userId, SOURCE_FETCH_LIMIT),
      listStudentProposalsByUserId(userId, SOURCE_FETCH_LIMIT),
    ]);

  const events: TimelineEventDTO[] = [];

  // ── Tickets (compra/cancelación/reembolso) ──────────────────────────────
  for (const { ticket, event } of tickets) {
    const purchasedAt = ticket.issuedAt ?? ticket.createdAt;
    events.push({
      id: `ticket_purchase:${ticket.id}`,
      occurredAt: toIso(purchasedAt)!,
      type: "ticket_purchase",
      title: event ? `Entrada: ${event.name}` : "Compra de entrada",
      description: null,
      source: "event_tickets",
      amountCents: null,
      tokens: null,
      venueName: null,
      eventName: event?.name ?? null,
      metadata: { ticketId: ticket.id, salesChannel: ticket.salesChannel, status: ticket.status, provider: ticket.provider },
    });
    if (ticket.status === "cancelled" && ticket.cancelledAt) {
      events.push({
        id: `ticket_cancelled:${ticket.id}`,
        occurredAt: toIso(ticket.cancelledAt)!,
        type: "ticket_cancelled",
        title: event ? `Entrada cancelada: ${event.name}` : "Entrada cancelada",
        description: null,
        source: "event_tickets",
        amountCents: null,
        tokens: null,
        venueName: null,
        eventName: event?.name ?? null,
        metadata: { ticketId: ticket.id },
      });
    }
    if (ticket.status === "refunded" && ticket.refundedAt) {
      events.push({
        id: `ticket_refunded:${ticket.id}`,
        occurredAt: toIso(ticket.refundedAt)!,
        type: "ticket_refunded",
        title: event ? `Entrada reembolsada: ${event.name}` : "Entrada reembolsada",
        description: null,
        source: "event_tickets",
        amountCents: null,
        tokens: null,
        venueName: null,
        eventName: event?.name ?? null,
        metadata: { ticketId: ticket.id },
      });
    }
  }

  // ── Asistencia ───────────────────────────────────────────────────────────
  for (const { attendance: a, event, venueName } of attendance) {
    events.push({
      id: `event_attendance:${a.id}`,
      occurredAt: toIso(a.occurredAt)!,
      type: "event_attendance",
      title: event ? `Asistió a: ${event.name}` : "Asistencia registrada",
      description: null,
      source: "event_attendance",
      amountCents: null,
      tokens: null,
      venueName: venueName ?? null,
      eventName: event?.name ?? null,
      metadata: { provider: a.provider },
    });
  }

  // ── Consumo POS ──────────────────────────────────────────────────────────
  for (const { transaction, venueName } of commerce) {
    events.push({
      id: `consumption_pos:${transaction.id}`,
      occurredAt: toIso(transaction.occurredAt)!,
      type: "consumption_pos",
      title: venueName ? `Consumo en ${venueName}` : "Consumo registrado",
      description: null,
      source: "commerce_transactions",
      amountCents: transaction.totalCents,
      tokens: null,
      venueName: venueName ?? null,
      eventName: null,
      metadata: { status: transaction.status, provider: transaction.provider },
    });
  }

  // ── Consumo QR ───────────────────────────────────────────────────────────
  for (const qr of qrRedemptions) {
    events.push({
      id: `consumption_qr:${qr.id}`,
      occurredAt: toIso(qr.redeemedAt)!,
      type: "consumption_qr",
      title: qr.productName ? `Canje QR: ${qr.productName}` : `Canje QR en ${qr.venueName}`,
      description: null,
      source: "consumption_qr_codes",
      amountCents: qr.amountCents,
      tokens: null,
      venueName: qr.venueName,
      eventName: null,
      metadata: { quantity: qr.quantity },
    });
  }

  // ── SegoTokens ───────────────────────────────────────────────────────────
  for (const entry of ledger) {
    events.push({
      id: `token_ledger:${entry.id}`,
      occurredAt: toIso(entry.createdAt)!,
      type: entry.direction === "credit" ? "token_credit" : "token_debit",
      title: entry.reason,
      description: entry.sourceType === "manual_adjustment" ? "Ajuste manual de administrador" : null,
      source: "token_ledger",
      amountCents: null,
      tokens: entry.direction === "credit" ? entry.amount : -entry.amount,
      venueName: null,
      eventName: null,
      metadata: { sourceType: entry.sourceType, balanceAfter: entry.balanceAfter },
    });
  }

  // ── Benefits (grant / uso / cancelación) ───────────────────────────────
  for (const b of benefits.items) {
    events.push({
      id: `benefit_granted:${b.id}`,
      occurredAt: toIso(b.grantedAt)!,
      type: "benefit_granted",
      title: `Beneficio concedido: ${b.definitionName}`,
      description: null,
      source: "user_benefits",
      amountCents: null,
      tokens: null,
      venueName: b.sourceVenueName,
      eventName: null,
      metadata: { sourceType: b.sourceType, grantedByUserId: b.grantedByUserId },
    });
    if (b.status === "used" && b.usedAt) {
      events.push({
        id: `benefit_used:${b.id}`,
        occurredAt: toIso(b.usedAt)!,
        type: "benefit_used",
        title: `Beneficio usado: ${b.definitionName}`,
        description: null,
        source: "user_benefits",
        amountCents: null,
        tokens: null,
        venueName: b.destinationVenueName,
        eventName: null,
        metadata: {},
      });
    }
    if (b.status === "cancelled" && b.cancelledAt) {
      events.push({
        id: `benefit_cancelled:${b.id}`,
        occurredAt: toIso(b.cancelledAt)!,
        type: "benefit_cancelled",
        title: `Beneficio cancelado: ${b.definitionName}`,
        description: b.cancellationReason,
        source: "user_benefits",
        amountCents: null,
        tokens: null,
        venueName: null,
        eventName: null,
        metadata: {},
      });
    }
  }

  // ── Notas internas (solo visible en contexto admin) ────────────────────
  for (const n of notes) {
    events.push({
      id: `internal_note:${n.id}`,
      occurredAt: toIso(n.createdAt)!,
      type: "internal_note",
      title: "Nota interna añadida",
      description: n.note,
      source: "student_notes",
      amountCents: null,
      tokens: null,
      venueName: null,
      eventName: null,
      metadata: { authorUserId: n.authorUserId },
    });
  }

  // ── Etiquetas ────────────────────────────────────────────────────────────
  for (const t of tagEvents) {
    events.push({
      id: `tag_assigned:${t.tagId}:${toIso(t.assignedAt)}`,
      occurredAt: toIso(t.assignedAt)!,
      type: "tag_assigned",
      title: `Etiqueta añadida: ${t.tagName}`,
      description: null,
      source: "student_tag_assignments",
      amountCents: null,
      tokens: null,
      venueName: null,
      eventName: null,
      metadata: { assignedByUserId: t.assignedByUserId },
    });
  }

  // ── Login ────────────────────────────────────────────────────────────────
  for (const l of logins) {
    events.push({
      id: `login:${l.id}`,
      occurredAt: toIso(l.occurredAt)!,
      type: "login",
      title: "Inicio de sesión",
      description: null,
      source: "student_login_events",
      amountCents: null,
      tokens: null,
      venueName: null,
      eventName: null,
      metadata: { method: l.method },
    });
  }

  // ── Acciones administrativas ────────────────────────────────────────────
  for (const a of adminActions) {
    events.push({
      id: `admin_action:${a.id}`,
      occurredAt: toIso(a.createdAt)!,
      type: "admin_action",
      title: `Acción admin: ${a.action}`,
      description: a.reason,
      source: "student_admin_actions",
      amountCents: null,
      tokens: null,
      venueName: null,
      eventName: null,
      metadata: { actorUserId: a.actorUserId, before: a.beforeValue, after: a.afterValue },
    });
  }

  // ── COMUNITY: respuestas ────────────────────────────────────────────────
  for (const { response, proposalTitle } of communityResponses) {
    events.push({
      id: `community_response:${response.id}`,
      occurredAt: toIso(response.respondedAt)!,
      type: "community_response",
      title: `Respondió en COMUNITY: ${proposalTitle}`,
      description: null,
      source: "community_responses",
      amountCents: null,
      // El importe exacto ya aparece como su propio evento token_credit (fuente token_ledger) — no duplicar aquí (spec punto 79).
      tokens: null,
      venueName: null,
      eventName: null,
      metadata: { proposalId: response.proposalId, rewardGranted: response.rewardGranted },
    });
  }

  // ── COMUNITY: apoyos a ideas de otros estudiantes ───────────────────────
  for (const { support, proposalTitle } of communitySupports) {
    events.push({
      id: `community_support:${support.id}`,
      occurredAt: toIso(support.createdAt)!,
      type: "community_support",
      title: `Apoyó una idea: ${proposalTitle}`,
      description: null,
      source: "community_supports",
      amountCents: null,
      tokens: null,
      venueName: null,
      eventName: null,
      metadata: { studentProposalId: support.studentProposalId },
    });
  }

  // ── COMUNITY: ideas propuestas por el propio estudiante ─────────────────
  for (const p of communityStudentProposals) {
    events.push({
      id: `community_proposal_submitted:${p.id}`,
      occurredAt: toIso(p.createdAt)!,
      type: "community_proposal_submitted",
      title: `Propuso una idea: ${p.title}`,
      description: null,
      source: "community_student_proposals",
      amountCents: null,
      tokens: null,
      venueName: null,
      eventName: null,
      metadata: { status: p.status },
    });
  }

  return events;
}

function passesFilters(e: TimelineEventDTO, filters: TimelineFilters): boolean {
  if (filters.types && filters.types.length > 0 && !filters.types.includes(e.type)) return false;
  if (filters.from && e.occurredAt < filters.from) return false;
  if (filters.to && e.occurredAt > filters.to) return false;
  return true;
}

function sortKey(e: TimelineEventDTO): string {
  return `${e.occurredAt}::${e.id}`;
}

/**
 * Pagina un snapshot ya ordenado (desc) — función pura, sin I/O. `cursor=null`
 * = primera página. Cursor opaco: el cliente solo lo reenvía tal cual.
 */
export function paginateActivity(sortedEvents: TimelineEventDTO[], filters: TimelineFilters, cursor: TimelineCursor | null, limit: number): TimelinePage {
  const filtered = sortedEvents.filter(e => passesFilters(e, filters));

  let startIndex = 0;
  if (cursor) {
    const cursorKey = `${cursor.occurredAt}::${cursor.id}`;
    startIndex = filtered.findIndex(e => sortKey(e) < cursorKey);
    if (startIndex === -1) startIndex = filtered.length;
  }

  const page = filtered.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < filtered.length;
  const last = page[page.length - 1];
  const nextCursor: TimelineCursor | null = hasMore && last ? { occurredAt: last.occurredAt, id: last.id } : null;

  return { items: page, nextCursor };
}

/** Conveniencia para el endpoint perezoso de la pestaña Actividad — un fetch + paginar en una llamada. */
export async function getStudentActivity(
  userId: number,
  studentProfileId: number,
  filters: TimelineFilters,
  cursor: TimelineCursor | null,
  limit: number
): Promise<TimelinePage> {
  const snapshot = await getStudentActivitySnapshot(userId, studentProfileId);
  return paginateActivity(snapshot, filters, cursor, limit);
}

/** Última fecha de actividad real (RECENCY del SegoScore) — MAX(occurredAt), función pura sobre un snapshot ya obtenido. */
export function deriveLastActivityAt(sortedEvents: TimelineEventDTO[]): string | null {
  return sortedEvents.length > 0 ? sortedEvents[0].occurredAt : null;
}

const BUSINESS_ACTIVITY_TYPES = new Set([
  "ticket_purchase", "event_attendance", "consumption_pos", "consumption_qr", "token_credit", "token_debit", "benefit_used",
]);

/** Conteo de eventos de actividad "de negocio" (excluye notas/tags/login/admin_action) en una ventana — fuente de FREQUENCY del SegoScore. Función pura. */
export function deriveActivityCountInWindow(sortedEvents: TimelineEventDTO[], sinceIso: string): number {
  return sortedEvents.filter(e => BUSINESS_ACTIVITY_TYPES.has(e.type) && e.occurredAt >= sinceIso).length;
}
