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
  setEventCommunities,
  setEventActive,
  setEventFeatured,
  listActiveEvents,
  listFeaturedEvents,
  listEventsByVenue,
  selectUpcomingWindow,
  isEventStudentVisible,
  UPCOMING_WINDOW_DAYS,
  UPCOMING_EVENTS_LIMIT,
} from "./eventsDb";
import { events, venues, communityEvents } from "../../drizzle/schema";

function blankEvent(id: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id, name: "Fiesta de bienvenida", slug: "fiesta-de-bienvenida", description: null, venueId: null,
    startsAt: new Date("2026-09-15T20:00:00Z"), endsAt: null, capacity: null, imageUrl: null,
    status: "active" as const, isFeatured: false,
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
// la tercera, sin componente temporal (eso lo decide cada llamador).

describe("isEventStudentVisible — mapper/transición (spec FIX-04, nunca inventar 'published')", () => {
  it("evento nativo (sin sourceType) activo → visible, aunque sourcePublicationStatus sea null", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: null, sourcePublicationStatus: null })).toBe(true);
  });

  it("evento nativo inactivo (status='inactive') → NUNCA visible, sea cual sea el origen", () => {
    expect(isEventStudentVisible({ status: "inactive", sourceType: null, sourcePublicationStatus: null })).toBe(false);
  });

  it("evento Weezevent (event_integration, sourceType ajeno a Fourvenues) activo → visible — nunca sujeto al gate de publicación de Fourvenues", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "weezevent", sourcePublicationStatus: null })).toBe(true);
  });

  it("evento Fourvenues activo + sourcePublicationStatus='published' → visible", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "published" })).toBe(true);
  });

  it("evento Fourvenues activo + sourcePublicationStatus='unpublished' (borrador real, caso pre-opening-x-fcking-wednesdays) → NUNCA visible", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unpublished" })).toBe(false);
  });

  it("evento Fourvenues activo + sourcePublicationStatus='unknown' → NUNCA visible (fail-closed, nunca se asume publicado)", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unknown" })).toBe(false);
  });

  it("evento Fourvenues activo + sourcePublicationStatus=null (nunca sincronizado tras la migración) → NUNCA visible — mismo criterio que 'unknown'", () => {
    expect(isEventStudentVisible({ status: "active", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: null })).toBe(false);
  });

  it("evento Fourvenues inactivo (status='inactive') + sourcePublicationStatus='published' → NUNCA visible (status manda primero)", () => {
    expect(isEventStudentVisible({ status: "inactive", sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "published" })).toBe(false);
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
});
