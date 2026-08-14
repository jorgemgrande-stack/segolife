/**
 * student360.ts — DTOs compartidos server/cliente para "Student 360"
 * (ficha 360 del estudiante). Diseñados en
 * docs/students/student-360-audit-and-architecture.md §3-5.
 *
 * Regla: estos tipos son la forma de PRESENTACIÓN (lo que ve un admin),
 * nunca la fuente de verdad — la fuente de verdad sigue siendo cada tabla de
 * dominio (ticket_orders, token_ledger, user_benefits...). Ningún campo aquí
 * se persiste tal cual en BD; todo se deriva en el momento de servir la
 * respuesta. No incluir campos puramente de presentación (colores, iconos)
 * — eso lo decide el frontend a partir de `type`.
 */

// ─── Timeline / Activity Aggregator ────────────────────────────────────────

export type TimelineEventType =
  | "ticket_purchase"
  | "ticket_cancelled"
  | "ticket_refunded"
  | "event_attendance"
  | "consumption_pos"
  | "consumption_qr"
  | "token_credit"
  | "token_debit"
  | "benefit_granted"
  | "benefit_used"
  | "benefit_cancelled"
  | "internal_note"
  | "tag_assigned"
  | "login"
  | "admin_action"
  // COMUNITY (spec punto 79) — solo los eventos con valor directo para el
  // admin viendo la ficha del estudiante; el resto (proposal_approved,
  // reward, event_conversion) ya quedan cubiertos por token_credit/
  // admin_action existentes, no se duplican.
  | "community_response"
  | "community_support"
  | "community_proposal_submitted"
  // Communication Center (spec §24) — solo el canal email tiene valor real
  // en el timeline (in_app ya tiene su propia inbox dedicada, ver
  // Notifications.tsx — mostrarlo aquí también sería ruido duplicado, spec
  // §24: "no contaminar el timeline con eventos técnicos irrelevantes").
  | "communication_email";

export interface TimelineEventDTO {
  /** Sintético: `${source}:${sourceRowId}` — único dentro de la ficha, no un id de BD real. */
  id: string;
  occurredAt: string; // ISO 8601
  type: TimelineEventType;
  title: string;
  description: string | null;
  /** Tabla/servicio de origen — para depuración y para que el cliente nunca tenga que adivinar. */
  source: string;
  amountCents: number | null;
  tokens: number | null;
  venueName: string | null;
  eventName: string | null;
  metadata: Record<string, unknown> | null;
}

/** Cursor opaco de paginación del timeline — el cliente lo trata como valor opaco (no lo construye a mano). */
export interface TimelineCursor {
  occurredAt: string;
  id: string;
}

export interface TimelineFilters {
  types?: TimelineEventType[];
  from?: string; // ISO date
  to?: string; // ISO date
}

export interface TimelinePage {
  items: TimelineEventDTO[];
  nextCursor: TimelineCursor | null;
}

// ─── SegoScore ──────────────────────────────────────────────────────────────

export type SegoScoreDimensionKey =
  | "recency"
  | "frequency"
  | "events"
  | "commerce"
  | "loyalty"
  | "engagement";

export interface SegoScoreDimension {
  key: SegoScoreDimensionKey;
  label: string;
  available: boolean;
  /** Valor crudo antes de normalizar (p.ej. días desde última actividad, nº de eventos). Solo informativo. */
  rawValue: number | null;
  /** 0-100, null si `available=false`. */
  normalizedScore: number | null;
  /** Fuente citada — nunca un número sin explicación (spec §57). */
  sourceLabel: string;
  reason: string | null;
}

export interface SegoScoreDTO {
  /** null si menos de MIN_DIMENSIONS_REQUIRED dimensiones tienen datos — nunca un score fabricado. */
  score: number | null;
  insufficientData: boolean;
  dimensions: SegoScoreDimension[];
  computedAt: string;
}

// ─── Segmentación ───────────────────────────────────────────────────────────

export type StudentSegmentKey =
  | "nuevo"
  | "activo"
  | "muy_activo"
  | "vip"
  | "en_riesgo"
  | "dormido"
  | "sin_datos";

export interface SegmentDTO {
  key: StudentSegmentKey;
  label: string;
  /** Por qué se le asignó este segmento — regla centralizada, nunca oculta en JSX (spec §57). */
  reason: string;
}

// ─── Alertas administrativas ────────────────────────────────────────────────

export type AdminAlertKey =
  | "incomplete_profile"
  | "inactive_60d"
  | "benefit_expiring_soon"
  | "upcoming_ticket"
  | "high_token_balance";

export interface AdminAlertDTO {
  key: AdminAlertKey;
  severity: "info" | "warning";
  message: string;
}

// ─── Resumen ejecutivo (students360.getSummary) ────────────────────────────

export interface StudentSummaryKpis {
  eventsPurchased: number;
  eventsAttended: number;
  totalSpendCents: number;
  tokensBalance: number;
  tokensLifetimeEarned: number;
  tokensLifetimeSpent: number;
  benefitsAvailable: number;
  benefitsUsed: number;
  unreadNotifications: number;
}

export interface StudentNextEventDTO {
  id: number;
  name: string;
  slug: string;
  startsAt: string;
}

export interface StudentSummaryDTO {
  studentProfileId: number;
  userId: number;
  fullName: string;
  status: "active" | "inactive";
  profileCompleted: boolean;
  communities: { id: number; name: string; slug: string }[];
  segoScore: SegoScoreDTO;
  segment: SegmentDTO;
  kpis: StudentSummaryKpis;
  nextEvent: StudentNextEventDTO | null;
  lastActivityAt: string | null;
  /** Acotado (últimos N) — para el timeline completo usar students360.getActivity. */
  recentActivity: TimelineEventDTO[];
  alerts: AdminAlertDTO[];
}
