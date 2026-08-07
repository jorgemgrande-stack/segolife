/**
 * communityAccess.test.ts — scoping por comunidad (Fase 1C).
 * checkRbacOrLegacy se mockea (es infraestructura RBAC ya existente y
 * probada por su cuenta) para poder controlar el escenario "global admin"
 * vs "sin permiso global" de forma determinista.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCheckRbacOrLegacy } = vi.hoisted(() => ({
  mockCheckRbacOrLegacy: vi.fn(),
}));

vi.mock("./rbac", () => ({
  checkRbacOrLegacy: mockCheckRbacOrLegacy,
}));

import { getCommunityAccess, resolveCommunityFilter, COMMUNITY_ADMIN_ROLE } from "./communityAccess";

function makeMockDb(rows: Array<{ communityId: number }>) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = () => chain();
  builder.from = () => chain();
  builder.where = () => chain();
  builder.then = (resolve: (v: unknown) => void) => resolve(rows);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return builder as any;
}

describe("resolveCommunityFilter — lógica pura de autorización", () => {
  it("global admin ('all') + sin selección → sin filtro ('all')", () => {
    expect(resolveCommunityFilter("all", undefined)).toBe("all");
    expect(resolveCommunityFilter("all", "all")).toBe("all");
  });

  it("global admin ('all') + comunidad concreta → puede consultar cualquiera", () => {
    expect(resolveCommunityFilter("all", 7)).toEqual([7]);
  });

  it("community admin (scope [1,2]) + sin selección → su propio scope, NUNCA 'all' real", () => {
    expect(resolveCommunityFilter([1, 2], undefined)).toEqual([1, 2]);
    expect(resolveCommunityFilter([1, 2], "all")).toEqual([1, 2]);
  });

  it("community admin + comunidad autorizada → esa comunidad", () => {
    expect(resolveCommunityFilter([1, 2], 2)).toEqual([2]);
  });

  it("community admin no puede consultar una comunidad no autorizada (FORBIDDEN)", () => {
    expect(() => resolveCommunityFilter([1, 2], 99)).toThrow(/no tienes acceso/i);
  });

  it("scope vacío ([]) nunca ve nada, pida lo que pida", () => {
    expect(resolveCommunityFilter([], undefined)).toEqual([]);
    expect(() => resolveCommunityFilter([], 5)).toThrow();
  });
});

describe("getCommunityAccess — resolución global admin vs community admin vs usuario normal", () => {
  beforeEach(() => {
    mockCheckRbacOrLegacy.mockReset();
  });

  it("global admin (permiso settings.manage/rol legacy admin) → 'all'", async () => {
    mockCheckRbacOrLegacy.mockResolvedValue(true);
    const access = await getCommunityAccess(1, "admin", makeMockDb([]));
    expect(access).toBe("all");
  });

  it("usuario normal (sin permiso global, sin filas community_admin) → [] — no puede acceder al CRM admin", async () => {
    mockCheckRbacOrLegacy.mockResolvedValue(false);
    const access = await getCommunityAccess(42, "user", makeMockDb([]));
    expect(access).toEqual([]);
  });

  it(`community admin (filas user_communities con roleInCommunity='${COMMUNITY_ADMIN_ROLE}') → esas comunidades`, async () => {
    mockCheckRbacOrLegacy.mockResolvedValue(false);
    const access = await getCommunityAccess(7, "user", makeMockDb([{ communityId: 1 }, { communityId: 3 }]));
    expect(access).toEqual([1, 3]);
  });
});
