/**
 * commandCenterCommunityPulse.ts — `dashboard.getCommunityPulse` (spec §9).
 * DAU/WAU/MAU + nuevos + inactivos + completitud de perfil + serie diaria
 * de 30 días. Reutiliza activitySignals.ts — nunca redefine "actividad".
 */
import { eq, and, gte, lt, count, avg, sql } from "drizzle-orm";
import { users, studentProfiles } from "../../../drizzle/schema";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { DashboardFilterContext } from "./dashboardFilters";
import { communityUserCondition } from "./dashboardFilters";
import { countActiveStudents, dailyActiveStudents, lastActivityByStudent } from "./activitySignals";

export interface CommunityPulseSnapshot {
  dau: number;
  wau: number;
  mau: number;
  newStudents: number;
  inactive7d: number;
  inactive30d: number;
  profileCompletionPct: number | null;
  dailySeries: Array<{ date: string; activeCount: number }>;
}

export async function getCommunityPulse(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<CommunityPulseSnapshot> {
  const now = ctx.to;
  const communityCond = communityUserCondition(users.id, ctx.communityId, db);

  const [dau, wau, mau, [newRow], [completionRow], lastActivityMap, dailySeries] = await Promise.all([
    countActiveStudents(new Date(now.getTime() - 24 * 60 * 60 * 1000), now, ctx.communityId, db),
    countActiveStudents(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), now, ctx.communityId, db),
    countActiveStudents(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), now, ctx.communityId, db),
    db.select({ n: count() }).from(users).innerJoin(studentProfiles, eq(studentProfiles.userId, users.id))
      .where(and(gte(users.createdAt, ctx.from), lt(users.createdAt, ctx.to), communityCond ? communityCond : sql`1=1`)),
    db.select({ pct: avg(sql`IF(${studentProfiles.profileCompleted}, 1, 0)`) }).from(users)
      .innerJoin(studentProfiles, eq(studentProfiles.userId, users.id))
      .where(communityCond ? communityCond : undefined),
    lastActivityByStudent(db),
    dailyActiveStudents(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), now, ctx.communityId, db),
  ]);

  // Inactive 7d/30d: Students REGISTRADOS cuya última señal (o nunca) es anterior al umbral — población total de Students, no solo activos.
  let inactive7d = 0, inactive30d = 0;
  const day7 = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const day30 = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const communityUserIds = ctx.communityId != null
    ? new Set((await db.select({ userId: users.id }).from(users).innerJoin(studentProfiles, eq(studentProfiles.userId, users.id)).where(communityUserCondition(users.id, ctx.communityId, db))).map(r => r.userId))
    : null;
  const allStudentIds = await db.select({ userId: users.id }).from(users).innerJoin(studentProfiles, eq(studentProfiles.userId, users.id));
  for (const { userId } of allStudentIds) {
    if (communityUserIds && !communityUserIds.has(userId)) continue;
    const last = lastActivityMap.get(userId);
    if (!last || last.getTime() < day7) inactive7d++;
    if (!last || last.getTime() < day30) inactive30d++;
  }

  return {
    dau, wau, mau,
    newStudents: Number(newRow?.n ?? 0),
    inactive7d, inactive30d,
    profileCompletionPct: completionRow?.pct != null ? Math.round(Number(completionRow.pct) * 1000) / 10 : null,
    dailySeries,
  };
}
