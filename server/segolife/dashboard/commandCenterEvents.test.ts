/**
 * commandCenterEvents.test.ts — Event Performance: ranking sin doble conteo
 * de revenue, velocity (24h vs 24h previas), TOP EVENT/TRENDING, y las reglas
 * objetivas de NEEDS ATTENTION (nunca capacity/occupancy — spec §11).
 */
import { describe, it, expect, vi } from "vitest";
import { getEventPerformance, countEventsStartingInRange } from "./commandCenterEvents";
import type { DashboardFilterContext } from "./dashboardFilters";

function fakeExecuteDb(queue: unknown[][]) {
  const execute = vi.fn();
  for (const rows of queue) execute.mockResolvedValueOnce([rows, []]);
  return { execute };
}

const NOW = new Date("2026-08-14T12:00:00.000Z");
const CTX: DashboardFilterContext = { communityId: null, from: new Date("2026-07-15T00:00:00.000Z"), to: NOW, rangeLabel: "30d" };

describe("getEventPerformance — ranking", () => {
  it("no duplica revenue cuando una orden tiene varias líneas de ticket (agregación por orden, no por item)", async () => {
    const db = fakeExecuteDb([
      // ranking: 1 orden de 20000 cents para el evento 1
      [{ event_id: 1, event_name: "After Party Casanova", venue_id: 10, venue_name: "Casanova", starts_at: "2026-08-20T22:00:00.000Z", orders_count: 1, ticket_revenue_cents: 20000 }],
      // tickets: la misma orden tenía 2 líneas -> 5 tickets en total
      [{ event_id: 1, tickets_sold: 5 }],
      // attendance
      [],
      // eligible
      [],
      // velocity
      [{ event_id: 1, last24h: 0, prior24h: 0 }],
      // needsAttention: upcoming (menos de 2 -> insuficiente, no se consulta más)
      [{ event_id: 1, event_name: "After Party Casanova", starts_at: "2026-08-20T22:00:00.000Z" }],
    ]);
    const snapshot = await getEventPerformance(CTX, db as never, NOW);
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].ticketRevenueCents).toBe(20000);
    expect(snapshot.rows[0].ticketsSold).toBe(5);
    expect(snapshot.rows[0].ordersCount).toBe(1);
    expect(snapshot.needsAttentionDataSufficient).toBe(false);
    expect(snapshot.needsAttention).toEqual([]);
  });

  it("TOP EVENT es el de mayor revenue; TRENDING es el de mayor ganancia absoluta 24h vs 24h previas", async () => {
    const db = fakeExecuteDb([
      [
        { event_id: 1, event_name: "Evento A", venue_id: 10, venue_name: "Casanova", starts_at: "2026-08-20T22:00:00.000Z", orders_count: 3, ticket_revenue_cents: 50000 },
        { event_id: 2, event_name: "Evento B", venue_id: 11, venue_name: "Tía Felisa", starts_at: "2026-08-22T22:00:00.000Z", orders_count: 1, ticket_revenue_cents: 10000 },
      ],
      [{ event_id: 1, tickets_sold: 10 }, { event_id: 2, tickets_sold: 3 }],
      [], [],
      [{ event_id: 1, last24h: 2, prior24h: 1 }, { event_id: 2, last24h: 3, prior24h: 0 }],
      [], // upcoming vacío -> insuficiente
    ]);
    const snapshot = await getEventPerformance(CTX, db as never, NOW);
    expect(snapshot.topEventId).toBe(1); // más revenue
    expect(snapshot.trendingEventId).toBe(2); // ganancia absoluta 3 > 1
  });

  it("attendanceRatePct es null cuando no hay tickets elegibles (nunca división por cero)", async () => {
    const db = fakeExecuteDb([
      [{ event_id: 1, event_name: "Evento sin tickets elegibles", venue_id: null, venue_name: null, starts_at: "2026-08-20T22:00:00.000Z", orders_count: 1, ticket_revenue_cents: 5000 }],
      [{ event_id: 1, tickets_sold: 1 }],
      [], [],
      [{ event_id: 1, last24h: 0, prior24h: 0 }],
      [],
    ]);
    const snapshot = await getEventPerformance(CTX, db as never, NOW);
    expect(snapshot.rows[0].attendanceRatePct).toBeNull();
  });

  it("sin eventos en el periodo -> ranking vacío, topEventId/trendingEventId null", async () => {
    const db = fakeExecuteDb([[], [], []]);
    const snapshot = await getEventPerformance(CTX, db as never, NOW);
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.topEventId).toBeNull();
    expect(snapshot.trendingEventId).toBeNull();
  });
});

describe("getEventPerformance — NEEDS ATTENTION (regla objetiva, nunca capacity)", () => {
  it("evento a &lt;=7 días con CERO ventas -> needs attention por 'zero_sales_close_to_event'", async () => {
    const db = fakeExecuteDb([
      [], [], // ranking + tickets (sin ventas en el periodo de filtro)
      // upcoming: 2 eventos comparables, uno de ellos sin ninguna venta histórica
      [
        { event_id: 1, event_name: "Evento sin ventas", starts_at: "2026-08-18T22:00:00.000Z" }, // 4 días
        { event_id: 2, event_name: "Evento con ventas normales", starts_at: "2026-08-25T22:00:00.000Z" },
      ],
      // sales: solo el evento 2 tiene ventas históricas
      [{ event_id: 2, tickets_sold: 20, first_sale_at: "2026-08-04T00:00:00.000Z" }],
    ]);
    const snapshot = await getEventPerformance(CTX, db as never, NOW);
    expect(snapshot.needsAttentionDataSufficient).toBe(true);
    const flagged = snapshot.needsAttention.find(n => n.eventId === 1);
    expect(flagged?.reason).toBe("zero_sales_close_to_event");
  });

  it("evento con velocidad muy por debajo de la mediana de comparables -> needs attention por 'velocity_below_comparable_median'", async () => {
    const db = fakeExecuteDb([
      [], [],
      [
        { event_id: 1, event_name: "Evento lento", starts_at: "2026-08-25T22:00:00.000Z" },
        { event_id: 2, event_name: "Evento normal 1", starts_at: "2026-08-26T22:00:00.000Z" },
        { event_id: 3, event_name: "Evento normal 2", starts_at: "2026-08-27T22:00:00.000Z" },
      ],
      [
        { event_id: 1, tickets_sold: 1, first_sale_at: "2026-08-04T00:00:00.000Z" }, // 10 días -> 0.1/día
        { event_id: 2, tickets_sold: 20, first_sale_at: "2026-08-04T00:00:00.000Z" }, // 2/día
        { event_id: 3, tickets_sold: 18, first_sale_at: "2026-08-04T00:00:00.000Z" }, // 1.8/día
      ],
    ]);
    const snapshot = await getEventPerformance(CTX, db as never, NOW);
    const flagged = snapshot.needsAttention.find(n => n.eventId === 1);
    expect(flagged?.reason).toBe("velocity_below_comparable_median");
    expect(snapshot.needsAttention.some(n => n.eventId === 2)).toBe(false);
    expect(snapshot.needsAttention.some(n => n.eventId === 3)).toBe(false);
  });

  it("con menos de 2 eventos próximos comparables, NUNCA marca needs attention (evita falsos positivos por falta de datos)", async () => {
    const db = fakeExecuteDb([
      [], [],
      [{ event_id: 1, event_name: "Único evento próximo", starts_at: "2026-08-15T22:00:00.000Z" }],
    ]);
    const snapshot = await getEventPerformance(CTX, db as never, NOW);
    expect(snapshot.needsAttentionDataSufficient).toBe(false);
    expect(snapshot.needsAttention).toEqual([]);
  });

  it("nunca hace referencia a capacity/occupancy en ninguna forma del resultado (spec §11)", async () => {
    const db = fakeExecuteDb([
      [{ event_id: 1, event_name: "Evento", venue_id: 1, venue_name: "Venue", starts_at: "2026-08-20T22:00:00.000Z", orders_count: 1, ticket_revenue_cents: 1000 }],
      [{ event_id: 1, tickets_sold: 1 }],
      [], [],
      [{ event_id: 1, last24h: 0, prior24h: 0 }],
      [],
    ]);
    const snapshot = await getEventPerformance(CTX, db as never, NOW);
    const serialized = JSON.stringify(snapshot);
    expect(serialized.toLowerCase()).not.toContain("capacity");
    expect(serialized.toLowerCase()).not.toContain("occupancy");
  });
});

describe("countEventsStartingInRange — Fase 14 spec §21 ('eventos activos hoy', no confundir con ventas del día)", () => {
  it("cuenta eventos por starts_at dentro del rango, no por actividad de pedidos", async () => {
    const db = fakeExecuteDb([[{ n: 3 }]]);
    const n = await countEventsStartingInRange(CTX, db as never);
    expect(n).toBe(3);
  });

  it("0 eventos -> 0, nunca error", async () => {
    const db = fakeExecuteDb([[]]);
    const n = await countEventsStartingInRange(CTX, db as never);
    expect(n).toBe(0);
  });

  it("solo cuenta eventos con status='active'", async () => {
    const db = fakeExecuteDb([[{ n: 0 }]]);
    await countEventsStartingInRange(CTX, db as never);
    expect(JSON.stringify(db.execute.mock.calls[0][0])).toContain("active");
  });

  it("aplica filtro de comunidad vía community_events cuando communityId no es null", async () => {
    const db = fakeExecuteDb([[{ n: 0 }]]);
    await countEventsStartingInRange({ ...CTX, communityId: 3 }, db as never);
    expect(JSON.stringify(db.execute.mock.calls[0][0])).toContain("community_events");
  });
});
