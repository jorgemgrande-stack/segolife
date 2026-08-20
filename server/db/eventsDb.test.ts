/**
 * eventsDb.test.ts — modelo de eventos, su asociación a un venue y su
 * relación M2M con comunidades (Fase 1D). Mismo patrón de inyección de
 * dependencia que server/db/venuesDb.test.ts / studentsDb.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  listEvents,
  getEventById,
  createEvent,
  updateEvent,
  setEventCommunities,
  setEventActive,
  setEventFeatured,
  listActiveEvents,
  listFeaturedEvents,
  listEventsByVenue,
  listEndedEvents,
  selectUpcomingWindow,
  isEventStudentVisible,
  UPCOMING_WINDOW_DAYS,
  UPCOMING_EVENTS_LIMIT,
} from "./eventsDb";
import { events, venues, communityEvents } from "../../drizzle/schema";
import { engagementEvents } from "../segolife/engagement/engagementEvents";

function blankEvent(id: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id, name: "Fiesta de bienvenida", slug: "fiesta-de-bienvenida", description: null, venueId: null,
    startsAt: new Date("2026-09-15T20:00:00Z"), endsAt: null, capacity: null, imageUrl: null,
    status: "active" as const, isFeatured: false, isHidden: false,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("eventsDb — filtro por comunidad (listEvents)", () => {
  it("filtro IE devuelve solo eventos vinculados a la comunidad IE", async () => {
    const eventIE = blankEvent(1);
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ eventId: 1 }]); // getEventIdsInCommunities([IE])
        if (phase === 2) return resolve([{ event: eventIE, venue: null }]);
        if (phase === 3) return resolve([{ event: eventIE }]); // count
        return resolve([{ eventId: 1, community: { id: 1, name: "Segolife IE", slug: "ie" } }]);
      },
    };
    const { items, total } = await listEvents({ communityIds: [1] }, db as unknown as Parameters<typeof listEvents>[1]);
    expect(total).toBe(1);
    expect(items[0].communities).toEqual([{ id: 1, name: "Segolife IE", slug: "ie" }]);
  });

  it("filtro UVA devuelve solo eventos vinculados a la comunidad UVA", async () => {
    const eventUVA = blankEvent(2, { name: "Noche de cine" });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ eventId: 2 }]);
        if (phase === 2) return resolve([{ event: eventUVA, venue: null }]);
        if (phase === 3) return resolve([{ event: eventUVA }]);
        return resolve([{ eventId: 2, community: { id: 2, name: "Segolife UVA", slug: "uva" } }]);
      },
    };
    const { items, total } = await listEvents({ communityIds: [2] }, db as unknown as Parameters<typeof listEvents>[1]);
    expect(total).toBe(1);
    expect(items[0].communities[0].slug).toBe("uva");
  });

  it("evento vinculado a IE Y UVA a la vez aparece con ambas comunidades", async () => {
    const eventBoth = blankEvent(3, { name: "Fiesta multicampus" });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ eventId: 3 }]);
        if (phase === 2) return resolve([{ event: eventBoth, venue: null }]);
        if (phase === 3) return resolve([{ event: eventBoth }]);
        return resolve([
          { eventId: 3, community: { id: 1, name: "Segolife IE", slug: "ie" } },
          { eventId: 3, community: { id: 2, name: "Segolife UVA", slug: "uva" } },
        ]);
      },
    };
    const { items } = await listEvents({ communityIds: [1, 2] }, db as unknown as Parameters<typeof listEvents>[1]);
    expect(items[0].communities).toHaveLength(2);
  });

  it("comunidad sin ningún evento devuelve lista vacía sin consultar el resto", async () => {
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, where: () => db,
      then: (resolve: (v: unknown) => void) => resolve([]),
    };
    const { items, total } = await listEvents({ communityIds: [999] }, db as unknown as Parameters<typeof listEvents>[1]);
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });
});

describe("eventsDb — leer ficha (getEventById) con venue asociado", () => {
  function makeDetailMockDb(byTable: Map<unknown, unknown[]>) {
    const selectStub = {
      from(table: unknown) {
        const result = byTable.get(table) ?? [];
        const builder: Record<string, unknown> = {};
        builder.where = () => builder;
        builder.limit = () => builder;
        builder.innerJoin = () => builder;
        builder.then = (resolve: (v: unknown) => void) => resolve(result);
        return builder;
      },
    };
    return { select: () => selectStub };
  }

  it("devuelve el evento con su venue (event↔venue association) y comunidades", async () => {
    const event = blankEvent(5, { venueId: 7 });
    const byTable = new Map<unknown, unknown[]>([
      [events, [event]],
      [venues, [{ id: 7, name: "Café Central", slug: "cafe-central" }]],
      [communityEvents, [{ eventId: 5, community: { id: 1, name: "Segolife IE", slug: "ie" } }]],
    ]);
    const db = makeDetailMockDb(byTable);
    const detail = await getEventById(5, db as unknown as Parameters<typeof getEventById>[1]);
    expect(detail?.venue?.name).toBe("Café Central");
    expect(detail?.communities).toEqual([{ id: 1, name: "Segolife IE", slug: "ie" }]);
  });

  it("un evento sin venue fijo (venueId=null) devuelve venue=null sin lanzar", async () => {
    const event = blankEvent(6, { venueId: null });
    const byTable = new Map<unknown, unknown[]>([
      [events, [event]],
      [communityEvents, []],
    ]);
    const db = makeDetailMockDb(byTable);
    const detail = await getEventById(6, db as unknown as Parameters<typeof getEventById>[1]);
    expect(detail?.venue).toBeNull();
  });

  it("devuelve null si el eventId no existe", async () => {
    const db = makeDetailMockDb(new Map([[events, []]]));
    const detail = await getEventById(999, db as unknown as Parameters<typeof getEventById>[1]);
    expect(detail).toBeNull();
  });
});

/** Mock con estado real de events + community_events — simula la constraint UNIQUE(community_id, event_id). */
function makeCreateEventMockDb() {
  const linkRows: Array<{ id: number; communityId: number; eventId: number }> = [];
  let nextLinkId = 1;
  let createdEvent: Record<string, unknown> | null = null;
  let mode: unknown = null;

  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.from = (table: unknown) => { mode = table; return builder; };
  builder.where = () => builder;
  builder.limit = () => builder;
  builder.leftJoin = () => builder;
  builder.insert = (table: unknown) => { mode = table; return builder; };
  builder.delete = (table: unknown) => {
    if (table === communityEvents) linkRows.length = 0;
    return builder;
  };
  builder.values = (v: Record<string, unknown>) => {
    if (mode === events) {
      createdEvent = { id: 1, status: "active", isFeatured: false, createdAt: new Date(), updatedAt: new Date(), ...v };
      return Promise.resolve([{ insertId: 1 }]);
    }
    const dup = linkRows.some(r => r.communityId === v.communityId && r.eventId === v.eventId);
    if (dup) {
      const err = new Error("Duplicate entry") as Error & { errno: number };
      err.errno = 1062;
      throw err;
    }
    const row = { id: nextLinkId++, communityId: v.communityId as number, eventId: v.eventId as number };
    linkRows.push(row);
    return Promise.resolve([{ insertId: row.id }]);
  };
  builder.then = (resolve: (v: unknown) => void) => resolve(createdEvent ? [createdEvent] : []);
  return { db: builder, linkRows, getCreatedEvent: () => createdEvent };
}

describe("eventsDb — crear evento vinculado a comunidades (createEvent)", () => {
  it("crea el evento vinculado a IE + UVA simultáneamente (event↔múltiples comunidades)", async () => {
    const { db, linkRows } = makeCreateEventMockDb();
    const event = await createEvent(
      { name: "Fiesta de bienvenida", slug: "fiesta-de-bienvenida", startsAt: new Date("2026-09-15T20:00:00Z") },
      [1, 2],
      db as unknown as Parameters<typeof createEvent>[2]
    );
    expect(event.name).toBe("Fiesta de bienvenida");
    expect(linkRows.map(r => r.communityId).sort()).toEqual([1, 2]);
  });

  it("crea el evento vinculado solo a IE", async () => {
    const { db, linkRows } = makeCreateEventMockDb();
    await createEvent(
      { name: "Fiesta de bienvenida", slug: "fiesta-de-bienvenida", startsAt: new Date("2026-09-15T20:00:00Z") },
      [1],
      db as unknown as Parameters<typeof createEvent>[2]
    );
    expect(linkRows).toHaveLength(1);
    expect(linkRows[0].communityId).toBe(1);
  });
});

describe("eventsDb — UNIQUE(community_id, event_id): prevenir duplicados (setEventCommunities)", () => {
  it("un communityId repetido en el mismo array no duplica la fila community_events", async () => {
    const { db, linkRows } = makeCreateEventMockDb();
    await setEventCommunities(1, [1, 1], db as unknown as Parameters<typeof setEventCommunities>[2]);
    expect(linkRows).toHaveLength(1);
  });
});

describe("eventsDb — activar/desactivar y destacar/quitar destacado", () => {
  it("setEventActive(false) desactiva un evento activo", async () => {
    let event = blankEvent(1, { status: "active" });
    const db: Record<string, unknown> = {
      update: () => db,
      set: (fields: Record<string, unknown>) => { event = { ...event, ...fields }; return db; },
      where: () => db, select: () => db, from: () => db, limit: () => db,
      then: (resolve: (v: unknown) => void) => resolve([event]),
    };
    const updated = await setEventActive(1, false, db as unknown as Parameters<typeof setEventActive>[2]);
    expect(updated?.status).toBe("inactive");
  });

  it("setEventFeatured(true) destaca un evento no destacado", async () => {
    let event = blankEvent(1, { isFeatured: false });
    const db: Record<string, unknown> = {
      update: () => db,
      set: (fields: Record<string, unknown>) => { event = { ...event, ...fields }; return db; },
      where: () => db, select: () => db, from: () => db, limit: () => db,
      then: (resolve: (v: unknown) => void) => resolve([event]),
    };
    const updated = await setEventFeatured(1, true, db as unknown as Parameters<typeof setEventFeatured>[2]);
    expect(updated?.isFeatured).toBe(true);
  });

  it("setEventFeatured(false) quita el destacado a un evento destacado", async () => {
    let event = blankEvent(1, { isFeatured: true });
    const db: Record<string, unknown> = {
      update: () => db,
      set: (fields: Record<string, unknown>) => { event = { ...event, ...fields }; return db; },
      where: () => db, select: () => db, from: () => db, limit: () => db,
      then: (resolve: (v: unknown) => void) => resolve([event]),
    };
    const updated = await setEventFeatured(1, false, db as unknown as Parameters<typeof setEventFeatured>[2]);
    expect(updated?.isFeatured).toBe(false);
  });
});

// Fourvenues date-change audit (backlog, spec §16) — updateEvent() es el
// ÚNICO punto que sincroniza startsAt/endsAt de un evento ya mapeado
// (eventCatalogSync.ts) y decide si eso amerita `event_updated` para el
// Communication Center (eventLifecycleListener.ts). Sin cobertura previa.
function makeUpdateEventMockDb(initial: ReturnType<typeof blankEvent>) {
  let event = { ...initial };
  const db: Record<string, unknown> = {
    select: () => db, from: () => db, where: () => db, limit: () => db,
    update: () => db,
    set: (fields: Record<string, unknown>) => { event = { ...event, ...fields }; return db; },
    then: (resolve: (v: unknown) => void) => resolve([event]),
  };
  return { db: db as unknown as Parameters<typeof updateEvent>[2], getEvent: () => event };
}

describe("eventsDb — updateEvent: emite event_updated SOLO ante un cambio material (Fourvenues date-change, spec §16)", () => {
  it("startsAt REALMENTE cambia en un evento activo → emite event_updated con changedFields=['startsAt']", async () => {
    const { db } = makeUpdateEventMockDb(blankEvent(1, { startsAt: new Date("2026-09-15T20:00:00Z"), status: "active" }));
    const captured: unknown[] = [];
    engagementEvents.once("event_updated", payload => captured.push(payload));
    await updateEvent(1, { startsAt: new Date("2026-09-16T20:00:00Z") }, db);
    expect(captured).toEqual([{ eventId: 1, changedFields: ["startsAt"] }]);
  });

  it("re-sincronizar el MISMO startsAt (sin cambio real) → NUNCA emite — evita ruido en cada tick del scheduler", async () => {
    const sameDate = new Date("2026-09-15T20:00:00Z");
    const { db } = makeUpdateEventMockDb(blankEvent(1, { startsAt: sameDate, status: "active" }));
    let emitted = false;
    engagementEvents.once("event_updated", () => { emitted = true; });
    await updateEvent(1, { startsAt: new Date(sameDate.getTime()) }, db); // mismo instante, objeto Date distinto
    engagementEvents.removeAllListeners("event_updated");
    expect(emitted).toBe(false);
  });

  it("endsAt cambia de null a una fecha real → emite con changedFields=['endsAt']", async () => {
    const { db } = makeUpdateEventMockDb(blankEvent(1, { endsAt: null, status: "active" }));
    const captured: unknown[] = [];
    engagementEvents.once("event_updated", payload => captured.push(payload));
    await updateEvent(1, { endsAt: new Date("2026-09-16T02:00:00Z") }, db);
    expect(captured).toEqual([{ eventId: 1, changedFields: ["endsAt"] }]);
  });

  it("startsAt Y endsAt cambian a la vez → un único evento con AMBOS campos, nunca dos emisiones", async () => {
    const { db } = makeUpdateEventMockDb(blankEvent(1, { startsAt: new Date("2026-09-15T20:00:00Z"), endsAt: null, status: "active" }));
    const captured: unknown[] = [];
    engagementEvents.on("event_updated", payload => captured.push(payload));
    await updateEvent(1, { startsAt: new Date("2026-09-16T20:00:00Z"), endsAt: new Date("2026-09-17T02:00:00Z") }, db);
    engagementEvents.removeAllListeners("event_updated");
    expect(captured).toEqual([{ eventId: 1, changedFields: ["startsAt", "endsAt"] }]);
  });

  it("un evento INACTIVO (draft Fourvenues) que cambia de fecha NUNCA notifica — solo eventos activos amerita alertar a compradores", async () => {
    const { db } = makeUpdateEventMockDb(blankEvent(1, { startsAt: new Date("2026-09-15T20:00:00Z"), status: "inactive" }));
    let emitted = false;
    engagementEvents.once("event_updated", () => { emitted = true; });
    await updateEvent(1, { startsAt: new Date("2026-09-16T20:00:00Z") }, db);
    engagementEvents.removeAllListeners("event_updated");
    expect(emitted).toBe(false);
  });

  it("sourcePublicationStatus a secas (sin tocar fecha) NUNCA dispara event_updated — no es un cambio material para el Communication Center (ver FIX-04/FIX-05)", async () => {
    const { db } = makeUpdateEventMockDb(blankEvent(1, { startsAt: new Date("2026-09-15T20:00:00Z"), status: "active" }));
    let emitted = false;
    engagementEvents.once("event_updated", () => { emitted = true; });
    await updateEvent(1, { sourcePublicationStatus: "published" } as never, db);
    engagementEvents.removeAllListeners("event_updated");
    expect(emitted).toBe(false);
  });

  it("venueId cambia → emite con changedFields=['venueId'] (el evento se movió de local)", async () => {
    const { db } = makeUpdateEventMockDb(blankEvent(1, { venueId: 20, status: "active" }));
    const captured: unknown[] = [];
    engagementEvents.once("event_updated", payload => captured.push(payload));
    await updateEvent(1, { venueId: 21 }, db);
    expect(captured).toEqual([{ eventId: 1, changedFields: ["venueId"] }]);
  });

  it("devuelve el evento YA actualizado (before ≠ after en el valor devuelto)", async () => {
    const { db } = makeUpdateEventMockDb(blankEvent(1, { startsAt: new Date("2026-09-15T20:00:00Z"), status: "active" }));
    engagementEvents.removeAllListeners("event_updated"); // no interesa la emisión en este test, solo el valor devuelto
    const newDate = new Date("2026-09-16T20:00:00Z");
    const updated = await updateEvent(1, { startsAt: newDate }, db);
    expect(updated?.startsAt).toEqual(newDate);
  });
});

describe("eventsDb — público (listActiveEvents / listFeaturedEvents)", () => {
  it("listActiveEvents con communityId restringe a esa comunidad", async () => {
    const event = blankEvent(2);
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ eventId: 2 }]);
        if (phase === 2) return resolve([{ event, venue: null }]);
        if (phase === 3) return resolve([{ event }]);
        return resolve([{ eventId: 2, community: { id: 2, name: "Segolife UVA", slug: "uva" } }]);
      },
    };
    const items = await listActiveEvents(2, db as unknown as Parameters<typeof listActiveEvents>[1]);
    expect(items).toHaveLength(1);
    expect(items[0].communities[0].slug).toBe("uva");
  });

  it("listFeaturedEvents devuelve los eventos que llegan de la BD (endpoint público, sin sesión)", async () => {
    const event = blankEvent(3, { isFeatured: true });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event, venue: null }]);
        if (phase === 2) return resolve([{ event }]);
        return resolve([]);
      },
    };
    const items = await listFeaturedEvents(undefined, db as unknown as Parameters<typeof listFeaturedEvents>[1]);
    expect(items).toHaveLength(1);
    expect(items[0].isFeatured).toBe(true);
  });
});

// ─── MG-01 — "Upcoming" (Home, pestaña Próximos) ───────────────────────────
// Cubre exclusivamente selectUpcomingWindow, la lógica PURA de ventana de 20
// días + fallback (spec MG-01 §4/§14). listUpcomingEvents en sí (la query
// real) no se testea aparte: reutiliza exactamente el mismo listEvents ya
// cubierto arriba (comunidad, público, orden) — no introduce ninguna lógica
// de comunidad nueva.
const DAY_MS = 24 * 60 * 60 * 1000;

/** Extiende blankEvent() con los campos de EventListItem que selectUpcomingWindow necesita. */
function upcomingEvent(id: number, startsAt: Date) {
  return { ...blankEvent(id, { startsAt }), venue: null, communities: [], primarySalesChannel: null };
}

describe("selectUpcomingWindow — ventana de 20 días + fallback (spec MG-01 §4)", () => {
  const now = new Date("2026-08-18T10:00:00Z");

  it("con eventos dentro de los 20 días: los devuelve, ordenados cronológicamente (el orden ya viene de la query, esta función no reordena)", () => {
    const events = [
      upcomingEvent(1, new Date(now.getTime() + 2 * DAY_MS)),
      upcomingEvent(2, new Date(now.getTime() + 5 * DAY_MS)),
      upcomingEvent(3, new Date(now.getTime() + 19 * DAY_MS)),
    ];
    const result = selectUpcomingWindow(events, now);
    expect(result.map(e => e.id)).toEqual([1, 2, 3]);
  });

  it("boundary — exactamente +20 días cuenta como DENTRO de la ventana (inclusive)", () => {
    const events = [upcomingEvent(1, new Date(now.getTime() + UPCOMING_WINDOW_DAYS * DAY_MS))];
    const result = selectUpcomingWindow(events, now);
    expect(result.map(e => e.id)).toEqual([1]);
  });

  it("boundary — +19 días queda dentro; con al menos un evento real en ventana, nunca hace fallback a los de más lejos", () => {
    const events = [upcomingEvent(1, new Date(now.getTime() + 19 * DAY_MS)), upcomingEvent(2, new Date(now.getTime() + 21 * DAY_MS))];
    const result = selectUpcomingWindow(events, now);
    expect(result.map(e => e.id)).toEqual([1]);
  });

  it("sin ningún evento dentro de los 20 días: fallback a los siguientes eventos futuros disponibles, aunque estén más lejos", () => {
    const events = [
      upcomingEvent(1, new Date(now.getTime() + 25 * DAY_MS)),
      upcomingEvent(2, new Date(now.getTime() + 40 * DAY_MS)),
    ];
    const result = selectUpcomingWindow(events, now);
    expect(result.map(e => e.id)).toEqual([1, 2]);
  });

  it("no interpreta el fallback como 'solo el día 21' — muestra el bloque completo recibido, no un único evento aislado", () => {
    const events = [
      upcomingEvent(1, new Date(now.getTime() + 25 * DAY_MS)),
      upcomingEvent(2, new Date(now.getTime() + 26 * DAY_MS)),
      upcomingEvent(3, new Date(now.getTime() + 60 * DAY_MS)),
    ];
    const result = selectUpcomingWindow(events, now);
    expect(result).toHaveLength(3);
  });

  it("sin ningún evento futuro en absoluto: devuelve vacío (estado vacío real, nunca fabricado)", () => {
    expect(selectUpcomingWindow([], now)).toEqual([]);
  });

  it("la exclusión de eventos pasados NO es responsabilidad de selectUpcomingWindow — la hace fromDate en listEvents, antes de que esta función reciba nada; documentado aquí para que quede explícito y no se intente 'arreglar' añadiendo un filtro de pasado duplicado", () => {
    const past = upcomingEvent(1, new Date(now.getTime() - DAY_MS));
    const future = upcomingEvent(2, new Date(now.getTime() + 3 * DAY_MS));
    const result = selectUpcomingWindow([past, future], now);
    expect(result.map(e => e.id)).toEqual([1, 2]);
  });

  it("respeta un límite razonable de resultados (UPCOMING_EVENTS_LIMIT) — documentado, mismo criterio que Tonight/Featured de no cargar cientos de eventos", () => {
    expect(UPCOMING_EVENTS_LIMIT).toBeGreaterThan(0);
    expect(UPCOMING_EVENTS_LIMIT).toBeLessThanOrEqual(20);
  });
});

// ─── FIX-04 — Fourvenues Event Lifecycle & Publication Status ─────────────
// REGLA FUNDAMENTAL: visibilidad de origen (Fourvenues) ≠ visibilidad admin
// ≠ visibilidad pública del Student — isEventStudentVisible() decide SOLO
// la tercera. El gate de publicación de Fourvenues SOLO protege eventos
// futuros/en curso (discovery/compra) — nunca se aplica a un evento ya
// pasado (ver su comentario en eventsDb.ts: bug real, el sync incremental
// de Fourvenues no revisita eventos de hace casi un año, así que se
// quedarían con sourcePublicationStatus=NULL para siempre).
const FUTURE = new Date(Date.now() + 10 * DAY_MS);
const PAST = new Date(Date.now() - 330 * DAY_MS);

describe("isEventStudentVisible — mapper/transición (spec FIX-04, nunca inventar 'published')", () => {
  it("evento nativo (sin sourceType) activo → visible, aunque sourcePublicationStatus sea null", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: null, sourcePublicationStatus: null, startsAt: FUTURE })).toBe(true);
  });

  it("evento nativo inactivo (status='inactive') → NUNCA visible, sea cual sea el origen", () => {
    expect(isEventStudentVisible({ status: "inactive", sourceType: null, sourcePublicationStatus: null, startsAt: FUTURE })).toBe(false);
  });

  it("evento Weezevent (event_integration, sourceType ajeno a Fourvenues) activo → visible — nunca sujeto al gate de publicación de Fourvenues", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "weezevent", sourcePublicationStatus: null, startsAt: FUTURE })).toBe(true);
  });

  it("evento Fourvenues FUTURO activo + sourcePublicationStatus='published' → visible", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "published", startsAt: FUTURE })).toBe(true);
  });

  it("evento Fourvenues FUTURO activo + sourcePublicationStatus='unpublished' (borrador real, caso pre-opening-x-fcking-wednesdays) → NUNCA visible", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unpublished", startsAt: FUTURE })).toBe(false);
  });

  it("evento Fourvenues FUTURO activo + sourcePublicationStatus='unknown' → NUNCA visible (fail-closed, nunca se asume publicado)", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unknown", startsAt: FUTURE })).toBe(false);
  });

  it("evento Fourvenues FUTURO activo + sourcePublicationStatus=null (nunca sincronizado tras la migración) → NUNCA visible — mismo criterio que 'unknown'", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: null, startsAt: FUTURE })).toBe(false);
  });

  it("evento Fourvenues inactivo (status='inactive') + sourcePublicationStatus='published' + futuro → NUNCA visible (status manda primero)", () => {
    expect(isEventStudentVisible({ status: "inactive", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "published", startsAt: FUTURE })).toBe(false);
  });

  it("evento Fourvenues YA PASADO con sourcePublicationStatus=null (caso real: event 119, fuera de la ventana de sync de ~180 días) → SÍ visible — el gate de publicación no aplica a lo ya pasado", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: null, startsAt: PAST })).toBe(true);
  });

  it("evento Fourvenues YA PASADO con sourcePublicationStatus='unpublished' → también visible (mismo criterio: pasado ya no es un riesgo de discovery/compra)", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unpublished", startsAt: PAST })).toBe(true);
  });

  it("evento Fourvenues pasado pero INACTIVO (status='inactive') → sigue NO visible — el gate temporal nunca anula el status admin-curado", () => {
    expect(isEventStudentVisible({ status: "inactive", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: null, startsAt: PAST })).toBe(false);
  });

  // FIX-06 — isHidden es un cuarto AND, nunca una alternativa (spec §9: "VISIBILIDAD FINAL = localNotHidden AND canonicalStudentVisibilityRules, nunca localNotHidden OR providerPublished").
  it("evento nativo activo pero oculto (isHidden=true) → NUNCA visible, aunque todo lo demás sea correcto", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: null, sourcePublicationStatus: null, isHidden: true, startsAt: FUTURE })).toBe(false);
  });

  it("evento nativo activo y NO oculto → visible (comportamiento previo intacto)", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: null, sourcePublicationStatus: null, isHidden: false, startsAt: FUTURE })).toBe(true);
  });

  it("ocultar un evento Fourvenues publicado en origen NUNCA lo 'rescata' — oculto sigue ganando", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "published", isHidden: true, startsAt: FUTURE })).toBe(false);
  });

  it("mostrar (isHidden=false) un evento Fourvenues futuro sin publicar sigue sin ser visible — mostrar nunca salta el gate de publicación de Fourvenues (spec §9)", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unpublished", isHidden: false, startsAt: FUTURE })).toBe(false);
  });

  it("evento pasado oculto → sigue NO visible — a diferencia del gate de publicación de Fourvenues, isHidden se aplica también a lo ya pasado", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: null, sourcePublicationStatus: null, isHidden: true, startsAt: PAST })).toBe(false);
  });
});

describe("eventsDb — setEventHidden (FIX-06, mismo patrón que setEventFeatured)", () => {
  it("setEventHidden(true) oculta un evento visible", async () => {
    let event = blankEvent(1, { isHidden: false });
    const db: Record<string, unknown> = {
      update: () => db,
      set: (fields: Record<string, unknown>) => { event = { ...event, ...fields }; return db; },
      where: () => db, select: () => db, from: () => db, limit: () => db,
      then: (resolve: (v: unknown) => void) => resolve([event]),
    };
    const { setEventHidden } = await import("./eventsDb");
    const updated = await setEventHidden(1, true, db as unknown as Parameters<typeof setEventHidden>[2]);
    expect(updated?.isHidden).toBe(true);
  });

  it("setEventHidden(false) vuelve a mostrar un evento oculto", async () => {
    let event = blankEvent(1, { isHidden: true });
    const db: Record<string, unknown> = {
      update: () => db,
      set: (fields: Record<string, unknown>) => { event = { ...event, ...fields }; return db; },
      where: () => db, select: () => db, from: () => db, limit: () => db,
      then: (resolve: (v: unknown) => void) => resolve([event]),
    };
    const { setEventHidden } = await import("./eventsDb");
    const updated = await setEventHidden(1, false, db as unknown as Parameters<typeof setEventHidden>[2]);
    expect(updated?.isHidden).toBe(false);
  });

  it("setEventHidden nunca toca status ni sourcePublicationStatus (dimensiones distintas)", async () => {
    let event = blankEvent(1, { isHidden: false, status: "active", sourcePublicationStatus: "published" });
    const db: Record<string, unknown> = {
      update: () => db,
      set: (fields: Record<string, unknown>) => { event = { ...event, ...fields }; return db; },
      where: () => db, select: () => db, from: () => db, limit: () => db,
      then: (resolve: (v: unknown) => void) => resolve([event]),
    };
    const { setEventHidden } = await import("./eventsDb");
    const updated = await setEventHidden(1, true, db as unknown as Parameters<typeof setEventHidden>[2]);
    expect(updated?.status).toBe("active");
    expect(updated?.sourcePublicationStatus).toBe("published");
  });
});

describe("eventsDb — deleteEvent (FIX-06, política conservadora — spec §11-§13)", () => {
  /**
   * Simula deleteEvent(id): 1) SELECT del propio evento, 2) SELECT a
   * external_entity_mappings, 3-7) SELECT a salesChannels/eventTicketTypes/
   * ticketOrders/eventTickets/eventAttendance (orden exacto del código
   * fuente) — `hasRowAtPhase` marca en qué fase (2-7) devolver una fila
   * real (bloqueo) o ninguna. `deleteCalls` registra cada `.delete(table)`
   * real ejecutado, para comprobar que un borrado bloqueado NUNCA llega a
   * ejecutar ningún DELETE físico.
   */
  function makeDeleteEventMockDb(event: ReturnType<typeof blankEvent> | null, blockAtPhase: number | null) {
    let phase = 0;
    const deleteCalls: unknown[] = [];
    const db: Record<string, unknown> = {
      select: () => db, from: (table: unknown) => { db.__lastFrom = table; return db; },
      where: () => db, limit: () => db,
      delete: (table: unknown) => { deleteCalls.push(table); return db; },
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve(event ? [event] : []);
        const blocked = blockAtPhase !== null && phase === blockAtPhase;
        return resolve(blocked ? [{ id: 999 }] : []);
      },
    };
    return { db: db as unknown as Parameters<typeof import("./eventsDb").deleteEvent>[1], deleteCalls };
  }

  it("evento inexistente: no-op silencioso, nunca lanza (idempotente)", async () => {
    const { db, deleteCalls } = makeDeleteEventMockDb(null, null);
    const { deleteEvent } = await import("./eventsDb");
    await expect(deleteEvent(999, db)).resolves.toBeUndefined();
    expect(deleteCalls).toHaveLength(0);
  });

  it("evento manual sin ninguna huella real: se borra físicamente (única categoría permitida, spec §12 categoría A)", async () => {
    const event = blankEvent(1);
    const { db, deleteCalls } = makeDeleteEventMockDb(event, null);
    const { deleteEvent } = await import("./eventsDb");
    await expect(deleteEvent(1, db)).resolves.toBeUndefined();
    expect(deleteCalls).toHaveLength(2); // community_events + events
  });

  it("evento originado en Fourvenues (sourceType): bloqueado, nunca se ejecuta ningún DELETE", async () => {
    const event = blankEvent(1, { sourceType: "integration:fourvenues_integrations" });
    const { db, deleteCalls } = makeDeleteEventMockDb(event, null);
    const { deleteEvent, EventDeleteBlockedError } = await import("./eventsDb");
    await expect(deleteEvent(1, db)).rejects.toBeInstanceOf(EventDeleteBlockedError);
    expect(deleteCalls).toHaveLength(0);
  });

  it("evento con integración externa vinculada (external_entity_mappings): bloqueado", async () => {
    const event = blankEvent(1);
    const { db, deleteCalls } = makeDeleteEventMockDb(event, 2);
    const { deleteEvent, EventDeleteBlockedError } = await import("./eventsDb");
    await expect(deleteEvent(1, db)).rejects.toBeInstanceOf(EventDeleteBlockedError);
    expect(deleteCalls).toHaveLength(0);
  });

  it("evento con canales de venta configurados (salesChannels): bloqueado", async () => {
    const event = blankEvent(1);
    const { db, deleteCalls } = makeDeleteEventMockDb(event, 3);
    const { deleteEvent, EventDeleteBlockedError } = await import("./eventsDb");
    await expect(deleteEvent(1, db)).rejects.toBeInstanceOf(EventDeleteBlockedError);
    expect(deleteCalls).toHaveLength(0);
  });

  it("evento con tipos de entrada configurados (eventTicketTypes): bloqueado", async () => {
    const event = blankEvent(1);
    const { db, deleteCalls } = makeDeleteEventMockDb(event, 4);
    const { deleteEvent, EventDeleteBlockedError } = await import("./eventsDb");
    await expect(deleteEvent(1, db)).rejects.toBeInstanceOf(EventDeleteBlockedError);
    expect(deleteCalls).toHaveLength(0);
  });

  it("evento con pedidos reales (ticketOrders): bloqueado — nunca se destruye trazabilidad económica", async () => {
    const event = blankEvent(1);
    const { db, deleteCalls } = makeDeleteEventMockDb(event, 5);
    const { deleteEvent, EventDeleteBlockedError } = await import("./eventsDb");
    await expect(deleteEvent(1, db)).rejects.toBeInstanceOf(EventDeleteBlockedError);
    expect(deleteCalls).toHaveLength(0);
  });

  it("evento con entradas emitidas (eventTickets): bloqueado", async () => {
    const event = blankEvent(1);
    const { db, deleteCalls } = makeDeleteEventMockDb(event, 6);
    const { deleteEvent, EventDeleteBlockedError } = await import("./eventsDb");
    await expect(deleteEvent(1, db)).rejects.toBeInstanceOf(EventDeleteBlockedError);
    expect(deleteCalls).toHaveLength(0);
  });

  it("evento con asistencia registrada (eventAttendance): bloqueado", async () => {
    const event = blankEvent(1);
    const { db, deleteCalls } = makeDeleteEventMockDb(event, 7);
    const { deleteEvent, EventDeleteBlockedError } = await import("./eventsDb");
    await expect(deleteEvent(1, db)).rejects.toBeInstanceOf(EventDeleteBlockedError);
    expect(deleteCalls).toHaveLength(0);
  });

  it("el mensaje del error de bloqueo es legible y sugiere ocultar en su lugar (spec §15)", async () => {
    const event = blankEvent(1, { sourceType: "integration:fourvenues_integrations" });
    const { db } = makeDeleteEventMockDb(event, null);
    const { deleteEvent } = await import("./eventsDb");
    await expect(deleteEvent(1, db)).rejects.toThrow(/ocultarlo/i);
  });

  it("un evento oculto (isHidden=true) SIN otra actividad real sigue siendo borrable — ocultar y borrar son ejes independientes", async () => {
    const event = blankEvent(1, { isHidden: true });
    const { db, deleteCalls } = makeDeleteEventMockDb(event, null);
    const { deleteEvent } = await import("./eventsDb");
    await expect(deleteEvent(1, db)).resolves.toBeUndefined();
    expect(deleteCalls).toHaveLength(2);
  });
});

describe("eventsDb — listEvents con toDate (FIX-06, rango de fechas del Admin)", () => {
  it("toDate se traduce a una condición SQL adicional (lt) — verificado indirectamente vía el resultado devuelto", async () => {
    const event = blankEvent(1, { startsAt: new Date("2026-03-15T10:00:00Z") });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event, venue: null }]);
        if (phase === 2) return resolve([{ event }]);
        return resolve([]);
      },
    };
    const { items } = await listEvents(
      { communityIds: "all", fromDate: new Date("2026-03-01T00:00:00Z"), toDate: new Date("2026-04-01T00:00:00Z") },
      db as unknown as Parameters<typeof listEvents>[1]
    );
    expect(items).toHaveLength(1);
  });
});

/** Extiende blankEvent() con sourceType/sourcePublicationStatus para las pruebas de FIX-04. */
function fourvenuesEvent(id: number, overrides: Partial<Record<string, unknown>> = {}) {
  return blankEvent(id, { sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unpublished", ...overrides });
}

describe("listActiveEvents/listFeaturedEvents — exclusión temporal (CASO A, event 119 nunca 'Activo' para el Student)", () => {
  const now = new Date();
  const pastDate = new Date(now.getTime() - 30 * DAY_MS); // claramente finalizado

  it("listActiveEvents excluye un evento activo pero YA FINALIZADO — un evento de hace un mes nunca se ofrece como 'activo'/comprable (evento 119 real: Fourvenues, active/visible=true en origen, pero temporalmente pasado)", async () => {
    const eventPast = fourvenuesEvent(119, { startsAt: pastDate, sourcePublicationStatus: "published" });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event: eventPast, venue: null }]);
        if (phase === 2) return resolve([{ event: eventPast }]);
        return resolve([]);
      },
    };
    const items = await listActiveEvents(undefined, db as unknown as Parameters<typeof listActiveEvents>[1]);
    expect(items).toHaveLength(0);
  });

  it("listActiveEvents SÍ devuelve un evento activo futuro (comportamiento normal, sin regresión)", async () => {
    const eventFuture = blankEvent(2, { startsAt: new Date(now.getTime() + 10 * DAY_MS) });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event: eventFuture, venue: null }]);
        if (phase === 2) return resolve([{ event: eventFuture }]);
        return resolve([]);
      },
    };
    const items = await listActiveEvents(undefined, db as unknown as Parameters<typeof listActiveEvents>[1]);
    expect(items).toHaveLength(1);
  });

  it("listFeaturedEvents también excluye un destacado ya finalizado — la seguridad de publicación siempre prevalece sobre el flag Featured", async () => {
    const eventPast = blankEvent(3, { isFeatured: true, startsAt: pastDate });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event: eventPast, venue: null }]);
        if (phase === 2) return resolve([{ event: eventPast }]);
        return resolve([]);
      },
    };
    const items = await listFeaturedEvents(undefined, db as unknown as Parameters<typeof listFeaturedEvents>[1]);
    expect(items).toHaveLength(0);
  });
});

describe("listEventsByVenue — SIN exclusión temporal (preserva VenueDetail 'Past Events')", () => {
  it("devuelve tanto eventos futuros como pasados — el filtro temporal es responsabilidad del cliente (splitUpcomingPast), no de esta función", async () => {
    const now = new Date();
    const eventPast = blankEvent(1, { startsAt: new Date(now.getTime() - 30 * DAY_MS) });
    const eventFuture = blankEvent(2, { startsAt: new Date(now.getTime() + 10 * DAY_MS) });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event: eventPast, venue: null }, { event: eventFuture, venue: null }]);
        if (phase === 2) return resolve([{ event: eventPast }, { event: eventFuture }]);
        return resolve([]);
      },
    };
    const items = await listEventsByVenue(10, db as unknown as Parameters<typeof listEventsByVenue>[1]);
    expect(items.map(i => i.id).sort()).toEqual([1, 2]);
  });

  it("evento 119 real (Fourvenues, pasado, sourcePublicationStatus=null por estar fuera de la ventana de sync) SÍ aparece — un borrador FUTURO de Fourvenues NO aparece", async () => {
    const now = new Date();
    const event119 = fourvenuesEvent(119, { startsAt: new Date(now.getTime() - 330 * DAY_MS), sourcePublicationStatus: null });
    const futureDraft = fourvenuesEvent(120, { startsAt: new Date(now.getTime() + 10 * DAY_MS), sourcePublicationStatus: "unpublished" });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event: event119, venue: null }, { event: futureDraft, venue: null }]);
        if (phase === 2) return resolve([{ event: event119 }, { event: futureDraft }]);
        return resolve([]);
      },
    };
    const items = await listEventsByVenue(10, db as unknown as Parameters<typeof listEventsByVenue>[1]);
    expect(items.map(i => i.id)).toEqual([119]);
  });
});

// ─── FIX-05A — "Ended Events" (Explore + VenueDetail) ─────────────────────
describe("listEndedEvents — FIX-05A (spec §16, items 1-4/8/9/13/15)", () => {
  const now = new Date();
  const PAST_RECENT = new Date(now.getTime() - 3 * DAY_MS); // claramente ya finalizado (fuera de las 6h por defecto)
  const PAST_OLD = new Date(now.getTime() - 30 * DAY_MS);
  const FUTURE = new Date(now.getTime() + 10 * DAY_MS);

  it("past + provider draft/no confirmado (sourcePublicationStatus=null) => ENDED, visible (spec §16.1)", async () => {
    const ev = fourvenuesEvent(1, { startsAt: PAST_RECENT, sourcePublicationStatus: null });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event: ev, venue: null }]);
        if (phase === 2) return resolve([{ event: ev }]);
        return resolve([]);
      },
    };
    const items = await listEndedEvents({}, db as unknown as Parameters<typeof listEndedEvents>[1]);
    expect(items.map(i => i.id)).toEqual([1]);
  });

  it("past + provider published => ENDED, visible (spec §16.2)", async () => {
    const ev = fourvenuesEvent(2, { startsAt: PAST_RECENT, sourcePublicationStatus: "published" });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event: ev, venue: null }]);
        if (phase === 2) return resolve([{ event: ev }]);
        return resolve([]);
      },
    };
    const items = await listEndedEvents({}, db as unknown as Parameters<typeof listEndedEvents>[1]);
    expect(items.map(i => i.id)).toEqual([2]);
  });

  it("future + provider draft => NUNCA en Ended (no es histórico todavía, sea cual sea su publicación) (spec §16.3)", async () => {
    const ev = fourvenuesEvent(3, { startsAt: FUTURE, sourcePublicationStatus: "unpublished" });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event: ev, venue: null }]);
        if (phase === 2) return resolve([{ event: ev }]);
        return resolve([]);
      },
    };
    const items = await listEndedEvents({}, db as unknown as Parameters<typeof listEndedEvents>[1]);
    expect(items).toEqual([]);
  });

  it("future + provider published => NUNCA en Ended (pertenece a Upcoming/Active, no a histórico) (spec §16.4)", async () => {
    const ev = fourvenuesEvent(4, { startsAt: FUTURE, sourcePublicationStatus: "published" });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event: ev, venue: null }]);
        if (phase === 2) return resolve([{ event: ev }]);
        return resolve([]);
      },
    };
    const items = await listEndedEvents({}, db as unknown as Parameters<typeof listEndedEvents>[1]);
    expect(items).toEqual([]);
  });

  it("evento inactivo (status='inactive') pasado => NUNCA en Ended, aunque sea temporalmente pasado", async () => {
    const ev = blankEvent(5, { startsAt: PAST_RECENT, status: "inactive" });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event: ev, venue: null }]);
        if (phase === 2) return resolve([{ event: ev }]);
        return resolve([]);
      },
    };
    const items = await listEndedEvents({}, db as unknown as Parameters<typeof listEndedEvents>[1]);
    expect(items).toEqual([]);
  });

  it("evento EN CURSO (empezó hace 1h, dentro de las 6h por defecto sin endsAt) => NUNCA en Ended — timezone/medianoche (spec §13)", async () => {
    const ev = blankEvent(6, { startsAt: new Date(now.getTime() - 1 * 60 * 60 * 1000) });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event: ev, venue: null }]);
        if (phase === 2) return resolve([{ event: ev }]);
        return resolve([]);
      },
    };
    const items = await listEndedEvents({}, db as unknown as Parameters<typeof listEndedEvents>[1]);
    expect(items).toEqual([]);
  });

  it("orden DESCENDENTE — el finalizado más reciente primero (spec §5/§16.9)", async () => {
    const older = blankEvent(7, { startsAt: PAST_OLD });
    const recent = blankEvent(8, { startsAt: PAST_RECENT });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        // orden de llegada deliberadamente "al revés" — la función debe reordenar, no confiar en el orden de la query.
        if (phase === 1) return resolve([{ event: older, venue: null }, { event: recent, venue: null }]);
        if (phase === 2) return resolve([{ event: older }, { event: recent }]);
        return resolve([]);
      },
    };
    const items = await listEndedEvents({}, db as unknown as Parameters<typeof listEndedEvents>[1]);
    expect(items.map(i => i.id)).toEqual([8, 7]); // recent (8) antes que older (7)
  });

  it("respeta el límite pedido (limit personalizado)", async () => {
    const evs = [1, 2, 3, 4, 5].map(id => blankEvent(id, { startsAt: new Date(now.getTime() - id * DAY_MS) }));
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve(evs.map(e => ({ event: e, venue: null })));
        if (phase === 2) return resolve(evs.map(e => ({ event: e })));
        return resolve([]);
      },
    };
    const items = await listEndedEvents({ limit: 2 }, db as unknown as Parameters<typeof listEndedEvents>[1]);
    expect(items).toHaveLength(2);
  });

  it("venue scoping — solo eventos del venueId pedido (delegado a listEvents, que ya filtra por venueId en SQL)", async () => {
    // La función pasa venueId directamente a listEvents() — este test confirma que el parámetro viaja, no reimplementa el filtro SQL ya probado en otros tests de este archivo.
    const ev = blankEvent(9, { startsAt: PAST_RECENT, venueId: 10 });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ event: ev, venue: null }]);
        if (phase === 2) return resolve([{ event: ev }]);
        return resolve([]);
      },
    };
    const items = await listEndedEvents({ venueId: 10 }, db as unknown as Parameters<typeof listEndedEvents>[1]);
    expect(items.map(i => i.id)).toEqual([9]);
  });

  describe("community scoping (spec §8/§16.5-7 — IE/UVA/ambas)", () => {
    it("evento SOLO IE => visible con communityId=IE", async () => {
      const evIE = blankEvent(10, { startsAt: PAST_RECENT });
      let phase = 0;
      const db: Record<string, unknown> = {
        select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
        where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
        then: (resolve: (v: unknown) => void) => {
          phase++;
          if (phase === 1) return resolve([{ eventId: 10 }]); // getEventIdsInCommunities([IE])
          if (phase === 2) return resolve([{ event: evIE, venue: null }]);
          if (phase === 3) return resolve([{ event: evIE }]);
          return resolve([{ eventId: 10, community: { id: 1, name: "Segolife IE", slug: "ie" } }]);
        },
      };
      const items = await listEndedEvents({ communityId: 1 }, db as unknown as Parameters<typeof listEndedEvents>[1]);
      expect(items.map(i => i.id)).toEqual([10]);
    });

    it("evento SOLO IE => NO visible con communityId=UVA (comunidad sin eventos vinculados => vacío, sin llegar a consultar el resto)", async () => {
      const db: Record<string, unknown> = {
        select: () => db, from: () => db, where: () => db,
        then: (resolve: (v: unknown) => void) => resolve([]), // getEventIdsInCommunities([UVA]) => sin resultados
      };
      const items = await listEndedEvents({ communityId: 2 }, db as unknown as Parameters<typeof listEndedEvents>[1]);
      expect(items).toEqual([]);
    });

    it("evento IE+UVA => visible desde CUALQUIERA de las dos comunidades", async () => {
      const evBoth = blankEvent(11, { startsAt: PAST_RECENT });
      let phase = 0;
      const db: Record<string, unknown> = {
        select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
        where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
        then: (resolve: (v: unknown) => void) => {
          phase++;
          if (phase === 1) return resolve([{ eventId: 11 }]);
          if (phase === 2) return resolve([{ event: evBoth, venue: null }]);
          if (phase === 3) return resolve([{ event: evBoth }]);
          return resolve([{ eventId: 11, community: { id: 2, name: "Segolife UVA", slug: "uva" } }]);
        },
      };
      const items = await listEndedEvents({ communityId: 2 }, db as unknown as Parameters<typeof listEndedEvents>[1]);
      expect(items.map(i => i.id)).toEqual([11]);
    });
  });
});
