/**
 * eventsCreate.test.ts — Fase 8.6, punto 91: "create-event validation" y
 * "venue preselection". server/routers/events.test.ts ya prueba que
 * `create` rechaza SIN sesión; aquí se prueba, CON una sesión admin válida
 * (RBAC mockeado para no depender de una BD real), que:
 *  1. el input inválido se rechaza por Zod antes de tocar la BD (nunca crea
 *     un evento a medias con datos corruptos), y
 *  2. un venueId recibido (el mismo mecanismo que EventCreate.tsx usa para
 *     preseleccionar el venue desde `/admin/events/new?venueId=X`) llega
 *     intacto hasta createEvent — no se pierde ni se ignora en el camino.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateEvent, mockGetCommunityAccess } = vi.hoisted(() => ({
  mockCreateEvent: vi.fn(),
  mockGetCommunityAccess: vi.fn(),
}));

vi.mock("../_core/rbac", () => ({
  checkRbacOrLegacy: vi.fn().mockResolvedValue(true),
  getUserPermissions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../_core/communityAccess", async () => {
  const actual = await vi.importActual<typeof import("../_core/communityAccess")>("../_core/communityAccess");
  return { ...actual, getCommunityAccess: mockGetCommunityAccess };
});

vi.mock("../db/eventsDb", () => ({
  listEvents: vi.fn(),
  getEventById: vi.fn(),
  getEventBySlug: vi.fn(),
  createEvent: mockCreateEvent,
  updateEvent: vi.fn(),
  setEventActive: vi.fn(),
  setEventFeatured: vi.fn(),
  setEventCommunities: vi.fn(),
  listActiveEvents: vi.fn(),
  listFeaturedEvents: vi.fn(),
  listEventsByVenue: vi.fn(),
}));

vi.mock("../segolife/ticketing/purchaseAction", () => ({
  computePurchaseAction: vi.fn(),
}));

import { eventsRouter } from "./events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adminCaller() {
  return eventsRouter.createCaller({ user: { id: 1, role: "admin" } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCommunityAccess.mockResolvedValue("all");
  mockCreateEvent.mockResolvedValue({
    id: 99, name: "Fiesta de bienvenida", slug: "fiesta-de-bienvenida", venueId: 6,
    startsAt: new Date("2026-09-15T20:00:00Z"), endsAt: null, description: null, capacity: null,
    imageUrl: null, status: "active", isFeatured: false, createdAt: new Date(), updatedAt: new Date(),
  });
});

describe("events.create — validación de input (punto 91: 'create-event validation')", () => {
  it("rechaza un nombre vacío antes de llamar a createEvent", async () => {
    await expect(
      adminCaller().create({ name: "", slug: "fiesta", startsAt: new Date("2026-09-15T20:00:00Z"), communityIds: [] })
    ).rejects.toThrow();
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it("rechaza un slug con mayúsculas/espacios (debe ser kebab-case) antes de llamar a createEvent", async () => {
    await expect(
      adminCaller().create({ name: "Fiesta", slug: "Fiesta Mal Formada", startsAt: new Date("2026-09-15T20:00:00Z"), communityIds: [] })
    ).rejects.toThrow();
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it("rechaza sin startsAt — crear un draft no exige ticketing, pero SÍ exige fecha de inicio", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adminCaller().create({ name: "Fiesta", slug: "fiesta", communityIds: [] } as any)
    ).rejects.toThrow();
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it("acepta el mínimo real exigido (nombre/slug/inicio), sin exigir venue/imagen/ticketing", async () => {
    await adminCaller().create({ name: "Fiesta", slug: "fiesta", startsAt: new Date("2026-09-15T20:00:00Z"), communityIds: [] });
    expect(mockCreateEvent).toHaveBeenCalledTimes(1);
  });
});

describe("events.create — preselección de venue (punto 91: 'venue preselection')", () => {
  it("un venueId recibido (mismo mecanismo que /admin/events/new?venueId=X) llega intacto a createEvent", async () => {
    await adminCaller().create({
      name: "QA Tanker Events Upcoming", slug: "qa-tanker-events-upcoming",
      venueId: 6, startsAt: new Date("2026-09-20T22:00:00Z"), communityIds: [],
    });
    expect(mockCreateEvent).toHaveBeenCalledTimes(1);
    const [fields] = mockCreateEvent.mock.calls[0];
    expect(fields.venueId).toBe(6);
  });

  it("sin venueId (evento sin venue fijo) no rompe la creación — venueId queda undefined/null", async () => {
    await adminCaller().create({ name: "Fiesta itinerante", slug: "fiesta-itinerante", startsAt: new Date("2026-09-15T20:00:00Z"), communityIds: [] });
    const [fields] = mockCreateEvent.mock.calls[0];
    expect(fields.venueId ?? null).toBeNull();
  });
});
