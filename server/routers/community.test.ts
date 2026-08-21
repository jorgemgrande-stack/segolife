/**
 * community.test.ts — mismo criterio que students360.test.ts: todas las
 * procedures exigen sesión (permissionProcedure/protectedProcedure), el
 * middleware rechaza antes de tocar BD — se puede probar sin conexión real.
 * Cubre spec punto 89 (RBAC) en su forma más barata y determinista: ningún
 * endpoint de COMUNITY es accesible sin sesión, ni de lectura ni de escritura.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Community Proposals backlog — IDOR real encontrado en la auditoría:
// submitProposal nunca comprobaba que `communityId` fuera una comunidad
// REAL del Student que llama. Se mockean sus dos únicas dependencias para
// probar la comprobación de membresía sin tocar BD — mismo criterio que
// el resto de este repo (aislar la unidad bajo test).
const {
  mockGetUserCommunities, mockSubmitStudentProposal, mockNotifyStudentProposalSubmitted,
  mockApproveStudentProposal, mockRejectStudentProposal,
  mockNotifyStudentProposalApproved, mockNotifyStudentProposalRejected,
  mockGetCommunityAccess, mockListTrendingStudentProposals,
  mockGetProposalById, mockIsInProposalAudience, mockComputeResultsVisible,
  mockGetUserResponse, mockGetProposalRespondents,
} = vi.hoisted(() => ({
  mockGetUserCommunities: vi.fn(),
  mockSubmitStudentProposal: vi.fn(),
  mockNotifyStudentProposalSubmitted: vi.fn().mockResolvedValue(undefined),
  mockApproveStudentProposal: vi.fn(),
  mockRejectStudentProposal: vi.fn(),
  mockNotifyStudentProposalApproved: vi.fn().mockResolvedValue(undefined),
  mockNotifyStudentProposalRejected: vi.fn().mockResolvedValue(undefined),
  mockGetCommunityAccess: vi.fn(),
  mockListTrendingStudentProposals: vi.fn(),
  mockGetProposalById: vi.fn(),
  mockIsInProposalAudience: vi.fn(),
  mockComputeResultsVisible: vi.fn(),
  mockGetUserResponse: vi.fn(),
  mockGetProposalRespondents: vi.fn(),
}));
vi.mock("../db/communitiesDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/communitiesDb")>();
  return { ...actual, getUserCommunities: mockGetUserCommunities };
});
vi.mock("../_core/communityAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_core/communityAccess")>();
  return { ...actual, getCommunityAccess: mockGetCommunityAccess };
});
vi.mock("../segolife/community/communityStudentProposalDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/community/communityStudentProposalDb")>();
  return {
    ...actual,
    submitStudentProposal: mockSubmitStudentProposal,
    approveStudentProposal: mockApproveStudentProposal,
    rejectStudentProposal: mockRejectStudentProposal,
    listTrendingStudentProposals: mockListTrendingStudentProposals,
  };
});
// Community Proposals (backlog, spec §15.B) / FINAL ZERO-DEBT Block D — se
// mockea para probar la DELEGACIÓN del router sin abrir el pool de BD real
// de este notificador (fire-and-forget, ver community.ts) — el notificador
// en sí ya está probado por su cuenta en communityProposalNotifier.test.ts.
vi.mock("../segolife/community/communityProposalNotifier", () => ({
  notifyStudentProposalSubmitted: mockNotifyStudentProposalSubmitted,
  notifyStudentProposalApproved: mockNotifyStudentProposalApproved,
  notifyStudentProposalRejected: mockNotifyStudentProposalRejected,
}));
// getPublicRespondents (avatar-stack de respondientes, petición del cliente
// 2026-08-22) — a diferencia de getPublicById/myActive (que resuelven su
// conexión con un import() dinámico dentro del propio resolver), este
// procedure usa exclusivamente las dependencias YA importadas estáticamente
// arriba en community.ts, así que sí se puede aislar de BD real mockeándolas.
vi.mock("../segolife/community/communityDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/community/communityDb")>();
  return { ...actual, getProposalById: mockGetProposalById, isInProposalAudience: mockIsInProposalAudience, computeResultsVisible: mockComputeResultsVisible };
});
vi.mock("../segolife/community/communityResponseService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/community/communityResponseService")>();
  return { ...actual, getUserResponse: mockGetUserResponse };
});
vi.mock("../segolife/community/communityResultsService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/community/communityResultsService")>();
  return { ...actual, getProposalRespondents: mockGetProposalRespondents };
});

import { communityRouter } from "./community";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return communityRouter.createCaller({ user: null } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(id: number) {
  return communityRouter.createCaller({ user: { id, role: "user" } } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAsAdmin(id: number) {
  return communityRouter.createCaller({ user: { id, role: "admin" } } as any);
}

describe("community router — ningún endpoint admin es accesible sin sesión", () => {
  it("list rechaza sin sesión", async () => {
    await expect(callerWithoutSession().list({ communityId: "all", limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });

  it("getById rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getById({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("getResults rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getResults({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("getRespondents rechaza sin sesión — drilldown de identidad nunca sin auth (spec punto 42/58)", async () => {
    await expect(callerWithoutSession().getRespondents({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("create rechaza sin sesión", async () => {
    await expect(callerWithoutSession().create({
      title: "t", questionType: "yes_no", urgencyType: "scheduled",
      resultsVisibility: "after_vote", allowChangeResponse: true, minSampleSize: 5, communityIds: [],
    })).rejects.toThrow(/please login/i);
  });

  it("publish rechaza sin sesión", async () => {
    await expect(callerWithoutSession().publish({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("convertToEvent rechaza sin sesión", async () => {
    await expect(callerWithoutSession().convertToEvent({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("duplicate rechaza sin sesión", async () => {
    await expect(callerWithoutSession().duplicate({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("setResponseValueVisibility (moderación de texto libre) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setResponseValueVisibility({ responseValueId: 1, isHidden: true })).rejects.toThrow(/please login/i);
  });

  it("listStudentProposals / approveStudentProposal / rejectStudentProposal rechazan sin sesión", async () => {
    await expect(callerWithoutSession().listStudentProposals({ communityId: "all", limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().approveStudentProposal({ id: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().rejectStudentProposal({ id: 1, reasonInternal: "motivo" })).rejects.toThrow(/please login/i);
  });
});

describe("community router — autoservicio del estudiante tampoco es público (protectedProcedure)", () => {
  it("myActive/myResponded/myProposals rechazan sin sesión", async () => {
    await expect(callerWithoutSession().myActive()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().myResponded()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().myProposals()).rejects.toThrow(/please login/i);
  });

  it("getPublicById rechaza sin sesión — nunca expone una pregunta ni sus resultados a un anónimo", async () => {
    await expect(callerWithoutSession().getPublicById({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("getPublicRespondents rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getPublicRespondents({ proposalId: 1 })).rejects.toThrow(/please login/i);
  });

  it("respond rechaza sin sesión", async () => {
    await expect(callerWithoutSession().respond({ proposalId: 1, payload: { questionType: "yes_no", value: "yes" } })).rejects.toThrow(/please login/i);
  });

  it("submitProposal (proponer un plan) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().submitProposal({ communityId: 1, title: "idea" })).rejects.toThrow(/please login/i);
  });

  it("support/unsupport/hasSupported rechazan sin sesión", async () => {
    await expect(callerWithoutSession().support({ studentProposalId: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().unsupport({ studentProposalId: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().hasSupported({ studentProposalId: 1 })).rejects.toThrow(/please login/i);
  });
});

describe("community router — submitProposal: la comunidad SIEMPRE se deriva de la membresía real (IDOR, backlog Community Proposals)", () => {
  beforeEach(() => {
    mockGetUserCommunities.mockReset();
    mockSubmitStudentProposal.mockReset();
    mockNotifyStudentProposalSubmitted.mockClear().mockResolvedValue(undefined);
  });

  it("REGRESIÓN IDOR — un Student de la comunidad 1 NUNCA puede proponer en la comunidad 2 aunque manipule communityId en el body", async () => {
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    await expect(
      callerAs(7).submitProposal({ communityId: 2, title: "Intento de propuesta ajena" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockSubmitStudentProposal).not.toHaveBeenCalled();
  });

  it("un Student SÍ puede proponer en una comunidad de la que es miembro real", async () => {
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    mockSubmitStudentProposal.mockResolvedValue({ id: 900, communityId: 1, title: "Padel el sábado", status: "pending_moderation" });
    const result = await callerAs(7).submitProposal({ communityId: 1, title: "Padel el sábado" });
    expect(result.success).toBe(true);
    expect(mockSubmitStudentProposal).toHaveBeenCalledWith(expect.objectContaining({ communityId: 1, studentUserId: 7 }));
  });

  it("un Student sin NINGUNA comunidad real (edge case) es rechazado, nunca se cuela por una lista vacía", async () => {
    mockGetUserCommunities.mockResolvedValue([]);
    await expect(
      callerAs(7).submitProposal({ communityId: 1, title: "idea" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un Student con membresía IE+UVA puede proponer en CUALQUIERA de sus dos comunidades reales", async () => {
    mockGetUserCommunities.mockResolvedValue([
      { id: 1, userId: 7, communityId: 1, createdAt: new Date() },
      { id: 2, userId: 7, communityId: 2, createdAt: new Date() },
    ]);
    mockSubmitStudentProposal.mockResolvedValue({ id: 901, communityId: 2, title: "x", status: "pending_moderation" });
    const result = await callerAs(7).submitProposal({ communityId: 2, title: "x" });
    expect(result.success).toBe(true);
  });

  it("spec §15.B — un envío válido dispara la alerta admin (best-effort, delega en el notificador dedicado)", async () => {
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    const idea = { id: 902, communityId: 1, title: "Karaoke night", status: "pending_moderation" };
    mockSubmitStudentProposal.mockResolvedValue(idea);
    await callerAs(7).submitProposal({ communityId: 1, title: "Karaoke night" });
    expect(mockNotifyStudentProposalSubmitted).toHaveBeenCalledWith(idea, null);
  });

  it("si el notificador falla, la idea SIGUE guardándose con éxito (best-effort, nunca bloquea)", async () => {
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    mockSubmitStudentProposal.mockResolvedValue({ id: 903, communityId: 1, title: "x", status: "pending_moderation" });
    mockNotifyStudentProposalSubmitted.mockRejectedValue(new Error("boom"));
    const result = await callerAs(7).submitProposal({ communityId: 1, title: "x" });
    expect(result.success).toBe(true);
  });
});

describe("community router — trending: un Student NUNCA ve ideas/nombres de otra comunidad (closure security sweep, hallazgo #7)", () => {
  beforeEach(() => {
    mockGetCommunityAccess.mockReset();
    mockGetUserCommunities.mockReset();
    mockListTrendingStudentProposals.mockReset().mockResolvedValue([{ id: 1 }]);
  });

  it("REGRESIÓN — un Student SIN communityId ya no recibe 'all' (antes filtraba nombres de otras comunidades)", async () => {
    mockGetCommunityAccess.mockResolvedValue([]); // no es admin global
    await expect(callerAs(7).trending({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockListTrendingStudentProposals).not.toHaveBeenCalled();
  });

  it("REGRESIÓN — un Student de la comunidad 1 no puede pedir trending de la comunidad 2", async () => {
    mockGetCommunityAccess.mockResolvedValue([]);
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    await expect(callerAs(7).trending({ communityId: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockListTrendingStudentProposals).not.toHaveBeenCalled();
  });

  it("un Student SÍ ve el trending de su propia comunidad real", async () => {
    mockGetCommunityAccess.mockResolvedValue([]);
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    const result = await callerAs(7).trending({ communityId: 1 });
    expect(result).toEqual([{ id: 1 }]);
    expect(mockListTrendingStudentProposals).toHaveBeenCalledWith([1]);
  });

  it("un admin global SÍ conserva el comportamiento previo: sin communityId ve el trending de TODAS las comunidades (ComunityManager.tsx)", async () => {
    mockGetCommunityAccess.mockResolvedValue("all");
    await callerAsAdmin(1).trending({});
    expect(mockListTrendingStudentProposals).toHaveBeenCalledWith("all");
    expect(mockGetUserCommunities).not.toHaveBeenCalled();
  });

  it("un admin global pidiendo una comunidad concreta la recibe filtrada, sin necesitar ser miembro", async () => {
    mockGetCommunityAccess.mockResolvedValue("all");
    await callerAsAdmin(1).trending({ communityId: 3 });
    expect(mockListTrendingStudentProposals).toHaveBeenCalledWith([3]);
  });
});

describe("community router — submitProposal MG-04: imagen de portada + urgencia (spec §11/§16)", () => {
  beforeEach(() => {
    mockGetUserCommunities.mockReset();
    mockSubmitStudentProposal.mockReset();
    mockNotifyStudentProposalSubmitted.mockClear().mockResolvedValue(undefined);
  });

  it("coverImageUrl y urgency llegan intactos a submitStudentProposal cuando el Student los rellena", async () => {
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    mockSubmitStudentProposal.mockResolvedValue({ id: 910, communityId: 1, title: "x", status: "pending_moderation" });
    await callerAs(7).submitProposal({
      communityId: 1, title: "Torneo de pádel",
      coverImageUrl: "https://cdn.example.com/community-proposals/7/abc.jpg",
      urgency: "urgent",
    });
    expect(mockSubmitStudentProposal).toHaveBeenCalledWith(expect.objectContaining({
      coverImageUrl: "https://cdn.example.com/community-proposals/7/abc.jpg",
      urgency: "urgent",
    }));
  });

  it("sin imagen ni urgencia, se envían como ausentes — nunca un valor inventado", async () => {
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    mockSubmitStudentProposal.mockResolvedValue({ id: 911, communityId: 1, title: "x", status: "pending_moderation" });
    await callerAs(7).submitProposal({ communityId: 1, title: "Torneo de pádel" });
    const callArg = mockSubmitStudentProposal.mock.calls[0][0];
    expect(callArg.coverImageUrl).toBeUndefined();
    expect(callArg.urgency).toBeUndefined();
  });

  it("rechaza una urgencia fuera del enum permitido (payload manipulado)", async () => {
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callerAs(7).submitProposal({ communityId: 1, title: "x", urgency: "asap" as any })
    ).rejects.toThrow();
    expect(mockSubmitStudentProposal).not.toHaveBeenCalled();
  });

  it("rechaza coverImageUrl que no es una URL válida (nunca un path de filesystem ni un string arbitrario)", async () => {
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    await expect(
      callerAs(7).submitProposal({ communityId: 1, title: "x", coverImageUrl: "/etc/passwd" })
    ).rejects.toThrow();
    expect(mockSubmitStudentProposal).not.toHaveBeenCalled();
  });

  it("REGRESIÓN IDOR — coverImageUrl/urgency en el payload nunca reabren la vía de manipular communityId (b8850c4 sigue vigente)", async () => {
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    await expect(
      callerAs(7).submitProposal({
        communityId: 2, title: "Intento con imagen/urgencia de por medio",
        coverImageUrl: "https://cdn.example.com/community-proposals/7/x.jpg",
        urgency: "urgent",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockSubmitStudentProposal).not.toHaveBeenCalled();
  });

  it("campos reservados de admin (status/approved/featured/etc.) en el body nunca llegan a submitStudentProposal — zod los descarta por no estar declarados", async () => {
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    mockSubmitStudentProposal.mockResolvedValue({ id: 912, communityId: 1, title: "x", status: "pending_moderation" });
    await callerAs(7).submitProposal({
      communityId: 1, title: "x",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ status: "approved", moderatedByUserId: 999, featured: true, segoTokens: 1000 } as any),
    });
    const callArg = mockSubmitStudentProposal.mock.calls[0][0];
    expect(callArg).not.toHaveProperty("status");
    expect(callArg).not.toHaveProperty("moderatedByUserId");
    expect(callArg).not.toHaveProperty("featured");
    expect(callArg).not.toHaveProperty("segoTokens");
  });
});

describe("community router — approveStudentProposal/rejectStudentProposal: notificación al Student (FINAL ZERO-DEBT, Block D)", () => {
  beforeEach(() => {
    mockApproveStudentProposal.mockReset();
    mockRejectStudentProposal.mockReset();
    mockNotifyStudentProposalApproved.mockClear().mockResolvedValue(undefined);
    mockNotifyStudentProposalRejected.mockClear().mockResolvedValue(undefined);
  });

  it("aprobar dispara notifyStudentProposalApproved con la propuesta real, fire-and-forget", async () => {
    const proposal = { id: 900, studentUserId: 7, communityId: 1, title: "Padel el sábado", status: "approved" };
    mockApproveStudentProposal.mockResolvedValue(proposal);
    await callerAsAdmin(1).approveStudentProposal({ id: 900 });
    expect(mockNotifyStudentProposalApproved).toHaveBeenCalledWith(proposal);
  });

  it("rechazar dispara notifyStudentProposalRejected con la propuesta real", async () => {
    const proposal = { id: 901, studentUserId: 7, communityId: 1, title: "x", status: "rejected", rejectionReasonStudent: "Ya hay uno programado" };
    mockRejectStudentProposal.mockResolvedValue(proposal);
    await callerAsAdmin(1).rejectStudentProposal({ id: 901, reasonInternal: "motivo interno cualquiera" });
    expect(mockNotifyStudentProposalRejected).toHaveBeenCalledWith(proposal);
  });

  it("si approveStudentProposal devuelve null (id inexistente), nunca se intenta notificar", async () => {
    mockApproveStudentProposal.mockResolvedValue(null);
    await callerAsAdmin(1).approveStudentProposal({ id: 999 });
    expect(mockNotifyStudentProposalApproved).not.toHaveBeenCalled();
  });

  it("si rejectStudentProposal devuelve null, nunca se intenta notificar", async () => {
    mockRejectStudentProposal.mockResolvedValue(null);
    await callerAsAdmin(1).rejectStudentProposal({ id: 999, reasonInternal: "motivo" });
    expect(mockNotifyStudentProposalRejected).not.toHaveBeenCalled();
  });

  it("si el notificador de aprobación falla, la aprobación SIGUE devolviendo éxito (best-effort, nunca bloquea)", async () => {
    const proposal = { id: 902, studentUserId: 7, communityId: 1, title: "x", status: "approved" };
    mockApproveStudentProposal.mockResolvedValue(proposal);
    mockNotifyStudentProposalApproved.mockRejectedValue(new Error("boom"));
    const result = await callerAsAdmin(1).approveStudentProposal({ id: 902 });
    expect(result.success).toBe(true);
  });

  it("si el notificador de rechazo falla, el rechazo SIGUE devolviendo éxito", async () => {
    const proposal = { id: 903, studentUserId: 7, communityId: 1, title: "x", status: "rejected" };
    mockRejectStudentProposal.mockResolvedValue(proposal);
    mockNotifyStudentProposalRejected.mockRejectedValue(new Error("boom"));
    const result = await callerAsAdmin(1).rejectStudentProposal({ id: 903, reasonInternal: "motivo" });
    expect(result.success).toBe(true);
  });
});

describe("getPublicRespondents — avatar-stack de respondientes (petición del cliente, 2026-08-22): nunca sin re-autorizar", () => {
  beforeEach(() => {
    mockGetProposalById.mockReset().mockResolvedValue({ id: 10, resultsVisibility: "immediate", status: "active" });
    mockIsInProposalAudience.mockReset().mockResolvedValue(true);
    mockGetUserResponse.mockReset().mockResolvedValue(null);
    mockComputeResultsVisible.mockReset().mockReturnValue(true);
    mockGetProposalRespondents.mockReset().mockResolvedValue({ total: 2, items: [{ userId: 4, name: "Ana", hasAvatar: true }] });
  });

  it("propuesta inexistente -> NOT_FOUND, nunca llega a comprobar audiencia", async () => {
    mockGetProposalById.mockResolvedValue(null);
    await expect(callerAs(42).getPublicRespondents({ proposalId: 999 })).rejects.toThrow(/no encontrada/i);
    expect(mockIsInProposalAudience).not.toHaveBeenCalled();
  });

  it("quien pregunta NO pertenece a la audiencia de la propuesta -> FORBIDDEN, nunca llega a resolver nombres", async () => {
    mockIsInProposalAudience.mockResolvedValue(false);
    await expect(callerAs(42).getPublicRespondents({ proposalId: 10 })).rejects.toThrow(/no tienes acceso/i);
    expect(mockGetProposalRespondents).not.toHaveBeenCalled();
  });

  it("en audiencia pero resultsVisibility todavía no visible (p.ej. after_vote sin haber respondido) -> FORBIDDEN", async () => {
    mockComputeResultsVisible.mockReturnValue(false);
    await expect(callerAs(42).getPublicRespondents({ proposalId: 10 })).rejects.toThrow(/todavía no son visibles/i);
    expect(mockGetProposalRespondents).not.toHaveBeenCalled();
  });

  it("en audiencia + resultados visibles -> delega en getProposalRespondents con paginación real", async () => {
    const result = await callerAs(42).getPublicRespondents({ proposalId: 10, limit: 5, offset: 0 });
    expect(result.total).toBe(2);
    expect(mockGetProposalRespondents).toHaveBeenCalledWith(10, { limit: 5, offset: 0 });
  });

  it("computeResultsVisible se llama con el mismo criterio que getPublicById (hasResponded real del usuario)", async () => {
    mockGetUserResponse.mockResolvedValue({ response: { id: 1 }, values: [] });
    await callerAs(42).getPublicRespondents({ proposalId: 10 });
    expect(mockComputeResultsVisible).toHaveBeenCalledWith(expect.objectContaining({ id: 10 }), true, expect.any(Date));
  });
});
