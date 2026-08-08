/**
 * routing.test.ts — resolución de comunidad a partir de la URL (Fase 6).
 * Pura, sin BD/DOM — confirma que el patrón `/:community/...` dinámico
 * introducido en App.tsx sigue resolviendo correctamente contra
 * SEGOLIFE_COMMUNITY_PATH_PREFIXES sin tener que tocar este archivo.
 */
import { describe, it, expect } from "vitest";
import { resolveCommunitySlug, isPotentialCommunityRequest, SEGOLIFE_COMMUNITY_PATH_PREFIXES } from "./routing";

describe("resolveCommunitySlug — por ruta", () => {
  it("resuelve el slug para la home de comunidad (/ie)", () => {
    expect(resolveCommunitySlug({ pathname: "/ie" })).toBe("ie");
  });

  it("resuelve el slug para cualquier sub-ruta nueva de Fase 6 (/ie/explore, /uva/rewards, /ie/events/fiesta-de-otono)", () => {
    expect(resolveCommunitySlug({ pathname: "/ie/explore" })).toBe("ie");
    expect(resolveCommunitySlug({ pathname: "/uva/rewards" })).toBe("uva");
    expect(resolveCommunitySlug({ pathname: "/ie/events/fiesta-de-otono" })).toBe("ie");
    expect(resolveCommunitySlug({ pathname: "/uva/venues/chin-chin" })).toBe("uva");
    expect(resolveCommunitySlug({ pathname: "/ie/benefits/42" })).toBe("ie");
  });

  it("una ruta legada de fases anteriores sigue resolviendo igual (compatibilidad, spec Fase 6 punto 49)", () => {
    expect(resolveCommunitySlug({ pathname: "/ie/scan" })).toBe("ie");
    expect(resolveCommunitySlug({ pathname: "/uva/profile" })).toBe("uva");
  });

  it("una ruta que NO coincide con ningún prefijo registrado no se considera candidata de comunidad", () => {
    expect(resolveCommunitySlug({ pathname: "/login" })).toBeNull();
    expect(resolveCommunitySlug({ pathname: "/admin/students" })).toBeNull();
    expect(resolveCommunitySlug({ pathname: "/experiencias/kayak" })).toBeNull();
  });

  it("la raíz ('/') no es candidata de comunidad", () => {
    expect(resolveCommunitySlug({ pathname: "/" })).toBeNull();
  });
});

describe("resolveCommunitySlug — por subdominio (inerte hoy, ya soportado)", () => {
  it("un subdominio de comunidad resuelve el slug independientemente de la ruta", () => {
    expect(resolveCommunitySlug({ pathname: "/cualquier-cosa", hostname: "ie.segolife.es" })).toBe("ie");
  });

  it("www no se trata como comunidad", () => {
    expect(resolveCommunitySlug({ pathname: "/", hostname: "www.segolife.es" })).toBeNull();
  });

  it("un hostname que no pertenece a los dominios base no resuelve nada por subdominio", () => {
    expect(resolveCommunitySlug({ pathname: "/otra-cosa", hostname: "example.com" })).toBeNull();
  });
});

describe("isPotentialCommunityRequest", () => {
  it("es true para cualquier prefijo registrado, false para el resto", () => {
    for (const prefix of SEGOLIFE_COMMUNITY_PATH_PREFIXES) {
      expect(isPotentialCommunityRequest({ pathname: prefix })).toBe(true);
      expect(isPotentialCommunityRequest({ pathname: `${prefix}/explore` })).toBe(true);
    }
    expect(isPotentialCommunityRequest({ pathname: "/no-existe" })).toBe(false);
  });
});
