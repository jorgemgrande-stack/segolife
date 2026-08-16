/**
 * home.test.ts — Fase 15 (spec §11/§13): "community attribution must
 * survive the funnel", "define deterministic behavior for... multiple
 * communities". Auditoría de esta fase confirmó que getSummary SIEMPRE
 * resolvía la comunidad como memberships[0] (sin ORDER BY, orden arbitrario
 * de MySQL) — un Student con IE+UVA veía en su Home una comunidad distinta
 * a la que el resto de la página ya filtraba por la URL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUserCommunities, mockGetHomeSummary } = vi.hoisted(() => ({
  mockGetUserCommunities: vi.fn(),
  mockGetHomeSummary: vi.fn(),
}));
vi.mock("../db/communitiesDb", () => ({ getUserCommunities: mockGetUserCommunities }));
vi.mock("../segolife/home/homeSummaryService", () => ({ getHomeSummary: mockGetHomeSummary }));

import { homeRouter } from "./home";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function studentCaller() {
  return homeRouter.createCaller({ user: { id: 7, role: "user" } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetHomeSummary.mockResolvedValue({ ranking: { forYou: [] } });
});

describe("home.getSummary — resolución de comunidad (Fase 15, spec §11/§13)", () => {
  it("con communityId real (el Student SÍ es miembro) -> usa esa comunidad, no la primera membresía", async () => {
    mockGetUserCommunities.mockResolvedValue([{ communityId: 1 }, { communityId: 2 }]);
    await studentCaller().getSummary({ communityId: 2 });
    expect(mockGetHomeSummary).toHaveBeenCalledWith(7, 2);
  });

  it("communityId pedido pero el Student NO es miembro real -> nunca se confía a ciegas, cae a la primera membresía real", async () => {
    mockGetUserCommunities.mockResolvedValue([{ communityId: 1 }]);
    await studentCaller().getSummary({ communityId: 999 });
    expect(mockGetHomeSummary).toHaveBeenCalledWith(7, 1);
  });

  it("sin communityId en el input -> comportamiento previo intacto (primera membresía)", async () => {
    mockGetUserCommunities.mockResolvedValue([{ communityId: 5 }]);
    await studentCaller().getSummary(undefined);
    expect(mockGetHomeSummary).toHaveBeenCalledWith(7, 5);
  });

  it("sin ninguna membresía -> communityId undefined, nunca lanza", async () => {
    mockGetUserCommunities.mockResolvedValue([]);
    await studentCaller().getSummary({ communityId: 1 });
    expect(mockGetHomeSummary).toHaveBeenCalledWith(7, undefined);
  });

  it("input completamente ausente (llamada sin argumentos) -> sigue funcionando", async () => {
    mockGetUserCommunities.mockResolvedValue([{ communityId: 3 }]);
    // @ts-expect-error — simula una llamada legacy sin input en absoluto
    await studentCaller().getSummary();
    expect(mockGetHomeSummary).toHaveBeenCalledWith(7, 3);
  });
});
