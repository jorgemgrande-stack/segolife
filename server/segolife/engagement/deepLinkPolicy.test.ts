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

  // Fase 16 — /nueva-contrasena es una ruta global (sin prefijo de
  // comunidad), a diferencia de todo lo demás en la whitelist. El token
  // real va en la query, que sanitizeDeepLink conserva sin validarla contra
  // el patrón (solo el path se compara).
  it("acepta /nueva-contrasena (reset de contraseña) con su token en la query", () => {
    expect(sanitizeDeepLink("/nueva-contrasena?token=abc123")).toBe("/nueva-contrasena?token=abc123");
  });

  it("rechaza una URL absoluta a /nueva-contrasena — nunca basta con que el path final coincida", () => {
    expect(sanitizeDeepLink("https://www.segolife.es/nueva-contrasena?token=abc123")).toBeNull();
  });

  // FIX-05 — ficha de evento Admin (fourvenuesPublicationNotifier.ts). Patrón
  // estrecho a propósito: solo /admin/events/:id, nunca un comodín /admin/.*.
  it("acepta /admin/events/:id (FIX-05, notificación de publicación Fourvenues)", () => {
    expect(sanitizeDeepLink("/admin/events/42")).toBe("/admin/events/42");
  });

  it("sigue rechazando rutas admin no relacionadas — el patrón nuevo NO es un comodín /admin/.*", () => {
    expect(sanitizeDeepLink("/admin/users/1")).toBeNull();
    expect(sanitizeDeepLink("/ie/admin/secret")).toBeNull(); // el caso ya cubierto arriba sigue rechazado
  });

  // Community Proposals (backlog) — cola de moderación (communityProposalNotifier.ts).
  it("acepta /admin/comunity/moderacion (alerta admin de idea nueva de Student)", () => {
    expect(sanitizeDeepLink("/admin/comunity/moderacion")).toBe("/admin/comunity/moderacion");
  });

  it("literal exacta — nunca un comodín /admin/comunity/.*", () => {
    expect(sanitizeDeepLink("/admin/comunity/otro-panel")).toBeNull();
  });

  // FINAL ZERO-DEBT (Block I) — el patrón de detalle de propuesta de
  // Student (/:community/comunity/:id) interpretaba "admin" como si fuera
  // un slug de comunidad real, colando /admin/comunity/<numérico> por una
  // vía nunca destinada a un Student. No era una puerta de autorización
  // real (esa ruta admin sigue con su propio RBAC aparte), pero sí una
  // imprecisión real de la whitelist — regresión explícita.
  it("NUNCA cuela /admin/comunity/<id numérico> por el patrón de detalle de Student", () => {
    expect(sanitizeDeepLink("/admin/comunity/5")).toBeNull();
    expect(sanitizeDeepLink("/admin/comunity/999")).toBeNull();
  });

  it("una comunidad real cuyo slug EMPIEZA por 'admin' (nunca 'admin' exacto) sigue aceptándose — la exclusión es de la palabra completa, no un prefijo", () => {
    expect(sanitizeDeepLink("/administracion/comunity/5")).toBe("/administracion/comunity/5");
  });

  it("el hub de Student /admin/comunity (sin id) también queda excluido por el mismo motivo", () => {
    expect(sanitizeDeepLink("/admin/comunity")).toBeNull();
  });
});
