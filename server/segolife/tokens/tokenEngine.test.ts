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

/**
 * Mock combinado: schedules/campañas estáticos por test, tokenRules/tokenLedger
 * (lecturas) por cola FIFO, wallet+ledger (escritura atómica) con estado real.
 *
 * `campaignForLock` (Loyalty Production Hardening) — fila de token_campaigns
 * que devuelve el `SELECT...FOR UPDATE` DENTRO de la transacción de
 * earnWithCampaignBudgetLock (independiente de `campaigns`, que alimenta el
 * lookup de findApplicableCampaign FUERA de la transacción). El "issued" del
 * presupuesto se calcula EN VIVO sumando `ledgerWrites` reales filtradas por
 * campaignId — no una cola estática — para que un test de concurrencia real
 * (dos transacciones encadenadas, mismo patrón que makeConcurrentMockDb) vea
 * el efecto de la primera transacción al evaluar la segunda.
 */
function makeEngineMockDb(opts: {
  wallet?: Record<string, unknown>;
  schedules?: Array<Record<string, unknown>>;
  campaigns?: Array<Record<string, unknown>>;
  campaignScope?: { communities?: unknown[]; venues?: unknown[]; events?: unknown[] };
  campaignForLock?: Record<string, unknown>;
  /** Serializa las transacciones (mismo patrón que makeConcurrentMockDb) — solo necesario en tests de concurrencia real. */
  serializeTransactions?: boolean;
} = {}) {
  let wallet: Record<string, unknown> = opts.wallet ?? blankWallet();
  const ledgerWrites: Array<Record<string, unknown>> = [];
  let nextLedgerId = 1;
  const rulesQueue: Array<Array<Record<string, unknown>>> = [];
  const ledgerReadQueue: Array<Array<Record<string, unknown>>> = [];
  let lockChain: Promise<unknown> = Promise.resolve();

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

  function makeTxBuilder() {
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
      if (table === tokenCampaigns) return resolve(opts.campaignForLock ? [opts.campaignForLock] : []);
      if (table === tokenLedger) {
        if (hasInserted) return resolve(insertedLedgerRow ? [insertedLedgerRow] : []);
        // Pre-insert: consulta de "issued" del presupuesto de campaña — suma EN VIVO lo ya escrito (real, no una cola estática).
        const issuedRows = ledgerWrites
          .filter(r => r.campaignId === opts.campaignForLock?.id && r.direction === "credit")
          .map(r => ({ amount: r.amount }));
        return resolve(issuedRows);
      }
      return resolve([]);
    };
    return tx;
  }

  root.transaction = (cb: (tx: unknown) => Promise<unknown>) => {
    if (!opts.serializeTransactions) return cb(makeTxBuilder());
    const run = lockChain.then(() => cb(makeTxBuilder()));
    lockChain = run.catch(() => {});
    return run;
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

  it("recorta el importe final cuando supera el límite SEMANAL de la regla (Loyalty Production Hardening)", async () => {
    const { db, queueRules, queueLedgerRead } = makeEngineMockDb();
    queueRules([blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 10, weeklyLimit: 15 })]);
    queueRules([]); // sin recurrencia
    queueLedgerRead([{ amount: 10 }]); // ya se ganaron 10 esta semana con esta regla → quedan 5
    const result = await earnTokens({ userId: 42, origin: "attendance" }, db);
    expect(result.breakdown.final).toBe(5);
  });

  it("recorta el importe final cuando supera el límite LIFETIME de la regla (Loyalty Production Hardening, spec §11)", async () => {
    const { db, queueRules, queueLedgerRead } = makeEngineMockDb();
    queueRules([blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 100, lifetimeLimit: 100 })]);
    queueRules([]); // sin recurrencia
    queueLedgerRead([{ amount: 80 }]); // ya se ganaron 80 en toda la vida con esta regla → quedan 20
    const result = await earnTokens({ userId: 42, origin: "attendance" }, db);
    expect(result.breakdown.final).toBe(20);
  });

  it("RULE_LIMIT_EXCEEDED cuando el límite lifetime ya está agotado — nunca podrá generar más de N tokens a ese Student", async () => {
    const { db, queueRules, queueLedgerRead } = makeEngineMockDb();
    queueRules([blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 10, lifetimeLimit: 100 })]);
    queueRules([]);
    queueLedgerRead([{ amount: 100 }]); // ya agotado
    await expect(
      earnTokens({ userId: 42, origin: "attendance" }, db)
    ).rejects.toMatchObject({ code: "RULE_LIMIT_EXCEEDED" });
  });

  it("aplica daily/weekly/monthly/lifetime en cascada — el más restrictivo gana", async () => {
    const { db, queueRules, queueLedgerRead } = makeEngineMockDb();
    queueRules([blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 50, dailyLimit: 40, weeklyLimit: 30, monthlyLimit: 100, lifetimeLimit: 200 })]);
    queueRules([]);
    queueLedgerRead([{ amount: 5 }]);  // daily: 40-5=35 disponible
    queueLedgerRead([{ amount: 15 }]); // weekly: 30-15=15 disponible ← el más restrictivo
    queueLedgerRead([{ amount: 0 }]);  // monthly: 100-0=100 disponible
    queueLedgerRead([{ amount: 0 }]);  // lifetime: 200-0=200 disponible
    const result = await earnTokens({ userId: 42, origin: "attendance" }, db);
    expect(result.breakdown.final).toBe(15); // min(50, 35, 15, 100, 200)
  });
});

describe("tokenEngine — presupuesto de campaña con lock real (Loyalty Production Hardening, spec §12)", () => {
  function blankCampaign(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 1, name: "Campaña con presupuesto", description: null, multiplier: null, bonusTokens: null,
      maxTotalTokens: 100, startsAt: null, endsAt: null, active: true, priority: 0,
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
      ...overrides,
    };
  }

  it("sin presupuesto agotado, concede el importe completo sin recortar", async () => {
    const campaign = blankCampaign({ maxTotalTokens: 100 });
    const engine = makeEngineMockDb({
      campaigns: [campaign], campaignScope: { communities: [], venues: [], events: [] }, campaignForLock: campaign,
    });
    engine.queueRules([blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 50 })]);
    engine.queueRules([]); // sin recurrencia
    const result = await earnTokens({ userId: 42, origin: "attendance" }, engine.db);
    expect(result.breakdown.final).toBe(50);
    expect(result.breakdown.campaignId).toBe(1);
    expect(engine.getLedgerWrites()).toHaveLength(1);
    expect(engine.getLedgerWrites()[0].campaignId).toBe(1);
  });

  it("CLAMP TO REMAINING BUDGET — remanente=7, candidato=10 → concede exactamente 7 (spec §12, política explícita)", async () => {
    const campaign = blankCampaign({ maxTotalTokens: 100 });
    const engine = makeEngineMockDb({
      campaigns: [campaign], campaignScope: { communities: [], venues: [], events: [] }, campaignForLock: campaign,
    });
    // Simula que ya se emitieron 93 tokens de esta campaña — insertando una fila previa directamente en el estado del mock.
    engine.getLedgerWrites().push({ id: 999, campaignId: 1, direction: "credit", amount: 93 });
    engine.queueRules([blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 10 })]);
    engine.queueRules([]);
    const result = await earnTokens({ userId: 42, origin: "attendance" }, engine.db);
    expect(result.breakdown.final).toBe(7); // 100-93=7 remanente, candidato 10 → clamp a 7
  });

  it("presupuesto agotado (remanente=0) → RULE_LIMIT_EXCEEDED, nunca se sobrepasa el total", async () => {
    const campaign = blankCampaign({ maxTotalTokens: 100 });
    const engine = makeEngineMockDb({
      campaigns: [campaign], campaignScope: { communities: [], venues: [], events: [] }, campaignForLock: campaign,
    });
    engine.getLedgerWrites().push({ id: 999, campaignId: 1, direction: "credit", amount: 100 });
    engine.queueRules([blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 10 })]);
    engine.queueRules([]);
    await expect(
      earnTokens({ userId: 42, origin: "attendance" }, engine.db)
    ).rejects.toMatchObject({ code: "RULE_LIMIT_EXCEEDED" });
  });

  it("CONCURRENCIA REAL — dos earns compitiendo por el mismo presupuesto nunca lo sobrepasan (lock de fila serializa, no SELECT+SELECT sin protección)", async () => {
    const campaign = blankCampaign({ maxTotalTokens: 10 });
    const engine = makeEngineMockDb({
      wallet: blankWallet({ balance: 0 }),
      campaigns: [campaign], campaignScope: { communities: [], venues: [], events: [] }, campaignForLock: campaign,
      serializeTransactions: true,
    });
    // Cada earnTokens consulta tokenRules 2 veces (regla, luego recurrencia) ANTES
    // de entrar en la transacción — con 2 llamadas GENUINAMENTE concurrentes el
    // orden real de consumo de la cola FIFO compartida no está garantizado
    // (A-regla, B-regla, A-recurrencia, B-recurrencia es un orden tan válido
    // como A-regla, A-recurrencia, B-regla, B-recurrencia). Se encola la MISMA
    // fila 4 veces — es inequívocamente correcta como "regla" en cualquier
    // posición, y como "recurrencia" el propio applyRecurrenceBonus la
    // descarta igual que un array vacío (recurrenceWindow=null en blankRule
    // por defecto), así que el resultado es idéntico sin importar el
    // entrelazado real de las dos promesas.
    const rule = blankRule({ id: 1, calcMethod: "fixed", fixedAmount: 6 });
    engine.queueRules([rule]);
    engine.queueRules([rule]);
    engine.queueRules([rule]);
    engine.queueRules([rule]);

    const results = await Promise.allSettled([
      earnTokens({ userId: 42, origin: "attendance" }, engine.db),
      earnTokens({ userId: 42, origin: "attendance" }, engine.db),
    ]);

    const totalGranted = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof earnTokens>>> => r.status === "fulfilled")
      .reduce((sum, r) => sum + r.value.breakdown.final, 0);

    expect(totalGranted).toBeLessThanOrEqual(10); // 6+6=12 > presupuesto=10 — NUNCA debe superarlo
    expect(totalGranted).toBe(10); // política CLAMP: la 2ª llamada recorta al remanente (6 + 4 = 10), ninguna se pierde del todo
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
