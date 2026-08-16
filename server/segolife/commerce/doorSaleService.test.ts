/**
 * doorSaleService.test.ts — SEGOLIFE COMMERCE CORE (Fase 9). Mockea los
 * colaboradores YA probados en sus propios módulos (inventoryHoldService,
 * orderStateMachine, ticketIssuanceService, attendancePipeline,
 * checkoutService, tokenSpendService) — aquí se prueba SOLO la orquestación
 * propia: qué llama, en qué orden, y cómo compensa ante fallos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateHold } = vi.hoisted(() => ({ mockCreateHold: vi.fn() }));
vi.mock("../ticketing/inventoryHoldService", () => ({
  createHold: mockCreateHold,
  CheckoutError: class CheckoutError extends Error { constructor(public code: string, message: string) { super(message); } },
}));

const { mockTransitionOrderStatus } = vi.hoisted(() => ({ mockTransitionOrderStatus: vi.fn() }));
vi.mock("../ticketing/orderStateMachine", () => ({
  transitionOrderStatus: mockTransitionOrderStatus,
  OrderStateError: class OrderStateError extends Error { constructor(public code: string, message: string) { super(message); } },
}));

const { mockIssueTicketsForOrder } = vi.hoisted(() => ({ mockIssueTicketsForOrder: vi.fn() }));
vi.mock("../ticketing/ticketIssuanceService", () => ({ issueTicketsForOrder: mockIssueTicketsForOrder }));

const { mockGrantNativePurchaseReward } = vi.hoisted(() => ({ mockGrantNativePurchaseReward: vi.fn() }));
vi.mock("../ticketing/checkoutService", () => ({ grantNativePurchaseReward: mockGrantNativePurchaseReward }));

const { mockReverseNativePurchaseReward } = vi.hoisted(() => ({ mockReverseNativePurchaseReward: vi.fn() }));
vi.mock("../ticketing/ticketCancellationService", () => ({ reverseNativePurchaseReward: mockReverseNativePurchaseReward }));

const { mockIngestAttendance } = vi.hoisted(() => ({ mockIngestAttendance: vi.fn() }));
vi.mock("../ticketing/attendancePipeline", () => ({ ingestAttendance: mockIngestAttendance }));

const { mockIsEventCurrentlyOpen } = vi.hoisted(() => ({ mockIsEventCurrentlyOpen: vi.fn() }));
vi.mock("../ticketing/unifiedCheckinService", () => ({ isEventCurrentlyOpen: mockIsEventCurrentlyOpen }));

const { mockReverseTokenSpend } = vi.hoisted(() => ({ mockReverseTokenSpend: vi.fn() }));
vi.mock("../tokens/tokenSpendService", () => ({ reverseTokenSpend: mockReverseTokenSpend, quoteTokenSpend: vi.fn() }));

// SEGOLIFE — SEGOTOKENS PRESENCIALES (Pre-16.1): recordDoorSale ya no
// decide/captura tokens por su cuenta — solo liquida una autorización que
// el Student ya confirmó, vía tokenPaymentRequestService.settleTokenPaymentRequest.
const { mockSettleTokenPaymentRequest, mockLinkSettledOrder, MockTokenPaymentRequestError } = vi.hoisted(() => {
  class MockTokenPaymentRequestError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.name = "TokenPaymentRequestError"; this.code = code; }
  }
  return { mockSettleTokenPaymentRequest: vi.fn(), mockLinkSettledOrder: vi.fn(), MockTokenPaymentRequestError };
});
vi.mock("../tokens/tokenPaymentRequestService", () => ({
  settleTokenPaymentRequest: mockSettleTokenPaymentRequest,
  linkSettledOrder: mockLinkSettledOrder,
  TokenPaymentRequestError: MockTokenPaymentRequestError,
}));

const { mockEmitEngagementEvent } = vi.hoisted(() => ({ mockEmitEngagementEvent: vi.fn() }));
vi.mock("../engagement/engagementEvents", () => ({ emitEngagementEvent: mockEmitEngagementEvent }));

const { mockRecordCommerceRefund } = vi.hoisted(() => ({ mockRecordCommerceRefund: vi.fn() }));
vi.mock("./refundOrchestrator", () => ({ recordCommerceRefund: mockRecordCommerceRefund }));

import { recordDoorSale, refundDoorSale, quoteDoorEntry, DoorSaleError } from "./doorSaleService";
import { eventTicketTypes, events, eventTickets, ticketOrders } from "../../../drizzle/schema";

function doorType(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, eventId: 10, name: "Puerta", priceCents: 1500, isDoorEntry: true, status: "active", ...overrides };
}
function eventRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 10, venueId: 20, name: "Viernes", status: "active", ...overrides };
}
function orderRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 100, eventId: 10, userId: 42, totalCents: 1500, status: "pending", channel: "door", tokenReservationId: null, ...overrides };
}
function ticketRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 500, orderId: 100, eventId: 10, ticketTypeId: 1, userId: 42, status: "issued", externalTicketId: "native:100:1:1", ...overrides };
}

function makeMockDb(config: { doorType?: Record<string, unknown> | null; event?: Record<string, unknown> | null; order?: Record<string, unknown> | null; tickets?: Array<Record<string, unknown>> } = {}) {
  const doorTypeFixture = config.doorType !== undefined ? config.doorType : doorType();
  const eventR = config.event !== undefined ? config.event : eventRow();
  let order = config.order !== undefined ? config.order : null;
  // Por defecto, un ticket ya "issued" con el MISMO id que devuelve el mock
  // de issueTicketsForOrder (ticketRow(), id=500) — así el UPDATE→"used" que
  // hace recordDoorSale tras emitir encuentra algo real que actualizar,
  // igual que en producción (dos pasos sobre la MISMA fila).
  let tickets = config.tickets ? [...config.tickets] : [ticketRow()];

  function makeBuilder() {
    const b: any = {};
    let mode: "select" | "update" = "select";
    let table: unknown = null;
    let updateValues: Record<string, unknown> | null = null;
    b.select = () => { mode = "select"; return b; };
    b.from = (t: unknown) => { table = t; return b; };
    b.where = () => b;
    b.limit = () => b;
    b.update = (t: unknown) => { mode = "update"; table = t; return b; };
    b.set = (v: Record<string, unknown>) => { updateValues = v; return b; };
    b.then = (resolve: (v: unknown) => void) => {
      if (mode === "update") {
        if (table === ticketOrders) { order = { ...order, ...updateValues }; return resolve([{ affectedRows: 1 }]); }
        if (table === eventTickets) {
          let affected = 0;
          for (const t of tickets) if (t.status === "issued") { Object.assign(t, updateValues); affected += 1; }
          return resolve([{ affectedRows: affected }]);
        }
        return resolve([{ affectedRows: 0 }]);
      }
      if (table === eventTicketTypes) return resolve(doorTypeFixture ? [doorTypeFixture] : []);
      if (table === events) return resolve(eventR ? [eventR] : []);
      if (table === ticketOrders) return resolve(order ? [order] : []);
      if (table === eventTickets) return resolve(tickets);
      return resolve([]);
    };
    return b;
  }
  const outer: any = makeBuilder();
  outer.transaction = (cb: (tx: unknown) => Promise<unknown>) => cb(makeBuilder());
  return { db: outer, getOrder: () => order, getTickets: () => tickets };
}

let ledgerSeq = 1;
beforeEach(() => {
  vi.clearAllMocks();
  ledgerSeq = 1;
  mockSettleTokenPaymentRequest.mockImplementation(async () => ({
    reservation: { id: ledgerSeq++, userId: 42, grossAmountCents: 1500, tokensReserved: 100, promotionalValueCents: 100, moneyDueCents: 0 },
    request: { id: 1 },
  }));
  mockLinkSettledOrder.mockResolvedValue(undefined);
  mockReverseTokenSpend.mockResolvedValue({ tokensReserved: 10 });
  mockCreateHold.mockImplementation(async (input: { idempotencyKey: string }) => ({ status: "created", order: orderRow({ idempotencyKey: input.idempotencyKey }) }));
  mockTransitionOrderStatus.mockImplementation(async (_id: number, _from: string[], to: string, extra: Record<string, unknown>) => orderRow({ status: to, ...extra }));
  mockIssueTicketsForOrder.mockImplementation(async () => [ticketRow()]);
  mockIsEventCurrentlyOpen.mockReturnValue(true);
});

describe("doorSaleService — venta de puerta (Commerce Core, spec §14-15)", () => {
  it("#1 crea un pedido nativo reutilizando createHold — nunca una tabla de orders paralela", async () => {
    const { db } = makeMockDb();
    await recordDoorSale({ eventId: 10, ticketTypeId: 1, quantity: 1, identifiedUserId: 42, operatorUserId: 9, idempotencyKey: "door:1" }, db);
    expect(mockCreateHold).toHaveBeenCalledOnce();
    expect(mockCreateHold.mock.calls[0][0]).toMatchObject({ eventId: 10, userId: 42, channel: "door", operatorUserId: 9 });
  });

  it("#2 rechaza un ticket type que no es de puerta (isDoorEntry=false)", async () => {
    const { db } = makeMockDb({ doorType: doorType({ isDoorEntry: false }) });
    await expect(recordDoorSale({ eventId: 10, ticketTypeId: 1, quantity: 1, operatorUserId: 9, idempotencyKey: "door:2" }, db))
      .rejects.toMatchObject({ code: "NOT_DOOR_ENTRY" });
    expect(mockCreateHold).not.toHaveBeenCalled();
  });

  it("#3 comprador anónimo (sin identifiedUserId) es una venta válida — sin SegoTokens, sin asistencia", async () => {
    const { db } = makeMockDb();
    const result = await recordDoorSale({ eventId: 10, ticketTypeId: 1, quantity: 1, operatorUserId: 9, idempotencyKey: "door:3" }, db);
    expect(result.order).toBeTruthy();
    expect(mockSettleTokenPaymentRequest).not.toHaveBeenCalled();
    expect(mockIngestAttendance).not.toHaveBeenCalled();
    expect(mockGrantNativePurchaseReward).not.toHaveBeenCalled();
  });

  it("#4 admisión inmediata: ticket emitido se marca 'used' y dispara ingestAttendance (nunca event_attendance directo)", async () => {
    const { db } = makeMockDb();
    await recordDoorSale({ eventId: 10, ticketTypeId: 1, quantity: 1, identifiedUserId: 42, operatorUserId: 9, idempotencyKey: "door:4" }, db);
    expect(mockIngestAttendance).toHaveBeenCalledOnce();
    expect(mockIngestAttendance.mock.calls[0][0]).toMatchObject({ resolvedUserId: 42, eventId: 10, provider: "segolife" });
  });

  it("#5 con Student identificado, concede la MISMA recompensa de compra que un ticket online (grantNativePurchaseReward)", async () => {
    const { db } = makeMockDb();
    await recordDoorSale({ eventId: 10, ticketTypeId: 1, quantity: 1, identifiedUserId: 42, operatorUserId: 9, idempotencyKey: "door:5" }, db);
    expect(mockGrantNativePurchaseReward).toHaveBeenCalledOnce();
  });

  it("#6 liquida una solicitud de pago ya confirmada por el Student (settleTokenPaymentRequest, contexto 'door') — nunca decide/captura por su cuenta", async () => {
    const { db } = makeMockDb();
    await recordDoorSale({ eventId: 10, ticketTypeId: 1, quantity: 1, identifiedUserId: 42, operatorUserId: 9, idempotencyKey: "door:6", confirmedTokenRequestId: 7 }, db);
    expect(mockSettleTokenPaymentRequest).toHaveBeenCalledOnce();
    expect(mockSettleTokenPaymentRequest.mock.calls[0][0]).toBe(7);
    expect(mockSettleTokenPaymentRequest.mock.calls[0][1]).toBe("door");
    expect(mockLinkSettledOrder).toHaveBeenCalledOnce();
  });

  it("#7 SegoTokens sin identifiedUserId es rechazado ANTES de tocar el motor de tokens", async () => {
    const { db } = makeMockDb();
    await expect(recordDoorSale({ eventId: 10, ticketTypeId: 1, quantity: 1, operatorUserId: 9, idempotencyKey: "door:7", confirmedTokenRequestId: 7 }, db))
      .rejects.toMatchObject({ code: "STUDENT_REQUIRED" });
    expect(mockSettleTokenPaymentRequest).not.toHaveBeenCalled();
  });

  it("#7b reservation.userId de la solicitud liquidada no coincide con el Student identificado: rechaza y revierte", async () => {
    mockSettleTokenPaymentRequest.mockResolvedValueOnce({ reservation: { id: 900, userId: 999, grossAmountCents: 1500, promotionalValueCents: 100 }, request: { id: 7 } });
    const { db } = makeMockDb();
    await expect(recordDoorSale({ eventId: 10, ticketTypeId: 1, quantity: 1, identifiedUserId: 42, operatorUserId: 9, idempotencyKey: "door:7b", confirmedTokenRequestId: 7 }, db))
      .rejects.toMatchObject({ code: "REQUEST_STUDENT_MISMATCH" });
    expect(mockReverseTokenSpend).toHaveBeenCalledOnce();
  });

  it("#7c el precio cambió desde la solicitud (grossAmountCents distinto de order.totalCents): rechaza y revierte", async () => {
    mockSettleTokenPaymentRequest.mockResolvedValueOnce({ reservation: { id: 901, userId: 42, grossAmountCents: 999, promotionalValueCents: 100 }, request: { id: 7 } });
    const { db } = makeMockDb();
    await expect(recordDoorSale({ eventId: 10, ticketTypeId: 1, quantity: 1, identifiedUserId: 42, operatorUserId: 9, idempotencyKey: "door:7c", confirmedTokenRequestId: 7 }, db))
      .rejects.toMatchObject({ code: "CART_CHANGED_SINCE_REQUEST" });
    expect(mockReverseTokenSpend).toHaveBeenCalledOnce();
  });

  it("#8 si falla la emisión tras liquidar SegoTokens reales, se revierte la captura (compensación)", async () => {
    const { db } = makeMockDb();
    mockIssueTicketsForOrder.mockRejectedValueOnce(new Error("fallo de BD"));
    await expect(recordDoorSale({ eventId: 10, ticketTypeId: 1, quantity: 1, identifiedUserId: 42, operatorUserId: 9, idempotencyKey: "door:8", confirmedTokenRequestId: 7 }, db))
      .rejects.toThrow();
    expect(mockReverseTokenSpend).toHaveBeenCalledOnce();
  });

  it("#9 reintento con la MISMA idempotencyKey sobre un pedido ya pagado no repite ST/recompensa/asistencia", async () => {
    const existing = orderRow({ status: "paid" });
    mockCreateHold.mockResolvedValueOnce({ status: "already_exists", order: existing });
    const { db } = makeMockDb({ order: existing, tickets: [ticketRow({ status: "used" })] });
    const result = await recordDoorSale({ eventId: 10, ticketTypeId: 1, quantity: 1, identifiedUserId: 42, operatorUserId: 9, idempotencyKey: "door:9" }, db);
    expect(result.order.status).toBe("paid");
    expect(mockSettleTokenPaymentRequest).not.toHaveBeenCalled();
    expect(mockGrantNativePurchaseReward).not.toHaveBeenCalled();
    expect(mockTransitionOrderStatus).not.toHaveBeenCalled();
  });

  it("#10 quoteDoorEntry es de solo lectura — nunca crea un hold ni toca SegoTokens", async () => {
    const { db } = makeMockDb();
    const quote = await quoteDoorEntry({ eventId: 10, ticketTypeId: 1, quantity: 2 }, db);
    expect(quote.grossAmountCents).toBe(3000); // 1500 x 2, recalculado en servidor
    expect(mockCreateHold).not.toHaveBeenCalled();
  });
});

describe("doorSaleService — refundDoorSale (spec §20/§56)", () => {
  it("#11 reembolsa una venta de puerta AUNQUE el ticket ya esté 'used' — 'used' aquí es el resultado esperado de la venta, no bloqueo", async () => {
    const paidOrder = orderRow({ status: "paid", channel: "door" });
    const { db } = makeMockDb({ order: paidOrder, tickets: [ticketRow({ status: "used" })] });
    mockTransitionOrderStatus.mockResolvedValueOnce({ ...paidOrder, status: "refunded" });
    const refunded = await refundDoorSale({ orderId: 100, refundedByUserId: 9, reason: "cliente se arrepintió" }, db);
    expect(refunded.status).toBe("refunded");
    expect(mockReverseNativePurchaseReward).toHaveBeenCalledOnce();
  });

  it("#12 rechaza reembolsar una venta que no es de puerta (channel != 'door')", async () => {
    const { db } = makeMockDb({ order: orderRow({ status: "paid", channel: "online" }) });
    await expect(refundDoorSale({ orderId: 100, refundedByUserId: 9, reason: "x" }, db)).rejects.toMatchObject({ code: "NOT_DOOR_SALE" });
  });

  it("#13 exige motivo (REASON_REQUIRED)", async () => {
    const { db } = makeMockDb({ order: orderRow({ status: "paid" }) });
    await expect(refundDoorSale({ orderId: 100, refundedByUserId: 9, reason: "" }, db)).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });

  it("#14 registra el reembolso en el feed unificado (commerce_refunds) vía recordCommerceRefund", async () => {
    const paidOrder = orderRow({ status: "paid", channel: "door" });
    const { db } = makeMockDb({ order: paidOrder, tickets: [ticketRow({ status: "used" })] });
    mockTransitionOrderStatus.mockResolvedValueOnce({ ...paidOrder, status: "refunded" });
    await refundDoorSale({ orderId: 100, refundedByUserId: 9, reason: "motivo real" }, db);
    expect(mockRecordCommerceRefund).toHaveBeenCalledOnce();
    expect(mockRecordCommerceRefund.mock.calls[0][0]).toMatchObject({ sourceType: "ticket_order", moneyRefundStatus: "completed" });
  });

  it("#15 reembolso de venta con SegoTokens aplicados los restaura vía reverseTokenSpend", async () => {
    const paidOrder = orderRow({ status: "paid", channel: "door", tokenReservationId: 55 });
    const { db } = makeMockDb({ order: paidOrder, tickets: [ticketRow({ status: "used" })] });
    mockTransitionOrderStatus.mockResolvedValueOnce({ ...paidOrder, status: "refunded" });
    await refundDoorSale({ orderId: 100, refundedByUserId: 9, reason: "motivo" }, db);
    expect(mockReverseTokenSpend).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 55 }), db);
  });
});
