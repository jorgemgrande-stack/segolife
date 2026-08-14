/**
 * studentSegmentFilterService.ts — SEGOLIFE ADMIN COMMAND CENTER, Fase
 * "Deep Navigation" (Production Polish Gate, spec §10/§13). Permite listar
 * Students filtrados por SEGMENTO real (new/active/highly_engaged/at_risk/
 * dormant/high_spend) — el gap conocido del informe anterior: Student
 * Intelligence enlazaba a `/admin/students` sin aplicar el segmento porque
 * `students.list`/`studentsDb.ts` nunca soportó este filtro.
 *
 * DELIBERADAMENTE en un archivo NUEVO, separado de `studentsDb.ts` — ese
 * archivo documenta explícitamente (ver `StudentListItem`, comentario
 * "columnas caras") que Score/Segmento/Última actividad/Gasto se excluyeron
 * a propósito del listado principal por requerir agregación cross-fuente,
 * "no añadirlas sin perfilar antes el coste real" — se respeta esa decisión
 * arquitectónica, no se toca `listStudents`. Esta es una vía de acceso
 * EXPLÍCITA y AISLADA, solo para cuando el admin pide un segmento en
 * concreto (nunca la ruta por defecto de `/admin/students`).
 *
 * Reutiliza EXACTAMENTE los mismos umbrales y la misma prioridad de reglas
 * que `studentIntelligenceService.computeSegment()` (vía las constantes ya
 * exportadas) y las mismas fuentes de actividad que `activitySignals.ts` —
 * nunca redefine ninguno de los dos. Mismo patrón de clasificación batch que
 * `commandCenterStudents.ts`, pero devolviendo FILAS paginadas en vez de
 * solo conteos.
 *
 * Escala: pensado para el volumen actual y a corto/medio plazo (miles de
 * Students, no cientos de miles) — el candidate set se agrega en Node, igual
 * que `commandCenterStudents.ts`. Si Segolife alcanza un volumen de
 * Students donde esto deje de ser razonable, la clasificación deberá
 * empujarse a SQL (documentado como límite conocido, no un problema hoy).
 */
import { eq, and, or, like, inArray, type SQL } from "drizzle-orm";
import { studentProfiles, users, universities, userCommunities, communities, tokenWallets } from "../../../drizzle/schema";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { StudentListItem, StudentCommunitySummary } from "../../db/studentsDb";
import {
  NEW_STUDENT_GRACE_DAYS, FREQUENCY_WINDOW_DAYS, FREQUENCY_TARGET_EVENTS,
  COMMERCE_TARGET_CENTS, LOYALTY_TARGET_ACTIONS, DORMANT_THRESHOLD_DAYS, AT_RISK_THRESHOLD_DAYS,
} from "./studentIntelligenceService";
import { lastActivityByStudent, activityCountByStudentSince } from "../dashboard/activitySignals";
import { sql } from "drizzle-orm";

export type StudentSegmentKey = "new" | "active" | "highly_engaged" | "at_risk" | "dormant" | "high_spend";

export interface StudentSegmentFilters {
  communityIds: number[] | "all";
  universityId?: number;
  nationality?: string;
  profileCompleted?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

function classifySegment(input: {
  daysSinceRegistration: number; daysSinceActivity: number | null;
  frequencyCount: number; totalSpendCents: number; tokensLifetimeEarned: number;
}): StudentSegmentKey {
  if (input.daysSinceRegistration < NEW_STUDENT_GRACE_DAYS) return "new";
  if (input.daysSinceActivity === null || input.daysSinceActivity > DORMANT_THRESHOLD_DAYS) return "dormant";
  if (input.daysSinceActivity > AT_RISK_THRESHOLD_DAYS) return "at_risk";
  const isHighSpend = input.totalSpendCents >= COMMERCE_TARGET_CENTS * 2 || input.tokensLifetimeEarned >= LOYALTY_TARGET_ACTIONS * 20;
  if (isHighSpend && input.daysSinceActivity <= AT_RISK_THRESHOLD_DAYS) return "high_spend";
  if (input.frequencyCount >= FREQUENCY_TARGET_EVENTS && input.daysSinceActivity <= 14) return "highly_engaged";
  return "active";
}

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[]])[0] ?? [];
}

export async function listStudentsBySegment(
  segment: StudentSegmentKey,
  filters: StudentSegmentFilters,
  db: AnyDbHandle,
  now: Date = new Date()
): Promise<{ items: StudentListItem[]; total: number }> {
  const conditions: SQL[] = [];
  if (filters.communityIds !== "all") {
    if (filters.communityIds.length === 0) return { items: [], total: 0 };
    conditions.push(inArray(
      studentProfiles.userId,
      db.select({ userId: userCommunities.userId }).from(userCommunities).where(inArray(userCommunities.communityId, filters.communityIds))
    ));
  }
  if (filters.universityId) conditions.push(eq(studentProfiles.universityId, filters.universityId));
  if (filters.nationality) conditions.push(eq(studentProfiles.nationality, filters.nationality));
  if (filters.profileCompleted !== undefined) conditions.push(eq(studentProfiles.profileCompleted, filters.profileCompleted));
  if (filters.search) {
    const q = `%${filters.search}%`;
    conditions.push(or(like(users.name, q), like(users.email, q), like(studentProfiles.firstName, q), like(studentProfiles.lastName, q))!);
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const baseQuery = db
    .select({ profile: studentProfiles, user: users, university: universities })
    .from(studentProfiles)
    .innerJoin(users, eq(studentProfiles.userId, users.id))
    .leftJoin(universities, eq(studentProfiles.universityId, universities.id));
  const candidateRows = await (whereClause ? baseQuery.where(whereClause) : baseQuery);
  if (candidateRows.length === 0) return { items: [], total: 0 };

  const candidateUserIds = candidateRows.map(r => r.profile.userId);

  const [lastActivityMap, frequencyMap, spendResult, walletsResult, communitiesByUser] = await Promise.all([
    lastActivityByStudent(db),
    activityCountByStudentSince(new Date(now.getTime() - FREQUENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000), now, db),
    db.execute(sql`
      SELECT user_id, SUM(cents) AS total FROM (
        SELECT user_id, total_cents AS cents FROM ticket_orders WHERE status = 'paid' AND user_id IS NOT NULL
        UNION ALL
        SELECT user_id, total_cents AS cents FROM commerce_transactions WHERE status = 'confirmed' AND user_id IS NOT NULL
      ) spend WHERE user_id IN (${sql.join(candidateUserIds, sql`, `)}) GROUP BY user_id
    `),
    db.select({ userId: tokenWallets.userId, balance: tokenWallets.balance, lifetimeEarned: tokenWallets.lifetimeEarned })
      .from(tokenWallets).where(inArray(tokenWallets.userId, candidateUserIds)),
    (async () => {
      const rows = await db.select({ userId: userCommunities.userId, community: communities })
        .from(userCommunities).innerJoin(communities, eq(userCommunities.communityId, communities.id))
        .where(inArray(userCommunities.userId, candidateUserIds));
      const map = new Map<number, StudentCommunitySummary[]>();
      for (const r of rows) {
        const list = map.get(r.userId) ?? [];
        list.push({ id: r.community.id, name: r.community.name, slug: r.community.slug });
        map.set(r.userId, list);
      }
      return map;
    })(),
  ]);

  const spendByUser = new Map<number, number>();
  for (const r of rowsOf<{ user_id: number; total: number | string }>(spendResult)) spendByUser.set(Number(r.user_id), Number(r.total));
  const walletByUser = new Map(walletsResult.map(w => [w.userId, w]));

  const matched: StudentListItem[] = [];
  for (const row of candidateRows) {
    const userId = row.profile.userId;
    const daysSinceRegistration = Math.floor((now.getTime() - row.profile.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const lastActivity = lastActivityMap.get(userId) ?? null;
    const daysSinceActivity = lastActivity ? Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)) : null;
    const wallet = walletByUser.get(userId);
    const rowSegment = classifySegment({
      daysSinceRegistration,
      daysSinceActivity,
      frequencyCount: frequencyMap.get(userId) ?? 0,
      totalSpendCents: spendByUser.get(userId) ?? 0,
      tokensLifetimeEarned: wallet?.lifetimeEarned ?? 0,
    });
    if (rowSegment !== segment) continue;
    matched.push({
      studentProfileId: row.profile.id,
      userId,
      name: row.user.name,
      email: row.user.email,
      phone: row.user.phone,
      avatarUrl: row.user.avatarUrl,
      university: row.university,
      nationality: row.profile.nationality,
      degreeProgram: row.profile.degreeProgram,
      academicYear: row.profile.academicYear,
      status: row.profile.status,
      profileCompleted: row.profile.profileCompleted,
      createdAt: row.profile.createdAt,
      communities: communitiesByUser.get(userId) ?? [],
      tokensBalance: wallet?.balance ?? 0,
    });
  }

  matched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const total = matched.length;
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 50;
  return { items: matched.slice(offset, offset + limit), total };
}
