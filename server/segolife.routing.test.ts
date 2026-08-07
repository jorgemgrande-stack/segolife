/**
 * segolife.routing.test.ts — resolución de comunidad a partir de la URL
 * (shared/segolife/routing.ts). La función es genérica (no conoce "ie"/"uva"
 * como literales en su lógica): estos tests usan esos slugs solo como DATOS
 * de prueba, igual que lo haría un seed — ver CLAUDE.md, regla arquitectónica
 * fundamental.
 */
import { describe, it, expect } from "vitest";
import { resolveCommunitySlug, isPotentialCommunityRequest } from "../shared/segolife/routing";

describe("resolveCommunitySlug — resolución por ruta", () => {
  it("resuelve /ie a la comunidad 'ie'", () => {
    expect(resolveCommunitySlug({ pathname: "/ie" })).toBe("ie");
  });

  it("resuelve /uva a la comunidad 'uva'", () => {
    expect(resolveCommunitySlug({ pathname: "/uva" })).toBe("uva");
  });

  it("resuelve /ie/algo (subrutas) igual que /ie", () => {
    expect(resolveCommunitySlug({ pathname: "/ie/eventos/1" })).toBe("ie");
  });

  it("la raíz '/' no resuelve ninguna comunidad", () => {
    expect(resolveCommunitySlug({ pathname: "/" })).toBeNull();
  });
});

describe("resolveCommunitySlug — páginas legacy NO disparan resolución (evita queries innecesarias)", () => {
  it("una ruta pública heredada de Náyade no resuelve ninguna comunidad", () => {
    expect(resolveCommunitySlug({ pathname: "/contacto" })).toBeNull();
    expect(resolveCommunitySlug({ pathname: "/hotel" })).toBeNull();
    expect(resolveCommunitySlug({ pathname: "/experiencias/paseo-en-barco" })).toBeNull();
  });

  it("isPotentialCommunityRequest es false para rutas legacy por ruta", () => {
    expect(isPotentialCommunityRequest({ pathname: "/contacto" })).toBe(false);
    expect(isPotentialCommunityRequest({ pathname: "/" })).toBe(false);
  });

  it("isPotentialCommunityRequest es true solo para los prefijos de comunidad registrados", () => {
    expect(isPotentialCommunityRequest({ pathname: "/ie" })).toBe(true);
    expect(isPotentialCommunityRequest({ pathname: "/uva/algo" })).toBe(true);
  });
});

describe("resolveCommunitySlug — preparado para subdominio (Paso 7, sin reescribir el sistema)", () => {
  it("un subdominio de comunidad tiene prioridad sobre la ruta", () => {
    expect(
      resolveCommunitySlug({ pathname: "/", hostname: "ie.segolife.es" })
    ).toBe("ie");
  });

  it("bajo subdominio de comunidad, CUALQUIER ruta se considera potencialmente de comunidad (todo el subdominio es su sitio)", () => {
    expect(isPotentialCommunityRequest({ pathname: "/", hostname: "ie.segolife.es" })).toBe(true);
    expect(isPotentialCommunityRequest({ pathname: "/una-ruta-cualquiera", hostname: "ie.segolife.es" })).toBe(true);
    expect(resolveCommunitySlug({ pathname: "/una-ruta-cualquiera", hostname: "ie.segolife.es" })).toBe("ie");
  });

  it("funciona igual para un tercer campus futuro sin cambiar la función (ej. 'uax')", () => {
    expect(
      resolveCommunitySlug({ pathname: "/", hostname: "uax.segolife.es" })
    ).toBe("uax");
  });

  it("el dominio raíz sin subdominio no resuelve por hostname, cae a la ruta", () => {
    expect(
      resolveCommunitySlug({ pathname: "/uva", hostname: "segolife.es" })
    ).toBe("uva");
  });

  it("'www' no se trata como comunidad", () => {
    expect(
      resolveCommunitySlug({ pathname: "/", hostname: "www.segolife.es" })
    ).toBeNull();
  });
});
