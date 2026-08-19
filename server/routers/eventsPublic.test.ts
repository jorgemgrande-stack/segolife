/**
 * eventsPublic.test.ts — Fase 8.6, punto 91. Cubre los procedures `public*`
 * de eventsRouter (fuera de alcance de server/routers/events.test.ts, que
 * solo prueba el rechazo RBAC de los procedures admin). Prueba en
 * particular el grafo Event→Venue (publicGetBySlug) y Venue→Event
 * (publicByVenue), y que un evento pasado nunca ofrece purchaseAction real
 * incluso pasando por el router completo (no solo la unidad
 * computePurchaseAction, ya cubierta en purchaseAction.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetEventBySlug, mockListEventsByVenue, mockListEndedEvents, mockComputePurchaseAction } = vi.hoisted(() => ({
  mockGetEventBySlug: vi.fn(),
  mockListEventsByVenue: vi.fn(),
  mockListEndedEvents: vi.fn(),
  mockComputePurchaseAction: vi.fn(),
}));

vi.mock("../db/eventsDb", async (importOriginal) => {
  // isEventStudentVisible es la función REAL (pura, sin BD) — el resto de
  // eventsDb queda mockeado como antes de FIX-04. Sin esto, publicGetBySlug
  // (que ahora la llama) lanza "no export defined on mock".
  const actual = await importOriginal<typeof import("../db/eventsDb")>();
  return {
    listEvents: vi.fn(),
    getEventById: vi.fn(),
    getEventBySlug: mockGetEventBySlug,
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    setEventActive: vi.fn(),
    setEventFeatured: vi.fn(),
    setEventCommunities: vi.fn(),
    listActiveEvents: vi.fn(),
    listFeaturedEvents: vi.fn(),
    listEventsByVenue: mockListEventsByVenue,
    listEndedEvents: mockListEndedEvents,
    isEventStudentVisible: actual.isEventStudentVisible,
  };
});

vi.mock("../segolife/ticketing/purchaseAction", () => ({
  computePurchaseAction: mockComputePurchaseAction,
}));

import { eventsRouter } from "./events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function publicCaller() {
  return eventsRouter.createCaller({ user: null } as any);
}

const VENUE = {
  id: 1, name: "Casanova", slug: "casanova", tagline: null, description: null, categoryId: null,
  address: null, city: "Segovia", phone: null, email: null, website: null, instagramUrl: null,
  imageUrl: null, coverImageUrl: null, status: "active" as const, isFeatured: false,
  createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
};

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10, name: "QA Casanova Upcoming", slug: "qa-casanova-upcoming", description: null,
    venueId: 1, startsAt: new Date(Date.now() + 3 * 86400000), endsAt: null, capacity: null,
    imageUrl: null, status: "active" as const, isFeatured: true,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockComputePurchaseAction.mockResolvedValue({ type: "unavailable" });
});

describe("events router — publicGetBySlug (Event→Venue, punto 91)", () => {
  it("un evento activo incluye su venue completo (grafo Event→Venue navegable)", async () => {
    mockGetEventBySlug.mockResolvedValue({ event: baseEvent(), venue: VENUE, communities: [] });
    const result = await publicCaller().publicGetBySlug({ slug: "qa-casanova-upcoming" });
    expect(result?.venue?.name).toBe("Casanova");
  });

  it("un evento inactivo nunca se expone públicamente aunque el slug exista", async () => {
    mockGetEventBySlug.mockResolvedValue({ event: baseEvent({ status: "inactive" }), venue: VENUE, communities: [] });
    const result = await publicCaller().publicGetBySlug({ slug: "qa-casanova-upcoming" });
    expect(result).toBeNull();
  });

  it("un slug inexistente devuelve null sin lanzar", async () => {
    mockGetEventBySlug.mockResolvedValue(null);
    const result = await publicCaller().publicGetBySlug({ slug: "no-existe" });
    expect(result).toBeNull();
  });

  it("purchaseAction se calcula pasando el propio evento como timing — un evento pasado nunca ofrece compra real (punto 91: 'past-no-purchase-CTA' a nivel de router)", async () => {
    const pastEvent = baseEvent({ startsAt: new Date(Date.now() - 20 * 86400000) });
    mockGetEventBySlug.mockResolvedValue({ event: pastEvent, venue: VENUE, communities: [] });
    mockComputePurchaseAction.mockResolvedValue({ type: "unavailable" });
    const result = await publicCaller().publicGetBySlug({ slug: "qa-casanova-past" });
    expect(result?.purchaseAction).toEqual({ type: "unavailable" });
    expect(mockComputePurchaseAction).toHaveBeenCalledWith(pastEvent.id, pastEvent);
  });

  it("el DTO público de evento nunca incluye credenciales/tokens de integración (punto 91: 'no-credentials-in-public-DTO')", async () => {
    mockGetEventBySlug.mockResolvedValue({ event: baseEvent(), venue: VENUE, communities: [] });
    const result = await publicCaller().publicGetBySlug({ slug: "qa-casanova-upcoming" });
    const keys = Object.keys(result!.event);
    expect(keys.some(k => /secret|token|apikey|api_key|credential|password/i.test(k))).toBe(false);
  });

  // Fase 15 (spec §16/§43) — antes se devolvía CUALQUIER evento activo sin
  // mirar nunca `communities`; un Student en /uva podía ver (y comprar) un
  // evento IE-only con solo conocer su slug/URL directa.
  describe("publicGetBySlug — enforcement de comunidad (Fase 15, spec §16/§43)", () => {
    it("evento restringido a IE, pedido desde UVA (communityId distinto) -> null, igual que un slug inexistente", async () => {
      mockGetEventBySlug.mockResolvedValue({ event: baseEvent(), venue: VENUE, communities: [{ id: 1, slug: "ie" }] });
      const result = await publicCaller().publicGetBySlug({ slug: "qa-casanova-upcoming", communityId: 2 });
      expect(result).toBeNull();
    });

    it("evento restringido a IE, pedido desde IE (communityId coincide) -> se devuelve normalmente", async () => {
      mockGetEventBySlug.mockResolvedValue({ event: baseEvent(), venue: VENUE, communities: [{ id: 1, slug: "ie" }] });
      const result = await publicCaller().publicGetBySlug({ slug: "qa-casanova-upcoming", communityId: 1 });
      expect(result).not.toBeNull();
    });

    it("evento compartido IE+UVA -> visible desde CUALQUIERA de las dos comunidades", async () => {
      mockGetEventBySlug.mockResolvedValue({ event: baseEvent(), venue: VENUE, communities: [{ id: 1, slug: "ie" }, { id: 2, slug: "uva" }] });
      expect(await publicCaller().publicGetBySlug({ slug: "shared", communityId: 1 })).not.toBeNull();
      expect(await publicCaller().publicGetBySlug({ slug: "shared", communityId: 2 })).not.toBeNull();
    });

    it("evento SIN ninguna comunidad asignada (legacy/sin restringir) -> siempre visible, con o sin communityId", async () => {
      mockGetEventBySlug.mockResolvedValue({ event: baseEvent(), venue: VENUE, communities: [] });
      expect(await publicCaller().publicGetBySlug({ slug: "qa-casanova-upcoming", communityId: 1 })).not.toBeNull();
      expect(await publicCaller().publicGetBySlug({ slug: "qa-casanova-upcoming", communityId: 99 })).not.toBeNull();
    });

    it("sin communityId en absoluto (consumidor sin contexto de comunidad) -> nunca se restringe, compatibilidad hacia atrás", async () => {
      mockGetEventBySlug.mockResolvedValue({ event: baseEvent(), venue: VENUE, communities: [{ id: 1, slug: "ie" }] });
      const result = await publicCaller().publicGetBySlug({ slug: "qa-casanova-upcoming" });
      expect(result).not.toBeNull();
    });
  });
});

describe("events router — publicByVenue (Venue→Event, punto 91)", () => {
  it("devuelve los eventos de un venue concreto delegando en listEventsByVenue, sin exigir sesión", async () => {
    mockListEventsByVenue.mockResolvedValue([{ ...baseEvent(), venue: VENUE, communities: [] }]);
    const result = await publicCaller().publicByVenue({ venueId: 1 });
    expect(result).toHaveLength(1);
    expect(mockListEventsByVenue).toHaveBeenCalledWith(1);
  });

  it("un venue de prueba de dominio (Tanker Events) devuelve sus eventos con el mismo procedimiento que cualquier otro venue", async () => {
    mockListEventsByVenue.mockResolvedValue([
      { ...baseEvent({ id: 20, name: "QA Tanker Events Upcoming", venueId: 6 }), venue: { ...VENUE, id: 6, name: "Tanker Events" }, communities: [] },
    ]);
    const result = await publicCaller().publicByVenue({ venueId: 6 });
    expect(result[0].venue?.name).toBe("Tanker Events");
  });
});

describe("events router — publicEnded (FIX-05A, Ended Events)", () => {
  it("delega en listEndedEvents con communityId/venueId/limit, sin exigir sesión", async () => {
    mockListEndedEvents.mockResolvedValue([{ ...baseEvent({ id: 30 }), venue: VENUE, communities: [] }]);
    const result = await publicCaller().publicEnded({ communityId: 1, venueId: 1, limit: 10 });
    expect(result).toHaveLength(1);
    expect(mockListEndedEvents).toHaveBeenCalledWith({ communityId: 1, venueId: 1, limit: 10 });
  });

  it("sin communityId/venueId (Explore sin venue) sigue funcionando — ambos opcionales", async () => {
    mockListEndedEvents.mockResolvedValue([]);
    const result = await publicCaller().publicEnded({ limit: 20 });
    expect(result).toEqual([]);
    expect(mockListEndedEvents).toHaveBeenCalledWith({ limit: 20 });
  });

  it("limit por defecto es 20 cuando no se especifica", async () => {
    mockListEndedEvents.mockResolvedValue([]);
    await publicCaller().publicEnded({});
    expect(mockListEndedEvents).toHaveBeenCalledWith({ limit: 20 });
  });

  it("limit rechaza valores fuera de rango (spec §14 — nunca 'todo el histórico sin control')", async () => {
    await expect(publicCaller().publicEnded({ limit: 500 })).rejects.toThrow();
  });
});
