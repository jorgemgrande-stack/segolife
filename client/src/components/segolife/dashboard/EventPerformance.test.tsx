/**
 * EventPerformance.test.tsx — Deep Navigation (Production Polish Gate §15):
 * cada evento enlaza a su ficha administrativa real por ID Segolife interno
 * (nunca el ID externo de Fourvenues), y cada venue a su ficha real.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { dashboard: { getEventPerformance: { useQuery: mockQuery } } } }));

import { EventPerformance } from "./EventPerformance";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("EventPerformance — deep navigation", () => {
  it("cada fila enlaza a /admin/events/:id (ID interno Segolife, spec §15) y su venue a /admin/venues/:id", () => {
    mockQuery.mockReturnValue({
      data: {
        rows: [{
          eventId: 42, eventName: "After Party Casanova", venueId: 10, venueName: "Casanova", startsAt: "2026-08-20T22:00:00.000Z",
          ticketsSold: 50, ordersCount: 10, attendanceCount: 5, eligibleTickets: 10, attendanceRatePct: 50,
          ticketRevenueCents: 100000, velocity: { last24h: 5, prior24h: 2, trend: "up" as const },
        }],
        topEventId: 42, trendingEventId: 42, needsAttention: [], needsAttentionDataSufficient: true,
      },
      isLoading: false, error: null,
    });
    render(<EventPerformance filters={{}} />);
    expect(screen.getByText("After Party Casanova").closest("a")).toHaveAttribute("href", "/admin/events/42");
    expect(screen.getByText("Casanova").closest("a")).toHaveAttribute("href", "/admin/venues/10");
  });

  it("un evento NEEDS ATTENTION también enlaza a su ficha real por ID", () => {
    mockQuery.mockReturnValue({
      data: {
        rows: [], topEventId: null, trendingEventId: null, needsAttentionDataSufficient: true,
        needsAttention: [{ eventId: 7, eventName: "Tankers", startsAt: "2026-08-16T22:00:00.000Z", daysUntilEvent: 2, ticketsSoldAllTime: 0, velocityPerDay: 0, reason: "zero_sales_close_to_event" as const }],
      },
      isLoading: false, error: null,
    });
    render(<EventPerformance filters={{}} />);
    expect(screen.getByText("Tankers").closest("a")).toHaveAttribute("href", "/admin/events/7");
    expect(screen.getByText(/0 tickets vendidos, empieza en 2d/)).toBeInTheDocument();
  });
});
