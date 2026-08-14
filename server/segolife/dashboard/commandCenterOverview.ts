/**
 * commandCenterOverview.ts — SEGOLIFE ADMIN COMMAND CENTER. `dashboard.getOverview`
 * — KPI Strip principal (spec §7): Estudiantes, Activos, Tickets,
 * Asistencias, SegoTokens, Benefits. Todo agregado en SQL (COUNT/SUM/GROUP
 * BY) — nunca fetch-all-then-length (spec §26).
 */
import { eq, and, gte, lt, sql, count, sum } from "drizzle-orm";
import {
  users, studentProfiles, userCommunities, ticketOrders, eventAttendance,
  tokenLedger, tokenWallets, userBenefits,
} from "../../../drizzle/schema";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { DashboardFilterContext } from "./dashboardFilters";
import { communityUserCondition } from "./dashboardFilters";
import { countActiveStudents } from "./activitySignals";
import { LIVE_LOYALTY_ENABLED } from "../tokens/tokenEngine";

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[]])[0] ?? [];
}

export interface StudentsKpi {
  total: number;
  newInPeriod: number;
}

export interface ActiveKpi {
  activeInPeriod: number;
  dau: number;
  wau: number;
  mau: number;
}

export interface TicketsKpi {
  ordersInPeriod: number;
  paid: number;
  cancelled: number;
  refunded: number;
  ticketRevenueCents: number;
  /** SEGOLIFE — Native Ticket Sales (spec §28): "no atribuir a SEGOLIFE revenue que pertenece a Fourvenues" — desglose real por `ticket_orders.provider`, nunca mezclado en un único total sin distinguir origen. */
  nativePaid: number;
  nativeRevenueCents: number;
  fourvenuesPaid: number;
  fourvenuesRevenueCents: number;
}

export interface AttendanceKpi {
  confirmed: number;
  eligibleTickets: number;
  attendanceRatePct: number | null;
  unresolvedHistoricalCount: number;
}

export interface SegoTokensKpi {
  earnedInPeriod: number;
  spentInPeriod: number;
  circulatingBalance: number;
  liveStatus: "LIVE_ACTIVE" | "LIVE_LOCKED";
}

export interface BenefitsKpi {
  generated: number;
  available: number;
  redeemed: number;
  expired: number;
  redemptionRatePct: number | null;
}

export interface OverviewSnapshot {
  students: StudentsKpi;
  active: ActiveKpi;
  tickets: TicketsKpi;
  attendance: AttendanceKpi;
  segoTokens: SegoTokensKpi;
  benefits: BenefitsKpi;
}

async function getStudentsKpi(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<StudentsKpi> {
  const communityCond = communityUserCondition(users.id, ctx.communityId, db);
  const [[totalRow], [newRow]] = await Promise.all([
    db.select({ n: count() }).from(users).innerJoin(studentProfiles, eq(studentProfiles.userId, users.id))
      .where(communityCond ? and(communityCond) : undefined),
    db.select({ n: count() }).from(users).innerJoin(studentProfiles, eq(studentProfiles.userId, users.id))
      .where(and(gte(users.createdAt, ctx.from), lt(users.createdAt, ctx.to), communityCond ? communityCond : sql`1=1`)),
  ]);
  return { total: Number(totalRow?.n ?? 0), newInPeriod: Number(newRow?.n ?? 0) };
}

async function getActiveKpi(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<ActiveKpi> {
  const now = ctx.to;
  const [activeInPeriod, dau, wau, mau] = await Promise.all([
    countActiveStudents(ctx.from, ctx.to, ctx.communityId, db),
    countActiveStudents(new Date(now.getTime() - 24 * 60 * 60 * 1000), now, ctx.communityId, db),
    countActiveStudents(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), now, ctx.communityId, db),
    countActiveStudents(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), now, ctx.communityId, db),
  ]);
  return { activeInPeriod, dau, wau, mau };
}

async function getTicketsKpi(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<TicketsKpi> {
  const communityCond = communityUserCondition(ticketOrders.userId, ctx.communityId, db);
  const base = and(gte(ticketOrders.purchasedAt, ctx.from), lt(ticketOrders.purchasedAt, ctx.to), communityCond ? communityCond : sql`1=1`);
  const rows = await db.select({
    status: ticketOrders.status,
    provider: ticketOrders.provider,
    n: count(),
    revenue: sum(ticketOrders.totalCents),
  }).from(ticketOrders).where(base).groupBy(ticketOrders.status, ticketOrders.provider);

  let ordersInPeriod = 0, paid = 0, cancelled = 0, refunded = 0, ticketRevenueCents = 0;
  let nativePaid = 0, nativeRevenueCents = 0, fourvenuesPaid = 0, fourvenuesRevenueCents = 0;
  for (const r of rows) {
    const n = Number(r.n);
    const revenue = Number(r.revenue ?? 0);
    ordersInPeriod += n;
    if (r.status === "paid") {
      paid += n;
      ticketRevenueCents += revenue;
      // `provider` distingue "segolife" (nativo, ver inventoryHoldService.ts) de "fourvenues" —
      // spec §28/§45: cada origen es su propio source of truth, nunca se confunden operacionalmente.
      if (r.provider === "segolife") { nativePaid += n; nativeRevenueCents += revenue; }
      else if (r.provider === "fourvenues") { fourvenuesPaid += n; fourvenuesRevenueCents += revenue; }
    }
    if (r.status === "cancelled" || r.status === "failed") cancelled += n;
    if (r.status === "refunded" || r.status === "partially_refunded") refunded += n;
  }
  return { ordersInPeriod, paid, cancelled, refunded, ticketRevenueCents, nativePaid, nativeRevenueCents, fourvenuesPaid, fourvenuesRevenueCents };
}

async function getAttendanceKpi(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<AttendanceKpi> {
  const communityCond = communityUserCondition(eventAttendance.userId, ctx.communityId, db);
  // NOTA: `db.execute()` devuelve la tupla cruda `[rows, fields]` (confirmado
  // en server/routers.ts) — se desenvuelve UNA sola vez con `rowsOf`, nunca
  // dos (un bug anterior desenvolvía el resultado de `Promise.all` con
  // `[ticketsRow] = ...` —que ya da `ticketsRow = rows`— y LUEGO volvía a
  // indexar `[0]` como si siguiera siendo la tupla completa, dejando
  // eligibleTickets/unresolvedHistoricalCount siempre en 0; detectado por
  // commandCenterOverview.test.ts).
  const [confirmedResult, ticketsResult] = await Promise.all([
    db.select({ n: count() }).from(eventAttendance)
      .where(and(gte(eventAttendance.occurredAt, ctx.from), lt(eventAttendance.occurredAt, ctx.to), communityCond ? communityCond : sql`1=1`)),
    // Denominador: tickets "issued/used" (elegibles) del periodo — excluye cancelled/refunded (spec §7.4).
    db.execute(sql`
      SELECT COUNT(*) AS n FROM event_tickets et
      JOIN ticket_orders o ON o.id = et.order_id
      WHERE et.status IN ('issued','used') AND o.purchased_at >= ${ctx.from} AND o.purchased_at < ${ctx.to}
      ${ctx.communityId != null ? sql`AND et.user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${ctx.communityId})` : sql``}
    `),
  ]);
  const eligibleTickets = Number(rowsOf<{ n: number | string }>(ticketsResult)[0]?.n ?? 0);
  const confirmed = Number(confirmedResult[0]?.n ?? 0);

  const unresolvedResult = await db.execute(sql`SELECT COUNT(*) AS n FROM unresolved_operations WHERE status = 'unresolved' AND operation_type = 'attendance'`);
  const unresolvedHistoricalCount = Number(rowsOf<{ n: number | string }>(unresolvedResult)[0]?.n ?? 0);

  return {
    confirmed,
    eligibleTickets,
    attendanceRatePct: eligibleTickets > 0 ? Math.round((confirmed / eligibleTickets) * 1000) / 10 : null,
    unresolvedHistoricalCount,
  };
}

async function getSegoTokensKpi(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<SegoTokensKpi> {
  const communityCond = communityUserCondition(tokenLedger.userId, ctx.communityId, db);
  const [[earnedRow], [spentRow], [balanceRow]] = await Promise.all([
    db.select({ s: sum(tokenLedger.amount) }).from(tokenLedger)
      .where(and(eq(tokenLedger.direction, "credit"), gte(tokenLedger.createdAt, ctx.from), lt(tokenLedger.createdAt, ctx.to), communityCond ? communityCond : sql`1=1`)),
    db.select({ s: sum(tokenLedger.amount) }).from(tokenLedger)
      .where(and(eq(tokenLedger.direction, "debit"), gte(tokenLedger.createdAt, ctx.from), lt(tokenLedger.createdAt, ctx.to), communityCond ? communityCond : sql`1=1`)),
    (() => {
      const walletCommunityCond = communityUserCondition(tokenWallets.userId, ctx.communityId, db);
      return db.select({ s: sum(tokenWallets.balance) }).from(tokenWallets).where(walletCommunityCond ? walletCommunityCond : undefined);
    })(),
  ]);
  return {
    earnedInPeriod: Number(earnedRow?.s ?? 0),
    spentInPeriod: Number(spentRow?.s ?? 0),
    circulatingBalance: Number(balanceRow?.s ?? 0),
    liveStatus: LIVE_LOYALTY_ENABLED ? "LIVE_ACTIVE" : "LIVE_LOCKED",
  };
}

async function getBenefitsKpi(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<BenefitsKpi> {
  const communityCond = communityUserCondition(userBenefits.userId, ctx.communityId, db);
  const base = communityCond ? and(gte(userBenefits.grantedAt, ctx.from), lt(userBenefits.grantedAt, ctx.to), communityCond) : and(gte(userBenefits.grantedAt, ctx.from), lt(userBenefits.grantedAt, ctx.to));
  const [[generatedRow], [availableRow], [redeemedRow], [expiredRow]] = await Promise.all([
    db.select({ n: count() }).from(userBenefits).where(base),
    db.select({ n: count() }).from(userBenefits).where(and(eq(userBenefits.status, "active"), sql`(${userBenefits.validUntil} IS NULL OR ${userBenefits.validUntil} >= NOW())`, communityCond ? communityCond : sql`1=1`)),
    db.select({ n: count() }).from(userBenefits).where(and(eq(userBenefits.status, "used"), gte(userBenefits.usedAt, ctx.from), lt(userBenefits.usedAt, ctx.to), communityCond ? communityCond : sql`1=1`)),
    // Expiración perezosa corregida (spec §7.6): expired = status expired OR (active AND validUntil < NOW()).
    db.select({ n: count() }).from(userBenefits).where(and(sql`(${userBenefits.status} = 'expired' OR (${userBenefits.status} = 'active' AND ${userBenefits.validUntil} < NOW()))`, communityCond ? communityCond : sql`1=1`)),
  ]);
  const generated = Number(generatedRow?.n ?? 0);
  const redeemed = Number(redeemedRow?.n ?? 0);
  return {
    generated,
    available: Number(availableRow?.n ?? 0),
    redeemed,
    expired: Number(expiredRow?.n ?? 0),
    redemptionRatePct: generated > 0 ? Math.round((redeemed / generated) * 1000) / 10 : null,
  };
}

export async function getOverviewSnapshot(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<OverviewSnapshot> {
  const [students, active, tickets, attendance, segoTokens, benefits] = await Promise.all([
    getStudentsKpi(ctx, db),
    getActiveKpi(ctx, db),
    getTicketsKpi(ctx, db),
    getAttendanceKpi(ctx, db),
    getSegoTokensKpi(ctx, db),
    getBenefitsKpi(ctx, db),
  ]);
  return { students, active, tickets, attendance, segoTokens, benefits };
}
