/**
 * purchaseAction.test.ts — CTA público del Event Detail (Fase 5, activado
 * en Fase 8 spec punto 3). `native_checkout` solo se devuelve si además de
 * un canal nativo activo hay al menos un tipo de entrada realmente en
 * venta — nunca un checkout vacío/falso.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockListTicketTypes, mockGetTicketTypeInventory } = vi.hoisted(() => ({
  mockListTicketTypes: vi.fn(),
  mockGetTicketTypeInventory: vi.fn(),
}));
vi.mock("./ticketingDb", () => ({
  listTicketTypes: mockListTicketTypes,
  getTicketTypeInventory: mockGetTicketTypeInventory,
}));

import { computePurchaseAction } from "./purchaseAction";

const UPCOMING = { startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
const PAST = { startsAt: new Date(Date.now() - 30 * 60 * 60 * 1000) }; // sin endsAt, +6h de duración por defecto ya pasado

function makeMockDb(channels: Array<Record<string, unknown>>) {
  const b: any = {};
  b.select = () => b;
  b.from = () => b;
  b.where = () => b;
  b.orderBy = () => Promise.resolve(channels);
  return b as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTicketTypeInventory.mockResolvedValue([]);
});

describe("computePurchaseAction", () => {
  it("sin canales activos → unavailable", async () => {
    const db = makeMockDb([]);
    expect(await computePurchaseAction(1, UPCOMING, db)).toEqual({ type: "unavailable" });
  });

  it("canal external_redirect activo con URL → external_url", async () => {
    const db = makeMockDb([{ isPrimary: true, salesMode: "external_redirect", externalUrl: "https://tickets.example/e/1", status: "active" }]);
    const result = await computePurchaseAction(1, UPCOMING, db);
    expect(result).toEqual({ type: "external_url", url: "https://tickets.example/e/1" });
  });

  it("canal native SIN ningún tipo de entrada en venta → unavailable (nunca un checkout vacío)", async () => {
    const db = makeMockDb([{ isPrimary: true, salesMode: "native", status: "active" }]);
    mockListTicketTypes.mockResolvedValue([]);
    expect(await computePurchaseAction(1, UPCOMING, db)).toEqual({ type: "unavailable" });
  });

  it("canal native con un tipo de entrada activo dentro de la ventana de venta → native_checkout con datos reales", async () => {
    const db = makeMockDb([{ isPrimary: true, salesMode: "native", status: "active" }]);
    mockListTicketTypes.mockResolvedValue([
      { id: 10, name: "General", priceCents: 1500, currency: "EUR", status: "active", salesStart: null, salesEnd: null },
    ]);
    mockGetTicketTypeInventory.mockResolvedValue([{ ticketTypeId: 10, capacity: 100, sold: 3, available: 97 }]);

    const result = await computePurchaseAction(1, UPCOMING, db);
    expect(result.type).toBe("native_checkout");
    if (result.type === "native_checkout") {
      expect(result.ticketTypes).toEqual([{ id: 10, name: "General", priceCents: 1500, currency: "EUR", available: 97 }]);
    }
  });

  it("un tipo de entrada con salesStart en el futuro se excluye (no está realmente en venta todavía)", async () => {
    const db = makeMockDb([{ isPrimary: true, salesMode: "native", status: "active" }]);
    mockListTicketTypes.mockResolvedValue([
      { id: 10, name: "Early bird", priceCents: 1000, currency: "EUR", status: "active", salesStart: new Date("2099-01-01"), salesEnd: null },
    ]);
    expect(await computePurchaseAction(1, UPCOMING, db)).toEqual({ type: "unavailable" });
  });

  it("evento ya pasado → unavailable SIEMPRE, aunque haya canal nativo con entradas disponibles (Fase 8.6, puntos 25/90)", async () => {
    const db = makeMockDb([{ isPrimary: true, salesMode: "native", status: "active" }]);
    mockListTicketTypes.mockResolvedValue([
      { id: 10, name: "General", priceCents: 1500, currency: "EUR", status: "active", salesStart: null, salesEnd: null },
    ]);
    mockGetTicketTypeInventory.mockResolvedValue([{ ticketTypeId: 10, capacity: 100, sold: 3, available: 97 }]);
    expect(await computePurchaseAction(1, PAST, db)).toEqual({ type: "unavailable" });
    // Ni siquiera se consulta el canal — el evento pasado corta antes.
    expect(mockListTicketTypes).not.toHaveBeenCalled();
  });
});
