/**
 * eventTiming.ts — Fase 8.6, punto 26. Única fuente de verdad para
 * clasificar un evento en el tiempo (upcoming/ongoing/past/tonight) —
 * antes cada componente repetía su propio `new Date() < startsAt`, con
 * riesgo real de divergencia (p.ej. un evento en curso apareciendo a la
 * vez como "próximo" en una pantalla y "pasado" en otra).
 *
 * Un evento sin `endsAt` (caso normal en nightlife — la hora de cierre no
 * siempre se fija de antemano) se considera en curso durante
 * DEFAULT_EVENT_DURATION_HOURS desde `startsAt` — evita marcar como
 * "pasado" una fiesta que acaba de empezar. No es una zona horaria
 * explícita en el cálculo: `startsAt`/`endsAt` ya vienen en UTC desde la
 * base de datos y JavaScript los compara correctamente contra `Date.now()`
 * sin necesidad de convertir; "Europe/Madrid" solo importa para decidir a
 * quién corresponde "hoy" al mostrar fechas (Intl.DateTimeFormat en los
 * componentes), no para esta comparación de instantes.
 */

export const DEFAULT_EVENT_DURATION_HOURS = 6;

export type EventTemporalStatus = "upcoming" | "ongoing" | "past";

export interface EventTimingInput {
  startsAt: Date | string;
  endsAt?: Date | string | null;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Instante en el que el evento se considera terminado a efectos de UI/compra. */
export function getEventEffectiveEnd(event: EventTimingInput): Date {
  if (event.endsAt) return toDate(event.endsAt);
  const start = toDate(event.startsAt);
  return new Date(start.getTime() + DEFAULT_EVENT_DURATION_HOURS * 60 * 60 * 1000);
}

export function getEventTemporalStatus(event: EventTimingInput, now: Date = new Date()): EventTemporalStatus {
  const start = toDate(event.startsAt);
  if (now.getTime() < start.getTime()) return "upcoming";
  const effectiveEnd = getEventEffectiveEnd(event);
  if (now.getTime() <= effectiveEnd.getTime()) return "ongoing";
  return "past";
}

export function isEventPast(event: EventTimingInput, now: Date = new Date()): boolean {
  return getEventTemporalStatus(event, now) === "past";
}

export function isEventUpcomingOrOngoing(event: EventTimingInput, now: Date = new Date()): boolean {
  return !isEventPast(event, now);
}

/** "Esta noche": empieza hoy (fecha calendario Europe/Madrid) o ya está en curso. */
export function isEventTonight(event: EventTimingInput, now: Date = new Date()): boolean {
  const status = getEventTemporalStatus(event, now);
  if (status === "past") return false;
  if (status === "ongoing") return true;
  const start = toDate(event.startsAt);
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(start) === fmt.format(now);
}

/** Ordena ascendente por inicio — para listados "próximos" (el más cercano primero). */
export function sortByStartAscending<T extends EventTimingInput>(events: T[]): T[] {
  return [...events].sort((a, b) => toDate(a.startsAt).getTime() - toDate(b.startsAt).getTime());
}

/** Ordena descendente por inicio — para listados "pasados" (el más reciente primero). */
export function sortByStartDescending<T extends EventTimingInput>(events: T[]): T[] {
  return [...events].sort((a, b) => toDate(b.startsAt).getTime() - toDate(a.startsAt).getTime());
}

export function splitUpcomingPast<T extends EventTimingInput>(events: T[], now: Date = new Date()): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const e of events) {
    if (isEventPast(e, now)) past.push(e);
    else upcoming.push(e);
  }
  return { upcoming: sortByStartAscending(upcoming), past: sortByStartDescending(past) };
}
