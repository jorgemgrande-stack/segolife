/**
 * communityProposalNotifier.test.ts — Community Proposals (backlog, spec
 * §15.B). Mismo patrón que fourvenuesPublicationNotifier.test.ts: mockea
 * `drizzle-orm/mysql2` + `mysql2/promise` (enruta por identidad de tabla)
 * y `../engagement/notificationService` para aislar solo la lógica propia
 * de este módulo (fan-out a admins, idempotencyKey, best-effort ante fallo).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { users, communities } from "../../../drizzle/schema";

const { mockCreateNotification, tableRows } = vi.hoisted(() => ({
  mockCreateNotification: vi.fn().mockResolvedValue({ status: "created", notification: { id: 1 } }),
  tableRows: { users: [] as Array<{ id: number }>, communities: [] as Array<{ slug: string }> },
}));

vi.mock("../engagement/notificationService", () => ({ createNotification: mockCreateNotification }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({}) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => {
    // IMPORTANTE: `b` NUNCA debe tener su propio `.then` — un objeto
    // "thenable" devuelto por una función `async` (aquí, getDb() de
    // communityProposalNotifier.ts hace `return _db`) se auto-resuelve vía
    // ESE `.then()` en vez de conservarse como el propio objeto `_db` — un
    // bug real descubierto escribiendo este mismo test (conn dejaba de ser
    // `b` y pasaba a ser directamente el resultado ya resuelto de una
    // consulta previa). `.where()` es el tramo terminal SOLO para la
    // consulta de admins (listAdminRecipients, tabla `users`) — para
    // comunidades sigue encadenando hasta `.limit()`.
    let lastTable: unknown = null;
    const b: any = {};
    b.select = () => b;
    b.from = (table: unknown) => { lastTable = table; return b; };
    b.where = () => (lastTable === communities ? b : Promise.resolve(tableRows.users));
    b.limit = () => Promise.resolve(tableRows.communities);
    return b;
  },
}));

import { notifyStudentProposalSubmitted, notifyStudentProposalApproved, notifyStudentProposalRejected } from "./communityProposalNotifier";
import type { CommunityStudentProposal } from "../../../drizzle/schema";

function proposal(overrides: Partial<CommunityStudentProposal> = {}): CommunityStudentProposal {
  return {
    id: 900, studentUserId: 7, communityId: 1, title: "Padel el sábado", description: null,
    venueId: null, suggestedDate: null, category: null, status: "pending_moderation",
    rejectionReasonInternal: null, rejectionReasonStudent: null, moderatedByUserId: null, moderatedAt: null,
    convertedProposalId: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  } as CommunityStudentProposal;
}

describe("notifyStudentProposalSubmitted — fan-out a admins + idempotencia", () => {
  beforeEach(() => {
    mockCreateNotification.mockReset();
    mockCreateNotification.mockResolvedValue({ status: "created", notification: { id: 1 } });
    tableRows.users = [{ id: 1 }, { id: 2 }];
  });

  it("1 createNotification POR admin activo (2 admins → 2 llamadas)", async () => {
    await notifyStudentProposalSubmitted(proposal(), "Ana");
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification.mock.calls.map(c => c[0].userId).sort()).toEqual([1, 2]);
  });

  it("usa type/category/audienceType/sourceType correctos y deep link a la moderación", async () => {
    await notifyStudentProposalSubmitted(proposal(), "Ana");
    const input = mockCreateNotification.mock.calls[0][0];
    expect(input.type).toBe("community_student_proposal_submitted");
    expect(input.category).toBe("events");
    expect(input.audienceType).toBe("transactional");
    expect(input.sourceType).toBe("community_student_proposal");
    expect(input.sourceId).toBe(900);
    expect(input.communityId).toBe(1);
    expect(input.rendered.deepLink).toBe("/admin/comunity/moderacion");
    expect(input.rendered.bodyEs).toContain("Ana");
    expect(input.rendered.bodyEs).toContain("Padel el sábado");
  });

  it("idempotencyKey es distinto por admin (evita autocolisión contra la UNIQUE real)", async () => {
    await notifyStudentProposalSubmitted(proposal(), "Ana");
    const keys = mockCreateNotification.mock.calls.map(c => c[0].idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toContain("community_student_proposal_submitted:900");
  });

  it("sin nombre de Student (null) usa un placeholder, nunca lanza", async () => {
    await notifyStudentProposalSubmitted(proposal(), null);
    expect(mockCreateNotification.mock.calls[0][0].rendered.bodyEs).toContain("—");
  });

  it("sin admins activos → no-op limpio, nunca llama a createNotification", async () => {
    tableRows.users = [];
    await notifyStudentProposalSubmitted(proposal(), "Ana");
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("createNotification falla → nunca lanza (best-effort, no debe romper el envío de la idea)", async () => {
    mockCreateNotification.mockRejectedValue(new Error("boom"));
    await expect(notifyStudentProposalSubmitted(proposal(), "Ana")).resolves.toBeUndefined();
  });
});

describe("notifyStudentProposalApproved — FINAL ZERO-DEBT (Block D)", () => {
  beforeEach(() => {
    mockCreateNotification.mockReset();
    mockCreateNotification.mockResolvedValue({ status: "created", notification: { id: 1 } });
    tableRows.communities = [{ slug: "ie" }];
  });

  it("notifica al STUDENT (studentUserId), nunca a un admin", async () => {
    await notifyStudentProposalApproved(proposal());
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification.mock.calls[0][0].userId).toBe(7);
  });

  it("deep_link apunta al hub Community del propio Student (/ie/comunity), ya en la whitelist", async () => {
    await notifyStudentProposalApproved(proposal());
    expect(mockCreateNotification.mock.calls[0][0].rendered.deepLink).toBe("/ie/comunity");
  });

  it("idempotencyKey por proposalId, sin admin (una sola notificación real por aprobación)", async () => {
    await notifyStudentProposalApproved(proposal());
    expect(mockCreateNotification.mock.calls[0][0].idempotencyKey).toBe("community_student_proposal_approved:900");
  });

  it("el título de la idea aparece en el cuerpo del mensaje", async () => {
    await notifyStudentProposalApproved(proposal({ title: "Torneo de pádel" }));
    expect(mockCreateNotification.mock.calls[0][0].rendered.bodyEs).toContain("Torneo de pádel");
  });

  it("comunidad inexistente (slug no resuelto) → no-op limpio, nunca un deep_link roto", async () => {
    tableRows.communities = [];
    await notifyStudentProposalApproved(proposal());
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("createNotification falla → nunca lanza (best-effort, la aprobación ya guardada nunca se deshace)", async () => {
    mockCreateNotification.mockRejectedValue(new Error("boom"));
    await expect(notifyStudentProposalApproved(proposal())).resolves.toBeUndefined();
  });
});

describe("notifyStudentProposalRejected — FINAL ZERO-DEBT (Block D)", () => {
  beforeEach(() => {
    mockCreateNotification.mockReset();
    mockCreateNotification.mockResolvedValue({ status: "created", notification: { id: 1 } });
    tableRows.communities = [{ slug: "uva" }];
  });

  it("notifica al Student, con el motivo VISIBLE cuando el admin lo rellenó", async () => {
    await notifyStudentProposalRejected(proposal({ rejectionReasonStudent: "Ya hay un torneo similar programado" }));
    expect(mockCreateNotification.mock.calls[0][0].userId).toBe(7);
    expect(mockCreateNotification.mock.calls[0][0].rendered.bodyEs).toContain("Ya hay un torneo similar programado");
  });

  it("NUNCA expone rejectionReasonInternal, aunque esté relleno", async () => {
    await notifyStudentProposalRejected(proposal({
      rejectionReasonInternal: "Presupuesto insuficiente este trimestre — info interna",
      rejectionReasonStudent: null,
    }));
    const body = mockCreateNotification.mock.calls[0][0].rendered.bodyEs;
    expect(body).not.toContain("Presupuesto insuficiente");
  });

  it("sin motivo visible (rejectionReasonStudent=null): el mensaje nunca inventa uno, solo el título", async () => {
    await notifyStudentProposalRejected(proposal({ title: "Fiesta de disfraces", rejectionReasonStudent: null }));
    const body = mockCreateNotification.mock.calls[0][0].rendered.bodyEs;
    expect(body).toContain("Fiesta de disfraces");
    expect(body).not.toContain("Motivo:");
  });

  it("deep_link apunta al hub Community del propio Student", async () => {
    await notifyStudentProposalRejected(proposal());
    expect(mockCreateNotification.mock.calls[0][0].rendered.deepLink).toBe("/uva/comunity");
  });

  it("idempotencyKey por proposalId — un reintento de rechazar nunca duplica", async () => {
    await notifyStudentProposalRejected(proposal());
    expect(mockCreateNotification.mock.calls[0][0].idempotencyKey).toBe("community_student_proposal_rejected:900");
  });

  it("createNotification falla → nunca lanza", async () => {
    mockCreateNotification.mockRejectedValue(new Error("boom"));
    await expect(notifyStudentProposalRejected(proposal())).resolves.toBeUndefined();
  });
});
