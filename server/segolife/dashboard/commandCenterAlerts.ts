/**
 * commandCenterAlerts.ts — SEGOLIFE ADMIN COMMAND CENTER. `dashboard.getAlerts`
 * (Action Center, spec §23) y `dashboard.getSystemHealth` (spec §24).
 *
 * ACTION CENTER: reglas DETERMINISTAS únicamente (spec: "nunca IA") sobre
 * snapshots YA CALCULADOS por el resto de módulos — `getActionCenterAlerts`
 * es una función PURA (sin I/O) que compone alertas a partir de resultados
 * que el router ya obtuvo para sus propios endpoints, en vez de volver a
 * consultar la BD. `ctaEntity`/`ctaEntityId` (no una URL) — construir la URL
 * final es responsabilidad del frontend (que conoce sus propias rutas);
 * hardcodear una ruta aquí arriesgaría un enlace roto si esa ruta cambia.
 *
 * SYSTEM HEALTH: solo LEE estado ya materializado (config de canales vía
 * `getProvider(...).capabilities.configured`, `isFourvenuesSchedulerRunning()`)
 * más un único `SELECT 1` barato para DB — nunca abre una conexión nueva por
 * canal, nunca hace ping real a Fourvenues (reutiliza el `overallStatus` ya
 * calculado por `getFourvenuesHealth`, spec §13). El cacheado 30-60s (spec
 * §27) se implementa en la capa de router (`server/routers/dashboard.ts`),
 * no aquí — mantiene esta función pura y fácil de testear sin estado global.
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { EventPerformanceSnapshot } from "./commandCenterEvents";
import type { FourvenuesHealthSnapshot, FourvenuesOverallStatus } from "./commandCenterFourvenues";
import type { BenefitsPerformanceSnapshot } from "./commandCenterLoyalty";
import type { PlanAndPlaySnapshot } from "./commandCenterPlanAndPlay";
import type { OverviewSnapshot } from "./commandCenterOverview";
import { getProvider } from "../engagement/providers/providerRegistry";
import { isFourvenuesSchedulerRunning } from "../integrations/integrationScheduler";
import { LIVE_LOYALTY_ENABLED } from "../tokens/tokenEngine";
import type { StockAlertRow } from "../stock/stockService";
import type { OpenCashSessionRow } from "../cash/cashSessionService";
import type { Settlement } from "../../../drizzle/schema";
import type { VenueMissingSellerRow } from "../fiscal/commercialEntityService";
import type { EconomyConflict } from "../tokens/economyGovernanceService";

export type AlertSeverity = "critical" | "warning" | "opportunity" | "info";
export type AlertEntity = "event" | "venue" | "integration" | "benefit" | "proposal" | "historical" | "stock" | "cash" | "settlement" | "fiscal" | "communication" | "economy";

export interface ActionCenterAlert {
  severity: AlertSeverity;
  title: string;
  context: string;
  ctaEntity: AlertEntity | null;
  ctaEntityId: number | null;
}

export interface ActionCenterInputs {
  events: EventPerformanceSnapshot;
  fourvenues: FourvenuesHealthSnapshot;
  benefits: BenefitsPerformanceSnapshot;
  planAndPlay: PlanAndPlaySnapshot;
  overview: OverviewSnapshot;
  /**
   * Fase 12 (spec §6/§30-33) — opcionales para no romper ningún llamador
   * existente que aún no las pase: cada dominio nuevo se compone igual que
   * los de arriba, sobre snapshots YA calculados (nunca I/O aquí).
   */
  stockAlerts?: StockAlertRow[];
  openCashSessions?: OpenCashSessionRow[];
  settlementsNeedingAttention?: Settlement[];
  venuesMissingFiscalConfig?: VenueMissingSellerRow[];
  economyConflicts?: EconomyConflict[];
  /** Fase 11 (Communication Center) — recuento de `lastErrors` ya calculado por getEngagementOverview(), nunca una nueva consulta aquí. */
  communicationRecentFailures?: number;
}

const ZERO_SALES_CRITICAL_DAYS = 3;
const OPPORTUNITY_MIN_RESPONSES = 20;
const OPPORTUNITY_MIN_TOP_ANSWER_PCT = 75;
/** Una sesión de caja abierta más de este tiempo probablemente debería haberse cerrado ya (spec §31, "unclosed previous session"). */
const CASH_SESSION_STALE_HOURS = 18;

export function getActionCenterAlerts(inputs: ActionCenterInputs): ActionCenterAlert[] {
  const alerts: ActionCenterAlert[] = [];

  for (const integration of inputs.fourvenues.integrations) {
    if (integration.status === "error") {
      alerts.push({
        severity: "critical",
        title: `Integración Fourvenues en error — ${integration.venueName ?? `venue #${integration.venueId}`}`,
        context: integration.scheduler?.lastErrorMessage ?? "La integración reporta estado de error sin mensaje adicional.",
        ctaEntity: "integration", ctaEntityId: integration.integrationId,
      });
    }
  }

  for (const item of inputs.events.needsAttention) {
    const isCritical = item.reason === "zero_sales_close_to_event" && item.daysUntilEvent <= ZERO_SALES_CRITICAL_DAYS;
    alerts.push({
      severity: isCritical ? "critical" : "warning",
      title: item.reason === "zero_sales_close_to_event"
        ? `"${item.eventName}" sin ninguna venta a ${item.daysUntilEvent} día(s) del evento`
        : `"${item.eventName}" con ventas por debajo de lo esperado (${item.velocityPerDay}/día)`,
      context: `Evento el ${item.startsAt}. Tickets vendidos hasta ahora: ${item.ticketsSoldAllTime}.`,
      ctaEntity: "event", ctaEntityId: item.eventId,
    });
  }

  if (inputs.benefits.expiringWithin48h > 0) {
    alerts.push({
      severity: "warning",
      title: `${inputs.benefits.expiringWithin48h} Benefit(s) caducan en menos de 48h`,
      context: "Benefits activos cuya validez termina en las próximas 48 horas sin haberse canjeado.",
      ctaEntity: "benefit", ctaEntityId: null,
    });
  }

  for (const integration of inputs.fourvenues.integrations) {
    if (integration.status !== "error" && (!integration.enabled || !integration.syncEnabled || integration.status !== "connected")) {
      alerts.push({
        severity: "warning",
        title: `Sincronización degradada — ${integration.venueName ?? `venue #${integration.venueId}`}`,
        context: `enabled=${integration.enabled}, syncEnabled=${integration.syncEnabled}, status=${integration.status}.`,
        ctaEntity: "integration", ctaEntityId: integration.integrationId,
      });
    }
  }

  if (inputs.events.trendingEventId != null) {
    const trending = inputs.events.rows.find(r => r.eventId === inputs.events.trendingEventId);
    if (trending) {
      alerts.push({
        severity: "opportunity",
        title: `"${trending.eventName}" está en tendencia`,
        context: `${trending.velocity.last24h} tickets en las últimas 24h frente a ${trending.velocity.prior24h} en las 24h anteriores.`,
        ctaEntity: "event", ctaEntityId: trending.eventId,
      });
    }
  }

  const mostActive = inputs.planAndPlay.mostActive;
  if (mostActive && mostActive.responseCount >= OPPORTUNITY_MIN_RESPONSES && (mostActive.topAnswerPct ?? 0) >= OPPORTUNITY_MIN_TOP_ANSWER_PCT) {
    alerts.push({
      severity: "opportunity",
      title: `"${mostActive.title}" tiene demanda validada`,
      context: `${mostActive.topAnswerLabel ?? "Respuesta dominante"} ${mostActive.topAnswerPct}% de ${mostActive.responseCount} respuestas — candidata a convertirse en evento real.`,
      ctaEntity: "proposal", ctaEntityId: mostActive.proposalId,
    });
  }

  if (inputs.planAndPlay.pendingModerationStudentProposals > 0) {
    alerts.push({
      severity: "info",
      title: `${inputs.planAndPlay.pendingModerationStudentProposals} propuesta(s) de estudiantes pendientes de moderar`,
      context: "Ideas enviadas por estudiantes en Comunity esperando revisión.",
      ctaEntity: "proposal", ctaEntityId: null,
    });
  }

  if (inputs.overview.attendance.unresolvedHistoricalCount > 0) {
    alerts.push({
      severity: "info",
      title: `${inputs.overview.attendance.unresolvedHistoricalCount} operación(es) históricas de asistencia sin resolver`,
      context: "Registros de Fourvenues sin identidad vinculada aún — consultar el directorio de Estudiantes históricos.",
      ctaEntity: "historical", ctaEntityId: null,
    });
  }

  // Fase 12 (spec §6/§30) — stock.
  for (const item of inputs.stockAlerts ?? []) {
    alerts.push({
      severity: item.status === "out_of_stock" ? "critical" : "warning",
      title: item.status === "out_of_stock"
        ? `"${item.productName}" agotado — ${item.venueName}`
        : `"${item.productName}" con stock bajo (${item.currentStock}) — ${item.venueName}`,
      context: item.lowStockThreshold != null ? `Umbral configurado: ${item.lowStockThreshold} unidades.` : "Sin unidades disponibles.",
      ctaEntity: "stock", ctaEntityId: item.venueProductId,
    });
  }

  // Fase 12 (spec §6/§31) — caja abierta más tiempo del esperado.
  for (const session of inputs.openCashSessions ?? []) {
    if (session.hoursOpen < CASH_SESSION_STALE_HOURS) continue;
    alerts.push({
      severity: "warning",
      title: `Sesión de caja abierta desde hace ${session.hoursOpen}h — ${session.venueName}`,
      context: `Abierta el ${session.openedAt.toISOString()}. Puede corresponder a un cierre pendiente de un turno anterior.`,
      ctaEntity: "cash", ctaEntityId: session.sessionId,
    });
  }

  // Fase 12 (spec §6/§32) — liquidaciones que ya empezaron el ciclo pero no llegaron a pagadas.
  for (const settlement of inputs.settlementsNeedingAttention ?? []) {
    alerts.push({
      severity: "info",
      title: `Liquidación ${settlement.status === "approved" ? "aprobada pendiente de pago" : "calculada pendiente de aprobación"} — venue #${settlement.venueId}`,
      context: `Periodo ${settlement.periodStart.toISOString().slice(0, 10)} → ${settlement.periodEnd.toISOString().slice(0, 10)}.`,
      ctaEntity: "settlement", ctaEntityId: settlement.id,
    });
  }

  // Fase 12 (spec §6/§33) — venues sin configuración fiscal (nunca se afirma cumplimiento legal, solo config incompleta).
  for (const venue of inputs.venuesMissingFiscalConfig ?? []) {
    alerts.push({
      severity: "warning",
      title: `Sin vendedor fiscal configurado — ${venue.venueName}`,
      context: "Las ventas de este venue no tienen entidad vendedora activa asignada (venue_seller_config).",
      ctaEntity: "fiscal", ctaEntityId: venue.venueId,
    });
  }

  // Fase 12 (spec §6/§19) — conflictos de configuración de la economía SegoTokens (Fase 10.5, reutilizado tal cual).
  for (const conflict of inputs.economyConflicts ?? []) {
    if (conflict.severity === "not_connected") continue; // hecho ya conocido/documentado (p.ej. Comunity idea-submitted), no una alerta operativa nueva
    alerts.push({
      severity: conflict.severity === "conflict" ? "warning" : "info",
      title: conflict.message,
      context: `Código: ${conflict.code}.`,
      ctaEntity: "economy", ctaEntityId: null,
    });
  }

  // Fase 12 (spec §6/§23) — fallos recientes de entrega de Communication Center (Fase 11, reutilizado).
  if ((inputs.communicationRecentFailures ?? 0) > 0) {
    alerts.push({
      severity: "warning",
      title: `${inputs.communicationRecentFailures} entrega(s) de comunicación fallida(s) recientemente`,
      context: "Ver el detalle de entregas en Communication Center.",
      ctaEntity: "communication", ctaEntityId: null,
    });
  }

  const severityOrder: Record<AlertSeverity, number> = { critical: 0, warning: 1, opportunity: 2, info: 3 };
  return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

export type ServiceStatus = "ok" | "degraded" | "error" | "off";

export interface SystemHealthItem {
  key: string;
  label: string;
  status: ServiceStatus;
  detail: string;
}

export interface SystemHealthSnapshot {
  items: SystemHealthItem[];
}

export async function getSystemHealth(db: AnyDbHandle, fourvenuesOverallStatus: FourvenuesOverallStatus): Promise<SystemHealthSnapshot> {
  const items: SystemHealthItem[] = [];

  items.push({ key: "api", label: "API", status: "ok", detail: "Respondiendo (esta misma petición es la evidencia)." });

  const dbStart = Date.now();
  let dbStatus: ServiceStatus = "ok";
  let dbDetail = "";
  try {
    await db.execute(sql`SELECT 1`);
    const ms = Date.now() - dbStart;
    dbStatus = ms > 1000 ? "degraded" : "ok";
    dbDetail = `${ms}ms`;
  } catch (err) {
    dbStatus = "error";
    dbDetail = err instanceof Error ? err.message : "Error desconocido";
  }
  items.push({ key: "db", label: "Base de datos", status: dbStatus, detail: dbDetail });

  const fourvenuesStatus: ServiceStatus = fourvenuesOverallStatus === "all_healthy" ? "ok"
    : fourvenuesOverallStatus === "degraded" ? "degraded"
    : fourvenuesOverallStatus === "error" ? "error"
    : "off";
  items.push({ key: "fourvenues", label: "Fourvenues", status: fourvenuesStatus, detail: fourvenuesOverallStatus });

  const schedulerRunning = isFourvenuesSchedulerRunning();
  items.push({ key: "scheduler", label: "Scheduler de integraciones", status: schedulerRunning ? "ok" : "off", detail: schedulerRunning ? "En ejecución" : "No arrancado en este proceso" });

  // SegoTokens Live Activation (spec §19) — refleja tokenEngine.ts:LIVE_LOYALTY_ENABLED en tiempo real (antes era un literal "off" fijo).
  items.push({
    key: "loyalty", label: "Loyalty (LIVE)",
    status: LIVE_LOYALTY_ENABLED ? "ok" : "off",
    detail: LIVE_LOYALTY_ENABLED ? "Activo — venue_integrations.loyalty_enabled decide por venue" : "LIVE_LOYALTY_ENABLED=false — bloqueado a propósito, no es un fallo.",
  });

  for (const [key, label, channel] of [["email", "Email", "email"], ["push", "Push", "push"], ["whatsapp", "WhatsApp", "whatsapp"]] as const) {
    const configured = getProvider(channel).capabilities.configured;
    items.push({ key, label, status: configured ? "ok" : "off", detail: configured ? "Provider configurado" : "Sin credenciales/flag activo" });
  }

  return { items };
}
