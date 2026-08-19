/**
 * homeSummaryService.test.ts — MG-01. Cubre filterTonight, la lógica pura
 * de "esta noche" de la Home. Bug real encontrado durante la investigación
 * de MG-01 (documentado en el propio código, ver el comentario de
 * filterTonight): antes usaba resolveMadridMoment (medianoche de calendario)
 * en vez de resolveOperationalDate (día operativo de nightlife, límite
 * 06:00 Europe/Madrid) — un evento que empieza de madrugada (p.ej. 00:30)
 * desaparecía de "Tonight" para quien mirase la Home antes de medianoche,
 * aunque fuera la misma noche en términos de nightlife. Corregido y cubierto
 * aquí con test de regresión explícito.
 */
import { describe, it, expect } from "vitest";
import { filterTonight, pickTicketToday } from "./homeSummaryService";
import type { EventListItem } from "../../db/eventsDb";
import type { MyTicketWithEvent } from "../ticketing/ticketingDb";
import type { EventTicket } from "../../../drizzle/schema";

function makeEvent(id: number, startsAt: Date): EventListItem {
  return {
    id,
    name: `Event ${id}`,
    slug: `event-${id}`,
    description: null,
    venueId: null,
    startsAt,
    endsAt: null,
    capacity: null,
    imageUrl: null,
    status: "active",
    isFeatured: false,
    homeSortOrder: 0,
    sourceType: null,
    sourceId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    venue: null,
    communities: [],
    primarySalesChannel: null,
  };
}

function makeTicket(id: number, eventId: number, eventStartsAt: Date, overrides: Partial<{ status: EventTicket["status"]; qrToken: string | null }> = {}): MyTicketWithEvent {
  return {
    ticket: {
      id, eventId, ticketTypeId: null, orderId: 900, userId: 42,
      salesChannel: "native", provider: null, externalTicketId: null, externalParticipantId: null,
      status: overrides.status ?? "issued",
      qrToken: overrides.qrToken !== undefined ? overrides.qrToken : `qr-${id}`,
      qrTokenHash: null, issuedAt: new Date("2026-08-01"), cancelledAt: null, refundedAt: null,
      metadata: null, createdAt: new Date("2026-08-01"), updatedAt: new Date("2026-08-01"),
    },
    event: { id: eventId, name: `Event ${eventId}`, slug: `event-${eventId}`, startsAt: eventStartsAt, imageUrl: null },
  };
}

describe("pickTicketToday — FIX-02: mismo día operativo (06:00 Europe/Madrid) que filterTonight, nunca medianoche de calendario", () => {
  // Mismo evento de referencia que filterTonight: 2026-08-18 22:00 Madrid (CEST, UTC+2) = 20:00 UTC.
  const eventTonight = new Date("2026-08-18T20:00:00Z");

  it("REGRESIÓN — a las 23:59 (mismo día de calendario) el ticket de esta noche sigue apareciendo", () => {
    const at = new Date("2026-08-18T21:59:00Z"); // 23:59 Madrid
    const result = pickTicketToday([makeTicket(1, 10, eventTonight)], at);
    expect(result?.id).toBe(1);
  });

  it("REGRESIÓN — a las 00:00 EXACTAS (medianoche de calendario cruzada) el ticket NUNCA desaparece — bug real de MG-01 heredado, ahora corregido", () => {
    const at = new Date("2026-08-18T22:00:00Z"); // 00:00 Madrid del día siguiente
    const result = pickTicketToday([makeTicket(1, 10, eventTonight)], at);
    expect(result?.id).toBe(1);
  });

  it("a las 00:30 el ticket sigue apareciendo — misma noche operativa", () => {
    const at = new Date("2026-08-18T22:30:00Z"); // 00:30 Madrid
    const result = pickTicketToday([makeTicket(1, 10, eventTonight)], at);
    expect(result?.id).toBe(1);
  });

  it("a las 02:00 el ticket sigue apareciendo", () => {
    const at = new Date("2026-08-19T00:00:00Z"); // 02:00 Madrid
    const result = pickTicketToday([makeTicket(1, 10, eventTonight)], at);
    expect(result?.id).toBe(1);
  });

  it("a las 05:59 (último minuto antes del corte operativo) el ticket TODAVÍA aparece", () => {
    const at = new Date("2026-08-19T03:59:00Z"); // 05:59 Madrid
    const result = pickTicketToday([makeTicket(1, 10, eventTonight)], at);
    expect(result?.id).toBe(1);
  });

  it("a las 06:00 EXACTAS (corte operativo real) el ticket de la noche anterior YA NO aparece como 'hoy'", () => {
    const at = new Date("2026-08-19T04:00:00Z"); // 06:00 Madrid — cruza el corte operativo
    const result = pickTicketToday([makeTicket(1, 10, eventTonight)], at);
    expect(result).toBeNull();
  });

  it("DST Europe/Madrid (cambio de horario, 2026-10-25 CEST→CET) — un ticket de la noche que cruza la transición sigue resolviendo a la misma noche operativa", () => {
    // Evento 2026-10-24 23:00 Madrid (CEST, UTC+2) = 21:00 UTC.
    const eventAcrossDst = new Date("2026-10-24T21:00:00Z");
    // `at` 2026-10-25 04:00 Madrid — YA en CET (UTC+1), tras la transición a las 03:00 CEST/02:00 CET = 03:00 UTC.
    const at = new Date("2026-10-25T03:00:00Z");
    const result = pickTicketToday([makeTicket(1, 10, eventAcrossDst)], at);
    expect(result?.id).toBe(1);
  });

  it("evento de la noche ANTERIOR (ya pasada) no aparece como ticket de hoy", () => {
    const eventYesterday = new Date("2026-08-17T20:00:00Z"); // 22:00 Madrid, noche anterior
    const at = eventTonight; // 22:00 Madrid de la noche siguiente
    const result = pickTicketToday([makeTicket(1, 10, eventYesterday)], at);
    expect(result).toBeNull();
  });

  it("evento de la noche SIGUIENTE (todavía no llega) no aparece como ticket de hoy", () => {
    const eventTomorrow = new Date("2026-08-19T20:00:00Z"); // 22:00 Madrid, noche siguiente
    const at = eventTonight;
    const result = pickTicketToday([makeTicket(1, 10, eventTomorrow)], at);
    expect(result).toBeNull();
  });

  it("un ticket 'used' NUNCA se propone como el ticket de hoy, aunque el evento sea el de esta noche", () => {
    const at = eventTonight;
    const result = pickTicketToday([makeTicket(1, 10, eventTonight, { status: "used" })], at);
    expect(result).toBeNull();
  });

  it("un ticket 'issued' válido de esta noche sí se propone, con qrToken real", () => {
    const at = eventTonight;
    const result = pickTicketToday([makeTicket(1, 10, eventTonight, { qrToken: "real-qr-abc" })], at);
    expect(result).toEqual({
      id: 1, qrToken: "real-qr-abc",
      event: { id: 10, name: "Event 10", slug: "event-10", startsAt: eventTonight, imageUrl: null },
    });
  });

  it("múltiples tickets: solo el 'issued' de esta noche se propone — ignora used, ayer y mañana", () => {
    const at = eventTonight;
    const tickets = [
      makeTicket(1, 10, new Date("2026-08-17T20:00:00Z")), // ayer, issued — no cuenta
      makeTicket(2, 11, eventTonight, { status: "used" }), // hoy pero used — no cuenta
      makeTicket(3, 12, eventTonight), // hoy, issued — ESTE
      makeTicket(4, 13, new Date("2026-08-19T20:00:00Z")), // mañana, issued — no cuenta
    ];
    const result = pickTicketToday(tickets, at);
    expect(result?.id).toBe(3);
  });
});

describe("filterTonight — día operativo de nightlife (spec MG-01 §3)", () => {
  // 2026-08-18 22:00 Europe/Madrid (CEST, UTC+2) = 20:00 UTC.
  const now2200Madrid = new Date("2026-08-18T20:00:00Z");

  it("REGRESIÓN — un evento que empieza a las 00:30 (ya técnicamente 'mañana' en el calendario) SIGUE apareciendo en Tonight visto desde las 22:00 de la noche anterior", () => {
    // 2026-08-19 00:30 Europe/Madrid (CEST) = 2026-08-18 22:30 UTC.
    const eventAt0030 = makeEvent(1, new Date("2026-08-18T22:30:00Z"));
    const result = filterTonight([eventAt0030], now2200Madrid);
    expect(result.map(e => e.id)).toEqual([1]);
  });

  it("un evento de la tarde/noche normal (22:00 el mismo día) sigue apareciendo — sin regresión para el caso estándar", () => {
    const eventAt2200 = makeEvent(2, new Date("2026-08-18T20:00:00Z"));
    const result = filterTonight([eventAt2200], now2200Madrid);
    expect(result.map(e => e.id)).toEqual([2]);
  });

  it("un evento de madrugada (03:00) visto DESPUÉS de medianoche (a la 01:00) sigue en Tonight — misma noche operativa", () => {
    // 2026-08-19 01:00 Europe/Madrid (CEST) = 2026-08-18 23:00 UTC.
    const nowAt0100Madrid = new Date("2026-08-18T23:00:00Z");
    // 2026-08-19 03:00 Europe/Madrid (CEST) = 2026-08-19 01:00 UTC.
    const eventAt0300 = makeEvent(3, new Date("2026-08-19T01:00:00Z"));
    const result = filterTonight([eventAt0300], nowAt0100Madrid);
    expect(result.map(e => e.id)).toEqual([3]);
  });

  it("un evento de la noche SIGUIENTE (24h después) NO aparece como si fuera la misma noche operativa", () => {
    // 2026-08-19 22:00 Europe/Madrid (CEST) = 2026-08-19 20:00 UTC — 24h después de `now2200Madrid`.
    const eventNextNight = makeEvent(4, new Date("2026-08-19T20:00:00Z"));
    const result = filterTonight([eventNextNight], now2200Madrid);
    expect(result).toEqual([]);
  });

  it("un evento ya pasado (ayer por la tarde) no aparece en Tonight de hoy", () => {
    const eventYesterday = makeEvent(5, new Date("2026-08-17T18:00:00Z"));
    const result = filterTonight([eventYesterday], now2200Madrid);
    expect(result).toEqual([]);
  });

  it("mezcla de varios eventos: solo se quedan los de la noche operativa real (hoy 22h + madrugada de mañana), no los de otras noches", () => {
    const tonight = makeEvent(10, new Date("2026-08-18T20:00:00Z")); // 22:00 Madrid, misma noche
    const earlyMorning = makeEvent(11, new Date("2026-08-18T22:30:00Z")); // 00:30 Madrid del día siguiente, misma noche operativa
    const tomorrowNight = makeEvent(12, new Date("2026-08-19T20:00:00Z")); // 22:00 Madrid del día siguiente, OTRA noche
    const yesterday = makeEvent(13, new Date("2026-08-17T18:00:00Z")); // ya pasado
    const result = filterTonight([tonight, earlyMorning, tomorrowNight, yesterday], now2200Madrid);
    expect(result.map(e => e.id).sort()).toEqual([10, 11]);
  });
});
