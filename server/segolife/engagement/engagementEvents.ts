/**
 * engagementEvents.ts — catálogo TIPADO de eventos de dominio internos
 * (Fase 7, spec punto 3). Mismo patrón exacto que
 * server/segolife/benefits/benefitEvents.ts: EventEmitter de Node en
 * singleton, sin colas, sin Redis/Kafka, cada listener aislado en su propio
 * try/catch + microtask. NO todos estos eventos tienen ya un emisor real
 * conectado — la infraestructura existe para poder emitirlos/consumirlos,
 * pero solo `BenefitGranted` (ver benefitGrantedListener.ts) dispara hoy
 * una notificación real, y solo en desarrollo/test (spec punto 27).
 *
 * DURABILIDAD: la emisión aquí NUNCA es durable por sí misma (un reinicio
 * del proceso pierde cualquier evento en tránsito) — por eso un listener
 * que decide "esto merece una notificación" debe escribir la fila de
 * `notifications` de forma SÍNCRONA dentro de su propio manejador, antes de
 * que termine. Una vez esa fila existe, sobrevive a cualquier reinicio (ver
 * docs/engagement/architecture.md, "Por qué NO hay tabla notification_events").
 *
 * Los motores de Benefits/SegoTokens/Ticketing/Attendance/Commerce/Events
 * SOLO deben llamar a `emitEngagementEvent` (o, en el caso de Benefits,
 * seguir usando `benefitEvents.emitBenefitGranted` ya existente) — nunca
 * deben conocer notificationService.ts ni ningún provider.
 */
import { EventEmitter } from "events";
import type { BenefitGrantedPayload } from "../benefits/benefitEvents";

export interface BenefitExpiringPayload {
  userId: number;
  userBenefitId: number;
  benefitDefinitionId: number;
  communityId: number | null;
  expiresAt: Date;
}

export interface BenefitUsedPayload {
  userId: number;
  userBenefitId: number;
  benefitDefinitionId: number;
  communityId: number | null;
  usedAt: Date;
  usedAtVenueId: number | null;
}

export interface TokensEarnedPayload {
  userId: number;
  communityId: number | null;
  amount: number;
  ledgerId: number;
  venueId: number | null;
  eventId: number | null;
}

export interface TokensSpentPayload {
  userId: number;
  communityId: number | null;
  amount: number;
  ledgerId: number;
}

export interface TokenCampaignStartedPayload {
  campaignId: number;
  communityId: number | null;
  name: string;
  startsAt: Date;
  endsAt: Date | null;
}

export interface RecurrenceProgressPayload {
  userId: number;
  communityId: number | null;
  currentCount: number;
  threshold: number;
  remaining: number;
  bonusAmount: number | null;
  ruleId: number;
}

export interface EventPublishedPayload {
  eventId: number;
  communityIds: number[];
  name: string;
  startsAt: Date;
}

export interface EventTodayPayload {
  eventId: number;
  communityIds: number[];
  name: string;
}

export interface EventTomorrowPayload {
  eventId: number;
  communityIds: number[];
  name: string;
}

export interface AttendanceConfirmedPayload {
  userId: number;
  communityId: number | null;
  eventId: number;
  venueId: number | null;
  attendanceId: number;
}

export interface CommerceProcessedPayload {
  userId: number;
  communityId: number | null;
  venueId: number;
  transactionId: number;
  totalCents: number;
}

export interface ProfileIncompletePayload {
  userId: number;
  communityId: number | null;
  missingFields: string[];
}

export interface ManualAnnouncementPayload {
  communityIds: number[];
  title: string;
  body: string;
  deepLink: string | null;
  createdByUserId: number;
}

export interface EngagementDomainEvents {
  benefit_granted: BenefitGrantedPayload;
  benefit_expiring: BenefitExpiringPayload;
  benefit_used: BenefitUsedPayload;
  tokens_earned: TokensEarnedPayload;
  tokens_spent: TokensSpentPayload;
  token_campaign_started: TokenCampaignStartedPayload;
  recurrence_progress: RecurrenceProgressPayload;
  event_published: EventPublishedPayload;
  event_today: EventTodayPayload;
  event_tomorrow: EventTomorrowPayload;
  attendance_confirmed: AttendanceConfirmedPayload;
  commerce_processed: CommerceProcessedPayload;
  profile_incomplete: ProfileIncompletePayload;
  manual_announcement: ManualAnnouncementPayload;
}

export type EngagementEventType = keyof EngagementDomainEvents;

type Listener<P> = (payload: P) => void | Promise<void>;

class EngagementEventEmitter extends EventEmitter {
  onTyped<K extends EngagementEventType>(event: K, listener: Listener<EngagementDomainEvents[K]>): void {
    this.on(event, (payload: EngagementDomainEvents[K]) => {
      Promise.resolve()
        .then(() => listener(payload))
        .catch(err => {
          console.error(`[EngagementEvents] listener de "${event}" falló (ignorado):`, err);
        });
    });
  }

  emitTyped<K extends EngagementEventType>(event: K, payload: EngagementDomainEvents[K]): void {
    this.emit(event, payload);
  }
}

export const engagementEvents = new EngagementEventEmitter();
engagementEvents.setMaxListeners(50);

export function emitEngagementEvent<K extends EngagementEventType>(event: K, payload: EngagementDomainEvents[K]): void {
  engagementEvents.emitTyped(event, payload);
}
