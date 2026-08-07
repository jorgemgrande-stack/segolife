/**
 * communitiesDb.test.ts — helpers de BD del núcleo multicomunidad (Fase 1B).
 * Sin conexión real a BD: cada función acepta un `db` opcional inyectable
 * (ver server/db/communitiesDb.ts), así que los tests pasan un mock ligero
 * en vez de depender de una conexión real o de mockear mysql2/drizzle-orm.
 *
 * La constraint UNIQUE(user_id, community_id) real en MySQL se verificó
 * empíricamente contra la BD local durante la revisión de Fase 1B (INSERT
 * duplicado → ER_DUP_ENTRY 1062). Este fichero prueba que el CÓDIGO de
 * communitiesDb.ts se comporta correctamente frente a esa constraint: no
 * duplica en el caso normal (chequeo previo) y no revienta si el motor la
 * rechaza igualmente (condición de carrera).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  listCommunities,
  getCommunityBySlug,
  getUserCommunities,
  addUserToCommunity,
  getCommunityUniversities,
  linkCommunityToUniversity,
} from "./communitiesDb";

let mockResult: unknown = [];

function makeMockDb() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = () => chain();
  builder.from = () => chain();
  builder.where = () => chain();
  builder.limit = () => chain();
  builder.innerJoin = () => chain();
  builder.then = (resolve: (v: unknown) => void) => resolve(mockResult);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return builder as any;
}

describe("communitiesDb — API list/getBySlug", () => {
  beforeEach(() => {
    mockResult = [];
  });

  it("listCommunities devuelve las comunidades tal como las da la BD", async () => {
    const fake = [
      { id: 1, slug: "ie", name: "Segolife IE", defaultLocale: "en", availableLocales: ["en", "es"] },
      { id: 2, slug: "uva", name: "Segolife UVA", defaultLocale: "es", availableLocales: ["es"] },
    ];
    mockResult = fake;
    const result = await listCommunities(makeMockDb());
    expect(result).toEqual(fake);
    expect(result).toHaveLength(2);
  });

  it("getCommunityBySlug('ie') resuelve la comunidad con idioma por defecto 'en'", async () => {
    mockResult = [
      { id: 1, slug: "ie", name: "Segolife IE", defaultLocale: "en", availableLocales: ["en", "es"] },
    ];
    const result = await getCommunityBySlug("ie", makeMockDb());
    expect(result).not.toBeNull();
    expect(result?.slug).toBe("ie");
    expect(result?.defaultLocale).toBe("en");
    expect(result?.availableLocales).toEqual(["en", "es"]);
    // Ya no hay university_id directo en Community (ver drizzle/schema.ts) —
    // la relación con universidad vive en community_universities (M2M).
    expect(result).not.toHaveProperty("universityId");
  });

  it("getCommunityBySlug('uva') resuelve la comunidad con idioma por defecto 'es'", async () => {
    mockResult = [
      { id: 2, slug: "uva", name: "Segolife UVA", defaultLocale: "es", availableLocales: ["es"] },
    ];
    const result = await getCommunityBySlug("uva", makeMockDb());
    expect(result).not.toBeNull();
    expect(result?.slug).toBe("uva");
    expect(result?.defaultLocale).toBe("es");
    expect(result?.availableLocales).toEqual(["es"]);
  });

  it("getCommunityBySlug devuelve null (no lanza) para un slug sin comunidad", async () => {
    mockResult = [];
    const result = await getCommunityBySlug("campus-inexistente", makeMockDb());
    expect(result).toBeNull();
  });
});

describe("communitiesDb — relación M2M comunidad↔universidad", () => {
  beforeEach(() => {
    mockResult = [];
  });

  it("getCommunityUniversities devuelve las universidades enlazadas a una comunidad", async () => {
    const fake = [
      { university: { id: 1, name: "IE University", slug: "ie-university", emailDomain: "ie.edu", country: "ES" } },
    ];
    mockResult = fake;
    const result = await getCommunityUniversities(1, makeMockDb());
    expect(result).toEqual([fake[0].university]);
  });

  it("getCommunityUniversities devuelve varias universidades si la comunidad abarca más de una (caso futuro soportado hoy)", async () => {
    mockResult = [
      { university: { id: 1, name: "IE University", slug: "ie-university", emailDomain: "ie.edu", country: "ES" } },
      { university: { id: 3, name: "Otra Universidad", slug: "otra-universidad", emailDomain: null, country: "ES" } },
    ];
    const result = await getCommunityUniversities(1, makeMockDb());
    expect(result).toHaveLength(2);
  });
});

describe("communitiesDb — relaciones de comunidad (user_communities)", () => {
  beforeEach(() => {
    mockResult = [];
  });

  it("getUserCommunities devuelve las comunidades del usuario", async () => {
    const fake = [{ id: 1, userId: 42, communityId: 1, roleInCommunity: null, joinedAt: new Date() }];
    mockResult = fake;
    const result = await getUserCommunities(42, makeMockDb());
    expect(result).toEqual(fake);
  });

  it("getUserCommunities devuelve una lista vacía si el usuario no pertenece a ninguna comunidad", async () => {
    mockResult = [];
    const result = await getUserCommunities(999, makeMockDb());
    expect(result).toEqual([]);
  });
});

describe("communitiesDb — UNIQUE(user_id, community_id): crear dos veces la misma relación", () => {
  /**
   * Mock con estado propio (no el `mockResult` compartido) para simular de
   * verdad la secuencia real: 1ª llamada no encuentra fila → inserta.
   * 2ª llamada SÍ la encuentra (comprobación previa de addUserToCommunity)
   * → no reintenta insertar. `setNextQuery` declara explícitamente qué
   * pareja (userId, communityId) va a comprobar la SIGUIENTE llamada — más
   * robusto que intentar parsear el objeto de condición opaco que devuelven
   * `eq`/`and` de drizzle-orm.
   */
  function makeStatefulMockDb() {
    const rows: Array<{ id: number; userId: number; communityId: number }> = [];
    let nextId = 1;
    let matcher: (r: { userId: number; communityId: number }) => boolean = () => false;
    const builder: Record<string, unknown> = {};

    builder.select = () => builder;
    builder.from = () => builder;
    builder.where = () => builder; // condición ignorada a propósito, ver setNextQuery
    builder.limit = () => builder;
    builder.insert = () => builder;
    builder.values = (v: { userId: number; communityId: number }) => {
      rows.push({ id: nextId++, ...v });
      return Promise.resolve([{ insertId: nextId - 1 }]);
    };
    builder.then = (resolve: (v: unknown) => void) => {
      resolve(rows.filter(matcher).map(r => ({ id: r.id })));
    };
    return {
      db: builder as unknown as Parameters<typeof addUserToCommunity>[3],
      rows,
      setNextQuery(userId: number, communityId: number) {
        matcher = r => r.userId === userId && r.communityId === communityId;
      },
    };
  }

  it("la primera llamada crea la relación", async () => {
    const { db, rows, setNextQuery } = makeStatefulMockDb();
    setNextQuery(42, 1);
    await addUserToCommunity(42, 1, undefined, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 42, communityId: 1 });
  });

  it("intentar crear la misma relación usuario-comunidad dos veces NO duplica la fila", async () => {
    const { db, rows, setNextQuery } = makeStatefulMockDb();
    setNextQuery(42, 1);
    await addUserToCommunity(42, 1, undefined, db); // 1ª vez: no existe → inserta
    // 2ª vez: la comprobación previa ahora SÍ encuentra la fila recién creada
    // (mismo matcher, sigue apuntando a 42/1) → no debe volver a insertar.
    await addUserToCommunity(42, 1, undefined, db);
    expect(rows).toHaveLength(1); // sigue habiendo solo 1 fila, no 2
  });

  it("una relación con distinta comunidad para el mismo usuario SÍ se crea (no es un duplicado real)", async () => {
    const { db, rows, setNextQuery } = makeStatefulMockDb();
    setNextQuery(42, 1);
    await addUserToCommunity(42, 1, undefined, db);
    setNextQuery(42, 2);
    await addUserToCommunity(42, 2, undefined, db);
    expect(rows).toHaveLength(2);
  });

  it("si el motor rechaza el INSERT por duplicado (condición de carrera), addUserToCommunity no lanza", async () => {
    const raceDb: Record<string, unknown> = {};
    raceDb.select = () => raceDb;
    raceDb.from = () => raceDb;
    raceDb.where = () => raceDb;
    raceDb.limit = () => raceDb;
    raceDb.insert = () => raceDb;
    raceDb.values = () => {
      const err = new Error("Duplicate entry") as Error & { errno: number };
      err.errno = 1062; // ER_DUP_ENTRY real de MySQL — ver isDuplicateKeyError en communitiesDb.ts
      throw err;
    };
    raceDb.then = (resolve: (v: unknown) => void) => resolve([]); // el SELECT previo no encuentra nada (carrera)

    await expect(
      addUserToCommunity(1, 1, undefined, raceDb as unknown as Parameters<typeof addUserToCommunity>[3])
    ).resolves.toBeUndefined();
  });
});
