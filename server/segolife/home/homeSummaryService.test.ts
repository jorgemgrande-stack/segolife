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
import { filterTonight } from "./homeSummaryService";
import type { EventListItem } from "../../db/eventsDb";

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
