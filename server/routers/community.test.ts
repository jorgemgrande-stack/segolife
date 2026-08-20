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
} = vi.hoisted(() => ({
  mockGetUserCommunities: vi.fn(),
  mockSubmitStudentProposal: vi.fn(),
  mockNotifyStudentProposalSubmitted: vi.fn().mockResolvedValue(undefined),
  mockApproveStudentProposal: vi.fn(),
  mockRejectStudentProposal: vi.fn(),
  mockNotifyStudentProposalApproved: vi.fn().mockResolvedValue(undefined),
  mockNotifyStudentProposalRejected: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../db/communitiesDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/communitiesDb")>();
  return { ...actual, getUserCommunities: mockGetUserCommunities };
});
vi.mock("../segolife/community/communityStudentProposalDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/community/communityStudentProposalDb")>();
  return {
    ...actual,
    submitStudentProposal: mockSubmitStudentProposal,
    approveStudentProposal: mockApproveStudentProposal,
    rejectStudentProposal: mockRejectStudentProposal,
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
