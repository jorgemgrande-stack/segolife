/**
 * AudienceFilterBuilder.test.ts — F66 (Communication Center). Cubre solo
 * `toAudienceDefinition()` (lógica pura de mapeo form→AudienceDefinition,
 * sin renderizar el componente) — venueActivity/eventAttended son los dos
 * filtros nuevos añadidos en F66 (ya existían en audienceEngine.ts, no se
 * exponían en este constructor).
 */
import { describe, it, expect } from "vitest";
import { toAudienceDefinition, EMPTY_AUDIENCE_FORM, type AudienceDefinitionForm } from "./AudienceFilterBuilder";

function form(overrides: Partial<AudienceDefinitionForm> = {}): AudienceDefinitionForm {
  return { ...EMPTY_AUDIENCE_FORM, ...overrides };
}

describe("toAudienceDefinition — venueActivity/eventAttended (F66)", () => {
  it("sin venueId, venueActivityKind se ignora aunque venga rellenado (nunca un filtro huérfano sin venue)", () => {
    const def = toAudienceDefinition(form({ venueId: "", venueActivityKind: "visited" }));
    expect(def.venueActivity).toBeUndefined();
  });

  it("con venueId y venueActivityKind, produce el filtro completo", () => {
    const def = toAudienceDefinition(form({ venueId: "7", venueActivityKind: "benefit_redeemed" }));
    expect(def.venueActivity).toEqual({ venueId: 7, kind: "benefit_redeemed" });
  });

  it("eventId vacío → sin filtro eventAttended", () => {
    const def = toAudienceDefinition(form({ eventId: "" }));
    expect(def.eventAttended).toBeUndefined();
  });

  it("eventId relleno → eventAttended con el id numérico", () => {
    const def = toAudienceDefinition(form({ eventId: "42" }));
    expect(def.eventAttended).toEqual({ eventId: 42 });
  });

  it("EMPTY_AUDIENCE_FORM nunca produce ningún filtro (sin filtros = sin audiencia)", () => {
    const def = toAudienceDefinition(EMPTY_AUDIENCE_FORM);
    expect(Object.values(def).every(v => v === undefined)).toBe(true);
  });
});
