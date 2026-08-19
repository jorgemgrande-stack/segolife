/**
 * tokenClawbackReconciliationService.test.ts — FIX-01. `findActiveGrantBySource`/
 * `reverseTransaction`/`reverseTokenSpend` se mockean como unidades ya
 * probadas por su cuenta (tokenLedgerService.test.ts, tokenSpendService.test.ts)
 * — este archivo prueba solo la ORQUESTACIÓN: qué orders se seleccionan como
 * candidatos, cuáles se marcan resueltos, cuáles siguen pendientes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindActiveGrantBySource, mockReverseTransaction, mockReverseTokenSpend } = vi.hoisted(() => ({
  mockFindActiveGrantBySource: vi.fn(),
  mockReverseTransaction: vi.fn(),
  mockReverseTokenSpend: vi.fn(),
}));

vi.mock("./tokenLedgerService", () => ({
  findActiveGrantBySource: mockFindActiveGrantBySource,
  reverseTransaction: mockReverseTransaction,
}));
vi.mock("./tokenSpendService", () => ({
  reverseTokenSpend: mockReverseTokenSpend,
}));

import { retryPendingTokenClawbacks } from "./tokenClawbackReconciliationService";

/**
 * Mock de `ticketOrders` — un único builder encadenable que distingue
 * select/update por el último verbo invocado (`mode`) y resuelve cada
 * select con el siguiente array de la cola, en el ORDEN real en que el
 * código bajo test los pide: 1) candidatos (status IN + orderBy + limit);
 * 2) por cada candidato pendiente, un select de metadata actual + un
 * update (clearPendingMarker o markStillPending, según si falla o no).
 */
function makeOrdersMockDb() {
  const selectQueue: Array<Array<Record<string, unknown>>> = [];
  const updateLog: Array<Record<string, unknown>> = [];
  let mode: "select" | "update" | null = null;

  const builder: Record<string, unknown> = {};
  builder.select = () => { mode = "select"; return builder; };
  builder.from = () => builder;
  builder.where = () => builder;
  builder.orderBy = () => builder;
  builder.limit = () => builder;
  builder.update = () => { mode = "update"; return builder; };
  builder.set = (fields: Record<string, unknown>) => { updateLog.push(fields); return builder; };
  builder.then = (resolve: (v: unknown) => void) => {
    if (mode === "update") { mode = null; return resolve(undefined); }
    mode = null;
    return resolve(selectQueue.shift() ?? []);
  };

  return {
    db: builder as never,
    queueSelect: (rows: Array<Record<string, unknown>>) => selectQueue.push(rows),
    getUpdateLog: () => updateLog,
  };
}

function order(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, userId: 42, eventId: 5, status: "refunded", tokenReservationId: null,
    metadata: { loyaltyReconciliationRequired: true, loyaltyReversalError: "ECONNRESET transitorio" },
    updatedAt: new Date("2026-08-19"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("retryPendingTokenClawbacks — selección de candidatos", () => {
  it("ignora orders refunded/partially_refunded SIN la marca de clawback pendiente — no-op limpio", async () => {
    const { db, queueSelect, getUpdateLog } = makeOrdersMockDb();
    queueSelect([order({ id: 1, metadata: {} }), order({ id: 2, metadata: null })]);
    const result = await retryPendingTokenClawbacks(db);
    expect(result).toEqual({ processed: 0, resolved: 0, stillPending: 0, candidateOrderIds: [] });
    expect(getUpdateLog()).toHaveLength(0);
    expect(mockFindActiveGrantBySource).not.toHaveBeenCalled();
  });

  it("un order marcado pendiente, con grant activo, se reintenta con éxito → marca limpiada (loyaltyReconciliationRequired=false)", async () => {
    const { db, queueSelect, getUpdateLog } = makeOrdersMockDb();
    queueSelect([order({ id: 10, userId: 42 })]);
    mockFindActiveGrantBySource.mockResolvedValue({ ledgerId: 501, amount: 100 });
    mockReverseTransaction.mockResolvedValue({ wallet: {}, ledger: {} });
    queueSelect([{ metadata: { loyaltyReconciliationRequired: true } }]); // clearPendingMarker: metadata actual
    const result = await retryPendingTokenClawbacks(db);
    expect(result).toEqual({ processed: 1, resolved: 1, stillPending: 0, candidateOrderIds: [10] });
    expect(mockReverseTransaction).toHaveBeenCalledWith(expect.objectContaining({ ledgerId: 501, adminUserId: null }), db);
    expect(getUpdateLog()[0].metadata).toMatchObject({ loyaltyReconciliationRequired: false });
    expect(getUpdateLog()[0].metadata).toHaveProperty("loyaltyReversalReconciledAt");
  });

  it("el grant ya fue revertido por otra vía (findActiveGrantBySource → null) — se considera resuelto, sin llamar a reverseTransaction", async () => {
    const { db, queueSelect } = makeOrdersMockDb();
    queueSelect([order({ id: 11, userId: 42 })]);
    mockFindActiveGrantBySource.mockResolvedValue(null); // ya no hay nada activo que revertir
    queueSelect([{ metadata: {} }]);
    const result = await retryPendingTokenClawbacks(db);
    expect(result.resolved).toBe(1);
    expect(mockReverseTransaction).not.toHaveBeenCalled();
  });

  it("reverseTransaction vuelve a fallar (siguiente fallo transitorio) — sigue marcado como pendiente, error actualizado", async () => {
    const { db, queueSelect, getUpdateLog } = makeOrdersMockDb();
    queueSelect([order({ id: 12, userId: 42 })]);
    mockFindActiveGrantBySource.mockResolvedValue({ ledgerId: 501, amount: 100 });
    mockReverseTransaction.mockRejectedValue(new Error("ETIMEDOUT — DB no disponible"));
    queueSelect([{ metadata: {} }]); // markStillPending: metadata actual
    const result = await retryPendingTokenClawbacks(db);
    expect(result).toEqual({ processed: 1, resolved: 0, stillPending: 1, candidateOrderIds: [12] });
    expect(getUpdateLog()[0].metadata).toMatchObject({ loyaltyReconciliationRequired: true, loyaltyReversalError: "ETIMEDOUT — DB no disponible" });
  });

  it("un order con tokenReservationId también reintenta reverseTokenSpend, además de la recompensa de compra", async () => {
    const { db, queueSelect } = makeOrdersMockDb();
    queueSelect([order({ id: 13, userId: 42, tokenReservationId: 777 })]);
    mockFindActiveGrantBySource.mockResolvedValue({ ledgerId: 501, amount: 100 });
    mockReverseTransaction.mockResolvedValue({ wallet: {}, ledger: {} });
    mockReverseTokenSpend.mockResolvedValue({ status: "reversed" });
    queueSelect([{ metadata: {} }]);
    const result = await retryPendingTokenClawbacks(db);
    expect(result.resolved).toBe(1);
    expect(mockReverseTokenSpend).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 777, adminUserId: null }), db);
  });

  it("varios orders pendientes en el mismo barrido — cada uno se procesa de forma independiente (uno resuelve, otro sigue pendiente)", async () => {
    const { db, queueSelect } = makeOrdersMockDb();
    queueSelect([order({ id: 20, userId: 1 }), order({ id: 21, userId: 2 })]);
    mockFindActiveGrantBySource
      .mockResolvedValueOnce({ ledgerId: 601, amount: 50 })
      .mockResolvedValueOnce({ ledgerId: 602, amount: 75 });
    mockReverseTransaction
      .mockResolvedValueOnce({ wallet: {}, ledger: {} })
      .mockRejectedValueOnce(new Error("fallo transitorio del segundo"));
    queueSelect([{ metadata: {} }]); // clearPendingMarker del order 20
    queueSelect([{ metadata: {} }]); // markStillPending del order 21
    const result = await retryPendingTokenClawbacks(db);
    expect(result).toEqual({ processed: 2, resolved: 1, stillPending: 1, candidateOrderIds: [20, 21] });
  });

  it("un order sin userId (comprador anónimo de puerta) y sin tokenReservationId — no-op limpio, se marca resuelto sin llamar a nada", async () => {
    const { db, queueSelect } = makeOrdersMockDb();
    queueSelect([order({ id: 30, userId: null, tokenReservationId: null, metadata: { loyaltyReconciliationRequired: true } })]);
    queueSelect([{ metadata: {} }]);
    const result = await retryPendingTokenClawbacks(db);
    expect(result.resolved).toBe(1);
    expect(mockFindActiveGrantBySource).not.toHaveBeenCalled();
    expect(mockReverseTokenSpend).not.toHaveBeenCalled();
  });
});
