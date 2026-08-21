/**
 * studentMessagesDb.ts — COM-01, infraestructura canónica de conversación
 * bidireccional Admin↔Student. Ver drizzle/schema.ts (comentario junto a
 * `conversations`) para el razonamiento de modelo de datos completo.
 *
 * NUNCA duplica `sendManualMessage` (server/routers/engagement.ts) — ese
 * sigue existiendo como aviso unidireccional fire-and-forget; este módulo
 * es el sistema con histórico persistente y respuesta real, y solo crea una
 * `notification` (aviso) al enviar el primer mensaje o una respuesta de
 * Admin — nunca almacena el cuerpo de la conversación en `notifications`.
 *
 * IDOR (spec §19, CRÍTICO): toda función Student-facing recibe
 * `studentUserId` y comprueba la propiedad DENTRO de esta capa — nunca
 * confía en que el router ya lo validó. Un Student jamás ve una conversación
 * ajena ni un mensaje `visibility='internal'`.
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  conversations, conversationMessages, users,
  type Conversation, type ConversationMessage,
} from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type StudentMessagesErrorCode = "NOT_FOUND" | "CONVERSATION_CLOSED" | "VALIDATION";
export class StudentMessagesError extends Error {
  constructor(public code: StudentMessagesErrorCode, message: string) {
    super(message);
    this.name = "StudentMessagesError";
  }
}

export const MESSAGE_BODY_MAX_LENGTH = 5000;
export const SUBJECT_MAX_LENGTH = 256;
const LAST_MESSAGE_PREVIEW_LENGTH = 160;

export function preview(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > LAST_MESSAGE_PREVIEW_LENGTH ? `${trimmed.slice(0, LAST_MESSAGE_PREVIEW_LENGTH - 1)}…` : trimmed;
}

export function assertValidBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new StudentMessagesError("VALIDATION", "El mensaje no puede estar vacío");
  if (trimmed.length > MESSAGE_BODY_MAX_LENGTH) throw new StudentMessagesError("VALIDATION", `El mensaje supera el máximo de ${MESSAGE_BODY_MAX_LENGTH} caracteres`);
  return trimmed;
}

export interface CreateConversationInput {
  studentUserId: number;
  createdByUserId: number;
  subject: string;
  body: string;
  type?: string;
  contextType?: string | null;
  contextId?: number | null;
}

export async function createConversation(input: CreateConversationInput, db?: DbHandle): Promise<{ conversation: Conversation; message: ConversationMessage }> {
  const conn = db ?? (await getDb());
  const subject = input.subject.trim();
  if (!subject) throw new StudentMessagesError("VALIDATION", "El asunto no puede estar vacío");
  if (subject.length > SUBJECT_MAX_LENGTH) throw new StudentMessagesError("VALIDATION", `El asunto supera el máximo de ${SUBJECT_MAX_LENGTH} caracteres`);
  const body = assertValidBody(input.body);
  const now = new Date();

  return conn.transaction(async (tx) => {
    const [convResult] = await tx.insert(conversations).values({
      studentUserId: input.studentUserId,
      type: input.type ?? "general",
      contextType: input.contextType ?? null,
      contextId: input.contextId ?? null,
      subject,
      status: "open",
      waitingFor: "student",
      createdByUserId: input.createdByUserId,
      lastMessageAt: now,
      lastMessagePreview: preview(body),
      adminLastReadAt: now, // el propio Admin que escribe ya "ha leído" su propio mensaje inicial
    });
    const conversationId = (convResult as unknown as { insertId: number }).insertId;

    const [msgResult] = await tx.insert(conversationMessages).values({
      conversationId,
      senderUserId: input.createdByUserId,
      senderRole: "admin",
      visibility: "public",
      body,
    });
    const messageId = (msgResult as unknown as { insertId: number }).insertId;

    const [conversation] = await tx.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    const [message] = await tx.select().from(conversationMessages).where(eq(conversationMessages.id, messageId)).limit(1);
    return { conversation, message };
  });
}

async function fetchOwnedConversation(conversationId: number, studentUserId: number, conn: AnyDbHandle): Promise<Conversation> {
  const [conversation] = await conn.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation || conversation.studentUserId !== studentUserId) {
    throw new StudentMessagesError("NOT_FOUND", "Conversación no encontrada");
  }
  return conversation;
}

async function fetchConversation(conversationId: number, conn: AnyDbHandle): Promise<Conversation> {
  const [conversation] = await conn.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation) throw new StudentMessagesError("NOT_FOUND", "Conversación no encontrada");
  return conversation;
}

export async function replyAsStudent(input: { conversationId: number; studentUserId: number; body: string }, db?: DbHandle): Promise<{ conversation: Conversation; message: ConversationMessage }> {
  const conn = db ?? (await getDb());
  const body = assertValidBody(input.body);

  return conn.transaction(async (tx) => {
    const conversation = await fetchOwnedConversation(input.conversationId, input.studentUserId, tx);
    if (conversation.status === "closed") throw new StudentMessagesError("CONVERSATION_CLOSED", "Esta conversación está cerrada");

    const now = new Date();
    const [msgResult] = await tx.insert(conversationMessages).values({
      conversationId: conversation.id,
      senderUserId: input.studentUserId,
      senderRole: "student",
      visibility: "public",
      body,
    });
    const messageId = (msgResult as unknown as { insertId: number }).insertId;

    await tx.update(conversations).set({
      waitingFor: "admin",
      lastMessageAt: now,
      lastMessagePreview: preview(body),
      studentLastReadAt: now, // el propio Student ya ha "leído" su propio mensaje
    }).where(eq(conversations.id, conversation.id));

    const [updated] = await tx.select().from(conversations).where(eq(conversations.id, conversation.id)).limit(1);
    const [message] = await tx.select().from(conversationMessages).where(eq(conversationMessages.id, messageId)).limit(1);
    return { conversation: updated, message };
  });
}

export async function replyAsAdmin(input: { conversationId: number; adminUserId: number; body: string; visibility?: "public" | "internal" }, db?: DbHandle): Promise<{ conversation: Conversation; message: ConversationMessage }> {
  const conn = db ?? (await getDb());
  const body = assertValidBody(input.body);
  const visibility = input.visibility ?? "public";

  return conn.transaction(async (tx) => {
    const conversation = await fetchConversation(input.conversationId, tx);
    if (conversation.status === "closed") throw new StudentMessagesError("CONVERSATION_CLOSED", "Esta conversación está cerrada — reábrela antes de responder");

    const now = new Date();
    const [msgResult] = await tx.insert(conversationMessages).values({
      conversationId: conversation.id,
      senderUserId: input.adminUserId,
      senderRole: "admin",
      visibility,
      body,
    });
    const messageId = (msgResult as unknown as { insertId: number }).insertId;

    // Una nota interna nunca es "la última actividad visible" para el
    // Student — el preview/lastMessageAt de la lista de Admin sigue
    // reflejando lo que corresponda, pero solo un mensaje public cambia a
    // quién le toca responder (una nota interna no espera respuesta del
    // Student, sigue siendo turno de Admin).
    await tx.update(conversations).set({
      waitingFor: visibility === "public" ? "student" : "admin",
      lastMessageAt: now,
      lastMessagePreview: preview(body),
      adminLastReadAt: now,
    }).where(eq(conversations.id, conversation.id));

    const [updated] = await tx.select().from(conversations).where(eq(conversations.id, conversation.id)).limit(1);
    const [message] = await tx.select().from(conversationMessages).where(eq(conversationMessages.id, messageId)).limit(1);
    return { conversation: updated, message };
  });
}

export interface ConversationWithMessages {
  conversation: Conversation;
  messages: ConversationMessage[];
}

// Orden por `id`, no por `createdAt`: la columna es TIMESTAMP sin
// fracciones de segundo — dos mensajes reales de la misma conversación
// escritos en el mismo segundo (nada raro en un intercambio rápido) quedan
// EMPATADOS en createdAt, y MySQL no garantiza el orden entre empates sin
// una clave de desempate. `id` (autoincrement) sí refleja siempre el orden
// real de inserción, con o sin ese empate.
export async function getConversationForStudent(conversationId: number, studentUserId: number, db?: DbHandle): Promise<ConversationWithMessages> {
  const conn = db ?? (await getDb());
  const conversation = await fetchOwnedConversation(conversationId, studentUserId, conn);
  const messages = await conn.select().from(conversationMessages)
    .where(and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.visibility, "public")))
    .orderBy(conversationMessages.id);
  return { conversation, messages };
}

export interface ConversationForAdmin extends ConversationWithMessages {
  student: { id: number; name: string | null; email: string | null } | null;
}

export async function getConversationForAdmin(conversationId: number, db?: DbHandle): Promise<ConversationForAdmin> {
  const conn = db ?? (await getDb());
  const conversation = await fetchConversation(conversationId, conn);
  const messages = await conn.select().from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(conversationMessages.id);
  const [student] = await conn.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, conversation.studentUserId)).limit(1);
  return { conversation, messages, student: student ?? null };
}

export interface ListConversationsResult<T> {
  items: T[];
  total: number;
}

export async function listConversationsForStudent(studentUserId: number, opts: { limit?: number; offset?: number } = {}, db?: DbHandle): Promise<ListConversationsResult<Conversation & { unread: boolean }>> {
  const conn = db ?? (await getDb());
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;

  const rows = await conn.select().from(conversations)
    .where(eq(conversations.studentUserId, studentUserId))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(limit).offset(offset);
  const [{ count }] = await conn.select({ count: sql<number>`count(*)` }).from(conversations).where(eq(conversations.studentUserId, studentUserId));

  const items = rows.map(c => ({
    ...c,
    // Puramente por timestamp — NUNCA condicionado a waitingFor. El
    // mensaje inicial de un Admin deja waitingFor='student' (es su turno
    // de responder) Y es genuinamente no leído — mezclar ambos conceptos
    // rompía exactamente ese caso, el más básico de todos.
    unread: !!c.lastMessageAt && (!c.studentLastReadAt || c.lastMessageAt > c.studentLastReadAt),
  }));
  return { items, total: Number(count) };
}

export interface AdminConversationListFilters {
  status?: "open" | "closed";
  waitingFor?: "student" | "admin" | "none";
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listConversationsForAdmin(filters: AdminConversationListFilters, db?: DbHandle): Promise<ListConversationsResult<Conversation & { unread: boolean; studentName: string | null; studentEmail: string | null }>> {
  const conn = db ?? (await getDb());
  const limit = Math.min(filters.limit ?? 50, 100);
  const offset = filters.offset ?? 0;

  const conditions = [];
  if (filters.status) conditions.push(eq(conversations.status, filters.status));
  if (filters.waitingFor) conditions.push(eq(conversations.waitingFor, filters.waitingFor));
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(sql`(${users.name} LIKE ${term} OR ${users.email} LIKE ${term} OR ${conversations.subject} LIKE ${term})`);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const baseQuery = conn.select({
    conversation: conversations,
    studentName: users.name,
    studentEmail: users.email,
  }).from(conversations).innerJoin(users, eq(users.id, conversations.studentUserId));

  const rows = await (where ? baseQuery.where(where) : baseQuery)
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(limit).offset(offset);

  const countQuery = conn.select({ count: sql<number>`count(*)` }).from(conversations).innerJoin(users, eq(users.id, conversations.studentUserId));
  const [{ count }] = await (where ? countQuery.where(where) : countQuery);

  const items = rows.map(r => ({
    ...r.conversation,
    studentName: r.studentName,
    studentEmail: r.studentEmail,
    // Mismo criterio que listConversationsForStudent — puramente por
    // timestamp, nunca condicionado a waitingFor.
    unread: !!r.conversation.lastMessageAt && (!r.conversation.adminLastReadAt || r.conversation.lastMessageAt > r.conversation.adminLastReadAt),
  }));
  return { items, total: Number(count) };
}

export async function countAwaitingAdmin(db?: DbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  const [{ count }] = await conn.select({ count: sql<number>`count(*)` }).from(conversations)
    .where(and(eq(conversations.status, "open"), eq(conversations.waitingFor, "admin")));
  return Number(count);
}

export async function closeConversation(conversationId: number, closedByUserId: number, db?: DbHandle): Promise<Conversation> {
  const conn = db ?? (await getDb());
  const conversation = await fetchConversation(conversationId, conn);
  if (conversation.status === "closed") return conversation;
  await conn.update(conversations).set({
    status: "closed", closedAt: new Date(), closedByUserId, waitingFor: "none",
  }).where(eq(conversations.id, conversationId));
  const [updated] = await conn.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  return updated;
}

export async function reopenConversation(conversationId: number, db?: DbHandle): Promise<Conversation> {
  const conn = db ?? (await getDb());
  const conversation = await fetchConversation(conversationId, conn);
  if (conversation.status === "open") return conversation;

  // desc(id), no desc(createdAt) — mismo motivo que getConversationForStudent/
  // Admin: TIMESTAMP sin fracción de segundo puede empatar entre 2 mensajes
  // reales del mismo intercambio rápido, y `id` es el único desempate fiable.
  const [lastMessage] = await conn.select().from(conversationMessages)
    .where(and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.visibility, "public")))
    .orderBy(desc(conversationMessages.id)).limit(1);
  // Reabrir recalcula de quién es el turno igual que cualquier otra
  // transición (spec §5): si el último mensaje real fue de Admin, ahora
  // espera al Student, y viceversa — nunca un valor fijo hardcodeado.
  const waitingFor = lastMessage?.senderRole === "admin" ? "student" : "admin";

  await conn.update(conversations).set({
    status: "open", closedAt: null, closedByUserId: null, waitingFor,
  }).where(eq(conversations.id, conversationId));
  const [updated] = await conn.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  return updated;
}

export async function markReadByStudent(conversationId: number, studentUserId: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await fetchOwnedConversation(conversationId, studentUserId, conn);
  await conn.update(conversations).set({ studentLastReadAt: new Date() }).where(eq(conversations.id, conversationId));
}

export async function markReadByAdmin(conversationId: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await fetchConversation(conversationId, conn);
  await conn.update(conversations).set({ adminLastReadAt: new Date() }).where(eq(conversations.id, conversationId));
}
