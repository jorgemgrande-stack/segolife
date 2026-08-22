/**
 * communityCommentNotifier.ts — COM-02 (spec §25): notifica al autor de una
 * propuesta cuando alguien comenta su idea convertida, y al autor de un
 * comentario cuando alguien le responde. Reutiliza EXACTAMENTE la misma
 * infraestructura que communityProposalNotifier.ts (createNotification()/
 * ENGAGEMENT_TEMPLATES) — nunca un sistema paralelo. Best-effort (nunca
 * lanza — un fallo aquí nunca debe deshacer un comentario ya guardado).
 * Idempotente por `templateKey:commentId` (UNIQUE real de
 * notifications.idempotencyKey).
 *
 * NUNCA notifica al propio usuario por su propia acción (spec §25) — se
 * comprueba explícitamente antes de cada createNotification.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { communities, type CommunityProposal, type CommunityProposalComment } from "../../../drizzle/schema";
import { createNotification } from "../engagement/notificationService";
import { renderTemplate } from "../engagement/templates";
import { resolveProposalAuthor, getCommentById } from "./communitySocialDb";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);
type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

async function resolveCommunitySlug(communityId: number | null, conn: DbHandle): Promise<string | null> {
  if (communityId == null) return null;
  const [row] = await conn.select({ slug: communities.slug }).from(communities).where(eq(communities.id, communityId)).limit(1);
  return row?.slug ?? null;
}

/** Comentario nuevo (raíz) → notifica al autor de la idea original, si la propuesta viene de una (proposal.sourceStudentProposalId). Admin-created: no hay autor personal a quien notificar (spec §33), no se envía nada. */
export async function notifyProposalCommented(proposal: CommunityProposal, comment: CommunityProposalComment, communityId: number | null, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  try {
    const author = await resolveProposalAuthor(proposal, conn);
    if (!author || author.userId === comment.userId) return; // sin autor personal, o comentando su propia propuesta

    const slug = await resolveCommunitySlug(communityId, conn);
    if (!slug) return;
    const templateKey = "community_comment_new";
    const rendered = renderTemplate(templateKey, { proposalTitle: proposal.title }, `/${slug}/comunity/${proposal.id}`);
    await createNotification({
      userId: author.userId, communityId, type: templateKey, category: "events", audienceType: "transactional",
      rendered, templateKey, templateVersion: 1, sourceType: "community_proposal_comment", sourceId: comment.id,
      idempotencyKey: `${templateKey}:${comment.id}`,
    }, conn);
  } catch (err) {
    console.error(`[CommunityCommentNotifier] fallo al notificar comentario nuevo (commentId=${comment.id}):`, err instanceof Error ? err.message : err);
  }
}

/** Respuesta a un comentario → notifica al autor del comentario PADRE, si es distinto de quien responde. */
export async function notifyCommentReplied(proposal: CommunityProposal, reply: CommunityProposalComment, communityId: number | null, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  try {
    if (reply.parentCommentId == null) return;
    const parent = await getCommentById(reply.parentCommentId, conn);
    if (!parent || parent.userId === reply.userId) return;

    const slug = await resolveCommunitySlug(communityId, conn);
    if (!slug) return;
    const templateKey = "community_comment_reply";
    const rendered = renderTemplate(templateKey, { proposalTitle: proposal.title }, `/${slug}/comunity/${proposal.id}`);
    await createNotification({
      userId: parent.userId, communityId, type: templateKey, category: "events", audienceType: "transactional",
      rendered, templateKey, templateVersion: 1, sourceType: "community_proposal_comment", sourceId: reply.id,
      idempotencyKey: `${templateKey}:${reply.id}`,
    }, conn);
  } catch (err) {
    console.error(`[CommunityCommentNotifier] fallo al notificar respuesta (commentId=${reply.id}):`, err instanceof Error ? err.message : err);
  }
}
