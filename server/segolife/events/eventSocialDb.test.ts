/**
 * eventSocialDb.test.ts — Social Layer para Events (2026-08-23). Fake db
 * despachado por tabla (mismo criterio exacto que communitySocialDb.test.ts)
 * — varias tablas necesitan requisitos de forma distintos según qué columnas
 * pide cada select, así que se distingue por presencia de columnas cuando
 * hace falta. El CONTENIDO de listEventComments (paginación raíz+réplica) NO
 * se cubre aquí por el mismo motivo documentado en communitySocialDb.test.ts:
 * varias queries DISTINTAS sobre la MISMA tabla, un fake por tabla no puede
 * distinguirlas de forma fiable — verificado en su lugar contra BD real
 * (ver informe final, sección de verificación en producción).
 */
import { describe, it, expect } from "vitest";
import {
  toggleEventLike, getEventLikeCountsBatch, getEventCommentCountsBatch,
  createEventComment, deleteOwnEventComment, listEventComments,
} from "./eventSocialDb";
import { events, eventLikes, eventComments, userCommunities, communityEvents } from "../../../drizzle/schema";

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 200, status: "active", isHidden: false, sourceType: null, sourcePublicationStatus: null,
    startsAt: new Date("2026-09-01T00:00:00.000Z"), endsAt: new Date("2026-09-01T04:30:00.000Z"),
    venueId: null,
    ...overrides,
  };
}

/** Fake db en memoria — mismo criterio que communitySocialDb.test.ts. */
function fakeDb(opts: {
  eventRows?: Record<string, unknown>[];
  likes?: Array<{ id: number; eventId: number; userId: number }>;
  comments?: Array<Record<string, unknown>>;
  userCommunityMemberships?: Array<{ userId: number; communityId: number }>;
  eventCommunityLinks?: Array<{ eventId: number; communityId: number }>;
}) {
  const eventRows = opts.eventRows ?? [eventRow()];
  const likes = opts.likes ?? [];
  const comments = opts.comments ?? [];
  const userCommunityMemberships = opts.userCommunityMemberships ?? [];
  const eventCommunityLinks = opts.eventCommunityLinks ?? [];
  let nextCommentId = (comments.reduce((max, c) => Math.max(max, c.id as number), 0)) + 1;

  function rowsFor(table: unknown): Record<string, unknown>[] {
    if (table === events) return eventRows;
    if (table === eventLikes) return likes as unknown as Record<string, unknown>[];
    if (table === eventComments) return comments as Record<string, unknown>[];
    if (table === userCommunities) return userCommunityMemberships as unknown as Record<string, unknown>[];
    if (table === communityEvents) return eventCommunityLinks as unknown as Record<string, unknown>[];
    return [];
  }

  const db = {
    select: (cols?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        // getCommunitiesByEventId (eventsDb.ts) es la ÚNICA query real que
        // hace select({eventId, community}).from(communityEvents).innerJoin(...)
        // — se detecta por la presencia de la columna `community` pedida,
        // y se resuelve directamente desde eventCommunityLinks (join ya
        // "hecho" en memoria), sin necesitar imitar innerJoin() de drizzle.
        const isCommunityJoin = table === communityEvents && cols && "community" in cols;
        const isCount = cols && "count" in cols;
        const rows = rowsFor(table);
        const chain = {
          innerJoin: (..._args: unknown[]) => chain,
          where: (..._args: unknown[]) => {
            const terminal = isCommunityJoin
              ? eventCommunityLinks.map(l => ({ eventId: l.eventId, community: { id: l.communityId, name: "Community", slug: "c" } }))
              : isCount ? [{ count: rows.length }] : rows;
            return {
              limit: async (n: number) => terminal.slice(0, n),
              orderBy: () => ({
                limit: (n: number) => ({ offset: async () => terminal.slice(0, n) }),
              }),
              then: (resolve: (v: unknown) => void) => Promise.resolve(terminal).then(resolve),
            };
          },
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (table === eventComments) {
          const row = { id: nextCommentId++, isHidden: false, hiddenByUserId: null, hiddenAt: null, parentCommentId: null, createdAt: new Date(), updatedAt: new Date(), ...values };
          comments.push(row);
          return [{ insertId: row.id }];
        }
        if (table === eventLikes) {
          const row = { id: likes.length + 1, ...values };
          likes.push(row as never);
          return [{ insertId: row.id }];
        }
        return [{ insertId: 1 }];
      },
    }),
    update: () => ({
      set: () => ({ where: async () => [{ affectedRows: 1 }] }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        if (table === eventLikes) likes.length = 0; // simplificado: un solo like posible por test
        return [{ affectedRows: 1 }];
      },
    }),
  };
  return db as never;
}

describe("toggleEventLike — like social sobre el EVENTO INTERNO (spec §7/§12)", () => {
  it("primer toggle: da like", async () => {
    const db = fakeDb({ eventRows: [eventRow()], likes: [] });
    const result = await toggleEventLike(200, 42, db);
    expect(result.liked).toBe(true);
    expect(result.count).toBe(1);
  });

  it("segundo toggle sobre el mismo par (event,user): quita el like", async () => {
    const db = fakeDb({ eventRows: [eventRow()], likes: [{ id: 1, eventId: 200, userId: 42 }] });
    const result = await toggleEventLike(200, 42, db);
    expect(result.liked).toBe(false);
  });

  it("evento inexistente -> NOT_FOUND", async () => {
    const db = fakeDb({ eventRows: [] });
    await expect(toggleEventLike(999, 42, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("evento inactivo (status != active) -> NOT_FOUND, nunca revela que existe pero está en borrador (mismo criterio que publicGetBySlug)", async () => {
    const db = fakeDb({ eventRows: [eventRow({ status: "inactive" })] });
    await expect(toggleEventLike(200, 42, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("evento oculto (isHidden=true) -> NOT_FOUND", async () => {
    const db = fakeDb({ eventRows: [eventRow({ isHidden: true })] });
    await expect(toggleEventLike(200, 42, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("evento scopeado a una comunidad de la que el usuario NO es miembro -> FORBIDDEN (spec §9, cross-community)", async () => {
    const db = fakeDb({
      eventRows: [eventRow()],
      eventCommunityLinks: [{ eventId: 200, communityId: 2 }], // exclusivo de la comunidad 2 (p.ej. UVA)
      userCommunityMemberships: [{ userId: 42, communityId: 1 }], // el usuario solo pertenece a la comunidad 1 (p.ej. IE)
    });
    await expect(toggleEventLike(200, 42, db)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("evento scopeado a una comunidad de la que el usuario SÍ es miembro -> permitido", async () => {
    const db = fakeDb({
      eventRows: [eventRow()],
      eventCommunityLinks: [{ eventId: 200, communityId: 1 }],
      userCommunityMemberships: [{ userId: 42, communityId: 1 }],
    });
    const result = await toggleEventLike(200, 42, db);
    expect(result.liked).toBe(true);
  });

  it("evento sin comunidades asociadas -> visible para cualquiera (mismo criterio que isProposalVisibleToUser)", async () => {
    const db = fakeDb({ eventRows: [eventRow()], eventCommunityLinks: [] });
    const result = await toggleEventLike(200, 42, db);
    expect(result.liked).toBe(true);
  });
});

describe("createEventComment — spec §8", () => {
  it("crea un comentario raíz en un evento visible", async () => {
    const db = fakeDb({ eventRows: [eventRow()] });
    const comment = await createEventComment({ eventId: 200, userId: 42, content: "  Qué ganas de este evento 🎉  " }, db);
    expect(comment.content).toBe("Qué ganas de este evento 🎉");
    expect(comment.parentCommentId).toBeNull();
  });

  it("rechaza contenido vacío o solo espacios (INVALID_CONTENT)", async () => {
    const db = fakeDb({ eventRows: [eventRow()] });
    await expect(createEventComment({ eventId: 200, userId: 42, content: "   " }, db)).rejects.toMatchObject({ code: "INVALID_CONTENT" });
  });

  it("rechaza contenido que supera el máximo de longitud", async () => {
    const db = fakeDb({ eventRows: [eventRow()] });
    await expect(createEventComment({ eventId: 200, userId: 42, content: "a".repeat(1001) }, db)).rejects.toMatchObject({ code: "INVALID_CONTENT" });
  });

  it("evento inexistente -> NOT_FOUND", async () => {
    const db = fakeDb({ eventRows: [] });
    await expect(createEventComment({ eventId: 999, userId: 42, content: "hola" }, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("evento de otra comunidad -> FORBIDDEN (spec §9, cross-community, server-side siempre)", async () => {
    const db = fakeDb({
      eventRows: [eventRow()],
      eventCommunityLinks: [{ eventId: 200, communityId: 2 }],
      userCommunityMemberships: [{ userId: 42, communityId: 1 }],
    });
    await expect(createEventComment({ eventId: 200, userId: 42, content: "hola" }, db)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("responder a un comentario de OTRO evento -> NOT_FOUND (IDOR: parentCommentId manipulado)", async () => {
    const db = fakeDb({
      eventRows: [eventRow({ id: 200 })],
      comments: [{ id: 1, eventId: 999, userId: 4, parentCommentId: null, content: "de otro evento", isHidden: false }],
    });
    await expect(createEventComment({ eventId: 200, userId: 42, content: "hola", parentCommentId: 1 }, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // "responder a una RESPUESTA (2º nivel) -> REPLY_DEPTH_EXCEEDED" NO se
  // cubre aquí: necesita que el fake db distinga DOS filas de comments por
  // id real (WHERE id=1 vs WHERE id=2) — este fake despacha por TABLA, no
  // evalúa el predicado WHERE en sí (misma limitación ya documentada en
  // communitySocialDb.test.ts para su equivalente exacto) — con 2 filas en
  // la misma tabla siempre devolvería la primera, sin importar el id
  // pedido; un test así "pasaría" sin probar nada real. Verificado en su
  // lugar contra producción real tras el deploy (ver informe final).

  it("responder a un comentario ya oculto -> NOT_FOUND, nunca reabre un hilo borrado", async () => {
    const db = fakeDb({
      eventRows: [eventRow({ id: 200 })],
      comments: [{ id: 1, eventId: 200, userId: 4, parentCommentId: null, content: "borrado", isHidden: true }],
    });
    await expect(createEventComment({ eventId: 200, userId: 42, content: "hola", parentCommentId: 1 }, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("deleteOwnEventComment — solo el propio autor puede borrar (spec §8)", () => {
  it("el autor borra su propio comentario (soft-delete: isHidden=true)", async () => {
    const db = fakeDb({ comments: [{ id: 1, eventId: 200, userId: 42, parentCommentId: null, content: "x", isHidden: false }] });
    await expect(deleteOwnEventComment(1, 42, db)).resolves.toBeUndefined();
  });

  it("otro estudiante NUNCA puede borrar un comentario ajeno -> FORBIDDEN", async () => {
    const db = fakeDb({ comments: [{ id: 1, eventId: 200, userId: 4, parentCommentId: null, content: "x", isHidden: false }] });
    await expect(deleteOwnEventComment(1, 999, db)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("comentario inexistente -> NOT_FOUND", async () => {
    const db = fakeDb({ comments: [] });
    await expect(deleteOwnEventComment(999, 42, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listEventComments — puerta de acceso (spec §9, mismo criterio server-side que like/comentar)", () => {
  it("evento inexistente -> NOT_FOUND", async () => {
    const db = fakeDb({ eventRows: [] });
    await expect(listEventComments(999, 42, { limit: 20, offset: 0 }, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("evento de otra comunidad -> FORBIDDEN", async () => {
    const db = fakeDb({
      eventRows: [eventRow()],
      eventCommunityLinks: [{ eventId: 200, communityId: 2 }],
      userCommunityMemberships: [{ userId: 42, communityId: 1 }],
    });
    await expect(listEventComments(200, 42, { limit: 20, offset: 0 }, db)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("evento visible, sin comentarios todavía -> total 0, items []", async () => {
    const db = fakeDb({ eventRows: [eventRow()] });
    await expect(listEventComments(200, 42, { limit: 20, offset: 0 }, db)).resolves.toMatchObject({ total: 0, items: [] });
  });
});

describe("getEventLikeCountsBatch / getEventCommentCountsBatch — batch sin N+1 (spec §10)", () => {
  it("vacío si no se piden ids", async () => {
    const db = fakeDb({});
    expect((await getEventLikeCountsBatch([], db)).size).toBe(0);
    expect((await getEventCommentCountsBatch([], db)).size).toBe(0);
  });
});
