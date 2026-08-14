/**
 * ticketCancellationService.test.ts — cancelación/reembolso (Fase 8, spec
 * punto 18; reversión de la recompensa de compra añadida en SEGOLIFE —
 * Native Ticket Sales, spec §21). La regla crítica: si algún ticket del
 * order ya se usó (asistió al evento), el reembolso NUNCA se procesa
 * automáticamente — queda reconciliation_required, sin tocar SegoTokens/
 * Benefits (política comercial no definida, "nunca improvisar").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockTransitionOrderStatus, mockGetPaymentProvider, mockReverseTransaction, mockIsLedgerEntryReversed } = vi.hoisted(() => ({
  mockTransitionOrderStatus: vi.fn(),
  mockGetPaymentProvider: vi.fn(),
  mockReverseTransaction: vi.fn(),
  mockIsLedgerEntryReversed: vi.fn(),
}));
vi.mock("./orderStateMachine", () => ({
  transitionOrderStatus: mockTransitionOrderStatus,
  OrderStateError: class OrderStateError extends Error { code: string; constructor(code: string, msg: string) { super(msg); this.code = code; } },
}));
vi.mock("./payments/paymentProviderRegistry", () => ({ getPaymentProvider: mockGetPaymentProvider }));
vi.mock("../engagement/engagementEvents", () => ({ emitEngagementEvent: vi.fn() }));
vi.mock("../tokens/tokenLedgerService", () => ({ reverseTransaction: mockReverseTransaction, isLedgerEntryReversed: mockIsLedgerEntryReversed }));

import { cancelOrder, refundOrder } from "./ticketCancellationService";
import { eventTickets, ticketPayments, tokenLedger } from "../../../drizzle/schema";

function makeMockDb(config: { order: Record<string, unknown>; tickets: Array<Record<string, unknown>>; payment?: Record<string, unknown> | null; purchaseLedgerEntry?: Record<string, unknown> | null }) {
  const b: any = {};
  let currentTable: "orders" | "tickets" | "payments" | "ledger" = "orders";
  let mode: "select" | "update" = "select";
  b.select = () => { mode = "select"; return b; };
  b.update = () => { mode = "update"; return b; };
  b.set = () => b;
  b.from = (t: unknown) => { currentTable = t === eventTickets ? "tickets" : t === ticketPayments ? "payments" : t === tokenLedger ? "ledger" : "orders"; return b; };
  b.where = () => {
    if (mode === "update") return Promise.resolve([{ affectedRows: 1 }]);
    if (currentTable === "tickets") return Promise.resolve(config.tickets);
    return b;
  };
  b.limit = () => {
    if (currentTable === "orders") return Promise.resolve([config.order]);
    if (currentTable === "payments") return Promise.resolve(config.payment ? [config.payment] : []);
    if (currentTable === "ledger") return Promise.resolve(config.purchaseLedgerEntry ? [config.purchaseLedgerEntry] : []);
    return Promise.resolve([]);
  };
  return b as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsLedgerEntryReversed.mockResolvedValue(false);
});

describe("ticketCancellationService — cancelOrder", () => {
  it("cancela un order pending/awaiting_payment", async () => {
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "cancelled" });
    const result = await cancelOrder(1, 9);
    expect(result.status).toBe("cancelled");
  });
});

describe("ticketCancellationService — refundOrder", () => {
  it("order paid SIN ningún ticket usado → reembolso real (provider) + tickets no usados pasan a refunded", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockResolvedValue({ status: "refunded" }) });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "refunded", userId: 42, eventId: 5 });
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {} },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc" },
    });

    const result = await refundOrder(1, 9, "Cliente lo solicita", db);

    expect(result.reconciliationRequired).toBe(false);
    expect(mockGetPaymentProvider().refundPayment).toHaveBeenCalledOnce();
  });

  it("order paid CON algún ticket ya usado → reconciliation_required, NUNCA llama a refundPayment (política comercial no definida)", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn() });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "reconciliation_required" });
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {} },
      tickets: [{ id: 10, status: "used" }], // ya asistió
    });

    const result = await refundOrder(1, 9, "Cliente lo solicita", db);

    expect(result.reconciliationRequired).toBe(true);
    expect(mockGetPaymentProvider().refundPayment).not.toHaveBeenCalled();
    expect(mockTransitionOrderStatus).toHaveBeenCalledWith(1, ["paid"], "reconciliation_required", expect.anything(), db);
  });

  it("si el provider de pago falla el reembolso real, también queda reconciliation_required (nunca se finge un reembolso)", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockResolvedValue({ status: "failed", error: "No configurado" }) });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "reconciliation_required" });
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {} },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc" },
    });

    const result = await refundOrder(1, 9, "Cliente lo solicita", db);
    expect(result.reconciliationRequired).toBe(true);
  });

  // ─── Reversión de la recompensa de compra (SEGOLIFE — Native Ticket Sales, spec §21) ──

  it("order pagado con recompensa de compra ya concedida → reembolso también revierte esa recompensa vía reverseTransaction", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockResolvedValue({ status: "refunded" }) });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "refunded", userId: 42, eventId: 5 });
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {} },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc" },
      purchaseLedgerEntry: { id: 555, sourceType: "ticket", sourceId: 1, direction: "credit" },
    });

    await refundOrder(1, 9, "Cliente lo solicita", db);

    expect(mockReverseTransaction).toHaveBeenCalledOnce();
    expect(mockReverseTransaction.mock.calls[0][0]).toMatchObject({ ledgerId: 555, adminUserId: 9 });
  });

  it("ticket gratuito (nunca concedió recompensa) → refund normal, reverseTransaction NUNCA se llama", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockResolvedValue({ status: "refunded" }) });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "refunded", userId: 42, eventId: 5 });
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 0, metadata: {} },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: null },
      purchaseLedgerEntry: null,
    });

    await refundOrder(1, 9, "Cliente lo solicita", db);
    expect(mockReverseTransaction).not.toHaveBeenCalled();
  });

  it("recompensa ya revertida anteriormente (isLedgerEntryReversed=true) → idempotente, no vuelve a llamar a reverseTransaction", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockResolvedValue({ status: "refunded" }) });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "refunded", userId: 42, eventId: 5 });
    mockIsLedgerEntryReversed.mockResolvedValue(true);
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {} },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc" },
      purchaseLedgerEntry: { id: 555, sourceType: "ticket", sourceId: 1, direction: "credit" },
    });

    await refundOrder(1, 9, "Cliente lo solicita", db);
    expect(mockReverseTransaction).not.toHaveBeenCalled();
  });

  it("reverseTransaction falla → el reembolso real ya confirmado NUNCA se deshace (best-effort)", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockResolvedValue({ status: "refunded" }) });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "refunded", userId: 42, eventId: 5 });
    mockReverseTransaction.mockRejectedValue(new Error("boom"));
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {} },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc" },
      purchaseLedgerEntry: { id: 555, sourceType: "ticket", sourceId: 1, direction: "credit" },
    });

    const result = await refundOrder(1, 9, "Cliente lo solicita", db);
    expect(result.reconciliationRequired).toBe(false); // el refund real ya ocurrió, no se revierte por un fallo aquí
  });
});
