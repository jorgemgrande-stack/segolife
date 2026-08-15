import { describe, it, expect } from "vitest";
import { venueAccessAllows } from "./venueStaffAccess";

describe("venueAccessAllows — spec §46 (IDOR CRITICAL: Venue Admin Casanova pide venueId=Tía Felisa)", () => {
  it("Venue Admin con acceso solo a Casanova (id=1): venueId=1 permitido", () => {
    expect(venueAccessAllows([1], 1)).toBe(true);
  });

  it("Venue Admin con acceso solo a Casanova (id=1): venueId=2 (Tía Felisa) DENEGADO", () => {
    expect(venueAccessAllows([1], 2)).toBe(false);
  });

  it("Venue Admin multi-venue (spec §5/§41): acceso a cualquiera de sus venues asignados", () => {
    expect(venueAccessAllows([1, 5], 1)).toBe(true);
    expect(venueAccessAllows([1, 5], 5)).toBe(true);
    expect(venueAccessAllows([1, 5], 9)).toBe(false);
  });

  it("sin ninguna fila venue_staff: denegado por defecto, nunca 'todos' por omisión (spec §14 doc)", () => {
    expect(venueAccessAllows([], 1)).toBe(false);
  });

  it("admin global ('all'): permitido para cualquier venueId", () => {
    expect(venueAccessAllows("all", 1)).toBe(true);
    expect(venueAccessAllows("all", 9999)).toBe(true);
  });
});
