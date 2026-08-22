/**
 * communitySocialDb.ts — COM-02 (Community Social Results): comentarios y
 * likes sobre una propuesta COMUNITY ya finalizada. Auditado antes de crear
 * (spec §11/§F): el único modelo de "conversación" previo es conversations/
 * conversation_messages (COM-01, 1 hilo PRIVADO Admin↔Student) — no encaja,
 * esto es público dentro de la comunidad, N estudiantes sobre la misma
 * propuesta. reviews/reviewsDb.ts (legado Náyade, hotel/spa/experiencia) es
 * de dominio completamente ajeno. Tablas nuevas mínimas — ver drizzle/schema.ts.
 *
 * Conteo de comentarios SIEMPRE agregado en vivo (COUNT(*) WHERE is_hidden=
 * false) — mismo criterio que community_supports/token_wallets en todo este
 * módulo: nunca un contador denormalizado que pueda desincronizarse.
 */
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  communityProposalComments, communityProposalLikes, communityProposals,
  communityStudentProposals, users,
  type CommunityProposalComment,
} from "../../../drizzle/schema";
import { isProposalVisibleToUser, type AnyDbHandle } from "./communityDb";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);
export type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class CommunitySocialError extends Error {
  constructor(
    public code: "NOT_FOUND" | "FORBIDDEN" | "NOT_CLOSED" | "INVALID_CONTENT" | "REPLY_DEPTH_EXCEEDED",
    message: string
  ) {
    super(message);
    this.name = "CommunitySocialError";
  }
}

const MAX_COMMENT_LENGTH = 1000;

function assertValidContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) throw new CommunitySocialError("INVALID_CONTENT", "El comentario no puede estar vacío.");
  if (trimmed.length > MAX_COMMENT_LENGTH) throw new CommunitySocialError("INVALID_CONTENT", `El comentario no puede superar los ${MAX_COMMENT_LENGTH} caracteres.`);
  return trimmed;
}

/**
 * Reglas comunes de "¿puede userId comentar/dar like a esta propuesta?"
 * (spec §19): existe, pertenece a su comunidad (isProposalVisibleToUser,
 * spec §18), y está finalizada — comentarios sociales = propuestas
 * finalizadas/resultados (spec §19, "si la arquitectura recomienda permitir
 * también durante Active, documentarlo como evolución futura, no hacerlo
 * silenciosamente" — ver informe final COM-02, sección AV).
 */
async function assertCanInteract(proposalId: number, userId: number, conn: DbHandle): Promise<void> {
  const [proposal] = await conn.select({ id: communityProposals.id, status: communityProposals.status }).from(communityProposals).where(eq(communityProposals.id, proposalId)).limit(1);
  if (!proposal) throw new CommunitySocialError("NOT_FOUND", "Propuesta no encontrada.");
  if (!(await isProposalVisibleToUser(proposalId, userId, conn))) {
    throw new CommunitySocialError("FORBIDDEN", "No tienes acceso a esta propuesta.");
  }
  if (proposal.status !== "closed") {
    throw new CommunitySocialError("NOT_CLOSED", "Los comentarios se habilitan cuando la propuesta finaliza.");
  }
}

// ─── LIKES ──────────────────────────────────────────────────────────────────

export async function getLikeState(proposalId: number, userId: number, db?: AnyDbHandle): Promise<{ liked: boolean; count: number }> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const [[likedRow], [countRow]] = await Promise.all([
    conn.select({ id: communityProposalLikes.id }).from(communityProposalLikes)
      .where(and(eq(communityProposalLikes.proposalId, proposalId), eq(communityProposalLikes.userId, userId))).limit(1),
    conn.select({ count: sql<number>`COUNT(*)` }).from(communityProposalLikes).where(eq(communityProposalLikes.proposalId, proposalId)),
  ]);
  return { liked: !!likedRow, count: Number(countRow?.count ?? 0) };
}

/** Batch, sin N+1 — para el feed Results (una propuesta por card). */
export async function getLikeCountsBatch(proposalIds: number[], db?: AnyDbHandle): Promise<Map<number, number>> {
  if (proposalIds.length === 0) return new Map();
  const conn = (db ?? (await getDb())) as DbHandle;
  const rows = await conn.select({ proposalId: communityProposalLikes.proposalId, count: sql<number>`COUNT(*)` })
    .from(communityProposalLikes).where(inArray(communityProposalLikes.proposalId, proposalIds)).groupBy(communityProposalLikes.proposalId);
  return new Map(rows.map(r => [r.proposalId, Number(r.count)]));
}

/**
 * Toggle idempotente — spec §35: un LIKE social NUNCA es un voto, nunca
 * toca community_responses/community_response_values ni ningún SegoToken.
 */
export async function toggleLike(proposalId: number, userId: number, db?: AnyDbHandle): Promise<{ liked: boolean; count: number }> {
  const conn = (db ?? (await getDb())) as DbHandle;
  await assertCanInteract(proposalId, userId, conn);

  const [existing] = await conn.select({ id: communityProposalLikes.id }).from(communityProposalLikes)
    .where(and(eq(communityProposalLikes.proposalId, proposalId), eq(communityProposalLikes.userId, userId))).limit(1);

  if (existing) {
    await conn.delete(communityProposalLikes).where(eq(communityProposalLikes.id, existing.id));
  } else {
    try {
      await conn.insert(communityProposalLikes).values({ proposalId, userId });
    } catch (err) {
      // Carrera (doble-click) — UNIQUE(proposal,user) real ya lo protege, idempotente.
      if (!isDuplicateKeyError(err)) throw err;
    }
  }
  return getLikeState(proposalId, userId, conn);
}

function isDuplicateKeyError(err: unknown): boolean {
  const hasErrno1062 = (e: unknown): boolean => !!e && typeof e === "object" && "errno" in e && (e as { errno?: number }).errno === 1062;
  if (hasErrno1062(err)) return true;
  const cause = err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined;
  return hasErrno1062(cause);
}

// ─── COMENTARIOS ────────────────────────────────────────────────────────────

export interface CommentAuthor {
  userId: number;
  name: string | null;
  hasAvatar: boolean;
}

export interface CommentWithAuthor {
  id: number;
  proposalId: number;
  parentCommentId: number | null;
  content: string;
  createdAt: Date;
  isOwn: boolean;
  isHidden: boolean;
  author: CommentAuthor;
  replies: CommentWithAuthor[];
}

/** Batch de nombre/avatar por userId — mismo criterio "sin N+1" que getProposalRespondents (communityResultsService.ts). */
async function resolveAuthors(userIds: number[], conn: DbHandle): Promise<Map<number, CommentAuthor>> {
  if (userIds.length === 0) return new Map();
  const rows = await conn.select({ id: users.id, name: users.name, avatarStorageKey: users.avatarStorageKey }).from(users).where(inArray(users.id, userIds));
  return new Map(rows.map(u => [u.id, { userId: u.id, name: u.name, hasAvatar: !!u.avatarStorageKey }]));
}

/**
 * Página de comentarios RAÍZ (parentCommentId IS NULL) + su única respuesta
 * si existe (spec §12/§22: "1 nivel de profundidad", "mantener reply junto
 * a parent"), más recientes primero. Comentarios ocultos (propios o
 * moderados) nunca se listan a otro Student — el propio autor SÍ puede ver
 * que su comentario está oculto (isOwn), para no confundir "se borró" con
 * "desapareció sin explicación".
 */
/**
 * `includeHidden` — SOLO para la vista de moderación Admin (spec §17): el
 * caller (router) exige community.view/community.moderate antes de pasar
 * true aquí, mismo criterio que getProposalResults(id, includeHidden) ya
 * usa para open_text — nunca un segundo mecanismo de moderación paralelo.
 * Un Student normal SIEMPRE llama con includeHidden=false (default).
 */
export async function listComments(
  proposalId: number, viewerUserId: number, opts: { limit: number; offset: number }, includeHidden = false, db?: AnyDbHandle
): Promise<{ total: number; items: CommentWithAuthor[] }> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const hiddenFilter = includeHidden ? [] : [eq(communityProposalComments.isHidden, false)];

  const [totalRow] = await conn.select({ count: sql<number>`COUNT(*)` }).from(communityProposalComments)
    .where(and(eq(communityProposalComments.proposalId, proposalId), sql`${communityProposalComments.parentCommentId} IS NULL`, ...hiddenFilter));
  const total = Number(totalRow?.count ?? 0);
  if (total === 0) return { total: 0, items: [] };

  const roots = await conn.select().from(communityProposalComments)
    .where(and(eq(communityProposalComments.proposalId, proposalId), sql`${communityProposalComments.parentCommentId} IS NULL`, ...hiddenFilter))
    .orderBy(desc(communityProposalComments.createdAt))
    .limit(opts.limit).offset(opts.offset);
  if (roots.length === 0) return { total, items: [] };

  const rootIds = roots.map(r => r.id);
  const replies = await conn.select().from(communityProposalComments)
    .where(and(inArray(communityProposalComments.parentCommentId, rootIds), ...hiddenFilter))
    .orderBy(communityProposalComments.createdAt);

  const authorIds = Array.from(new Set([...roots, ...replies].map(c => c.userId)));
  const authorsById = await resolveAuthors(authorIds, conn);
  const repliesByParent = new Map<number, CommunityProposalComment[]>();
  for (const r of replies) {
    const list = repliesByParent.get(r.parentCommentId!) ?? [];
    list.push(r);
    repliesByParent.set(r.parentCommentId!, list);
  }

  const toItem = (c: CommunityProposalComment, replyItems: CommentWithAuthor[]): CommentWithAuthor => ({
    id: c.id, proposalId: c.proposalId, parentCommentId: c.parentCommentId, content: c.content, createdAt: c.createdAt,
    isOwn: c.userId === viewerUserId, isHidden: c.isHidden,
    author: authorsById.get(c.userId) ?? { userId: c.userId, name: null, hasAvatar: false },
    replies: replyItems,
  });

  const items = roots.map(root => toItem(root, (repliesByParent.get(root.id) ?? []).map(r => toItem(r, []))));
  return { total, items };
}

export interface CreateCommentInput {
  proposalId: number;
  userId: number;
  content: string;
  parentCommentId?: number | null;
}

/**
 * Crea un comentario raíz o una respuesta (spec §12: máximo 1 nivel — si el
 * parent ya es a su vez una respuesta, RECHAZA en vez de crear un árbol más
 * profundo en silencio).
 */
export async function createComment(input: CreateCommentInput, db?: AnyDbHandle): Promise<CommunityProposalComment> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const content = assertValidContent(input.content);
  await assertCanInteract(input.proposalId, input.userId, conn);

  let parentCommentId: number | null = null;
  if (input.parentCommentId != null) {
    const [parent] = await conn.select().from(communityProposalComments).where(eq(communityProposalComments.id, input.parentCommentId)).limit(1);
    if (!parent || parent.proposalId !== input.proposalId || parent.isHidden) {
      throw new CommunitySocialError("NOT_FOUND", "El comentario al que respondes ya no está disponible.");
    }
    if (parent.parentCommentId != null) {
      throw new CommunitySocialError("REPLY_DEPTH_EXCEEDED", "Solo se puede responder a un comentario principal, no a otra respuesta.");
    }
    parentCommentId = parent.id;
  }

  const insertResult = await conn.insert(communityProposalComments).values({ proposalId: input.proposalId, userId: input.userId, parentCommentId, content });
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [created] = await conn.select().from(communityProposalComments).where(eq(communityProposalComments.id, insertId)).limit(1);
  return created;
}

/** Borrado del propio comentario (spec §15) — soft-delete unificado, ver comentario de schema.ts. Nunca borra el de otro (comprueba userId === comment.userId). */
export async function deleteOwnComment(commentId: number, userId: number, db?: AnyDbHandle): Promise<void> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const [comment] = await conn.select().from(communityProposalComments).where(eq(communityProposalComments.id, commentId)).limit(1);
  if (!comment) throw new CommunitySocialError("NOT_FOUND", "Comentario no encontrado.");
  if (comment.userId !== userId) throw new CommunitySocialError("FORBIDDEN", "No puedes borrar el comentario de otro estudiante.");
  await conn.update(communityProposalComments).set({ isHidden: true, hiddenByUserId: userId, hiddenAt: new Date() }).where(eq(communityProposalComments.id, commentId));
}

/** Moderación admin (spec §17) — el caller (router) exige community.moderate antes de llamar aquí, mismo criterio que setResponseValueVisibility. */
export async function moderateComment(commentId: number, actorUserId: number, db?: AnyDbHandle): Promise<void> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const [comment] = await conn.select({ id: communityProposalComments.id }).from(communityProposalComments).where(eq(communityProposalComments.id, commentId)).limit(1);
  if (!comment) throw new CommunitySocialError("NOT_FOUND", "Comentario no encontrado.");
  await conn.update(communityProposalComments).set({ isHidden: true, hiddenByUserId: actorUserId, hiddenAt: new Date() }).where(eq(communityProposalComments.id, commentId));
}

export async function getCommentById(commentId: number, db?: AnyDbHandle): Promise<CommunityProposalComment | null> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const [row] = await conn.select().from(communityProposalComments).where(eq(communityProposalComments.id, commentId)).limit(1);
  return row ?? null;
}

/** Batch, sin N+1 — para el feed Results (una propuesta por card). */
export async function getCommentCountsBatch(proposalIds: number[], db?: AnyDbHandle): Promise<Map<number, number>> {
  if (proposalIds.length === 0) return new Map();
  const conn = (db ?? (await getDb())) as DbHandle;
  const rows = await conn.select({ proposalId: communityProposalComments.proposalId, count: sql<number>`COUNT(*)` })
    .from(communityProposalComments)
    .where(and(inArray(communityProposalComments.proposalId, proposalIds), eq(communityProposalComments.isHidden, false)))
    .groupBy(communityProposalComments.proposalId);
  return new Map(rows.map(r => [r.proposalId, Number(r.count)]));
}

/**
 * Autor real de una propuesta (spec §33) — si vino de una idea de estudiante
 * (sourceStudentProposalId), el autor ES ese estudiante (studentUserId de
 * community_student_proposals); si la creó directamente un admin, NO se
 * expone la identidad personal del admin como si fuera un perfil social
 * (decisión de diseño, ver informe final COM-02 sección J) — se devuelve
 * `null` y el cliente cae al fallback de marca "SEGOLIFE".
 */
export async function resolveProposalAuthor(proposal: { sourceStudentProposalId: number | null }, db?: AnyDbHandle): Promise<CommentAuthor | null> {
  if (proposal.sourceStudentProposalId == null) return null;
  const conn = (db ?? (await getDb())) as DbHandle;
  const [idea] = await conn.select({ studentUserId: communityStudentProposals.studentUserId }).from(communityStudentProposals)
    .where(eq(communityStudentProposals.id, proposal.sourceStudentProposalId)).limit(1);
  if (!idea) return null;
  const authors = await resolveAuthors([idea.studentUserId], conn);
  return authors.get(idea.studentUserId) ?? { userId: idea.studentUserId, name: null, hasAvatar: false };
}
