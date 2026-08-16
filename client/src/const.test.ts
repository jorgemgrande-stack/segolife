import { describe, it, expect } from "vitest";
import { getRegisterUrl } from "./const";

/**
 * const.test.ts — Fase 15 (remate público). getRegisterUrl() gana un
 * segundo parámetro (communitySlug) para que las nuevas landings públicas de
 * comunidad (/ie, /uva) puedan construir /register?community=<slug> — el
 * mecanismo de preselección que Register.tsx ya leía (spec punto 77) pero
 * que hasta ahora ningún sitio del código construía. La validación real de
 * la comunidad sigue ocurriendo siempre server-side en registerStudent();
 * esto es solo la URL.
 */
describe("getRegisterUrl", () => {
  it("sin argumentos -> /register, comportamiento previo intacto", () => {
    expect(getRegisterUrl()).toBe("/register");
  });

  it("con communitySlug -> /register?community=<slug>", () => {
    expect(getRegisterUrl("/", "ie")).toBe("/register?community=ie");
  });

  it("con returnPath Y communitySlug -> ambos presentes en la query string", () => {
    const url = getRegisterUrl("/ie/events/after-party", "ie");
    expect(url).toContain("returnTo=%2Fie%2Fevents%2Fafter-party");
    expect(url).toContain("community=ie");
  });

  it("communitySlug undefined -> nunca añade ?community= vacío", () => {
    expect(getRegisterUrl("/", undefined)).toBe("/register");
  });

  it("solo returnPath (sin comunidad) -> comportamiento previo intacto", () => {
    expect(getRegisterUrl("/ie")).toBe("/register?returnTo=%2Fie");
  });
});
