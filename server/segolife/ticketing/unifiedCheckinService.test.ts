import { describe, it, expect } from "vitest";
import { isEventCurrentlyOpen, pickCurrentEvent } from "./unifiedCheckinService";

type TestEvent = { id: number; startsAt: Date; endsAt: Date | null };

function ev(id: number, startsAt: string, endsAt: string | null): TestEvent {
  return { id, startsAt: new Date(startsAt), endsAt: endsAt ? new Date(endsAt) : null };
}

describe("isEventCurrentlyOpen — spec §21/§30/§34 invariante 9 (nightlife crossing midnight)", () => {
  it("un evento 23:30->05:00 sigue abierto justo antes de medianoche", () => {
    const event = ev(1, "2026-08-15T23:30:00+02:00", "2026-08-16T05:00:00+02:00");
    expect(isEventCurrentlyOpen(event, new Date("2026-08-15T23:45:00+02:00"))).toBe(true);
  });

  it("el MISMO evento sigue abierto justo después de medianoche — no se parte en dos por el cambio de día de calendario", () => {
    const event = ev(1, "2026-08-15T23:30:00+02:00", "2026-08-16T05:00:00+02:00");
    expect(isEventCurrentlyOpen(event, new Date("2026-08-16T00:15:00+02:00"))).toBe(true);
  });

  it("sigue abierto cerca del final (04:45), cerrado ya pasado endsAt (05:30)", () => {
    const event = ev(1, "2026-08-15T23:30:00+02:00", "2026-08-16T05:00:00+02:00");
    expect(isEventCurrentlyOpen(event, new Date("2026-08-16T04:45:00+02:00"))).toBe(true);
    expect(isEventCurrentlyOpen(event, new Date("2026-08-16T05:30:00+02:00"))).toBe(false);
  });

  it("puerta abierta 90 min antes del inicio (margen de llegada temprana)", () => {
    const event = ev(1, "2026-08-15T23:30:00+02:00", "2026-08-16T05:00:00+02:00");
    expect(isEventCurrentlyOpen(event, new Date("2026-08-15T22:15:00+02:00"))).toBe(true); // 75 min antes
    expect(isEventCurrentlyOpen(event, new Date("2026-08-15T21:30:00+02:00"))).toBe(false); // 120 min antes, fuera de margen
  });

  it("evento sin endsAt: se considera en curso 8h desde el inicio (ventana por defecto)", () => {
    const event = ev(1, "2026-08-15T23:30:00+02:00", null);
    expect(isEventCurrentlyOpen(event, new Date("2026-08-16T06:00:00+02:00"))).toBe(true);  // +6.5h
    expect(isEventCurrentlyOpen(event, new Date("2026-08-16T08:30:00+02:00"))).toBe(false); // +9h, fuera
  });

  it("evento de otro día ya no está en curso", () => {
    const event = ev(1, "2026-08-10T23:30:00+02:00", "2026-08-11T05:00:00+02:00");
    expect(isEventCurrentlyOpen(event, new Date("2026-08-15T23:45:00+02:00"))).toBe(false);
  });
});

describe("pickCurrentEvent — spec §10 (nunca adivinar si es ambiguo)", () => {
  it("0 eventos vigentes -> status none", () => {
    const result = pickCurrentEvent<TestEvent>([], new Date("2026-08-15T23:45:00+02:00"));
    expect(result.status).toBe("none");
  });

  it("exactamente 1 evento vigente -> resuelto sin ambigüedad", () => {
    const wrongDay = ev(1, "2026-08-10T23:30:00+02:00", "2026-08-11T05:00:00+02:00");
    const tonight = ev(2, "2026-08-15T23:30:00+02:00", "2026-08-16T05:00:00+02:00");
    const result = pickCurrentEvent([wrongDay, tonight], new Date("2026-08-15T23:45:00+02:00"));
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.event.id).toBe(2);
  });

  it("2+ eventos vigentes a la vez en el mismo venue -> ambiguous, NUNCA elige uno a ciegas", () => {
    const eventA = ev(1, "2026-08-15T23:00:00+02:00", "2026-08-16T02:00:00+02:00");
    const eventB = ev(2, "2026-08-15T23:30:00+02:00", "2026-08-16T05:00:00+02:00");
    const result = pickCurrentEvent([eventA, eventB], new Date("2026-08-15T23:45:00+02:00"));
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") expect(result.candidates.map(e => e.id).sort()).toEqual([1, 2]);
  });
});
