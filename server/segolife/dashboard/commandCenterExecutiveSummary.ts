/**
 * commandCenterExecutiveSummary.ts — SEGOLIFE ADMIN AI/BI/COMMAND CENTER
 * (Fase 12, spec §34-36/§64-66). "Resumen Ejecutivo" — auditoría de esta
 * fase confirmó que NO existe ningún proveedor LLM real conectado a
 * SEGOLIFE (server/adapters/llm.ts es código muerto sin consumidores,
 * server/_core/llm.ts está atado a infraestructura Manus y su único uso
 * real es OCR de cupones de la CRM heredada de Náyade — ninguno SEGOLIFE-
 * facing; sin LLM_API_KEY/OPENAI_API_KEY/ANTHROPIC_API_KEY configurada en
 * producción). Por eso este resumen es 100% DETERMINISTA (spec §36: "NO AI
 * PROVIDER? DO NOT FAKE IT") — nunca una llamada a un modelo, nunca texto
 * generado — solo formatea los MISMOS números que ya se muestran en el
 * resto del Command Center (spec §65: "grounded", cada línea deriva de un
 * campo real del propio payload, nunca un dato nuevo).
 *
 * Esta función es PURA (sin I/O) — igual que commandCenterAlerts.ts,
 * compone sobre snapshots YA CALCULADOS por el resto de módulos.
 */
import type { OverviewSnapshot } from "./commandCenterOverview";
import type { ActionCenterAlert, AlertSeverity } from "./commandCenterAlerts";
import type { RetentionSnapshot } from "./commandCenterRetention";
import type { ReferralBiSnapshot } from "./commandCenterReferrals";
import type { PeriodComparison } from "./commandCenterComparison";

export interface ExecutiveSummaryFact {
  key: string;
  label: string;
  value: number | string;
}

export interface ExecutiveSummary {
  /** spec §36 — honestidad explícita: nunca se simula un resumen "con IA" cuando no existe proveedor conectado. */
  aiProviderConnected: false;
  todayFacts: ExecutiveSummaryFact[];
  attentionFacts: ExecutiveSummaryFact[];
}

export function buildExecutiveSummary(overview: OverviewSnapshot, alerts: ActionCenterAlert[]): ExecutiveSummary {
  const todayFacts: ExecutiveSummaryFact[] = [
    { key: "students.active", label: "Students activos", value: overview.active.activeInPeriod },
    { key: "tickets.paid", label: "Entradas vendidas", value: overview.tickets.paid },
    { key: "attendance.confirmed", label: "Asistencias confirmadas", value: overview.attendance.confirmed },
    { key: "sales.native", label: "Ventas nativas", value: `${(overview.tickets.nativeRevenueCents / 100).toFixed(2)} €` },
    { key: "tokens.earned", label: "SegoTokens emitidos", value: overview.segoTokens.earnedInPeriod },
    { key: "tokens.spent", label: "SegoTokens gastados", value: overview.segoTokens.spentInPeriod },
    { key: "benefits.redeemed", label: "Benefits canjeados", value: overview.benefits.redeemed },
  ];

  const severityCount: Record<AlertSeverity, number> = { critical: 0, warning: 0, opportunity: 0, info: 0 };
  for (const a of alerts) severityCount[a.severity]++;

  const attentionFacts: ExecutiveSummaryFact[] = [];
  if (severityCount.critical > 0) attentionFacts.push({ key: "alerts.critical", label: "Alertas críticas", value: severityCount.critical });
  if (severityCount.warning > 0) attentionFacts.push({ key: "alerts.warning", label: "Avisos", value: severityCount.warning });
  if (severityCount.opportunity > 0) attentionFacts.push({ key: "alerts.opportunity", label: "Oportunidades detectadas", value: severityCount.opportunity });
  // Los primeros 5 títulos reales (nunca texto inventado) para que el resumen sea accionable sin abrir el panel completo.
  for (const a of alerts.filter(a => a.severity === "critical" || a.severity === "warning").slice(0, 5)) {
    attentionFacts.push({ key: `alert.${a.ctaEntity ?? "general"}.${a.ctaEntityId ?? "na"}`, label: a.severity === "critical" ? "Crítico" : "Aviso", value: a.title });
  }

  return { aiProviderConnected: false, todayFacts, attentionFacts };
}

/**
 * ─── FASE 14 (spec §21 "AI Executive Brief") ───────────────────────────────
 * "Resumen de hoy" en PROSA — sigue siendo 100% determinista (spec §36, sin
 * proveedor de IA conectado, verificado de nuevo en esta fase: sin cambios
 * en `railway variable list`). Cada frase se compone SOLO a partir de
 * campos ya calculados por otros módulos del Command Center (nunca un dato
 * nuevo, spec §65 "grounded") — esta función es pura, sin I/O, igual que
 * `buildExecutiveSummary`. Una frase se omite por completo si su hecho no
 * está disponible o no es significativo — nunca se rellena con un valor
 * inventado ni con "0 eventos" cuando en realidad no se pudo calcular.
 */
export interface ExecutiveBriefInputs {
  overview: OverviewSnapshot;
  alerts: ActionCenterAlert[];
  retention?: RetentionSnapshot;
  referrals?: ReferralBiSnapshot;
  // Fase 16 (auditoría) — renombrado desde `topVenueByNativeSales`: el valor
  // que alimenta esto (venuePerf.totalEcosystemRevenueCents) SIEMPRE incluye
  // ventas Fourvenues además de nativas (commandCenterVenues.ts no filtra
  // por provider en el ticket query) — la frase decía "ventas nativas" sobre
  // un dato que no lo era, un KPI engañoso real. El nombre y el texto ahora
  // describen lo que el dato realmente es.
  topVenueByEcosystemSales?: { venueName: string; sharePct: number } | null;
  eventsToday?: number | null;
  attendanceComparison?: PeriodComparison | null;
}

export interface ExecutiveBrief {
  aiProviderConnected: false;
  sentences: string[];
}

export function buildExecutiveBrief(inputs: ExecutiveBriefInputs): ExecutiveBrief {
  const sentences: string[] = [];

  if (inputs.eventsToday != null) {
    sentences.push(inputs.eventsToday > 0
      ? `Hoy hay ${inputs.eventsToday} evento${inputs.eventsToday === 1 ? "" : "s"} activo${inputs.eventsToday === 1 ? "" : "s"}.`
      : "No hay eventos activos hoy.");
  }

  if (inputs.topVenueByEcosystemSales && inputs.topVenueByEcosystemSales.sharePct > 0) {
    sentences.push(`${inputs.topVenueByEcosystemSales.venueName} concentra el ${inputs.topVenueByEcosystemSales.sharePct}% de las ventas del ecosistema (nativas + Fourvenues) del periodo.`);
  }

  const attendanceDeltaPct = inputs.attendanceComparison?.deltaPct;
  if (inputs.attendanceComparison && attendanceDeltaPct != null) {
    const c = inputs.attendanceComparison;
    const direction = c.direction === "up" ? "por encima" : c.direction === "down" ? "por debajo" : "igual";
    sentences.push(c.direction === "flat"
      ? "La asistencia está igual que en el periodo anterior equivalente."
      : `La asistencia está un ${Math.abs(attendanceDeltaPct)}% ${direction} respecto al periodo anterior equivalente.`);
  }

  if (inputs.retention && inputs.retention.activeStudents > 0 && inputs.retention.returningRatePct != null) {
    sentences.push(`El ${inputs.retention.returningRatePct}% de los Students activos en el periodo son recurrentes.`);
  }

  if (inputs.referrals && inputs.referrals.registeredInPeriod > 0 && inputs.referrals.conversionRatePct != null) {
    sentences.push(`Los referidos convierten al ${inputs.referrals.conversionRatePct}% en el periodo.`);
  }

  const severityCount: Record<AlertSeverity, number> = { critical: 0, warning: 0, opportunity: 0, info: 0 };
  for (const a of inputs.alerts) severityCount[a.severity]++;
  sentences.push(severityCount.critical > 0 || severityCount.warning > 0
    ? `Hay ${severityCount.critical} alerta${severityCount.critical === 1 ? "" : "s"} crítica${severityCount.critical === 1 ? "" : "s"} y ${severityCount.warning} aviso${severityCount.warning === 1 ? "" : "s"} que requieren atención.`
    : "No hay alertas activas.");

  return { aiProviderConnected: false, sentences };
}

/**
 * ─── FASE 14 (spec §22/§23 "AI Recommendations") ───────────────────────────
 * Motor de recomendaciones determinista, basado en reglas sobre hechos ya
 * calculados — NUNCA una llamada a IA (spec §36, mismo motivo que el brief
 * de arriba). Cada recomendación se etiqueta explícitamente como
 * RECOMENDACIÓN, nunca como un hecho (spec §22 "clearly labelled"), incluye
 * el POR QUÉ (spec §24 explainability) y una acción posible con deep-link a
 * un módulo canónico real — nunca ejecuta nada por sí sola (spec §23 human
 * approval mandatory).
 */
export interface Recommendation {
  id: string;
  title: string;
  why: string;
  possibleAction: string;
  deepLink: string;
}

const MIN_SAMPLE = 10;

export function buildRecommendations(inputs: ExecutiveBriefInputs): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const { overview, retention, referrals } = inputs;

  // Ejemplo del spec §45.4 — emisión de ST muy por delante del gasto.
  if (overview.segoTokens.earnedInPeriod > 0 && overview.segoTokens.spentInPeriod < overview.segoTokens.earnedInPeriod * 0.15) {
    recommendations.push({
      id: "tokens_low_redemption",
      title: "Revisar la visibilidad del Universal Spend o los incentivos de canje",
      why: `SegoTokens emitidos (${overview.segoTokens.earnedInPeriod}) muy por encima de los gastados (${overview.segoTokens.spentInPeriod}) en el periodo.`,
      possibleAction: "Abrir Economy Control Center",
      deepLink: "/admin/tokens/economy",
    });
  }

  // Ejemplo del spec §45.3 — recurrencia baja con volumen suficiente.
  if (retention && retention.activeStudents >= MIN_SAMPLE && retention.returningRatePct != null && retention.returningRatePct < 25) {
    recommendations.push({
      id: "low_recurrence",
      title: "Considerar una campaña de recurrencia",
      why: `Solo el ${retention.returningRatePct}% de los ${retention.activeStudents} Students activos en el periodo son recurrentes.`,
      possibleAction: "Abrir Campañas de SegoTokens",
      deepLink: "/admin/tokens/campaigns",
    });
  }

  if (referrals && referrals.registeredInPeriod >= MIN_SAMPLE && referrals.conversionRatePct != null && referrals.conversionRatePct < 20) {
    recommendations.push({
      id: "low_referral_conversion",
      title: "Revisar el flujo/incentivo de referidos",
      why: `Solo el ${referrals.conversionRatePct}% de los ${referrals.registeredInPeriod} referidos registrados en el periodo convirtieron.`,
      possibleAction: "Abrir Referral Admin",
      deepLink: "/admin/students/referrals",
    });
  }

  if (overview.benefits.generated >= MIN_SAMPLE && overview.benefits.redemptionRatePct != null && overview.benefits.redemptionRatePct < 20) {
    recommendations.push({
      id: "low_benefit_redemption",
      title: "Revisar la visibilidad o vigencia de los Benefits concedidos",
      why: `Solo el ${overview.benefits.redemptionRatePct}% de los ${overview.benefits.generated} Benefits concedidos en el periodo se canjearon.`,
      possibleAction: "Abrir Benefits",
      deepLink: "/admin/benefits",
    });
  }

  return recommendations;
}
