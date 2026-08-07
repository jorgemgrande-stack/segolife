import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, or, like, inArray, desc, type SQL } from "drizzle-orm";
import {
  studentProfiles,
  studentTags,
  studentTagAssignments,
  studentNotes,
  userCommunities,
  communities,
  universities,
  users,
  type StudentProfile,
  type StudentTag,
  type StudentNote,
  type University,
} from "../../drizzle/schema";

// Pool persistente top-level — mismo patrón que server/hotelDb.ts,
// server/db/reviewsDb.ts y server/db/communitiesDb.ts.
const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

// Campos requeridos para considerar el perfil "completo" — usado tanto al
// calcular profileCompleted en updateOwnProfile como (a futuro) en el
// onboarding. No es un enum hardcodeado de comunidad, es genérico para
// cualquier estudiante de cualquier comunidad/universidad.
const REQUIRED_FOR_COMPLETION = [
  "firstName", "lastName", "dateOfBirth", "nationality",
  "universityId", "degreeProgram", "academicYear", "arrivalDate",
] as const;

export interface StudentCommunitySummary {
  id: number;
  name: string;
  slug: string;
}

export interface StudentListItem {
  studentProfileId: number;
  userId: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  university: University | null;
  nationality: string | null;
  degreeProgram: string | null;
  academicYear: string | null;
  status: "active" | "inactive";
  profileCompleted: boolean;
  createdAt: Date;
  communities: StudentCommunitySummary[];
}

export interface StudentListFilters {
  /** "all" = sin restricción de comunidad (ya resuelto por communityAccess.ts). */
  communityIds: number[] | "all";
  search?: string;
  universityId?: number;
  nationality?: string;
  status?: "active" | "inactive";
  profileCompleted?: boolean;
  limit?: number;
  offset?: number;
}

/** userIds que pertenecen a alguna de las comunidades dadas (sin duplicados). */
async function getUserIdsInCommunities(communityIds: number[], db: DbHandle): Promise<number[]> {
  if (communityIds.length === 0) return [];
  const rows = await db
    .select({ userId: userCommunities.userId })
    .from(userCommunities)
    .where(inArray(userCommunities.communityId, communityIds));
  return Array.from(new Set(rows.map(r => r.userId)));
}

/** Comunidades de cada estudiante (por userId), agrupadas en memoria — escala de tabla de estudiantes, no necesita agregación SQL. */
async function getCommunitiesByUserId(userIds: number[], db: DbHandle): Promise<Map<number, StudentCommunitySummary[]>> {
  const map = new Map<number, StudentCommunitySummary[]>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({ userId: userCommunities.userId, community: communities })
    .from(userCommunities)
    .innerJoin(communities, eq(userCommunities.communityId, communities.id))
    .where(inArray(userCommunities.userId, userIds));
  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push({ id: row.community.id, name: row.community.name, slug: row.community.slug });
    map.set(row.userId, list);
  }
  return map;
}

/**
 * Lista estudiantes con filtro EFECTIVO por comunidad (communityIds ya debe
 * venir resuelto por communityAccess.resolveCommunityFilter — esta función
 * no vuelve a comprobar autorización, solo aplica el filtro que le llega).
 */
export async function listStudents(
  filters: StudentListFilters,
  db?: DbHandle
): Promise<{ items: StudentListItem[]; total: number }> {
  const conn = db ?? (await getDb());

  let restrictToUserIds: number[] | null = null;
  if (filters.communityIds !== "all") {
    restrictToUserIds = await getUserIdsInCommunities(filters.communityIds, conn);
    if (restrictToUserIds.length === 0) return { items: [], total: 0 };
  }

  const conditions: SQL[] = [];
  if (restrictToUserIds) conditions.push(inArray(studentProfiles.userId, restrictToUserIds));
  if (filters.universityId) conditions.push(eq(studentProfiles.universityId, filters.universityId));
  if (filters.nationality) conditions.push(eq(studentProfiles.nationality, filters.nationality));
  if (filters.status) conditions.push(eq(studentProfiles.status, filters.status));
  if (filters.profileCompleted !== undefined) conditions.push(eq(studentProfiles.profileCompleted, filters.profileCompleted));
  if (filters.search) {
    const q = `%${filters.search}%`;
    conditions.push(
      or(
        like(users.name, q),
        like(users.email, q),
        like(studentProfiles.firstName, q),
        like(studentProfiles.lastName, q)
      )!
    );
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const baseQuery = conn
    .select({ profile: studentProfiles, user: users, university: universities })
    .from(studentProfiles)
    .innerJoin(users, eq(studentProfiles.userId, users.id))
    .leftJoin(universities, eq(studentProfiles.universityId, universities.id));

  const rows = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .orderBy(desc(studentProfiles.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  const countQuery = conn
    .select({ profile: studentProfiles })
    .from(studentProfiles)
    .innerJoin(users, eq(studentProfiles.userId, users.id));
  const countRows = await (whereClause ? countQuery.where(whereClause) : countQuery);
  const total = countRows.length;

  const userIds = rows.map(r => r.profile.userId);
  const communitiesByUser = await getCommunitiesByUserId(userIds, conn);

  const items: StudentListItem[] = rows.map(r => ({
    studentProfileId: r.profile.id,
    userId: r.profile.userId,
    name: r.user.name,
    email: r.user.email,
    phone: r.user.phone,
    avatarUrl: r.user.avatarUrl,
    university: r.university,
    nationality: r.profile.nationality,
    degreeProgram: r.profile.degreeProgram,
    academicYear: r.profile.academicYear,
    status: r.profile.status,
    profileCompleted: r.profile.profileCompleted,
    createdAt: r.profile.createdAt,
    communities: communitiesByUser.get(r.profile.userId) ?? [],
  }));

  return { items, total };
}

export interface StudentDetail {
  profile: StudentProfile;
  user: { id: number; name: string | null; email: string | null; phone: string | null; avatarUrl: string | null };
  university: University | null;
  communities: StudentCommunitySummary[];
  tags: StudentTag[];
}

async function buildStudentDetail(
  profile: StudentProfile,
  conn: DbHandle
): Promise<StudentDetail> {
  const [[userRow], [universityRow], communitiesByUser, tagRows] = await Promise.all([
    conn.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, avatarUrl: users.avatarUrl })
      .from(users).where(eq(users.id, profile.userId)).limit(1),
    profile.universityId
      ? conn.select().from(universities).where(eq(universities.id, profile.universityId)).limit(1)
      : Promise.resolve([null]),
    getCommunitiesByUserId([profile.userId], conn),
    conn.select({ tag: studentTags })
      .from(studentTagAssignments)
      .innerJoin(studentTags, eq(studentTagAssignments.tagId, studentTags.id))
      .where(eq(studentTagAssignments.studentProfileId, profile.id)),
  ]);

  return {
    profile,
    user: userRow ?? { id: profile.userId, name: null, email: null, phone: null, avatarUrl: null },
    university: universityRow ?? null,
    communities: communitiesByUser.get(profile.userId) ?? [],
    tags: tagRows.map(t => t.tag),
  };
}

export async function getStudentById(studentProfileId: number, db?: DbHandle): Promise<StudentDetail | null> {
  const conn = db ?? (await getDb());
  const [profile] = await conn.select().from(studentProfiles).where(eq(studentProfiles.id, studentProfileId)).limit(1);
  if (!profile) return null;
  return buildStudentDetail(profile, conn);
}

export async function getStudentByUserId(userId: number, db?: DbHandle): Promise<StudentDetail | null> {
  const conn = db ?? (await getDb());
  const [profile] = await conn.select().from(studentProfiles).where(eq(studentProfiles.userId, userId)).limit(1);
  if (!profile) return null;
  return buildStudentDetail(profile, conn);
}

/** Devuelve el perfil del usuario, creándolo vacío si es su primer acceso (onboarding). */
export async function ensureStudentProfile(userId: number, db?: DbHandle): Promise<StudentProfile> {
  const conn = db ?? (await getDb());
  const [existing] = await conn.select().from(studentProfiles).where(eq(studentProfiles.userId, userId)).limit(1);
  if (existing) return existing;
  await conn.insert(studentProfiles).values({ userId });
  const [created] = await conn.select().from(studentProfiles).where(eq(studentProfiles.userId, userId)).limit(1);
  return created;
}

/** Campos editables por el propio estudiante (y por un admin desde la ficha). */
export interface EditableProfileFields {
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  countryOfOrigin?: string | null;
  preferredLocale?: string | null;
  universityId?: number | null;
  degreeProgram?: string | null;
  academicYear?: string | null;
  arrivalDate?: string | null;
  expectedDepartureDate?: string | null;
  addressLine?: string | null;
  postalCode?: string | null;
  city?: string | null;
}

function computeProfileCompleted(merged: Record<string, unknown>): boolean {
  return REQUIRED_FOR_COMPLETION.every(field => {
    const v = merged[field];
    return v !== null && v !== undefined && v !== "";
  });
}

export async function updateStudentProfile(
  userId: number,
  fields: EditableProfileFields,
  db?: DbHandle
): Promise<StudentProfile> {
  const conn = db ?? (await getDb());
  const current = await ensureStudentProfile(userId, conn);
  const merged = { ...current, ...fields };
  const profileCompleted = computeProfileCompleted(merged as unknown as Record<string, unknown>);
  await conn.update(studentProfiles).set({ ...fields, profileCompleted }).where(eq(studentProfiles.userId, userId));
  const [updated] = await conn.select().from(studentProfiles).where(eq(studentProfiles.userId, userId)).limit(1);
  return updated;
}

/** Campos exclusivos de administración (nunca editables por el propio estudiante). */
export async function updateStudentAdminFields(
  studentProfileId: number,
  fields: { status?: "active" | "inactive" },
  db?: DbHandle
): Promise<StudentProfile | null> {
  const conn = db ?? (await getDb());
  await conn.update(studentProfiles).set(fields).where(eq(studentProfiles.id, studentProfileId));
  const [updated] = await conn.select().from(studentProfiles).where(eq(studentProfiles.id, studentProfileId)).limit(1);
  return updated ?? null;
}

// ─── NOTAS INTERNAS ─────────────────────────────────────────────────────────
// Privadas — nunca expuestas en procedures de autoservicio del estudiante.

export async function listStudentNotes(studentProfileId: number, db?: DbHandle): Promise<StudentNote[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(studentNotes)
    .where(eq(studentNotes.studentProfileId, studentProfileId))
    .orderBy(desc(studentNotes.createdAt));
}

export async function addStudentNote(
  studentProfileId: number,
  authorUserId: number,
  note: string,
  db?: DbHandle
): Promise<StudentNote> {
  const conn = db ?? (await getDb());
  const insertResult = await conn.insert(studentNotes).values({ studentProfileId, authorUserId, note });
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [created] = await conn.select().from(studentNotes).where(eq(studentNotes.id, insertId)).limit(1);
  return created;
}

// ─── ETIQUETAS ──────────────────────────────────────────────────────────────
// Catálogo configurable — nunca hardcodeado (ver drizzle/schema.ts).

export async function listStudentTags(db?: DbHandle): Promise<StudentTag[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(studentTags).orderBy(studentTags.name);
}

export async function assignStudentTag(
  studentProfileId: number,
  tagId: number,
  assignedByUserId: number,
  db?: DbHandle
): Promise<void> {
  const conn = db ?? (await getDb());
  const existing = await conn.select({ id: studentTagAssignments.id }).from(studentTagAssignments)
    .where(and(eq(studentTagAssignments.studentProfileId, studentProfileId), eq(studentTagAssignments.tagId, tagId)))
    .limit(1);
  if (existing.length > 0) return;
  try {
    await conn.insert(studentTagAssignments).values({ studentProfileId, tagId, assignedByUserId });
  } catch (err) {
    const errno = err && typeof err === "object" && "errno" in err ? (err as { errno?: number }).errno : undefined;
    if (errno !== 1062) throw err;
  }
}

export async function unassignStudentTag(studentProfileId: number, tagId: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.delete(studentTagAssignments)
    .where(and(eq(studentTagAssignments.studentProfileId, studentProfileId), eq(studentTagAssignments.tagId, tagId)));
}
