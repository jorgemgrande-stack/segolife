/**
 * commandCenterExecutiveSummary.test.ts — SEGOLIFE ADMIN AI/BI/COMMAND
 * CENTER (Fase 12, spec §34-36/§64-66). Resumen 100% determinista — sin
 * proveedor de IA conectado (confirmado en auditoría: LLM_API_KEY no
 * configurada en producción, único consumidor real de un LLM en el repo es
 * OCR de cupones de la CRM heredada, no SEGOLIFE).
 */
import { describe, it, expect } from "vitest";
import { buildExecutiveSummary, buildExecutiveBrief, buildRecommendations, type ExecutiveBriefInputs } from "./commandCenterExecutiveSummary";
import type { OverviewSnapshot } from "./commandCenterOverview";
import type { ActionCenterAlert } from "./commandCenterAlerts";
import type { RetentionSnapshot } from "./commandCenterRetention";
import type { ReferralBiSnapshot } from "./commandCenterReferrals";

function overview(overrides: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  return {
    students: { total: 0, newInPeriod: 0 },
    active: { activeInPeriod: 124, dau: 0, wau: 0, mau: 0 },
    tickets: { ordersInPeriod: 0, paid: 20, cancelled: 0, refunded: 0, ticketRevenueCents: 0, nativePaid: 20, nativeRevenueCents: 284000, fourvenuesPaid: 0, fourvenuesRevenueCents: 0 },
    attendance: { confirmed: 287, eligibleTickets: 0, attendanceRatePct: null, unresolvedHistoricalCount: 0 },
    segoTokens: { earnedInPeriod: 18400, spentInPeriod: 6200, circulatingBalance: 0, liveStatus: "LIVE_ACTIVE" },
    benefits: { generated: 0, available: 0, redeemed: 14, expired: 0, redemptionRatePct: null },
    ...overrides,
  } as OverviewSnapshot;
}

describe("buildExecutiveSummary — determinista, sin IA (spec §36)", () => {
  it("aiProviderConnected siempre false (honestidad explícita, spec §36 'DO NOT FAKE IT')", () => {
    const summary = buildExecutiveSummary(overview(), []);
    expect(summary.aiProviderConnected).toBe(false);
  });

  it("todayFacts refleja EXACTAMENTE los mismos números del overview, nunca recalculados", () => {
    const summary = buildExecutiveSummary(overview(), []);
    const byKey = new Map(summary.todayFacts.map(f => [f.key, f.value]));
    expect(byKey.get("students.active")).toBe(124);
    expect(byKey.get("tickets.paid")).toBe(20);
    expect(byKey.get("attendance.confirmed")).toBe(287);
    expect(byKey.get("tokens.earned")).toBe(18400);
    expect(byKey.get("tokens.spent")).toBe(6200);
    expect(byKey.get("benefits.redeemed")).toBe(14);
  });

  it("sin alertas -> attentionFacts vacío, nunca inventa una 'atención' falsa", () => {
    const summary = buildExecutiveSummary(overview(), []);
    expect(summary.attentionFacts).toEqual([]);
  });

  it("cuenta alertas por severidad y añade los títulos reales de critical/warning (nunca opportunity/info)", () => {
    const alerts: ActionCenterAlert[] = [
      { severity: "critical", title: "Producto agotado — Tía Felisa", context: "", ctaEntity: "stock", ctaEntityId: 1 },
      { severity: "warning", title: "Sesión de caja abierta 20h", context: "", ctaEntity: "cash", ctaEntityId: 2 },
      { severity: "opportunity", title: "Evento en tendencia", context: "", ctaEntity: "event", ctaEntityId: 3 },
      { severity: "info", title: "3 propuestas pendientes", context: "", ctaEntity: "proposal", ctaEntityId: null },
    ];
    const summary = buildExecutiveSummary(overview(), alerts);
    const byKey = new Map(summary.attentionFacts.map(f => [f.key, f.value]));
    expect(byKey.get("alerts.critical")).toBe(1);
    expect(byKey.get("alerts.warning")).toBe(1);
    expect(byKey.get("alerts.opportunity")).toBe(1);
    const titles = summary.attentionFacts.map(f => f.value);
    expect(titles).toContain("Producto agotado — Tía Felisa");
    expect(titles).toContain("Sesión de caja abierta 20h");
    expect(titles).not.toContain("Evento en tendencia");
    expect(titles).not.toContain("3 propuestas pendientes");
  });

  it("es una función pura: la misma entrada produce SIEMPRE la misma salida", () => {
    const alerts: ActionCenterAlert[] = [{ severity: "critical", title: "X", context: "", ctaEntity: null, ctaEntityId: null }];
    const a = buildExecutiveSummary(overview(), alerts);
    const b = buildExecutiveSummary(overview(), alerts);
    expect(a).toEqual(b);
  });
});

function retention(overrides: Partial<RetentionSnapshot> = {}): RetentionSnapshot {
  return { activeStudents: 0, firstTimeInPeriod: 0, returningInPeriod: 0, returningRatePct: null, avgActiveDaysPerStudent: null, multiVenueStudents: 0, ...overrides };
}
function referralBi(overrides: Partial<ReferralBiSnapshot> = {}): ReferralBiSnapshot {
  return { registeredInPeriod: 0, convertedInPeriod: 0, rewardedInPeriod: 0, conversionRatePct: null, tokensIssuedInPeriod: 0, uniqueInvitersInPeriod: 0, pendingReconciliation: 0, topReferrers: [], ...overrides };
}
function briefInputs(overrides: Partial<ExecutiveBriefInputs> = {}): ExecutiveBriefInputs {
  return { overview: overview(), alerts: [], ...overrides };
}

describe("buildExecutiveBrief — resumen en prosa 100% determinista (Fase 14, spec §21/§36)", () => {
  it("aiProviderConnected siempre false", () => {
    const brief = buildExecutiveBrief(briefInputs());
    expect(brief.aiProviderConnected).toBe(false);
  });

  it("omite por completo una frase cuyo hecho no está disponible (nunca inventa)", () => {
    const brief = buildExecutiveBrief(briefInputs({ eventsToday: null, topVenueByNativeSales: null, attendanceComparison: null }));
    expect(brief.sentences.some(s => s.includes("evento"))).toBe(false);
    expect(brief.sentences.some(s => s.includes("concentra"))).toBe(false);
    expect(brief.sentences.some(s => s.includes("periodo anterior")))
      .toBe(false);
  });

  it("con eventsToday=0, dice explícitamente 'no hay eventos', nunca omite la frase silenciosamente cuando el dato SÍ está disponible", () => {
    const brief = buildExecutiveBrief(briefInputs({ eventsToday: 0 }));
    expect(brief.sentences).toContain("No hay eventos activos hoy.");
  });

  it("incluye el venue líder solo si sharePct > 0, con el número real (nunca inventado)", () => {
    const brief = buildExecutiveBrief(briefInputs({ topVenueByNativeSales: { venueName: "La Finca", sharePct: 47 } }));
    expect(brief.sentences).toContain("La Finca concentra el 47% de las ventas nativas del periodo.");
  });

  it("frase de comparación usa 'por encima'/'por debajo' según la dirección real, nunca texto genérico", () => {
    const up = buildExecutiveBrief(briefInputs({ attendanceComparison: { current: 120, previous: 100, deltaPct: 20, deltaAbs: 20, direction: "up" } }));
    expect(up.sentences.some(s => s.includes("20% por encima"))).toBe(true);
    const down = buildExecutiveBrief(briefInputs({ attendanceComparison: { current: 80, previous: 100, deltaPct: -20, deltaAbs: -20, direction: "down" } }));
    expect(down.sentences.some(s => s.includes("20% por debajo"))).toBe(true);
  });

  it("sin alertas -> frase explícita 'No hay alertas activas'", () => {
    const brief = buildExecutiveBrief(briefInputs({ alerts: [] }));
    expect(brief.sentences).toContain("No hay alertas activas.");
  });

  it("con alertas -> cuenta reales de critical/warning, nunca inventadas", () => {
    const alerts: ActionCenterAlert[] = [
      { severity: "critical", title: "A", context: "", ctaEntity: null, ctaEntityId: null },
      { severity: "warning", title: "B", context: "", ctaEntity: null, ctaEntityId: null },
      { severity: "warning", title: "C", context: "", ctaEntity: null, ctaEntityId: null },
    ];
    const brief = buildExecutiveBrief(briefInputs({ alerts }));
    expect(brief.sentences.some(s => s.includes("1 alerta crítica") && s.includes("2 avisos"))).toBe(true);
  });

  it("es pura: misma entrada, misma salida", () => {
    const inputs = briefInputs({ eventsToday: 3, retention: retention({ activeStudents: 40, returningRatePct: 60 }) });
    expect(buildExecutiveBrief(inputs)).toEqual(buildExecutiveBrief(inputs));
  });
});

describe("buildRecommendations — motor determinista basado en reglas (Fase 14, spec §22/§23)", () => {
  it("sin datos suficientes, no genera ninguna recomendación (nunca fuerza una con muestra insuficiente)", () => {
    const recs = buildRecommendations(briefInputs());
    expect(recs).toEqual([]);
  });

  it("ST emitido >> gastado -> recomienda revisar Universal Spend, con CTA al Economy Control Center real", () => {
    const recs = buildRecommendations(briefInputs({ overview: overview({ segoTokens: { earnedInPeriod: 1000, spentInPeriod: 50, circulatingBalance: 0, liveStatus: "LIVE_ACTIVE" } }) }));
    const rec = recs.find(r => r.id === "tokens_low_redemption");
    expect(rec).toBeDefined();
    expect(rec?.deepLink).toBe("/admin/tokens/economy");
    expect(rec?.why).toContain("1000");
    expect(rec?.title).not.toContain("1000"); // el título es la RECOMENDACIÓN, no repite el hecho — separación clara (spec §22)
  });

  it("no recomienda revisar ST si el gasto es proporcional al emitido", () => {
    const recs = buildRecommendations(briefInputs({ overview: overview({ segoTokens: { earnedInPeriod: 1000, spentInPeriod: 400, circulatingBalance: 0, liveStatus: "LIVE_ACTIVE" } }) }));
    expect(recs.find(r => r.id === "tokens_low_redemption")).toBeUndefined();
  });

  it("recurrencia baja con muestra suficiente -> recomienda campaña de recurrencia", () => {
    const recs = buildRecommendations(briefInputs({ retention: retention({ activeStudents: 50, returningRatePct: 10 }) }));
    const rec = recs.find(r => r.id === "low_recurrence");
    expect(rec).toBeDefined();
    expect(rec?.why).toContain("10%");
  });

  it("recurrencia baja pero con MENOS del mínimo de muestra -> no recomienda (evita ruido con datos escasos)", () => {
    const recs = buildRecommendations(briefInputs({ retention: retention({ activeStudents: 3, returningRatePct: 0 }) }));
    expect(recs.find(r => r.id === "low_recurrence")).toBeUndefined();
  });

  it("conversión de referidos baja con volumen suficiente -> recomienda revisar el flujo", () => {
    const recs = buildRecommendations(briefInputs({ referrals: referralBi({ registeredInPeriod: 20, conversionRatePct: 5 }) }));
    expect(recs.find(r => r.id === "low_referral_conversion")).toBeDefined();
  });

  it("redención de Benefits baja con volumen suficiente -> recomienda revisar visibilidad/vigencia", () => {
    const recs = buildRecommendations(briefInputs({ overview: overview({ benefits: { generated: 30, available: 10, redeemed: 2, expired: 5, redemptionRatePct: 7 } }) }));
    expect(recs.find(r => r.id === "low_benefit_redemption")).toBeDefined();
  });

  it("cada recomendación tiene why (hecho) y possibleAction/deepLink (acción posible) — nunca ejecuta nada por sí sola", () => {
    const recs = buildRecommendations(briefInputs({
      overview: overview({ segoTokens: { earnedInPeriod: 1000, spentInPeriod: 10, circulatingBalance: 0, liveStatus: "LIVE_ACTIVE" } }),
    }));
    for (const rec of recs) {
      expect(rec.why.length).toBeGreaterThan(0);
      expect(rec.possibleAction.length).toBeGreaterThan(0);
      expect(rec.deepLink.startsWith("/admin/")).toBe(true);
    }
  });

  it("es puro: misma entrada, misma salida", () => {
    const inputs = briefInputs({ retention: retention({ activeStudents: 50, returningRatePct: 10 }) });
    expect(buildRecommendations(inputs)).toEqual(buildRecommendations(inputs));
  });
});
