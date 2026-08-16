/**
 * ticketPurchase.test.ts — Fase 15 (spec §17/§43): "Checkout must preserve
 * the event/community relationship... server-side truth wins." Auditoría
 * de esta fase confirmó que startCheckout no tenía NINGÚN concepto de
 * comunidad — un Student podía comprar una entrada para un evento
 * restringido a otra comunidad con solo conocer el eventId (bypass del
 * mismo problema que publicGetBySlug, pero directamente contra la mutación
 * que cobra dinero real).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockStartCheckout, mockGetEventById } = vi.hoisted(() => ({
  mockStartCheckout: vi.fn(),
  mockGetEventById: vi.fn(),
}));

vi.mock("../segolife/ticketing/checkoutService", () => ({
  startCheckout: mockStartCheckout,
  initiatePayment: vi.fn(),
  CheckoutError: class CheckoutError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  },
}));
vi.mock("../segolife/ticketing/ticketCancellationService", () => ({ cancelOrder: vi.fn() }));
vi.mock("../segolife/ticketing/inventoryHoldService", () => ({ expireStaleHoldsForUser: vi.fn() }));
vi.mock("../segolife/ticketing/ticketingDb", () => ({
  listMyOrders: vi.fn(), getMyOrderById: vi.fn(), listMyTickets: vi.fn(), getMyTicketById: vi.fn(),
}));
vi.mock("../segolife/commerce/studentIdentityService", () => ({
  getOrCreateMyIdentityToken: vi.fn(), rotateMyIdentityToken: vi.fn(),
}));
vi.mock("../db/eventsDb", () => ({ getEventById: mockGetEventById }));

import { ticketPurchaseRouter } from "./ticketPurchase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function studentCaller() {
  return ticketPurchaseRouter.createCaller({ user: { id: 42, role: "user", name: "Ana", email: "ana@example.com" } } as any);
}

const CHECKOUT_INPUT = {
  eventId: 10,
  items: [{ ticketTypeId: 1, quantity: 1 }],
  idempotencyKey: "checkout:10:test-key-123",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockStartCheckout.mockResolvedValue({ order: { id: 99 } });
});

describe("ticketPurchase.startCheckout — enforcement de comunidad (Fase 15, spec §17/§43)", () => {
  it("evento restringido a otra comunidad -> FORBIDDEN, nunca llega a crear el pedido", async () => {
    mockGetEventById.mockResolvedValue({ event: { id: 10 }, venue: null, communities: [{ id: 1, slug: "ie" }] });
    await expect(studentCaller().startCheckout({ ...CHECKOUT_INPUT, communityId: 2 })).rejects.toThrow(/no está disponible en esta comunidad/i);
    expect(mockStartCheckout).not.toHaveBeenCalled();
  });

  it("evento con la comunidad correcta -> procede normalmente", async () => {
    mockGetEventById.mockResolvedValue({ event: { id: 10 }, venue: null, communities: [{ id: 1, slug: "ie" }] });
    const result = await studentCaller().startCheckout({ ...CHECKOUT_INPUT, communityId: 1 });
    expect(result.order.id).toBe(99);
    expect(mockStartCheckout).toHaveBeenCalledTimes(1);
  });

  it("evento compartido entre comunidades -> procede desde cualquiera de ellas", async () => {
    mockGetEventById.mockResolvedValue({ event: { id: 10 }, venue: null, communities: [{ id: 1, slug: "ie" }, { id: 2, slug: "uva" }] });
    await expect(studentCaller().startCheckout({ ...CHECKOUT_INPUT, communityId: 2 })).resolves.toBeDefined();
    expect(mockStartCheckout).toHaveBeenCalledTimes(1);
  });

  it("evento sin ninguna comunidad asignada -> nunca se bloquea (legacy/sin restringir)", async () => {
    mockGetEventById.mockResolvedValue({ event: { id: 10 }, venue: null, communities: [] });
    await expect(studentCaller().startCheckout({ ...CHECKOUT_INPUT, communityId: 1 })).resolves.toBeDefined();
    expect(mockStartCheckout).toHaveBeenCalledTimes(1);
  });

  it("sin communityId en el input -> nunca se valida/bloquea (compatibilidad hacia atrás)", async () => {
    const result = await studentCaller().startCheckout(CHECKOUT_INPUT);
    expect(result.order.id).toBe(99);
    expect(mockGetEventById).not.toHaveBeenCalled();
    expect(mockStartCheckout).toHaveBeenCalledTimes(1);
  });

  it("el precio/disponibilidad los sigue calculando SIEMPRE el motor real de checkout, nunca el chequeo de comunidad", async () => {
    mockGetEventById.mockResolvedValue({ event: { id: 10 }, venue: null, communities: [{ id: 1, slug: "ie" }] });
    await studentCaller().startCheckout({ ...CHECKOUT_INPUT, communityId: 1 });
    expect(mockStartCheckout).toHaveBeenCalledWith(expect.objectContaining({ eventId: 10, userId: 42 }));
  });
});
