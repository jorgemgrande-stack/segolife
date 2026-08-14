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

export type AlertSeverity = "critical" | "warning" | "opportunity" | "info";
export type AlertEntity = "event" | "venue" | "integration" | "benefit" | "proposal" | "historical";

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
}

const ZERO_SALES_CRITICAL_DAYS = 3;
const OPPORTUNITY_MIN_RESPONSES = 20;
const OPPORTUNITY_MIN_TOP_ANSWER_PCT = 75;

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
      context: "Ideas enviadas por estudiantes en Plan & Play esperando revisión.",
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

  items.push({ key: "loyalty", label: "Loyalty (LIVE)", status: "off", detail: "LIVE_MODE_ENABLED=false — bloqueado a propósito, no es un fallo." });

  for (const [key, label, channel] of [["email", "Email", "email"], ["push", "Push", "push"], ["whatsapp", "WhatsApp", "whatsapp"]] as const) {
    const configured = getProvider(channel).capabilities.configured;
    items.push({ key, label, status: configured ? "ok" : "off", detail: configured ? "Provider configurado" : "Sin credenciales/flag activo" });
  }

  return { items };
}
