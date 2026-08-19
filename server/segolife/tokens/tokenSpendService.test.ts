/**
 * tokenSpendService.test.ts — SEGOLIFE SEGOTOKENS UNIVERSAL SPEND & MIXED
 * PAYMENTS (Fase 7). Mismo patrón que benefitPurchaseService.test.ts:
 * `postLedgerMovementInTx`/`reverseTransaction` (tokenLedgerService.ts) se
 * mockean — su idempotencia por ER_DUP_ENTRY, su lock de fila y su rechazo
 * de saldo negativo ya están cubiertos en tokenLedgerService.test.ts, no se
 * duplican aquí. Lo que se prueba es la lógica PROPIA de este motor:
 * resolución de política, cálculo de asignación (tokens/valor/dinero),
 * ciclo de vida reserve→capture/release/reverse, e idempotencia.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPostLedgerMovementInTx, mockReverseTransaction } = vi.hoisted(() => ({
  mockPostLedgerMovementInTx: vi.fn(),
  mockReverseTransaction: vi.fn(),
}));
vi.mock("./tokenLedgerService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tokenLedgerService")>();
  return { ...actual, postLedgerMovementInTx: mockPostLedgerMovementInTx, reverseTransaction: mockReverseTransaction };
});

import {
  quoteTokenSpend, reserveTokenSpend, captureTokenSpend, releaseTokenSpend, reverseTokenSpend,
  reserveAndCaptureTokenSpend, resolveRedemptionPolicy, TokenSpendError,
} from "./tokenSpendService";
import { tokenRedemptionPolicies, tokenSpendReservations, tokenWallets } from "../../../drizzle/schema";

// ─── mismo extractor de condiciones que benefitRuleEngine.test.ts (Fase 6) ──
type CondPair = [column: string, op: "=" | "<>", value: unknown];
function extractCondPairs(node: any, pairs: CondPair[] = []): CondPair[] {
  if (!node || typeof node !== "object" || !Array.isArray(node.queryChunks)) return pairs;
  const chunks = node.queryChunks;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c && typeof c === "object" && "columnType" in c && typeof c.name === "string") {
      let op: "=" | "<>" = "=";
      for (let j = i + 1; j < chunks.length; j++) {
        const p = chunks[j];
        if (p && typeof p === "object" && "value" in p && Array.isArray((p as { value?: unknown }).value) && !("columnType" in p)) {
          const opStr = (p as { value: unknown[] }).value.join("");
          if (opStr.includes("<>") || opStr.includes("!=")) op = "<>";
        }
        if (p && typeof p === "object" && "brand" in p && "value" in p && !("columnType" in p)) {
          pairs.push([c.name as string, op, (p as { value: unknown }).value]);
          break;
        }
        if (p && typeof p === "object" && Array.isArray((p as { queryChunks?: unknown }).queryChunks)) break;
      }
    } else if (c && typeof c === "object" && Array.isArray(c.queryChunks)) {
      extractCondPairs(c, pairs);
    }
  }
  return pairs;
}
function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
function matchesCondition(row: Record<string, unknown>, cond: unknown): boolean {
  const pairs = extractCondPairs(cond);
  if (pairs.length === 0) return true;
  return pairs.every(([col, op, val]) => {
    const rowVal = row[toCamelCase(col)];
    return op === "=" ? rowVal === val : rowVal !== val;
  });
}

function blankPolicy(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "Global", description: null, active: true,
    communityId: null, venueId: null, eventId: null,
    tokensPerUnit: 100, valueCentsPerUnit: 100, // 1 ST = 1 céntimo
    minTokenSpend: null, maxTokenSpend: null, maxPercentage: null,
    allowFullTokenPayment: false,
    startsAt: null, endsAt: null, priority: 0,
    createdByUserId: null, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeMockDb(config: { policies?: Array<Record<string, unknown>>; walletBalance?: number; existingReservations?: Array<Record<string, unknown>> } = {}) {
  const policies = config.policies ?? [blankPolicy()];
  const walletBalance = config.walletBalance ?? 1000;
  const reservationRows: Array<Record<string, unknown>> = config.existingReservations ? [...config.existingReservations] : [];
  let nextId = reservationRows.length > 0 ? Math.max(...reservationRows.map(r => r.id as number)) + 1 : 1;

  function makeBuilder() {
    let mode: "select" | "insert" | "update" = "select";
    let table: unknown = null;
    let lastCond: unknown = null;
    let updateValues: Record<string, unknown> | null = null;
    let locked = false;
    let projected = false;
    const b: any = {};
    b.select = (proj?: unknown) => { mode = "select"; projected = proj !== undefined; return b; };
    b.from = (t: unknown) => { table = t; return b; };
    b.insert = (t: unknown) => { mode = "insert"; table = t; return b; };
    b.update = (t: unknown) => { mode = "update"; table = t; return b; };
    b.set = (v: Record<string, unknown>) => { updateValues = v; return b; };
    b.where = (cond: unknown) => { lastCond = cond; return b; };
    b.limit = () => b;
    b.for = () => { locked = true; return b; };
    b.values = (v: Record<string, unknown>) => {
      if (table === tokenSpendReservations) {
        const row = { id: nextId++, ledgerId: null, reversalLedgerId: null, capturedAt: null, releasedAt: null, reversedAt: null, ...v };
        reservationRows.push(row);
        return Promise.resolve([{ insertId: row.id }]);
      }
      return Promise.resolve([{ insertId: 1 }]);
    };
    b.then = (resolve: (v: unknown) => void) => {
      if (mode === "update" && table === tokenSpendReservations) {
        const row = reservationRows.find(r => matchesCondition(r, lastCond));
        if (row && updateValues) Object.assign(row, updateValues);
        return resolve(undefined);
      }
      if (table === tokenRedemptionPolicies) return resolve(policies.filter(p => p.active));
      if (table === tokenWallets) return resolve([{ id: 1, userId: 42, balance: walletBalance }]);
      if (table === tokenSpendReservations) {
        if (projected) {
          // countActiveReservedTokens — agregado sobre reservas activas no expiradas.
          const now = Date.now();
          const active = reservationRows.filter(r => r.status === "reserved" && (r.expiresAt as Date).getTime() > now);
          return resolve(active.map(r => ({ tokens: r.tokensReserved })));
        }
        // locked (.for) => lookup por id (capture/release/reverse); sin lock => lookup por idempotencyKey (reserve precheck).
        void locked;
        return resolve(reservationRows.filter(r => matchesCondition(r, lastCond)));
      }
      return resolve([]);
    };
    return b;
  }

  const outer: any = makeBuilder();
  outer.transaction = (cb: (tx: unknown) => Promise<unknown>) => cb(makeBuilder());
  return { db: outer, getReservationRows: () => reservationRows };
}

const BASE_INPUT = { userId: 42, venueId: 10, grossAmountCents: 2000, requestedTokens: 500 };

beforeEach(() => {
  vi.clearAllMocks();
  mockPostLedgerMovementInTx.mockResolvedValue({ ledger: { id: 900 }, wallet: { balance: 500 } });
  mockReverseTransaction.mockResolvedValue({ ledger: { id: 901 }, wallet: { balance: 1000 } });
});

// ─── 1. RESOLUCIÓN DE POLÍTICA — spec §6, determinista ──────────────────────

describe("resolveRedemptionPolicy — especificidad y desempate deterministas (spec §6/§41 tests #11-13)", () => {
  it("sin ninguna política activa que encaje, devuelve null (spec §8, comportamiento seguro por defecto)", async () => {
    const { db } = makeMockDb({ policies: [] });
    const result = await resolveRedemptionPolicy({ venueId: 10 }, new Date(), db);
    expect(result).toBeNull();
  });

  it("venueId que no coincide con ninguna política venue-scoped descarta esa política (spec §41 test #11)", async () => {
    const { db } = makeMockDb({ policies: [blankPolicy({ venueId: 999 })] });
    const result = await resolveRedemptionPolicy({ venueId: 10 }, new Date(), db);
    expect(result).toBeNull();
  });

  it("eventId que no coincide descarta la política event-scoped (spec §41 test #12)", async () => {
    const { db } = makeMockDb({ policies: [blankPolicy({ eventId: 999 })] });
    const result = await resolveRedemptionPolicy({ venueId: 10, eventId: 5 }, new Date(), db);
    expect(result).toBeNull();
  });

  it("una política venue-específica gana sobre la global cuando ambas encajan (spec §6: la más específica)", async () => {
    const { db } = makeMockDb({ policies: [blankPolicy({ id: 1, venueId: null }), blankPolicy({ id: 2, venueId: 10 })] });
    const result = await resolveRedemptionPolicy({ venueId: 10 }, new Date(), db);
    expect(result?.id).toBe(2);
  });

  it("empate de especificidad se resuelve por priority explícito", async () => {
    const { db } = makeMockDb({ policies: [blankPolicy({ id: 1, venueId: 10, priority: 0 }), blankPolicy({ id: 2, venueId: 10, priority: 5 })] });
    const result = await resolveRedemptionPolicy({ venueId: 10 }, new Date(), db);
    expect(result?.id).toBe(2);
  });

  it("empate total (especificidad + priority) se resuelve por id — nunca ambiguo/no determinista", async () => {
    const { db } = makeMockDb({ policies: [blankPolicy({ id: 5, venueId: 10 }), blankPolicy({ id: 2, venueId: 10 })] });
    const result = await resolveRedemptionPolicy({ venueId: 10 }, new Date(), db);
    expect(result?.id).toBe(2); // menor id, siempre el mismo resultado
  });

  it("política fuera de su ventana startsAt/endsAt no aplica (spec §41 test #10)", async () => {
    const { db } = makeMockDb({ policies: [blankPolicy({ startsAt: new Date("2099-01-01") })] });
    const result = await resolveRedemptionPolicy({ venueId: 10 }, new Date(), db);
    expect(result).toBeNull();
  });
});

// ─── 2. QUOTE — cálculo puro (spec §11/§12/§41 tests #1-9,14,15) ───────────

describe("quoteTokenSpend — economía core", () => {
  it("0 tokens solicitados → dinero debido = importe bruto completo (spec §41 test #1)", async () => {
    const { db } = makeMockDb();
    const quote = await quoteTokenSpend({ ...BASE_INPUT, requestedTokens: 0 }, db);
    expect(quote.eligible).toBe(true);
    if (quote.eligible) { expect(quote.tokensToSpend).toBe(0); expect(quote.moneyDueCents).toBe(2000); expect(quote.promotionalValueCents).toBe(0); }
  });

  it("ST parcial → resto correcto en céntimos (spec §41 test #2)", async () => {
    const { db } = makeMockDb();
    const quote = await quoteTokenSpend({ ...BASE_INPUT, requestedTokens: 500 }, db); // 500 ST = 500 céntimos (1:1)
    expect(quote.eligible).toBe(true);
    if (quote.eligible) { expect(quote.promotionalValueCents).toBe(500); expect(quote.moneyDueCents).toBe(1500); }
  });

  it("ST suficiente + allowFullTokenPayment → dinero debido = 0 (spec §41 test #3)", async () => {
    const { db } = makeMockDb({ policies: [blankPolicy({ allowFullTokenPayment: true })], walletBalance: 5000 });
    const quote = await quoteTokenSpend({ ...BASE_INPUT, requestedTokens: 2000 }, db); // 2000 ST = 2000 céntimos = bruto completo
    expect(quote.eligible).toBe(true);
    if (quote.eligible) { expect(quote.moneyDueCents).toBe(0); expect(quote.promotionalValueCents).toBe(2000); }
  });

  it("maxPercentage respetado incluso con saldo de sobra (spec §41 test #4, ejemplo de negocio del spec)", async () => {
    const { db } = makeMockDb({ policies: [blankPolicy({ maxPercentage: 50 })], walletBalance: 100000 });
    const quote = await quoteTokenSpend({ ...BASE_INPUT, grossAmountCents: 2000, requestedTokens: 100000 }, db);
    expect(quote.eligible).toBe(true);
    // 50% de 2000 = 1000 céntimos máximo de valor promocional -> dinero debido nunca baja de 1000.
    if (quote.eligible) { expect(quote.moneyDueCents).toBeGreaterThanOrEqual(1000); expect(quote.promotionalValueCents).toBeLessThanOrEqual(1000); }
  });

  it("maxTokenSpend (tope absoluto de la política) respetado (spec §41 test #5)", async () => {
    const { db } = makeMockDb({ policies: [blankPolicy({ maxTokenSpend: 200 })], walletBalance: 100000 });
    const quote = await quoteTokenSpend({ ...BASE_INPUT, requestedTokens: 100000 }, db);
    expect(quote.eligible).toBe(true);
    if (quote.eligible) expect(quote.tokensToSpend).toBe(200);
  });

  it("saldo del Student respetado — nunca gasta más de lo que tiene (spec §41 test #6)", async () => {
    const { db } = makeMockDb({ walletBalance: 150 });
    const quote = await quoteTokenSpend({ ...BASE_INPUT, requestedTokens: 100000 }, db);
    expect(quote.eligible).toBe(true);
    if (quote.eligible) expect(quote.tokensToSpend).toBeLessThanOrEqual(150);
  });

  it("el valor promocional NUNCA supera el importe bruto (spec §41 test #7, defensivo incluso con tasa agresiva)", async () => {
    const { db } = makeMockDb({ policies: [blankPolicy({ tokensPerUnit: 1, valueCentsPerUnit: 1000, allowFullTokenPayment: true })], walletBalance: 100000 });
    const quote = await quoteTokenSpend({ ...BASE_INPUT, grossAmountCents: 500, requestedTokens: 100000 }, db);
    expect(quote.eligible).toBe(true);
    if (quote.eligible) expect(quote.promotionalValueCents).toBeLessThanOrEqual(500);
  });

  it("el dinero debido nunca es negativo (spec §41 test #8)", async () => {
    const { db } = makeMockDb({ policies: [blankPolicy({ allowFullTokenPayment: true })], walletBalance: 100000 });
    const quote = await quoteTokenSpend({ ...BASE_INPUT, grossAmountCents: 100, requestedTokens: 100000 }, db);
    expect(quote.eligible).toBe(true);
    if (quote.eligible) expect(quote.moneyDueCents).toBeGreaterThanOrEqual(0);
  });

  it("política inactiva → NO_POLICY (spec §41 test #9)", async () => {
    const { db } = makeMockDb({ policies: [blankPolicy({ active: false })] });
    const quote = await quoteTokenSpend(BASE_INPUT, db);
    expect(quote).toMatchObject({ eligible: false, reason: "NO_POLICY" });
  });

  it("minTokenSpend no alcanzado → 0 aplicado, nunca redondeado al alza (spec §41 test #14 adaptado)", async () => {
    const { db } = makeMockDb({ policies: [blankPolicy({ minTokenSpend: 100 })] });
    const quote = await quoteTokenSpend({ ...BASE_INPUT, requestedTokens: 50 }, db);
    expect(quote.eligible).toBe(true);
    if (quote.eligible) { expect(quote.tokensToSpend).toBe(0); expect(quote.moneyDueCents).toBe(2000); }
  });

  it("redondeo: tasa no exacta trunca, nunca da más valor del matemáticamente permitido (spec §41 test #15)", async () => {
    // 3 ST = 1 céntimo -> 250 ST deberían valer floor(250/3) = 83 céntimos, no 83.33.
    const { db } = makeMockDb({ policies: [blankPolicy({ tokensPerUnit: 3, valueCentsPerUnit: 1 })] });
    const quote = await quoteTokenSpend({ ...BASE_INPUT, requestedTokens: 250 }, db);
    expect(quote.eligible).toBe(true);
    if (quote.eligible) expect(quote.promotionalValueCents).toBe(83);
  });

  it("importe bruto inválido (negativo) → INVALID_AMOUNT", async () => {
    const { db } = makeMockDb();
    const quote = await quoteTokenSpend({ ...BASE_INPUT, grossAmountCents: -100 }, db);
    expect(quote).toMatchObject({ eligible: false, reason: "INVALID_AMOUNT" });
  });
});

// ─── 3. RESERVE/CAPTURE/RELEASE/REVERSE — ciclo de vida (spec §41 tests #16-26) ──

describe("reserveTokenSpend — spec §41 tests #16-18", () => {
  it("saldo insuficiente → 0 tokens reservados en vez de rechazar toda la operación (clamp, no excepción — coherente con quote)", async () => {
    const { db } = makeMockDb({ walletBalance: 0 });
    const result = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    expect(result.status).toBe("reserved");
    if (result.status === "reserved") expect(result.reservation.tokensReserved).toBe(0);
  });

  // FIX-01 (spec §30 caso 17) — un wallet con balance CONTABLE negativo (p.ej.
  // tras un clawback de refund, ver tokenLedgerService.test.ts) nunca puede
  // reservar/gastar ST reales. availableBalance ya usa Math.max(0, balance -
  // reservedTotal) — con balance negativo esto da 0 igual que con balance=0,
  // pero antes de este fix ningún test lo probaba con un negativo REAL.
  it("balance CONTABLE negativo (deuda real de un refund clawback) → 0 tokens reservados, igual que balance=0 — nunca genera un saldo negativo por partida doble", async () => {
    const { db } = makeMockDb({ walletBalance: -80 });
    const result = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    expect(result.status).toBe("reserved");
    if (result.status === "reserved") expect(result.reservation.tokensReserved).toBe(0);
  });

  it("sin política activa → status no_policy, nunca crea una reserva", async () => {
    const { db, getReservationRows } = makeMockDb({ policies: [] });
    const result = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    expect(result.status).toBe("no_policy");
    expect(getReservationRows()).toHaveLength(0);
  });

  it("reserva exitosa: no mueve el ledger todavía (spec §15 — reservar nunca toca el ledger)", async () => {
    const { db } = makeMockDb();
    const result = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "commerce_transaction", referenceId: 55, idempotencyKey: "k1" }, db);
    expect(result.status).toBe("reserved");
    expect(mockPostLedgerMovementInTx).not.toHaveBeenCalled();
  });

  it("idempotencyKey repetida devuelve la MISMA reserva, nunca reserva dos veces (spec §41 test #17 adaptado, #22)", async () => {
    const { db, getReservationRows } = makeMockDb();
    const first = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "same-key" }, db);
    const second = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "same-key" }, db);
    expect(first.status).toBe("reserved");
    expect(second.status).toBe("reserved");
    if (first.status === "reserved" && second.status === "reserved") expect(first.reservation.id).toBe(second.reservation.id);
    expect(getReservationRows()).toHaveLength(1);
  });
});

describe("captureTokenSpend — spec §41 tests #21-22, mueve el ledger UNA vez", () => {
  it("captura una reserva 'reserved': llama a postLedgerMovementInTx con el nº exacto de tokens reservados", async () => {
    const { db, getReservationRows } = makeMockDb();
    const reserved = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    if (reserved.status !== "reserved") throw new Error("expected reserved");
    await captureTokenSpend(reserved.reservation.id, db);
    expect(mockPostLedgerMovementInTx).toHaveBeenCalledOnce();
    expect(mockPostLedgerMovementInTx.mock.calls[0][1]).toMatchObject({ userId: 42, direction: "debit", amount: reserved.reservation.tokensReserved });
    expect(getReservationRows()[0].status).toBe("captured");
  });

  it("capturar dos veces la MISMA reserva es idempotente — NO vuelve a mover el ledger (spec §41 test #22)", async () => {
    const { db } = makeMockDb();
    const reserved = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    if (reserved.status !== "reserved") throw new Error("expected reserved");
    const first = await captureTokenSpend(reserved.reservation.id, db);
    const second = await captureTokenSpend(reserved.reservation.id, db);
    expect(first.alreadyCaptured).toBe(false);
    expect(second.alreadyCaptured).toBe(true);
    expect(mockPostLedgerMovementInTx).toHaveBeenCalledOnce();
  });

  it("capturar una reserva ya liberada lanza INVALID_STATE, nunca gasta tokens de una reserva muerta", async () => {
    const { db } = makeMockDb();
    const reserved = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    if (reserved.status !== "reserved") throw new Error("expected reserved");
    await releaseTokenSpend(reserved.reservation.id, "cancelado", db);
    await expect(captureTokenSpend(reserved.reservation.id, db)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(mockPostLedgerMovementInTx).not.toHaveBeenCalled();
  });

  it("capturar una reserva expirada lanza RESERVATION_EXPIRED", async () => {
    const { db } = makeMockDb({
      existingReservations: [{
        id: 1, userId: 42, walletId: 1, policyId: 1, venueId: 10, eventId: null, communityId: null,
        referenceType: "test", referenceId: null, grossAmountCents: 2000, tokensReserved: 500,
        promotionalValueCents: 500, moneyDueCents: 1500, status: "reserved", idempotencyKey: "expired-key",
        expiresAt: new Date(Date.now() - 60000), createdByUserId: null, createdAt: new Date(),
      }],
    });
    await expect(captureTokenSpend(1, db)).rejects.toMatchObject({ code: "RESERVATION_EXPIRED" });
  });
});

describe("releaseTokenSpend — spec §41 tests #19-20,23", () => {
  it("libera una reserva sin tocar el ledger — pago externo fallido nunca necesita revertir nada (spec §30)", async () => {
    const { db, getReservationRows } = makeMockDb();
    const reserved = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    if (reserved.status !== "reserved") throw new Error("expected reserved");
    await releaseTokenSpend(reserved.reservation.id, "pago fallido", db);
    expect(getReservationRows()[0].status).toBe("released");
    expect(mockPostLedgerMovementInTx).not.toHaveBeenCalled();
    expect(mockReverseTransaction).not.toHaveBeenCalled();
  });

  it("liberar dos veces es idempotente, nunca lanza error en el segundo intento (spec §41 test #23)", async () => {
    const { db } = makeMockDb();
    const reserved = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    if (reserved.status !== "reserved") throw new Error("expected reserved");
    await releaseTokenSpend(reserved.reservation.id, "x", db);
    await expect(releaseTokenSpend(reserved.reservation.id, "x", db)).resolves.toBeTruthy();
  });

  it("liberar una reserva ya CAPTURADA lanza INVALID_STATE (no se puede deshacer un gasto real con release, solo con reverse)", async () => {
    const { db } = makeMockDb();
    const reserved = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    if (reserved.status !== "reserved") throw new Error("expected reserved");
    await captureTokenSpend(reserved.reservation.id, db);
    await expect(releaseTokenSpend(reserved.reservation.id, "x", db)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("la disponibilidad se libera tras un release — una reserva liberada ya no cuenta como comprometida (spec §41 test #18)", async () => {
    const { db } = makeMockDb({ walletBalance: 500 });
    const first = await reserveTokenSpend({ ...BASE_INPUT, requestedTokens: 500, referenceType: "test", idempotencyKey: "k1" }, db);
    if (first.status !== "reserved") throw new Error("expected reserved");
    await releaseTokenSpend(first.reservation.id, "x", db);
    // Tras liberar los 500, una segunda reserva por otros 500 debe volver a caber en el mismo saldo.
    const second = await reserveTokenSpend({ ...BASE_INPUT, requestedTokens: 500, referenceType: "test", idempotencyKey: "k2" }, db);
    if (second.status !== "reserved") throw new Error("expected reserved");
    expect(second.reservation.tokensReserved).toBe(500);
  });
});

describe("reverseTokenSpend — spec §27/§29/§41 tests #24-26", () => {
  it("revierte una reserva CAPTURADA vía reverseTransaction (el ledger REAL, nunca un ajuste manual)", async () => {
    const { db, getReservationRows } = makeMockDb();
    const reserved = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    if (reserved.status !== "reserved") throw new Error("expected reserved");
    await captureTokenSpend(reserved.reservation.id, db);
    await reverseTokenSpend({ reservationId: reserved.reservation.id, reason: "reembolso", adminUserId: 1 }, db);
    expect(mockReverseTransaction).toHaveBeenCalledOnce();
    expect(mockReverseTransaction.mock.calls[0][0]).toMatchObject({ ledgerId: 900, reason: "reembolso" });
    expect(getReservationRows()[0].status).toBe("reversed");
  });

  it("revertir dos veces la misma reserva NO devuelve tokens dos veces — segunda llamada es no-op idempotente (spec §41 test #25 — CRITICAL)", async () => {
    const { db } = makeMockDb();
    const reserved = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    if (reserved.status !== "reserved") throw new Error("expected reserved");
    await captureTokenSpend(reserved.reservation.id, db);
    await reverseTokenSpend({ reservationId: reserved.reservation.id, reason: "reembolso", adminUserId: 1 }, db);
    await reverseTokenSpend({ reservationId: reserved.reservation.id, reason: "reembolso otra vez", adminUserId: 1 }, db);
    expect(mockReverseTransaction).toHaveBeenCalledOnce(); // NUNCA una segunda llamada real al ledger
  });

  it("revertir una reserva que nunca se capturó lanza INVALID_STATE — no hay nada real que revertir", async () => {
    const { db } = makeMockDb();
    const reserved = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    if (reserved.status !== "reserved") throw new Error("expected reserved");
    await expect(reverseTokenSpend({ reservationId: reserved.reservation.id, reason: "x", adminUserId: 1 }, db)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("requiere un motivo — REASON_REQUIRED sin él (mismo criterio que reverseTransaction del ledger)", async () => {
    const { db } = makeMockDb();
    const reserved = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    if (reserved.status !== "reserved") throw new Error("expected reserved");
    await captureTokenSpend(reserved.reservation.id, db);
    await expect(reverseTokenSpend({ reservationId: reserved.reservation.id, reason: "", adminUserId: 1 }, db)).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });

  it("sourceType de la reversión es 'reversal' en el ledger — nunca dispara earn/recurrencia/campañas (spec §29, ya garantizado por reverseTransaction real — aquí solo se verifica que SE LLAMA a esa función y no a postLedgerMovementInTx con direction=credit directo)", async () => {
    const { db } = makeMockDb();
    const reserved = await reserveTokenSpend({ ...BASE_INPUT, referenceType: "test", idempotencyKey: "k1" }, db);
    if (reserved.status !== "reserved") throw new Error("expected reserved");
    await captureTokenSpend(reserved.reservation.id, db);
    mockPostLedgerMovementInTx.mockClear();
    await reverseTokenSpend({ reservationId: reserved.reservation.id, reason: "x", adminUserId: 1 }, db);
    expect(mockPostLedgerMovementInTx).not.toHaveBeenCalled(); // la reversión pasa SOLO por reverseTransaction, nunca crea un movimiento "credit" directo
  });
});

describe("reserveAndCaptureTokenSpend — flujo inmediato/staff-confirmado (spec §2, POS)", () => {
  it("reserva y captura en un solo paso — el ledger se mueve inmediatamente", async () => {
    const { db, getReservationRows } = makeMockDb();
    const result = await reserveAndCaptureTokenSpend({ ...BASE_INPUT, referenceType: "commerce_transaction", referenceId: 77, idempotencyKey: "pos-1" }, db);
    expect("alreadyCaptured" in result).toBe(true);
    expect(mockPostLedgerMovementInTx).toHaveBeenCalledOnce();
    expect(getReservationRows()[0].status).toBe("captured");
  });

  it("sin política, devuelve no_policy sin capturar nada", async () => {
    const { db } = makeMockDb({ policies: [] });
    const result = await reserveAndCaptureTokenSpend({ ...BASE_INPUT, referenceType: "commerce_transaction", idempotencyKey: "pos-1" }, db);
    expect(result).toMatchObject({ status: "no_policy" });
    expect(mockPostLedgerMovementInTx).not.toHaveBeenCalled();
  });
});

describe("TokenSpendError", () => {
  it("es instancia de Error con código tipado", () => {
    const err = new TokenSpendError("NOT_FOUND", "x");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("NOT_FOUND");
  });
});
