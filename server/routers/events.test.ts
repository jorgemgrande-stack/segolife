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

// MG-01 — publicUpcoming (pestaña "Upcoming" de la Home). FIX-04 —
// publicGetBySlug (protección de acceso directo por slug a un borrador).
// FIX-06 — getEventById/setEventHidden/deleteEvent mockeados para probar
// setHidden/delete/list de forma aislada, sin BD real.
const { mockListUpcomingEvents, mockGetEventBySlug, mockGetEventById, mockSetEventHidden, mockDeleteEvent, mockListEvents } = vi.hoisted(() => ({
  mockListUpcomingEvents: vi.fn(),
  mockGetEventBySlug: vi.fn(),
  mockGetEventById: vi.fn(),
  mockSetEventHidden: vi.fn(),
  mockDeleteEvent: vi.fn(),
  mockListEvents: vi.fn(),
}));
vi.mock("../db/eventsDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/eventsDb")>();
  return {
    ...actual,
    listUpcomingEvents: mockListUpcomingEvents,
    getEventBySlug: mockGetEventBySlug,
    getEventById: mockGetEventById,
    setEventHidden: mockSetEventHidden,
    deleteEvent: mockDeleteEvent,
    listEvents: mockListEvents,
  };
});

const { mockComputePurchaseAction } = vi.hoisted(() => ({ mockComputePurchaseAction: vi.fn() }));
vi.mock("../segolife/ticketing/purchaseAction", () => ({ computePurchaseAction: mockComputePurchaseAction }));

// FIX-06 — IDOR: comunidad del admin controlada de forma determinista, sin BD real.
const { mockGetCommunityAccess } = vi.hoisted(() => ({ mockGetCommunityAccess: vi.fn() }));
vi.mock("../_core/communityAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_core/communityAccess")>();
  return { ...actual, getCommunityAccess: mockGetCommunityAccess };
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

  it("events.setHidden rechaza sin sesión (FIX-06)", async () => {
    await expect(callerWithoutSession().setHidden({ id: 1, hidden: true })).rejects.toThrow(/please login/i);
  });

  it("events.delete rechaza sin sesión (FIX-06)", async () => {
    await expect(callerWithoutSession().delete({ id: 1 })).rejects.toThrow(/please login/i);
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

/**
 * FIX-04 — protección de acceso directo por slug: conocer el slug NUNCA
 * debe bastar para acceder a un borrador de Fourvenues (caso real:
 * pre-opening-x-fcking-wednesdays). Mismo "no encontrado" que un slug
 * inexistente, nunca revela que el evento existe en borrador — mismo
 * criterio ya aplicado (antes de este cambio) al check de comunidad.
 */
function fourvenuesEventDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event: {
      id: 42, slug: "pre-opening-x-fcking-wednesdays", status: "active",
      sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unpublished",
      // Futuro a propósito: isEventStudentVisible() ya no aplica el gate de
      // publicación a eventos pasados (ver eventsDb.ts) — estos tests
      // prueban precisamente ese gate, así que el evento debe ser futuro.
      startsAt: new Date(Date.now() + 10 * 86400000), endsAt: null,
      ...overrides,
    },
    venue: null,
    communities: [],
  };
}

describe("events.publicGetBySlug — FIX-04 (borrador de Fourvenues nunca accesible por slug directo)", () => {
  beforeEach(() => {
    mockGetEventBySlug.mockReset();
    mockComputePurchaseAction.mockReset();
  });

  it("evento Fourvenues sourcePublicationStatus='unpublished' (caso real: pre-opening-x-fcking-wednesdays) -> null, NUNCA se expone", async () => {
    mockGetEventBySlug.mockResolvedValue(fourvenuesEventDetail());
    const result = await callerWithoutSession().publicGetBySlug({ slug: "pre-opening-x-fcking-wednesdays" });
    expect(result).toBeNull();
    expect(mockComputePurchaseAction).not.toHaveBeenCalled();
  });

  it("evento Fourvenues sourcePublicationStatus='unknown' -> null (fail-closed, nunca se asume publicado)", async () => {
    mockGetEventBySlug.mockResolvedValue(fourvenuesEventDetail({ sourcePublicationStatus: "unknown" }));
    const result = await callerWithoutSession().publicGetBySlug({ slug: "algun-evento" });
    expect(result).toBeNull();
  });

  it("evento Fourvenues sourcePublicationStatus=null (nunca sincronizado tras la migración) -> null", async () => {
    mockGetEventBySlug.mockResolvedValue(fourvenuesEventDetail({ sourcePublicationStatus: null }));
    const result = await callerWithoutSession().publicGetBySlug({ slug: "algun-evento" });
    expect(result).toBeNull();
  });

  it("evento Fourvenues sourcePublicationStatus='published' (caso real: event 119, temporal aparte) -> visible, calcula purchaseAction con normalidad", async () => {
    mockGetEventBySlug.mockResolvedValue(fourvenuesEventDetail({ sourcePublicationStatus: "published" }));
    mockComputePurchaseAction.mockResolvedValue({ type: "unavailable" });
    const result = await callerWithoutSession().publicGetBySlug({ slug: "welcome-back-bash" });
    expect(result).not.toBeNull();
    expect(mockComputePurchaseAction).toHaveBeenCalled();
  });

  it("evento nativo (sin sourceType, nunca tocado por Fourvenues) activo -> visible, sin exigir sourcePublicationStatus — sin regresión sobre el catálogo nativo", async () => {
    mockGetEventBySlug.mockResolvedValue(fourvenuesEventDetail({ sourceType: null, sourcePublicationStatus: null }));
    mockComputePurchaseAction.mockResolvedValue({ type: "unavailable" });
    const result = await callerWithoutSession().publicGetBySlug({ slug: "fiesta-nativa" });
    expect(result).not.toBeNull();
  });

  it("evento inactivo (status='inactive') -> null, comportamiento previo intacto", async () => {
    mockGetEventBySlug.mockResolvedValue(fourvenuesEventDetail({ status: "inactive", sourcePublicationStatus: "published" }));
    const result = await callerWithoutSession().publicGetBySlug({ slug: "evento-desactivado" });
    expect(result).toBeNull();
  });

  it("slug inexistente -> null, mismo camino que un borrador (nunca distingue las dos respuestas)", async () => {
    mockGetEventBySlug.mockResolvedValue(null);
    const result = await callerWithoutSession().publicGetBySlug({ slug: "no-existe" });
    expect(result).toBeNull();
  });

  // Bug real descubierto en el primer sync de producción: el sync
  // incremental de Fourvenues solo revisita ~180 días atrás, así que un
  // evento de hace casi un año (event 119 real) NUNCA vuelve a recibir un
  // sourcePublicationStatus confirmado — se queda en NULL para siempre. El
  // acceso histórico legítimo (p.ej. desde un ticket ya comprado) no debe
  // romperse por eso.
  it("evento Fourvenues YA PASADO con sourcePublicationStatus=null (caso real: event 119, fuera de la ventana de sync) -> SÍ accesible, el gate de publicación no aplica a eventos pasados", async () => {
    mockGetEventBySlug.mockResolvedValue(fourvenuesEventDetail({
      id: 119, slug: "welcome-back-bash", sourcePublicationStatus: null,
      startsAt: new Date(Date.now() - 330 * 86400000),
    }));
    mockComputePurchaseAction.mockResolvedValue({ type: "unavailable" });
    const result = await callerWithoutSession().publicGetBySlug({ slug: "welcome-back-bash" });
    expect(result).not.toBeNull();
  });
});

function callerAsAdmin(userId = 1) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return eventsRouter.createCaller({ user: { id: userId, role: "admin" } } as any);
}

describe("events.setHidden — FIX-06 (visibilidad local, mismo patrón que setFeatured)", () => {
  beforeEach(() => {
    mockGetCommunityAccess.mockReset();
    mockGetEventById.mockReset();
    mockSetEventHidden.mockReset();
  });

  it("evento inexistente: NOT_FOUND, nunca llega a setEventHidden", async () => {
    mockGetEventById.mockResolvedValue(null);
    await expect(callerAsAdmin().setHidden({ id: 999, hidden: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockSetEventHidden).not.toHaveBeenCalled();
  });

  it("admin con acceso 'all': oculta con éxito", async () => {
    mockGetCommunityAccess.mockResolvedValue("all");
    mockGetEventById.mockResolvedValue({ event: { id: 1 }, venue: null, communities: [{ id: 1, name: "Segolife IE", slug: "ie" }] });
    mockSetEventHidden.mockResolvedValue({ id: 1, isHidden: true });
    const result = await callerAsAdmin().setHidden({ id: 1, hidden: true });
    expect(result.success).toBe(true);
    expect(mockSetEventHidden).toHaveBeenCalledWith(1, true);
  });

  it("IDOR — admin de comunidad UVA (id=2) NUNCA puede ocultar un evento SOLO de la comunidad IE (id=1)", async () => {
    mockGetCommunityAccess.mockResolvedValue([2]); // solo UVA
    mockGetEventById.mockResolvedValue({ event: { id: 1 }, venue: null, communities: [{ id: 1, name: "Segolife IE", slug: "ie" }] });
    await expect(callerAsAdmin().setHidden({ id: 1, hidden: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockSetEventHidden).not.toHaveBeenCalled();
  });

  it("admin de comunidad IE SÍ puede ocultar un evento de su propia comunidad", async () => {
    mockGetCommunityAccess.mockResolvedValue([1]);
    mockGetEventById.mockResolvedValue({ event: { id: 1 }, venue: null, communities: [{ id: 1, name: "Segolife IE", slug: "ie" }] });
    mockSetEventHidden.mockResolvedValue({ id: 1, isHidden: false });
    const result = await callerAsAdmin().setHidden({ id: 1, hidden: false });
    expect(result.success).toBe(true);
  });
});

describe("events.delete — FIX-06 (borrado bloqueado por integridad real, spec §11-§15)", () => {
  beforeEach(() => {
    mockGetCommunityAccess.mockReset();
    mockGetEventById.mockReset();
    mockDeleteEvent.mockReset();
  });

  it("evento inexistente: NOT_FOUND, nunca llega a deleteEvent", async () => {
    mockGetEventById.mockResolvedValue(null);
    await expect(callerAsAdmin().delete({ id: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDeleteEvent).not.toHaveBeenCalled();
  });

  it("evento manual sin actividad real: se elimina con éxito", async () => {
    mockGetCommunityAccess.mockResolvedValue("all");
    mockGetEventById.mockResolvedValue({ event: { id: 1 }, venue: null, communities: [] });
    mockDeleteEvent.mockResolvedValue(undefined);
    const result = await callerAsAdmin().delete({ id: 1 });
    expect(result.success).toBe(true);
  });

  it("evento con actividad real bloqueada (EventDeleteBlockedError) -> CONFLICT con el motivo real, nunca un error genérico", async () => {
    const { EventDeleteBlockedError } = await import("../db/eventsDb");
    mockGetCommunityAccess.mockResolvedValue("all");
    mockGetEventById.mockResolvedValue({ event: { id: 1 }, venue: null, communities: [] });
    mockDeleteEvent.mockRejectedValue(new EventDeleteBlockedError(["tiene pedidos reales"]));
    await expect(callerAsAdmin().delete({ id: 1 })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("tiene pedidos reales"),
    });
  });

  it("un error inesperado (no EventDeleteBlockedError) se propaga tal cual, nunca se enmascara como bloqueo de integridad", async () => {
    mockGetCommunityAccess.mockResolvedValue("all");
    mockGetEventById.mockResolvedValue({ event: { id: 1 }, venue: null, communities: [] });
    mockDeleteEvent.mockRejectedValue(new Error("fallo de conexión inesperado"));
    await expect(callerAsAdmin().delete({ id: 1 })).rejects.toThrow("fallo de conexión inesperado");
  });

  it("IDOR — admin de comunidad UVA (id=2) NUNCA puede eliminar un evento SOLO de la comunidad IE (id=1)", async () => {
    mockGetCommunityAccess.mockResolvedValue([2]);
    mockGetEventById.mockResolvedValue({ event: { id: 1 }, venue: null, communities: [{ id: 1, name: "Segolife IE", slug: "ie" }] });
    await expect(callerAsAdmin().delete({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockDeleteEvent).not.toHaveBeenCalled();
  });

  it("no existe manipulación posible del eventId vía el input — solo acepta un id numérico positivo, cualquier otro valor es rechazado por zod antes de llegar al handler", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(callerAsAdmin().delete({ id: -1 } as any)).rejects.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(callerAsAdmin().delete({ id: "1" } as any)).rejects.toThrow();
    expect(mockDeleteEvent).not.toHaveBeenCalled();
  });
});

describe("events.list — FIX-06 (rango de fechas Desde/Hasta)", () => {
  beforeEach(() => {
    mockGetCommunityAccess.mockReset();
    mockListEvents.mockReset();
    mockListEvents.mockResolvedValue({ items: [], total: 0 });
  });

  it("Desde posterior a Hasta -> BAD_REQUEST, nunca llega a tocar comunidad/BD", async () => {
    await expect(
      callerAsAdmin().list({ fromDate: "2026-03-31", toDate: "2026-03-01", limit: 50, offset: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockGetCommunityAccess).not.toHaveBeenCalled();
    expect(mockListEvents).not.toHaveBeenCalled();
  });

  it("fromDate/toDate con formato inválido (no YYYY-MM-DD) son rechazados por zod", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(callerAsAdmin().list({ fromDate: "31-03-2026", limit: 50, offset: 0 } as any)).rejects.toThrow();
  });

  it("mismo día en Desde y Hasta: válido (no es un rango invertido) — se traduce a límites UTC [ese día, día siguiente)", async () => {
    mockGetCommunityAccess.mockResolvedValue("all");
    await callerAsAdmin().list({ fromDate: "2026-03-15", toDate: "2026-03-15", limit: 50, offset: 0 });
    expect(mockListEvents).toHaveBeenCalledWith(expect.objectContaining({
      fromDate: new Date("2026-03-14T23:00:00.000Z"),
      toDate: new Date("2026-03-15T23:00:00.000Z"),
    }));
  });

  it("solo Desde: fromDate presente, toDate ausente en la llamada a listEvents", async () => {
    mockGetCommunityAccess.mockResolvedValue("all");
    await callerAsAdmin().list({ fromDate: "2026-03-01", limit: 50, offset: 0 });
    expect(mockListEvents).toHaveBeenCalledWith(expect.objectContaining({
      fromDate: new Date("2026-02-28T23:00:00.000Z"),
      toDate: undefined,
    }));
  });

  it("solo Hasta: toDate presente (límite superior EXCLUSIVO, día siguiente), fromDate ausente", async () => {
    mockGetCommunityAccess.mockResolvedValue("all");
    await callerAsAdmin().list({ toDate: "2026-03-31", limit: 50, offset: 0 });
    expect(mockListEvents).toHaveBeenCalledWith(expect.objectContaining({
      fromDate: undefined,
      toDate: new Date("2026-03-31T22:00:00.000Z"),
    }));
  });

  it("sin fromDate ni toDate: sin restricción, comportamiento previo intacto", async () => {
    mockGetCommunityAccess.mockResolvedValue("all");
    await callerAsAdmin().list({ limit: 50, offset: 0 });
    expect(mockListEvents).toHaveBeenCalledWith(expect.objectContaining({ fromDate: undefined, toDate: undefined }));
  });

  it("se combina con el resto de filtros existentes (venue/status/isFeatured) sin desplazarlos", async () => {
    mockGetCommunityAccess.mockResolvedValue("all");
    await callerAsAdmin().list({ venueId: 5, status: "active", fromDate: "2026-01-01", toDate: "2026-03-31", limit: 50, offset: 0 });
    expect(mockListEvents).toHaveBeenCalledWith(expect.objectContaining({
      venueId: 5, status: "active",
      fromDate: new Date("2025-12-31T23:00:00.000Z"),
      toDate: new Date("2026-03-31T22:00:00.000Z"),
    }));
  });
});
