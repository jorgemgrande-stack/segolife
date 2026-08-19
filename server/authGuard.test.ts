/**
 * authGuard.test.ts — FIX-05A. Bug real encontrado y corregido durante esta
 * fase: `events.publicEnded` (nuevo procedure de Ended Events) se declaró
 * `publicProcedure` en tRPC pero se olvidó en la lista blanca REAL de
 * anonymous-access de este archivo (PUBLIC_TRPC_ROUTES) — una capa de
 * seguridad de red SEPARADA de tRPC que este middleware aplica antes de
 * que la petición llegue siquiera al router. Confirmado en producción real
 * (curl anónimo → 401 "Please login") antes de corregirlo — el propio
 * Playwright de FIX-05A nunca lo habría detectado porque todos sus tests
 * inician sesión primero (loginViaUI).
 *
 * Primer test de este archivo — nunca tuvo cobertura antes. Se prueba
 * `isPublicRoute()` (pura, exportada solo para esto) en vez de montar
 * Express real — mismo criterio de aislamiento que el resto del proyecto.
 */
import { describe, it, expect } from "vitest";
import { isPublicRoute } from "./authGuard";

describe("isPublicRoute — Ended Events debe ser navegable sin sesión (FIX-05A)", () => {
  it("events.publicEnded es público — regresión del bug real (faltaba en la whitelist, causaba 401 anónimo en producción)", () => {
    expect(isPublicRoute(["events.publicEnded"])).toBe(true);
  });

  it("el resto de events.public* que ya funcionaban siguen siendo públicos (Explore/VenueDetail/EventDetail navegables sin sesión)", () => {
    expect(isPublicRoute(["events.publicActive"])).toBe(true);
    expect(isPublicRoute(["events.publicFeatured"])).toBe(true);
    expect(isPublicRoute(["events.publicByVenue"])).toBe(true);
    expect(isPublicRoute(["events.publicGetBySlug"])).toBe(true);
    expect(isPublicRoute(["events.publicUpcoming"])).toBe(true);
  });

  it("events.list (admin, escritura/lectura privilegiada) sigue exigiendo sesión — la whitelist no se volvió permisiva por accidente", () => {
    expect(isPublicRoute(["events.list"])).toBe(false);
    expect(isPublicRoute(["events.create"])).toBe(false);
    expect(isPublicRoute(["events.setActive"])).toBe(false);
  });

  it("una petición batch mezclando un procedure público y uno privado NUNCA se trata como pública (every, no some)", () => {
    expect(isPublicRoute(["events.publicEnded", "events.list"])).toBe(false);
  });

  it("una petición batch con TODOS los procedures públicos sí se trata como pública", () => {
    expect(isPublicRoute(["events.publicActive", "events.publicEnded"])).toBe(true);
  });
});
