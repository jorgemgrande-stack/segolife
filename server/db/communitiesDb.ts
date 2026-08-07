import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and } from "drizzle-orm";
import {
  communities,
  universities,
  communityUniversities,
  userCommunities,
  type Community,
  type University,
  type UserCommunity,
} from "../../drizzle/schema";

// Pool persistente top-level (1 sola conexión reutilizable) — mismo patrón
// que server/hotelDb.ts y server/db/reviewsDb.ts, para evitar el leak de
// conexiones que causaba `createConnection()` por petición.
const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

// Todas las funciones aceptan un `db` opcional (por defecto, la conexión
// real) para poder inyectar un mock en tests sin depender de vi.mock sobre
// mysql2/drizzle-orm — ver server/db/communitiesDb.test.ts.

/** true si el error es un duplicado de clave única de MySQL (ER_DUP_ENTRY = 1062). */
function isDuplicateKeyError(err: unknown): boolean {
  return !!err && typeof err === "object" && "errno" in err && (err as { errno?: number }).errno === 1062;
}

// ─── COMMUNITIES ────────────────────────────────────────────────────────────

/** Lista todas las comunidades (para el selector admin y el listado público). */
export async function listCommunities(db?: DbHandle): Promise<Community[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(communities);
}

/** Resuelve una comunidad por su slug (usado para /ie, /uva, futuros campus). */
export async function getCommunityBySlug(slug: string, db?: DbHandle): Promise<Community | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(communities).where(eq(communities.slug, slug)).limit(1);
  return row ?? null;
}

// ─── UNIVERSITIES ───────────────────────────────────────────────────────────

/** Lista todas las universidades (catálogo de referencia). */
export async function listUniversities(db?: DbHandle): Promise<University[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(universities);
}

/**
 * Universidades asociadas a una comunidad (0, 1 o varias — ver
 * drizzle/schema.ts, `communityUniversities` reemplaza a un
 * `communities.university_id` 1:N que era incoherente con
 * docs/SEGOLIFE_MULTICOMMUNITY_ARCHITECTURE.md).
 */
export async function getCommunityUniversities(communityId: number, db?: DbHandle): Promise<University[]> {
  const conn = db ?? (await getDb());
  const rows = await conn
    .select({ university: universities })
    .from(communityUniversities)
    .innerJoin(universities, eq(communityUniversities.universityId, universities.id))
    .where(eq(communityUniversities.communityId, communityId));
  return rows.map(r => r.university);
}

/** Enlaza una comunidad con una universidad. Idempotente (unique real en BD). */
export async function linkCommunityToUniversity(
  communityId: number,
  universityId: number,
  db?: DbHandle
): Promise<void> {
  const conn = db ?? (await getDb());
  try {
    await conn.insert(communityUniversities).values({ communityId, universityId });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }
}

// ─── USER_COMMUNITIES ───────────────────────────────────────────────────────

/** Comunidades a las que pertenece un usuario. */
export async function getUserCommunities(userId: number, db?: DbHandle): Promise<UserCommunity[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(userCommunities).where(eq(userCommunities.userId, userId));
}

/**
 * Asocia un usuario a una comunidad. Idempotente tanto a nivel de aplicación
 * (comprobación previa, evita una escritura+error en el caso normal) como de
 * motor (unique(user_id, community_id) real en MySQL — ver drizzle/schema.ts
 * — captura también la carrera entre el SELECT y el INSERT).
 */
export async function addUserToCommunity(
  userId: number,
  communityId: number,
  roleInCommunity?: string,
  db?: DbHandle
): Promise<void> {
  const conn = db ?? (await getDb());
  const existing = await conn
    .select({ id: userCommunities.id })
    .from(userCommunities)
    .where(and(eq(userCommunities.userId, userId), eq(userCommunities.communityId, communityId)))
    .limit(1);
  if (existing.length > 0) return;
  try {
    await conn.insert(userCommunities).values({ userId, communityId, roleInCommunity });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }
}

// ─── SEED ────────────────────────────────────────────────────────────────────

/**
 * Seed inicial de Segolife: IE University / Universidad de Valladolid +
 * comunidades "ie" / "uva", enlazadas vía `communityUniversities` (M2M).
 * Solo inserta si la tabla `communities` está vacía (mismo patrón idempotente
 * que seedExperiencesIfEmpty en server/_core/index.ts). Los literales
 * "ie"/"uva" viven SOLO aquí (seed), nunca en lógica de negocio — ver
 * CLAUDE.md, regla arquitectónica fundamental.
 */
export async function seedSegolifeCommunitiesIfEmpty(): Promise<void> {
  const db = await getDb();
  const existing = await db.select({ id: communities.id }).from(communities).limit(1);
  if (existing.length > 0) {
    console.log("[Seed] Comunidades Segolife ya presentes, se omite el seed");
    return;
  }

  console.log("[Seed] Tabla de comunidades vacía — sembrando IE/UVA...");

  const ieUniInsert = await db.insert(universities).values({
    name: "IE University",
    slug: "ie-university",
    emailDomain: "ie.edu",
    country: "ES",
  });
  const ieUniversityId = (ieUniInsert as unknown as [{ insertId: number }])[0].insertId;

  const uvaUniInsert = await db.insert(universities).values({
    name: "Universidad de Valladolid",
    slug: "universidad-de-valladolid",
    emailDomain: "uva.es",
    country: "ES",
  });
  const uvaUniversityId = (uvaUniInsert as unknown as [{ insertId: number }])[0].insertId;

  const ieCommunityInsert = await db.insert(communities).values({
    name: "Segolife IE",
    slug: "ie",
    defaultLocale: "en",
    availableLocales: ["en", "es"],
    status: "active",
  });
  const ieCommunityId = (ieCommunityInsert as unknown as [{ insertId: number }])[0].insertId;

  const uvaCommunityInsert = await db.insert(communities).values({
    name: "Segolife UVA",
    slug: "uva",
    defaultLocale: "es",
    availableLocales: ["es"],
    status: "active",
  });
  const uvaCommunityId = (uvaCommunityInsert as unknown as [{ insertId: number }])[0].insertId;

  await db.insert(communityUniversities).values({ communityId: ieCommunityId, universityId: ieUniversityId });
  await db.insert(communityUniversities).values({ communityId: uvaCommunityId, universityId: uvaUniversityId });

  console.log("[Seed] ✓ Comunidades IE y UVA sembradas correctamente (enlazadas a sus universidades)");
}
