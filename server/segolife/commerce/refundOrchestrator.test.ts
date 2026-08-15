/**
 * refundOrchestrator.test.ts — SEGOLIFE COMMERCE CORE (Fase 9, spec §21-22).
 * Reembolso parcial determinista por línea de una venta de POS — política
 * documentada: dinero SIEMPRE proporcional e inmediato; SegoTokens/
 * recompensa de compra SOLO se revierten cuando el reembolso acumulado
 * cubre el 100% de la venta (nunca una reversión parcial de una reserva ya
 * capturada, sin primitivo seguro para eso).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReverseTransaction, mockIsLedgerEntryReversed } = vi.hoisted(() => ({
  mockReverseTransaction: vi.fn(),
  mockIsLedgerEntryReversed: vi.fn(),
}));
vi.mock("../tokens/tokenLedgerService", () => ({
  reverseTransaction: mockReverseTransaction,
  isLedgerEntryReversed: mockIsLedgerEntryReversed,
}));

const { mockReverseTokenSpend } = vi.hoisted(() => ({ mockReverseTokenSpend: vi.fn() }));
vi.mock("../tokens/tokenSpendService", () => ({ reverseTokenSpend: mockReverseTokenSpend }));

const { mockEmitEngagementEvent } = vi.hoisted(() => ({ mockEmitEngagementEvent: vi.fn() }));
vi.mock("../engagement/engagementEvents", () => ({ emitEngagementEvent: mockEmitEngagementEvent }));

import { refundPosSale, RefundOrchestratorError } from "./refundOrchestrator";
import { commerceTransactions, commerceTransactionItems, commerceRefunds } from "../../../drizzle/schema";

function txFixture(overrides: Partial<Record<string, unknown>> = {}) {
  // totalCents=1000 coincide a propósito con itemFixture() (2 × 500) — así
  // "reembolsar toda la cantidad de la línea" y "reembolsar el 100% de la
  // venta" son la MISMA operación en los tests, sin fees adicionales que
  // compliquen el escenario de reembolso total.
  return { id: 1, userId: 42, venueId: 10, eventId: null, status: "confirmed", totalCents: 1000, refundedAmountCents: 0, loyaltyLedgerId: null, tokenReservationId: null, metadata: {}, ...overrides };
}
function itemFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, transactionId: 1, description: "Cerveza", quantity: 2, unitAmountCents: 500, totalAmountCents: 1000, refundedQuantity: 0, ...overrides };
}

function makeMockDb(config: { tx?: Record<string, unknown> | null; items?: Array<Record<string, unknown>> } = {}) {
  let tx = config.tx !== undefined ? config.tx : txFixture();
  let items = config.items ? [...config.items] : [itemFixture()];
  const refunds: Array<Record<string, unknown>> = [];

  function makeBuilder() {
    const b: any = {};
    let mode: "select" | "update" | "insert" = "select";
    let table: unknown = null;
    let updateValues: Record<string, unknown> | null = null;
    let whereCond: unknown = null;
    b.select = () => { mode = "select"; return b; };
    b.from = (t: unknown) => { table = t; return b; };
    b.insert = (t: unknown) => { mode = "insert"; table = t; return b; };
    b.update = (t: unknown) => { mode = "update"; table = t; return b; };
    b.set = (v: Record<string, unknown>) => { updateValues = v; return b; };
    b.where = (c: unknown) => { whereCond = c; return b; };
    b.for = () => b;
    b.ignore = () => b;
    b.limit = () => b;
    b.values = (v: Record<string, unknown>) => { if (table === commerceRefunds) refunds.push(v); return Promise.resolve([{ insertId: refunds.length }]); };
    b.then = (resolve: (v: unknown) => void) => {
      void whereCond;
      if (mode === "update") {
        if (table === commerceTransactions) { tx = { ...tx, ...updateValues }; return resolve([{ affectedRows: 1 }]); }
        if (table === commerceTransactionItems) {
          // El código real hace un UPDATE por línea con sql`refundedQuantity + N` — el mock simplemente
          // incrementa el primer item pendiente (suficiente para estas pruebas de 1 línea).
          const item = items[0];
          if (item) item.refundedQuantity = (item.refundedQuantity as number) + ((updateValues as any)?.__inc ?? 0);
          return resolve([{ affectedRows: 1 }]);
        }
        return resolve([{ affectedRows: 0 }]);
      }
      if (table === commerceTransactions) return resolve(tx ? [tx] : []);
      if (table === commerceTransactionItems) return resolve(items);
      return resolve([]);
    };
    return b;
  }
  const outer: any = makeBuilder();
  outer.transaction = (cb: (tx: unknown) => Promise<unknown>) => cb(makeBuilder());
  return { db: outer, getTx: () => tx, getRefunds: () => refunds };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsLedgerEntryReversed.mockResolvedValue(false);
  mockReverseTransaction.mockResolvedValue({ ledger: { id: 900 } });
  mockReverseTokenSpend.mockResolvedValue({ tokensReserved: 50 });
});

describe("refundPosSale — reembolso parcial por línea (spec §21)", () => {
  it("#1 reembolso parcial (1 de 2 unidades) marca la transacción 'partially_refunded', nunca 'refunded'", async () => {
    const { db, getTx } = makeMockDb({ items: [itemFixture()] });
    const result = await refundPosSale({ transactionId: 1, lines: [{ itemId: 1, quantity: 1 }], reason: "una unidad en mal estado", refundedByUserId: 9 }, db);
    expect(result.isFullRefund).toBe(false);
    expect(getTx().status).toBe("partially_refunded");
    expect(result.refundedAmountCents).toBe(500);
  });

  it("#2 reembolso que cubre TODA la cantidad restante marca 'refunded' (total)", async () => {
    const { db, getTx } = makeMockDb({ items: [itemFixture()] });
    const result = await refundPosSale({ transactionId: 1, lines: [{ itemId: 1, quantity: 2 }], reason: "toda la venta", refundedByUserId: 9 }, db);
    expect(result.isFullRefund).toBe(true);
    expect(getTx().status).toBe("refunded");
  });

  it("#3 rechaza reembolsar más unidades de las disponibles (quantity > remaining)", async () => {
    const { db } = makeMockDb({ items: [itemFixture({ refundedQuantity: 1 })] }); // ya 1 de 2 reembolsada, queda 1
    await expect(refundPosSale({ transactionId: 1, lines: [{ itemId: 1, quantity: 2 }], reason: "x", refundedByUserId: 9 }, db))
      .rejects.toMatchObject({ code: "INVALID_QUANTITY" });
  });

  it("#4 rechaza una línea que no pertenece a esta transacción", async () => {
    const { db } = makeMockDb({ items: [itemFixture({ transactionId: 999 })] });
    await expect(refundPosSale({ transactionId: 1, lines: [{ itemId: 1, quantity: 1 }], reason: "x", refundedByUserId: 9 }, db))
      .rejects.toMatchObject({ code: "INVALID_LINE" });
  });

  it("#5 exige motivo", async () => {
    const { db } = makeMockDb();
    await expect(refundPosSale({ transactionId: 1, lines: [{ itemId: 1, quantity: 1 }], reason: "", refundedByUserId: 9 }, db))
      .rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });

  it("#6 rechaza una lista de líneas vacía", async () => {
    const { db } = makeMockDb();
    await expect(refundPosSale({ transactionId: 1, lines: [], reason: "x", refundedByUserId: 9 }, db))
      .rejects.toMatchObject({ code: "EMPTY_LINES" });
  });

  it("#7 rechaza reembolsar una transacción no confirmada/parcialmente reembolsada (p.ej. ya 'refunded')", async () => {
    const { db } = makeMockDb({ tx: txFixture({ status: "refunded" }) });
    await expect(refundPosSale({ transactionId: 1, lines: [{ itemId: 1, quantity: 1 }], reason: "x", refundedByUserId: 9 }, db))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("#8 reembolso PARCIAL nunca revierte SegoTokens ni recompensa (sin primitivo seguro de reversión parcial)", async () => {
    const { db } = makeMockDb({ tx: txFixture({ loyaltyLedgerId: 500, tokenReservationId: 700 }), items: [itemFixture()] });
    const result = await refundPosSale({ transactionId: 1, lines: [{ itemId: 1, quantity: 1 }], reason: "parcial", refundedByUserId: 9 }, db);
    expect(result.isFullRefund).toBe(false);
    expect(result.tokensReversed).toBe(false);
    expect(result.purchaseRewardReversed).toBe(false);
    expect(mockReverseTransaction).not.toHaveBeenCalled();
    expect(mockReverseTokenSpend).not.toHaveBeenCalled();
  });

  it("#9 reembolso TOTAL sí revierte SegoTokens y recompensa de compra (loyaltyLedgerId + tokenReservationId presentes)", async () => {
    const { db } = makeMockDb({ tx: txFixture({ loyaltyLedgerId: 500, tokenReservationId: 700 }), items: [itemFixture()] });
    const result = await refundPosSale({ transactionId: 1, lines: [{ itemId: 1, quantity: 2 }], reason: "total", refundedByUserId: 9 }, db);
    expect(result.isFullRefund).toBe(true);
    expect(result.tokensReversed).toBe(true);
    expect(result.purchaseRewardReversed).toBe(true);
    expect(mockReverseTransaction).toHaveBeenCalledOnce();
    expect(mockReverseTokenSpend).toHaveBeenCalledOnce();
  });

  it("#10 registra el reembolso en el feed unificado (commerce_refunds), marcado 'partial' correctamente", async () => {
    const { db, getRefunds } = makeMockDb({ items: [itemFixture()] });
    await refundPosSale({ transactionId: 1, lines: [{ itemId: 1, quantity: 1 }], reason: "motivo real", refundedByUserId: 9 }, db);
    const refunds = getRefunds();
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ sourceType: "commerce_transaction", sourceId: 1, partial: true, moneyRefundStatus: "completed" });
  });

  it("#11 reembolso ya revertido (isLedgerEntryReversed=true) no vuelve a revertir el ledger", async () => {
    mockIsLedgerEntryReversed.mockResolvedValueOnce(true);
    const { db } = makeMockDb({ tx: txFixture({ loyaltyLedgerId: 500 }), items: [itemFixture()] });
    await refundPosSale({ transactionId: 1, lines: [{ itemId: 1, quantity: 2 }], reason: "total", refundedByUserId: 9 }, db);
    expect(mockReverseTransaction).not.toHaveBeenCalled();
  });
});
