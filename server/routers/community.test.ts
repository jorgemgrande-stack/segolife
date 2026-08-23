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
  mockIsProposalVisibleToUser, mockListProposalOptions, mockGetVenueName,
  mockGetLikeState, mockToggleLike, mockListComments, mockCreateComment, mockDeleteOwnComment, mockModerateComment,
  mockGetCommentCountsBatch, mockGetLikeCountsBatch, mockResolveProposalAuthor,
  mockNotifyProposalCommented, mockNotifyCommentReplied, mockGetProposalCommunityIds,
  mockRecordShare, mockGetShareCountsBatch, mockSubmitResponse,
  mockCreateProposal, mockGetStudentProposalById, mockMarkStudentProposalConverted,
  mockGetRespondedProposalIds, mockDbSelect, mockGetProposalResults,
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
  mockIsProposalVisibleToUser: vi.fn(),
  mockListProposalOptions: vi.fn(),
  mockGetVenueName: vi.fn(),
  mockGetLikeState: vi.fn(),
  mockToggleLike: vi.fn(),
  mockListComments: vi.fn(),
  mockCreateComment: vi.fn(),
  mockDeleteOwnComment: vi.fn(),
  mockModerateComment: vi.fn(),
  mockGetCommentCountsBatch: vi.fn(),
  mockGetLikeCountsBatch: vi.fn(),
  mockResolveProposalAuthor: vi.fn(),
  mockNotifyProposalCommented: vi.fn().mockResolvedValue(undefined),
  mockNotifyCommentReplied: vi.fn().mockResolvedValue(undefined),
  mockGetProposalCommunityIds: vi.fn(),
  mockRecordShare: vi.fn(),
  mockGetShareCountsBatch: vi.fn(),
  mockSubmitResponse: vi.fn(),
  mockCreateProposal: vi.fn(),
  mockGetStudentProposalById: vi.fn(),
  mockMarkStudentProposalConverted: vi.fn(),
  mockGetRespondedProposalIds: vi.fn(),
  mockDbSelect: vi.fn(),
  mockGetProposalResults: vi.fn(),
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
    getStudentProposalById: mockGetStudentProposalById,
    markStudentProposalConverted: mockMarkStudentProposalConverted,
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
  return {
    ...actual, getProposalById: mockGetProposalById, isInProposalAudience: mockIsInProposalAudience,
    computeResultsVisible: mockComputeResultsVisible, isProposalVisibleToUser: mockIsProposalVisibleToUser,
    getProposalCommunityIds: mockGetProposalCommunityIds,
    listProposalOptions: mockListProposalOptions, getVenueName: mockGetVenueName,
    createProposal: mockCreateProposal,
  };
});
vi.mock("../segolife/community/communityResponseService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/community/communityResponseService")>();
  return { ...actual, getUserResponse: mockGetUserResponse, submitResponse: mockSubmitResponse, getRespondedProposalIds: mockGetRespondedProposalIds };
});
// listResultsFeed (bug real corregido 2026-08-24) hace sus propias queries
// crudas vía `await import("../db")` — se mockea getDb() con un `select`
// configurable por test (mockDbSelect) para poder devolver la fila de
// audiencia y las propuestas candidatas sin abrir una conexión real.
vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return { ...actual, getDb: async () => ({ select: mockDbSelect }) };
});
vi.mock("../segolife/community/communityResultsService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/community/communityResultsService")>();
  return { ...actual, getProposalRespondents: mockGetProposalRespondents, getProposalResults: mockGetProposalResults };
});
// COM-02 — Community Social Results: mismo criterio que getPublicRespondents
// arriba — este router usa exclusivamente dependencias importadas
// estáticamente, así que se puede aislar de BD real mockeándolas.
vi.mock("../segolife/community/communitySocialDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/community/communitySocialDb")>();
  return {
    ...actual,
    getLikeState: mockGetLikeState, toggleLike: mockToggleLike, listComments: mockListComments,
    createComment: mockCreateComment, deleteOwnComment: mockDeleteOwnComment, moderateComment: mockModerateComment,
    getCommentCountsBatch: mockGetCommentCountsBatch, getLikeCountsBatch: mockGetLikeCountsBatch,
    resolveProposalAuthor: mockResolveProposalAuthor,
    recordShare: mockRecordShare, getShareCountsBatch: mockGetShareCountsBatch,
  };
});
vi.mock("../segolife/community/communityCommentNotifier", () => ({
  notifyProposalCommented: mockNotifyProposalCommented,
  notifyCommentReplied: mockNotifyCommentReplied,
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

  it("COM-02: toggleLike/listComments/createComment/deleteComment rechazan sin sesión", async () => {
    await expect(callerWithoutSession().toggleLike({ proposalId: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().listComments({ proposalId: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().createComment({ proposalId: 1, content: "hola" })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().deleteComment({ commentId: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().listResultsFeed()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().recordShare({ proposalId: 1, method: "copy_link" })).rejects.toThrow(/please login/i);
  });

  it("COM-02: moderateComment (admin) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().moderateComment({ commentId: 1 })).rejects.toThrow(/please login/i);
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

// Timing preciso (2026-08-23) — spec: día+hora reales del evento, nunca
// botones vagos. suggestedDate pasó de fecha-sin-hora (regex YYYY-MM-DD) a
// datetime completo; votingClosesAt es un campo nuevo.
describe("community router — submitProposal: timing preciso (suggestedDate con hora + votingClosesAt)", () => {
  beforeEach(() => {
    mockGetUserCommunities.mockReset();
    mockSubmitStudentProposal.mockReset();
    mockNotifyStudentProposalSubmitted.mockClear().mockResolvedValue(undefined);
  });

  it("suggestedDate (día+hora) y votingClosesAt llegan intactos a submitStudentProposal", async () => {
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    mockSubmitStudentProposal.mockResolvedValue({ id: 913, communityId: 1, title: "x", status: "pending_moderation" });
    await callerAs(7).submitProposal({
      communityId: 1, title: "Torneo de pádel",
      suggestedDate: "2027-03-20T19:30:00.000Z",
      votingClosesAt: "2027-03-15T10:00:00.000Z",
    });
    const callArg = mockSubmitStudentProposal.mock.calls[0][0];
    expect(callArg.suggestedDate).toEqual(new Date("2027-03-20T19:30:00.000Z"));
    expect(callArg.votingClosesAt).toEqual(new Date("2027-03-15T10:00:00.000Z"));
  });

  it("rechaza un suggestedDate que no es una fecha válida (payload manipulado)", async () => {
    mockGetUserCommunities.mockResolvedValue([{ id: 1, userId: 7, communityId: 1, createdAt: new Date() }]);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callerAs(7).submitProposal({ communityId: 1, title: "x", suggestedDate: "no-es-una-fecha" as any })
    ).rejects.toThrow();
    expect(mockSubmitStudentProposal).not.toHaveBeenCalled();
  });
});

// Bug real corregido (2026-08-23): antes de este cambio, convertir una idea
// aprobada en una propuesta formal NUNCA fijaba `endsAt` (la idea de origen
// no tenía ningún concepto de cierre) — la propuesta formal nacía sin
// deadline de votación, obligando al admin a rellenarlo a mano cada vez.
// Confirmado sin test previo (grep sin resultados antes de esta fase).
describe("community router — convertStudentProposalToFormal: traslada el timing preciso y la imagen de portada del Student a la propuesta formal", () => {
  beforeEach(() => {
    mockGetCommunityAccess.mockReset();
    mockGetStudentProposalById.mockReset();
    mockCreateProposal.mockReset();
    mockMarkStudentProposalConverted.mockReset().mockResolvedValue(undefined);
    mockGetCommunityAccess.mockResolvedValue("all");
  });

  it("traslada suggestedDate a startsAt y votingClosesAt a endsAt, y marca la propuesta como 'flash' cuando el Student propuso un cierre", async () => {
    const eventAt = new Date("2027-03-20T19:30:00.000Z");
    const closesAt = new Date("2027-03-15T10:00:00.000Z");
    mockGetStudentProposalById.mockResolvedValue({
      id: 42, communityId: 1, status: "approved", title: "Torneo de pádel", description: null, venueId: null,
      suggestedDate: eventAt, votingClosesAt: closesAt,
    });
    mockCreateProposal.mockResolvedValue({ id: 900, title: "Torneo de pádel", status: "draft" });

    await callerAsAdmin(1).convertStudentProposalToFormal({ studentProposalId: 42, questionType: "yes_no" });

    expect(mockCreateProposal).toHaveBeenCalledWith(expect.objectContaining({
      startsAt: eventAt,
      endsAt: closesAt,
      urgencyType: "flash",
      sourceStudentProposalId: 42,
    }));
    expect(mockMarkStudentProposalConverted).toHaveBeenCalledWith(42, 900);
  });

  // Bug real corregido (2026-08-24, caso "HILLS TUESDAY"): la conversión
  // creaba la propuesta formal SIN coverImageUrl aunque la idea de origen
  // tuviera una imagen real subida por el Student — la propuesta publicada
  // se quedaba con el placeholder por defecto en vez de la foto real.
  it("traslada coverImageUrl a la propuesta formal cuando el Student subió una imagen real", async () => {
    mockGetStudentProposalById.mockResolvedValue({
      id: 44, communityId: 1, status: "approved", title: "HILLS TUESDAY", description: "Bring your own booze", venueId: null,
      suggestedDate: null, votingClosesAt: null, coverImageUrl: "https://cdn.example.com/community-proposals/7/hills.jpg",
    });
    mockCreateProposal.mockResolvedValue({ id: 902, title: "HILLS TUESDAY", status: "draft" });

    await callerAsAdmin(1).convertStudentProposalToFormal({ studentProposalId: 44, questionType: "me_apunto" });

    expect(mockCreateProposal).toHaveBeenCalledWith(expect.objectContaining({
      coverImageUrl: "https://cdn.example.com/community-proposals/7/hills.jpg",
    }));
  });

  it("sin imagen en la idea de origen, coverImageUrl se pasa null — nunca undefined ni un placeholder inventado", async () => {
    mockGetStudentProposalById.mockResolvedValue({
      id: 45, communityId: 1, status: "approved", title: "Sin imagen", description: null, venueId: null,
      suggestedDate: null, votingClosesAt: null, coverImageUrl: null,
    });
    mockCreateProposal.mockResolvedValue({ id: 903, title: "Sin imagen", status: "draft" });

    await callerAsAdmin(1).convertStudentProposalToFormal({ studentProposalId: 45, questionType: "yes_no" });

    expect(mockCreateProposal).toHaveBeenCalledWith(expect.objectContaining({ coverImageUrl: null }));
  });

  it("sin votingClosesAt propuesto por el Student, la propuesta formal nace 'scheduled' (nunca 'flash' inventado) y endsAt queda null", async () => {
    mockGetStudentProposalById.mockResolvedValue({
      id: 43, communityId: 1, status: "approved", title: "Cine bajo las estrellas", description: null, venueId: null,
      suggestedDate: null, votingClosesAt: null,
    });
    mockCreateProposal.mockResolvedValue({ id: 901, title: "Cine bajo las estrellas", status: "draft" });

    await callerAsAdmin(1).convertStudentProposalToFormal({ studentProposalId: 43, questionType: "yes_no" });

    expect(mockCreateProposal).toHaveBeenCalledWith(expect.objectContaining({
      startsAt: null, endsAt: null, urgencyType: "scheduled",
    }));
  });

  it("una idea que no está aprobada nunca se convierte", async () => {
    mockGetStudentProposalById.mockResolvedValue({ id: 44, communityId: 1, status: "pending_moderation", title: "x" });
    await expect(
      callerAsAdmin(1).convertStudentProposalToFormal({ studentProposalId: 44, questionType: "yes_no" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockCreateProposal).not.toHaveBeenCalled();
  });
});

// Bug real corregido (2026-08-24, caso "HILLS TUESDAY"): listResultsFeed
// filtraba a status="closed" entre propuestas ya respondidas, ignorando
// resultsVisibility por completo — un admin que cambiaba la visibilidad a
// "immediate" a mitad de votación nunca se reflejaba en el feed de
// Resultados del Student. Helper: fake db mínima por-tabla (mismo patrón
// que otros archivos de este repo con `select().from(table).where()`).
function makeResultsFeedDb({ audienceRows, proposalRows }: { audienceRows: { proposalId: number }[]; proposalRows: unknown[] }) {
  mockDbSelect.mockReset();
  mockDbSelect.mockImplementation((cols?: object) => {
    const isAudienceQuery = !!cols && Object.keys(cols).length > 0;
    return { from: () => ({ where: async () => (isAudienceQuery ? audienceRows : proposalRows) }) };
  });
}

describe("community router — listResultsFeed: usa la audiencia real (nunca solo 'ya respondidas') y respeta resultsVisibility en vivo", () => {
  beforeEach(() => {
    mockGetRespondedProposalIds.mockReset();
    mockComputeResultsVisible.mockReset();
  });

  it("sin propuestas en mi audiencia, devuelve [] sin más queries", async () => {
    makeResultsFeedDb({ audienceRows: [], proposalRows: [] });
    const result = await callerAs(7).listResultsFeed();
    expect(result).toEqual([]);
  });

  it("una propuesta ACTIVA (no cerrada) y AÚN NO respondida por mí SÍ aparece cuando computeResultsVisible dice que sí (resultsVisibility='immediate', el caso real de HILLS TUESDAY)", async () => {
    const proposal = { id: 8, title: "HILLS TUESDAY", status: "active", venueId: null, resultsVisibility: "immediate" };
    makeResultsFeedDb({ audienceRows: [{ proposalId: 8 }], proposalRows: [proposal] });
    mockGetRespondedProposalIds.mockResolvedValue(new Set()); // nunca respondí
    mockComputeResultsVisible.mockReturnValue(true);
    mockGetVenueName.mockResolvedValue(null);
    mockResolveProposalAuthor.mockResolvedValue(null);
    mockGetProposalResults.mockResolvedValue({ total: 0, breakdown: [] });
    mockGetLikeCountsBatch.mockResolvedValue(new Map());
    mockGetCommentCountsBatch.mockResolvedValue(new Map());
    mockGetShareCountsBatch.mockResolvedValue(new Map());

    const result = await callerAs(7).listResultsFeed();

    // La candidata se saca de la AUDIENCIA (communityProposalAudiences), no
    // de "propuestas que ya respondí" — por eso hasResponded=false no impide
    // que aparezca cuando resultsVisibility='immediate' lo permite.
    expect(mockComputeResultsVisible).toHaveBeenCalledWith(proposal, false, expect.any(Date));
    expect(result).toHaveLength(1);
    expect(result[0].proposal.id).toBe(8);
  });

  it("una propuesta en mi audiencia se EXCLUYE cuando computeResultsVisible dice que no (p.ej. resultsVisibility='after_close' y todavía activa)", async () => {
    const proposal = { id: 9, title: "Otra idea", status: "active", venueId: null, resultsVisibility: "after_close" };
    makeResultsFeedDb({ audienceRows: [{ proposalId: 9 }], proposalRows: [proposal] });
    mockGetRespondedProposalIds.mockResolvedValue(new Set());
    mockComputeResultsVisible.mockReturnValue(false);

    const result = await callerAs(7).listResultsFeed();
    expect(result).toEqual([]);
  });

  it("una propuesta CERRADA sigue apareciendo cuando computeResultsVisible lo permite (comportamiento previo preservado)", async () => {
    const proposal = { id: 10, title: "Ya cerrada", status: "closed", venueId: null, resultsVisibility: "after_close" };
    makeResultsFeedDb({ audienceRows: [{ proposalId: 10 }], proposalRows: [proposal] });
    mockGetRespondedProposalIds.mockResolvedValue(new Set([10]));
    mockComputeResultsVisible.mockReturnValue(true);
    mockGetVenueName.mockResolvedValue(null);
    mockResolveProposalAuthor.mockResolvedValue(null);
    mockGetProposalResults.mockResolvedValue({ total: 0, breakdown: [] });
    mockGetLikeCountsBatch.mockResolvedValue(new Map());
    mockGetCommentCountsBatch.mockResolvedValue(new Map());
    mockGetShareCountsBatch.mockResolvedValue(new Map());

    const result = await callerAs(7).listResultsFeed();
    expect(mockComputeResultsVisible).toHaveBeenCalledWith(proposal, true, expect.any(Date));
    expect(result).toHaveLength(1);
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

describe("COM-02B — getPublicById: scoping por comunidad (gap preexistente corregido) + ficha social tras participar en propuesta activa", () => {
  beforeEach(() => {
    mockGetProposalById.mockReset().mockResolvedValue({ id: 10, status: "closed", venueId: null, endsAt: null, resultsVisibility: "immediate" });
    mockIsProposalVisibleToUser.mockReset().mockResolvedValue(true);
    mockListProposalOptions.mockReset().mockResolvedValue([]);
    mockGetVenueName.mockReset().mockResolvedValue(null);
    mockGetUserResponse.mockReset().mockResolvedValue(null);
    mockComputeResultsVisible.mockReset().mockReturnValue(false); // evita tocar getProposalResults real en estos tests
    mockResolveProposalAuthor.mockReset().mockResolvedValue(null);
    mockGetLikeState.mockReset().mockResolvedValue({ liked: false, count: 0 });
    mockGetCommentCountsBatch.mockReset().mockResolvedValue(new Map());
    mockGetShareCountsBatch.mockReset().mockResolvedValue(new Map());
    mockListComments.mockReset().mockResolvedValue({ total: 0, items: [] });
  });

  it("Student de una comunidad que no es la de la propuesta -> FORBIDDEN (spec §25, gap documentado en el informe COM-02 ahora corregido)", async () => {
    mockIsProposalVisibleToUser.mockResolvedValue(false);
    await expect(callerAs(42).getPublicById({ id: 10 })).rejects.toThrow(/no tienes acceso/i);
  });

  it("Admin puede abrirla aunque isProposalVisibleToUser diga false — no 'pertenece' a una comunidad como un Student", async () => {
    mockIsProposalVisibleToUser.mockResolvedValue(false);
    const result = await callerAsAdmin(1).getPublicById({ id: 10 });
    expect(result.proposal.id).toBe(10);
  });

  it("propuesta ACTIVA + Student SIN responder -> showSocialLayer=false (sigue siendo el VoteForm de siempre)", async () => {
    mockGetProposalById.mockResolvedValue({ id: 10, status: "active", venueId: null, endsAt: null, resultsVisibility: "immediate" });
    mockGetUserResponse.mockResolvedValue(null);
    const result = await callerAs(42).getPublicById({ id: 10 });
    expect(result.showSocialLayer).toBe(false);
    expect(result.hasResponded).toBe(false);
    expect(mockResolveProposalAuthor).not.toHaveBeenCalled();
  });

  it("propuesta ACTIVA + Student YA respondió -> showSocialLayer=true (spec COM-02B §2.B, fix de producto), resuelve autor/like/comentarios", async () => {
    mockGetProposalById.mockResolvedValue({ id: 10, status: "active", venueId: null, endsAt: null, resultsVisibility: "immediate" });
    mockGetUserResponse.mockResolvedValue({ response: { id: 1 }, values: [] });
    const result = await callerAs(42).getPublicById({ id: 10 });
    expect(result.showSocialLayer).toBe(true);
    expect(result.hasResponded).toBe(true);
    expect(mockResolveProposalAuthor).toHaveBeenCalled();
    expect(mockGetLikeState).toHaveBeenCalledWith(10, 42);
  });

  it("propuesta CERRADA -> showSocialLayer=true siempre, con o sin respuesta propia (regresión COM-02)", async () => {
    mockGetUserResponse.mockResolvedValue(null); // ni siquiera respondió, y aun así está cerrada
    const result = await callerAs(42).getPublicById({ id: 10 });
    expect(result.showSocialLayer).toBe(true);
  });

  it("COM-02C: showSocialLayer=true -> latestComment se resuelve vía listComments(limit:1) real, misma fuente de verdad que el resto de comentarios", async () => {
    mockListComments.mockResolvedValue({
      total: 3,
      items: [{ id: 9, proposalId: 10, content: "El más reciente", createdAt: new Date(), isOwn: false, author: { userId: 4, name: "Cristina", hasAvatar: false }, replies: [] }],
    });
    const result = await callerAs(42).getPublicById({ id: 10 });
    expect(mockListComments).toHaveBeenCalledWith(10, 42, { limit: 1, offset: 0 });
    expect(result.latestComment).toMatchObject({ id: 9, content: "El más reciente" });
  });

  it("COM-02C: showSocialLayer=false (activa, sin responder) -> latestComment=null, listComments NUNCA se llama (spec §32, no query de más)", async () => {
    mockGetProposalById.mockResolvedValue({ id: 10, status: "active", venueId: null, endsAt: null, resultsVisibility: "immediate" });
    mockGetUserResponse.mockResolvedValue(null);
    const result = await callerAs(42).getPublicById({ id: 10 });
    expect(result.latestComment).toBeNull();
    expect(mockListComments).not.toHaveBeenCalled();
  });

  it("COM-02C: sin comentarios visibles -> latestComment=null (nunca un objeto vacío inventado)", async () => {
    mockListComments.mockResolvedValue({ total: 0, items: [] });
    const result = await callerAs(42).getPublicById({ id: 10 });
    expect(result.latestComment).toBeNull();
  });

  it("Bottom sheets + Share: showSocialLayer=true -> shareCount se resuelve vía getShareCountsBatch (batch, sin N+1)", async () => {
    mockGetShareCountsBatch.mockResolvedValue(new Map([[10, 7]]));
    const result = await callerAs(42).getPublicById({ id: 10 });
    expect(mockGetShareCountsBatch).toHaveBeenCalledWith([10]);
    expect(result.shareCount).toBe(7);
  });

  it("Bottom sheets + Share: showSocialLayer=false (activa, sin responder) -> shareCount=0, getShareCountsBatch NUNCA se llama", async () => {
    mockGetProposalById.mockResolvedValue({ id: 10, status: "active", venueId: null, endsAt: null, resultsVisibility: "immediate" });
    mockGetUserResponse.mockResolvedValue(null);
    const result = await callerAs(42).getPublicById({ id: 10 });
    expect(result.shareCount).toBe(0);
    expect(mockGetShareCountsBatch).not.toHaveBeenCalled();
  });
});

describe("COM-02 — Community Social Results: likes/comentarios, siempre re-autorizados server-side (spec §18/§19/§27)", () => {
  beforeEach(() => {
    mockGetProposalById.mockReset().mockResolvedValue({ id: 10, status: "closed" });
    mockIsProposalVisibleToUser.mockReset().mockResolvedValue(true);
    mockGetLikeState.mockReset().mockResolvedValue({ liked: false, count: 3 });
    mockToggleLike.mockReset().mockResolvedValue({ liked: true, count: 4 });
    mockListComments.mockReset().mockResolvedValue({ total: 1, items: [{ id: 1, author: { userId: 4, name: "Cristina", hasAvatar: false }, isOwn: false, content: "x", replies: [] }] });
    mockCreateComment.mockReset().mockResolvedValue({ id: 5, proposalId: 10, userId: 42, parentCommentId: null, content: "hola" });
    mockDeleteOwnComment.mockReset().mockResolvedValue(undefined);
    mockModerateComment.mockReset().mockResolvedValue(undefined);
    mockGetProposalCommunityIds.mockReset().mockResolvedValue([]);
    mockNotifyProposalCommented.mockReset().mockResolvedValue(undefined);
    mockNotifyCommentReplied.mockReset().mockResolvedValue(undefined);
    mockRecordShare.mockReset().mockResolvedValue({ count: 1 });
  });

  it("recordShare delega directamente (la re-autorización real vive en communitySocialDb.assertCanInteract, ya probada en su propio módulo)", async () => {
    const result = await callerAs(42).recordShare({ proposalId: 10, method: "copy_link" });
    expect(result).toEqual({ count: 1 });
    expect(mockRecordShare).toHaveBeenCalledWith(10, 42, "copy_link");
  });

  it("recordShare propaga un error de negocio (p.ej. NOT_CLOSED de una propuesta activa sin responder) como error de cliente, nunca un 500 crudo", async () => {
    const { CommunitySocialError } = await vi.importActual<typeof import("../segolife/community/communitySocialDb")>("../segolife/community/communitySocialDb");
    mockRecordShare.mockRejectedValue(new CommunitySocialError("NOT_CLOSED", "Los comentarios y likes se habilitan al participar en la propuesta, o cuando esta finaliza."));
    await expect(callerAs(42).recordShare({ proposalId: 10, method: "native" })).rejects.toThrow(/se habilitan al participar/i);
  });

  it("toggleLike delega directamente (la re-autorización real vive en communitySocialDb.assertCanInteract, ya probado en su propio módulo)", async () => {
    const result = await callerAs(42).toggleLike({ proposalId: 10 });
    expect(result).toEqual({ liked: true, count: 4 });
    expect(mockToggleLike).toHaveBeenCalledWith(10, 42);
  });

  it("listComments: delega con el userId real del caller (nunca uno del cliente) — la re-autorización real (NOT_FOUND/FORBIDDEN/COM-02B activa-sin-responder) vive en communitySocialDb.listComments, ya probada en su propio módulo", async () => {
    const result = await callerAs(42).listComments({ proposalId: 10, limit: 5, offset: 0 });
    expect(result.total).toBe(1);
    expect(mockListComments).toHaveBeenCalledWith(10, 42, { limit: 5, offset: 0 });
  });

  it("listComments: propaga un error de negocio (p.ej. NOT_CLOSED de una propuesta activa sin responder) como error de cliente, nunca un 500 crudo", async () => {
    const { CommunitySocialError } = await vi.importActual<typeof import("../segolife/community/communitySocialDb")>("../segolife/community/communitySocialDb");
    mockListComments.mockRejectedValue(new CommunitySocialError("NOT_CLOSED", "Los comentarios y likes se habilitan al participar en la propuesta, o cuando esta finaliza."));
    await expect(callerAs(42).listComments({ proposalId: 10 })).rejects.toThrow(/se habilitan al participar/i);
  });

  it("createComment: comentario raíz -> notifica al autor de la propuesta (notifyProposalCommented), nunca notifyCommentReplied", async () => {
    await callerAs(42).createComment({ proposalId: 10, content: "Qué buena idea" });
    expect(mockNotifyProposalCommented).toHaveBeenCalled();
    expect(mockNotifyCommentReplied).not.toHaveBeenCalled();
  });

  it("createComment: respuesta (parentCommentId presente) -> notifica al autor del comentario padre (notifyCommentReplied), nunca notifyProposalCommented", async () => {
    mockCreateComment.mockResolvedValue({ id: 6, proposalId: 10, userId: 42, parentCommentId: 1, content: "respuesta" });
    await callerAs(42).createComment({ proposalId: 10, content: "respuesta", parentCommentId: 1 });
    expect(mockNotifyCommentReplied).toHaveBeenCalled();
    expect(mockNotifyProposalCommented).not.toHaveBeenCalled();
  });

  it("createComment: propaga un error de negocio (p.ej. NOT_CLOSED) como error de cliente, nunca un 500 crudo", async () => {
    const { CommunitySocialError } = await vi.importActual<typeof import("../segolife/community/communitySocialDb")>("../segolife/community/communitySocialDb");
    mockCreateComment.mockRejectedValue(new CommunitySocialError("NOT_CLOSED", "Los comentarios se habilitan cuando la propuesta finaliza."));
    await expect(callerAs(42).createComment({ proposalId: 10, content: "hola" })).rejects.toThrow(/se habilitan cuando/i);
  });

  it("deleteComment: se resuelve SIEMPRE con el userId real del caller — nunca uno enviado por el cliente (IDOR)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (callerAs(42).deleteComment as any)({ commentId: 1, userId: 999 });
    expect(mockDeleteOwnComment).toHaveBeenCalledWith(1, 42);
    expect(mockDeleteOwnComment).not.toHaveBeenCalledWith(1, 999);
  });

  it("deleteComment: propaga FORBIDDEN si communitySocialDb rechaza borrar el comentario de otro", async () => {
    const { CommunitySocialError } = await vi.importActual<typeof import("../segolife/community/communitySocialDb")>("../segolife/community/communitySocialDb");
    mockDeleteOwnComment.mockRejectedValue(new CommunitySocialError("FORBIDDEN", "No puedes borrar el comentario de otro estudiante."));
    await expect(callerAs(42).deleteComment({ commentId: 1 })).rejects.toThrow(/no puedes borrar/i);
  });

  it("moderateComment: Student normal (role='user') NUNCA puede moderar — solo admin (community.moderate)", async () => {
    await expect(callerAs(42).moderateComment({ commentId: 1 })).rejects.toThrow(/acceso denegado|forbidden/i);
    expect(mockModerateComment).not.toHaveBeenCalled();
  });

  it("moderateComment: admin sí puede moderar cualquier comentario", async () => {
    const result = await callerAsAdmin(1).moderateComment({ commentId: 1 });
    expect(result.success).toBe(true);
    expect(mockModerateComment).toHaveBeenCalledWith(1, 1);
  });

  it("adminListComments: Student normal (role='user') NUNCA puede acceder a la vista de moderación", async () => {
    await expect(callerAs(42).adminListComments({ proposalId: 10 })).rejects.toThrow(/acceso denegado|forbidden/i);
    expect(mockListComments).not.toHaveBeenCalled();
  });

  it("adminListComments: admin sí puede, e incluye los ocultos (includeHidden=true, spec §15/§17)", async () => {
    mockGetCommunityAccess.mockResolvedValue("all");
    await callerAsAdmin(1).adminListComments({ proposalId: 10, limit: 50, offset: 0 });
    expect(mockListComments).toHaveBeenCalledWith(10, 1, { limit: 50, offset: 0 }, true);
  });
});

describe("Bugfix 'impedir voto múltiple' (2026-08-22) — respond: delegación + mapeo de error sin string-matching", () => {
  beforeEach(() => { mockSubmitResponse.mockReset(); });

  it("respond rechaza sin sesión", async () => {
    await expect(callerWithoutSession().respond({ proposalId: 1, payload: { questionType: "me_apunto" } })).rejects.toThrow(/please login/i);
  });

  it("delega directamente en submitResponse() y devuelve success:true + el resultado", async () => {
    mockSubmitResponse.mockResolvedValue({ response: { id: 10 }, rewardGranted: true });
    const result = await callerAs(42).respond({ proposalId: 1, payload: { questionType: "me_apunto" } });
    expect(mockSubmitResponse).toHaveBeenCalledWith(1, 42, { questionType: "me_apunto" });
    expect(result).toMatchObject({ success: true, rewardGranted: true });
  });

  it("ALREADY_RESPONDED (2º intento — repro exacto del bug) → CONFLICT, con la causa de dominio propagada para el frontend (nunca string-matching sobre el mensaje)", async () => {
    const { CommunityResponseError } = await vi.importActual<typeof import("../segolife/community/communityResponseService")>("../segolife/community/communityResponseService");
    mockSubmitResponse.mockRejectedValue(new CommunityResponseError("ALREADY_RESPONDED", "Ya has respondido a esta propuesta y no admite cambios"));
    await expect(callerAs(42).respond({ proposalId: 1, payload: { questionType: "me_apunto" } }))
      .rejects.toMatchObject({ code: "CONFLICT", cause: expect.objectContaining({ code: "ALREADY_RESPONDED" }) });
  });

  it("CLOSED → BAD_REQUEST, nunca un 500 genérico", async () => {
    const { CommunityResponseError } = await vi.importActual<typeof import("../segolife/community/communityResponseService")>("../segolife/community/communityResponseService");
    mockSubmitResponse.mockRejectedValue(new CommunityResponseError("CLOSED", "Esta propuesta no está abierta para respuestas ahora mismo"));
    await expect(callerAs(42).respond({ proposalId: 1, payload: { questionType: "me_apunto" } }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", cause: expect.objectContaining({ code: "CLOSED" }) });
  });
});
