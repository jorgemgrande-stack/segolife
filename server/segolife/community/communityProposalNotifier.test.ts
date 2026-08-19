/**
 * communityProposalNotifier.test.ts — Community Proposals (backlog, spec
 * §15.B). Mismo patrón que fourvenuesPublicationNotifier.test.ts: mockea
 * `drizzle-orm/mysql2` + `mysql2/promise` (enruta por identidad de tabla)
 * y `../engagement/notificationService` para aislar solo la lógica propia
 * de este módulo (fan-out a admins, idempotencyKey, best-effort ante fallo).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateNotification, tableRows } = vi.hoisted(() => ({
  mockCreateNotification: vi.fn().mockResolvedValue({ status: "created", notification: { id: 1 } }),
  tableRows: { users: [] as Array<{ id: number }> },
}));

vi.mock("../engagement/notificationService", () => ({ createNotification: mockCreateNotification }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({}) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => {
    const b: any = {};
    b.select = () => b;
    b.from = () => b;
    b.where = async () => tableRows.users;
    return b;
  },
}));

import { notifyStudentProposalSubmitted } from "./communityProposalNotifier";
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
