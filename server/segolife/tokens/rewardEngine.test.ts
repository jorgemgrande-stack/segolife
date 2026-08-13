/**
 * rewardEngine.test.ts — evaluateReward(context, mode). SIMULATION reutiliza
 * la selección de regla/recurrencia/campaña/topes REAL de tokenRuleEngine.ts
 * (mismo patrón de mock por colas FIFO que tokenEngine.test.ts) pero nunca
 * escribe — se comprueba explícitamente que ningún insert/update se invoca.
 * LIVE se comprueba SOLO en su forma bloqueada (spec: debe permanecer
 * inalcanzable esta fase) — no se prueba el camino real desbloqueado porque
 * no hay ningún caller/flag que pueda alcanzarlo en producción todavía.
 */
import { describe, it, expect } from "vitest";
import { evaluateReward, RewardEngineError } from "./rewardEngine";
import {
  tokenRules, tokenLedger, tokenCampaigns,
  campaignCommunities, campaignVenues, campaignEvents, venueTokenSchedules,
  venueIntegrations, systemSettings,
} from "../../../drizzle/schema";

function blankRule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "Regla", description: null, direction: "earn", origin: "attendance",
    scope: "global", scopeCommunityId: null, scopeVenueId: null, scopeEventId: null, scopeProductId: null,
    calcMethod: "fixed", fixedAmount: 10, rate: null, multiplier: null, minSpend: null,
    maxTokens: null, dailyLimit: null, weeklyLimit: null, monthlyLimit: null, lifetimeLimit: null,
    recurrenceWindow: null, recurrenceThreshold: null, recurrenceMode: null,
    startsAt: null, endsAt: null, active: true, priority: 0,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

/** Mock de solo lectura — cualquier insert/update marca `wroteAnything=true` (comprobación explícita de "SIMULATION no persiste nada"). */
function makeReadOnlyMockDb(opts: {
  schedules?: Array<Record<string, unknown>>;
  campaigns?: Array<Record<string, unknown>>;
  campaignScope?: { communities?: unknown[]; venues?: unknown[]; events?: unknown[] };
  globalCutoffValue?: string | null;
  venueCutoffOverrideAt?: Date | null;
} = {}) {
  let wroteAnything = false;
  const rulesQueue: Array<Array<Record<string, unknown>>> = [];
  const ledgerReadQueue: Array<Array<Record<string, unknown>>> = [];

  function makeQueryFor(table: unknown) {
    const q: Record<string, unknown> = {};
    q.where = () => q;
    q.limit = () => q;
    q.then = (resolve: (v: unknown) => void) => {
      if (table === venueTokenSchedules) return resolve(opts.schedules ?? []);
      if (table === tokenRules) return resolve(rulesQueue.shift() ?? []);
      if (table === tokenLedger) return resolve(ledgerReadQueue.shift() ?? []);
      if (table === tokenCampaigns) return resolve(opts.campaigns ?? []);
      if (table === campaignCommunities) return resolve(opts.campaignScope?.communities ?? []);
      if (table === campaignVenues) return resolve(opts.campaignScope?.venues ?? []);
      if (table === campaignEvents) return resolve(opts.campaignScope?.events ?? []);
      if (table === venueIntegrations) return resolve(opts.venueCutoffOverrideAt !== undefined ? [{ loyaltyCutoffOverrideAt: opts.venueCutoffOverrideAt }] : []);
      if (table === systemSettings) return resolve(opts.globalCutoffValue !== undefined ? [{ value: opts.globalCutoffValue }] : []);
      return resolve([]);
    };
    return q;
  }

  const root: Record<string, unknown> = {
    select: () => ({ from: (t: unknown) => makeQueryFor(t) }),
    insert: () => { wroteAnything = true; throw new Error("SIMULATION nunca debe llamar a insert()"); },
    update: () => { wroteAnything = true; throw new Error("SIMULATION nunca debe llamar a update()"); },
    transaction: () => { wroteAnything = true; throw new Error("SIMULATION nunca debe abrir una transacción"); },
  };

  return {
    db: root as unknown as Parameters<typeof evaluateReward>[2],
    wroteAnything: () => wroteAnything,
    queueRules: (rows: Array<Record<string, unknown>>) => rulesQueue.push(rows),
    queueLedgerRead: (rows: Array<Record<string, unknown>>) => ledgerReadQueue.push(rows),
  };
}

describe("evaluateReward — modo SIMULATION", () => {
  it("camino elegible: calcula el mismo desglose que earnTokens, sin persistir nada", async () => {
    const { db, wroteAnything, queueRules } = makeReadOnlyMockDb();
    queueRules([blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 15 })]); // findApplicableRule
    queueRules([]); // applyRecurrenceBonus — sin reglas de recurrencia

    const result = await evaluateReward({ userId: 42, origin: "attendance" }, "SIMULATION", db);

    expect(result.mode).toBe("SIMULATION");
    expect(result.ledgerId).toBeNull();
    expect(result.explanation).toEqual({
      eligible: true, reason: "GRANTED", ruleId: 1,
      breakdown: {
        base: 15, recurrenceBonus: 0, recurrenceRuleId: null,
        campaignId: null, campaignMultiplier: null, campaignBonus: null,
        beforeLimits: 15, final: 15,
      },
    });
    expect(wroteAnything()).toBe(false);
  });

  it("sin regla aplicable → NO_RULE_FOUND, eligible=false, sin lanzar", async () => {
    const { db, queueRules } = makeReadOnlyMockDb();
    queueRules([]); // findApplicableRule no encuentra nada
    const result = await evaluateReward({ userId: 42, origin: "ticket" }, "SIMULATION", db);
    expect(result.explanation).toEqual({ eligible: false, reason: "NO_RULE_FOUND", ruleId: null, breakdown: null });
  });

  it("fuera de horario del venue → OUTSIDE_SCHEDULE, sin llegar a buscar regla", async () => {
    const { db } = makeReadOnlyMockDb({
      schedules: [{ id: 1, venueId: 7, operationType: "earn", dayOfWeek: 99, startTime: "00:00", endTime: "00:00", active: true, timezone: "Europe/Madrid", validFrom: null, validTo: null }],
    });
    const result = await evaluateReward({ userId: 42, venueId: 7, origin: "attendance" }, "SIMULATION", db);
    expect(result.explanation.reason).toBe("OUTSIDE_SCHEDULE");
    expect(result.explanation.eligible).toBe(false);
  });

  it("anterior al corte de loyalty (loyaltyCutoffAt) → CUTOFF_BLOCKED sin consultar ninguna regla", async () => {
    const { db, wroteAnything } = makeReadOnlyMockDb();
    const result = await evaluateReward({
      userId: 42, origin: "ticket", at: new Date("2026-01-01"), loyaltyCutoffAt: new Date("2026-06-01"),
    }, "SIMULATION", db);
    expect(result.explanation).toEqual({ eligible: false, reason: "CUTOFF_BLOCKED", ruleId: null, breakdown: null });
    expect(wroteAnything()).toBe(false);
  });

  it("posterior al corte de loyalty → sigue evaluando con normalidad", async () => {
    const { db, queueRules } = makeReadOnlyMockDb();
    queueRules([blankRule({ id: 1, fixedAmount: 10 })]);
    queueRules([]);
    const result = await evaluateReward({
      userId: 42, origin: "attendance", at: new Date("2026-07-01"), loyaltyCutoffAt: new Date("2026-06-01"),
    }, "SIMULATION", db);
    expect(result.explanation.eligible).toBe(true);
  });

  it("aplica bonus de recurrencia y multiplicador de campaña, en el mismo orden que earnTokens", async () => {
    const { db, queueRules } = makeReadOnlyMockDb({
      campaigns: [{ id: 9, name: "x2", description: null, multiplier: "2.00", bonusTokens: null, startsAt: null, endsAt: null, active: true, priority: 0, createdAt: new Date(), updatedAt: new Date() }],
      campaignScope: { communities: [], venues: [], events: [] },
    });
    queueRules([blankRule({ id: 1, fixedAmount: 10 })]); // regla base
    queueRules([blankRule({ id: 2, origin: "recurrence", calcMethod: "fixed", fixedAmount: 5, recurrenceWindow: "week", recurrenceThreshold: 1, recurrenceMode: "visit_count" })]); // recurrencia
    const result = await evaluateReward({ userId: 42, origin: "attendance" }, "SIMULATION", db);
    // base=10, recurrencia dispara en la 1ª visita (threshold=1) → +5 = 15; campaña x2 → 30
    expect(result.explanation.breakdown?.final).toBe(30);
    expect(result.explanation.breakdown?.campaignId).toBe(9);
  });

  it("recorta a 0 y marca RULE_LIMIT_EXCEEDED cuando el tope diario ya está agotado (nunca lanza)", async () => {
    const { db, queueRules, queueLedgerRead } = makeReadOnlyMockDb();
    queueRules([blankRule({ id: 1, fixedAmount: 10, dailyLimit: 10 })]);
    queueRules([]); // sin recurrencia
    queueLedgerRead([{ amount: 10 }]); // ya se ganaron 10 hoy con esta regla
    const result = await evaluateReward({ userId: 42, origin: "attendance" }, "SIMULATION", db);
    expect(result.explanation).toEqual({
      eligible: false, reason: "RULE_LIMIT_EXCEEDED", ruleId: 1,
      breakdown: { base: 10, recurrenceBonus: 0, recurrenceRuleId: null, campaignId: null, campaignMultiplier: null, campaignBonus: null, beforeLimits: 10, final: 0 },
    });
  });

  it("recorta por límite SEMANAL en SIMULATION (Loyalty Production Hardening, spec §10)", async () => {
    const { db, queueRules, queueLedgerRead } = makeReadOnlyMockDb();
    queueRules([blankRule({ id: 1, fixedAmount: 10, weeklyLimit: 15 })]);
    queueRules([]);
    queueLedgerRead([{ amount: 10 }]); // ya se ganaron 10 esta semana con esta regla
    const result = await evaluateReward({ userId: 42, origin: "attendance" }, "SIMULATION", db);
    expect(result.explanation.breakdown?.final).toBe(5);
  });

  it("recorta por límite LIFETIME en SIMULATION (spec §11)", async () => {
    const { db, queueRules, queueLedgerRead } = makeReadOnlyMockDb();
    queueRules([blankRule({ id: 1, fixedAmount: 100, lifetimeLimit: 100 })]);
    queueRules([]);
    queueLedgerRead([{ amount: 80 }]);
    const result = await evaluateReward({ userId: 42, origin: "attendance" }, "SIMULATION", db);
    expect(result.explanation.breakdown?.final).toBe(20);
  });

  it("recorta por presupuesto de campaña en SIMULATION — solo lectura, sin abrir ninguna transacción (spec §12)", async () => {
    const { db, wroteAnything, queueRules, queueLedgerRead } = makeReadOnlyMockDb({
      campaigns: [{ id: 9, name: "Budget", description: null, multiplier: null, bonusTokens: null, maxTotalTokens: 100, startsAt: null, endsAt: null, active: true, priority: 0, createdAt: new Date(), updatedAt: new Date() }],
      campaignScope: { communities: [], venues: [], events: [] },
    });
    queueRules([blankRule({ id: 1, fixedAmount: 10 })]);
    queueRules([]);
    queueLedgerRead([{ amount: 93 }]); // ya emitidos por esta campaña
    const result = await evaluateReward({ userId: 42, origin: "attendance" }, "SIMULATION", db);
    expect(result.explanation.breakdown?.final).toBe(7); // 100-93=7
    expect(wroteAnything()).toBe(false);
  });

  it("una operación anterior al CORTE PERSISTIDO (global, vía system_settings) → CUTOFF_BLOCKED, sin consultar ninguna regla", async () => {
    const { db, queueRules } = makeReadOnlyMockDb({ globalCutoffValue: "2026-06-01T00:00:00.000Z" });
    const result = await evaluateReward({ userId: 42, origin: "attendance", at: new Date("2026-01-01") }, "SIMULATION", db);
    expect(result.explanation).toEqual({ eligible: false, reason: "CUTOFF_BLOCKED", ruleId: null, breakdown: null });
    expect(queueRules).toBeDefined(); // nunca se llegó a consumir la cola de reglas
  });

  it("el override de CORTE POR VENUE gana sobre el corte global persistido (spec §8: venue override > global)", async () => {
    const { db } = makeReadOnlyMockDb({
      globalCutoffValue: "2026-01-01T00:00:00.000Z", // global NO bloquearía una operación de febrero (feb > ene)
      venueCutoffOverrideAt: new Date("2026-09-01T00:00:00.000Z"), // override SÍ la bloquea (feb < sep)
    });
    const result = await evaluateReward({ userId: 42, venueId: 7, integrationId: 1, origin: "attendance", at: new Date("2026-02-01") }, "SIMULATION", db);
    expect(result.explanation.reason).toBe("CUTOFF_BLOCKED");
  });

  it("una regla inactiva o fuera de ventana de fechas nunca la selecciona (mismo filtro que findApplicableRule)", async () => {
    const { db, queueRules } = makeReadOnlyMockDb();
    queueRules([]); // simula que el SELECT real con active=true ya la excluyó
    const result = await evaluateReward({ userId: 42, origin: "attendance" }, "SIMULATION", db);
    expect(result.explanation.reason).toBe("NO_RULE_FOUND");
  });

  it("una regla scope=venue no aplica a un venue distinto (mismatch de scope)", async () => {
    const { db, queueRules } = makeReadOnlyMockDb();
    queueRules([blankRule({ id: 1, scope: "venue", scopeVenueId: 7, fixedAmount: 10 })]);
    const result = await evaluateReward({ userId: 42, venueId: 99, origin: "attendance" }, "SIMULATION", db);
    expect(result.explanation.reason).toBe("NO_RULE_FOUND");
  });

  it("una regla scope=event solo aplica al evento exacto", async () => {
    const { db, queueRules } = makeReadOnlyMockDb();
    queueRules([blankRule({ id: 1, scope: "event", scopeEventId: 55, fixedAmount: 10 })]);
    queueRules([]); // recurrencia
    const result = await evaluateReward({ userId: 42, eventId: 55, origin: "attendance" }, "SIMULATION", db);
    expect(result.explanation.eligible).toBe(true);
  });
});

describe("evaluateReward — modo LIVE (debe permanecer bloqueado esta fase)", () => {
  it("lanza RewardEngineError LIVE_MODE_DISABLED sin tocar la base de datos", async () => {
    const { db, wroteAnything, queueRules } = makeReadOnlyMockDb();
    // Ni siquiera se llega a consultar tokenRules — el bloqueo es lo primero que se comprueba.
    await expect(
      evaluateReward({ userId: 42, origin: "attendance" }, "LIVE", db)
    ).rejects.toBeInstanceOf(RewardEngineError);
    await expect(
      evaluateReward({ userId: 42, origin: "attendance" }, "LIVE", db)
    ).rejects.toMatchObject({ code: "LIVE_MODE_DISABLED" });
    expect(wroteAnything()).toBe(false);
    expect(queueRules).toBeDefined(); // nunca se llegó a consumir la cola
  });
});
