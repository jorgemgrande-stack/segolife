/**
 * referrals.ts — router de SEGOLIFE REFERRAL & INVITE REWARDS ENGINE (Fase
 * 8). Mismo patrón que community.ts/tokens.ts: permissionProcedure para
 * administración (referrals.view/referrals.manage, GLOBAL_ADMIN
 * exclusivamente — spec §75, ver venueAdminPolicy.ts VENUE_ADMIN_FORBIDDEN_MODULES),
 * protectedProcedure para el propio Student (solo SU resumen — spec §33-34,
 * nunca el de otro referrer, spec §60), publicProcedure para la landing de
 * invitación (spec §30/§60-62 — respuesta mínima, nunca PII del referrer).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, permissionProcedure } from "../_core/trpc";
import {
  getStudentReferralSummary,
  resolvePublicReferralLanding,
  listReferralCampaigns,
  getReferralCampaignById,
  createReferralCampaign,
  updateReferralCampaign,
  activateReferralCampaign,
  setReferralCampaignStatus,
  listReferralsForAdmin,
  getReferralOverview,
  getCampaignAnalytics,
  retryReferralReward,
  findReferralsPendingReconciliation,
  ReferralCampaignValidationError,
} from "../segolife/referrals/referralService";

const referralsViewProcedure = permissionProcedure("referrals.view", ["admin"]);
const referralsManageProcedure = permissionProcedure("referrals.manage", ["admin"]);

const conversionConditionEnum = z.enum(["account_created", "verified_student", "profile_completed", "first_venue_visit", "first_event_attendance"]);

function mapCampaignError(err: unknown): never {
  if (err instanceof ReferralCampaignValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

export const referralsRouter = router({
  // ─── Student — mi propio resumen (spec §32-34) ───────────────────────────
  mySummary: protectedProcedure.query(async ({ ctx }) => {
    return getStudentReferralSummary(ctx.user.id);
  }),

  // ─── Público — landing de invitación (spec §30/§60-62) ──────────────────
  publicLanding: publicProcedure
    .input(z.object({ code: z.string().min(1).max(32), communityId: z.number().int().positive().optional() }))
    .query(async ({ input }) => {
      return resolvePublicReferralLanding(input.code, input.communityId ?? null);
    }),

  // ─── Admin — campañas (spec §41-45, GLOBAL_ADMIN) ────────────────────────
  listCampaigns: referralsViewProcedure.query(async () => listReferralCampaigns()),

  getCampaign: referralsViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const campaign = await getReferralCampaignById(input.id);
      if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaña no encontrada" });
      return campaign;
    }),

  createCampaign: referralsManageProcedure
    .input(z.object({
      name: z.string().min(1).max(256),
      communityId: z.number().int().positive().nullable(),
      inviterRewardTokens: z.number().int().min(0),
      inviteeRewardTokens: z.number().int().min(0),
      conversionCondition: conversionConditionEnum,
      attributionWindowDays: z.number().int().positive(),
      maxRewardsPerInviter: z.number().int().positive().nullable(),
      maxTotalConversions: z.number().int().positive().nullable(),
      budgetTokens: z.number().int().positive().nullable(),
      priority: z.number().int().default(0),
      startsAt: z.date().nullable(),
      endsAt: z.date().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await createReferralCampaign({ ...input, createdByUserId: ctx.user.id });
      } catch (err) {
        mapCampaignError(err);
      }
    }),

  updateCampaign: referralsManageProcedure
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().min(1).max(256).optional(),
      communityId: z.number().int().positive().nullable().optional(),
      inviterRewardTokens: z.number().int().min(0).optional(),
      inviteeRewardTokens: z.number().int().min(0).optional(),
      conversionCondition: conversionConditionEnum.optional(),
      attributionWindowDays: z.number().int().positive().optional(),
      maxRewardsPerInviter: z.number().int().positive().nullable().optional(),
      maxTotalConversions: z.number().int().positive().nullable().optional(),
      budgetTokens: z.number().int().positive().nullable().optional(),
      priority: z.number().int().optional(),
      startsAt: z.date().nullable().optional(),
      endsAt: z.date().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...rest } = input;
      try {
        return await updateReferralCampaign(id, rest);
      } catch (err) {
        mapCampaignError(err);
      }
    }),

  activateCampaign: referralsManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await activateReferralCampaign(input.id, ctx.user.id);
      } catch (err) {
        mapCampaignError(err);
      }
    }),

  pauseCampaign: referralsManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => setReferralCampaignStatus(input.id, "paused")),

  endCampaign: referralsManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => setReferralCampaignStatus(input.id, "ended")),

  archiveCampaign: referralsManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => setReferralCampaignStatus(input.id, "archived")),

  // ─── Admin — referidos y analítica (spec §39-40, §73-74) ─────────────────
  listReferrals: referralsViewProcedure
    .input(z.object({
      campaignId: z.number().int().positive().optional(),
      status: z.enum(["registered", "converted", "rewarded", "ineligible", "expired", "cancelled"]).optional(),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    }))
    .query(async ({ input }) => listReferralsForAdmin(input)),

  overview: referralsViewProcedure.query(async () => getReferralOverview()),

  campaignAnalytics: referralsViewProcedure
    .input(z.object({ campaignId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const analytics = await getCampaignAnalytics(input.campaignId);
      if (!analytics) throw new TRPCError({ code: "NOT_FOUND", message: "Campaña no encontrada" });
      return analytics;
    }),

  pendingReconciliation: referralsViewProcedure.query(async () => findReferralsPendingReconciliation()),

  retryReward: referralsManageProcedure
    .input(z.object({ referralId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await retryReferralReward(input.referralId);
      return { ok: true };
    }),
});
