/**
 * eventSocialDb.ts — Social Layer para Events (2026-08-23): ❤️ like + 💬
 * comentarios/respuestas sobre la ficha pública de un evento. Auditado antes
 * de crear (spec §1): mismo patrón EXACTO que communitySocialDb.ts (COM-02),
 * reutilizado deliberadamente — toggle de like con UNIQUE(event_id,user_id),
 * comentarios raíz+1 nivel de respuesta con soft-delete (`is_hidden`), conteo
 * SIEMPRE agregado en vivo (COUNT), nunca denormalizado. Tablas nuevas y
 * separadas de Community (event_likes/event_comments, ver drizzle/schema.ts)
 * — el like/comentario pertenece al EVENTO INTERNO de SEGOLIFE (events.id),
 * nunca a un external_event_id de Weezevent/Fourvenues, así la interacción
 * social sobrevive independientemente del proveedor de ticketing.
 *
 * DIFERENCIA DELIBERADA con Community: `assertCanInteractWithEvent` NO tiene
 * el equivalente de `canAccessSocialLayer` (Community exige propuesta
 * cerrada o ya respondida, para no condicionar el voto — un evento no tiene
 * concepto de "voto" que proteger). El gate real para Events es: el evento
 * existe, es públicamente visible (isEventStudentVisible — misma regla que
 * ya gobierna si aparece en Explore) y, si está scopeado a comunidades
 * concretas, el usuario pertenece a al menos una (mismo patrón exacto que
 * isProposalVisibleToUser en communityDb.ts, vía getCommunitiesByEventId +
 * userCommunities — nunca confiar en un communityId que mande el cliente).
 *
 * Sin like a nivel de comentario individual (a diferencia de
 * community_comment_likes) y sin moderación admin en esta fase — fuera de
 * alcance explícito (documentado como pendiente real en el informe final).
 */
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  eventLikes, eventComments, users, userCommunities,
  type EventComment,
} from "../../../drizzle/schema";
import { getEventById, getCommunitiesByEventId, isEventStudentVisible } from "../../db/eventsDb";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);
export type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
export type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class EventSocialError extends Error {
  constructor(
    public code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_CONTENT" | "REPLY_DEPTH_EXCEEDED",
    message: string
  ) {
    super(message);
    this.name = "EventSocialError";
  }
}

const MAX_COMMENT_LENGTH = 1000;

function assertValidContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) throw new EventSocialError("INVALID_CONTENT", "El comentario no puede estar vacío.");
  if (trimmed.length > MAX_COMMENT_LENGTH) throw new EventSocialError("INVALID_CONTENT", `El comentario no puede superar los ${MAX_COMMENT_LENGTH} caracteres.`);
  return trimmed;
}

function isDuplicateKeyError(err: unknown): boolean {
  const hasErrno1062 = (e: unknown): boolean => !!e && typeof e === "object" && "errno" in e && (e as { errno?: number }).errno === 1062;
  if (hasErrno1062(err)) return true;
  const cause = err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined;
  return hasErrno1062(cause);
}

/** ¿Pertenece userId a al menos una de las comunidades de este evento? — mismo patrón exacto que isProposalVisibleToUser (communityDb.ts). Sin comunidades asociadas = visible para cualquiera (mismo criterio). */
async function isEventVisibleToUser(eventId: number, userId: number, conn: DbHandle): Promise<boolean> {
  const communitiesByEvent = await getCommunitiesByEventId([eventId], conn);
  const communityIds = (communitiesByEvent.get(eventId) ?? []).map(c => c.id);
  if (communityIds.length === 0) return true;
  const memberships = await conn.select({ communityId: userCommunities.communityId }).from(userCommunities).where(eq(userCommunities.userId, userId));
  const myCommunityIds = new Set(memberships.map(m => m.communityId));
  return communityIds.some(id => myCommunityIds.has(id));
}

/**
 * Puerta común de "¿puede userId ver/dar like/comentar este evento?" — el
 * evento existe, está publicado/visible (isEventStudentVisible, misma regla
 * que decide si aparece en Explore) y pertenece a su comunidad. Server-side
 * SIEMPRE — nunca confía en ningún dato que mande el cliente.
 */
export async function assertCanInteractWithEvent(eventId: number, userId: number, conn: DbHandle): Promise<void> {
  const detail = await getEventById(eventId, conn);
  if (!detail) throw new EventSocialError("NOT_FOUND", "Evento no encontrado.");
  if (!isEventStudentVisible(detail.event)) throw new EventSocialError("NOT_FOUND", "Evento no encontrado.");
  if (!(await isEventVisibleToUser(eventId, userId, conn))) {
    throw new EventSocialError("FORBIDDEN", "No tienes acceso a este evento.");
  }
}

// ─── LIKES ──────────────────────────────────────────────────────────────────

export async function getEventLikeState(eventId: number, userId: number, db?: AnyDbHandle): Promise<{ liked: boolean; count: number }> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const [[likedRow], [countRow]] = await Promise.all([
    conn.select({ id: eventLikes.id }).from(eventLikes)
      .where(and(eq(eventLikes.eventId, eventId), eq(eventLikes.userId, userId))).limit(1),
    conn.select({ count: sql<number>`COUNT(*)` }).from(eventLikes).where(eq(eventLikes.eventId, eventId)),
  ]);
  return { liked: !!likedRow, count: Number(countRow?.count ?? 0) };
}

/** Batch, sin N+1 — para un futuro listado de Events con contador (spec §10: preparar, no implementar todavía). */
export async function getEventLikeCountsBatch(eventIds: number[], db?: AnyDbHandle): Promise<Map<number, number>> {
  if (eventIds.length === 0) return new Map();
  const conn = (db ?? (await getDb())) as DbHandle;
  const rows = await conn.select({ eventId: eventLikes.eventId, count: sql<number>`COUNT(*)` })
    .from(eventLikes).where(inArray(eventLikes.eventId, eventIds)).groupBy(eventLikes.eventId);
  return new Map(rows.map(r => [r.eventId, Number(r.count)]));
}

/** Toggle idempotente — protegido por UNIQUE(event_id,user_id) real ante doble-click/carrera concurrente, nunca solo por el frontend. */
export async function toggleEventLike(eventId: number, userId: number, db?: AnyDbHandle): Promise<{ liked: boolean; count: number }> {
  const conn = (db ?? (await getDb())) as DbHandle;
  await assertCanInteractWithEvent(eventId, userId, conn);

  const [existing] = await conn.select({ id: eventLikes.id }).from(eventLikes)
    .where(and(eq(eventLikes.eventId, eventId), eq(eventLikes.userId, userId))).limit(1);

  if (existing) {
    await conn.delete(eventLikes).where(eq(eventLikes.id, existing.id));
  } else {
    try {
      await conn.insert(eventLikes).values({ eventId, userId });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err; // carrera (doble-click/2 pestañas) — UNIQUE real ya lo protege, idempotente
    }
  }
  return getEventLikeState(eventId, userId, conn);
}

// ─── COMENTARIOS ────────────────────────────────────────────────────────────

export interface EventCommentAuthor {
  userId: number;
  name: string | null;
  hasAvatar: boolean;
}

export interface EventCommentWithAuthor {
  id: number;
  eventId: number;
  parentCommentId: number | null;
  content: string;
  createdAt: Date;
  isOwn: boolean;
  isHidden: boolean;
  author: EventCommentAuthor;
  replies: EventCommentWithAuthor[];
}

/** Batch de nombre/avatar por userId — mismo criterio "sin N+1" que communitySocialDb.resolveAuthors. */
async function resolveAuthors(userIds: number[], conn: DbHandle): Promise<Map<number, EventCommentAuthor>> {
  if (userIds.length === 0) return new Map();
  const rows = await conn.select({ id: users.id, name: users.name, avatarStorageKey: users.avatarStorageKey }).from(users).where(inArray(users.id, userIds));
  return new Map(rows.map(u => [u.id, { userId: u.id, name: u.name, hasAvatar: !!u.avatarStorageKey }]));
}

/**
 * Página de comentarios RAÍZ (parentCommentId IS NULL) + sus respuestas
 * (máximo 1 nivel), más recientes primero — mismo criterio exacto que
 * communitySocialDb.listComments. Comentarios ocultos nunca se listan a otro
 * Student (el propio autor SÍ ve que el suyo está oculto, vía `isOwn`).
 */
export async function listEventComments(
  eventId: number, viewerUserId: number, opts: { limit: number; offset: number }, db?: AnyDbHandle
): Promise<{ total: number; items: EventCommentWithAuthor[] }> {
  const conn = (db ?? (await getDb())) as DbHandle;
  await assertCanInteractWithEvent(eventId, viewerUserId, conn);

  const [totalRow] = await conn.select({ count: sql<number>`COUNT(*)` }).from(eventComments)
    .where(and(eq(eventComments.eventId, eventId), sql`${eventComments.parentCommentId} IS NULL`, eq(eventComments.isHidden, false)));
  const total = Number(totalRow?.count ?? 0);
  if (total === 0) return { total: 0, items: [] };

  const roots = await conn.select().from(eventComments)
    .where(and(eq(eventComments.eventId, eventId), sql`${eventComments.parentCommentId} IS NULL`, eq(eventComments.isHidden, false)))
    .orderBy(desc(eventComments.createdAt))
    .limit(opts.limit).offset(opts.offset);
  if (roots.length === 0) return { total, items: [] };

  const rootIds = roots.map(r => r.id);
  const replies = await conn.select().from(eventComments)
    .where(and(inArray(eventComments.parentCommentId, rootIds), eq(eventComments.isHidden, false)))
    .orderBy(eventComments.createdAt);

  const authorIds = Array.from(new Set([...roots, ...replies].map(c => c.userId)));
  const authorsById = await resolveAuthors(authorIds, conn);
  const repliesByParent = new Map<number, EventComment[]>();
  for (const r of replies) {
    const list = repliesByParent.get(r.parentCommentId!) ?? [];
    list.push(r);
    repliesByParent.set(r.parentCommentId!, list);
  }

  const toItem = (c: EventComment, replyItems: EventCommentWithAuthor[]): EventCommentWithAuthor => ({
    id: c.id, eventId: c.eventId, parentCommentId: c.parentCommentId, content: c.content, createdAt: c.createdAt,
    isOwn: c.userId === viewerUserId, isHidden: c.isHidden,
    author: authorsById.get(c.userId) ?? { userId: c.userId, name: null, hasAvatar: false },
    replies: replyItems,
  });

  const items = roots.map(root => toItem(root, (repliesByParent.get(root.id) ?? []).map(r => toItem(r, []))));
  return { total, items };
}

export interface CreateEventCommentInput {
  eventId: number;
  userId: number;
  content: string;
  parentCommentId?: number | null;
}

/** Crea un comentario raíz o una respuesta (máximo 1 nivel — responder a una respuesta se rechaza, nunca crea un árbol más profundo en silencio). */
export async function createEventComment(input: CreateEventCommentInput, db?: AnyDbHandle): Promise<EventComment> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const content = assertValidContent(input.content);
  await assertCanInteractWithEvent(input.eventId, input.userId, conn);

  let parentCommentId: number | null = null;
  if (input.parentCommentId != null) {
    const [parent] = await conn.select().from(eventComments).where(eq(eventComments.id, input.parentCommentId)).limit(1);
    if (!parent || parent.eventId !== input.eventId || parent.isHidden) {
      throw new EventSocialError("NOT_FOUND", "El comentario al que respondes ya no está disponible.");
    }
    if (parent.parentCommentId != null) {
      throw new EventSocialError("REPLY_DEPTH_EXCEEDED", "Solo se puede responder a un comentario principal, no a otra respuesta.");
    }
    parentCommentId = parent.id;
  }

  const insertResult = await conn.insert(eventComments).values({ eventId: input.eventId, userId: input.userId, parentCommentId, content });
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [created] = await conn.select().from(eventComments).where(eq(eventComments.id, insertId)).limit(1);
  return created;
}

/** Borrado del propio comentario — soft-delete, nunca borra el de otro (comprueba userId === comment.userId). */
export async function deleteOwnEventComment(commentId: number, userId: number, db?: AnyDbHandle): Promise<void> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const [comment] = await conn.select().from(eventComments).where(eq(eventComments.id, commentId)).limit(1);
  if (!comment) throw new EventSocialError("NOT_FOUND", "Comentario no encontrado.");
  if (comment.userId !== userId) throw new EventSocialError("FORBIDDEN", "No puedes borrar el comentario de otro estudiante.");
  await conn.update(eventComments).set({ isHidden: true, hiddenByUserId: userId, hiddenAt: new Date() }).where(eq(eventComments.id, commentId));
}

export async function getEventCommentById(commentId: number, db?: AnyDbHandle): Promise<EventComment | null> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const [row] = await conn.select().from(eventComments).where(eq(eventComments.id, commentId)).limit(1);
  return row ?? null;
}

/** Batch, sin N+1 — para un futuro listado de Events con contador (spec §10). Cuenta comentarios raíz + respuestas (misma semántica que Community: is_hidden=false, sin distinguir nivel). */
export async function getEventCommentCountsBatch(eventIds: number[], db?: AnyDbHandle): Promise<Map<number, number>> {
  if (eventIds.length === 0) return new Map();
  const conn = (db ?? (await getDb())) as DbHandle;
  const rows = await conn.select({ eventId: eventComments.eventId, count: sql<number>`COUNT(*)` })
    .from(eventComments)
    .where(and(inArray(eventComments.eventId, eventIds), eq(eventComments.isHidden, false)))
    .groupBy(eventComments.eventId);
  return new Map(rows.map(r => [r.eventId, Number(r.count)]));
}
