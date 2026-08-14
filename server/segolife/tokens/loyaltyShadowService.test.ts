/**
 * loyaltyShadowService.test.ts — SEGOLIFE LOYALTY SHADOW MODE (spec §46).
 *
 * PRINCIPIO ABSOLUTO bajo prueba: SHADOW CALCULATES, SHADOW NEVER EXECUTES.
 * El fake db de abajo NUNCA implementa insert/update para ninguna tabla real
 * de negocio (token_ledger/token_wallets/user_benefits/event_attendance/
 * ticket_orders) — si el código bajo prueba intentara escribir en cualquiera
 * de ellas, el test fallaría con un error explícito, no silenciosamente.
 *
 * ONE REWARD ENGINE: se usa el evaluateReward() REAL (no mockeado) — mismo
 * criterio que rewardEngine.test.ts, mismo patrón de colas FIFO para
 * tokenRules (aquí se consume DOS veces por evaluación: una vez por el
 * propio loyaltyShadowService.ts, antes de invocar evaluateReward, y otra
 * dentro de evaluateReward — ver comentario en evaluateGrantTrigger).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  tokenRules, tokenCampaigns, campaignCommunities, campaignVenues, campaignEvents,
  venueTokenSchedules, venueIntegrations, systemSettings,
  loyaltyShadowEvaluations, loyaltyShadowErrors,
} from "../../../drizzle/schema";

const { mockGetFeatureFlag } = vi.hoisted(() => ({ mockGetFeatureFlag: vi.fn() }));
vi.mock("../../config", () => ({ getFeatureFlag: (...args: unknown[]) => mockGetFeatureFlag(...args) }));

import { observeShadow, getShadowKpis, getShadowFeed, getShadowAggregates, getShadowHealth } from "./loyaltyShadowService";

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

function shadowRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, provider: "fourvenues_integrations", externalOperationId: "order-1", trigger: "EVENT_PURCHASE",
    operationState: "paid", userId: 42, venueId: 1, eventId: 10, communityId: null,
    ruleId: 1, rulePolicyVersion: new Date("2026-01-01"), campaignId: null, campaignPolicyVersion: null,
    eligible: true, decision: "GRANTED", denialReason: null,
    baseTokens: 10, recurrenceTokens: 0, campaignTokens: null, capApplied: false, finalTokens: 10,
    isReversal: false, originalShadowEvaluationId: null, evaluatedAt: new Date("2026-08-14T10:00:00Z"),
    ...overrides,
  };
}

/** Mismo patrón que rewardEngine.test.ts, ampliado con loyalty_shadow_evaluations/errors (insert + select). */
function makeFakeDb(opts: {
  rulesQueue?: Array<Array<Record<string, unknown>>>;
  campaigns?: Array<Record<string, unknown>>;
  campaignScope?: { communities?: unknown[]; venues?: unknown[]; events?: unknown[] };
  shadowRows?: Array<Record<string, unknown>>;
  failShadowInsert?: boolean;
} = {}) {
  const rulesQueue = opts.rulesQueue ? opts.rulesQueue.map(r => [...r]) : [];
  const shadowRows: Array<Record<string, unknown>> = opts.shadowRows ? [...opts.shadowRows] : [];
  const errorRows: Array<Record<string, unknown>> = [];
  let nextId = 1000;
  const inserted: Array<{ table: string; values: Record<string, unknown> }> = [];

  function makeQueryFor(table: unknown) {
    const q: Record<string, unknown> = {};
    q.where = () => q;
    q.limit = () => q;
    q.orderBy = () => q;
    q.then = (resolve: (v: unknown) => void) => {
      if (table === tokenRules) return resolve(rulesQueue.shift() ?? []);
      if (table === tokenCampaigns) return resolve(opts.campaigns ?? []);
      if (table === campaignCommunities) return resolve(opts.campaignScope?.communities ?? []);
      if (table === campaignVenues) return resolve(opts.campaignScope?.venues ?? []);
      if (table === campaignEvents) return resolve(opts.campaignScope?.events ?? []);
      if (table === venueTokenSchedules) return resolve([]);
      if (table === venueIntegrations) return resolve([]);
      if (table === systemSettings) return resolve([]);
      if (table === loyaltyShadowEvaluations) return resolve(shadowRows);
      if (table === loyaltyShadowErrors) return resolve(errorRows);
      return resolve([]);
    };
    return q;
  }

  const db = {
    select: () => ({ from: (t: unknown) => makeQueryFor(t) }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if (table === loyaltyShadowEvaluations) {
          if (opts.failShadowInsert) throw new Error("DB caída (simulado)");
          const dup = shadowRows.find(r => r.provider === vals.provider && r.externalOperationId === vals.externalOperationId && r.trigger === vals.trigger);
          if (dup) { const e = new Error("Duplicate entry") as Error & { errno: number }; e.errno = 1062; throw e; }
          const row = { id: nextId++, ...vals };
          shadowRows.push(row);
          inserted.push({ table: "loyalty_shadow_evaluations", values: row });
          return Promise.resolve([{ insertId: row.id }]);
        }
        if (table === loyaltyShadowErrors) {
          const row = { id: nextId++, ...vals };
          errorRows.push(row);
          inserted.push({ table: "loyalty_shadow_errors", values: row });
          return Promise.resolve([{ insertId: row.id }]);
        }
        throw new Error(`INSERT no permitido en esta tabla — SHADOW NUNCA debe escribir aquí (tabla desconocida en el fake, probablemente de negocio real)`);
      },
    }),
    // Cualquier UPDATE representa una escritura de negocio real — SIEMPRE debe fallar el test.
    update: () => { throw new Error("SHADOW NUNCA debe llamar a update() — violación del principio SHADOW NEVER EXECUTES"); },
    transaction: () => { throw new Error("SHADOW NUNCA debe abrir una transacción — violación del principio SHADOW NEVER EXECUTES"); },
  };

  return { db: db as never, shadowRows, errorRows, inserted };
}

beforeEach(() => {
  mockGetFeatureFlag.mockReset();
  mockGetFeatureFlag.mockResolvedValue(true); // Shadow ON por defecto en los tests — el caso OFF se prueba explícitamente
});

describe("observeShadow — kill switch independiente (spec §50)", () => {
  it("Shadow OFF -> no-op inmediato, ni siquiera toca la BD", async () => {
    mockGetFeatureFlag.mockResolvedValue(false);
    const { db, inserted } = makeFakeDb();
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "x", trigger: "EVENT_ATTENDANCE", userId: 42, origin: "attendance", occurredAt: new Date() }, db);
    expect(inserted).toEqual([]);
  });
});

describe("observeShadow — identity gate (spec §2/§33): NUNCA trata una identidad histórica como Student", () => {
  it("userId=null -> NO_STUDENT, nunca llama a evaluateReward (sin consumir la cola de reglas)", async () => {
    const { db, shadowRows } = makeFakeDb({ rulesQueue: [] });
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "attn-1", trigger: "EVENT_ATTENDANCE", userId: null, venueId: 1, eventId: 10, origin: "attendance", occurredAt: new Date() }, db);
    expect(shadowRows).toHaveLength(1);
    expect(shadowRows[0]).toMatchObject({ userId: null, decision: "DENIED", denialReason: "NO_STUDENT", eligible: false, finalTokens: null });
  });

  it("purchase con identidad histórica -> NO_STUDENT también", async () => {
    const { db, shadowRows } = makeFakeDb();
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "order-9", trigger: "EVENT_PURCHASE", userId: null, venueId: 1, eventId: 10, origin: "ticket", occurredAt: new Date() }, db);
    expect(shadowRows[0].denialReason).toBe("NO_STUDENT");
  });
});

describe("observeShadow — SHADOW NUNCA ESCRIBE (spec §1) en ninguna tabla de negocio real", () => {
  it("una evaluación GRANTED nunca llama a insert/update/transaction salvo en loyalty_shadow_evaluations", async () => {
    // 3 consumos de tokenRules por evaluación GRANTED: findApplicableRule propio (acumulación de topes) + findApplicableRule interno de evaluateReward + applyRecurrenceBonus.
    const { db, shadowRows } = makeFakeDb({ rulesQueue: [[blankRule({ id: 1, origin: "attendance", fixedAmount: 15 })], [blankRule({ id: 1, origin: "attendance", fixedAmount: 15 })], []] });
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "attn-2", trigger: "EVENT_ATTENDANCE", userId: 42, venueId: 1, eventId: 10, origin: "attendance", occurredAt: new Date() }, db);
    expect(shadowRows).toHaveLength(1);
    expect(shadowRows[0]).toMatchObject({ decision: "GRANTED", eligible: true, finalTokens: 15, ruleId: 1 });
    // Si el motor hubiera intentado escribir en token_ledger/token_wallets/etc., el fake db.update()/transaction() habría lanzado — el test ya habría fallado antes de esta línea.
  });
});

describe("observeShadow — EVENT_ATTENDANCE (spec §6)", () => {
  it("Student conocido, regla activa -> GRANTED con desglose completo", async () => {
    const { db, shadowRows } = makeFakeDb({ rulesQueue: [[blankRule({ id: 1, fixedAmount: 15 })], [blankRule({ id: 1, fixedAmount: 15 })], []] });
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "attn-3", trigger: "EVENT_ATTENDANCE", userId: 7, venueId: 1, eventId: 10, origin: "attendance", occurredAt: new Date("2026-08-14T20:00:00Z") }, db);
    expect(shadowRows[0]).toMatchObject({ userId: 7, decision: "GRANTED", finalTokens: 15, baseTokens: 15 });
  });

  it("sin regla activa (origin=ticket hoy en producción) -> DENIED NO_RULE_FOUND", async () => {
    const { db, shadowRows } = makeFakeDb({ rulesQueue: [[]] });
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "order-5", trigger: "EVENT_PURCHASE", userId: 7, venueId: 1, eventId: 10, origin: "ticket", occurredAt: new Date() }, db);
    expect(shadowRows[0]).toMatchObject({ decision: "DENIED", denialReason: "NO_RULE_FOUND", finalTokens: null });
  });
});

describe("observeShadow — topes acumulados ENTRE observaciones Shadow (spec §34, nunca vía token_ledger real)", () => {
  it("una observación GRANTED previa de la MISMA regla consume el tope diario en la siguiente", async () => {
    const priorGrant = shadowRow({ id: 1, externalOperationId: "attn-a", userId: 42, ruleId: 1, decision: "GRANTED", finalTokens: 8, evaluatedAt: new Date() });
    const { db, shadowRows } = makeFakeDb({
      shadowRows: [priorGrant],
      rulesQueue: [[blankRule({ id: 1, fixedAmount: 10, dailyLimit: 10 })], [blankRule({ id: 1, fixedAmount: 10, dailyLimit: 10 })], []],
    });
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "attn-b", trigger: "EVENT_ATTENDANCE", userId: 42, venueId: 1, eventId: 11, origin: "attendance", occurredAt: new Date() }, db);
    const newRow = shadowRows.find(r => r.externalOperationId === "attn-b");
    // tope diario=10, ya consumidos 8 por la observación previa -> como mucho 2 más (base pedía 10)
    expect(newRow).toMatchObject({ decision: "GRANTED", finalTokens: 2, capApplied: true });
  });

  it("una SIMULATED_REVERSAL previa libera el tope de nuevo (spec: refund deja de 'ocupar')", async () => {
    const priorGrant = shadowRow({ id: 1, externalOperationId: "attn-a", userId: 42, ruleId: 1, decision: "GRANTED", finalTokens: 10, evaluatedAt: new Date() });
    const priorReversal = shadowRow({ id: 2, externalOperationId: "attn-a", trigger: "EVENT_REFUND", userId: 42, ruleId: 1, decision: "SIMULATED_REVERSAL", finalTokens: 10, isReversal: true, evaluatedAt: new Date() });
    const { db, shadowRows } = makeFakeDb({
      shadowRows: [priorGrant, priorReversal],
      rulesQueue: [[blankRule({ id: 1, fixedAmount: 10, dailyLimit: 10 })], [blankRule({ id: 1, fixedAmount: 10, dailyLimit: 10 })], []],
    });
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "attn-c", trigger: "EVENT_ATTENDANCE", userId: 42, venueId: 1, eventId: 12, origin: "attendance", occurredAt: new Date() }, db);
    const newRow = shadowRows.find(r => r.externalOperationId === "attn-c");
    expect(newRow).toMatchObject({ decision: "GRANTED", finalTokens: 10, capApplied: false }); // tope libre de nuevo
  });
});

describe("observeShadow — presupuesto de campaña acumulado entre observaciones Shadow (spec §35)", () => {
  it("emisiones Shadow previas de la MISMA campaña recortan el remanente simulado", async () => {
    const priorGrant = shadowRow({ id: 1, externalOperationId: "attn-x", userId: 1, ruleId: 1, campaignId: 9, decision: "GRANTED", finalTokens: 90, evaluatedAt: new Date() });
    const { db, shadowRows } = makeFakeDb({
      shadowRows: [priorGrant],
      rulesQueue: [[blankRule({ id: 1, fixedAmount: 10 })], [blankRule({ id: 1, fixedAmount: 10 })], []],
      campaigns: [{ id: 9, name: "Budget", description: null, multiplier: null, bonusTokens: null, maxTotalTokens: 100, startsAt: null, endsAt: null, active: true, priority: 0, createdAt: new Date(), updatedAt: new Date() }],
      campaignScope: { communities: [], venues: [], events: [] },
    });
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "attn-y", trigger: "EVENT_ATTENDANCE", userId: 42, venueId: 1, eventId: 10, origin: "attendance", occurredAt: new Date() }, db);
    const newRow = shadowRows.find(r => r.externalOperationId === "attn-y");
    expect(newRow).toMatchObject({ decision: "GRANTED", finalTokens: 10, campaignId: 9 }); // 100-90=10 restante, exactamente el base pedido
  });
});

describe("observeShadow — REFUND / CANCEL (spec §7-8)", () => {
  it("refund sobre una operación previamente GRANTED -> SIMULATED_REVERSAL con el mismo importe", async () => {
    const originalGrant = shadowRow({ id: 1, externalOperationId: "order-1", trigger: "EVENT_PURCHASE", userId: 42, ruleId: 1, decision: "GRANTED", finalTokens: 25, evaluatedAt: new Date("2026-08-01T10:00:00Z") });
    const { db, shadowRows } = makeFakeDb({ shadowRows: [originalGrant] });
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "order-1", trigger: "EVENT_REFUND", userId: 42, origin: "ticket", occurredAt: new Date("2026-08-02T10:00:00Z") }, db);
    const reversalRow = shadowRows.find(r => r.trigger === "EVENT_REFUND");
    expect(reversalRow).toMatchObject({ decision: "SIMULATED_REVERSAL", isReversal: true, finalTokens: 25, originalShadowEvaluationId: 1 });
  });

  it("refund sin ninguna concesión previa observada -> DENIED NOTHING_TO_REVERSE, nunca inventa una reversión", async () => {
    const { db, shadowRows } = makeFakeDb({ shadowRows: [] });
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "order-99", trigger: "EVENT_REFUND", userId: 42, origin: "ticket", occurredAt: new Date() }, db);
    expect(shadowRows[0]).toMatchObject({ decision: "DENIED", denialReason: "NOTHING_TO_REVERSE", isReversal: false });
  });

  it("cancel sigue exactamente el mismo criterio que refund", async () => {
    const originalGrant = shadowRow({ id: 1, externalOperationId: "order-2", trigger: "PENDING_TO_PAID", userId: 42, ruleId: 1, decision: "GRANTED", finalTokens: 12 });
    const { db, shadowRows } = makeFakeDb({ shadowRows: [originalGrant] });
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "order-2", trigger: "EVENT_CANCEL", userId: 42, origin: "ticket", occurredAt: new Date() }, db);
    const row = shadowRows.find(r => r.trigger === "EVENT_CANCEL");
    expect(row).toMatchObject({ decision: "SIMULATED_REVERSAL", finalTokens: 12, originalShadowEvaluationId: 1 });
  });

  it("una denegación previa (DENIED) nunca genera una reversión — solo lo GRANTED es reversible", async () => {
    const priorDenied = shadowRow({ id: 1, externalOperationId: "order-3", trigger: "EVENT_PURCHASE", decision: "DENIED", denialReason: "NO_RULE_FOUND", finalTokens: null });
    const { db, shadowRows } = makeFakeDb({ shadowRows: [priorDenied] });
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "order-3", trigger: "EVENT_REFUND", userId: 42, origin: "ticket", occurredAt: new Date() }, db);
    const row = shadowRows.find(r => r.trigger === "EVENT_REFUND");
    expect(row?.decision).toBe("DENIED");
    expect(row?.denialReason).toBe("NOTHING_TO_REVERSE");
  });
});

describe("observeShadow — IDEMPOTENCIA (spec §10): mismo (provider, externalOperationId, trigger) nunca duplica", () => {
  it("dos observaciones EVENT_ATTENDANCE de la MISMA operación -> una sola fila (skip silencioso, nunca lanza)", async () => {
    const { db, shadowRows } = makeFakeDb({ rulesQueue: [[blankRule({ id: 1, fixedAmount: 10 })], [blankRule({ id: 1, fixedAmount: 10 })], []] });
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "attn-dup", trigger: "EVENT_ATTENDANCE", userId: 42, venueId: 1, eventId: 10, origin: "attendance", occurredAt: new Date() }, db);
    // Simula un segundo tick del scheduler viendo la MISMA operación — SÍ recalcula
    // (la cola de reglas ya está vacía, calculará NO_RULE_FOUND esta vez), pero la
    // idempotencia se decide por (provider, externalOperationId, trigger) al
    // persistir, no por el contenido calculado — sigue sin duplicar.
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "attn-dup", trigger: "EVENT_ATTENDANCE", userId: 42, venueId: 1, eventId: 10, origin: "attendance", occurredAt: new Date() }, db);
    expect(shadowRows).toHaveLength(1);
  });

  it("un cambio de estado real (paid -> refunded) SÍ genera una fila nueva (trigger distinto)", async () => {
    const { db, shadowRows } = makeFakeDb({ rulesQueue: [[blankRule({ id: 1, fixedAmount: 10 })], [blankRule({ id: 1, fixedAmount: 10 })], []] });
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "order-7", trigger: "EVENT_PURCHASE", userId: 42, venueId: 1, eventId: 10, origin: "ticket", occurredAt: new Date() }, db);
    await observeShadow({ provider: "fourvenues_integrations", externalOperationId: "order-7", trigger: "EVENT_REFUND", userId: 42, origin: "ticket", occurredAt: new Date() }, db);
    expect(shadowRows).toHaveLength(2);
    expect(shadowRows.map(r => r.trigger).sort()).toEqual(["EVENT_PURCHASE", "EVENT_REFUND"]);
  });
});

describe("observeShadow — FAILURE ISOLATION (spec §29/§42): NUNCA lanza, registra el error", () => {
  it("un fallo de persistencia se captura, se registra en loyalty_shadow_errors, y observeShadow no lanza", async () => {
    const { db, errorRows } = makeFakeDb({ rulesQueue: [[blankRule({ id: 1, fixedAmount: 10 })], [blankRule({ id: 1, fixedAmount: 10 })], []], failShadowInsert: true });
    await expect(observeShadow({ provider: "fourvenues_integrations", externalOperationId: "attn-fail", trigger: "EVENT_ATTENDANCE", userId: 42, venueId: 1, eventId: 10, origin: "attendance", occurredAt: new Date() }, db)).resolves.toBeUndefined();
    expect(errorRows).toHaveLength(1);
    expect(errorRows[0]).toMatchObject({ provider: "fourvenues_integrations", externalOperationId: "attn-fail", trigger: "EVENT_ATTENDANCE" });
  });

  it("incluso si getFeatureFlag lanza, observeShadow nunca propaga la excepción", async () => {
    mockGetFeatureFlag.mockRejectedValue(new Error("config caída"));
    const { db } = makeFakeDb();
    await expect(observeShadow({ provider: "fourvenues_integrations", externalOperationId: "x", trigger: "EVENT_ATTENDANCE", userId: 42, origin: "attendance", occurredAt: new Date() }, db)).resolves.toBeUndefined();
  });
});

describe("getShadowKpis — lectura para el admin UI (spec §19)", () => {
  it("separa Known Students de Unresolved Identities, nunca los mezcla", async () => {
    const { db } = makeFakeDb({
      shadowRows: [
        shadowRow({ id: 1, userId: 42, decision: "GRANTED", finalTokens: 10 }),
        shadowRow({ id: 2, userId: null, decision: "DENIED", denialReason: "NO_STUDENT", finalTokens: null }),
        shadowRow({ id: 3, userId: 42, decision: "DENIED", denialReason: "NO_RULE_FOUND", finalTokens: null }),
      ],
    });
    const kpis = await getShadowKpis({ communityIds: "all", from: new Date("2026-01-01"), to: new Date("2026-12-31") }, db);
    expect(kpis.operationsObserved).toBe(3);
    expect(kpis.knownStudents).toBe(1); // userId 42 cuenta una vez, nunca por fila
    expect(kpis.unresolvedIdentities).toBe(1);
    expect(kpis.eligibleRewards).toBe(1);
    expect(kpis.deniedRewards).toBe(2);
    expect(kpis.simulatedTokens).toBe(10);
  });

  it("simulatedTokens resta las reversiones simuladas del total concedido", async () => {
    const { db } = makeFakeDb({
      shadowRows: [
        shadowRow({ id: 1, userId: 42, decision: "GRANTED", finalTokens: 30 }),
        shadowRow({ id: 2, userId: 42, decision: "SIMULATED_REVERSAL", isReversal: true, finalTokens: 30 }),
      ],
    });
    const kpis = await getShadowKpis({ communityIds: "all", from: new Date("2026-01-01"), to: new Date("2026-12-31") }, db);
    expect(kpis.simulatedTokens).toBe(0);
    expect(kpis.simulatedReversals).toBe(1);
  });
});

describe("getShadowFeed / getShadowAggregates / getShadowHealth — no lanzan sin datos", () => {
  it("getShadowFeed vacío -> items:[], total:0", async () => {
    const { db } = makeFakeDb({ shadowRows: [] });
    const result = await getShadowFeed({ communityIds: "all", from: new Date("2026-01-01"), to: new Date("2026-12-31") }, 25, 0, db);
    expect(result).toEqual({ items: [], total: 0 });
  });

  it("getShadowAggregates vacío -> arrays vacíos, nunca lanza", async () => {
    const { db } = makeFakeDb({ shadowRows: [] });
    const result = await getShadowAggregates({ communityIds: "all", from: new Date("2026-01-01"), to: new Date("2026-12-31") }, db);
    expect(result).toEqual({ byVenue: [], byTrigger: [], byRule: [], byDenialReason: [] });
  });

  it("getShadowHealth refleja enabled real y 0 errores cuando no hay ninguno", async () => {
    const { db } = makeFakeDb({ shadowRows: [] });
    const health = await getShadowHealth(db);
    expect(health.enabled).toBe(true); // mockGetFeatureFlag por defecto resuelve true en este archivo
    expect(health.errorCountLast24h).toBe(0);
  });
});
