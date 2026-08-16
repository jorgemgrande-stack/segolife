/**
 * commandCenterExecutiveSummary.test.ts — SEGOLIFE ADMIN AI/BI/COMMAND
 * CENTER (Fase 12, spec §34-36/§64-66). Resumen 100% determinista — sin
 * proveedor de IA conectado (confirmado en auditoría: LLM_API_KEY no
 * configurada en producción, único consumidor real de un LLM en el repo es
 * OCR de cupones de la CRM heredada, no SEGOLIFE).
 */
import { describe, it, expect } from "vitest";
import { buildExecutiveSummary } from "./commandCenterExecutiveSummary";
import type { OverviewSnapshot } from "./commandCenterOverview";
import type { ActionCenterAlert } from "./commandCenterAlerts";

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
