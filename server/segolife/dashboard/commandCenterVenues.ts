/**
 * commandCenterVenues.ts — SEGOLIFE ADMIN COMMAND CENTER. `dashboard.getVenuePerformance`
 * (spec §14). Rollup DINÁMICO por venue — la lista de venues sale siempre de
 * la tabla `venues` (nunca `["Casanova","Tía Felisa","Limoncello"]` a mano;
 * el pool compartido con Andorra/Formigal/Astún-Candanchú confirma que este
 * dashboard puede crecer a más venues sin tocar código).
 *
 * Revenue SIEMPRE desglosado (spec §1.4/§14): Ticket / Commerce / Total
 * Ecosistema (= suma explícita, nunca una sola cifra fusionada).
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { DashboardFilterContext } from "./dashboardFilters";
import { activeStudentsByVenue } from "./activitySignals";
import { getHistoricalIdentityStatsByVenue } from "../students/historicalIdentityService";

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[]])[0] ?? [];
}

export interface VenuePerformanceRow {
  venueId: number;
  venueName: string;
  activeStudents: number;
  historicalIdentities: number;
  historicalCrossVenue: number;
  ticketsSold: number;
  attendanceCount: number;
  ticketRevenueCents: number;
  commerceRevenueCents: number;
  totalEcosystemRevenueCents: number;
  segoTokensEarned: number;
  segoTokensSpent: number;
  benefitsGenerated: number;
  benefitsRedeemed: number;
  trend: { last24hRevenueCents: number; prior24hRevenueCents: number; direction: "up" | "down" | "flat" };
}

export interface VenuePerformanceSnapshot {
  rows: VenuePerformanceRow[];
}

function trendDirection(last: number, prior: number): "up" | "down" | "flat" {
  if (prior === 0) return last > 0 ? "up" : "flat";
  const ratio = last / prior;
  if (ratio >= 1.1) return "up";
  if (ratio <= 0.9) return "down";
  return "flat";
}

export async function getVenuePerformance(ctx: DashboardFilterContext, db: AnyDbHandle, now: Date = ctx.to): Promise<VenuePerformanceSnapshot> {
  const communityVenueCond = ctx.communityId != null ? sql`AND v.id IN (SELECT venue_id FROM community_venues WHERE community_id = ${ctx.communityId})` : sql``;

  const venuesResult = await db.execute(sql`SELECT v.id AS venue_id, v.name AS venue_name FROM venues v WHERE 1=1 ${communityVenueCond} ORDER BY v.name ASC`);
  const venueList = rowsOf<{ venue_id: number; venue_name: string }>(venuesResult);
  if (venueList.length === 0) return { rows: [] };
  const venueIds = venueList.map(v => Number(v.venue_id));
  const inClause = sql.join(venueIds, sql`, `);

  const [activeStudentsMap, historicalByVenue, ticketsResult, attendanceResult, commerceResult, tokensResult, benefitsResult, trendResult] = await Promise.all([
    activeStudentsByVenue(ctx.from, ctx.to, ctx.communityId, db),
    getHistoricalIdentityStatsByVenue(db as never),
    db.execute(sql`
      SELECT e.venue_id AS venue_id, COALESCE(SUM(oi.quantity), 0) AS tickets_sold, COALESCE(SUM(o.total_cents), 0) AS revenue_cents
      FROM ticket_orders o
      JOIN events e ON e.id = o.event_id
      LEFT JOIN ticket_order_items oi ON oi.order_id = o.id
      WHERE o.status = 'paid' AND o.purchased_at >= ${ctx.from} AND o.purchased_at < ${ctx.to} AND e.venue_id IN (${inClause})
      GROUP BY e.venue_id
    `),
    db.execute(sql`SELECT venue_id, COUNT(*) AS n FROM event_attendance WHERE occurred_at >= ${ctx.from} AND occurred_at < ${ctx.to} AND venue_id IN (${inClause}) GROUP BY venue_id`),
    db.execute(sql`SELECT venue_id, COALESCE(SUM(total_cents), 0) AS revenue_cents FROM commerce_transactions WHERE status = 'confirmed' AND occurred_at >= ${ctx.from} AND occurred_at < ${ctx.to} AND venue_id IN (${inClause}) GROUP BY venue_id`),
    db.execute(sql`
      SELECT venue_id,
        COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0) AS earned,
        COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0) AS spent
      FROM token_ledger WHERE created_at >= ${ctx.from} AND created_at < ${ctx.to} AND venue_id IN (${inClause})
      GROUP BY venue_id
    `),
    db.execute(sql`
      SELECT source_venue_id AS venue_id,
        COUNT(*) AS \`generated\`,
        SUM(CASE WHEN status = 'used' AND used_at >= ${ctx.from} AND used_at < ${ctx.to} THEN 1 ELSE 0 END) AS redeemed
      FROM user_benefits WHERE granted_at >= ${ctx.from} AND granted_at < ${ctx.to} AND source_venue_id IN (${inClause})
      GROUP BY source_venue_id
    `),
    db.execute(sql`
      SELECT e.venue_id AS venue_id,
        COALESCE(SUM(CASE WHEN o.purchased_at >= ${new Date(now.getTime() - 24 * 60 * 60 * 1000)} THEN o.total_cents ELSE 0 END), 0) AS last24h,
        COALESCE(SUM(CASE WHEN o.purchased_at >= ${new Date(now.getTime() - 48 * 60 * 60 * 1000)} AND o.purchased_at < ${new Date(now.getTime() - 24 * 60 * 60 * 1000)} THEN o.total_cents ELSE 0 END), 0) AS prior24h
      FROM ticket_orders o JOIN events e ON e.id = o.event_id
      WHERE o.status = 'paid' AND e.venue_id IN (${inClause})
      GROUP BY e.venue_id
    `),
  ]);

  const ticketsByVenue = new Map<number, { ticketsSold: number; revenueCents: number }>();
  for (const r of rowsOf<{ venue_id: number; tickets_sold: number | string; revenue_cents: number | string }>(ticketsResult)) {
    ticketsByVenue.set(Number(r.venue_id), { ticketsSold: Number(r.tickets_sold), revenueCents: Number(r.revenue_cents) });
  }
  const attendanceByVenue = new Map<number, number>();
  for (const r of rowsOf<{ venue_id: number; n: number | string }>(attendanceResult)) attendanceByVenue.set(Number(r.venue_id), Number(r.n));
  const commerceByVenue = new Map<number, number>();
  for (const r of rowsOf<{ venue_id: number; revenue_cents: number | string }>(commerceResult)) commerceByVenue.set(Number(r.venue_id), Number(r.revenue_cents));
  const tokensByVenue = new Map<number, { earned: number; spent: number }>();
  for (const r of rowsOf<{ venue_id: number; earned: number | string; spent: number | string }>(tokensResult)) {
    tokensByVenue.set(Number(r.venue_id), { earned: Number(r.earned), spent: Number(r.spent) });
  }
  const benefitsByVenue = new Map<number, { generated: number; redeemed: number }>();
  for (const r of rowsOf<{ venue_id: number; generated: number | string; redeemed: number | string }>(benefitsResult)) {
    benefitsByVenue.set(Number(r.venue_id), { generated: Number(r.generated), redeemed: Number(r.redeemed) });
  }
  const trendByVenue = new Map<number, { last24h: number; prior24h: number }>();
  for (const r of rowsOf<{ venue_id: number; last24h: number | string; prior24h: number | string }>(trendResult)) {
    trendByVenue.set(Number(r.venue_id), { last24h: Number(r.last24h), prior24h: Number(r.prior24h) });
  }
  const historicalMap = new Map(historicalByVenue.map(h => [h.venueId, h]));

  const rows: VenuePerformanceRow[] = venueList.map(v => {
    const venueId = Number(v.venue_id);
    const tickets = ticketsByVenue.get(venueId) ?? { ticketsSold: 0, revenueCents: 0 };
    const commerceRevenueCents = commerceByVenue.get(venueId) ?? 0;
    const tokens = tokensByVenue.get(venueId) ?? { earned: 0, spent: 0 };
    const benefits = benefitsByVenue.get(venueId) ?? { generated: 0, redeemed: 0 };
    const trend = trendByVenue.get(venueId) ?? { last24h: 0, prior24h: 0 };
    const historical = historicalMap.get(venueId) ?? { total: 0, crossVenue: 0 };
    return {
      venueId, venueName: v.venue_name,
      activeStudents: activeStudentsMap.get(venueId) ?? 0,
      historicalIdentities: historical.total,
      historicalCrossVenue: historical.crossVenue,
      ticketsSold: tickets.ticketsSold,
      attendanceCount: attendanceByVenue.get(venueId) ?? 0,
      ticketRevenueCents: tickets.revenueCents,
      commerceRevenueCents,
      totalEcosystemRevenueCents: tickets.revenueCents + commerceRevenueCents,
      segoTokensEarned: tokens.earned,
      segoTokensSpent: tokens.spent,
      benefitsGenerated: benefits.generated,
      benefitsRedeemed: benefits.redeemed,
      trend: { last24hRevenueCents: trend.last24h, prior24hRevenueCents: trend.prior24h, direction: trendDirection(trend.last24h, trend.prior24h) },
    };
  });

  return { rows };
}
