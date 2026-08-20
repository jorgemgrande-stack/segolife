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

/** Lectura de pared (Europe/Madrid) de un instante — mismo Intl.DateTimeFormat que el resto del fichero, sin librería de zonas horarias nueva. */
function madridWallClockOf(instant: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map(p => [p.type, p.value]));
  // hour12:false puede devolver "24" para medianoche en algunos motores ICU — normaliza a 0.
  const hour = parts.hour === "24" ? "0" : parts.hour;
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), h: Number(hour), mi: Number(parts.minute), s: Number(parts.second) };
}

/**
 * Instante UTC que corresponde a las 00:00:00 de "YYYY-MM-DD" en
 * Europe/Madrid — DST-safe (usa una corrección de una iteración leyendo el
 * offset real vigente para ese instante concreto, nunca una tabla de
 * offsets propia). Para el filtro de rango de fechas del Admin de Eventos
 * (FIX-06): "01/03/2026" significa el día calendario en Madrid, nunca en
 * UTC — `new Date("2026-03-01")` sería incorrecto aquí (interpreta
 * medianoche UTC, que en invierno es la 01:00 de Madrid del mismo día, pero
 * en verano ya son las 02:00 — el error se nota exactamente en eventos de
 * madrugada, el caso real que este helper existe para evitar).
 */
export function madridDayStartUtc(dateStr: string): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, 0, 0, 0);
  const wall = madridWallClockOf(new Date(guess));
  const wallAsUtc = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s);
  const diff = wallAsUtc - guess; // cuánto se "adelantó" el guess al leerse como hora de Madrid
  return new Date(guess - diff);
}

/** "YYYY-MM-DD" + 1 día calendario, aritmética pura en UTC (nunca cruza por zona horaria — evita el mismo error de un día que madridDayStartUtc corrige en el otro sentido). */
function addOneCalendarDay(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/**
 * Límites UTC [from, to) para un filtro de rango de fechas "Desde"/"Hasta"
 * (ambas "YYYY-MM-DD", día calendario Europe/Madrid) — INCLUSIVO en ambos
 * extremos por diseño: `to` se convierte al inicio del día SIGUIENTE para
 * usarse como límite superior EXCLUSIVO (`starts_at < toUtc`), evitando el
 * problema de milisegundos de comparar contra "23:59:59.999" de `to`.
 */
export function madridDateRangeToUtcBounds(fromDateStr?: string | null, toDateStr?: string | null): { fromUtc?: Date; toUtc?: Date } {
  return {
    fromUtc: fromDateStr ? madridDayStartUtc(fromDateStr) : undefined,
    toUtc: toDateStr ? madridDayStartUtc(addOneCalendarDay(toDateStr)) : undefined,
  };
}
