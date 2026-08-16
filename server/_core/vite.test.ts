/**
 * vite.test.ts — Fase 15 (remate público, spec "title/description/OG/
 * canonical diferenciados para master/IE/UVA"). Antes SEO_ROUTES solo tenía
 * "/" definida: /ie y /uva (y cualquier otra ruta) heredaban el mismo meta
 * genérico. resolveRouteMeta ahora resuelve la comunidad real por el primer
 * segmento de la URL contra la tabla `communities` — nunca comparando un
 * slug literal ("ie"/"uva") en código, para que una tercera comunidad quede
 * diferenciada en SEO sin tocar este archivo (regla arquitectónica
 * fundamental, ver CLAUDE.md).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetCommunityBySlug } = vi.hoisted(() => ({ mockGetCommunityBySlug: vi.fn() }));
vi.mock("../db/communitiesDb", () => ({ getCommunityBySlug: mockGetCommunityBySlug }));

import { resolveRouteMeta, communityRouteMeta } from "./vite";

function community(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, slug: "ie", name: "Segolife IE", defaultLocale: "en",
    availableLocales: ["en", "es"], status: "active" as const,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("communityRouteMeta — construida SIEMPRE desde la fila real, nunca por slug hardcodeado", () => {
  it("defaultLocale 'en' -> título/descripción en inglés, con el nombre real de la comunidad", () => {
    const meta = communityRouteMeta(community({ name: "Segolife IE", defaultLocale: "en" }));
    expect(meta.title).toBe("Segolife IE — SEGOLIFE");
    expect(meta.description).toContain("Segolife IE");
    expect(meta.description).toMatch(/events|venues/i);
    expect(meta.h1).toBe("Segolife IE");
  });

  it("defaultLocale 'es' -> título/descripción en español, con el nombre real de la comunidad", () => {
    const meta = communityRouteMeta(community({ name: "Segolife UVA", defaultLocale: "es" }));
    expect(meta.title).toBe("Segolife UVA — SEGOLIFE");
    expect(meta.description).toContain("Segolife UVA");
    expect(meta.description).toMatch(/eventos|locales/i);
  });
});

describe("resolveRouteMeta — /", () => {
  it("la master home usa el meta neutro SEGOLIFE, nunca el de una comunidad", async () => {
    const { meta, canonical } = await resolveRouteMeta("/");
    expect(meta.title).toContain("SEGOLIFE");
    expect(canonical).toBe("https://www.segolife.es");
    expect(mockGetCommunityBySlug).not.toHaveBeenCalled();
  });
});

describe("resolveRouteMeta — comunidad real por el primer segmento de la URL", () => {
  it("/ie con comunidad activa real -> meta diferenciada de esa comunidad, canonical a la raíz de esa comunidad", async () => {
    mockGetCommunityBySlug.mockResolvedValue(community({ slug: "ie", name: "Segolife IE", defaultLocale: "en" }));
    const { meta, canonical } = await resolveRouteMeta("/ie");
    expect(mockGetCommunityBySlug).toHaveBeenCalledWith("ie");
    expect(meta.title).toBe("Segolife IE — SEGOLIFE");
    expect(canonical).toBe("https://www.segolife.es/ie");
  });

  it("/uva con comunidad activa real -> meta diferenciada distinta de /ie (nunca el mismo texto para las dos)", async () => {
    mockGetCommunityBySlug.mockResolvedValue(community({ slug: "uva", name: "Segolife UVA", defaultLocale: "es" }));
    const { meta, canonical } = await resolveRouteMeta("/uva");
    expect(meta.title).toBe("Segolife UVA — SEGOLIFE");
    expect(meta.title).not.toBe("Segolife IE — SEGOLIFE");
    expect(canonical).toBe("https://www.segolife.es/uva");
  });

  it("una ruta anidada de esa comunidad (/ie/events/x) resuelve el mismo meta de comunidad, canonical a la raíz (mismo patrón que el parent-match legacy)", async () => {
    mockGetCommunityBySlug.mockResolvedValue(community({ slug: "ie", name: "Segolife IE", defaultLocale: "en" }));
    const { meta, canonical } = await resolveRouteMeta("/ie/events/after-party");
    expect(meta.title).toBe("Segolife IE — SEGOLIFE");
    expect(canonical).toBe("https://www.segolife.es/ie");
  });

  it("comunidad NO activa (onboarding) -> nunca usa su meta, cae al genérico (no diferencia lo que aún no es público)", async () => {
    mockGetCommunityBySlug.mockResolvedValue(community({ slug: "nueva", status: "onboarding" }));
    const { meta } = await resolveRouteMeta("/nueva");
    expect(meta.title).not.toContain("Segolife");
    expect(meta.title).toContain("SEGOLIFE — Your student life");
  });

  it("primer segmento que no es ninguna comunidad real (/login, /register, /admin...) -> meta genérico de siempre, sin romper nada existente", async () => {
    mockGetCommunityBySlug.mockResolvedValue(null);
    const { meta, canonical } = await resolveRouteMeta("/login");
    expect(mockGetCommunityBySlug).toHaveBeenCalledWith("login");
    expect(meta.title).toContain("SEGOLIFE — Your student life");
    expect(canonical).toBe("https://www.segolife.es/login");
  });

  it("el lookup de comunidad falla (BD caída, etc.) -> nunca revienta la respuesta, cae al meta genérico", async () => {
    mockGetCommunityBySlug.mockRejectedValue(new Error("boom"));
    const { meta } = await resolveRouteMeta("/ie");
    expect(meta.title).toContain("SEGOLIFE — Your student life");
  });
});
