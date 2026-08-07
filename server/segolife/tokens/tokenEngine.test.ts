/**
 * tokenEngine.test.ts — orquestador earn/spend (Fase 2), integrando
 * schedule + regla + recurrencia + campaña + límites + ledger atómico. Las
 * piezas individuales ya están cubiertas en sus propios *.test.ts — aquí se
 * prueba la COMPOSICIÓN (orden de aplicación) con mocks mínimos por escenario.
 *
 * tokenRules se consulta 2 veces por earnTokens (regla base, luego
 * recurrencia) y 1 vez por spendTokens (solo regla) — como no se puede
 * inspeccionar la condición real de `.where()`, cada test declara en orden
 * (FIFO) qué debe devolver cada SELECT, mismo patrón que
 * tokenLedgerService.test.ts (queuePreInsertSelect).
 */
import { describe, it, expect } from "vitest";
import { earnTokens, spendTokens } from "./tokenEngine";
import { TokenEngineError } from "./tokenLedgerService";
import {
  tokenRules, tokenLedger, tokenWallets, tokenCampaigns,
  campaignCommunities, campaignVenues, campaignEvents, venueTokenSchedules,
} from "../../../drizzle/schema";

function blankRule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "Regla", description: null, direction: "earn", origin: "attendance",
    scope: "global", scopeCommunityId: null, scopeVenueId: null, scopeEventId: null, scopeProductId: null,
    calcMethod: "fixed", fixedAmount: 10, rate: null, multiplier: null, minSpend: null,
    maxTokens: null, dailyLimit: null, monthlyLimit: null,
    recurrenceWindow: null, recurrenceThreshold: null, recurrenceMode: null,
    startsAt: null, endsAt: null, active: true, priority: 0,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function blankWallet(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, userId: 42, balance: 0, lifetimeEarned: 0, lifetimeSpent: 0,
    status: "active" as const, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

/** Mock combinado: schedules/campañas estáticos por test, tokenRules/tokenLedger (lecturas) por cola FIFO, wallet+ledger (escritura atómica) con estado real. */
function makeEngineMockDb(opts: {
  wallet?: Record<string, unknown>;
  schedules?: Array<Record<string, unknown>>;
  campaigns?: Array<Record<string, unknown>>;
  campaignScope?: { communities?: unknown[]; venues?: unknown[]; events?: unknown[] };
} = {}) {
  let wallet: Record<string, unknown> = opts.wallet ?? blankWallet();
  const ledgerWrites: Array<Record<string, unknown>> = [];
  let nextLedgerId = 1;
  const rulesQueue: Array<Array<Record<string, unknown>>> = [];
  const ledgerReadQueue: Array<Array<Record<string, unknown>>> = [];

  function makeReadQueryFor(table: unknown) {
    const q: Record<string, unknown> = {};
    q.where = () => q;
    q.limit = () => q;
    q.orderBy = () => q;
    q.then = (resolve: (v: unknown) => void) => {
      if (table === venueTokenSchedules) return resolve(opts.schedules ?? []);
      if (table === tokenRules) return resolve(rulesQueue.shift() ?? []);
      if (table === tokenLedger) return resolve(ledgerReadQueue.shift() ?? []);
      if (table === tokenCampaigns) return resolve(opts.campaigns ?? []);
      if (table === campaignCommunities) return resolve(opts.campaignScope?.communities ?? []);
      if (table === campaignVenues) return resolve(opts.campaignScope?.venues ?? []);
      if (table === campaignEvents) return resolve(opts.campaignScope?.events ?? []);
      return resolve([]);
    };
    return q;
  }

  const root: Record<string, unknown> = {
    select: () => ({ from: (t: unknown) => makeReadQueryFor(t) }),
  };

  root.transaction = (cb: (tx: unknown) => Promise<unknown>) => {
    let table: unknown = null;
    let hasInserted = false;
    let insertedLedgerRow: Record<string, unknown> | null = null;
    const tx: Record<string, unknown> = {};
    tx.select = () => tx;
    tx.from = (t: unknown) => { table = t; return tx; };
    tx.where = () => tx;
    tx.limit = () => tx;
    tx.for = () => tx;
    tx.insert = (t: unknown) => { table = t; return tx; };
    tx.update = (t: unknown) => { table = t; return tx; };
    tx.set = (fields: Record<string, unknown>) => { if (table === tokenWallets) wallet = { ...wallet, ...fields }; return tx; };
    tx.values = (v: Record<string, unknown>) => {
      if (table === tokenWallets) { wallet = { id: 1, ...v }; return Promise.resolve([{ insertId: 1 }]); }
      const row = { id: nextLedgerId++, ...v };
      ledgerWrites.push(row);
      insertedLedgerRow = row;
      hasInserted = true;
      return Promise.resolve([{ insertId: row.id }]);
    };
    tx.then = (resolve: (v: unknown) => void) => {
      if (table === tokenWallets) return resolve(wallet ? [wallet] : []);
      if (table === tokenLedger) return resolve(hasInserted && insertedLedgerRow ? [insertedLedgerRow] : []);
      return resolve([]);
    };
    return cb(tx);
  };

  return {
    db: root as unknown as Parameters<typeof earnTokens>[1],
    getWallet: () => wallet,
    getLedgerWrites: () => ledgerWrites,
    queueRules: (rows: Array<Record<string, unknown>>) => rulesQueue.push(rows),
    queueLedgerRead: (rows: Array<Record<string, unknown>>) => ledgerReadQueue.push(rows),
  };
}

describe("tokenEngine — earnTokens (orden de aplicación)", () => {
  it("camino feliz: regla fija sin recurrencia ni campaña — final = base", async () => {
    const { db, getWallet, getLedgerWrites, queueRules } = makeEngineMockDb();
    queueRules([blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 10 })]); // findApplicableRule
    queueRules([]); // applyRecurrenceBonus — sin reglas de recurrencia
    const result = await earnTokens({ userId: 42, origin: "attendance" }, db);
    expect(result.breakdown.base).toBe(10);
    expect(result.breakdown.final).toBe(10);
    expect(result.wallet.balance).toBe(10);
    expect(getWallet()?.balance).toBe(10);
    expect(getLedgerWrites()).toHaveLength(1);
  });

  it("fuera de horario del venue → OUTSIDE_SCHEDULE, sin crear ledger", async () => {
    const { db, getLedgerWrites } = makeEngineMockDb({
      schedules: [{ id: 1, venueId: 7, operationType: "earn", dayOfWeek: 99, startTime: "00:00", endTime: "00:00", active: true, timezone: "Europe/Madrid", validFrom: null, validTo: null }],
    });
    // dayOfWeek=99 nunca coincide con ningún día real → siempre fuera de horario
    await expect(
      earnTokens({ userId: 42, venueId: 7, origin: "attendance" }, db)
    ).rejects.toMatchObject({ code: "OUTSIDE_SCHEDULE" });
    expect(getLedgerWrites()).toHaveLength(0);
  });

  it("sin ninguna regla aplicable → NO_RULE_FOUND", async () => {
    const { db, queueRules } = makeEngineMockDb();
    queueRules([]); // findApplicableRule no encuentra nada
    await expect(
      earnTokens({ userId: 42, origin: "attendance" }, db)
    ).rejects.toMatchObject({ code: "NO_RULE_FOUND" });
  });

  it("aplica el bonus de recurrencia por encima del importe base", async () => {
    const { db, queueRules, queueLedgerRead } = makeEngineMockDb();
    queueRules([blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 10 })]); // regla base
    queueRules([blankRule({ id: 2, origin: "recurrence", calcMethod: "fixed", fixedAmount: 5, recurrenceWindow: "week", recurrenceThreshold: 2, recurrenceMode: "visit_count" })]); // regla de recurrencia
    queueLedgerRead([{ id: 100 }]); // 1 visita previa esta semana → esta es la 2ª
    const result = await earnTokens({ userId: 42, origin: "attendance" }, db);
    expect(result.breakdown.base).toBe(10);
    expect(result.breakdown.recurrenceBonus).toBe(5);
    expect(result.breakdown.final).toBe(15);
  });

  it("aplica multiplicador de campaña y luego bonus fijo, en ese orden", async () => {
    const { db, queueRules } = makeEngineMockDb({
      campaigns: [{ id: 1, name: "x2+5", description: null, multiplier: "2.00", bonusTokens: 5, startsAt: null, endsAt: null, active: true, priority: 0, createdAt: new Date(), updatedAt: new Date() }],
      campaignScope: { communities: [], venues: [], events: [] }, // global
    });
    queueRules([blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 10 })]);
    queueRules([]); // sin recurrencia
    const result = await earnTokens({ userId: 42, origin: "attendance" }, db);
    // base=10, recurrencia=0 → 10; campaña: 10*2=20, +5=25
    expect(result.breakdown.final).toBe(25);
    expect(result.breakdown.campaignId).toBe(1);
  });

  it("recorta (no rechaza) el importe final cuando supera el límite diario de la regla", async () => {
    const { db, queueRules, queueLedgerRead } = makeEngineMockDb();
    queueRules([blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 10, dailyLimit: 15 })]);
    queueRules([]); // sin recurrencia
    queueLedgerRead([{ amount: 10 }]); // ya se ganaron 10 hoy con esta regla → quedan 5 disponibles
    const result = await earnTokens({ userId: 42, origin: "attendance" }, db);
    expect(result.breakdown.final).toBe(5); // recortado de 10 a 5
  });

  it("RULE_LIMIT_EXCEEDED cuando el límite diario ya está agotado", async () => {
    const { db, queueRules, queueLedgerRead } = makeEngineMockDb();
    queueRules([blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 10, dailyLimit: 10 })]);
    queueRules([]);
    queueLedgerRead([{ amount: 10 }]); // ya se agotó el límite diario
    await expect(
      earnTokens({ userId: 42, origin: "attendance" }, db)
    ).rejects.toMatchObject({ code: "RULE_LIMIT_EXCEEDED" });
  });
});

describe("tokenEngine — spendTokens", () => {
  it("camino feliz: descuenta el coste de la regla del wallet", async () => {
    const { db, getWallet, queueRules } = makeEngineMockDb({ wallet: blankWallet({ balance: 100 }) });
    queueRules([blankRule({ id: 1, direction: "spend", origin: "product", calcMethod: "fixed", fixedAmount: 30 })]);
    const result = await spendTokens({ userId: 42, venueId: 7 }, db);
    expect(result.breakdown.final).toBe(30);
    expect(result.wallet.balance).toBe(70);
    expect(getWallet()?.balance).toBe(70);
  });

  it("saldo insuficiente propaga INSUFFICIENT_BALANCE desde el ledger", async () => {
    const { db, queueRules } = makeEngineMockDb({ wallet: blankWallet({ balance: 10 }) });
    queueRules([blankRule({ id: 1, direction: "spend", origin: "product", calcMethod: "fixed", fixedAmount: 30 })]);
    await expect(
      spendTokens({ userId: 42, venueId: 7 }, db)
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  it("fuera de horario de gasto del venue → OUTSIDE_SCHEDULE", async () => {
    const { db } = makeEngineMockDb({
      schedules: [{ id: 1, venueId: 7, operationType: "spend", dayOfWeek: 99, startTime: "00:00", endTime: "00:00", active: true, timezone: "Europe/Madrid", validFrom: null, validTo: null }],
    });
    await expect(
      spendTokens({ userId: 42, venueId: 7 }, db)
    ).rejects.toMatchObject({ code: "OUTSIDE_SCHEDULE" });
  });

  it("sin regla de gasto aplicable → NO_RULE_FOUND", async () => {
    const { db, queueRules } = makeEngineMockDb();
    queueRules([]);
    await expect(
      spendTokens({ userId: 42, venueId: 7 }, db)
    ).rejects.toMatchObject({ code: "NO_RULE_FOUND" });
  });

  it("RULE_LIMIT_EXCEEDED cuando ya se alcanzó el límite diario de gasto de la regla", async () => {
    const { db, queueRules, queueLedgerRead } = makeEngineMockDb({ wallet: blankWallet({ balance: 100 }) });
    queueRules([blankRule({ id: 1, direction: "spend", origin: "product", calcMethod: "fixed", fixedAmount: 30, dailyLimit: 30 })]);
    queueLedgerRead([{ amount: 30 }]); // ya se gastaron 30 hoy con esta regla
    await expect(
      spendTokens({ userId: 42, venueId: 7 }, db)
    ).rejects.toMatchObject({ code: "RULE_LIMIT_EXCEEDED" });
  });
});
