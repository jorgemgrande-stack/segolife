/**
 * venuesDb.test.ts — modelo de venues y su relación M2M con comunidades
 * (Fase 1D). Mismo patrón de inyección de dependencia que
 * server/db/studentsDb.test.ts / communitiesDb.test.ts: cada función acepta
 * un `db` opcional mockeable, sin necesidad de mockear mysql2/drizzle-orm a
 * nivel de módulo.
 */
import { describe, it, expect } from "vitest";
import {
  listVenues,
  getVenueById,
  createVenue,
  setVenueCommunities,
  setVenueActive,
  listActiveVenues,
} from "./venuesDb";
import { venues, venueCategories, communityVenues } from "../../drizzle/schema";

function blankVenue(id: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id, name: "Café Central", slug: "cafe-central", description: null, categoryId: null,
    address: null, city: "Segovia", phone: null, email: null, website: null, imageUrl: null,
    status: "active" as const, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("venuesDb — filtro por comunidad (listVenues)", () => {
  it("filtro IE devuelve solo venues vinculados a la comunidad IE", async () => {
    const venueIE = blankVenue(1);
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ venueId: 1 }]); // getVenueIdsInCommunities([IE]) → solo venue 1
        if (phase === 2) return resolve([{ venue: venueIE, category: null }]);
        if (phase === 3) return resolve([{ venue: venueIE }]); // count
        return resolve([{ venueId: 1, community: { id: 1, name: "Segolife IE", slug: "ie" } }]);
      },
    };
    const { items, total } = await listVenues({ communityIds: [1] }, db as unknown as Parameters<typeof listVenues>[1]);
    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(1);
    expect(items[0].communities).toEqual([{ id: 1, name: "Segolife IE", slug: "ie" }]);
  });

  it("filtro UVA devuelve solo venues vinculados a la comunidad UVA", async () => {
    const venueUVA = blankVenue(2, { name: "Librería del Río", slug: "libreria-del-rio" });
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ venueId: 2 }]);
        if (phase === 2) return resolve([{ venue: venueUVA, category: null }]);
        if (phase === 3) return resolve([{ venue: venueUVA }]);
        return resolve([{ venueId: 2, community: { id: 2, name: "Segolife UVA", slug: "uva" } }]);
      },
    };
    const { items, total } = await listVenues({ communityIds: [2] }, db as unknown as Parameters<typeof listVenues>[1]);
    expect(total).toBe(1);
    expect(items[0].id).toBe(2);
    expect(items[0].communities[0].slug).toBe("uva");
  });

  it("comunidad sin ningún venue devuelve lista vacía sin consultar el resto", async () => {
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, where: () => db,
      then: (resolve: (v: unknown) => void) => resolve([]), // getVenueIdsInCommunities → []
    };
    const { items, total } = await listVenues({ communityIds: [999] }, db as unknown as Parameters<typeof listVenues>[1]);
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });

  it("communityIds='all' (global admin) no restringe por comunidad", async () => {
    const venueIE = blankVenue(1);
    const venueUVA = blankVenue(2);
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ venue: venueIE, category: null }, { venue: venueUVA, category: null }]);
        if (phase === 2) return resolve([{ venue: venueIE }, { venue: venueUVA }]); // count
        return resolve([]);
      },
    };
    const { items, total } = await listVenues({ communityIds: "all" }, db as unknown as Parameters<typeof listVenues>[1]);
    expect(total).toBe(2);
    expect(items).toHaveLength(2);
  });
});

describe("venuesDb — leer ficha (getVenueById) con categoría y comunidades", () => {
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

  it("devuelve el venue con su categoría y comunidades", async () => {
    const venue = blankVenue(3, { categoryId: 9 });
    const byTable = new Map<unknown, unknown[]>([
      [venues, [venue]],
      [venueCategories, [{ id: 9, name: "Cafetería", slug: "cafeteria", createdAt: new Date() }]],
      [communityVenues, [{ venueId: 3, community: { id: 1, name: "Segolife IE", slug: "ie" } }]],
    ]);
    const db = makeDetailMockDb(byTable);
    const detail = await getVenueById(3, db as unknown as Parameters<typeof getVenueById>[1]);
    expect(detail).not.toBeNull();
    expect(detail?.category?.name).toBe("Cafetería");
    expect(detail?.communities).toEqual([{ id: 1, name: "Segolife IE", slug: "ie" }]);
  });

  it("devuelve null si el venueId no existe", async () => {
    const db = makeDetailMockDb(new Map([[venues, []]]));
    const detail = await getVenueById(999, db as unknown as Parameters<typeof getVenueById>[1]);
    expect(detail).toBeNull();
  });
});

/** Mock con estado real de venues + community_venues — simula la constraint UNIQUE(community_id, venue_id). */
function makeCreateVenueMockDb() {
  const linkRows: Array<{ id: number; communityId: number; venueId: number }> = [];
  let nextLinkId = 1;
  let createdVenue: Record<string, unknown> | null = null;
  let mode: unknown = null;

  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.from = (table: unknown) => { mode = table; return builder; };
  builder.where = () => builder;
  builder.limit = () => builder;
  builder.leftJoin = () => builder;
  builder.insert = (table: unknown) => { mode = table; return builder; };
  builder.delete = (table: unknown) => {
    if (table === communityVenues) linkRows.length = 0;
    return builder;
  };
  builder.values = (v: Record<string, unknown>) => {
    if (mode === venues) {
      createdVenue = { id: 1, status: "active", city: "Segovia", createdAt: new Date(), updatedAt: new Date(), ...v };
      return Promise.resolve([{ insertId: 1 }]);
    }
    const dup = linkRows.some(r => r.communityId === v.communityId && r.venueId === v.venueId);
    if (dup) {
      const err = new Error("Duplicate entry") as Error & { errno: number };
      err.errno = 1062; // ER_DUP_ENTRY real de MySQL — mismo patrón que communitiesDb.test.ts
      throw err;
    }
    const row = { id: nextLinkId++, communityId: v.communityId as number, venueId: v.venueId as number };
    linkRows.push(row);
    return Promise.resolve([{ insertId: row.id }]);
  };
  builder.then = (resolve: (v: unknown) => void) => resolve(createdVenue ? [createdVenue] : []);
  return { db: builder, linkRows, getCreatedVenue: () => createdVenue };
}

describe("venuesDb — crear venue vinculado a comunidades (createVenue)", () => {
  it("crea el venue vinculado a IE + UVA simultáneamente (venue↔múltiples comunidades)", async () => {
    const { db, linkRows } = makeCreateVenueMockDb();
    const venue = await createVenue(
      { name: "Café Central", slug: "cafe-central" },
      [1, 2],
      db as unknown as Parameters<typeof createVenue>[2]
    );
    expect(venue.name).toBe("Café Central");
    expect(linkRows).toHaveLength(2);
    expect(linkRows.map(r => r.communityId).sort()).toEqual([1, 2]);
  });

  it("crea el venue vinculado solo a IE", async () => {
    const { db, linkRows } = makeCreateVenueMockDb();
    await createVenue({ name: "Café Central", slug: "cafe-central" }, [1], db as unknown as Parameters<typeof createVenue>[2]);
    expect(linkRows).toHaveLength(1);
    expect(linkRows[0].communityId).toBe(1);
  });

  it("crea el venue sin comunidades (communityIds=[]) sin lanzar", async () => {
    const { db, linkRows } = makeCreateVenueMockDb();
    const venue = await createVenue({ name: "Café Central", slug: "cafe-central" }, [], db as unknown as Parameters<typeof createVenue>[2]);
    expect(venue.id).toBe(1);
    expect(linkRows).toHaveLength(0);
  });
});

describe("venuesDb — UNIQUE(community_id, venue_id): prevenir duplicados (setVenueCommunities)", () => {
  it("un communityId repetido en el mismo array no duplica la fila community_venues", async () => {
    const { db, linkRows } = makeCreateVenueMockDb();
    await setVenueCommunities(1, [1, 1], db as unknown as Parameters<typeof setVenueCommunities>[2]);
    expect(linkRows).toHaveLength(1);
  });

  it("reemplaza el conjunto completo (no acumula) — de [IE, UVA] a solo [UVA]", async () => {
    const { db, linkRows } = makeCreateVenueMockDb();
    await setVenueCommunities(1, [1, 2], db as unknown as Parameters<typeof setVenueCommunities>[2]);
    expect(linkRows).toHaveLength(2);
    await setVenueCommunities(1, [2], db as unknown as Parameters<typeof setVenueCommunities>[2]);
    expect(linkRows).toHaveLength(1);
    expect(linkRows[0].communityId).toBe(2);
  });
});

describe("venuesDb — activar/desactivar (setVenueActive)", () => {
  it("desactiva un venue activo", async () => {
    let venue = blankVenue(1, { status: "active" });
    const db: Record<string, unknown> = {
      update: () => db,
      set: (fields: Record<string, unknown>) => { venue = { ...venue, ...fields }; return db; },
      where: () => db,
      select: () => db, from: () => db, limit: () => db,
      then: (resolve: (v: unknown) => void) => resolve([venue]),
    };
    const updated = await setVenueActive(1, false, db as unknown as Parameters<typeof setVenueActive>[2]);
    expect(updated?.status).toBe("inactive");
  });
});

describe("venuesDb — público (listActiveVenues)", () => {
  it("sin communityId devuelve venues activos de todas las comunidades", async () => {
    const venue = blankVenue(1);
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ venue, category: null }]);
        if (phase === 2) return resolve([{ venue }]);
        return resolve([]);
      },
    };
    const items = await listActiveVenues(undefined, db as unknown as Parameters<typeof listActiveVenues>[1]);
    expect(items).toHaveLength(1);
  });

  it("con communityId restringe a esa comunidad (sin necesitar sesión — endpoint público)", async () => {
    const venue = blankVenue(2);
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ venueId: 2 }]);
        if (phase === 2) return resolve([{ venue, category: null }]);
        if (phase === 3) return resolve([{ venue }]);
        return resolve([{ venueId: 2, community: { id: 2, name: "Segolife UVA", slug: "uva" } }]);
      },
    };
    const items = await listActiveVenues(2, db as unknown as Parameters<typeof listActiveVenues>[1]);
    expect(items).toHaveLength(1);
    expect(items[0].communities[0].slug).toBe("uva");
  });
});
