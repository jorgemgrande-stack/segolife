import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, permissionProcedure } from "../_core/trpc";
import { getCommunityAccess, type CommunityAccess } from "../_core/communityAccess";
import { getUserCommunities } from "../db/communitiesDb";
import {
  ensureWallet,
  listLedgerByUserId,
  getLedgerById,
  adjustManualTokens,
  reverseTransaction,
  getGlobalTokenStats,
  listRecentLedgerGlobal,
  TokenEngineError,
} from "../segolife/tokens/tokenLedgerService";
import {
  listTokenRules,
  getTokenRuleById,
  createTokenRule,
  updateTokenRule,
  setTokenRuleActive,
} from "../db/tokenRulesDb";
import {
  listTokenCampaigns,
  getTokenCampaignById,
  createTokenCampaign,
  updateTokenCampaign,
  setTokenCampaignActive,
  setCampaignScope,
} from "../db/tokenCampaignsDb";
import {
  listVenueProducts,
  createVenueProduct,
  updateVenueProduct,
  setVenueProductActive,
} from "../db/venueProductsDb";
import {
  listSchedulesByVenue,
  createSchedule,
  deleteSchedule,
  setScheduleActive,
} from "../segolife/tokens/tokenScheduleService";
import { getActivationReadinessSnapshot } from "../segolife/tokens/activationReadinessService";
import { getEconomyOverviewExtras } from "../segolife/tokens/economyOverviewService";
import { evaluateReward } from "../segolife/tokens/rewardEngine";
import { LIVE_LOYALTY_ENABLED } from "../segolife/tokens/tokenEngine";

const tokensViewProcedure = permissionProcedure("tokens.view", ["admin"]);
const tokensManageProcedure = permissionProcedure("tokens.manage", ["admin"]);
const tokensAdjustProcedure = permissionProcedure("tokens.adjust", ["admin"]);
const tokensRulesManageProcedure = permissionProcedure("tokens.rules.manage", ["admin"]);

/** Lanza FORBIDDEN si el alcance del admin no cubre ninguna comunidad del usuario objetivo. */
async function assertUserAccessible(access: CommunityAccess, targetUserId: number) {
  if (access === "all") return;
  const memberships = await getUserCommunities(targetUserId);
  const hasOverlap = memberships.some(m => access.includes(m.communityId));
  if (!hasOverlap) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este usuario" });
  }
}

function mapEngineError(err: unknown): never {
  if (err instanceof TokenEngineError) {
    const codeMap: Record<string, "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT"> = {
      INVALID_AMOUNT: "BAD_REQUEST",
      INSUFFICIENT_BALANCE: "BAD_REQUEST",
      NOT_FOUND: "NOT_FOUND",
      ALREADY_REVERSED: "CONFLICT",
      REASON_REQUIRED: "BAD_REQUEST",
      OUTSIDE_SCHEDULE: "BAD_REQUEST",
      NO_RULE_FOUND: "BAD_REQUEST",
      RULE_LIMIT_EXCEEDED: "BAD_REQUEST",
      GLOBAL_LIVE_DISABLED: "BAD_REQUEST",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message });
  }
  throw err;
}

const ruleInputSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(4000).nullish(),
  direction: z.enum(["earn", "spend"]),
  origin: z.enum(["attendance", "event", "ticket", "purchase", "consumption", "product", "manual", "recurrence", "campaign"]),
  // "ticket_type" (Loyalty Production Hardening, 2026-08-14) — scope determinista
  // por event_ticket_types.id (nunca por nombre), ver drizzle/schema.ts.
  scope: z.enum(["global", "community", "venue", "event", "product", "ticket_type"]).default("global"),
  scopeCommunityId: z.number().int().positive().nullish(),
  scopeVenueId: z.number().int().positive().nullish(),
  scopeEventId: z.number().int().positive().nullish(),
  scopeProductId: z.number().int().positive().nullish(),
  scopeTicketTypeId: z.number().int().positive().nullish(),
  calcMethod: z.enum(["fixed", "per_euro", "percentage", "multiplier"]).default("fixed"),
  fixedAmount: z.number().int().nullish(),
  rate: z.string().nullish(),
  multiplier: z.string().nullish(),
  minSpend: z.string().nullish(),
  maxTokens: z.number().int().positive().nullish(),
  dailyLimit: z.number().int().positive().nullish(),
  weeklyLimit: z.number().int().positive().nullish(),
  monthlyLimit: z.number().int().positive().nullish(),
  lifetimeLimit: z.number().int().positive().nullish(),
  // "lifetime" (Loyalty Production Hardening) — hitos/first-action reales sin reinicio periódico.
  recurrenceWindow: z.enum(["day", "week", "month", "lifetime"]).nullish(),
  recurrenceThreshold: z.number().int().positive().nullish(),
  recurrenceMode: z.enum(["visit_count", "distinct_venues"]).nullish(),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  priority: z.number().int().default(0),
});

const campaignInputSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(4000).nullish(),
  multiplier: z.string().nullish(),
  bonusTokens: z.number().int().nullish(),
  // Loyalty Production Hardening — presupuesto total de la campaña (NULL = sin presupuesto, comportamiento sin cambio).
  maxTotalTokens: z.number().int().positive().nullish(),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  priority: z.number().int().default(0),
});

const productInputSchema = z.object({
  venueId: z.number().int().positive(),
  name: z.string().min(1).max(256),
  slug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  category: z.string().max(64).nullish(),
  price: z.string().nullish(),
});

const scheduleInputSchema = z.object({
  venueId: z.number().int().positive(),
  operationType: z.enum(["earn", "spend"]),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().max(64).optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export const tokensRouter = router({
  // ─── ADMIN — wallet / ledger de un usuario concreto ────────────────────────

  getWallet: tokensViewProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertUserAccessible(access, input.userId);
      // Lazy: crea el wallet en el primer vistazo admin, mismo patrón que
      // ensureStudentProfile en studentsDb.ts — idempotente, sin efecto visible.
      return ensureWallet(input.userId);
    }),

  listLedger: tokensViewProcedure
    .input(z.object({ userId: z.number().int().positive(), limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) }))
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertUserAccessible(access, input.userId);
      return listLedgerByUserId(input.userId, { limit: input.limit, offset: input.offset });
    }),

  adjustManual: tokensAdjustProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      direction: z.enum(["credit", "debit"]),
      amount: z.number().int().positive(),
      reason: z.string().min(1).max(256),
    }))
    .mutation(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertUserAccessible(access, input.userId);
      try {
        const result = await adjustManualTokens({ ...input, adminUserId: ctx.user.id });
        return { success: true, ...result };
      } catch (err) {
        mapEngineError(err);
      }
    }),

  reverseLedger: tokensAdjustProcedure
    .input(z.object({ ledgerId: z.number().int().positive(), reason: z.string().min(1).max(256) }))
    .mutation(async ({ input, ctx }) => {
      const original = await getLedgerById(input.ledgerId);
      if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Movimiento no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      await assertUserAccessible(access, original.userId);
      try {
        const result = await reverseTransaction({ ledgerId: input.ledgerId, reason: input.reason, adminUserId: ctx.user.id });
        return { success: true, ...result };
      } catch (err) {
        mapEngineError(err);
      }
    }),

  // ─── ADMIN — reglas ─────────────────────────────────────────────────────────

  listRules: tokensViewProcedure.query(async () => listTokenRules()),
  getRuleById: tokensViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rule = await getTokenRuleById(input.id);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Regla no encontrada" });
      return rule;
    }),
  createRule: tokensRulesManageProcedure
    .input(ruleInputSchema)
    .mutation(async ({ input }) => ({ success: true, rule: await createTokenRule(input) })),
  updateRule: tokensRulesManageProcedure
    .input(z.object({ id: z.number().int().positive() }).merge(ruleInputSchema.partial()))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      const rule = await updateTokenRule(id, fields);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Regla no encontrada" });
      return { success: true, rule };
    }),
  setRuleActive: tokensRulesManageProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      const rule = await setTokenRuleActive(input.id, input.active);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Regla no encontrada" });
      return { success: true, rule };
    }),

  // ─── ADMIN — campañas ───────────────────────────────────────────────────────

  listCampaigns: tokensViewProcedure.query(async () => listTokenCampaigns()),
  getCampaignById: tokensViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const campaign = await getTokenCampaignById(input.id);
      if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaña no encontrada" });
      return campaign;
    }),
  createCampaign: tokensManageProcedure
    .input(campaignInputSchema)
    .mutation(async ({ input }) => ({ success: true, campaign: await createTokenCampaign(input) })),
  updateCampaign: tokensManageProcedure
    .input(z.object({ id: z.number().int().positive() }).merge(campaignInputSchema.partial()))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      const campaign = await updateTokenCampaign(id, fields);
      if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaña no encontrada" });
      return { success: true, campaign };
    }),
  setCampaignActive: tokensManageProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      const campaign = await setTokenCampaignActive(input.id, input.active);
      if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaña no encontrada" });
      return { success: true, campaign };
    }),
  setCampaignScope: tokensManageProcedure
    .input(z.object({
      id: z.number().int().positive(),
      communityIds: z.array(z.number().int().positive()).default([]),
      venueIds: z.array(z.number().int().positive()).default([]),
      eventIds: z.array(z.number().int().positive()).default([]),
    }))
    .mutation(async ({ input }) => {
      const { id, ...scope } = input;
      await setCampaignScope(id, scope);
      return { success: true };
    }),

  // ─── ADMIN — productos del venue ────────────────────────────────────────────

  listVenueProducts: tokensViewProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ input }) => listVenueProducts(input.venueId)),
  createVenueProduct: tokensManageProcedure
    .input(productInputSchema)
    .mutation(async ({ input }) => ({ success: true, product: await createVenueProduct(input) })),
  updateVenueProduct: tokensManageProcedure
    .input(z.object({ id: z.number().int().positive() }).merge(productInputSchema.partial().omit({ venueId: true })))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      const product = await updateVenueProduct(id, fields);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Producto no encontrado" });
      return { success: true, product };
    }),
  setVenueProductActive: tokensManageProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      const product = await setVenueProductActive(input.id, input.active);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Producto no encontrado" });
      return { success: true, product };
    }),

  // ─── ADMIN — horarios earn/spend por venue ──────────────────────────────────

  listSchedules: tokensViewProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ input }) => listSchedulesByVenue(input.venueId)),
  createSchedule: tokensManageProcedure
    .input(scheduleInputSchema)
    .mutation(async ({ input }) => ({ success: true, schedule: await createSchedule(input) })),
  deleteSchedule: tokensManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await deleteSchedule(input.id);
      return { success: true };
    }),
  setScheduleActive: tokensManageProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      const schedule = await setScheduleActive(input.id, input.active);
      if (!schedule) throw new TRPCError({ code: "NOT_FOUND", message: "Horario no encontrado" });
      return { success: true, schedule };
    }),

  // ─── ADMIN — dashboard ──────────────────────────────────────────────────────

  dashboardSummary: tokensViewProcedure.query(async () => {
    const [rules, campaigns, stats, recentMovements, extras] = await Promise.all([
      listTokenRules(),
      listTokenCampaigns(),
      getGlobalTokenStats(),
      listRecentLedgerGlobal(20),
      getEconomyOverviewExtras(),
    ]);
    return {
      ...stats,
      activeRulesCount: rules.filter(r => r.active).length,
      activeCampaignsCount: campaigns.filter(c => c.active).length,
      totalRulesCount: rules.length,
      totalCampaignsCount: campaigns.length,
      recentMovements,
      ...extras,
      // Estimación analítica (spec §9) — nunca cash value, nunca altera lo que gana un Student.
      estimatedPromotionalLiabilityCents: stats.totalBalance * extras.estimatedTokenValueCents,
      // SegoTokens Live Activation (spec §19/§26) — estado real, nunca hardcodeado en el frontend.
      globalLiveEnabled: LIVE_LOYALTY_ENABLED,
    };
  }),

  // Loyalty Production Hardening (spec §19) — diagnóstico mínimo, NUNCA un botón "Activate Loyalty".
  activationReadiness: tokensViewProcedure.query(async () => {
    return getActivationReadinessSnapshot();
  }),

  /**
   * SEGOTOKENS ECONOMY (spec §26) — Rule Preview/Simulador. SIEMPRE vía
   * evaluateReward(ctx, "SIMULATION") real — nunca una calculadora paralela
   * en el frontend. Requiere un Student real (userId) para que los
   * topes/recurrencia se calculen contra su historial real de token_ledger
   * — sin esto, cualquier preview de topes/recurrencia sería ficticio.
   * SIMULATION nunca persiste nada (mismo motor que usa Shadow).
   */
  previewReward: tokensViewProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      origin: z.enum(["attendance", "event", "ticket", "purchase", "consumption", "product", "manual", "recurrence", "campaign"]),
      venueId: z.number().int().positive().optional(),
      eventId: z.number().int().positive().optional(),
      communityId: z.number().int().positive().optional(),
      amountSpent: z.number().nonnegative().optional(),
    }))
    .query(async ({ input }) => {
      const result = await evaluateReward({
        userId: input.userId, origin: input.origin, venueId: input.venueId ?? null, eventId: input.eventId ?? null,
        communityId: input.communityId ?? null, amountSpent: input.amountSpent,
      }, "SIMULATION");
      return result.explanation;
    }),

  // ─── AUTOSERVICIO DEL ESTUDIANTE ────────────────────────────────────────────

  getMyWallet: protectedProcedure.query(async ({ ctx }) => {
    return ensureWallet(ctx.user.id);
  }),

  listMyLedger: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) }))
    .query(async ({ input, ctx }) => {
      return listLedgerByUserId(ctx.user.id, { limit: input.limit, offset: input.offset });
    }),
});
