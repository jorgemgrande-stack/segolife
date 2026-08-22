/**
 * communityLifecycleScheduler.test.ts — F65 (Community: ciclo de vida
 * automático). GATE real: tick() con un reloj controlado (fechas fijas
 * inyectadas via los mocks, nunca Date.now() real) — verifica que activa
 * las "scheduled" debidas y cierra las "active" caducadas llamando
 * EXACTAMENTE a las mismas funciones que ya usan las mutations manuales
 * (activateScheduledProposal / setProposalStatus), nunca reimplementando
 * la lógica de activación/cierre aquí.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommunityProposal } from "../../../drizzle/schema";

const { mockListDueScheduledProposals, mockListExpiredActiveProposals, mockSetProposalStatus, mockActivateScheduledProposal } = vi.hoisted(() => ({
  mockListDueScheduledProposals: vi.fn(),
  mockListExpiredActiveProposals: vi.fn(),
  mockSetProposalStatus: vi.fn(),
  mockActivateScheduledProposal: vi.fn(),
}));

vi.mock("./communityDb", () => ({
  listDueScheduledProposals: mockListDueScheduledProposals,
  listExpiredActiveProposals: mockListExpiredActiveProposals,
  setProposalStatus: mockSetProposalStatus,
}));
vi.mock("./communityAudienceService", () => ({ activateScheduledProposal: mockActivateScheduledProposal }));

import { tick } from "./communityLifecycleScheduler";

function proposal(overrides: Partial<CommunityProposal> = {}): CommunityProposal {
  return {
    id: 1, title: "t", description: null, questionType: "yes_no", status: "scheduled",
    urgencyType: "scheduled", startsAt: null, endsAt: null, resultsVisibility: "after_vote",
    allowChangeResponse: true, tokenReward: null, coverImageUrl: null, venueId: null,
    relatedEventId: null, convertedEventId: null, sourceStudentProposalId: null,
    audienceDefinition: null, audienceSnapshotAt: null, minSampleSize: 5,
    createdByUserId: 1, publishedAt: null, closedAt: null, cancelledAt: null,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  } as CommunityProposal;
}

beforeEach(() => {
  mockListDueScheduledProposals.mockReset().mockResolvedValue([]);
  mockListExpiredActiveProposals.mockReset().mockResolvedValue([]);
  mockSetProposalStatus.mockReset().mockResolvedValue(null);
  mockActivateScheduledProposal.mockReset().mockResolvedValue(undefined);
});

describe("communityLifecycleScheduler — tick()", () => {
  it("activa cada 'scheduled' debida llamando a activateScheduledProposal (nunca reimplementa la activación aquí)", async () => {
    mockListDueScheduledProposals.mockResolvedValue([proposal({ id: 10 }), proposal({ id: 11 })]);

    await tick();

    expect(mockActivateScheduledProposal).toHaveBeenCalledTimes(2);
    expect(mockActivateScheduledProposal).toHaveBeenCalledWith(10);
    expect(mockActivateScheduledProposal).toHaveBeenCalledWith(11);
  });

  it("cierra cada 'active' caducada con setProposalStatus(id, 'closed', {closedAt}) — mismo criterio exacto que closeNow manual", async () => {
    mockListExpiredActiveProposals.mockResolvedValue([proposal({ id: 20, status: "active" })]);

    await tick();

    expect(mockSetProposalStatus).toHaveBeenCalledTimes(1);
    const [id, status, extra] = mockSetProposalStatus.mock.calls[0];
    expect(id).toBe(20);
    expect(status).toBe("closed");
    expect(extra.closedAt).toBeInstanceOf(Date);
  });

  it("nada debido/caducado → no llama a ninguna de las dos funciones", async () => {
    await tick();
    expect(mockActivateScheduledProposal).not.toHaveBeenCalled();
    expect(mockSetProposalStatus).not.toHaveBeenCalled();
  });

  it("un fallo al activar UNA propuesta no impide activar/cerrar el resto (resiliente, un tick no se aborta por una fila problemática)", async () => {
    mockListDueScheduledProposals.mockResolvedValue([proposal({ id: 10 }), proposal({ id: 11 })]);
    mockListExpiredActiveProposals.mockResolvedValue([proposal({ id: 20, status: "active" })]);
    mockActivateScheduledProposal.mockImplementation(async (id: number) => {
      if (id === 10) throw new Error("fallo simulado");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(tick()).resolves.toBeUndefined();

    expect(mockActivateScheduledProposal).toHaveBeenCalledWith(11); // la 11 se procesó igual, pese al fallo de la 10
    expect(mockSetProposalStatus).toHaveBeenCalledWith(20, "closed", expect.objectContaining({ closedAt: expect.any(Date) }));
    errorSpy.mockRestore();
  });

  it("un fallo al cerrar una 'active' caducada no impide cerrar el resto", async () => {
    mockListExpiredActiveProposals.mockResolvedValue([proposal({ id: 20, status: "active" }), proposal({ id: 21, status: "active" })]);
    mockSetProposalStatus.mockImplementation(async (id: number) => {
      if (id === 20) throw new Error("fallo simulado");
      return null;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(tick()).resolves.toBeUndefined();

    expect(mockSetProposalStatus).toHaveBeenCalledWith(21, "closed", expect.objectContaining({ closedAt: expect.any(Date) }));
    errorSpy.mockRestore();
  });
});
