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
