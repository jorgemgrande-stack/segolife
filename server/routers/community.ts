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
  isProposalOpenForResponses,
} from "../segolife/community/communityDb";
import { previewProposalAudience, publishProposal, CommunityPublishError } from "../segolife/community/communityAudienceService";
import { submitResponse, getUserResponse, CommunityResponseError, type ResponsePayload } from "../segolife/community/communityResponseService";
import { getProposalResults } from "../segolife/community/communityResultsService";
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
      const { communityIds, ...fields } = input;
      const proposal = await createProposal({ ...fields, createdByUserId: ctx.user.id, communityIds }, undefined);
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

      const proposal = await createProposal({
        title: idea.title,
        description: idea.description,
        questionType: input.questionType,
        venueId: idea.venueId,
        startsAt: idea.suggestedDate ? new Date(idea.suggestedDate) : null,
        sourceStudentProposalId: idea.id,
        createdByUserId: ctx.user.id,
        options: input.options,
        communityIds: [idea.communityId],
      });
      await markStudentProposalConverted(idea.id, proposal.id);
      return { success: true, proposal };
    }),

  // ─── AUTOSERVICIO DEL ESTUDIANTE ─────────────────────────────────────────────

  /** Propuestas activas en MI audiencia (hub, spec punto 23). */
  myActive: protectedProcedure.query(async ({ ctx }) => {
    const { communityProposalAudiences, communityProposals } = await import("../../drizzle/schema");
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
    return rows.filter(p => isProposalOpenForResponses(p, now));
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
      const options = await listProposalOptions(input.id);
      const myResponse = await getUserResponse(input.id, ctx.user.id);

      const now = new Date();
      const showResults =
        proposal.resultsVisibility === "immediate" ||
        (proposal.resultsVisibility === "after_vote" && !!myResponse) ||
        (proposal.resultsVisibility === "after_close" && (proposal.status === "closed" || (proposal.endsAt != null && proposal.endsAt.getTime() < now.getTime())));

      return {
        proposal: { ...proposal, description: proposal.description }, // sin campos admin sensibles adicionales
        options: options.map(o => ({ id: o.id, label: o.label, sortOrder: o.sortOrder })), // sin isPositiveIntent (interno)
        myResponse: myResponse ? { response: myResponse.response, values: myResponse.values } : null,
        results: showResults ? await getProposalResults(input.id, false) : null,
        isOpen: isProposalOpenForResponses(proposal, now),
      };
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
    .query(async ({ input }) => listTrendingStudentProposals(input.communityId ? [input.communityId] : "all")),

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
