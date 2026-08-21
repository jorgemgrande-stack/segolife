/**
 * communityAudienceService.test.ts — publishProposal() (SEGOLIFE —
 * COMMUNITY Production Implementation): foco en la recompensa
 * COMMUNITY_PROPOSAL_APPROVED al autor original cuando una propuesta
 * convertida desde una idea de estudiante se activa de verdad. No
 * re-prueba resolveAudience/notificaciones (ya cubiertos en su propio
 * módulo) — REUSE FIRST, mockeados aquí.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommunityProposal, CommunityStudentProposal } from "../../../drizzle/schema";

const { mockGetProposalById, mockSetProposalStatus, mockResolveAudience, mockCreateNotification, mockGetStudentProposalById, mockEarnTokens } = vi.hoisted(() => ({
  mockGetProposalById: vi.fn(),
  mockSetProposalStatus: vi.fn(),
  mockResolveAudience: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockGetStudentProposalById: vi.fn(),
  mockEarnTokens: vi.fn(),
}));

vi.mock("./communityDb", () => ({
  getProposalById: mockGetProposalById,
  setProposalStatus: mockSetProposalStatus,
}));
vi.mock("../engagement/audienceEngine", () => ({ resolveAudience: mockResolveAudience }));
vi.mock("../engagement/notificationService", () => ({ createNotification: mockCreateNotification }));
vi.mock("../engagement/templates", () => ({ renderTemplate: () => ({ title: "x", body: "x" }) }));
vi.mock("./communityStudentProposalDb", () => ({ getStudentProposalById: mockGetStudentProposalById }));
vi.mock("../tokens/tokenEngine", () => ({ earnTokens: mockEarnTokens }));

import { publishProposal } from "./communityAudienceService";

function proposalFixture(overrides: Partial<CommunityProposal> = {}): CommunityProposal {
  return {
    id: 10, title: "Afterparty en Casanova", description: null, questionType: "me_apunto", status: "draft",
    urgencyType: "scheduled", startsAt: null, endsAt: new Date("2026-08-20T23:00:00.000Z"), resultsVisibility: "after_vote",
    allowChangeResponse: true, tokenReward: null, coverImageUrl: null, venueId: null,
    relatedEventId: null, convertedEventId: null, sourceStudentProposalId: null,
    audienceDefinition: { allStudents: true }, audienceSnapshotAt: null, minSampleSize: 5,
    createdByUserId: 1, publishedAt: null, closedAt: null, cancelledAt: null,
    createdAt: new Date("2026-08-14"), updatedAt: new Date("2026-08-14"),
    ...overrides,
  } as CommunityProposal;
}

function studentProposalFixture(overrides: Partial<CommunityStudentProposal> = {}): CommunityStudentProposal {
  return {
    id: 3, studentUserId: 77, communityId: 1, title: "Idea", description: null, venueId: 7,
    suggestedDate: null, category: null, status: "approved", rejectionReasonInternal: null,
    rejectionReasonStudent: null, moderatedByUserId: 2, moderatedAt: new Date("2026-08-14"),
    convertedProposalId: 10, createdAt: new Date("2026-08-14"), updatedAt: new Date("2026-08-14"),
    ...overrides,
  } as CommunityStudentProposal;
}

// Cubre las llamadas REALES restantes de publishProposal/notifyProposalPublished
// que no pasan por communityDb/audienceEngine/notificationService (mockeados
// arriba): snapshot de audiencia (delete+insert) y el JOIN interno de
// notifyProposalPublished para resolver el slug de comunidad de cada
// destinatario — aquí devuelto vacío a propósito (sin slug conocido → esa
// función simplemente omite la notificación de ese usuario, sin lanzar), ya
// que lo que se prueba en este archivo es la recompensa, no el contenido de
// la notificación (ya cubierto en su propio módulo).
const fakeDb = {
  delete: () => ({ where: () => Promise.resolve() }),
  insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
  select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve([]) }) }) }),
} as never;

beforeEach(() => {
  mockGetProposalById.mockReset();
  mockSetProposalStatus.mockReset();
  mockResolveAudience.mockReset().mockResolvedValue([42, 43]);
  mockCreateNotification.mockReset().mockResolvedValue(undefined);
  mockGetStudentProposalById.mockReset();
  mockEarnTokens.mockReset().mockResolvedValue({ ledger: { id: 1 }, wallet: {}, breakdown: {} });
});

describe("publishProposal — COMMUNITY_PROPOSAL_APPROVED (SEGOLIFE — COMMUNITY Production Implementation)", () => {
  it("propuesta SIN sourceStudentProposalId (creada directamente por admin) → nunca llama a earnTokens", async () => {
    mockGetProposalById.mockResolvedValue(proposalFixture({ sourceStudentProposalId: null }));
    await publishProposal(10, 1, fakeDb);
    expect(mockEarnTokens).not.toHaveBeenCalled();
  });

  it("propuesta CON sourceStudentProposalId que se activa YA → premia al autor original vía earnTokens, idempotente por sourceStudentProposalId", async () => {
    mockGetProposalById.mockResolvedValue(proposalFixture({ sourceStudentProposalId: 3, startsAt: null }));
    mockGetStudentProposalById.mockResolvedValue(studentProposalFixture({ id: 3, studentUserId: 77, venueId: 7 }));

    await publishProposal(10, 1, fakeDb);

    expect(mockEarnTokens).toHaveBeenCalledOnce();
    expect(mockEarnTokens.mock.calls[0][0]).toMatchObject({
      userId: 77, origin: "community_proposal_approved", venueId: 7, sourceId: 3,
      idempotencyKey: "community_proposal_approved:3",
    });
  });

  it("propuesta programada para el futuro (no se activa YA) → no premia todavía (no hay scheduler que la active más tarde)", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    mockGetProposalById.mockResolvedValue(proposalFixture({ sourceStudentProposalId: 3, startsAt: future }));

    await publishProposal(10, 1, fakeDb);

    expect(mockEarnTokens).not.toHaveBeenCalled();
  });

  it("fallo de earnTokens (p.ej. regla desactivada) NUNCA impide la publicación real", async () => {
    mockGetProposalById.mockResolvedValue(proposalFixture({ sourceStudentProposalId: 3 }));
    mockGetStudentProposalById.mockResolvedValue(studentProposalFixture());
    mockEarnTokens.mockRejectedValue(new Error("NO_RULE_FOUND"));

    await expect(publishProposal(10, 1, fakeDb)).resolves.toBeUndefined();
    expect(mockSetProposalStatus).toHaveBeenCalledWith(10, "active", expect.objectContaining({ publishedAt: expect.any(Date) }), fakeDb);
  });

  it("idea de estudiante inexistente (borrada/corrupta) → no lanza, simplemente no premia", async () => {
    mockGetProposalById.mockResolvedValue(proposalFixture({ sourceStudentProposalId: 999 }));
    mockGetStudentProposalById.mockResolvedValue(null);

    await expect(publishProposal(10, 1, fakeDb)).resolves.toBeUndefined();
    expect(mockEarnTokens).not.toHaveBeenCalled();
  });
});

describe("publishProposal — el autor de la idea original SIEMPRE queda en la audiencia (hallazgo real, 2026-08-22)", () => {
  /** Igual que fakeDb pero registra qué userIds se insertaron realmente en community_proposal_audiences. */
  function fakeDbTrackingInserts() {
    const insertedUserIds: number[] = [];
    return {
      delete: () => ({ where: () => Promise.resolve() }),
      insert: () => ({
        values: (v: { userId: number }) => { insertedUserIds.push(v.userId); return Promise.resolve([{ insertId: 1 }]); },
      }),
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve([]) }) }) }),
      __insertedUserIds: insertedUserIds,
    } as never;
  }

  it("el estudiante que propuso la idea queda en la audiencia aunque resolveAudience() no lo incluya (p.ej. no cumplía tokensBalanceMin en el momento de resolver, ANTES de recibir su propio reward)", async () => {
    mockGetProposalById.mockResolvedValue(proposalFixture({ sourceStudentProposalId: 3, audienceDefinition: { allStudents: true, tokensBalanceMin: 2 } }));
    mockGetStudentProposalById.mockResolvedValue(studentProposalFixture({ id: 3, studentUserId: 77 }));
    mockResolveAudience.mockResolvedValue([42, 43]); // 77 NO está aquí — no cumplía el umbral en ese instante

    const db = fakeDbTrackingInserts();
    await publishProposal(10, 1, db);

    expect((db as unknown as { __insertedUserIds: number[] }).__insertedUserIds).toEqual(expect.arrayContaining([42, 43, 77]));
  });

  it("sin sourceStudentProposalId, la audiencia insertada es exactamente la resuelta — no añade nada de más", async () => {
    mockGetProposalById.mockResolvedValue(proposalFixture({ sourceStudentProposalId: null }));
    mockResolveAudience.mockResolvedValue([42, 43]);

    const db = fakeDbTrackingInserts();
    await publishProposal(10, 1, db);

    expect((db as unknown as { __insertedUserIds: number[] }).__insertedUserIds.sort()).toEqual([42, 43]);
    expect(mockGetStudentProposalById).not.toHaveBeenCalled();
  });

  it("audiencia resuelta vacía + idea de estudiante real → publica igualmente (el autor por sí solo ya es audiencia válida), nunca EMPTY_AUDIENCE", async () => {
    mockGetProposalById.mockResolvedValue(proposalFixture({ sourceStudentProposalId: 3, audienceDefinition: { allStudents: true, tokensBalanceMin: 999999 } }));
    mockGetStudentProposalById.mockResolvedValue(studentProposalFixture({ id: 3, studentUserId: 77 }));
    mockResolveAudience.mockResolvedValue([]);

    const db = fakeDbTrackingInserts();
    await expect(publishProposal(10, 1, db)).resolves.toBeUndefined();
    expect((db as unknown as { __insertedUserIds: number[] }).__insertedUserIds).toEqual([77]);
  });
});
