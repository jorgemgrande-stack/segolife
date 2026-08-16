/**
 * ticketPurchase.test.ts — Fase 15 (spec §17/§43): "Checkout must preserve
 * the event/community relationship... server-side truth wins." Auditoría
 * de esta fase confirmó que startCheckout no tenía NINGÚN concepto de
 * comunidad — un Student podía comprar una entrada para un evento
 * restringido a otra comunidad con solo conocer el eventId (bypass del
 * mismo problema que publicGetBySlug, pero directamente contra la mutación
 * que cobra dinero real).
 *
 * PRE-16 overnight hardening (bug real encontrado en auditoría): el fix de
 * Fase 15 dejó el enforcement OPCIONAL y basado en un `communityId` que el
 * CLIENTE afirmaba (derivado de la URL que estaba viendo, nunca de su
 * membresía real) — un comprador podía simplemente afirmar cualquier
 * communityId del evento, o directamente omitirlo, y el check nunca corría.
 * Ahora la autorización se basa SIEMPRE en la membresía REAL del comprador
 * (getUserCommunitiesWithDetails, resuelta server-side desde ctx.user.id),
 * nunca en el input del cliente.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockStartCheckout, mockGetEventById, mockGetUserCommunitiesWithDetails } = vi.hoisted(() => ({
  mockStartCheckout: vi.fn(),
  mockGetEventById: vi.fn(),
  mockGetUserCommunitiesWithDetails: vi.fn(),
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
vi.mock("../db/communitiesDb", () => ({ getUserCommunitiesWithDetails: mockGetUserCommunitiesWithDetails }));

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
  mockGetUserCommunitiesWithDetails.mockResolvedValue([{ id: 1, slug: "ie" }]);
});

describe("ticketPurchase.startCheckout — enforcement de comunidad por membresía REAL (PRE-16 overnight hardening)", () => {
  it("evento restringido a una comunidad de la que el comprador NO es miembro real -> FORBIDDEN, nunca llega a crear el pedido", async () => {
    mockGetEventById.mockResolvedValue({ event: { id: 10 }, venue: null, communities: [{ id: 2, slug: "uva" }] });
    mockGetUserCommunitiesWithDetails.mockResolvedValue([{ id: 1, slug: "ie" }]);
    await expect(studentCaller().startCheckout(CHECKOUT_INPUT)).rejects.toThrow(/no está disponible en tu comunidad/i);
    expect(mockStartCheckout).not.toHaveBeenCalled();
  });

  it("un communityId del cliente que afirma pertenecer a la comunidad correcta NUNCA basta por sí solo — se ignora, decide la membresía real", async () => {
    mockGetEventById.mockResolvedValue({ event: { id: 10 }, venue: null, communities: [{ id: 2, slug: "uva" }] });
    mockGetUserCommunitiesWithDetails.mockResolvedValue([{ id: 1, slug: "ie" }]); // el comprador NO es miembro real de uva (id:2)
    await expect(studentCaller().startCheckout({ ...CHECKOUT_INPUT, communityId: 2 })).rejects.toThrow(/no está disponible en tu comunidad/i);
    expect(mockStartCheckout).not.toHaveBeenCalled();
  });

  it("evento restringido a una comunidad de la que el comprador SÍ es miembro real -> procede normalmente", async () => {
    mockGetEventById.mockResolvedValue({ event: { id: 10 }, venue: null, communities: [{ id: 1, slug: "ie" }] });
    mockGetUserCommunitiesWithDetails.mockResolvedValue([{ id: 1, slug: "ie" }]);
    const result = await studentCaller().startCheckout(CHECKOUT_INPUT);
    expect(result.order.id).toBe(99);
    expect(mockStartCheckout).toHaveBeenCalledTimes(1);
  });

  it("evento compartido entre comunidades -> procede si el comprador es miembro real de AL MENOS una de ellas", async () => {
    mockGetEventById.mockResolvedValue({ event: { id: 10 }, venue: null, communities: [{ id: 1, slug: "ie" }, { id: 2, slug: "uva" }] });
    mockGetUserCommunitiesWithDetails.mockResolvedValue([{ id: 2, slug: "uva" }]);
    await expect(studentCaller().startCheckout(CHECKOUT_INPUT)).resolves.toBeDefined();
    expect(mockStartCheckout).toHaveBeenCalledTimes(1);
  });

  it("comprador con membresía en VARIAS comunidades reales -> basta con que una coincida", async () => {
    mockGetEventById.mockResolvedValue({ event: { id: 10 }, venue: null, communities: [{ id: 2, slug: "uva" }] });
    mockGetUserCommunitiesWithDetails.mockResolvedValue([{ id: 1, slug: "ie" }, { id: 2, slug: "uva" }]);
    await expect(studentCaller().startCheckout(CHECKOUT_INPUT)).resolves.toBeDefined();
    expect(mockStartCheckout).toHaveBeenCalledTimes(1);
  });

  it("evento sin ninguna comunidad asignada -> nunca se bloquea (legacy/sin restringir), ni siquiera consulta la membresía real", async () => {
    mockGetEventById.mockResolvedValue({ event: { id: 10 }, venue: null, communities: [] });
    await expect(studentCaller().startCheckout(CHECKOUT_INPUT)).resolves.toBeDefined();
    expect(mockGetUserCommunitiesWithDetails).not.toHaveBeenCalled();
    expect(mockStartCheckout).toHaveBeenCalledTimes(1);
  });

  it("el precio/disponibilidad los sigue calculando SIEMPRE el motor real de checkout, nunca el chequeo de comunidad", async () => {
    mockGetEventById.mockResolvedValue({ event: { id: 10 }, venue: null, communities: [{ id: 1, slug: "ie" }] });
    await studentCaller().startCheckout(CHECKOUT_INPUT);
    expect(mockStartCheckout).toHaveBeenCalledWith(expect.objectContaining({ eventId: 10, userId: 42 }));
  });
});
