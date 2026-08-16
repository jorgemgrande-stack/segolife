/**
 * dashboard.ts — SEGOLIFE ADMIN COMMAND CENTER (spec Fase 15). Router
 * `dashboard.*` que sustituye al legado `accounting.getOverview`/etc. como
 * fuente de datos del nuevo `/admin`. Cada endpoint recibe el mismo
 * `{communityId?, range?, from?, to?}` normalizado vía
 * `resolveDashboardFilterContext` — nunca cada widget resuelve su propio
 * filtro por separado (spec §5/§33).
 *
 * RBAC (spec §37): overview/activity/community-pulse/events/venues/
 * plan&play/funnel/alerts/system-health usan el permiso general
 * `dashboard.view`; student intelligence/historical/cross-venue usan
 * `students.view` (reutilizando el permiso YA existente del módulo
 * Students, spec §37 explícito); tokens→`tokens.view`; benefits→
 * `benefits.view`; integraciones (Fourvenues Health)→`integrations.view`.
 * Nunca se oculta un endpoint solo en frontend.
 *
 * CACHE (spec §27): getFourvenuesHealth/getSystemHealth usan un TTL corto
 * en memoria de proceso (30s) — son los dos casos explícitamente señalados
 * en el spec como cacheables; el resto se recalcula siempre (nunca se cachea
 * Segolife Live ni ninguna acción crítica).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import { getDb } from "../db";
import type { AnyDbHandle } from "../segolife/tokens/tokenLedgerService";
import { resolveDashboardFilterContext, type DashboardFilterInput } from "../segolife/dashboard/dashboardFilters";
import { getOverviewSnapshot } from "../segolife/dashboard/commandCenterOverview";
import { getActivityFeed } from "../segolife/dashboard/commandCenterActivity";
import { getCommunityPulse } from "../segolife/dashboard/commandCenterCommunityPulse";
import { getStudentIntelligence, getHistoricalAudience, getCrossVenueIntelligence } from "../segolife/dashboard/commandCenterStudents";
import { getEventPerformance } from "../segolife/dashboard/commandCenterEvents";
import { getVenuePerformance } from "../segolife/dashboard/commandCenterVenues";
import { getFourvenuesHealth } from "../segolife/dashboard/commandCenterFourvenues";
import { getLoyaltyEconomy, getBenefitsPerformance, getCrossVenueBenefitFlow } from "../segolife/dashboard/commandCenterLoyalty";
import { getPlanAndPlay, getCommunityFunnel } from "../segolife/dashboard/commandCenterPlanAndPlay";
import { getActionCenterAlerts, getSystemHealth } from "../segolife/dashboard/commandCenterAlerts";
import { getPosProductPerformance, getPaymentMix } from "../segolife/dashboard/commandCenterCommerce";
import { listStockAlertsAcrossVenues } from "../segolife/stock/stockService";
import { listOpenCashSessionsAcrossVenues } from "../segolife/cash/cashSessionService";
import { listSettlementsNeedingAttention } from "../segolife/settlements/settlementService";
import { listVenuesMissingSellerConfig } from "../segolife/fiscal/commercialEntityService";
import { detectEconomyConflicts } from "../segolife/tokens/economyGovernanceService";
import { getEngagementOverview } from "../segolife/engagement/engagementOverviewService";
import { buildExecutiveSummary } from "../segolife/dashboard/commandCenterExecutiveSummary";

async function requireDb(): Promise<AnyDbHandle> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return db as unknown as AnyDbHandle;
}

const filterInputSchema = z.object({
  communityId: z.number().int().positive().nullable().optional(),
  range: z.enum(["today", "7d", "30d", "course"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

function resolveCtx(input: z.infer<typeof filterInputSchema>) {
  const normalized: DashboardFilterInput = { communityId: input.communityId ?? null, range: input.range, from: input.from, to: input.to };
  return resolveDashboardFilterContext(normalized);
}

const dashboardViewProcedure = permissionProcedure("dashboard.view", ["admin"]);
const studentsViewProcedure = permissionProcedure("students.view", ["admin"]);
const tokensViewProcedure = permissionProcedure("tokens.view", ["admin"]);
const benefitsViewProcedure = permissionProcedure("benefits.view", ["admin"]);
const integrationsViewProcedure = permissionProcedure("integrations.view", ["admin"]);
// Fase 12 (spec §15/§16/§69) — mismo permiso que el resto de Commerce (Fase 10.7), nunca uno nuevo duplicado.
const commerceViewProcedure = permissionProcedure("commerce.view", ["admin"]);

const CACHE_TTL_MS = 30_000;
const fourvenuesCache = new Map<string, { value: Awaited<ReturnType<typeof getFourvenuesHealth>>; expiresAt: number }>();

async function getCachedFourvenuesHealth(communityId: number | null, db: AnyDbHandle) {
  const key = String(communityId ?? "all");
  const hit = fourvenuesCache.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.value;
  const value = await getFourvenuesHealth(communityId, db);
  fourvenuesCache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

/**
 * Fase 12 — compartida entre `getAlerts` y `getExecutiveSummary` (el
 * resumen ejecutivo reutiliza EXACTAMENTE las mismas alertas ya calculadas,
 * nunca las recalcula con criterio distinto). Cada dominio nuevo es
 * independiente y de solo lectura; un fallo aislado se degrada a "sin
 * datos" (spec §75) en vez de tirar todo el endpoint.
 */
async function computeOverviewAndAlerts(ctx: ReturnType<typeof resolveCtx>, db: AnyDbHandle) {
  const [overview, events, fourvenues, benefits, planAndPlay] = await Promise.all([
    getOverviewSnapshot(ctx, db),
    getEventPerformance(ctx, db),
    getCachedFourvenuesHealth(ctx.communityId, db),
    getBenefitsPerformance(ctx, db),
    getPlanAndPlay(ctx, db),
  ]);
  // Estas 4 funciones tienen su propio DbHandle local (sin variante de
  // transacción, mismo caso ya resuelto en Fase 10.6): nunca se llaman
  // dentro de una transacción de escritura (Action Center es de solo
  // lectura), así que se dejan resolver contra su propio pool en vez de
  // forzar el tipo AnyDbHandle del router aquí.
  const [stockR, cashR, settlementsR, fiscalR, economyR, commsR] = await Promise.allSettled([
    listStockAlertsAcrossVenues(),
    listOpenCashSessionsAcrossVenues(),
    listSettlementsNeedingAttention(),
    listVenuesMissingSellerConfig(),
    detectEconomyConflicts(),
    getEngagementOverview(),
  ]);
  const ok = <T>(r: PromiseSettledResult<T>): T | undefined => r.status === "fulfilled" ? r.value : undefined;

  const alerts = getActionCenterAlerts({
    overview, events, fourvenues, benefits, planAndPlay,
    stockAlerts: ok(stockR),
    openCashSessions: ok(cashR),
    settlementsNeedingAttention: ok(settlementsR),
    venuesMissingFiscalConfig: ok(fiscalR),
    economyConflicts: ok(economyR),
    communicationRecentFailures: ok(commsR)?.lastErrors.length,
  });

  return { overview, alerts };
}

export const dashboardRouter = router({
  getOverview: dashboardViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => getOverviewSnapshot(resolveCtx(input), await requireDb())),

  getActivity: dashboardViewProcedure
    .input(filterInputSchema.extend({ limit: z.number().int().min(1).max(100).default(30), offset: z.number().int().min(0).default(0) }))
    .query(async ({ input }) => getActivityFeed(input.limit, input.offset, input.communityId ?? null, await requireDb())),

  getCommunityPulse: dashboardViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => getCommunityPulse(resolveCtx(input), await requireDb())),

  getStudentIntelligence: studentsViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => getStudentIntelligence(input.communityId ?? null, await requireDb())),

  getHistoricalAudience: studentsViewProcedure
    .query(async () => getHistoricalAudience(await requireDb())),

  getCrossVenue: studentsViewProcedure
    .query(async () => getCrossVenueIntelligence(await requireDb())),

  getEventPerformance: dashboardViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => getEventPerformance(resolveCtx(input), await requireDb())),

  getVenuePerformance: dashboardViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => getVenuePerformance(resolveCtx(input), await requireDb())),

  getFourvenuesHealth: integrationsViewProcedure
    .input(z.object({ communityId: z.number().int().positive().nullable().optional() }))
    .query(async ({ input }) => getCachedFourvenuesHealth(input.communityId ?? null, await requireDb())),

  getLoyalty: tokensViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => getLoyaltyEconomy(resolveCtx(input), await requireDb())),

  getBenefits: benefitsViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => getBenefitsPerformance(resolveCtx(input), await requireDb())),

  // SEGOLIFE ADMIN AI/BI/COMMAND CENTER (Fase 12, spec §20/§70) — "¿SEGOLIFE
  // mueve Students entre negocios?", mismo permiso que el resto de Benefits.
  getCrossVenueBenefitFlow: benefitsViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => getCrossVenueBenefitFlow(resolveCtx(input), await requireDb())),

  // SEGOLIFE ADMIN AI/BI/COMMAND CENTER (Fase 12, spec §15/§16/§69).
  getPosProducts: commerceViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => getPosProductPerformance(resolveCtx(input), await requireDb())),

  getPaymentMix: commerceViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => getPaymentMix(resolveCtx(input), await requireDb())),

  getPlanAndPlay: dashboardViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => getPlanAndPlay(resolveCtx(input), await requireDb())),

  getCommunityFunnel: dashboardViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => getCommunityFunnel(resolveCtx(input), await requireDb())),

  getAlerts: dashboardViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => {
      const ctx = resolveCtx(input);
      const db = await requireDb();
      const { alerts } = await computeOverviewAndAlerts(ctx, db);
      return alerts;
    }),

  // SEGOLIFE ADMIN AI/BI/COMMAND CENTER (Fase 12, spec §35/§64) — resumen
  // determinista, sin proveedor de IA conectado (ver commandCenterExecutiveSummary.ts).
  getExecutiveSummary: dashboardViewProcedure
    .input(filterInputSchema)
    .query(async ({ input }) => {
      const ctx = resolveCtx(input);
      const db = await requireDb();
      const { overview, alerts } = await computeOverviewAndAlerts(ctx, db);
      return buildExecutiveSummary(overview, alerts);
    }),

  getSystemHealth: dashboardViewProcedure
    .input(z.object({ communityId: z.number().int().positive().nullable().optional() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const fourvenues = await getCachedFourvenuesHealth(input.communityId ?? null, db);
      return getSystemHealth(db, fourvenues.overallStatus);
    }),
});
