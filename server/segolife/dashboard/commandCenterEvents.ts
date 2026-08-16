/**
 * commandCenterEvents.ts — SEGOLIFE ADMIN COMMAND CENTER. `dashboard.getEventPerformance`
 * (spec §11-12).
 *
 * Comunidad de EVENTOS = "oferta" (spec §33): vía `community_events`, nunca
 * inferida del venue (un venue puede pertenecer a varias comunidades).
 *
 * Dos ventanas de tiempo distintas y documentadas, a propósito:
 *  - El RANKING (tickets/orders/revenue/attendance) se calcula sobre pedidos
 *    `paid` cuyo `purchased_at` cae en el rango de filtro global (ctx.from/to)
 *    — coherente con el resto del dashboard.
 *  - VELOCITY y NEEDS ATTENTION son señales de tendencia/riesgo sobre la
 *    trayectoria REAL de cada evento (últimas 24h vs 24h previas; ventas
 *    totales desde la primera venta) — deliberadamente INDEPENDIENTES del
 *    filtro de periodo, porque "¿este evento se está frenando?" no depende
 *    de qué rango tenga seleccionado el admin. Documentado aquí para que no
 *    se reinvente en el frontend.
 *
 * NEEDS ATTENTION nunca usa `events.capacity` (spec §11 — confirmado
 * auditoría previa: no fiable, sin lógica de reconciliación) ni % de
 * ocupación. Regla objetiva: evento en los próximos NEEDS_ATTENTION_DAYS_AHEAD
 * días cuya velocidad (tickets/día desde la primera venta) es
 * significativamente inferior (< 50%) a la mediana de eventos próximos
 * comparables — o cero ventas a menos de una semana del evento. Si el pool
 * de eventos próximos comparables es demasiado pequeño (&lt;2) para que una
 * mediana tenga sentido, NO se marca nada — mejor "sin datos suficientes"
 * que un falso positivo (spec: nunca fabricar señales).
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { DashboardFilterContext } from "./dashboardFilters";

const NEEDS_ATTENTION_DAYS_AHEAD = 14;
const ZERO_SALES_ALERT_DAYS_AHEAD = 7;
const LOW_VELOCITY_RATIO = 0.5;
const RANKING_LIMIT = 50;

export type EventTrend = "up" | "down" | "flat" | "insufficient_data";

export interface EventVelocity {
  last24h: number;
  prior24h: number;
  trend: EventTrend;
}

export interface EventPerformanceRow {
  eventId: number;
  eventName: string;
  venueId: number | null;
  venueName: string | null;
  startsAt: string;
  ticketsSold: number;
  ordersCount: number;
  attendanceCount: number;
  eligibleTickets: number;
  attendanceRatePct: number | null;
  /** Valor comercial BRUTO (spec §21: nunca se muta por SegoTokens aplicados) — suma de ticket_orders.total_cents. */
  ticketRevenueCents: number;
  /**
   * Pre-16.2 (spec §22 "SegoTokens are not money revenue"): tramo REAL en
   * dinero — ticketRevenueCents menos el valor promocional de SegoTokens ya
   * aplicado (token_spend_reservations.promotional_value_cents, vía
   * ticket_orders.token_reservation_id). Para un pedido sin SegoTokens,
   * coincide exactamente con ticketRevenueCents.
   */
  ticketMoneyCollectedCents: number;
  /** Valor promocional de SegoTokens ya aplicado — nunca sumado dentro de ticketRevenueCents/ticketMoneyCollectedCents a la vez, siempre reportado aparte. */
  ticketTokensPromotionalValueCents: number;
  velocity: EventVelocity;
}

export interface NeedsAttentionEvent {
  eventId: number;
  eventName: string;
  startsAt: string;
  daysUntilEvent: number;
  ticketsSoldAllTime: number;
  velocityPerDay: number;
  reason: "zero_sales_close_to_event" | "velocity_below_comparable_median";
}

export interface EventPerformanceSnapshot {
  rows: EventPerformanceRow[];
  topEventId: number | null;
  trendingEventId: number | null;
  needsAttention: NeedsAttentionEvent[];
  needsAttentionDataSufficient: boolean;
}

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[]])[0] ?? [];
}

function classifyTrend(last24h: number, prior24h: number): EventTrend {
  if (prior24h === 0) return last24h > 0 ? "up" : "flat";
  const ratio = last24h / prior24h;
  if (ratio >= 1.1) return "up";
  if (ratio <= 0.9) return "down";
  return "flat";
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function getEventPerformance(ctx: DashboardFilterContext, db: AnyDbHandle, now: Date = ctx.to): Promise<EventPerformanceSnapshot> {
  const communityCond = ctx.communityId != null ? sql`AND e.id IN (SELECT event_id FROM community_events WHERE community_id = ${ctx.communityId})` : sql``;

  // Revenue/orders agregados por ORDEN (no por línea de item) — evita doble
  // conteo de `total_cents` cuando una orden tiene varias líneas. Los tickets
  // vendidos se agregan aparte (`ticketsResult`, por item) precisamente para
  // no mezclar ambas unidades en la misma suma.
  //
  // Pre-16.2 (spec §22/§39): LEFT JOIN a token_spend_reservations vía
  // ticket_orders.token_reservation_id — el mismo enlace que ya usa
  // fiscalSnapshotService.ts::buildFromTicketOrder para separar el tramo
  // promocional del real cobrado en dinero. `promotional_value_cents` de la
  // reserva SIEMPRE se resta de `ticket_revenue_cents` (bruto) para obtener
  // `ticket_money_collected_cents` — SegoTokens NUNCA cuenta como ingreso
  // monetario aquí.
  const rankingResult = await db.execute(sql`
    SELECT o.event_id AS event_id, e.name AS event_name, e.venue_id AS venue_id, v.name AS venue_name, e.starts_at AS starts_at,
      COUNT(DISTINCT o.id) AS orders_count,
      COALESCE(SUM(o.total_cents), 0) AS ticket_revenue_cents,
      COALESCE(SUM(tsr.promotional_value_cents), 0) AS ticket_tokens_promotional_value_cents
    FROM ticket_orders o
    JOIN events e ON e.id = o.event_id
    LEFT JOIN venues v ON v.id = e.venue_id
    LEFT JOIN token_spend_reservations tsr ON tsr.id = o.token_reservation_id
    WHERE o.status = 'paid' AND o.purchased_at >= ${ctx.from} AND o.purchased_at < ${ctx.to} ${communityCond}
    GROUP BY o.event_id, e.name, e.venue_id, v.name, e.starts_at
    ORDER BY ticket_revenue_cents DESC
    LIMIT ${RANKING_LIMIT}
  `);
  const revenueByEvent = new Map<number, { ordersCount: number; ticketRevenueCents: number; ticketTokensPromotionalValueCents: number }>();
  for (const r of rowsOf<{ event_id: number; orders_count: number | string; ticket_revenue_cents: number | string; ticket_tokens_promotional_value_cents: number | string }>(rankingResult)) {
    revenueByEvent.set(Number(r.event_id), {
      ordersCount: Number(r.orders_count),
      ticketRevenueCents: Number(r.ticket_revenue_cents),
      ticketTokensPromotionalValueCents: Number(r.ticket_tokens_promotional_value_cents),
    });
  }

  const ticketsResult = await db.execute(sql`
    SELECT o.event_id AS event_id, COALESCE(SUM(oi.quantity), 0) AS tickets_sold
    FROM ticket_orders o
    INNER JOIN ticket_order_items oi ON oi.order_id = o.id
    INNER JOIN events e ON e.id = o.event_id
    WHERE o.status = 'paid' AND o.purchased_at >= ${ctx.from} AND o.purchased_at < ${ctx.to} ${communityCond}
    GROUP BY o.event_id
  `);
  const ticketsByEvent = new Map<number, number>();
  for (const r of rowsOf<{ event_id: number; tickets_sold: number | string }>(ticketsResult)) {
    ticketsByEvent.set(Number(r.event_id), Number(r.tickets_sold));
  }

  const eventIds = Array.from(revenueByEvent.keys());
  const attendanceByEvent = new Map<number, number>();
  const eligibleByEvent = new Map<number, number>();
  const velocityByEvent = new Map<number, EventVelocity>();

  if (eventIds.length > 0) {
    const attendanceResult = await db.execute(sql`
      SELECT event_id, COUNT(*) AS n FROM event_attendance
      WHERE occurred_at >= ${ctx.from} AND occurred_at < ${ctx.to} AND event_id IN (${sql.join(eventIds, sql`, `)})
      GROUP BY event_id
    `);
    for (const r of rowsOf<{ event_id: number; n: number | string }>(attendanceResult)) attendanceByEvent.set(Number(r.event_id), Number(r.n));

    const eligibleResult = await db.execute(sql`
      SELECT et.event_id AS event_id, COUNT(*) AS n FROM event_tickets et
      JOIN ticket_orders o ON o.id = et.order_id
      WHERE et.status IN ('issued','used') AND o.purchased_at >= ${ctx.from} AND o.purchased_at < ${ctx.to} AND et.event_id IN (${sql.join(eventIds, sql`, `)})
      GROUP BY et.event_id
    `);
    for (const r of rowsOf<{ event_id: number; n: number | string }>(eligibleResult)) eligibleByEvent.set(Number(r.event_id), Number(r.n));

    const velocityResult = await db.execute(sql`
      SELECT o.event_id AS event_id,
        COALESCE(SUM(CASE WHEN o.purchased_at >= ${new Date(now.getTime() - 24 * 60 * 60 * 1000)} THEN oi.quantity ELSE 0 END), 0) AS last24h,
        COALESCE(SUM(CASE WHEN o.purchased_at >= ${new Date(now.getTime() - 48 * 60 * 60 * 1000)} AND o.purchased_at < ${new Date(now.getTime() - 24 * 60 * 60 * 1000)} THEN oi.quantity ELSE 0 END), 0) AS prior24h
      FROM ticket_orders o
      JOIN ticket_order_items oi ON oi.order_id = o.id
      WHERE o.status = 'paid' AND o.event_id IN (${sql.join(eventIds, sql`, `)})
      GROUP BY o.event_id
    `);
    for (const r of rowsOf<{ event_id: number; last24h: number | string; prior24h: number | string }>(velocityResult)) {
      const last24h = Number(r.last24h), prior24h = Number(r.prior24h);
      velocityByEvent.set(Number(r.event_id), { last24h, prior24h, trend: classifyTrend(last24h, prior24h) });
    }
  }

  const rankingRows = rowsOf<{ event_id: number; event_name: string; venue_id: number | null; venue_name: string | null; starts_at: string }>(rankingResult);
  const seen = new Set<number>();
  const rows: EventPerformanceRow[] = [];
  for (const r of rankingRows) {
    const eventId = Number(r.event_id);
    if (seen.has(eventId)) continue;
    seen.add(eventId);
    const revenue = revenueByEvent.get(eventId) ?? { ordersCount: 0, ticketRevenueCents: 0, ticketTokensPromotionalValueCents: 0 };
    const attendanceCount = attendanceByEvent.get(eventId) ?? 0;
    const eligibleTickets = eligibleByEvent.get(eventId) ?? 0;
    rows.push({
      eventId, eventName: r.event_name, venueId: r.venue_id, venueName: r.venue_name, startsAt: String(r.starts_at),
      ticketsSold: ticketsByEvent.get(eventId) ?? 0,
      ordersCount: revenue.ordersCount,
      attendanceCount, eligibleTickets,
      attendanceRatePct: eligibleTickets > 0 ? Math.round((attendanceCount / eligibleTickets) * 1000) / 10 : null,
      ticketRevenueCents: revenue.ticketRevenueCents,
      ticketTokensPromotionalValueCents: revenue.ticketTokensPromotionalValueCents,
      ticketMoneyCollectedCents: revenue.ticketRevenueCents - revenue.ticketTokensPromotionalValueCents,
      velocity: velocityByEvent.get(eventId) ?? { last24h: 0, prior24h: 0, trend: "flat" },
    });
  }
  rows.sort((a, b) => b.ticketRevenueCents - a.ticketRevenueCents);

  const topEventId = rows.length > 0 ? rows[0].eventId : null;
  const trending = rows.filter(r => r.velocity.last24h > r.velocity.prior24h).sort((a, b) => (b.velocity.last24h - b.velocity.prior24h) - (a.velocity.last24h - a.velocity.prior24h))[0];
  const trendingEventId = trending?.eventId ?? null;

  const needsAttention = await computeNeedsAttention(ctx, db, now);

  return { rows, topEventId, trendingEventId, needsAttention: needsAttention.items, needsAttentionDataSufficient: needsAttention.sufficient };
}

async function computeNeedsAttention(ctx: DashboardFilterContext, db: AnyDbHandle, now: Date): Promise<{ items: NeedsAttentionEvent[]; sufficient: boolean }> {
  const communityCond = ctx.communityId != null ? sql`AND e.id IN (SELECT event_id FROM community_events WHERE community_id = ${ctx.communityId})` : sql``;
  const horizon = new Date(now.getTime() + NEEDS_ATTENTION_DAYS_AHEAD * 24 * 60 * 60 * 1000);

  const upcomingResult = await db.execute(sql`
    SELECT e.id AS event_id, e.name AS event_name, e.starts_at AS starts_at
    FROM events e
    WHERE e.status = 'active' AND e.starts_at >= ${now} AND e.starts_at <= ${horizon} ${communityCond}
  `);
  const upcoming = rowsOf<{ event_id: number; event_name: string; starts_at: string }>(upcomingResult);
  if (upcoming.length < 2) return { items: [], sufficient: false };

  const eventIds = upcoming.map(r => Number(r.event_id));
  const salesResult = await db.execute(sql`
    SELECT o.event_id AS event_id, COALESCE(SUM(oi.quantity), 0) AS tickets_sold, MIN(o.purchased_at) AS first_sale_at
    FROM ticket_orders o
    JOIN ticket_order_items oi ON oi.order_id = o.id
    WHERE o.status = 'paid' AND o.event_id IN (${sql.join(eventIds, sql`, `)})
    GROUP BY o.event_id
  `);
  const salesByEvent = new Map<number, { ticketsSold: number; firstSaleAt: Date | null }>();
  for (const r of rowsOf<{ event_id: number; tickets_sold: number | string; first_sale_at: string | null }>(salesResult)) {
    salesByEvent.set(Number(r.event_id), { ticketsSold: Number(r.tickets_sold), firstSaleAt: r.first_sale_at ? new Date(r.first_sale_at) : null });
  }

  const velocities = upcoming.map(r => {
    const sales = salesByEvent.get(Number(r.event_id));
    if (!sales || !sales.firstSaleAt || sales.ticketsSold === 0) return 0;
    const daysSinceFirstSale = Math.max(1, Math.floor((now.getTime() - sales.firstSaleAt.getTime()) / (1000 * 60 * 60 * 24)));
    return sales.ticketsSold / daysSinceFirstSale;
  });
  const medianVelocity = median(velocities);

  const items: NeedsAttentionEvent[] = [];
  upcoming.forEach((r, idx) => {
    const eventId = Number(r.event_id);
    const startsAt = new Date(r.starts_at);
    const daysUntilEvent = Math.max(0, Math.ceil((startsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    const sales = salesByEvent.get(eventId);
    const ticketsSoldAllTime = sales?.ticketsSold ?? 0;
    const velocityPerDay = Math.round(velocities[idx] * 100) / 100;

    if (ticketsSoldAllTime === 0 && daysUntilEvent <= ZERO_SALES_ALERT_DAYS_AHEAD) {
      items.push({ eventId, eventName: r.event_name, startsAt: String(r.starts_at), daysUntilEvent, ticketsSoldAllTime, velocityPerDay, reason: "zero_sales_close_to_event" });
      return;
    }
    if (medianVelocity > 0 && velocities[idx] < medianVelocity * LOW_VELOCITY_RATIO) {
      items.push({ eventId, eventName: r.event_name, startsAt: String(r.starts_at), daysUntilEvent, ticketsSoldAllTime, velocityPerDay, reason: "velocity_below_comparable_median" });
    }
  });

  return { items, sufficient: true };
}

/**
 * Fase 14 (spec §21 "AI Executive Brief", "Esta noche hay N eventos
 * activos") — a diferencia del ranking de arriba (revenue de PEDIDOS en el
 * rango), esto cuenta eventos cuyo `starts_at` cae DENTRO del rango
 * filtrado — la pregunta real de "cuántos eventos hay hoy", no "cuántos
 * eventos vendieron algo hoy". Se usa solo cuando el router ya resolvió
 * `ctx` al rango operativo de "hoy" — nunca se etiqueta como "hoy" un
 * conteo de un rango distinto.
 */
export async function countEventsStartingInRange(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<number> {
  const communityJoin = ctx.communityId != null
    ? sql`AND e.id IN (SELECT event_id FROM community_events WHERE community_id = ${ctx.communityId})`
    : sql``;
  const result = await db.execute(sql`
    SELECT COUNT(*) AS n FROM events e
    WHERE e.starts_at >= ${ctx.from} AND e.starts_at < ${ctx.to} AND e.status = 'active'
    ${communityJoin}
  `);
  const rows = (result as unknown as [Array<{ n: number | string }>])[0] ?? [];
  return Number(rows[0]?.n ?? 0);
}
