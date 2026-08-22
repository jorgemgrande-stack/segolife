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
  findActiveGrantBySource,
  TokenEngineError,
} from "../segolife/tokens/tokenLedgerService";
import { getMyOrderById } from "../segolife/ticketing/ticketingDb";
import { retryPendingTokenClawbacks } from "../segolife/tokens/tokenClawbackReconciliationService";
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
  listTokenRedemptionPolicies,
  getTokenRedemptionPolicyById,
  createTokenRedemptionPolicy,
  updateTokenRedemptionPolicy,
  setTokenRedemptionPolicyActive,
} from "../db/tokenRedemptionPoliciesDb";
import {
  listSchedulesByVenue,
  createSchedule,
  deleteSchedule,
  setScheduleActive,
} from "../segolife/tokens/tokenScheduleService";
import { getActivationReadinessSnapshot } from "../segolife/tokens/activationReadinessService";
import {
  getEconomyGovernanceOverview,
  detectEconomyConflicts,
  previewRuleForScope,
  listEconomyConfigChanges,
  applyTokenRuleValueChange,
  setGlobalRedemptionConversion,
  setGlobalReferralEconomics,
  EconomyGovernanceError,
} from "../segolife/tokens/economyGovernanceService";
import { getEconomyOverviewExtras } from "../segolife/tokens/economyOverviewService";
import { evaluateReward } from "../segolife/tokens/rewardEngine";
import { LIVE_LOYALTY_ENABLED } from "../segolife/tokens/tokenEngine";
import { quoteTokenSpend } from "../segolife/tokens/tokenSpendService";
import {
  previewMyReward,
  previewMyEventReward,
  previewMyRewardBatch,
  previewMyEventRewardBatch,
  previewMyWalletValue,
  MAX_BATCH_PREVIEW_ITEMS,
} from "../segolife/tokens/studentRewardPreviewService";

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
  // F60 (saneamiento funcional) — community_response/community_proposal_approved
  // faltaban aquí: son orígenes con reglas REALES activas en producción
  // (communityResponseService.ts/communityAudienceService.ts), pero no podían
  // crearse/editarse desde el formulario admin estándar — solo dándolas de
  // alta directamente en la base de datos. Nunca una discrepancia aceptable.
  origin: z.enum(["attendance", "event", "ticket", "purchase", "consumption", "product", "manual", "recurrence", "campaign", "community_response", "community_proposal_approved"]),
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
  imageUrl: z.string().max(512).nullish(),
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

// SEGOTOKENS REWARD PREVIEW (Fase 10.6) — orígenes previsualizables por un
// Student sobre SÍ MISMO. Incluye community_response/community_proposal_approved
// (producción confirma reglas activas reales id=8/9, communityResponseService.ts
// las usa de verdad) — pero NUNCA "manual" (ajuste discrecional de admin, nada
// que un Student pueda "previsualizar" antes de que ocurra).
const PREVIEW_MY_REWARD_ORIGINS = [
  "attendance", "event", "ticket", "purchase", "consumption", "product",
  "recurrence", "campaign", "community_response", "community_proposal_approved",
] as const;

// SEGOLIFE — SEGOTOKENS UNIVERSAL SPEND (Fase 7).
const redemptionPolicyInputSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(4000).nullish(),
  communityId: z.number().int().positive().nullish(),
  venueId: z.number().int().positive().nullish(),
  eventId: z.number().int().positive().nullish(),
  tokensPerUnit: z.number().int().positive().default(1),
  valueCentsPerUnit: z.number().int().positive(),
  minTokenSpend: z.number().int().positive().nullish(),
  maxTokenSpend: z.number().int().positive().nullish(),
  maxPercentage: z.number().int().min(0).max(100).nullish(),
  allowFullTokenPayment: z.boolean().default(false),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  priority: z.number().int().default(0),
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

  /**
   * FIX-01 — resolución manual inmediata: reintenta AHORA MISMO cualquier
   * clawback de SegoTokens que quedara pendiente por un fallo transitorio
   * (ver ticketCancellationService.ts/doorSaleService.ts/ticketPurchasePipeline.ts).
   * Reutiliza el MISMO reconciliador que el job programado — nunca una
   * segunda lógica de reversión. Sin filtro por comunidad: la deuda
   * económica es transversal, igual que reverseLedger no lo tiene tampoco
   * para un movimiento suelto.
   */
  retryPendingClawbacks: tokensAdjustProcedure.mutation(async () => retryPendingTokenClawbacks()),

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

  // ─── ADMIN — políticas de canje (SegoTokens Universal Spend, Fase 7) ────────
  // Financieramente sensible (spec §46: "changing ST value is financially
  // sensitive") — mismo permiso tokensManageProcedure que campañas, NUNCA
  // añadido a VENUE_ADMIN_PERMISSION_BUNDLE.

  listRedemptionPolicies: tokensViewProcedure.query(async () => listTokenRedemptionPolicies()),
  getRedemptionPolicyById: tokensViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const policy = await getTokenRedemptionPolicyById(input.id);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Política no encontrada" });
      return policy;
    }),
  createRedemptionPolicy: tokensManageProcedure
    .input(redemptionPolicyInputSchema)
    .mutation(async ({ ctx, input }) => ({ success: true, policy: await createTokenRedemptionPolicy({ ...input, createdByUserId: ctx.user.id }) })),
  updateRedemptionPolicy: tokensManageProcedure
    .input(z.object({ id: z.number().int().positive() }).merge(redemptionPolicyInputSchema.partial()))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      const policy = await updateTokenRedemptionPolicy(id, fields);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Política no encontrada" });
      return { success: true, policy };
    }),
  setRedemptionPolicyActive: tokensManageProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      const policy = await setTokenRedemptionPolicyActive(input.id, input.active);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Política no encontrada" });
      return { success: true, policy };
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
      origin: z.enum(["attendance", "event", "ticket", "purchase", "consumption", "product", "manual", "recurrence", "campaign", "community_response", "community_proposal_approved"]),
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

  /**
   * SEGOLIFE — SEGOTOKENS UNIVERSAL SPEND (Fase 7, spec §35/§36):
   * previsualización de autoservicio para el propio Student — nunca expone
   * "500 ST = X€ en todas partes" (las políticas pueden variar por venue/
   * evento), solo el valor EXACTO para ESTE contexto concreto. userId
   * siempre viene de ctx.user.id — un Student nunca puede previsualizar (ni
   * mucho menos comprometer) el saldo de otro.
   */
  myQuoteTokenSpend: protectedProcedure
    .input(z.object({
      venueId: z.number().int().positive().nullish(),
      eventId: z.number().int().positive().nullish(),
      grossAmountCents: z.number().int().min(0),
      requestedTokens: z.number().int().min(0),
    }))
    .query(async ({ input, ctx }) => {
      return quoteTokenSpend({
        userId: ctx.user.id, venueId: input.venueId, eventId: input.eventId,
        grossAmountCents: input.grossAmountCents, requestedTokens: input.requestedTokens,
      });
    }),

  // ─── SEGOTOKENS ECONOMY CONTROL CENTER (Fase 10.5) ──────────────────────────
  // Capa de GOBIERNO sobre token_rules/token_campaigns/
  // token_redemption_policies/referral_campaigns — reutiliza tokens.view/
  // tokens.manage (mismo dominio RBAC, nunca un permiso nuevo duplicado).

  economyGovernanceOverview: tokensViewProcedure.query(() => getEconomyGovernanceOverview()),

  economyConflicts: tokensViewProcedure.query(() => detectEconomyConflicts()),

  economyConfigChanges: tokensViewProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }))
    .query(({ input }) => listEconomyConfigChanges(input.limit)),

  /**
   * "¿Qué regla ganaría para este alcance EN GENERAL?" (spec §25/§26) — SIN
   * Student, distinto de previewReward (que exige un Student real para
   * topes/recurrencia). Útil para que el admin entienda la PRECEDENCIA antes
   * de tocar nada.
   */
  previewRuleForScope: tokensViewProcedure
    .input(z.object({
      direction: z.enum(["earn", "spend"]),
      origin: z.enum(["attendance", "event", "ticket", "purchase", "consumption", "product", "manual", "recurrence", "campaign", "community_response", "community_proposal_approved"]),
      venueId: z.number().int().positive().optional(),
      eventId: z.number().int().positive().optional(),
      communityId: z.number().int().positive().optional(),
      productId: z.number().int().positive().optional(),
    }))
    .query(({ input }) => previewRuleForScope(input)),

  applyTokenRuleValueChange: tokensManageProcedure
    .input(z.object({
      ruleId: z.number().int().positive(),
      fixedAmount: z.number().int().min(0).nullish(),
      rate: z.string().regex(/^\d+(\.\d{1,4})?$/).nullish(),
      reason: z.string().min(1).max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { ruleId, reason, ...fields } = input;
        return await applyTokenRuleValueChange(ruleId, fields, ctx.user.id, reason);
      } catch (err) {
        if (err instanceof EconomyGovernanceError) throw new TRPCError({ code: err.code === "NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST", message: err.message });
        throw err;
      }
    }),

  setGlobalRedemptionConversion: tokensManageProcedure
    .input(z.object({
      tokensPerUnit: z.number().int().positive(),
      valueCentsPerUnit: z.number().int().positive(),
      maxPercentage: z.number().int().min(0).max(100).optional(),
      allowFullTokenPayment: z.boolean().optional(),
      reason: z.string().min(1).max(500),
    }))
    .mutation(({ input, ctx }) => setGlobalRedemptionConversion({ ...input, actorUserId: ctx.user.id })),

  setGlobalReferralEconomics: tokensManageProcedure
    .input(z.object({
      inviterRewardTokens: z.number().int().min(0),
      inviteeRewardTokens: z.number().int().min(0),
      // "verified_student" excluido a propósito — sin hecho real de verificación (ver economyGovernanceService.ts).
      conversionCondition: z.enum(["account_created", "profile_completed", "first_venue_visit", "first_event_attendance"]),
      reason: z.string().min(1).max(500),
    }))
    .mutation(({ input, ctx }) => setGlobalReferralEconomics({ ...input, actorUserId: ctx.user.id })),

  // ─── SEGOTOKENS REWARD PREVIEW & ECONOMY TRANSPARENCY (Fase 10.6) ──────────
  // Autoservicio de Student — SIEMPRE protectedProcedure, SIEMPRE
  // userId=ctx.user.id (nunca un input del cliente, spec §60: "server always
  // resolves"). Solo lectura — evaluateReward en modo SIMULATION nunca
  // persiste, igual que previewReward (arriba) pero sin exigir permiso de
  // admin, para que cualquier Student autenticado pueda previsualizar SU
  // PROPIA recompensa.

  previewMyReward: protectedProcedure
    .input(z.object({
      origin: z.enum(PREVIEW_MY_REWARD_ORIGINS),
      venueId: z.number().int().positive().optional(),
      eventId: z.number().int().positive().optional(),
      communityId: z.number().int().positive().optional(),
      amountSpent: z.number().nonnegative().optional(),
    }))
    .query(({ input, ctx }) => previewMyReward({ ...input, userId: ctx.user.id })),

  previewMyEventReward: protectedProcedure
    .input(z.object({
      eventId: z.number().int().positive(),
      venueId: z.number().int().positive().optional(),
      communityId: z.number().int().positive().optional(),
      amountSpent: z.number().nonnegative().optional(),
    }))
    .query(({ input, ctx }) => previewMyEventReward({ ...input, userId: ctx.user.id })),

  previewMyRewardBatch: protectedProcedure
    .input(z.object({
      items: z.array(z.object({
        key: z.string().min(1).max(64),
        origin: z.enum(PREVIEW_MY_REWARD_ORIGINS),
        venueId: z.number().int().positive().optional(),
        eventId: z.number().int().positive().optional(),
        communityId: z.number().int().positive().optional(),
        amountSpent: z.number().nonnegative().optional(),
      })).max(MAX_BATCH_PREVIEW_ITEMS),
    }))
    .query(({ input, ctx }) => previewMyRewardBatch(ctx.user.id, input.items)),

  previewMyEventRewardBatch: protectedProcedure
    .input(z.object({
      items: z.array(z.object({
        key: z.string().min(1).max(64),
        eventId: z.number().int().positive(),
        venueId: z.number().int().positive().optional(),
        communityId: z.number().int().positive().optional(),
        amountSpent: z.number().nonnegative().optional(),
      })).max(MAX_BATCH_PREVIEW_ITEMS),
    }))
    .query(({ input, ctx }) => previewMyEventRewardBatch(ctx.user.id, input.items)),

  myWalletPromotionalValue: protectedProcedure.query(({ ctx }) => previewMyWalletValue(ctx.user.id)),

  /**
   * MG-02 — Confirmación de compra (spec §11): a diferencia de previewMy*
   * (siempre una SIMULACIÓN), esto responde con el HECHO real: ¿ya se
   * concedió de verdad la recompensa de compra de ESTE pedido? Nunca debe
   * usarse para decidir si mostrar el preview — solo para la pantalla de
   * "ya tienes tu entrada", donde fingir un earning no confirmado sería
   * deshonesto (spec §11: "NO fingir que ya se ha concedido").
   */
  myRewardForOrder: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const owned = await getMyOrderById(input.orderId, ctx.user.id);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido no encontrado" });
      const grant = await findActiveGrantBySource(ctx.user.id, "ticket", input.orderId);
      return { granted: !!grant, amount: grant?.amount ?? null };
    }),
});
