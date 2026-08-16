/**
 * commandCenterPlanAndPlay.test.ts — Plan & Play (capa de marca sobre el
 * backend real "Comunity", spec §1.1) y Community Funnel (poblaciones/
 * periodos separados por etapa, spec §22).
 */
import { describe, it, expect, vi } from "vitest";
import type { DashboardFilterContext } from "./dashboardFilters";

vi.mock("./activitySignals", () => ({
  countActiveStudents: vi.fn(async () => 42),
  distinctVenuesByStudent: vi.fn(async () => new Map([[1, 2], [2, 1], [3, 3]])),
}));
vi.mock("../students/historicalIdentityService", () => ({
  getHistoricalIdentityStats: vi.fn(async () => ({ total: 6086, unregistered: 5000, possibleMatch: 500, autoMatchCandidate: 100, linked: 400, conflict: 86, crossVenue: 300 })),
}));

import { getPlanAndPlay, getCommunityFunnel } from "./commandCenterPlanAndPlay";

function fakeExecuteDb(queue: unknown[][]) {
  const execute = vi.fn();
  for (const rows of queue) execute.mockResolvedValueOnce([rows, []]);
  return { execute };
}

const NOW = new Date("2026-08-14T12:00:00.000Z");
const CTX: DashboardFilterContext = { communityId: null, from: new Date("2026-07-15T00:00:00.000Z"), to: NOW, rangeLabel: "30d" };

describe("getPlanAndPlay", () => {
  it("caso 'After Party Casanova' — most active con respuesta dominante y %", async () => {
    const db = fakeExecuteDb([
      [{ n: 3 }], // activeProposals
      [{ n: 243 }], // responsesInPeriod
      [{ n: 300 }], // audienceSize
      [{ n: 5 }], // pendingModeration
      [], // endingSoon
      [{ n: 2 }], // approvedStudentProposalsInPeriod
      // getMostActiveProposal:
      [{ proposal_id: 1, title: "After Party Casanova", min_sample_size: 5, response_count: 243 }], // ranking
      [{ label: "yes", n: 199 }], // answer breakdown (top)
    ]);
    const snapshot = await getPlanAndPlay(CTX, db as never, NOW);
    expect(snapshot.activeProposals).toBe(3);
    expect(snapshot.responsesInPeriod).toBe(243);
    expect(snapshot.participationPct).toBe(81);
    expect(snapshot.approvedStudentProposalsInPeriod).toBe(2);
    expect(snapshot.mostActive).toEqual({ proposalId: 1, title: "After Party Casanova", responseCount: 243, topAnswerLabel: "yes", topAnswerPct: Math.round((199 / 243) * 1000) / 10 });
  });

  it("respeta el anonimato: si la muestra de la propuesta ganadora está por debajo de su min_sample_size, no desglosa la respuesta dominante", async () => {
    const db = fakeExecuteDb([
      [{ n: 1 }], [{ n: 3 }], [{ n: 10 }], [{ n: 0 }], [], [{ n: 0 }],
      [{ proposal_id: 2, title: "Propuesta con poca muestra", min_sample_size: 5, response_count: 3 }],
    ]);
    const snapshot = await getPlanAndPlay(CTX, db as never, NOW);
    expect(snapshot.mostActive).toEqual({ proposalId: 2, title: "Propuesta con poca muestra", responseCount: 3, topAnswerLabel: null, topAnswerPct: null });
  });

  it("sin ninguna propuesta activa → 'No hay propuestas activas' (mostActive null, activeProposals 0), nunca inventa datos", async () => {
    const db = fakeExecuteDb([
      [{ n: 0 }], [{ n: 0 }], [{ n: 0 }], [{ n: 0 }], [], [{ n: 0 }],
      [], // ranking vacío -> sin most active
    ]);
    const snapshot = await getPlanAndPlay(CTX, db as never, NOW);
    expect(snapshot.activeProposals).toBe(0);
    expect(snapshot.mostActive).toBeNull();
    expect(snapshot.participationPct).toBeNull();
  });

  it("comunidad filtrada: usa el JOIN real a community_proposal_communities, nunca infiere del venue", async () => {
    const db = fakeExecuteDb([
      [{ n: 1 }], [{ n: 5 }], [{ n: 10 }], [{ n: 2 }], [], [{ n: 0 }],
      [],
    ]);
    await getPlanAndPlay({ ...CTX, communityId: 3 }, db as never, NOW);
    const firstCallSql = JSON.stringify(db.execute.mock.calls[0][0]);
    expect(firstCallSql).toContain("community_proposal_communities");
  });

  // SEGOLIFE ADMIN AI/BI/COMMAND CENTER (Fase 12, spec §22): ideas
  // aprobadas — mismo hecho que dispara la regla real community_proposal_approved.
  it("approvedStudentProposalsInPeriod cuenta community_student_proposals.status='approved' filtrado por moderated_at, con comunidad si se pide", async () => {
    const db = fakeExecuteDb([
      [{ n: 0 }], [{ n: 0 }], [{ n: 0 }], [{ n: 0 }], [], [{ n: 7 }],
      [],
    ]);
    const snapshot = await getPlanAndPlay({ ...CTX, communityId: 3 }, db as never, NOW);
    expect(snapshot.approvedStudentProposalsInPeriod).toBe(7);
    const approvedCallSql = JSON.stringify(db.execute.mock.calls[5][0]);
    expect(approvedCallSql).toContain("community_student_proposals");
    expect(approvedCallSql).toContain("approved");
  });
});

describe("getCommunityFunnel", () => {
  it("cada etapa reporta su PROPIA población/periodo — Historical Audience y Registered Students nunca se suman", async () => {
    const db = fakeExecuteDb([
      [{ n: 1200 }], // registered
      [{ n: 300 }], // purchasers
      [{ n: 150 }], // attendees
      [{ n: 3 }], // loyalty participants
      [{ n: 20 }], // benefit redeemers
    ]);
    const snapshot = await getCommunityFunnel(CTX, db as never);
    const historicalStage = snapshot.stages.find(s => s.key === "historical_audience");
    const registeredStage = snapshot.stages.find(s => s.key === "registered_students");
    expect(historicalStage?.count).toBe(6086);
    expect(registeredStage?.count).toBe(1200);
    expect(historicalStage?.population).not.toBe(registeredStage?.population);
    expect(snapshot.note.toLowerCase()).toContain("propia");
  });

  it("multi-venue se calcula sobre Students registrados (>=2 venues), independiente del periodo de filtro", async () => {
    const db = fakeExecuteDb([[{ n: 10 }], [{ n: 2 }], [{ n: 1 }], [{ n: 0 }], [{ n: 0 }]]);
    const snapshot = await getCommunityFunnel(CTX, db as never);
    const multiVenueStage = snapshot.stages.find(s => s.key === "multi_venue");
    expect(multiVenueStage?.count).toBe(2); // venues [2,1,3] -> solo 2 estudiantes con >=2
    expect(multiVenueStage?.period).toContain("sin periodo");
  });

  it("todas las etapas están presentes y en el orden documentado del funnel", async () => {
    const db = fakeExecuteDb([[{ n: 0 }], [{ n: 0 }], [{ n: 0 }], [{ n: 0 }], [{ n: 0 }]]);
    const snapshot = await getCommunityFunnel(CTX, db as never);
    expect(snapshot.stages.map(s => s.key)).toEqual([
      "historical_audience", "registered_students", "active_students", "purchasers",
      "attendees", "loyalty_participants", "benefit_redeemers", "multi_venue",
    ]);
  });
});
