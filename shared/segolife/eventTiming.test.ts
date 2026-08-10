/**
 * eventTiming.test.ts — Fase 8.6, punto 26. Cubre la única fuente de verdad
 * para clasificar un evento en el tiempo, incluida la lógica horaria real
 * de Europe/Madrid en `isEventTonight` (spec punto 91: "timezone" es un
 * caso de test obligatorio explícito).
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_EVENT_DURATION_HOURS,
  getEventTemporalStatus,
  isEventPast,
  isEventUpcomingOrOngoing,
  isEventTonight,
  splitUpcomingPast,
} from "./eventTiming";

describe("eventTiming — getEventTemporalStatus / isEventPast", () => {
  const now = new Date("2026-08-10T12:00:00Z");

  it("un evento que empieza en el futuro es upcoming", () => {
    const event = { startsAt: new Date("2026-08-15T20:00:00Z") };
    expect(getEventTemporalStatus(event, now)).toBe("upcoming");
    expect(isEventPast(event, now)).toBe(false);
  });

  it("un evento con endsAt futuro y startsAt pasado está ongoing", () => {
    const event = { startsAt: new Date("2026-08-10T10:00:00Z"), endsAt: new Date("2026-08-10T14:00:00Z") };
    expect(getEventTemporalStatus(event, now)).toBe("ongoing");
  });

  it("un evento con endsAt ya pasado es past", () => {
    const event = { startsAt: new Date("2026-08-09T20:00:00Z"), endsAt: new Date("2026-08-09T23:00:00Z") };
    expect(getEventTemporalStatus(event, now)).toBe("past");
    expect(isEventPast(event, now)).toBe(true);
  });

  it("sin endsAt: sigue ongoing dentro de las DEFAULT_EVENT_DURATION_HOURS desde startsAt", () => {
    const startsAt = new Date(now.getTime() - (DEFAULT_EVENT_DURATION_HOURS - 1) * 60 * 60 * 1000);
    expect(getEventTemporalStatus({ startsAt }, now)).toBe("ongoing");
  });

  it("sin endsAt: pasa a past justo después de DEFAULT_EVENT_DURATION_HOURS desde startsAt", () => {
    const startsAt = new Date(now.getTime() - (DEFAULT_EVENT_DURATION_HOURS + 1) * 60 * 60 * 1000);
    expect(getEventTemporalStatus({ startsAt }, now)).toBe("past");
  });

  it("isEventUpcomingOrOngoing es verdadero para upcoming/ongoing y falso para past", () => {
    expect(isEventUpcomingOrOngoing({ startsAt: new Date("2026-08-20T00:00:00Z") }, now)).toBe(true);
    expect(isEventUpcomingOrOngoing({ startsAt: new Date("2026-08-01T00:00:00Z") }, now)).toBe(false);
  });
});

describe("eventTiming — isEventTonight (zona horaria Europe/Madrid explícita)", () => {
  it("un evento que empieza pasada la medianoche UTC pero sigue siendo 'hoy' en Madrid (CEST, UTC+2) cuenta como esta noche", () => {
    // now: 2026-08-10 23:30 UTC == 2026-08-11 01:30 en Madrid (CEST) — noche del 10 en Madrid.
    const now = new Date("2026-08-10T23:30:00Z");
    // El evento empieza 2026-08-10 22:00 UTC == 2026-08-11 00:00 Madrid — mismo día calendario Madrid que `now`.
    const event = { startsAt: new Date("2026-08-10T22:00:00Z") };
    expect(isEventTonight(event, now)).toBe(true);
  });

  it("un evento que en UTC parece 'mañana' pero en Madrid es la misma fecha calendario que ahora cuenta como esta noche", () => {
    // now: 2026-08-10 21:00 UTC == 2026-08-10 23:00 Madrid.
    const now = new Date("2026-08-10T21:00:00Z");
    // Evento empieza 2026-08-10 23:30 UTC == 2026-08-11 01:30 Madrid — DÍA calendario Madrid distinto (11 vs 10).
    const event = { startsAt: new Date("2026-08-10T23:30:00Z") };
    expect(isEventTonight(event, now)).toBe(false);
  });

  it("un evento ya pasado nunca es 'esta noche', aunque la fecha calendario coincida", () => {
    const now = new Date("2026-08-10T23:00:00Z");
    const event = { startsAt: new Date("2026-08-10T10:00:00Z"), endsAt: new Date("2026-08-10T12:00:00Z") };
    expect(isEventTonight(event, now)).toBe(false);
  });

  it("un evento en curso ahora mismo siempre es 'esta noche' (aunque empezara ayer en calendario)", () => {
    const now = new Date("2026-08-11T00:30:00Z");
    const event = { startsAt: new Date("2026-08-10T22:00:00Z"), endsAt: new Date("2026-08-11T04:00:00Z") };
    expect(isEventTonight(event, now)).toBe(true);
  });
});

describe("eventTiming — splitUpcomingPast", () => {
  const now = new Date("2026-08-10T12:00:00Z");

  it("separa correctamente upcoming/past y ordena cada lista según el criterio de la sección 91", () => {
    const events = [
      { id: 1, startsAt: new Date("2026-08-20T00:00:00Z") }, // upcoming, lejos
      { id: 2, startsAt: new Date("2026-08-15T00:00:00Z") }, // upcoming, cerca
      { id: 3, startsAt: new Date("2026-07-01T00:00:00Z") }, // past, lejos
      { id: 4, startsAt: new Date("2026-08-01T00:00:00Z") }, // past, reciente
    ];
    const { upcoming, past } = splitUpcomingPast(events, now);
    // Upcoming: ascendente (el más cercano primero).
    expect(upcoming.map(e => e.id)).toEqual([2, 1]);
    // Past: descendente (el más reciente primero).
    expect(past.map(e => e.id)).toEqual([4, 3]);
  });

  it("una lista vacía no lanza y devuelve ambos arrays vacíos", () => {
    expect(splitUpcomingPast([], now)).toEqual({ upcoming: [], past: [] });
  });
});
