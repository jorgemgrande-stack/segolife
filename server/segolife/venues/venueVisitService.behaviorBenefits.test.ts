/**
 * venueVisitService.behaviorBenefits.test.ts — SEGOLIFE BEHAVIORAL
 * BENEFITS RULE ENGINE (Fase 6, spec §5/§16/§41 test #8). Prueba
 * específicamente el cableado nuevo de recordVenueVisit() —
 * resolveOperationalDate/idempotencia de la visita en sí ya están cubiertos
 * en venueVisitService.test.ts, sin tocar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEvaluateBenefitsForOrigin } = vi.hoisted(() => ({ mockEvaluateBenefitsForOrigin: vi.fn() }));
vi.mock("../benefits/benefitRuleEngine", () => ({ evaluateBenefitsForOrigin: mockEvaluateBenefitsForOrigin }));

const { mockEmitBenefitGranted } = vi.hoisted(() => ({ mockEmitBenefitGranted: vi.fn() }));
vi.mock("../benefits/benefitEvents", () => ({
  emitBenefitGranted: mockEmitBenefitGranted,
  buildBenefitGrantedPayload: (ub: unknown, def: unknown) => ({ userBenefit: ub, definition: def }),
}));

import { recordVenueVisit } from "./venueVisitService";
import { venueVisits, userCommunities } from "../../../drizzle/schema";

/** Mock mínimo — sin extracción de condiciones genérica: cada test controla explícitamente qué debe devolver cada tabla. */
function makeMockDb(config: { existingVisit?: Record<string, unknown> | null; membership?: { communityId: number } | null }) {
  let insertedVisit: Record<string, unknown> | null = null;
  let nextId = 500;
  const b: any = {};
  let table: unknown = null;
  let mode: "select" | "insert" = "select";
  b.select = () => { mode = "select"; return b; };
  b.from = (t: unknown) => { table = t; return b; };
  b.insert = (t: unknown) => { mode = "insert"; table = t; return b; };
  b.ignore = () => b;
  b.where = () => b;
  b.orderBy = () => b;
  b.limit = () => b;
  b.values = (v: Record<string, unknown>) => {
    insertedVisit = { id: nextId, ...v };
    return Promise.resolve([{ insertId: nextId }]);
  };
  b.then = (resolve: (v: unknown) => void) => {
    if (mode === "insert") return resolve(undefined);
    if (table === venueVisits) {
      if (config.existingVisit !== undefined && config.existingVisit !== null) return resolve([config.existingVisit]);
      if (insertedVisit) return resolve([insertedVisit]);
      return resolve([]);
    }
    if (table === userCommunities) return resolve(config.membership ? [config.membership] : []);
    return resolve([]);
  };
  return b as any;
}

const INPUT = { userId: 42, venueId: 10, occurredAt: new Date("2026-06-12T21:00:00Z"), source: "segolife_identity" };

describe("recordVenueVisit — evaluación de Benefits solo en visitas NUEVAS (spec §5)", () => {
  beforeEach(() => {
    mockEvaluateBenefitsForOrigin.mockReset();
    mockEmitBenefitGranted.mockReset();
  });

  it("visita nueva: evalúa Benefits con type='venue_visit' y el sourceId de la visita recién creada", async () => {
    mockEvaluateBenefitsForOrigin.mockResolvedValue([]);
    const db = makeMockDb({ existingVisit: null, membership: { communityId: 3 } });
    const result = await recordVenueVisit(INPUT, db);
    expect(result.status).toBe("recorded");
    expect(mockEvaluateBenefitsForOrigin).toHaveBeenCalledWith(
      expect.objectContaining({ type: "venue_visit", userId: 42, venueId: 10, communityId: 3, sourceId: 500 }),
      db
    );
  });

  it("visita YA registrada (already_recorded): NUNCA re-evalúa Benefits ni re-notifica (un reescaneo duplicado no debe generar una segunda concesión)", async () => {
    const db = makeMockDb({ existingVisit: { id: 1, idempotencyKey: "venue_visit:10:42:2026-06-12" } });
    const result = await recordVenueVisit(INPUT, db);
    expect(result.status).toBe("already_recorded");
    expect(mockEvaluateBenefitsForOrigin).not.toHaveBeenCalled();
    expect(mockEmitBenefitGranted).not.toHaveBeenCalled();
  });

  it("un Benefit desbloqueado por la visita emite BenefitGranted (Communication Center)", async () => {
    const unlocked = [{ userBenefit: { id: 99 }, definition: { id: 1, name: "Entrada gratis" } }];
    mockEvaluateBenefitsForOrigin.mockResolvedValue(unlocked);
    const db = makeMockDb({ existingVisit: null, membership: null });
    await recordVenueVisit(INPUT, db);
    expect(mockEmitBenefitGranted).toHaveBeenCalledTimes(1);
  });

  it("fail-safe: si evaluateBenefitsForOrigin lanza, la visita ya registrada NO se pierde ni se propaga el error", async () => {
    mockEvaluateBenefitsForOrigin.mockRejectedValue(new Error("boom"));
    const db = makeMockDb({ existingVisit: null, membership: null });
    const result = await recordVenueVisit(INPUT, db);
    expect(result.status).toBe("recorded");
    expect(result.visit.id).toBe(500);
  });

  it("sin membresía de comunidad resuelta, evalúa igualmente con communityId=null (nunca bloquea la visita por esto)", async () => {
    mockEvaluateBenefitsForOrigin.mockResolvedValue([]);
    const db = makeMockDb({ existingVisit: null, membership: null });
    await recordVenueVisit(INPUT, db);
    expect(mockEvaluateBenefitsForOrigin).toHaveBeenCalledWith(expect.objectContaining({ communityId: null }), db);
  });
});
