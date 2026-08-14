/**
 * communityAudienceService.ts — audiencia + publicación de una propuesta
 * COMUNITY. REUSE explícito de audienceEngine (Fase 7) — sin motor de
 * segmentación paralelo (spec punto 10).
 *
 * Snapshot al publicar (spec punto 11, decisión ya documentada): quién podía
 * responder queda fijado en ese momento — mismo patrón exacto que
 * engagement_campaigns → engagement_campaign_audiences
 * (server/segolife/engagement/campaignService.ts, sendCampaignNow).
 *
 * SEGOTOKENS — COMMUNITY_PROPOSAL_APPROVED (SEGOLIFE — COMMUNITY Production
 * Implementation): cuando la propuesta que se activa proviene de una idea de
 * estudiante (`sourceStudentProposalId`), se premia al autor original vía
 * `earnTokens()` (origin="community_proposal_approved") en el momento en que
 * la propuesta pasa realmente a `active` — no en el momento de aprobar la
 * moderación (aprobar solo cambia `community_student_proposals.status`,
 * todavía no hay nada publicado/visible). Idempotente por
 * `sourceStudentProposalId` (una propuesta formal solo puede activarse una
 * vez en su ciclo de vida — `publishProposal` exige status draft/scheduled).
 * Best-effort: un fallo del motor de tokens nunca debe impedir la
 * publicación real.
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { communityProposals, communityProposalAudiences, communities } from "../../../drizzle/schema";
import { resolveAudience, type AudienceDefinition } from "../engagement/audienceEngine";
import { getProposalById, setProposalStatus, type AnyDbHandle } from "./communityDb";
import { getStudentProposalById } from "./communityStudentProposalDb";
import { createNotification } from "../engagement/notificationService";
import { renderTemplate } from "../engagement/templates";
import { earnTokens } from "../tokens/tokenEngine";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);
type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class CommunityPublishError extends Error {
  code: "NOT_FOUND" | "INVALID_STATUS" | "MISSING_AUDIENCE" | "EMPTY_AUDIENCE" | "MISSING_WINDOW";
  constructor(code: CommunityPublishError["code"], message: string) {
    super(message);
    this.name = "CommunityPublishError";
    this.code = code;
  }
}

export interface AudiencePreview {
  total: number;
  byCommunity: { communityId: number; communityName: string; count: number }[];
}

/** Vista previa ANTES de publicar — spec punto 10, "Audience estimated: 243 students, IE: 141, UVA: 102". Nunca expone emails/listado individual. */
export async function previewProposalAudience(definition: AudienceDefinition, db?: AnyDbHandle): Promise<AudiencePreview> {
  const conn = db ?? (await getDb());
  const userIds = await resolveAudience(definition, conn as DbHandle);
  if (userIds.length === 0) return { total: 0, byCommunity: [] };

  const { userCommunities } = await import("../../../drizzle/schema");
  const { inArray } = await import("drizzle-orm");
  const rows = await conn.select({ communityId: userCommunities.communityId, userId: userCommunities.userId })
    .from(userCommunities).where(inArray(userCommunities.userId, userIds));

  const countByCommunity = new Map<number, Set<number>>();
  for (const row of rows) {
    const set = countByCommunity.get(row.communityId) ?? new Set<number>();
    set.add(row.userId);
    countByCommunity.set(row.communityId, set);
  }
  const communityIds = Array.from(countByCommunity.keys());
  const communityRows = communityIds.length
    ? await conn.select({ id: communities.id, name: communities.name }).from(communities).where(inArray(communities.id, communityIds))
    : [];
  const nameById = new Map(communityRows.map(c => [c.id, c.name]));

  return {
    total: userIds.length,
    byCommunity: communityIds.map(id => ({ communityId: id, communityName: nameById.get(id) ?? "?", count: countByCommunity.get(id)!.size })),
  };
}

/**
 * Publica una propuesta: valida estado + audiencia + ventana, snapshotea
 * (community_proposal_audiences), pasa a status=active|scheduled según
 * corresponda, y crea la notificación in-app (deep-link, spec punto 20).
 * Nunca activa canales externos (spec punto 21).
 */
export async function publishProposal(proposalId: number, publishedByUserId: number, db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  const proposal = await getProposalById(proposalId, conn);
  if (!proposal) throw new CommunityPublishError("NOT_FOUND", "Propuesta no encontrada");
  if (proposal.status !== "draft" && proposal.status !== "scheduled") {
    throw new CommunityPublishError("INVALID_STATUS", `No se puede publicar una propuesta en estado "${proposal.status}"`);
  }
  if (!proposal.endsAt) {
    throw new CommunityPublishError("MISSING_WINDOW", "La propuesta necesita una fecha de cierre antes de publicarse");
  }
  if (!proposal.audienceDefinition) {
    throw new CommunityPublishError("MISSING_AUDIENCE", "La propuesta necesita una audiencia definida antes de publicarse");
  }

  const userIds = await resolveAudience(proposal.audienceDefinition as AudienceDefinition, conn as DbHandle);
  if (userIds.length === 0) {
    throw new CommunityPublishError("EMPTY_AUDIENCE", "La audiencia resuelta está vacía — nadie podría responder");
  }

  const now = new Date();
  await (conn as DbHandle).delete(communityProposalAudiences).where(eq(communityProposalAudiences.proposalId, proposalId));
  for (const userId of userIds) {
    await (conn as DbHandle).insert(communityProposalAudiences).values({ proposalId, userId });
  }

  const willActivateNow = !proposal.startsAt || proposal.startsAt.getTime() <= now.getTime();
  await setProposalStatus(proposalId, willActivateNow ? "active" : "scheduled", {
    audienceSnapshotAt: now,
    publishedAt: now,
  }, conn);

  if (willActivateNow) {
    if (proposal.sourceStudentProposalId != null) {
      await rewardStudentProposalApproved(proposal.sourceStudentProposalId, conn);
    }
    await notifyProposalPublished(proposal.id, proposal.title, userIds, conn);
  }
}

/** SegoTokens al autor de la idea original, solo cuando su propuesta convertida se activa de verdad (ver comentario de cabecera). Best-effort — nunca bloquea la publicación. */
async function rewardStudentProposalApproved(sourceStudentProposalId: number, db: AnyDbHandle): Promise<void> {
  try {
    const idea = await getStudentProposalById(sourceStudentProposalId, db);
    if (!idea) return;
    await earnTokens({
      userId: idea.studentUserId,
      origin: "community_proposal_approved",
      venueId: idea.venueId ?? null,
      sourceId: sourceStudentProposalId,
      idempotencyKey: `community_proposal_approved:${sourceStudentProposalId}`,
    }, db);
  } catch (err) {
    console.error(`[communityAudienceService] No se concedió recompensa de propuesta aprobada (sourceStudentProposalId=${sourceStudentProposalId}):`, err);
  }
}

/** Notificación in-app a toda la audiencia — REUSE notificationService, nunca un sistema paralelo (spec punto 20). Solo in-app, canales externos ni se intentan (spec punto 21: "OFF" no significa fallback silencioso, significa que ni se llama). */
export async function notifyProposalPublished(proposalId: number, title: string, userIds: number[], db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  if (userIds.length === 0) return;

  // El deep-link exige slug de comunidad (spec punto 20: "/:community/comunity/:id",
  // spec punto 55: nunca hardcodear IE/UVA) — se resuelve por destinatario,
  // usando la primera comunidad real a la que pertenece (mismo criterio que
  // el resto del repo cuando un estudiante tiene más de una).
  const { userCommunities, communities: communitiesTable } = await import("../../../drizzle/schema");
  const { inArray, eq: eqOp } = await import("drizzle-orm");
  const rows = await (conn as DbHandle).select({ userId: userCommunities.userId, slug: communitiesTable.slug })
    .from(userCommunities)
    .innerJoin(communitiesTable, eqOp(userCommunities.communityId, communitiesTable.id))
    .where(inArray(userCommunities.userId, userIds));
  const slugByUser = new Map<number, string>();
  for (const row of rows) if (!slugByUser.has(row.userId)) slugByUser.set(row.userId, row.slug);

  for (const userId of userIds) {
    const slug = slugByUser.get(userId);
    if (!slug) continue; // sin comunidad conocida — no hay a dónde navegar, se omite sin romper el resto
    const rendered = renderTemplate("community_proposal_published", { title }, `/${slug}/comunity/${proposalId}`);
    await createNotification({
      userId,
      communityId: null,
      type: "community_proposal_published",
      category: "events",
      audienceType: "transactional",
      rendered,
      sourceType: "community_proposal",
      sourceId: proposalId,
      idempotencyKey: `community_proposal_published:${proposalId}:${userId}`,
    }, conn as DbHandle).catch((err: unknown) => {
      console.error(`[communityAudienceService] No se pudo notificar a userId=${userId}:`, err);
    });
  }
}
