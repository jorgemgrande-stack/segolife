/**
 * checkoutService.test.ts — orquestación de initiatePayment (Fase 8, spec
 * puntos 6, 8, 34; recompensa de compra y ticket gratuito añadidos en
 * SEGOLIFE — Native Ticket Sales, spec §18/§33). Mismo patrón vi.mock que
 * campaignService.test.ts de Fase 7: se mockean las dependencias externas
 * (state machine, provider registry, emisión de tickets, engagement,
 * earnTokens/Benefits) y se prueba SOLO la orquestación — cada dependencia
 * ya tiene sus propios tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockTransitionOrderStatus, mockGetPaymentProvider, mockIssueTicketsForOrder, mockEmitEngagementEvent, mockEarnTokens, mockEvaluateBenefitsForOrigin } = vi.hoisted(() => ({
  mockTransitionOrderStatus: vi.fn(),
  mockGetPaymentProvider: vi.fn(),
  mockIssueTicketsForOrder: vi.fn(),
  mockEmitEngagementEvent: vi.fn(),
  mockEarnTokens: vi.fn(),
  mockEvaluateBenefitsForOrigin: vi.fn(),
}));

vi.mock("./orderStateMachine", () => ({
  transitionOrderStatus: mockTransitionOrderStatus,
  OrderStateError: class OrderStateError extends Error { code: string; constructor(code: string, msg: string) { super(msg); this.code = code; } },
}));
vi.mock("./payments/paymentProviderRegistry", () => ({ getPaymentProvider: mockGetPaymentProvider }));
vi.mock("./ticketIssuanceService", () => ({ issueTicketsForOrder: mockIssueTicketsForOrder }));
vi.mock("../engagement/engagementEvents", () => ({ emitEngagementEvent: mockEmitEngagementEvent }));
vi.mock("../tokens/tokenEngine", () => ({ earnTokens: mockEarnTokens }));
vi.mock("../benefits/benefitRuleEngine", () => ({ evaluateBenefitsForOrigin: mockEvaluateBenefitsForOrigin }));

// Pre-16.2 — "Online Event Checkout — SegoTokens + Money".
const { mockReserveTokenSpend, mockCaptureTokenSpend, mockReleaseTokenSpend } = vi.hoisted(() => ({
  mockReserveTokenSpend: vi.fn(),
  mockCaptureTokenSpend: vi.fn(),
  mockReleaseTokenSpend: vi.fn(),
}));
vi.mock("../tokens/tokenSpendService", () => ({
  reserveTokenSpend: mockReserveTokenSpend,
  captureTokenSpend: mockCaptureTokenSpend,
  releaseTokenSpend: mockReleaseTokenSpend,
}));

import { initiatePayment, confirmPaymentByWebhook } from "./checkoutService";
import { ticketOrders, ticketPayments, events } from "../../../drizzle/schema";

function orderFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, userId: 42, eventId: 5, status: "pending", totalCents: 2000, currency: "EUR", metadata: {}, tokenReservationId: null, ...overrides };
}

function reservationFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 900, userId: 42, grossAmountCents: 2000, tokensReserved: 150, promotionalValueCents: 1500, moneyDueCents: 500, status: "reserved", expiresAt: new Date(Date.now() + 15 * 60_000), ...overrides };
}

function makeMockDb(config: { order: Record<string, unknown>; existingPayment?: Record<string, unknown> | null }) {
  const payments: Record<string, unknown>[] = config.existingPayment ? [config.existingPayment] : [];
  let order = config.order;
  let mode: "select" | "update" | "insert" = "select";
  let currentTable: "orders" | "payments" | "events" = "orders";
  let pendingSet: Record<string, unknown> = {};
  const b: any = {};
  b.select = () => { mode = "select"; return b; };
  b.insert = (t: unknown) => { mode = "insert"; currentTable = t === ticketPayments ? "payments" : "orders"; return b; };
  b.update = (t: unknown) => { mode = "update"; currentTable = t === ticketOrders ? "orders" : t === ticketPayments ? "payments" : currentTable; return b; };
  b.ignore = () => b;
  b.from = (t: unknown) => { currentTable = t === ticketPayments ? "payments" : t === events ? "events" : "orders"; return b; };
  b.set = (v: Record<string, unknown>) => { pendingSet = v; return b; };
  // `.where()` es terminal en un UPDATE (aplica pendingSet y resuelve), pero
  // encadenable en un SELECT (sigue hasta `.limit()`) — mismo builder para
  // ambos, como el resto de este archivo ya hacía antes de Pre-16.2.
  b.where = () => {
    if (mode === "update") {
      if (currentTable === "orders") order = { ...order, ...pendingSet };
      return Promise.resolve([{}]);
    }
    return b;
  };
  b.limit = () => {
    if (currentTable === "orders") return Promise.resolve([order]);
    if (currentTable === "events") return Promise.resolve([{ venueId: 10 }]);
    return Promise.resolve(payments.slice(0, 1));
  };
  b.values = (v: Record<string, unknown>) => { payments.push(v); return Promise.resolve([{ insertId: 1 }]); };
  return { db: b as any, getOrder: () => order, getPayments: () => payments };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIssueTicketsForOrder.mockResolvedValue([{ id: 1, qrToken: "tok" }]);
  mockEarnTokens.mockResolvedValue({ ledger: { id: 999 }, wallet: {}, breakdown: {} });
  mockEvaluateBenefitsForOrigin.mockResolvedValue([]);
});

describe("checkoutService — initiatePayment", () => {
  it("provider configurado (mock) confirma inmediatamente → transiciona a paid y emite los tickets", async () => {
    mockGetPaymentProvider.mockReturnValue({ providerKey: "mock", createPayment: vi.fn().mockResolvedValue({ status: "succeeded", externalPaymentId: "mock_123" }) });
    mockTransitionOrderStatus
      .mockResolvedValueOnce(orderFixture({ status: "awaiting_payment" })) // pending -> awaiting_payment
      .mockResolvedValueOnce(orderFixture({ status: "paid" }));           // awaiting_payment -> paid

    const { db } = makeMockDb({ order: orderFixture() });
    const result = await initiatePayment(1, undefined, db);

    expect(result.paymentStatus).toBe("succeeded");
    expect(result.tickets).toHaveLength(1);
    expect(mockIssueTicketsForOrder).toHaveBeenCalledOnce();
    expect(mockEmitEngagementEvent).toHaveBeenCalledWith("ticket_purchased", expect.objectContaining({ orderId: 1 }));
  });

  it("SIN proveedor real (unconfigured, siempre failed) — NUNCA finge un pago, el order vuelve a pending, no se emiten tickets", async () => {
    mockGetPaymentProvider.mockReturnValue({ providerKey: "unconfigured", createPayment: vi.fn().mockResolvedValue({ status: "failed", error: "No configurado" }) });
    mockTransitionOrderStatus
      .mockResolvedValueOnce(orderFixture({ status: "awaiting_payment" }))
      .mockResolvedValueOnce(orderFixture({ status: "pending" })); // vuelta a pending tras el fallo

    const { db } = makeMockDb({ order: orderFixture() });
    const result = await initiatePayment(1, undefined, db);

    expect(result.paymentStatus).toBe("failed");
    expect(mockIssueTicketsForOrder).not.toHaveBeenCalled();
    expect(mockEmitEngagementEvent).not.toHaveBeenCalled();
  });

  it("idempotente — si ya existe un ticket_payments succeeded para este order, no vuelve a llamar al provider", async () => {
    mockGetPaymentProvider.mockReturnValue({ providerKey: "mock", createPayment: vi.fn() });
    const { db } = makeMockDb({ order: orderFixture(), existingPayment: { orderId: 1, status: "succeeded" } });

    const result = await initiatePayment(1, undefined, db);

    expect(result.paymentStatus).toBe("succeeded");
    expect(mockGetPaymentProvider().createPayment).not.toHaveBeenCalled();
    expect(mockIssueTicketsForOrder).toHaveBeenCalledOnce();
  });

  // ─── Recompensa de compra (SEGOLIFE — Native Ticket Sales, spec §18) ───────

  it("pago confirmado → concede recompensa vía earnTokens(origin='ticket'), monto en euros, idempotencyKey estable, y evalúa Benefits", async () => {
    mockGetPaymentProvider.mockReturnValue({ providerKey: "mock", createPayment: vi.fn().mockResolvedValue({ status: "succeeded", externalPaymentId: "mock_123" }) });
    mockTransitionOrderStatus
      .mockResolvedValueOnce(orderFixture({ status: "awaiting_payment" }))
      .mockResolvedValueOnce(orderFixture({ status: "paid" }));

    const { db } = makeMockDb({ order: orderFixture({ totalCents: 2000 }) });
    await initiatePayment(1, undefined, db);

    expect(mockEarnTokens).toHaveBeenCalledOnce();
    expect(mockEarnTokens.mock.calls[0][0]).toMatchObject({
      userId: 42, origin: "ticket", eventId: 5, venueId: 10, amountSpent: 20, sourceId: 1,
      idempotencyKey: "ticket_purchase:segolife_native:1",
    });
    expect(mockEvaluateBenefitsForOrigin).toHaveBeenCalledOnce();
    expect(mockEvaluateBenefitsForOrigin.mock.calls[0][0]).toMatchObject({ type: "ticket", userId: 42, ledgerId: 999 });
  });

  it("earnTokens falla (p.ej. regla desactivada) → el pedido queda igualmente pagado y con tickets emitidos", async () => {
    mockGetPaymentProvider.mockReturnValue({ providerKey: "mock", createPayment: vi.fn().mockResolvedValue({ status: "succeeded", externalPaymentId: "mock_123" }) });
    mockTransitionOrderStatus
      .mockResolvedValueOnce(orderFixture({ status: "awaiting_payment" }))
      .mockResolvedValueOnce(orderFixture({ status: "paid" }));
    mockEarnTokens.mockRejectedValue(new Error("NO_RULE_FOUND"));

    const { db } = makeMockDb({ order: orderFixture() });
    const result = await initiatePayment(1, undefined, db);

    expect(result.paymentStatus).toBe("succeeded");
    expect(result.tickets).toHaveLength(1);
    expect(mockEvaluateBenefitsForOrigin).toHaveBeenCalledOnce(); // sigue evaluándose con ledgerId=null
  });

  // ─── Ticket gratuito (spec §33) ─────────────────────────────────────────

  it("ticket gratuito (totalCents=0) NUNCA llama al PaymentProvider — se confirma con una transición interna directa", async () => {
    const createPayment = vi.fn();
    mockGetPaymentProvider.mockReturnValue({ providerKey: "mock", createPayment });
    mockTransitionOrderStatus
      .mockResolvedValueOnce(orderFixture({ status: "awaiting_payment", totalCents: 0 }))
      .mockResolvedValueOnce(orderFixture({ status: "paid", totalCents: 0 }));

    const { db } = makeMockDb({ order: orderFixture({ totalCents: 0 }) });
    const result = await initiatePayment(1, undefined, db);

    expect(createPayment).not.toHaveBeenCalled();
    expect(result.paymentStatus).toBe("succeeded");
    expect(result.tickets).toHaveLength(1);
    // 0€ → earnTokens se sigue llamando (amountSpent=0), pero conceptualmente concede 0 tokens vía el cálculo per_euro real del motor — no hay caso especial aquí.
    expect(mockEarnTokens.mock.calls[0][0]).toMatchObject({ amountSpent: 0 });
  });
});

// ─── Pre-16.2 — "Online Event Checkout — SegoTokens + Money" ───────────────
// reserveAndCaptureTokenSpend() ya no se usa aquí — el motor de dos pasos
// (reserve → capture SOLO cuando el dinero restante se confirma) es el
// mismo que Pre-16.1 ya conectó al pago presencial, nunca uno nuevo.
describe("checkoutService — initiatePayment con SegoTokens parciales/totales (Pre-16.2)", () => {
  beforeEach(() => {
    mockReleaseTokenSpend.mockResolvedValue(reservationFixture({ status: "released" }));
  });

  it("pago mixto: reserva SegoTokens, cobra al provider SOLO el dinero restante (nunca el bruto), y captura tras confirmar", async () => {
    const reservation = reservationFixture({ moneyDueCents: 500 }); // ticket 2000, ST cubre 1500, restan 500
    mockReserveTokenSpend.mockResolvedValue({ status: "reserved", reservation });
    mockCaptureTokenSpend.mockResolvedValue({ reservation: { ...reservation, status: "captured" }, alreadyCaptured: false });
    const createPayment = vi.fn().mockResolvedValue({ status: "succeeded", externalPaymentId: "mock_456" });
    mockGetPaymentProvider.mockReturnValue({ providerKey: "mock", createPayment });
    mockTransitionOrderStatus
      .mockResolvedValueOnce(orderFixture({ status: "awaiting_payment" }))
      .mockResolvedValueOnce(orderFixture({ status: "paid" }));

    const { db, getPayments } = makeMockDb({ order: orderFixture({ totalCents: 2000 }) });
    const result = await initiatePayment(1, 150, db);

    expect(mockReserveTokenSpend).toHaveBeenCalledOnce();
    expect(mockReserveTokenSpend.mock.calls[0][0]).toMatchObject({ userId: 42, requestedTokens: 150, grossAmountCents: 2000, referenceType: "ticket_order" });
    expect(createPayment).toHaveBeenCalledOnce();
    expect(createPayment.mock.calls[0][0]).toMatchObject({ amountCents: 500 }); // NUNCA 2000 (bruto)
    expect(mockCaptureTokenSpend).toHaveBeenCalledWith(reservation.id, expect.anything());
    expect(result.paymentStatus).toBe("succeeded");
    expect(mockTransitionOrderStatus.mock.calls[1][3]).toMatchObject({ paymentMethod: "mixed", tokenReservationId: reservation.id });
    // ticket_payments.amountCents representa el tramo de DINERO, no el bruto.
    expect(getPayments()[0]).toMatchObject({ amountCents: 500 });
  });

  it("100% SegoTokens: moneyDueCents=0, NUNCA llama al provider, captura igualmente", async () => {
    const reservation = reservationFixture({ moneyDueCents: 0, tokensReserved: 200, promotionalValueCents: 2000 });
    mockReserveTokenSpend.mockResolvedValue({ status: "reserved", reservation });
    mockCaptureTokenSpend.mockResolvedValue({ reservation: { ...reservation, status: "captured" }, alreadyCaptured: false });
    const createPayment = vi.fn();
    mockGetPaymentProvider.mockReturnValue({ providerKey: "mock", createPayment });
    mockTransitionOrderStatus
      .mockResolvedValueOnce(orderFixture({ status: "awaiting_payment" }))
      .mockResolvedValueOnce(orderFixture({ status: "paid" }));

    const { db, getPayments } = makeMockDb({ order: orderFixture({ totalCents: 2000 }) });
    const result = await initiatePayment(1, 200, db);

    expect(createPayment).not.toHaveBeenCalled();
    expect(mockCaptureTokenSpend).toHaveBeenCalledWith(reservation.id, expect.anything());
    expect(result.paymentStatus).toBe("succeeded");
    expect(mockTransitionOrderStatus.mock.calls[1][3]).toMatchObject({ paymentMethod: "segotokens" });
    expect(getPayments()[0]).toMatchObject({ provider: "segolife_native_segotokens", amountCents: 0 });
  });

  it("el provider rechaza el tramo de dinero restante: LIBERA la reserva (nunca revierte, todavía no se capturó nada) y el pedido vuelve a pending", async () => {
    const reservation = reservationFixture({ moneyDueCents: 500 });
    mockReserveTokenSpend.mockResolvedValue({ status: "reserved", reservation });
    mockGetPaymentProvider.mockReturnValue({ providerKey: "mock", createPayment: vi.fn().mockResolvedValue({ status: "failed", error: "rechazado" }) });
    mockTransitionOrderStatus
      .mockResolvedValueOnce(orderFixture({ status: "awaiting_payment" }))
      .mockResolvedValueOnce(orderFixture({ status: "pending" }));

    const { db } = makeMockDb({ order: orderFixture({ totalCents: 2000 }) });
    const result = await initiatePayment(1, 150, db);

    expect(result.paymentStatus).toBe("failed");
    expect(mockReleaseTokenSpend).toHaveBeenCalledWith(reservation.id, expect.any(String), expect.anything());
    expect(mockCaptureTokenSpend).not.toHaveBeenCalled();
    expect(mockIssueTicketsForOrder).not.toHaveBeenCalled();
  });

  it("reserva no disponible (saldo insuficiente/sin política): TOKEN_SPEND_FAILED, nunca llega a tocar al provider", async () => {
    mockReserveTokenSpend.mockResolvedValue({ status: "invalid_amount" });
    mockGetPaymentProvider.mockReturnValue({ providerKey: "mock", createPayment: vi.fn() });

    const { db } = makeMockDb({ order: orderFixture() });
    await expect(initiatePayment(1, 999999, db)).rejects.toMatchObject({ code: "TOKEN_SPEND_FAILED" });
    expect(mockGetPaymentProvider().createPayment).not.toHaveBeenCalled();
  });

  it("el dinero se confirma pero la captura de SegoTokens falla (p.ej. reserva expirada en el tramo hospedado): el pedido completa igual — el dinero ya es real, nunca se le niega el ticket al Student", async () => {
    const reservation = reservationFixture({ moneyDueCents: 500 });
    mockReserveTokenSpend.mockResolvedValue({ status: "reserved", reservation });
    mockCaptureTokenSpend.mockRejectedValue(new Error("RESERVATION_EXPIRED"));
    mockGetPaymentProvider.mockReturnValue({ providerKey: "mock", createPayment: vi.fn().mockResolvedValue({ status: "succeeded", externalPaymentId: "mock_789" }) });
    mockTransitionOrderStatus
      .mockResolvedValueOnce(orderFixture({ status: "awaiting_payment" }))
      .mockResolvedValueOnce(orderFixture({ status: "paid" }));

    const { db } = makeMockDb({ order: orderFixture({ totalCents: 2000 }) });
    const result = await initiatePayment(1, 150, db);

    expect(result.paymentStatus).toBe("succeeded");
    expect(result.tickets).toHaveLength(1);
  });

  it("proveedor con checkout hospedado (pending+redirectUrl): enlaza tokenReservationId al pedido YA, sin esperar al webhook, y NUNCA captura todavía", async () => {
    const reservation = reservationFixture({ moneyDueCents: 500 });
    mockReserveTokenSpend.mockResolvedValue({ status: "reserved", reservation });
    mockGetPaymentProvider.mockReturnValue({ providerKey: "hosted", createPayment: vi.fn().mockResolvedValue({ status: "pending", redirectUrl: "https://pay.example/session/abc" }) });
    mockTransitionOrderStatus.mockResolvedValueOnce(orderFixture({ status: "awaiting_payment" }));

    const { db, getOrder } = makeMockDb({ order: orderFixture({ totalCents: 2000 }) });
    const result = await initiatePayment(1, 150, db);

    expect(result.paymentStatus).toBe("pending");
    expect(result.redirectUrl).toBe("https://pay.example/session/abc");
    expect(mockCaptureTokenSpend).not.toHaveBeenCalled();
    expect(getOrder()).toMatchObject({ tokenReservationId: reservation.id });
  });

  it("dinero-solo (0 ST): comportamiento intacto, nunca reserva/toca el motor de tokens", async () => {
    mockGetPaymentProvider.mockReturnValue({ providerKey: "mock", createPayment: vi.fn().mockResolvedValue({ status: "succeeded", externalPaymentId: "mock_123" }) });
    mockTransitionOrderStatus
      .mockResolvedValueOnce(orderFixture({ status: "awaiting_payment" }))
      .mockResolvedValueOnce(orderFixture({ status: "paid" }));

    const { db } = makeMockDb({ order: orderFixture({ totalCents: 2000 }) });
    await initiatePayment(1, undefined, db);

    expect(mockReserveTokenSpend).not.toHaveBeenCalled();
    expect(mockCaptureTokenSpend).not.toHaveBeenCalled();
    expect(mockReleaseTokenSpend).not.toHaveBeenCalled();
  });
});

describe("checkoutService — confirmPaymentByWebhook con SegoTokens diferidos (Pre-16.2)", () => {
  it("si el pedido llegó a awaiting_payment con una reserva de SegoTokens enlazada, el webhook la captura ANTES de finalizar", async () => {
    mockCaptureTokenSpend.mockResolvedValue({ reservation: reservationFixture({ status: "captured" }), alreadyCaptured: false });
    mockTransitionOrderStatus.mockResolvedValueOnce(orderFixture({ status: "paid" }));

    const { db } = makeMockDb({ order: orderFixture({ status: "awaiting_payment", tokenReservationId: 900 }) });
    const result = await confirmPaymentByWebhook(1, "ext_123", db);

    expect(mockCaptureTokenSpend).toHaveBeenCalledWith(900, expect.anything());
    expect(result.paymentStatus).toBe("succeeded");
    expect(result.tickets).toHaveLength(1);
  });

  it("sin reserva de SegoTokens enlazada: nunca toca el motor de tokens (pedido de solo dinero, comportamiento intacto)", async () => {
    mockTransitionOrderStatus.mockResolvedValueOnce(orderFixture({ status: "paid" }));
    const { db } = makeMockDb({ order: orderFixture({ status: "awaiting_payment", tokenReservationId: null }) });
    await confirmPaymentByWebhook(1, "ext_123", db);
    expect(mockCaptureTokenSpend).not.toHaveBeenCalled();
  });

  it("la captura vía webhook falla: el pedido completa igual (dinero ya confirmado por el provider real)", async () => {
    mockCaptureTokenSpend.mockRejectedValue(new Error("RESERVATION_EXPIRED"));
    mockTransitionOrderStatus.mockResolvedValueOnce(orderFixture({ status: "paid" }));
    const { db } = makeMockDb({ order: orderFixture({ status: "awaiting_payment", tokenReservationId: 900 }) });
    const result = await confirmPaymentByWebhook(1, "ext_123", db);
    expect(result.paymentStatus).toBe("succeeded");
  });
});
