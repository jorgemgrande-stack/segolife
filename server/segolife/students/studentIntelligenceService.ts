/**
 * studentIntelligenceService.ts — SegoScore, Segmentación y Alertas de
 * Student 360.
 *
 * Fórmula y reglas diseñadas en
 * docs/students/student-360-audit-and-architecture.md §3. Funciones PURAS
 * (sin I/O) — reciben datos ya obtenidos por el router (un único fan-out por
 * request, ver studentActivityAggregator.ts) para poder testear sin BD y
 * para no repetir queries.
 *
 * IMPORTANTE — constantes de normalización/umbrales: son HEURÍSTICAS
 * INICIALES documentadas aquí en un único sitio, no derivadas todavía de
 * datos reales de la comunidad piloto (spec: "los pesos se determinan
 * DESPUÉS de ver datos reales, no antes"). Ajustar aquí cuando haya volumen
 * suficiente para calibrar — nunca hardcodear otro criterio en el frontend.
 */
import type {
  TimelineEventDTO,
  SegoScoreDTO,
  SegoScoreDimension,
  SegoScoreDimensionKey,
  SegmentDTO,
  StudentSegmentKey,
  AdminAlertDTO,
} from "../../../shared/segolife/student360";
import { deriveLastActivityAt, deriveActivityCountInWindow } from "./studentActivityAggregator";

// ─── Constantes ajustables (ver cabecera) ──────────────────────────────────
const MIN_DIMENSIONS_REQUIRED = 3;
const NEW_STUDENT_GRACE_DAYS = 14; // por debajo de esto, "Datos insuficientes" en vez de penalizar
const FREQUENCY_WINDOW_DAYS = 90;

const RECENCY_MAX_DAYS = 60; // 0 días = 100, >=60 días = 0
const FREQUENCY_TARGET_EVENTS = 10; // 10+ eventos de actividad en 90d = 100
const EVENTS_TARGET_COUNT = 5; // 5+ (tickets comprados + asistencias) = 100
const COMMERCE_TARGET_CENTS = 10000; // 100€ acumulados = 100
const LOYALTY_TARGET_ACTIONS = 10; // 10+ movimientos de ledger/beneficios usados = 100
const ENGAGEMENT_TARGET_INTERACTIONS = 5; // 5+ notificaciones leídas/clicadas = 100

const DIMENSION_LABELS: Record<SegoScoreDimensionKey, string> = {
  recency: "Recencia",
  frequency: "Frecuencia",
  events: "Eventos",
  commerce: "Consumo",
  loyalty: "Fidelización",
  engagement: "Engagement",
};

const DIMENSION_WEIGHTS: Record<SegoScoreDimensionKey, number> = {
  recency: 0.25,
  frequency: 0.2,
  events: 0.2,
  commerce: 0.15,
  loyalty: 0.1,
  engagement: 0.1,
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeLinear(raw: number, target: number): number {
  if (target <= 0) return 0;
  return clamp(Math.round((raw / target) * 100), 0, 100);
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

export interface StudentIntelligenceInput {
  registeredAt: Date;
  profileCompleted: boolean;
  /** Ya ordenado desc por occurredAt — ver getStudentActivitySnapshot. */
  activitySnapshot: TimelineEventDTO[];
  eventsPurchasedCount: number;
  eventsAttendedCount: number;
  totalSpendCents: number;
  tokensBalance: number;
  tokensLifetimeEarned: number;
  benefitsUsedCount: number;
  benefitsAvailableCount: number;
  /** true si algún beneficio 'active' vence en los próximos 7 días. */
  hasBenefitExpiringSoon: boolean;
  nextEventStartsAt: string | null;
  unreadNotifications: number;
  /** Notificaciones in-app leídas o clicadas — única señal de engagement medible hoy (ver auditoría §F: open/click rate de email no existen). */
  notificationInteractionCount: number;
  now: Date;
}

// ─── SegoScore ──────────────────────────────────────────────────────────────

export function computeSegoScore(input: StudentIntelligenceInput): SegoScoreDTO {
  const computedAt = input.now.toISOString();
  const daysSinceRegistration = daysBetween(input.registeredAt, input.now);

  // Estudiante recién registrado: nunca penalizar por falta de histórico
  // (spec §3, "no penalizar automáticamente si faltan datos").
  if (daysSinceRegistration < NEW_STUDENT_GRACE_DAYS) {
    const dims: SegoScoreDimension[] = (Object.keys(DIMENSION_LABELS) as SegoScoreDimensionKey[]).map(key => ({
      key,
      label: DIMENSION_LABELS[key],
      available: false,
      rawValue: null,
      normalizedScore: null,
      sourceLabel: dimensionSourceLabel(key),
      reason: "Estudiante recién registrado — todavía sin histórico suficiente",
    }));
    return { score: null, insufficientData: true, dimensions: dims, computedAt };
  }

  const lastActivityIso = deriveLastActivityAt(input.activitySnapshot);
  const sinceWindow = new Date(input.now.getTime() - FREQUENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const recencyDays = lastActivityIso ? daysBetween(new Date(lastActivityIso), input.now) : null;
  const recency: SegoScoreDimension = recencyDays === null
    ? { key: "recency", label: DIMENSION_LABELS.recency, available: false, rawValue: null, normalizedScore: null, sourceLabel: dimensionSourceLabel("recency"), reason: "Sin actividad registrada todavía" }
    : { key: "recency", label: DIMENSION_LABELS.recency, available: true, rawValue: recencyDays, normalizedScore: clamp(Math.round(100 - (recencyDays / RECENCY_MAX_DAYS) * 100), 0, 100), sourceLabel: dimensionSourceLabel("recency"), reason: null };

  const frequencyCount = deriveActivityCountInWindow(input.activitySnapshot, sinceWindow);
  const frequency: SegoScoreDimension = {
    key: "frequency", label: DIMENSION_LABELS.frequency, available: true, rawValue: frequencyCount,
    normalizedScore: normalizeLinear(frequencyCount, FREQUENCY_TARGET_EVENTS), sourceLabel: dimensionSourceLabel("frequency"), reason: null,
  };

  const eventsCount = input.eventsPurchasedCount + input.eventsAttendedCount;
  const events: SegoScoreDimension = {
    key: "events", label: DIMENSION_LABELS.events, available: true, rawValue: eventsCount,
    normalizedScore: normalizeLinear(eventsCount, EVENTS_TARGET_COUNT), sourceLabel: dimensionSourceLabel("events"), reason: null,
  };

  const commerce: SegoScoreDimension = {
    key: "commerce", label: DIMENSION_LABELS.commerce, available: true, rawValue: input.totalSpendCents,
    normalizedScore: normalizeLinear(input.totalSpendCents, COMMERCE_TARGET_CENTS), sourceLabel: dimensionSourceLabel("commerce"), reason: null,
  };

  const loyaltyActions = frequencyCountByType(input.activitySnapshot, ["token_credit", "token_debit"]) + input.benefitsUsedCount;
  const loyalty: SegoScoreDimension = {
    key: "loyalty", label: DIMENSION_LABELS.loyalty, available: true, rawValue: loyaltyActions,
    normalizedScore: normalizeLinear(loyaltyActions, LOYALTY_TARGET_ACTIONS), sourceLabel: dimensionSourceLabel("loyalty"), reason: null,
  };

  const engagement: SegoScoreDimension = {
    key: "engagement", label: DIMENSION_LABELS.engagement, available: true, rawValue: input.notificationInteractionCount,
    normalizedScore: normalizeLinear(input.notificationInteractionCount, ENGAGEMENT_TARGET_INTERACTIONS), sourceLabel: dimensionSourceLabel("engagement"), reason: null,
  };

  const dimensions = [recency, frequency, events, commerce, loyalty, engagement];
  const available = dimensions.filter(d => d.available && d.normalizedScore !== null);

  if (available.length < MIN_DIMENSIONS_REQUIRED) {
    return { score: null, insufficientData: true, dimensions, computedAt };
  }

  const weightSum = available.reduce((sum, d) => sum + DIMENSION_WEIGHTS[d.key], 0);
  const weighted = available.reduce((sum, d) => sum + (d.normalizedScore as number) * DIMENSION_WEIGHTS[d.key], 0);
  const score = Math.round(weighted / weightSum);

  return { score, insufficientData: false, dimensions, computedAt };
}

function dimensionSourceLabel(key: SegoScoreDimensionKey): string {
  switch (key) {
    case "recency": return "Última actividad (asistencia/consumo/tokens)";
    case "frequency": return "Nº de eventos de actividad en 90 días";
    case "events": return "Tickets comprados + asistencias registradas";
    case "commerce": return "Gasto acumulado (tickets + consumo)";
    case "loyalty": return "Movimientos de SegoTokens + beneficios usados";
    case "engagement": return "Notificaciones in-app leídas/clicadas";
  }
}

function frequencyCountByType(events: TimelineEventDTO[], types: string[]): number {
  const set = new Set(types);
  return events.filter(e => set.has(e.type)).length;
}

// ─── Segmentación ───────────────────────────────────────────────────────────
// Reglas centralizadas y deterministas — nunca embebidas en JSX (spec §57).
// Prioridad evaluada en orden: la primera regla que aplique gana.

export function computeSegment(input: StudentIntelligenceInput): SegmentDTO {
  const daysSinceRegistration = daysBetween(input.registeredAt, input.now);
  if (daysSinceRegistration < NEW_STUDENT_GRACE_DAYS) {
    return { key: "nuevo", label: "Nuevo", reason: `Registrado hace ${daysSinceRegistration} día(s)` };
  }

  const lastActivityIso = deriveLastActivityAt(input.activitySnapshot);
  const daysSinceActivity = lastActivityIso ? daysBetween(new Date(lastActivityIso), input.now) : null;

  if (daysSinceActivity === null || daysSinceActivity > 60) {
    return { key: "dormido", label: "Dormido", reason: daysSinceActivity === null ? "Sin ninguna actividad registrada" : `Última actividad hace ${daysSinceActivity} días` };
  }
  if (daysSinceActivity > 30) {
    return { key: "en_riesgo", label: "En riesgo", reason: `Última actividad hace ${daysSinceActivity} días (30-60)` };
  }

  const sinceWindow = new Date(input.now.getTime() - FREQUENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const frequencyCount = deriveActivityCountInWindow(input.activitySnapshot, sinceWindow);

  const isHighValue = input.totalSpendCents >= COMMERCE_TARGET_CENTS * 2 || input.tokensLifetimeEarned >= LOYALTY_TARGET_ACTIONS * 20;
  if (isHighValue && daysSinceActivity <= 30) {
    return { key: "vip", label: "VIP", reason: `Gasto acumulado ${(input.totalSpendCents / 100).toFixed(0)}€ o ${input.tokensLifetimeEarned} tokens ganados, con actividad reciente` };
  }
  if (frequencyCount >= FREQUENCY_TARGET_EVENTS && daysSinceActivity <= 14) {
    return { key: "muy_activo", label: "Muy activo", reason: `${frequencyCount} eventos de actividad en los últimos ${FREQUENCY_WINDOW_DAYS} días` };
  }
  return { key: "activo", label: "Activo", reason: `Última actividad hace ${daysSinceActivity} días` };
}

// ─── Alertas administrativas ────────────────────────────────────────────────

export function computeAlerts(input: StudentIntelligenceInput): AdminAlertDTO[] {
  const alerts: AdminAlertDTO[] = [];

  if (!input.profileCompleted) {
    alerts.push({ key: "incomplete_profile", severity: "info", message: "El perfil del estudiante está incompleto" });
  }

  const lastActivityIso = deriveLastActivityAt(input.activitySnapshot);
  const daysSinceRegistration = daysBetween(input.registeredAt, input.now);
  const daysSinceActivity = lastActivityIso ? daysBetween(new Date(lastActivityIso), input.now) : daysSinceRegistration;
  if (daysSinceRegistration >= NEW_STUDENT_GRACE_DAYS && daysSinceActivity >= 60) {
    alerts.push({ key: "inactive_60d", severity: "warning", message: `Sin actividad desde hace ${daysSinceActivity} días` });
  }

  if (input.hasBenefitExpiringSoon) {
    alerts.push({ key: "benefit_expiring_soon", severity: "warning", message: "Tiene un beneficio activo que vence en los próximos 7 días" });
  }

  if (input.nextEventStartsAt) {
    const daysToEvent = daysBetween(input.now, new Date(input.nextEventStartsAt));
    if (daysToEvent <= 3 && daysToEvent >= 0) {
      alerts.push({ key: "upcoming_ticket", severity: "info", message: "Tiene una entrada para un evento en los próximos 3 días" });
    }
  }

  if (input.tokensBalance >= LOYALTY_TARGET_ACTIONS * 50) {
    alerts.push({ key: "high_token_balance", severity: "info", message: `Saldo de SegoTokens elevado (${input.tokensBalance})` });
  }

  return alerts;
}

export type { StudentSegmentKey };
