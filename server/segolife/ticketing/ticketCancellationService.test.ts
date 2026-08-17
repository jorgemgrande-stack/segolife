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

// Pre-16.2 — "Online Event Checkout — SegoTokens + Money": reembolso de una
// compra que aplicó SegoTokens debe devolverlos, mismo primitivo/criterio
// que doorSaleService.refundDoorSale (Pre-16.1).
const { mockReverseTokenSpend } = vi.hoisted(() => ({ mockReverseTokenSpend: vi.fn() }));
vi.mock("../tokens/tokenSpendService", () => ({ reverseTokenSpend: mockReverseTokenSpend }));

// PRE-16.15 BUG-11 — el reembolso de una entrada online ahora debe entrar en
// el feed unificado de reembolsos (mismo primitivo que POS/puerta).
const { mockRecordCommerceRefund } = vi.hoisted(() => ({ mockRecordCommerceRefund: vi.fn() }));
vi.mock("../commerce/refundOrchestrator", () => ({ recordCommerceRefund: mockRecordCommerceRefund }));

import { cancelOrder, refundOrder } from "./ticketCancellationService";
import { eventTickets, ticketPayments, tokenLedger, events } from "../../../drizzle/schema";

function makeMockDb(config: { order: Record<string, unknown>; tickets: Array<Record<string, unknown>>; payment?: Record<string, unknown> | null; purchaseLedgerEntry?: Record<string, unknown> | null; eventRow?: Record<string, unknown> | null }) {
  const b: any = {};
  let currentTable: "orders" | "tickets" | "payments" | "ledger" | "events" = "orders";
  let mode: "select" | "update" = "select";
  b.select = () => { mode = "select"; return b; };
  b.update = () => { mode = "update"; return b; };
  b.set = () => b;
  b.from = (t: unknown) => { currentTable = t === eventTickets ? "tickets" : t === ticketPayments ? "payments" : t === tokenLedger ? "ledger" : t === events ? "events" : "orders"; return b; };
  b.where = () => {
    if (mode === "update") return Promise.resolve([{ affectedRows: 1 }]);
    if (currentTable === "tickets") return Promise.resolve(config.tickets);
    return b;
  };
  b.limit = () => {
    if (currentTable === "orders") return Promise.resolve([config.order]);
    if (currentTable === "payments") return Promise.resolve(config.payment ? [config.payment] : []);
    if (currentTable === "ledger") return Promise.resolve(config.purchaseLedgerEntry ? [config.purchaseLedgerEntry] : []);
    if (currentTable === "events") return Promise.resolve([config.eventRow !== undefined ? config.eventRow : { venueId: 20 }].filter(Boolean));
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
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc", amountCents: 2000 },
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
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc", amountCents: 2000 },
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
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc", amountCents: 2000 },
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
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: null, amountCents: 0 },
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
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc", amountCents: 2000 },
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
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc", amountCents: 2000 },
      purchaseLedgerEntry: { id: 555, sourceType: "ticket", sourceId: 1, direction: "credit" },
    });

    const result = await refundOrder(1, 9, "Cliente lo solicita", db);
    expect(result.reconciliationRequired).toBe(false); // el refund real ya ocurrió, no se revierte por un fallo aquí
  });

  // ─── SegoTokens en el reembolso (Pre-16.2, "Online Event Checkout — SegoTokens + Money") ──

  it("pedido pagado con ST parciales (mixto): el provider solo reembolsa el TRAMO de dinero (amountCents del pago, nunca order.totalCents bruto), y se revierte la reserva de SegoTokens", async () => {
    const refundPayment = vi.fn().mockResolvedValue({ status: "refunded" });
    mockGetPaymentProvider.mockReturnValue({ refundPayment });
    mockReverseTokenSpend.mockResolvedValue({ tokensReserved: 150 });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "refunded", userId: 42, eventId: 5, tokenReservationId: 900 });
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {}, tokenReservationId: 900 },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc", amountCents: 500 }, // 2000 bruto, 1500 ST, 500 dinero
    });

    await refundOrder(1, 9, "Cliente lo solicita", db);

    expect(refundPayment).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 500 })); // NUNCA 2000
    expect(mockReverseTokenSpend).toHaveBeenCalledOnce();
    expect(mockReverseTokenSpend.mock.calls[0][0]).toMatchObject({ reservationId: 900, adminUserId: 9 });
  });

  it("pedido pagado 100% con SegoTokens (moneyDueCents=0): NUNCA llama al provider (nada que cobrar en dinero), pero SÍ revierte los SegoTokens", async () => {
    const refundPayment = vi.fn();
    mockGetPaymentProvider.mockReturnValue({ refundPayment });
    mockReverseTokenSpend.mockResolvedValue({ tokensReserved: 200 });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "refunded", userId: 42, eventId: 5, tokenReservationId: 900 });
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {}, tokenReservationId: 900 },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: null, amountCents: 0 },
    });

    const result = await refundOrder(1, 9, "Cliente lo solicita", db);

    expect(refundPayment).not.toHaveBeenCalled();
    expect(result.reconciliationRequired).toBe(false);
    expect(mockReverseTokenSpend).toHaveBeenCalledOnce();
  });

  it("pedido pagado solo en dinero (sin SegoTokens): NUNCA llama a reverseTokenSpend", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockResolvedValue({ status: "refunded" }) });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "refunded", userId: 42, eventId: 5, tokenReservationId: null });
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {}, tokenReservationId: null },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc", amountCents: 2000 },
    });

    await refundOrder(1, 9, "Cliente lo solicita", db);
    expect(mockReverseTokenSpend).not.toHaveBeenCalled();
  });

  it("reverseTokenSpend falla → el reembolso de dinero ya confirmado NUNCA se deshace (best-effort, mismo criterio que la reversión de recompensa)", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockResolvedValue({ status: "refunded" }) });
    mockReverseTokenSpend.mockRejectedValue(new Error("boom"));
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "refunded", userId: 42, eventId: 5, tokenReservationId: 900 });
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {}, tokenReservationId: 900 },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc", amountCents: 500 },
    });

    const result = await refundOrder(1, 9, "Cliente lo solicita", db);
    expect(result.reconciliationRequired).toBe(false);
  });

  // ─── PRE-16.15 BUG-11 — reembolso online entra en el feed unificado ────────

  it("un reembolso de dinero-solo online registra el hecho en el feed unificado (commerce_refunds) con el BRUTO del pedido, venueId resuelto del evento", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockResolvedValue({ status: "refunded" }) });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "refunded", userId: 42, eventId: 5 });
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {} },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc", amountCents: 2000 },
      eventRow: { venueId: 20 },
    });

    await refundOrder(1, 9, "Cliente lo solicita", db);

    expect(mockRecordCommerceRefund).toHaveBeenCalledOnce();
    expect(mockRecordCommerceRefund.mock.calls[0][0]).toMatchObject({
      sourceType: "ticket_order", sourceId: 1, venueId: 20, eventId: 5, userId: 42,
      amountCents: 2000, moneyRefundStatus: "completed", partial: false,
    });
  });

  it("un reembolso 100% SegoTokens también registra el hecho en el feed unificado, con el BRUTO (nunca 0)", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn() });
    mockReverseTokenSpend.mockResolvedValue({ tokensReserved: 200 });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "refunded", userId: 42, eventId: 5, tokenReservationId: 900 });
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {}, tokenReservationId: 900 },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: null, amountCents: 0 },
    });

    await refundOrder(1, 9, "Cliente lo solicita", db);

    expect(mockRecordCommerceRefund).toHaveBeenCalledOnce();
    expect(mockRecordCommerceRefund.mock.calls[0][0]).toMatchObject({ amountCents: 2000 }); // bruto, no el tramo de dinero (0)
  });

  it("un reintento de idempotencyKey (mismo orderId) usa la MISMA clave estable — nunca duplica la fila en el feed", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockResolvedValue({ status: "refunded" }) });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "refunded", userId: 42, eventId: 5 });
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {} },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc", amountCents: 2000 },
    });

    await refundOrder(1, 9, "Cliente lo solicita", db);
    expect(mockRecordCommerceRefund.mock.calls[0][0]).toMatchObject({ idempotencyKey: "online_refund:1" });
  });

  it("si registrar en el feed unificado falla, el reembolso de dinero/SegoTokens ya real NUNCA se deshace (best-effort)", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockResolvedValue({ status: "refunded" }) });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "refunded", userId: 42, eventId: 5 });
    mockRecordCommerceRefund.mockRejectedValue(new Error("boom"));
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {} },
      tickets: [{ id: 10, status: "issued" }],
      payment: { id: 1, orderId: 1, status: "succeeded", externalPaymentId: "mock_abc", amountCents: 2000 },
    });

    const result = await refundOrder(1, 9, "Cliente lo solicita", db);
    expect(result.reconciliationRequired).toBe(false); // el refund real ya ocurrió, no se revierte por un fallo aquí
  });

  it("order con reconciliation_required (ticket ya usado) NUNCA registra un reembolso en el feed — el dinero no se tocó", async () => {
    mockGetPaymentProvider.mockReturnValue({ refundPayment: vi.fn() });
    mockTransitionOrderStatus.mockResolvedValue({ id: 1, status: "reconciliation_required" });
    const db = makeMockDb({
      order: { id: 1, status: "paid", userId: 42, eventId: 5, totalCents: 2000, metadata: {} },
      tickets: [{ id: 10, status: "used" }],
    });

    await refundOrder(1, 9, "Cliente lo solicita", db);
    expect(mockRecordCommerceRefund).not.toHaveBeenCalled();
  });
});
