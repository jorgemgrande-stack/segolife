/**
 * commandCenterAlerts.test.ts — Action Center (reglas deterministas, nunca
 * IA) y System Health (solo lectura de estado ya materializado).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EventPerformanceSnapshot } from "./commandCenterEvents";
import type { FourvenuesHealthSnapshot } from "./commandCenterFourvenues";
import type { BenefitsPerformanceSnapshot } from "./commandCenterLoyalty";
import type { PlanAndPlaySnapshot } from "./commandCenterPlanAndPlay";
import type { OverviewSnapshot } from "./commandCenterOverview";

const { mockGetProvider, mockIsFourvenuesSchedulerRunning } = vi.hoisted(() => ({
  mockGetProvider: vi.fn(),
  mockIsFourvenuesSchedulerRunning: vi.fn(),
}));

vi.mock("../engagement/providers/providerRegistry", () => ({
  getProvider: (channel: string) => mockGetProvider(channel),
}));
vi.mock("../integrations/integrationScheduler", () => ({
  isFourvenuesSchedulerRunning: () => mockIsFourvenuesSchedulerRunning(),
  DEFAULT_INCREMENTAL_INTERVAL_MINUTES: 10,
}));

import { getActionCenterAlerts, getSystemHealth, type ActionCenterInputs } from "./commandCenterAlerts";

beforeEach(() => {
  mockGetProvider.mockReset();
  mockIsFourvenuesSchedulerRunning.mockReset();
});

function baseInputs(overrides: Partial<ActionCenterInputs> = {}): ActionCenterInputs {
  const events: EventPerformanceSnapshot = { rows: [], topEventId: null, trendingEventId: null, needsAttention: [], needsAttentionDataSufficient: true };
  const fourvenues: FourvenuesHealthSnapshot = { integrations: [], overallStatus: "none_configured" };
  const benefits: BenefitsPerformanceSnapshot = { generated: 0, available: 0, redeemed: 0, expired: 0, redemptionRatePct: null, expiringWithin48h: 0, mostRedeemed: [] };
  const planAndPlay: PlanAndPlaySnapshot = { activeProposals: 0, responsesInPeriod: 0, participationPct: null, pendingModerationStudentProposals: 0, endingSoon: [], mostActive: null };
  const overview = {
    students: { total: 0, newInPeriod: 0 },
    active: { activeInPeriod: 0, dau: 0, wau: 0, mau: 0 },
    tickets: { ordersInPeriod: 0, paid: 0, cancelled: 0, refunded: 0, ticketRevenueCents: 0 },
    attendance: { confirmed: 0, eligibleTickets: 0, attendanceRatePct: null, unresolvedHistoricalCount: 0 },
    segoTokens: { earnedInPeriod: 0, spentInPeriod: 0, circulatingBalance: 0, liveStatus: "LIVE_LOCKED" as const },
    benefits: { generated: 0, available: 0, redeemed: 0, expired: 0, redemptionRatePct: null },
  } as OverviewSnapshot;
  return { events, fourvenues, benefits, planAndPlay, overview, ...overrides };
}

describe("getActionCenterAlerts — reglas deterministas (nunca IA)", () => {
  it("es una función pura: la misma entrada produce SIEMPRE la misma salida", () => {
    const inputs = baseInputs({ benefits: { ...baseInputs().benefits, expiringWithin48h: 2 } });
    const a = getActionCenterAlerts(inputs);
    const b = getActionCenterAlerts(inputs);
    expect(a).toEqual(b);
  });

  it("integración Fourvenues en error -> CRITICAL", () => {
    const inputs = baseInputs({
      fourvenues: { overallStatus: "error", integrations: [{ integrationId: 1, venueId: 10, venueName: "Casanova", providerKey: "fourvenues", environment: "production", enabled: true, status: "error", syncEnabled: true, loyaltyEnabled: false, credentialsConfigured: true, scheduler: null, recentRuns: [] }] },
    });
    const alerts = getActionCenterAlerts(inputs);
    expect(alerts[0]).toMatchObject({ severity: "critical", ctaEntity: "integration", ctaEntityId: 1 });
  });

  it("evento sin ventas a <=3 días -> CRITICAL; a más días -> WARNING (misma razón, distinta severidad)", () => {
    const closeEvent = baseInputs({ events: { rows: [], topEventId: null, trendingEventId: null, needsAttentionDataSufficient: true, needsAttention: [{ eventId: 1, eventName: "Evento Cercano", startsAt: "2026-08-16", daysUntilEvent: 2, ticketsSoldAllTime: 0, velocityPerDay: 0, reason: "zero_sales_close_to_event" }] } });
    const farEvent = baseInputs({ events: { rows: [], topEventId: null, trendingEventId: null, needsAttentionDataSufficient: true, needsAttention: [{ eventId: 2, eventName: "Evento Lejano", startsAt: "2026-08-25", daysUntilEvent: 11, ticketsSoldAllTime: 0, velocityPerDay: 0, reason: "zero_sales_close_to_event" }] } });
    expect(getActionCenterAlerts(closeEvent).find(a => a.ctaEntityId === 1)?.severity).toBe("critical");
    expect(getActionCenterAlerts(farEvent).find(a => a.ctaEntityId === 2)?.severity).toBe("warning");
  });

  it("Benefits expirando en 48h -> WARNING con el conteo real en el título", () => {
    const inputs = baseInputs({ benefits: { generated: 10, available: 5, redeemed: 3, expired: 0, redemptionRatePct: 30, expiringWithin48h: 4, mostRedeemed: [] } });
    const alert = getActionCenterAlerts(inputs).find(a => a.ctaEntity === "benefit");
    expect(alert?.severity).toBe("warning");
    expect(alert?.title).toContain("4");
  });

  it("evento en tendencia -> OPPORTUNITY", () => {
    const inputs = baseInputs({
      events: {
        rows: [{ eventId: 5, eventName: "Fiesta Trending", venueId: null, venueName: null, startsAt: "2026-08-20", ticketsSold: 50, ordersCount: 10, attendanceCount: 0, eligibleTickets: 0, attendanceRatePct: null, ticketRevenueCents: 10000, velocity: { last24h: 30, prior24h: 5, trend: "up" } }],
        topEventId: 5, trendingEventId: 5, needsAttention: [], needsAttentionDataSufficient: true,
      },
    });
    const alert = getActionCenterAlerts(inputs).find(a => a.ctaEntity === "event" && a.ctaEntityId === 5 && a.severity === "opportunity");
    expect(alert).toBeDefined();
    expect(alert?.context).toContain("30");
  });

  it("propuesta Plan & Play con demanda validada (>=75% y >=20 respuestas) -> OPPORTUNITY; por debajo del umbral, ninguna alerta", () => {
    const validated = baseInputs({ planAndPlay: { activeProposals: 1, responsesInPeriod: 243, participationPct: 81, pendingModerationStudentProposals: 0, endingSoon: [], mostActive: { proposalId: 9, title: "After Party Casanova", responseCount: 243, topAnswerLabel: "yes", topAnswerPct: 82 } } });
    const belowThreshold = baseInputs({ planAndPlay: { activeProposals: 1, responsesInPeriod: 5, participationPct: 50, pendingModerationStudentProposals: 0, endingSoon: [], mostActive: { proposalId: 10, title: "Propuesta chica", responseCount: 5, topAnswerLabel: "yes", topAnswerPct: 80 } } });
    expect(getActionCenterAlerts(validated).some(a => a.ctaEntity === "proposal" && a.ctaEntityId === 9 && a.severity === "opportunity")).toBe(true);
    expect(getActionCenterAlerts(belowThreshold).some(a => a.ctaEntity === "proposal")).toBe(false);
  });

  it("sin ninguna señal -> array vacío, nunca inventa alertas", () => {
    expect(getActionCenterAlerts(baseInputs())).toEqual([]);
  });

  it("ordena SIEMPRE critical > warning > opportunity > info", () => {
    const inputs = baseInputs({
      planAndPlay: { activeProposals: 0, responsesInPeriod: 0, participationPct: null, pendingModerationStudentProposals: 3, endingSoon: [], mostActive: null },
      benefits: { generated: 1, available: 0, redeemed: 0, expired: 0, redemptionRatePct: 0, expiringWithin48h: 1, mostRedeemed: [] },
      fourvenues: { overallStatus: "error", integrations: [{ integrationId: 1, venueId: 10, venueName: "Casanova", providerKey: "fourvenues", environment: "production", enabled: true, status: "error", syncEnabled: true, loyaltyEnabled: false, credentialsConfigured: true, scheduler: null, recentRuns: [] }] },
    });
    const severities = getActionCenterAlerts(inputs).map(a => a.severity);
    const order: Record<string, number> = { critical: 0, warning: 1, opportunity: 2, info: 3 };
    const sortedCopy = [...severities].sort((a, b) => order[a] - order[b]);
    expect(severities).toEqual(sortedCopy);
  });
});

describe("getSystemHealth — solo lectura de estado ya materializado", () => {
  it("DB ok + Fourvenues sano + canales configurados -> todo 'ok'", async () => {
    mockGetProvider.mockImplementation(() => ({ capabilities: { configured: true } }));
    mockIsFourvenuesSchedulerRunning.mockReturnValue(true);
    const db = { execute: vi.fn().mockResolvedValue([[], []]) };
    const snapshot = await getSystemHealth(db as never, "all_healthy");
    const byKey = new Map(snapshot.items.map(i => [i.key, i.status]));
    expect(byKey.get("api")).toBe("ok");
    expect(byKey.get("db")).toBe("ok");
    expect(byKey.get("fourvenues")).toBe("ok");
    expect(byKey.get("scheduler")).toBe("ok");
    expect(byKey.get("email")).toBe("ok");
  });

  it("loyalty SIEMPRE 'off' — nunca 'error', es un apagado intencional", async () => {
    mockGetProvider.mockImplementation(() => ({ capabilities: { configured: false } }));
    mockIsFourvenuesSchedulerRunning.mockReturnValue(false);
    const db = { execute: vi.fn().mockResolvedValue([[], []]) };
    const snapshot = await getSystemHealth(db as never, "none_configured");
    const loyalty = snapshot.items.find(i => i.key === "loyalty");
    expect(loyalty?.status).toBe("off");
  });

  it("un fallo real en SELECT 1 -> db 'error', nunca lanza la excepción hacia arriba", async () => {
    mockGetProvider.mockImplementation(() => ({ capabilities: { configured: false } }));
    mockIsFourvenuesSchedulerRunning.mockReturnValue(false);
    const db = { execute: vi.fn().mockRejectedValue(new Error("connection refused")) };
    const snapshot = await getSystemHealth(db as never, "none_configured");
    const dbItem = snapshot.items.find(i => i.key === "db");
    expect(dbItem?.status).toBe("error");
    expect(dbItem?.detail).toContain("connection refused");
  });
});
