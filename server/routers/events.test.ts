/**
 * events.test.ts — RBAC a nivel de router (Fase 1D). Mismo patrón que
 * server/routers/venues.test.ts / students.test.ts: los procedures admin
 * exigen sesión + permiso `events.view`/`events.manage` (permissionProcedure),
 * así que rechazan ANTES de tocar la BD. Los procedures `public*` (usados por
 * /ie, /uva) son publicProcedure a propósito y no se prueban aquí.
 *
 * `myVenueEvents`/`myVenueEventLiveStats` (VENUE & PARTNER APP, spec §22)
 * usan protectedProcedure + requireVenueAccess, no permissionProcedure — se
 * prueban aparte con IDOR real. `myVenueEventLiveStats` en particular
 * resuelve el venueId del EVENTO real server-side antes de autorizar
 * (spec §31: "manipulated eventId denied") — nunca confía en un venueId que
 * el cliente pudiera enviar aparte, porque el input ni siquiera lo acepta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// requireVenueAccess llama a getVenueStaffAccess por referencia INTERNA al
// mismo módulo — mockear solo getVenueStaffAccess no intercepta esa llamada.
// Se mockea requireVenueAccess directamente, que es lo que events.ts llama.
const { mockRequireVenueAccess } = vi.hoisted(() => ({ mockRequireVenueAccess: vi.fn() }));
vi.mock("../segolife/benefits/venueStaffAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/benefits/venueStaffAccess")>();
  return { ...actual, requireVenueAccess: mockRequireVenueAccess };
});

const { mockGetVenueEventsView, mockGetEventLiveStats } = vi.hoisted(() => ({
  mockGetVenueEventsView: vi.fn(),
  mockGetEventLiveStats: vi.fn(),
}));
vi.mock("../segolife/venues/venueAppService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/venues/venueAppService")>();
  return { ...actual, getVenueEventsView: mockGetVenueEventsView, getEventLiveStats: mockGetEventLiveStats };
});

// MG-01 — publicUpcoming (pestaña "Upcoming" de la Home).
const { mockListUpcomingEvents } = vi.hoisted(() => ({ mockListUpcomingEvents: vi.fn() }));
vi.mock("../db/eventsDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/eventsDb")>();
  return { ...actual, listUpcomingEvents: mockListUpcomingEvents };
});

import { eventsRouter } from "./events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return eventsRouter.createCaller({ user: null } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(userId: number) {
  return eventsRouter.createCaller({ user: { id: userId, role: "venue_admin" } } as any);
}

describe("events router — endpoints admin (nunca públicos) rechazan sin sesión", () => {
  it("events.list rechaza sin sesión", async () => {
    await expect(callerWithoutSession().list({ limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });

  it("events.getById rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getById({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("events.create rechaza sin sesión", async () => {
    await expect(
      callerWithoutSession().create({
        name: "Fiesta de bienvenida", slug: "fiesta-de-bienvenida",
        startsAt: new Date("2026-09-15T20:00:00Z"), communityIds: [],
      })
    ).rejects.toThrow(/please login/i);
  });

  it("events.update rechaza sin sesión", async () => {
    await expect(callerWithoutSession().update({ id: 1, name: "Nuevo nombre" })).rejects.toThrow(/please login/i);
  });

  it("events.setActive rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setActive({ id: 1, active: false })).rejects.toThrow(/please login/i);
  });

  it("events.setFeatured rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setFeatured({ id: 1, featured: true })).rejects.toThrow(/please login/i);
  });

  it("events.setCommunities rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setCommunities({ id: 1, communityIds: [1] })).rejects.toThrow(/please login/i);
  });

  it("events.myVenueEvents rechaza sin sesión", async () => {
    await expect(callerWithoutSession().myVenueEvents({ venueId: 1 })).rejects.toThrow(/please login/i);
  });

  it("events.myVenueEventLiveStats rechaza sin sesión", async () => {
    await expect(callerWithoutSession().myVenueEventLiveStats({ eventId: 1 })).rejects.toThrow(/please login/i);
  });
});

describe("events.myVenueEvents/myVenueEventLiveStats — IDOR: Venue Admin de Casanova no puede operar Tía Felisa", () => {
  const ALLOWED = [1]; // solo Casanova (id=1)

  beforeEach(() => {
    mockRequireVenueAccess.mockReset();
    mockGetVenueEventsView.mockReset();
    mockGetEventLiveStats.mockReset();
    mockRequireVenueAccess.mockImplementation(async (_userId: number, _role: string, venueId: number) => {
      if (!ALLOWED.includes(venueId)) throw new TRPCError({ code: "FORBIDDEN", message: "Sin acceso a este venue" });
    });
  });

  it("myVenueEvents de su propio venue: permitido", async () => {
    mockGetVenueEventsView.mockResolvedValue({ current: [], upcoming: [], recentlyCompleted: [] });
    await expect(callerAs(10).myVenueEvents({ venueId: 1 })).resolves.toBeTruthy();
  });

  it("myVenueEvents de otro venue (id=2): DENEGADO, nunca compone la vista", async () => {
    await expect(callerAs(10).myVenueEvents({ venueId: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockGetVenueEventsView).not.toHaveBeenCalled();
  });

  it("myVenueEventLiveStats: el input NO acepta venueId — el eventId=42 pertenece a Tía Felisa (id=2), DENEGADO por el venueId REAL del evento", async () => {
    mockGetEventLiveStats.mockResolvedValue({ event: { id: 42, venueId: 2 }, checkInsTotal: 0, checkInsNative: 0, checkInsExternal: 0, ticketsIssued: 0 });
    await expect(callerAs(10).myVenueEventLiveStats({ eventId: 42 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("myVenueEventLiveStats de un evento de SU venue: permitido", async () => {
    mockGetEventLiveStats.mockResolvedValue({ event: { id: 43, venueId: 1 }, checkInsTotal: 5, checkInsNative: 5, checkInsExternal: 0, ticketsIssued: 5 });
    await expect(callerAs(10).myVenueEventLiveStats({ eventId: 43 })).resolves.toBeTruthy();
  });

  it("myVenueEventLiveStats de un evento inexistente: NOT_FOUND", async () => {
    mockGetEventLiveStats.mockResolvedValue(null);
    await expect(callerAs(10).myVenueEventLiveStats({ eventId: 9999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("events.publicUpcoming — MG-01 (pestaña Upcoming de la Home)", () => {
  beforeEach(() => {
    mockListUpcomingEvents.mockReset();
    mockListUpcomingEvents.mockResolvedValue([]);
  });

  it("sin sesión (público) responde sin lanzar, igual que publicActive/publicFeatured", async () => {
    await expect(callerWithoutSession().publicUpcoming({ communityId: 1 })).resolves.toEqual([]);
  });

  it("con communityId real de la URL -> resuelve la comunidad como [communityId], nunca 'all'", async () => {
    await callerWithoutSession().publicUpcoming({ communityId: 2 });
    expect(mockListUpcomingEvents).toHaveBeenCalledWith([2], expect.any(Date));
  });

  it("sin communityId (llamador sin contexto de comunidad) -> 'all', mismo criterio que publicActive/publicFeatured", async () => {
    await callerWithoutSession().publicUpcoming({});
    expect(mockListUpcomingEvents).toHaveBeenCalledWith("all", expect.any(Date));
  });

  it("una comunidad distinta (UVA en vez de IE) también resuelve como comunidad real, nunca hardcodeada", async () => {
    await callerWithoutSession().publicUpcoming({ communityId: 7 });
    expect(mockListUpcomingEvents).toHaveBeenCalledWith([7], expect.any(Date));
  });
});
