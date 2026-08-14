/**
 * dashboard.test.ts — router `dashboard.*` (spec Fase 15, §37 RBAC + filtros
 * globales). Mismo patrón que integrations.test.ts/benefits.test.ts:
 * `createCaller({user})` + vi.mock sobre las dependencias — nunca toca una
 * BD real. RBAC en este entorno de test (sin DATABASE_URL) cae siempre al
 * fallback legacy por rol (ver checkRbacOrLegacy en server/_core/rbac.ts) —
 * por eso "admin" pasa todos los permissionProcedure(..., ["admin"]) y
 * cualquier otro rol los falla, sin necesidad de mockear RBAC.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetDb, mockGetOverviewSnapshot, mockGetActivityFeed, mockGetCommunityPulse,
  mockGetStudentIntelligence, mockGetHistoricalAudience, mockGetCrossVenueIntelligence,
  mockGetEventPerformance, mockGetVenuePerformance, mockGetFourvenuesHealth,
  mockGetLoyaltyEconomy, mockGetBenefitsPerformance, mockGetPlanAndPlay, mockGetCommunityFunnel,
  mockGetActionCenterAlerts, mockGetSystemHealth,
} = vi.hoisted(() => ({
  mockGetDb: vi.fn(async () => ({ __fakeDb: true })),
  mockGetOverviewSnapshot: vi.fn(async () => ({ overview: true })),
  mockGetActivityFeed: vi.fn(async () => []),
  mockGetCommunityPulse: vi.fn(async () => ({ pulse: true })),
  mockGetStudentIntelligence: vi.fn(async () => ({ intelligence: true })),
  mockGetHistoricalAudience: vi.fn(async () => ({ historical: true })),
  mockGetCrossVenueIntelligence: vi.fn(async () => ({ crossVenue: true })),
  mockGetEventPerformance: vi.fn(async () => ({ events: true })),
  mockGetVenuePerformance: vi.fn(async () => ({ venues: true })),
  mockGetFourvenuesHealth: vi.fn(async () => ({ integrations: [], overallStatus: "none_configured" })),
  mockGetLoyaltyEconomy: vi.fn(async () => ({ loyalty: true })),
  mockGetBenefitsPerformance: vi.fn(async () => ({ benefits: true })),
  mockGetPlanAndPlay: vi.fn(async () => ({ planAndPlay: true })),
  mockGetCommunityFunnel: vi.fn(async () => ({ funnel: true })),
  mockGetActionCenterAlerts: vi.fn(() => [{ severity: "info" }]),
  mockGetSystemHealth: vi.fn(async () => ({ items: [] })),
}));

vi.mock("../db", () => ({ getDb: mockGetDb }));
vi.mock("../segolife/dashboard/commandCenterOverview", () => ({ getOverviewSnapshot: mockGetOverviewSnapshot }));
vi.mock("../segolife/dashboard/commandCenterActivity", () => ({ getActivityFeed: mockGetActivityFeed }));
vi.mock("../segolife/dashboard/commandCenterCommunityPulse", () => ({ getCommunityPulse: mockGetCommunityPulse }));
vi.mock("../segolife/dashboard/commandCenterStudents", () => ({
  getStudentIntelligence: mockGetStudentIntelligence,
  getHistoricalAudience: mockGetHistoricalAudience,
  getCrossVenueIntelligence: mockGetCrossVenueIntelligence,
}));
vi.mock("../segolife/dashboard/commandCenterEvents", () => ({ getEventPerformance: mockGetEventPerformance }));
vi.mock("../segolife/dashboard/commandCenterVenues", () => ({ getVenuePerformance: mockGetVenuePerformance }));
vi.mock("../segolife/dashboard/commandCenterFourvenues", () => ({ getFourvenuesHealth: mockGetFourvenuesHealth }));
vi.mock("../segolife/dashboard/commandCenterLoyalty", () => ({ getLoyaltyEconomy: mockGetLoyaltyEconomy, getBenefitsPerformance: mockGetBenefitsPerformance }));
vi.mock("../segolife/dashboard/commandCenterPlanAndPlay", () => ({ getPlanAndPlay: mockGetPlanAndPlay, getCommunityFunnel: mockGetCommunityFunnel }));
vi.mock("../segolife/dashboard/commandCenterAlerts", () => ({ getActionCenterAlerts: mockGetActionCenterAlerts, getSystemHealth: mockGetSystemHealth }));

import { dashboardRouter } from "./dashboard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(role: string) {
  return dashboardRouter.createCaller({ user: { id: 1, role } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDb.mockResolvedValue({ __fakeDb: true });
  mockGetFourvenuesHealth.mockResolvedValue({ integrations: [], overallStatus: "none_configured" });
});

describe("dashboardRouter — RBAC (spec §37)", () => {
  it("sin usuario autenticado -> UNAUTHORIZED", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caller = dashboardRouter.createCaller({ user: null } as any);
    await expect(caller.getOverview({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rol 'admin' accede a todos los endpoints (fallback legacy)", async () => {
    const caller = callerAs("admin");
    await expect(caller.getOverview({})).resolves.toBeDefined();
    await expect(caller.getStudentIntelligence({})).resolves.toBeDefined();
    await expect(caller.getLoyalty({})).resolves.toBeDefined();
    await expect(caller.getBenefits({})).resolves.toBeDefined();
    await expect(caller.getFourvenuesHealth({})).resolves.toBeDefined();
  });

  it("rol sin permisos ('user') -> FORBIDDEN en getOverview/getActivity/getCommunityPulse/getEventPerformance/getVenuePerformance/getPlanAndPlay/getCommunityFunnel/getAlerts/getSystemHealth (dashboard.view)", async () => {
    const caller = callerAs("user");
    await expect(caller.getOverview({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getActivity({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getCommunityPulse({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getEventPerformance({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getVenuePerformance({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getPlanAndPlay({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getCommunityFunnel({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getAlerts({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getSystemHealth({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rol 'user' -> FORBIDDEN en getStudentIntelligence/getHistoricalAudience/getCrossVenue (students.view, reutilizado del módulo Students)", async () => {
    const caller = callerAs("user");
    await expect(caller.getStudentIntelligence({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getHistoricalAudience()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getCrossVenue()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rol 'user' -> FORBIDDEN en getLoyalty (tokens.view) y getBenefits (benefits.view), permisos DISTINTOS entre sí", async () => {
    const caller = callerAs("user");
    await expect(caller.getLoyalty({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getBenefits({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rol 'user' -> FORBIDDEN en getFourvenuesHealth (integrations.view)", async () => {
    const caller = callerAs("user");
    await expect(caller.getFourvenuesHealth({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("dashboardRouter — filtros globales normalizados (spec §5/§33)", () => {
  it("communityId/range se resuelven a un DashboardFilterContext único antes de llamar al servicio", async () => {
    const caller = callerAs("admin");
    await caller.getOverview({ communityId: 7, range: "7d" });
    const ctxArg = mockGetOverviewSnapshot.mock.calls[0][0];
    expect(ctxArg.communityId).toBe(7);
    expect(ctxArg.from).toBeInstanceOf(Date);
    expect(ctxArg.to).toBeInstanceOf(Date);
  });

  it("sin communityId -> ctx.communityId es null ('Todas'), nunca undefined", async () => {
    const caller = callerAs("admin");
    await caller.getCommunityPulse({});
    const ctxArg = mockGetCommunityPulse.mock.calls[0][0];
    expect(ctxArg.communityId).toBeNull();
  });

  it("getActivity aplica los defaults de paginación (limit=30, offset=0) y los pasa server-side", async () => {
    const caller = callerAs("admin");
    await caller.getActivity({});
    expect(mockGetActivityFeed).toHaveBeenCalledWith(30, 0, null, expect.anything());
  });

  it("getActivity respeta limit/offset explícitos", async () => {
    const caller = callerAs("admin");
    await caller.getActivity({ limit: 10, offset: 20, communityId: 3 });
    expect(mockGetActivityFeed).toHaveBeenCalledWith(10, 20, 3, expect.anything());
  });
});

describe("dashboardRouter.getAlerts — compone Action Center a partir de los otros snapshots", () => {
  it("llama a overview/events/fourvenues/benefits/planAndPlay y pasa sus resultados a getActionCenterAlerts", async () => {
    const caller = callerAs("admin");
    const result = await caller.getAlerts({});
    expect(mockGetOverviewSnapshot).toHaveBeenCalledOnce();
    expect(mockGetEventPerformance).toHaveBeenCalledOnce();
    expect(mockGetBenefitsPerformance).toHaveBeenCalledOnce();
    expect(mockGetPlanAndPlay).toHaveBeenCalledOnce();
    expect(mockGetActionCenterAlerts).toHaveBeenCalledWith(expect.objectContaining({
      overview: { overview: true }, events: { events: true }, benefits: { benefits: true }, planAndPlay: { planAndPlay: true },
    }));
    expect(result).toEqual([{ severity: "info" }]);
  });
});

describe("dashboardRouter.getFourvenuesHealth / getSystemHealth — cache 30s (spec §27)", () => {
  it("dos llamadas seguidas a getFourvenuesHealth para la misma comunidad reutilizan el cache — el servicio real se llama solo una vez", async () => {
    const caller = callerAs("admin");
    await caller.getFourvenuesHealth({ communityId: 5 });
    await caller.getFourvenuesHealth({ communityId: 5 });
    expect(mockGetFourvenuesHealth).toHaveBeenCalledTimes(1);
  });

  it("comunidades DISTINTAS nunca comparten la misma entrada de cache", async () => {
    // IDs exclusivos de este test — el cache es un Map a nivel de módulo que
    // persiste ENTRE tests dentro del mismo archivo (mismo proceso, mismo
    // import), así que reutilizar un communityId ya usado en otro test de
    // este describe leería su entrada todavía viva (TTL 30s).
    const caller = callerAs("admin");
    await caller.getFourvenuesHealth({ communityId: 205 });
    await caller.getFourvenuesHealth({ communityId: 206 });
    expect(mockGetFourvenuesHealth).toHaveBeenCalledTimes(2);
  });

  it("getSystemHealth reutiliza el fourvenuesHealth ya cacheado en vez de abrir su propia consulta redundante", async () => {
    const caller = callerAs("admin");
    await caller.getFourvenuesHealth({ communityId: 1 });
    await caller.getSystemHealth({ communityId: 1 });
    expect(mockGetFourvenuesHealth).toHaveBeenCalledTimes(1);
    expect(mockGetSystemHealth).toHaveBeenCalledWith(expect.anything(), "none_configured");
  });
});
