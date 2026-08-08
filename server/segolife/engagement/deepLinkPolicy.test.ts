/**
 * deepLinkPolicy.test.ts — whitelist de rutas internas (spec puntos 15, 58).
 * Nunca lanza; una URL inválida simplemente se descarta (null), nunca
 * bloquea la creación de la notificación.
 */
import { describe, it, expect } from "vitest";
import { sanitizeDeepLink } from "./deepLinkPolicy";

describe("deepLinkPolicy — sanitizeDeepLink", () => {
  it("acepta rutas internas conocidas", () => {
    expect(sanitizeDeepLink("/ie")).toBe("/ie");
    expect(sanitizeDeepLink("/ie/explore")).toBe("/ie/explore");
    expect(sanitizeDeepLink("/uva/benefits/42")).toBe("/uva/benefits/42");
    expect(sanitizeDeepLink("/ie/notifications")).toBe("/ie/notifications");
    expect(sanitizeDeepLink("/ie/events/casanova-night")).toBe("/ie/events/casanova-night");
  });

  it("rechaza null/undefined/vacío sin lanzar", () => {
    expect(sanitizeDeepLink(null)).toBeNull();
    expect(sanitizeDeepLink(undefined)).toBeNull();
    expect(sanitizeDeepLink("")).toBeNull();
  });

  it("rechaza URLs externas absolutas", () => {
    expect(sanitizeDeepLink("https://evil.example/phish")).toBeNull();
    expect(sanitizeDeepLink("http://nayadeexperiences.es")).toBeNull();
  });

  it("rechaza esquemas javascript: y similares", () => {
    expect(sanitizeDeepLink("javascript:alert(1)")).toBeNull();
  });

  it("rechaza URLs protocol-relative (//host) — intento de escapar del propio origen", () => {
    expect(sanitizeDeepLink("//evil.example/phish")).toBeNull();
  });

  it("rechaza una ruta interna no reconocida (no está en la whitelist)", () => {
    expect(sanitizeDeepLink("/ie/admin/secret")).toBeNull();
    expect(sanitizeDeepLink("/ie/benefits/not-a-number")).toBeNull();
  });

  it("ignora query string y hash al validar el patrón, pero conserva la URL original", () => {
    expect(sanitizeDeepLink("/ie/explore?tab=events")).toBe("/ie/explore?tab=events");
    expect(sanitizeDeepLink("/ie/explore#top")).toBe("/ie/explore#top");
  });
});
