/**
 * checkoutService.test.ts — orquestación de initiatePayment (Fase 8, spec
 * puntos 6, 8, 34). Mismo patrón vi.mock que campaignService.test.ts de
 * Fase 7: se mockean las dependencias externas (state machine, provider
 * registry, emisión de tickets, engagement) y se prueba SOLO la
 * orquestación — cada dependencia ya tiene sus propios tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockTransitionOrderStatus, mockGetPaymentProvider, mockIssueTicketsForOrder, mockEmitEngagementEvent } = vi.hoisted(() => ({
  mockTransitionOrderStatus: vi.fn(),
  mockGetPaymentProvider: vi.fn(),
  mockIssueTicketsForOrder: vi.fn(),
  mockEmitEngagementEvent: vi.fn(),
}));

vi.mock("./orderStateMachine", () => ({
  transitionOrderStatus: mockTransitionOrderStatus,
  OrderStateError: class OrderStateError extends Error { code: string; constructor(code: string, msg: string) { super(msg); this.code = code; } },
}));
vi.mock("./payments/paymentProviderRegistry", () => ({ getPaymentProvider: mockGetPaymentProvider }));
vi.mock("./ticketIssuanceService", () => ({ issueTicketsForOrder: mockIssueTicketsForOrder }));
vi.mock("../engagement/engagementEvents", () => ({ emitEngagementEvent: mockEmitEngagementEvent }));

import { initiatePayment } from "./checkoutService";
import { ticketOrders, ticketPayments } from "../../../drizzle/schema";

function orderFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, userId: 42, eventId: 5, status: "pending", totalCents: 2000, currency: "EUR", metadata: {}, ...overrides };
}

function makeMockDb(config: { order: Record<string, unknown>; existingPayment?: Record<string, unknown> | null }) {
  const payments: Record<string, unknown>[] = config.existingPayment ? [config.existingPayment] : [];
  let currentTable: "orders" | "payments" = "orders";
  const b: any = {};
  b.select = () => b;
  b.insert = (t: unknown) => { currentTable = t === ticketPayments ? "payments" : "orders"; return b; };
  b.update = () => b;
  b.ignore = () => b;
  b.from = (t: unknown) => { currentTable = t === ticketPayments ? "payments" : "orders"; return b; };
  b.where = () => b;
  b.set = () => Promise.resolve([{}]);
  b.limit = () => {
    if (currentTable === "orders") return Promise.resolve([config.order]);
    return Promise.resolve(payments.slice(0, 1));
  };
  b.values = (v: Record<string, unknown>) => { payments.push(v); return Promise.resolve([{ insertId: 1 }]); };
  return b as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIssueTicketsForOrder.mockResolvedValue([{ id: 1, qrToken: "tok" }]);
});

describe("checkoutService — initiatePayment", () => {
  it("provider configurado (mock) confirma inmediatamente → transiciona a paid y emite los tickets", async () => {
    mockGetPaymentProvider.mockReturnValue({ providerKey: "mock", createPayment: vi.fn().mockResolvedValue({ status: "succeeded", externalPaymentId: "mock_123" }) });
    mockTransitionOrderStatus
      .mockResolvedValueOnce(orderFixture({ status: "awaiting_payment" })) // pending -> awaiting_payment
      .mockResolvedValueOnce(orderFixture({ status: "paid" }));           // awaiting_payment -> paid

    const db = makeMockDb({ order: orderFixture() });
    const result = await initiatePayment(1, db);

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

    const db = makeMockDb({ order: orderFixture() });
    const result = await initiatePayment(1, db);

    expect(result.paymentStatus).toBe("failed");
    expect(mockIssueTicketsForOrder).not.toHaveBeenCalled();
    expect(mockEmitEngagementEvent).not.toHaveBeenCalled();
  });

  it("idempotente — si ya existe un ticket_payments succeeded para este order, no vuelve a llamar al provider", async () => {
    mockGetPaymentProvider.mockReturnValue({ providerKey: "mock", createPayment: vi.fn() });
    const db = makeMockDb({ order: orderFixture(), existingPayment: { orderId: 1, status: "succeeded" } });

    const result = await initiatePayment(1, db);

    expect(result.paymentStatus).toBe("succeeded");
    expect(mockGetPaymentProvider().createPayment).not.toHaveBeenCalled();
    expect(mockIssueTicketsForOrder).toHaveBeenCalledOnce();
  });
});
