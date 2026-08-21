/**
 * lostFoundDb.ts — LNF-01, Lost & Found / Objetos perdidos.
 *
 * Auditado antes de crearse: NO reutiliza community_student_proposals
 * (Comunity es encuestas/ideas, dominio distinto) ni crea mensajería
 * propia — cada caso enlaza a `conversations` (COM-01) vía
 * `conversationId` (denormalizado, para listar sin N+1) + el par real
 * `contextType='lost_found'`/`contextId=report.id` en la propia fila de
 * `conversations`. El primer mensaje de esa conversación ES la
 * descripción del Student (nunca un mensaje vacío/artificial) —
 * `insertConversationAndFirstMessage` se llama DENTRO de la misma
 * transacción que crea el caso (atomicidad real: o se crean ambos, o
 * ninguno — nunca un caso "huérfano" sin conversación por un fallo a
 * medias).
 *
 * Alcance por venue vía `venue_staff` (mismo criterio que Commerce/
 * Benefits/Stock/Cash — ver venueStaffAccess.ts), NUNCA `students.manage`
 * ni acceso genérico al CRM Student: el detalle admin solo expone
 * name/email/phone mínimos, vía un SELECT directo a `users`, nunca la
 * agregación completa de Student 360.
 */
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  lostFoundReports, lostFoundCaseActions, conversations, users, venues, communities,
  type LostFoundReport, type LostFoundCaseAction,
} from "../../../drizzle/schema";
import { insertConversationAndFirstMessage, type TxHandle } from "../messaging/studentMessagesDb";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type LostFoundStatus = "open" | "found" | "closed_not_found";

export type LostFoundErrorCode = "NOT_FOUND" | "VALIDATION" | "INVALID_TRANSITION";
export class LostFoundError extends Error {
  constructor(public code: LostFoundErrorCode, message: string) {
    super(message);
    this.name = "LostFoundError";
  }
}

const LOST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const APPROX_TIME_RE = /^\d{2}:\d{2}$/;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const RESOLUTION_NOTE_MAX_LENGTH = 1000;

/** YYYY-MM-DD en Europe/Madrid — nunca UTC (la fecha del servidor puede ir un día por delante/detrás cerca de medianoche). */
export function todayInMadrid(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export interface CreateLostFoundReportInput {
  studentUserId: number;
  venueId: number;
  communityId: number | null;
  lostDate: string;
  approximateTime: string | null;
  description: string;
  imageStorageKey: string | null;
  /** Nombre del venue, solo para componer el asunto de la conversación inicial — nunca persistido en lost_found_reports (se resuelve por join al leer). */
  venueName: string;
}

function assertValidLostFoundInput(input: Pick<CreateLostFoundReportInput, "lostDate" | "approximateTime" | "description">): string {
  if (!LOST_DATE_RE.test(input.lostDate)) throw new LostFoundError("VALIDATION", "La fecha de la pérdida no es válida");
  if (input.lostDate > todayInMadrid()) throw new LostFoundError("VALIDATION", "La fecha de la pérdida no puede ser futura");
  if (input.approximateTime && !APPROX_TIME_RE.test(input.approximateTime)) throw new LostFoundError("VALIDATION", "La hora aproximada no es válida");
  const description = input.description.trim();
  if (!description) throw new LostFoundError("VALIDATION", "La descripción no puede estar vacía");
  if (description.length > DESCRIPTION_MAX_LENGTH) throw new LostFoundError("VALIDATION", `La descripción supera el máximo de ${DESCRIPTION_MAX_LENGTH} caracteres`);
  return description;
}

/**
 * Crea el caso Y su conversación inicial en UNA transacción atómica — el
 * primer mensaje de esa conversación es la propia descripción del Student
 * (senderRole="student", spec LNF-01 §10/§2: "no chat paralelo", reutiliza
 * COM-01 tal cual en vez de una tabla lost_item_messages nueva).
 */
export async function createLostFoundReport(input: CreateLostFoundReportInput, db?: DbHandle): Promise<LostFoundReport> {
  const conn = db ?? (await getDb());
  const description = assertValidLostFoundInput(input);

  return conn.transaction(async (tx) => {
    const [result] = await tx.insert(lostFoundReports).values({
      studentUserId: input.studentUserId,
      venueId: input.venueId,
      communityId: input.communityId,
      lostDate: input.lostDate,
      approximateTime: input.approximateTime,
      description,
      imageStorageKey: input.imageStorageKey,
      status: "open",
    });
    const reportId = (result as unknown as { insertId: number }).insertId;

    const { conversation } = await insertConversationAndFirstMessage({
      studentUserId: input.studentUserId,
      createdByUserId: input.studentUserId,
      subject: `Objeto perdido — ${input.venueName}`,
      body: description,
      type: "lost_found",
      contextType: "lost_found",
      contextId: reportId,
      initialSenderRole: "student",
    }, tx);

    await tx.update(lostFoundReports).set({ conversationId: conversation.id }).where(eq(lostFoundReports.id, reportId));

    const [report] = await tx.select().from(lostFoundReports).where(eq(lostFoundReports.id, reportId)).limit(1);
    return report;
  });
}

async function fetchOwnedReport(reportId: number, studentUserId: number, conn: AnyDbHandle): Promise<LostFoundReport> {
  const [report] = await conn.select().from(lostFoundReports).where(eq(lostFoundReports.id, reportId)).limit(1);
  if (!report || report.studentUserId !== studentUserId) throw new LostFoundError("NOT_FOUND", "Objeto perdido no encontrado");
  return report;
}

async function fetchReport(reportId: number, conn: AnyDbHandle): Promise<LostFoundReport> {
  const [report] = await conn.select().from(lostFoundReports).where(eq(lostFoundReports.id, reportId)).limit(1);
  if (!report) throw new LostFoundError("NOT_FOUND", "Objeto perdido no encontrado");
  return report;
}

/** Comprobación barata (spec §14, IDOR): consultada por el router ANTES de decidir si autoriza, sin traer el resto de campos. */
export async function getLostFoundReportVenueId(reportId: number, db?: DbHandle): Promise<number | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select({ venueId: lostFoundReports.venueId }).from(lostFoundReports).where(eq(lostFoundReports.id, reportId)).limit(1);
  return row?.venueId ?? null;
}

export interface LostFoundListItem extends LostFoundReport {
  venueName: string | null;
  unread: boolean;
}

export async function getLostFoundReportForStudent(reportId: number, studentUserId: number, db?: DbHandle): Promise<LostFoundListItem> {
  const conn = db ?? (await getDb());
  const report = await fetchOwnedReport(reportId, studentUserId, conn);
  return enrichForStudent(report, conn);
}

async function enrichForStudent(report: LostFoundReport, conn: AnyDbHandle): Promise<LostFoundListItem> {
  const [venueRow] = await conn.select({ name: venues.name }).from(venues).where(eq(venues.id, report.venueId)).limit(1);
  let unread = false;
  if (report.conversationId) {
    const [conv] = await conn.select({ lastMessageAt: conversations.lastMessageAt, studentLastReadAt: conversations.studentLastReadAt })
      .from(conversations).where(eq(conversations.id, report.conversationId)).limit(1);
    unread = !!conv?.lastMessageAt && (!conv.studentLastReadAt || conv.lastMessageAt > conv.studentLastReadAt);
  }
  return { ...report, venueName: venueRow?.name ?? null, unread };
}

export async function listLostFoundReportsForStudent(
  studentUserId: number,
  opts: { limit?: number; offset?: number } = {},
  db?: DbHandle
): Promise<{ items: LostFoundListItem[]; total: number }> {
  const conn = db ?? (await getDb());
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;

  const rows = await conn.select({
    report: lostFoundReports,
    venueName: venues.name,
    convLastMessageAt: conversations.lastMessageAt,
    convStudentLastReadAt: conversations.studentLastReadAt,
  }).from(lostFoundReports)
    .leftJoin(venues, eq(venues.id, lostFoundReports.venueId))
    .leftJoin(conversations, eq(conversations.id, lostFoundReports.conversationId))
    .where(eq(lostFoundReports.studentUserId, studentUserId))
    .orderBy(desc(lostFoundReports.createdAt))
    .limit(limit).offset(offset);

  const [{ count }] = await conn.select({ count: sql<number>`count(*)` }).from(lostFoundReports).where(eq(lostFoundReports.studentUserId, studentUserId));

  const items = rows.map(r => ({
    ...r.report,
    venueName: r.venueName,
    unread: !!r.convLastMessageAt && (!r.convStudentLastReadAt || r.convLastMessageAt > r.convStudentLastReadAt),
  }));
  return { items, total: Number(count) };
}

export interface AdminLostFoundListItem extends LostFoundReport {
  venueName: string | null;
  studentName: string | null;
  studentEmail: string | null;
  unread: boolean;
}

export interface AdminLostFoundFilters {
  /** "all" = admin global (getVenueStaffAccess); number[] = solo esos venues (venue_admin, ya resueltos por el router) — [] real = sin venues asignados, nunca "todos" por omisión. */
  venueIds: "all" | number[];
  communityId?: number;
  status?: LostFoundStatus;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export async function listLostFoundReportsForAdmin(filters: AdminLostFoundFilters, db?: DbHandle): Promise<{ items: AdminLostFoundListItem[]; total: number }> {
  const conn = db ?? (await getDb());
  if (filters.venueIds !== "all" && filters.venueIds.length === 0) return { items: [], total: 0 };
  const limit = Math.min(filters.limit ?? 50, 100);
  const offset = filters.offset ?? 0;

  const conditions = [];
  if (filters.venueIds !== "all") conditions.push(inArray(lostFoundReports.venueId, filters.venueIds));
  if (filters.communityId) conditions.push(eq(lostFoundReports.communityId, filters.communityId));
  if (filters.status) conditions.push(eq(lostFoundReports.status, filters.status));
  if (filters.dateFrom) conditions.push(sql`${lostFoundReports.lostDate} >= ${filters.dateFrom}`);
  if (filters.dateTo) conditions.push(sql`${lostFoundReports.lostDate} <= ${filters.dateTo}`);
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(sql`(${users.name} LIKE ${term} OR ${users.email} LIKE ${term} OR ${lostFoundReports.description} LIKE ${term})`);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const baseQuery = conn.select({
    report: lostFoundReports,
    venueName: venues.name,
    studentName: users.name,
    studentEmail: users.email,
    convLastMessageAt: conversations.lastMessageAt,
    convAdminLastReadAt: conversations.adminLastReadAt,
  }).from(lostFoundReports)
    .leftJoin(venues, eq(venues.id, lostFoundReports.venueId))
    .innerJoin(users, eq(users.id, lostFoundReports.studentUserId))
    .leftJoin(conversations, eq(conversations.id, lostFoundReports.conversationId));

  const rows = await (where ? baseQuery.where(where) : baseQuery)
    .orderBy(desc(lostFoundReports.createdAt))
    .limit(limit).offset(offset);

  const countQuery = conn.select({ count: sql<number>`count(*)` }).from(lostFoundReports).innerJoin(users, eq(users.id, lostFoundReports.studentUserId));
  const [{ count }] = await (where ? countQuery.where(where) : countQuery);

  const items = rows.map(r => ({
    ...r.report,
    venueName: r.venueName,
    studentName: r.studentName,
    studentEmail: r.studentEmail,
    unread: !!r.convLastMessageAt && (!r.convAdminLastReadAt || r.convLastMessageAt > r.convAdminLastReadAt),
  }));
  return { items, total: Number(count) };
}

export interface AdminLostFoundDetail {
  report: LostFoundReport;
  venueName: string | null;
  communityName: string | null;
  student: { id: number; name: string | null; email: string | null; phone: string | null };
}

/**
 * Solo expone name/email/phone del Student — un SELECT directo a `users`,
 * NUNCA la agregación de Student 360 (spec §15: venue_admin no debe ver
 * el CRM completo por el simple hecho de gestionar Lost & Found).
 */
export async function getLostFoundReportForAdmin(reportId: number, db?: DbHandle): Promise<AdminLostFoundDetail> {
  const conn = db ?? (await getDb());
  const report = await fetchReport(reportId, conn);
  const [venueRow] = await conn.select({ name: venues.name }).from(venues).where(eq(venues.id, report.venueId)).limit(1);
  const communityRow = report.communityId
    ? (await conn.select({ name: communities.name }).from(communities).where(eq(communities.id, report.communityId)).limit(1))[0]
    : undefined;
  const [studentRow] = await conn.select({ id: users.id, name: users.name, email: users.email, phone: users.phone })
    .from(users).where(eq(users.id, report.studentUserId)).limit(1);
  return {
    report,
    venueName: venueRow?.name ?? null,
    communityName: communityRow?.name ?? null,
    student: studentRow ?? { id: report.studentUserId, name: null, email: null, phone: null },
  };
}

const VALID_TRANSITIONS: Record<LostFoundStatus, LostFoundStatus[]> = {
  open: ["found", "closed_not_found"],
  found: ["open"],
  closed_not_found: ["open"],
};

/**
 * `for("update")` (bloqueo de fila real): dos admins abriendo el mismo
 * caso y transicionando casi a la vez (spec §26) — la segunda transacción
 * espera a que la primera confirme antes de leer, así que SIEMPRE ve el
 * status ya actualizado, nunca una condición de carrera de "leer viejo,
 * escribir encima".
 */
async function transitionStatus(
  reportId: number,
  actorUserId: number,
  toStatus: LostFoundStatus,
  action: string,
  reason: string,
  tx: TxHandle
): Promise<LostFoundReport> {
  const [report] = await tx.select().from(lostFoundReports).where(eq(lostFoundReports.id, reportId)).limit(1).for("update");
  if (!report) throw new LostFoundError("NOT_FOUND", "Objeto perdido no encontrado");
  if (!VALID_TRANSITIONS[report.status as LostFoundStatus].includes(toStatus)) {
    throw new LostFoundError("INVALID_TRANSITION", `No se puede pasar de "${report.status}" a "${toStatus}"`);
  }

  const now = new Date();
  const isResolution = toStatus === "found" || toStatus === "closed_not_found";
  await tx.update(lostFoundReports).set({
    status: toStatus,
    resolvedAt: isResolution ? now : null,
    resolvedByUserId: isResolution ? actorUserId : null,
    // Un reopen NUNCA borra la última nota de resolución real — queda como
    // histórico de "qué se dijo la última vez"; el motivo del propio reopen
    // vive en lost_found_case_actions.reason, no aquí.
    resolutionNote: isResolution ? reason : report.resolutionNote,
  }).where(eq(lostFoundReports.id, reportId));

  await tx.insert(lostFoundCaseActions).values({
    reportId, actorUserId, action, beforeValue: report.status, afterValue: toStatus, reason,
  });

  const [updated] = await tx.select().from(lostFoundReports).where(eq(lostFoundReports.id, reportId)).limit(1);
  return updated;
}

function assertValidResolutionNote(note: string): string {
  const trimmed = note.trim();
  if (!trimmed) throw new LostFoundError("VALIDATION", "La nota de resolución no puede estar vacía");
  if (trimmed.length > RESOLUTION_NOTE_MAX_LENGTH) throw new LostFoundError("VALIDATION", `La nota supera el máximo de ${RESOLUTION_NOTE_MAX_LENGTH} caracteres`);
  return trimmed;
}

export async function markFound(reportId: number, actorUserId: number, resolutionNote: string, db?: DbHandle): Promise<LostFoundReport> {
  const conn = db ?? (await getDb());
  const trimmed = assertValidResolutionNote(resolutionNote);
  return conn.transaction(tx => transitionStatus(reportId, actorUserId, "found", "marked_found", trimmed, tx));
}

export async function markClosedNotFound(reportId: number, actorUserId: number, resolutionNote: string, db?: DbHandle): Promise<LostFoundReport> {
  const conn = db ?? (await getDb());
  const trimmed = assertValidResolutionNote(resolutionNote);
  return conn.transaction(tx => transitionStatus(reportId, actorUserId, "closed_not_found", "marked_closed_not_found", trimmed, tx));
}

export async function reopenReport(reportId: number, actorUserId: number, reason: string, db?: DbHandle): Promise<LostFoundReport> {
  const conn = db ?? (await getDb());
  const trimmed = reason.trim();
  if (!trimmed) throw new LostFoundError("VALIDATION", "El motivo de reapertura no puede estar vacío");
  return conn.transaction(tx => transitionStatus(reportId, actorUserId, "open", "reopened", trimmed, tx));
}

export async function listCaseActions(reportId: number, db?: DbHandle): Promise<LostFoundCaseAction[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(lostFoundCaseActions).where(eq(lostFoundCaseActions.reportId, reportId)).orderBy(desc(lostFoundCaseActions.id));
}

/**
 * Badge de nav (spec §13/§14, mismo criterio que countAwaitingAdmin de
 * COM-01) — "pendiente" es un caso todavía abierto (nunca resuelto) O uno
 * con respuesta del Student sin leer, scoped al alcance real del actor
 * (venueIds="all" para admin global, number[] ya resuelto por el router
 * para venue_admin — [] real es 0, nunca "todos" por omisión).
 */
export async function countPendingForAdmin(venueIds: "all" | number[], db?: DbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  if (venueIds !== "all" && venueIds.length === 0) return 0;

  const conditions = [
    sql`(${lostFoundReports.status} = 'open' OR (${conversations.lastMessageAt} IS NOT NULL AND (${conversations.adminLastReadAt} IS NULL OR ${conversations.lastMessageAt} > ${conversations.adminLastReadAt})))`,
  ];
  if (venueIds !== "all") conditions.push(inArray(lostFoundReports.venueId, venueIds));

  const [{ count }] = await conn.select({ count: sql<number>`count(*)` })
    .from(lostFoundReports)
    .leftJoin(conversations, eq(conversations.id, lostFoundReports.conversationId))
    .where(and(...conditions));
  return Number(count);
}
