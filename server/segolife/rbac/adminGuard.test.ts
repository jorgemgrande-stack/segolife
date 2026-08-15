import { describe, it, expect } from "vitest";
import { wouldRemoveLastAdmin } from "./adminGuard";

describe("wouldRemoveLastAdmin — spec §33/§34 (BLOCKER real: sin guardia server-side antes de este fix)", () => {
  it("bloquea degradar al único admin activo (test #13 spec §51)", () => {
    expect(wouldRemoveLastAdmin("venue_admin", { role: "admin", isActive: true }, 1)).toBe(true);
  });

  it("permite degradar a admin si hay al menos otro admin activo", () => {
    expect(wouldRemoveLastAdmin("venue_admin", { role: "admin", isActive: true }, 2)).toBe(false);
  });

  it("nunca bloquea si el nuevo rol sigue siendo admin", () => {
    expect(wouldRemoveLastAdmin("admin", { role: "admin", isActive: true }, 1)).toBe(false);
  });

  it("no bloquea si el objetivo no es admin (p. ej. venue_admin -> venue_admin no aplica, o user)", () => {
    expect(wouldRemoveLastAdmin("admin", { role: "venue_admin", isActive: true }, 1)).toBe(false);
  });

  it("no bloquea si el admin objetivo ya está desactivado (no cuenta como el admin activo restante)", () => {
    expect(wouldRemoveLastAdmin("venue_admin", { role: "admin", isActive: false }, 1)).toBe(false);
  });

  it("no lanza con target undefined (usuario inexistente) — trata como no bloqueante", () => {
    expect(wouldRemoveLastAdmin("venue_admin", undefined, 1)).toBe(false);
  });
});
