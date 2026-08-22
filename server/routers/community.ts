/**
 * community.ts — router de COMUNITY (encuestas/sondeos/propuestas de
 * estudiantes). Mismo patrón que students.ts/students360.ts/events.ts:
 * permissionProcedure + communityAccess + assert*Accessible por overlap de
 * comunidades. Ver docs/comunity/architecture.md.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, permissionProcedure } from "../_core/trpc";
import { getCommunityAccess, resolveCommunityFilter, type CommunityAccess } from "../_core/communityAccess";
import {
  createProposal, updateProposal, setProposalStatus, getProposalById, listProposals,
  setProposalOptions, listProposalOptions, getProposalCommunityIds, setProposalCommunities,
  isProposalOpenForResponses, getVenueName, computeResultsVisible, isInProposalAudience, isProposalVisibleToUser,
  canAccessSocialLayer,
} from "../segolife/community/communityDb";
import { previewProposalAudience, publishProposal, CommunityPublishError } from "../segolife/community/communityAudienceService";
import { submitResponse, getUserResponse, CommunityResponseError, type ResponsePayload } from "../segolife/community/communityResponseService";
import { getProposalResults, getProposalRespondents } from "../segolife/community/communityResultsService";
import { computeCommunityScore } from "../segolife/community/communityScoreService";
import { isPositiveRespondent, isPositiveAttendanceIntention, attendanceIntentionFromCode } from "../segolife/community/communityIntentService";
import { convertProposalToEventDraft, notifyInterestedRespondents, CommunityConversionError } from "../segolife/community/communityEventConversionService";
import {
  submitStudentProposal, listStudentProposals, getStudentProposalById,
  approveStudentProposal, rejectStudentProposal, markStudentProposalConverted,
  supportStudentProposal, unsupportStudentProposal, hasUserSupported, getSupportCount,
  listTrendingStudentProposals,
} from "../segolife/community/communityStudentProposalDb";
import { communityResponseValues, communityResponses, communityOptions as communityOptionsTable } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { getUserCommunities } from "../db/communitiesDb";
import { notifyStudentProposalSubmitted, notifyStudentProposalApproved, notifyStudentProposalRejected } from "../segolife/community/communityProposalNotifier";
import { validateQuestionTypeOptions } from "../segolife/community/communityQuestionTypeValidation";
import {
  getLikeState, toggleLike, listComments, createComment, deleteOwnComment, moderateComment,
  getCommentCountsBatch, getLikeCountsBatch, resolveProposalAuthor, CommunitySocialError,
} from "../segolife/community/communitySocialDb";
import { notifyProposalCommented, notifyCommentReplied } from "../segolife/community/communityCommentNotifier";

const communityViewProcedure = permissionProcedure("community.view", ["admin"]);
const communityManageProcedure = permissionProcedure("community.manage", ["admin"]);
const communityModerateProcedure = permissionProcedure("community.moderate", ["admin"]);
const communityPublishProcedure = permissionProcedure("community.publish", ["admin"]);

const communityFilterInput = z.union([z.number().int().positive(), z.literal("all")]).optional();

function assertCommunityIdsWithinAccess(access: CommunityAccess, communityIds: number[]) {
  if (access === "all") return;
  const outOfScope = communityIds.some(id => !access.includes(id));
  if (outOfScope) throw new TRPCError({ code: "FORBIDDEN", message: "No puedes operar sobre una comunidad fuera de tu alcance" });
}

async function assertProposalAccessible(access: CommunityAccess, proposalId: number) {
  const communityIds = await getProposalCommunityIds(proposalId);
  // Sin filas = propuesta global, visible/gestionable por cualquier admin con el permiso.
  if (communityIds.length === 0) return;
  assertCommunityIdsWithinAccess(access, communityIds);
}

/** COM-02 — mapea CommunitySocialError (communitySocialDb.ts) al mismo criterio que CommunityResponseError más abajo — nunca expone el error crudo de servicio al cliente. */
function mapCommunitySocialError(err: unknown): never {
  if (err instanceof CommunitySocialError) {
    const code =
      err.code === "NOT_FOUND" ? "NOT_FOUND" :
      err.code === "FORBIDDEN" ? "FORBIDDEN" : "BAD_REQUEST";
    throw new TRPCError({ code, message: err.message });
  }
  throw err;
}

const questionTypeEnum = z.enum([
  "single_choice", "yes_no", "percentage_scale", "scale_1_5",
  "multiselect", "ranking", "attendance_intention", "me_apunto", "open_text",
]);

const audienceDefinitionSchema = z.object({
  allStudents: z.boolean().optional(),
  communityIds: z.array(z.number().int().positive()).optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
  venueActivity: z.object({ venueId: z.number().int().positive(), kind: z.enum(["visited", "benefit_granted", "benefit_redeemed"]) }).optional(),
  eventAttended: z.object({ eventId: z.number().int().positive() }).optional(),
  tokensBalanceMin: z.number().int().optional(),
  tokensBalanceMax: z.number().int().optional(),
  benefitOwnership: z.object({ benefitDefinitionId: z.number().int().positive().optional(), status: z.enum(["active", "used", "expired", "cancelled"]).optional() }).optional(),
  academicYear: z.string().optional(),
  profileComplete: z.boolean().optional(),
  createdAfter: z.string().optional(),
  createdBefore: z.string().optional(),
}).passthrough();

const responsePayloadSchema = z.discriminatedUnion("questionType", [
  z.object({ questionType: z.literal("single_choice"), optionId: z.number().int().positive() }),
  z.object({ questionType: z.literal("yes_no"), value: z.enum(["yes", "no"]) }),
  z.object({ questionType: z.literal("percentage_scale"), values: z.array(z.object({ optionId: z.number().int().positive(), value: z.number().int().min(0).max(100) })).min(1) }),
  z.object({ questionType: z.literal("scale_1_5"), value: z.number().int().min(1).max(5) }),
  z.object({ questionType: z.literal("multiselect"), optionIds: z.array(z.number().int().positive()).min(1) }),
  z.object({ questionType: z.literal("ranking"), orderedOptionIds: z.array(z.number().int().positive()).min(1) }),
  z.object({ questionType: z.literal("attendance_intention"), value: z.enum(["no", "maybe", "probably", "definitely"]) }),
  z.object({ questionType: z.literal("me_apunto") }),
  z.object({ questionType: z.literal("open_text"), text: z.string().min(1).max(1000) }),
]);

export const communityRouter = router({
  // ─── ADMIN — lectura ────────────────────────────────────────────────────────

  list: communityViewProcedure
    .input(z.object({
      communityId: communityFilterInput,
      status: z.enum(["draft", "scheduled", "active", "closed", "cancelled", "converted"]).optional(),
      questionType: questionTypeEnum.optional(),
      venueId: z.number().int().positive().optional(),
      search: z.string().max(256).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      const communityIds = resolveCommunityFilter(access, input.communityId);
      return listProposals({ ...input, communityIds });
    }),

  getById: communityViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const proposal = await getProposalById(input.id);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertProposalAccessible(access, input.id);
      const [options, communityIds] = await Promise.all([listProposalOptions(input.id), getProposalCommunityIds(input.id)]);
      return { proposal, options, communityIds };
    }),

  getResults: communityViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertProposalAccessible(access, input.id);
      const results = await getProposalResults(input.id, true);
      if (!results) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });
      return results;
    }),

  getScore: communityViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertProposalAccessible(access, input.id);
      const proposal = await getProposalById(input.id);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });
      const results = await getProposalResults(input.id, true);
      if (!results) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });

      let positiveRespondents: number | null = null;
      let strongIntentRespondents: number | null = null;
      if (results.yesNo) { positiveRespondents = results.yesNo.yes; strongIntentRespondents = null; }
      if (results.attendanceIntention) {
        positiveRespondents = results.attendanceIntention.breakdown.probably + results.attendanceIntention.breakdown.definitely;
        strongIntentRespondents = results.attendanceIntention.breakdown.definitely;
      }
      if (results.meApunto) { positiveRespondents = results.meApunto.count; strongIntentRespondents = results.meApunto.count; }

      return computeCommunityScore({
        totalResponses: results.totalResponses,
        totalAudience: results.totalAudience,
        positiveRespondents,
        strongIntentRespondents,
        medianResponseMinutesSincePublish: null, // spec futuro — requiere histórico de timestamps por respuesta, no calculado en esta fase
      });
    }),

  /** Drilldown de respondentes (spec punto 42) — link a Student 360. */
  getRespondents: communityViewProcedure
    .input(z.object({ id: z.number().int().positive(), optionId: z.number().int().positive().optional() }))
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertProposalAccessible(access, input.id);
      const { studentProfiles, users } = await import("../../drizzle/schema");
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "BD no disponible" });

      let responseRows = await db.select({ response: communityResponses }).from(communityResponses).where(eq(communityResponses.proposalId, input.id));
      if (input.optionId) {
        const valueRows = await db.select({ responseId: communityResponseValues.responseId })
          .from(communityResponseValues).where(eq(communityResponseValues.optionId, input.optionId));
        const responseIds = new Set(valueRows.map(v => v.responseId));
        responseRows = responseRows.filter(r => responseIds.has(r.response.id));
      }

      const userIds = responseRows.map(r => r.response.userId);
      if (userIds.length === 0) return [];
      const { inArray } = await import("drizzle-orm");
      const profileRows = await db.select({ profile: studentProfiles, user: users }).from(studentProfiles)
        .innerJoin(users, eq(studentProfiles.userId, users.id)).where(inArray(studentProfiles.userId, userIds));
      return profileRows.map(r => ({
        studentProfileId: r.profile.id,
        userId: r.profile.userId,
        name: r.user.name,
        respondedAt: responseRows.find(rr => rr.response.userId === r.profile.userId)?.response.respondedAt ?? null,
      }));
    }),

  // ─── ADMIN — escritura ──────────────────────────────────────────────────────

  create: communityManageProcedure
    .input(z.object({
      title: z.string().min(1).max(256),
      description: z.string().max(4000).nullish(),
      questionType: questionTypeEnum,
      urgencyType: z.enum(["flash", "scheduled"]).default("scheduled"),
      startsAt: z.coerce.date().nullish(),
      endsAt: z.coerce.date().nullish(),
      resultsVisibility: z.enum(["immediate", "after_vote", "after_close", "never"]).default("after_vote"),
      allowChangeResponse: z.boolean().default(true),
      tokenReward: z.number().int().min(0).max(200).nullish(),
      coverImageUrl: z.string().max(512).nullish(),
      venueId: z.number().int().positive().nullish(),
      relatedEventId: z.number().int().positive().nullish(),
      audienceDefinition: audienceDefinitionSchema.nullish(),
      minSampleSize: z.number().int().min(1).max(50).default(5),
      options: z.array(z.string().min(1).max(256)).max(20).optional(),
      communityIds: z.array(z.number().int().positive()).default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertCommunityIdsWithinAccess(access, input.communityIds);
      // MG-05 §9 — antes solo el wizard (React) impedía una combinación
      // imposible (p.ej. single_choice sin opciones, o yes_no con
      // opciones); el servidor nunca lo comprobaba. Mismo validador que
      // usa ahora la propuesta de Student — una sola semántica.
      const validation = validateQuestionTypeOptions(input.questionType, input.options);
      if (!validation.ok) throw new TRPCError({ code: "BAD_REQUEST", message: validation.error });
      const { communityIds, ...fields } = input;
      const proposal = await createProposal({ ...fields, options: validation.cleanOptions.length > 0 ? validation.cleanOptions : undefined, createdByUserId: ctx.user.id, communityIds }, undefined);
      return { success: true, proposal };
    }),

  update: communityManageProcedure
    .input(z.object({
      id: z.number().int().positive(),
      title: z.string().min(1).max(256).optional(),
      description: z.string().max(4000).nullish(),
      urgencyType: z.enum(["flash", "scheduled"]).optional(),
      startsAt: z.coerce.date().nullish(),
      endsAt: z.coerce.date().nullish(),
      resultsVisibility: z.enum(["immediate", "after_vote", "after_close", "never"]).optional(),
      allowChangeResponse: z.boolean().optional(),
      tokenReward: z.number().int().min(0).max(200).nullish(),
      coverImageUrl: z.string().max(512).nullish(),
      venueId: z.number().int().positive().nullish(),
      relatedEventId: z.number().int().positive().nullish(),
      audienceDefinition: audienceDefinitionSchema.nullish(),
      minSampleSize: z.number().int().min(1).max(50).optional(),
      options: z.array(z.string().min(1).max(256)).max(20).optional(),
      communityIds: z.array(z.number().int().positive()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertProposalAccessible(access, input.id);
      const proposal = await getProposalById(input.id);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });
      // Editable en cualquier estado salvo los terminales — "cancelled"/"converted"
      // ya no representan una propuesta viva (spec: admin debe poder corregir
      // título/descripción/fechas/etc. incluso tras publicar).
      if (proposal.status === "cancelled" || proposal.status === "converted") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `No se puede editar una propuesta en estado "${proposal.status}"` });
      }
      const { id, options, communityIds, ...fields } = input;
      if (communityIds) assertCommunityIdsWithinAccess(access, communityIds);
      if (options) {
        const { getDb } = await import("../db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "BD no disponible" });
        const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(communityResponses).where(eq(communityResponses.proposalId, id));
        if (Number(count) > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No se pueden modificar las opciones de una propuesta que ya tiene respuestas registradas" });
        }
      }
      const updated = await updateProposal(id, fields);
      if (options) await setProposalOptions(id, options);
      if (communityIds) await setProposalCommunities(id, communityIds);
      return { success: true, proposal: updated };
    }),

  previewAudience: communityManageProcedure
    .input(z.object({ audienceDefinition: audienceDefinitionSchema }))
    .query(async ({ input }) => previewProposalAudience(input.audienceDefinition)),

  publish: communityPublishProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertProposalAccessible(access, input.id);
      try {
        await publishProposal(input.id, ctx.user.id);
      } catch (err) {
        if (err instanceof CommunityPublishError) throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        throw err;
      }
      return { success: true };
    }),

  closeNow: communityManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertProposalAccessible(access, input.id);
      const proposal = await setProposalStatus(input.id, "closed", { closedAt: new Date() });
      return { success: true, proposal };
    }),

  cancel: communityManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertProposalAccessible(access, input.id);
      const proposal = await setProposalStatus(input.id, "cancelled", { cancelledAt: new Date() });
      return { success: true, proposal };
    }),

  /**
   * Duplicar propuesta (spec punto 60) — el único gap real que dejó la
   * implementación original de COMUNITY. Crea una copia SIEMPRE en DRAFT
   * (nunca se publica automáticamente): mismo tipo/opciones/audiencia/
   * alcance/configuración, pero sin fechas (el admin debe fijar un cierre
   * nuevo antes de publicar, igual que cualquier borrador) y sin
   * `sourceStudentProposalId` (una copia es una acción del admin, nunca
   * hereda la autoría de la idea de estudiante original).
   */
  duplicate: communityManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertProposalAccessible(access, input.id);
      const source = await getProposalById(input.id);
      if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });
      const [options, communityIds] = await Promise.all([listProposalOptions(input.id), getProposalCommunityIds(input.id)]);

      const proposal = await createProposal({
        title: `Copia de ${source.title}`,
        description: source.description,
        questionType: source.questionType,
        urgencyType: source.urgencyType,
        startsAt: null,
        endsAt: null,
        resultsVisibility: source.resultsVisibility,
        allowChangeResponse: source.allowChangeResponse,
        coverImageUrl: source.coverImageUrl,
        venueId: source.venueId,
        relatedEventId: source.relatedEventId,
        audienceDefinition: source.audienceDefinition as Record<string, unknown> | null,
        minSampleSize: source.minSampleSize,
        createdByUserId: ctx.user.id,
        options: options.map(o => o.label),
        communityIds,
      });
      return { success: true, proposal };
    }),

  convertToEvent: communityManageProcedure
    .input(z.object({ id: z.number().int().positive(), startsAt: z.coerce.date().optional(), capacity: z.number().int().positive().nullish() }))
    .mutation(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertProposalAccessible(access, input.id);
      try {
        const event = await convertProposalToEventDraft({ proposalId: input.id, adminUserId: ctx.user.id, startsAt: input.startsAt, capacity: input.capacity });
        return { success: true, event };
      } catch (err) {
        if (err instanceof CommunityConversionError) throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        throw err;
      }
    }),

  notifyInterested: communityManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertProposalAccessible(access, input.id);
      return notifyInterestedRespondents(input.id);
    }),

  // ─── ADMIN — moderación (open_text) ─────────────────────────────────────────

  setResponseValueVisibility: communityModerateProcedure
    .input(z.object({ responseValueId: z.number().int().positive(), isHidden: z.boolean().optional(), isFeatured: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "BD no disponible" });
      const fields: { isHidden?: boolean; isFeatured?: boolean } = {};
      if (input.isHidden !== undefined) fields.isHidden = input.isHidden;
      if (input.isFeatured !== undefined) fields.isFeatured = input.isFeatured;
      await db.update(communityResponseValues).set(fields).where(eq(communityResponseValues.id, input.responseValueId));
      return { success: true };
    }),

  // ─── ADMIN — moderación de ideas de estudiante ──────────────────────────────

  listStudentProposals: communityViewProcedure
    .input(z.object({
      communityId: communityFilterInput,
      status: z.enum(["pending_moderation", "approved", "rejected", "scheduled", "active", "closed", "converted"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      const communityIds = resolveCommunityFilter(access, input.communityId);
      return listStudentProposals({ ...input, communityIds });
    }),

  approveStudentProposal: communityModerateProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const proposal = await approveStudentProposal(input.id, ctx.user.id);
      // FINAL ZERO-DEBT (Block D) — best-effort, nunca bloquea la aprobación ya guardada.
      if (proposal) notifyStudentProposalApproved(proposal).catch(() => {});
      return { success: true, proposal };
    }),

  rejectStudentProposal: communityModerateProcedure
    .input(z.object({ id: z.number().int().positive(), reasonInternal: z.string().min(1).max(512), reasonStudent: z.string().max(512).nullish() }))
    .mutation(async ({ input, ctx }) => {
      const proposal = await rejectStudentProposal(input.id, ctx.user.id, input.reasonInternal, input.reasonStudent);
      if (proposal) notifyStudentProposalRejected(proposal).catch(() => {});
      return { success: true, proposal };
    }),

  /** Convierte una idea aprobada en una propuesta COMUNITY formal (draft, prellenada) — nunca reescribe la idea original (spec: "nunca se reescribe esta fila como si fuera ya una encuesta"). */
  convertStudentProposalToFormal: communityManageProcedure
    .input(z.object({
      studentProposalId: z.number().int().positive(),
      questionType: questionTypeEnum,
      options: z.array(z.string().min(1).max(256)).max(20).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const idea = await getStudentProposalById(input.studentProposalId);
      if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "Idea no encontrada" });
      if (idea.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se pueden convertir ideas aprobadas" });

      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertCommunityIdsWithinAccess(access, [idea.communityId]);

      // MG-05 §9/§12 — el Admin puede aceptar tal cual la configuración
      // propuesta por el Student, o cambiarla por completo (este mutation
      // ya lo permitía); en cualquier caso, lo que finalmente se envíe
      // debe ser una combinación válida — mismo validador que community.create.
      const validation = validateQuestionTypeOptions(input.questionType, input.options);
      if (!validation.ok) throw new TRPCError({ code: "BAD_REQUEST", message: validation.error });

      const proposal = await createProposal({
        title: idea.title,
        description: idea.description,
        questionType: input.questionType,
        venueId: idea.venueId,
        startsAt: idea.suggestedDate ? new Date(idea.suggestedDate) : null,
        sourceStudentProposalId: idea.id,
        createdByUserId: ctx.user.id,
        options: validation.cleanOptions.length > 0 ? validation.cleanOptions : undefined,
        communityIds: [idea.communityId],
      });
      await markStudentProposalConverted(idea.id, proposal.id);
      return { success: true, proposal };
    }),

  // ─── AUTOSERVICIO DEL ESTUDIANTE ─────────────────────────────────────────────

  /** Propuestas activas en MI audiencia (hub, spec punto 23). */
  myActive: protectedProcedure.query(async ({ ctx }) => {
    const { communityProposalAudiences, communityProposals, venues } = await import("../../drizzle/schema");
    const { getDb } = await import("../db");
    const { inArray, eq: eqOp, and: andOp } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "BD no disponible" });
    const audienceRows = await db.select({ proposalId: communityProposalAudiences.proposalId })
      .from(communityProposalAudiences).where(eqOp(communityProposalAudiences.userId, ctx.user.id));
    const proposalIds = audienceRows.map(r => r.proposalId);
    if (proposalIds.length === 0) return [];
    const now = new Date();
    const rows = await db.select().from(communityProposals)
      .where(andOp(inArray(communityProposals.id, proposalIds), eqOp(communityProposals.status, "active")));
    const open = rows.filter(p => isProposalOpenForResponses(p, now));

    // Hallazgo real (2026-08-22, captura del cliente): la ubicación de una
    // propuesta nunca se resolvía/mostraba al Student, solo al admin
    // (ProposalListItem.venueName). Batch, sin N+1 — mismo criterio que
    // listProposals() en communityDb.ts.
    const venueIds = Array.from(new Set(open.map(p => p.venueId).filter((v): v is number => v != null)));
    const venueRows = venueIds.length ? await db.select({ id: venues.id, name: venues.name }).from(venues).where(inArray(venues.id, venueIds)) : [];
    const venueNameById = new Map(venueRows.map(v => [v.id, v.name]));

    return open.map(p => ({ ...p, venueName: p.venueId != null ? (venueNameById.get(p.venueId) ?? null) : null }));
  }),

  myResponded: protectedProcedure.query(async ({ ctx }) => {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "BD no disponible" });
    const { eq: eqOp } = await import("drizzle-orm");
    const rows = await db.select({ response: communityResponses, proposal: (await import("../../drizzle/schema")).communityProposals })
      .from(communityResponses)
      .innerJoin((await import("../../drizzle/schema")).communityProposals, eqOp(communityResponses.proposalId, (await import("../../drizzle/schema")).communityProposals.id))
      .where(eqOp(communityResponses.userId, ctx.user.id));
    return rows.map(r => r.proposal);
  }),

  getPublicById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const proposal = await getProposalById(input.id);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });

      // COM-02B (spec §25) — gap preexistente documentado en el informe final
      // de COM-02 (sección AV): esta query nunca comprobaba scoping por
      // comunidad. Un Admin (rol legacy real, mismo criterio que el resto de
      // este router) queda exento — no "pertenece" a una comunidad como
      // Student, gestiona a través de su RBAC real.
      if (ctx.user.role !== "admin" && !(await isProposalVisibleToUser(input.id, ctx.user.id))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a esta propuesta" });
      }

      const options = await listProposalOptions(input.id);
      const myResponse = await getUserResponse(input.id, ctx.user.id);
      const hasResponded = !!myResponse;

      const now = new Date();
      const showResults = computeResultsVisible(proposal, hasResponded, now);

      // Hallazgo real (2026-08-22, captura del cliente): la ubicación de una
      // propuesta nunca se resolvía/mostraba al Student (solo existía para
      // el admin, ver listProposals/ProposalListItem.venueName).
      const venueName = await getVenueName(proposal.venueId, undefined);

      // COM-02B (spec §1-§5) — la ficha social ya no depende solo de
      // status="closed": también se muestra en una propuesta ACTIVA cuando
      // este Student YA respondió (canAccessSocialLayer, communityDb.ts,
      // misma política que assertCanInteract/listComments — nunca una copia
      // divergente). Antes de participar en una propuesta activa, la ficha
      // sigue siendo el VoteForm de siempre, sin ningún cambio.
      const showSocialLayer = canAccessSocialLayer(proposal.status, hasResponded);
      // COM-02C (spec §15/§16/§32) — "último comentario" en la propia ficha:
      // se reutiliza EXACTAMENTE listComments (limit:1) — misma fuente de
      // verdad y misma puerta de acceso (assertCanInteract) que el resto de
      // comentarios, nunca una segunda lógica que pudiera mostrar uno oculto
      // o de una propuesta a la que no se puede acceder. Solo se pide cuando
      // showSocialLayer ya es true (evita una query extra en el camino
      // caliente de VoteForm, spec §32 "no descargar de más").
      const [author, likeState, commentCounts, latestCommentsPage] = showSocialLayer
        ? await Promise.all([
            resolveProposalAuthor(proposal),
            getLikeState(input.id, ctx.user.id),
            getCommentCountsBatch([input.id]),
            listComments(input.id, ctx.user.id, { limit: 1, offset: 0 }),
          ])
        : [null, { liked: false, count: 0 }, new Map<number, number>(), { total: 0, items: [] }];

      return {
        proposal: { ...proposal, description: proposal.description, venueName }, // sin campos admin sensibles adicionales
        options: options.map(o => ({ id: o.id, label: o.label, sortOrder: o.sortOrder })), // sin isPositiveIntent (interno)
        myResponse: myResponse ? { response: myResponse.response, values: myResponse.values } : null,
        hasResponded,
        showSocialLayer,
        results: showResults ? await getProposalResults(input.id, false) : null,
        isOpen: isProposalOpenForResponses(proposal, now),
        author,
        liked: likeState.liked,
        likeCount: likeState.count,
        commentCount: commentCounts.get(input.id) ?? 0,
        latestComment: latestCommentsPage.items[0] ?? null,
      };
    }),

  /**
   * Estudiantes que respondieron — petición del cliente (2026-08-22,
   * captura): avatar-stack estilo Instagram ("X, Y y +230 más asistirán").
   * Autorización propia (nunca confiar solo en protectedProcedure): quien
   * pregunta debe pertenecer a la MISMA audiencia snapshoteada de la
   * propuesta (isInProposalAudience — mismo criterio que myActive) Y sus
   * resultados deben estar visibles (computeResultsVisible, misma política
   * que getPublicById) — nunca una lista de nombres de una propuesta que ni
   * siquiera podrías ver tú mismo.
   */
  getPublicRespondents: protectedProcedure
    .input(z.object({ proposalId: z.number().int().positive(), limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).default(0) }))
    .query(async ({ input, ctx }) => {
      const proposal = await getProposalById(input.proposalId);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });

      const inAudience = await isInProposalAudience(input.proposalId, ctx.user.id);
      if (!inAudience) throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a esta propuesta" });

      const myResponse = await getUserResponse(input.proposalId, ctx.user.id);
      const showResults = computeResultsVisible(proposal, !!myResponse, new Date());
      if (!showResults) throw new TRPCError({ code: "FORBIDDEN", message: "Los resultados de esta propuesta todavía no son visibles" });

      return getProposalRespondents(input.proposalId, { limit: input.limit, offset: input.offset });
    }),

  /**
   * Feed social de Results (COM-02, spec §5) — MISMO conjunto base que
   * myResponded (propuestas donde el Student ya respondió) filtrado
   * server-side a status="closed" (spec §4: reutiliza el lifecycle real,
   * "finalizada" = closed, igual que ya filtraba ResultadosTab en cliente),
   * enriquecido en batch (venueName/author/like+comment counts, sin N+1) con
   * el resultado agregado completo de cada una (getProposalResults ya
   * calcula agregados server-side, spec punto 63 de MG-05 — nunca se
   * recalcula aquí).
   */
  listResultsFeed: protectedProcedure.query(async ({ ctx }) => {
    const { communityProposals } = await import("../../drizzle/schema");
    const { eq: eqOp } = await import("drizzle-orm");
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "BD no disponible" });

    const rows = await db.select({ response: communityResponses, proposal: communityProposals })
      .from(communityResponses)
      .innerJoin(communityProposals, eqOp(communityResponses.proposalId, communityProposals.id))
      .where(eqOp(communityResponses.userId, ctx.user.id));
    const closed = rows.map(r => r.proposal).filter(p => p.status === "closed");
    if (closed.length === 0) return [];

    const ids = closed.map(p => p.id);
    const [likeCounts, commentCounts] = await Promise.all([getLikeCountsBatch(ids), getCommentCountsBatch(ids)]);

    return Promise.all(closed.map(async proposal => ({
      proposal: { ...proposal, venueName: await getVenueName(proposal.venueId, undefined) },
      author: await resolveProposalAuthor(proposal),
      results: await getProposalResults(proposal.id, false),
      likeCount: likeCounts.get(proposal.id) ?? 0,
      commentCount: commentCounts.get(proposal.id) ?? 0,
    })));
  }),

  // ─── COM-02 — Community Social Results: likes ──────────────────────────────

  toggleLike: protectedProcedure
    .input(z.object({ proposalId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await toggleLike(input.proposalId, ctx.user.id);
      } catch (err) {
        mapCommunitySocialError(err);
      }
    }),

  // ─── COM-02 — Community Social Results: comentarios ────────────────────────

  listComments: protectedProcedure
    .input(z.object({ proposalId: z.number().int().positive(), limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).default(0) }))
    .query(async ({ input, ctx }) => {
      try {
        // listComments() ya exige internamente (spec COM-02B §14/§16, misma
        // puerta que createComment/toggleLike, nunca una copia): la propuesta
        // existe, es visible para la comunidad del Student, y está cerrada O
        // activa con este Student ya respondido — nunca duplicar esa
        // comprobación aquí.
        return await listComments(input.proposalId, ctx.user.id, { limit: input.limit, offset: input.offset });
      } catch (err) {
        mapCommunitySocialError(err);
      }
    }),

  createComment: protectedProcedure
    .input(z.object({ proposalId: z.number().int().positive(), content: z.string().min(1).max(1000), parentCommentId: z.number().int().positive().optional() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const proposal = await getProposalById(input.proposalId);
        if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });
        const comment = await createComment({
          proposalId: input.proposalId, userId: ctx.user.id, content: input.content, parentCommentId: input.parentCommentId ?? null,
        });
        const communityIds = await getProposalCommunityIds(input.proposalId);
        const communityId = communityIds[0] ?? null;
        // Best-effort — spec §25, nunca bloquea la creación del comentario ya guardado.
        if (comment.parentCommentId != null) {
          notifyCommentReplied(proposal, comment, communityId).catch(() => {});
        } else {
          notifyProposalCommented(proposal, comment, communityId).catch(() => {});
        }
        return comment;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        mapCommunitySocialError(err);
      }
    }),

  deleteComment: protectedProcedure
    .input(z.object({ commentId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await deleteOwnComment(input.commentId, ctx.user.id);
        return { success: true };
      } catch (err) {
        mapCommunitySocialError(err);
      }
    }),

  /**
   * Moderación Admin (spec §17): listado COMPLETO de comentarios de una
   * propuesta, incluidos los ya ocultos (includeHidden=true) — para que el
   * admin pueda ver qué se moderó y cuándo. Mismo permiso de solo-lectura
   * que getRespondents/getResults (community.view) — moderar de verdad
   * (ocultar) sigue exigiendo community.moderate en moderateComment.
   */
  adminListComments: communityViewProcedure
    .input(z.object({ proposalId: z.number().int().positive(), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) }))
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertProposalAccessible(access, input.proposalId);
      return listComments(input.proposalId, ctx.user.id, { limit: input.limit, offset: input.offset }, true);
    }),

  /** Moderación admin (spec §17) — mismo permiso que setResponseValueVisibility (community.moderate). */
  moderateComment: communityModerateProcedure
    .input(z.object({ commentId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await moderateComment(input.commentId, ctx.user.id);
        return { success: true };
      } catch (err) {
        mapCommunitySocialError(err);
      }
    }),

  respond: protectedProcedure
    .input(z.object({ proposalId: z.number().int().positive(), payload: responsePayloadSchema }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await submitResponse(input.proposalId, ctx.user.id, input.payload as ResponsePayload);
        return { success: true, ...result };
      } catch (err) {
        if (err instanceof CommunityResponseError) {
          const httpCode = err.code === "ALREADY_RESPONDED" ? "CONFLICT" : err.code === "CLOSED" ? "BAD_REQUEST" : err.code === "NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST";
          throw new TRPCError({ code: httpCode, message: err.message });
        }
        throw err;
      }
    }),

  // ─── AUTOSERVICIO — proponer un plan (spec punto 31) ───────────────────────

  submitProposal: protectedProcedure
    .input(z.object({
      communityId: z.number().int().positive(),
      title: z.string().min(1).max(256),
      description: z.string().max(2000).nullish(),
      venueId: z.number().int().positive().nullish(),
      suggestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      category: z.string().max(64).nullish(),
      // MG-04 — coverImageUrl es SIEMPRE la URL ya devuelta por
      // POST /api/community/proposal-image (subida+validación real ya
      // ocurrió ahí) — aquí solo se exige forma de URL válida y acotada.
      // urgency es la preferencia del Student — z.object() por defecto
      // DESCARTA cualquier clave no declarada aquí (status/approved/
      // featured/moderationNotes/etc. nunca llegan a submitStudentProposal
      // aunque el cliente los incluya en el body — perímetro cerrado por
      // el propio esquema, no por una lista de bloqueo aparte).
      coverImageUrl: z.string().url().max(512).nullish(),
      urgency: z.enum(["no_rush", "soon", "urgent"]).nullish(),
      // MG-05 — Student Proposal Voting Configuration (spec §3-9). Mismo
      // enum canónico que Admin (questionTypeEnum) — nunca un tipo
      // paralelo. Ambos opcionales: proponer configuración de voto nunca
      // es obligatorio para enviar una idea.
      proposedQuestionType: questionTypeEnum.optional(),
      proposedOptions: z.array(z.string().min(1).max(256)).max(20).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Community Proposals backlog — bug real (IDOR) encontrado en la
      // auditoría: nunca se comprobaba que `communityId` fuera una comunidad
      // REAL del Student que llama. El cliente siempre envía la suya (vía
      // useCommunity()), pero nada impedía manipular el body de la petición
      // para proponer en la comunidad de otro. La comunidad SIEMPRE debe
      // derivarse de la membresía real, nunca de un valor que el cliente
      // pueda elegir sin verificación server-side.
      const memberships = await getUserCommunities(ctx.user.id);
      if (!memberships.some(m => m.communityId === input.communityId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No perteneces a esa comunidad" });
      }
      const idea = await submitStudentProposal({ ...input, studentUserId: ctx.user.id });
      // Best-effort — spec §15.B, nunca bloquea el guardado real de la idea.
      notifyStudentProposalSubmitted(idea, ctx.user.name ?? null).catch(() => {});
      return { success: true, idea };
    }),

  myProposals: protectedProcedure.query(async ({ ctx }) => {
    const { items } = await listStudentProposals({ communityIds: "all", studentUserId: ctx.user.id, limit: 100 });
    return items;
  }),

  trending: protectedProcedure
    .input(z.object({ communityId: z.number().int().positive().optional() }))
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      if (access === "all") {
        return listTrendingStudentProposals(input.communityId ? [input.communityId] : "all");
      }
      // No es admin global — el alcance real de un Student es su propia
      // membresía (getUserCommunities), nunca "all": sin este chequeo,
      // cualquier Student autenticado podía omitir communityId (o pasar el
      // de otra comunidad) y recibir los nombres/ideas pendientes de
      // moderación de estudiantes de otras comunidades.
      if (!input.communityId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "communityId requerido" });
      }
      const memberships = await getUserCommunities(ctx.user.id);
      if (!memberships.some(m => m.communityId === input.communityId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No perteneces a esa comunidad" });
      }
      return listTrendingStudentProposals([input.communityId]);
    }),

  support: protectedProcedure
    .input(z.object({ studentProposalId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await supportStudentProposal(input.studentProposalId, ctx.user.id);
      return { success: true, supportCount: await getSupportCount(input.studentProposalId) };
    }),

  unsupport: protectedProcedure
    .input(z.object({ studentProposalId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await unsupportStudentProposal(input.studentProposalId, ctx.user.id);
      return { success: true, supportCount: await getSupportCount(input.studentProposalId) };
    }),

  hasSupported: protectedProcedure
    .input(z.object({ studentProposalId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => hasUserSupported(input.studentProposalId, ctx.user.id)),
});
