/**
 * commandCenterOverview.test.ts — KPI Strip principal (spec §7): 6 KPIs,
 * todo agregado en SQL, expiración perezosa de Benefits, liveStatus refleja
 * tokenEngine.ts:LIVE_LOYALTY_ENABLED (SegoTokens Live Activation, spec §19).
 *
 * El fake `db` despacha por IDENTIDAD REAL de la tabla pasada a `.from()`
 * (mismo criterio que historicalIdentityService.test.ts) — nunca por un
 * índice global de orden de llamada, que sería frágil: las 6 funciones del
 * archivo corren concurrentemente vía Promise.all y su intercalado real no
 * está garantizado entre sí (sí lo está DENTRO de cada una, que es lo único
 * de lo que depende este fake: 2 llamadas a `users` en el mismo orden literal
 * del array de su propio Promise.all, etc.).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { users, ticketOrders, tokenLedger, tokenWallets, userBenefits, eventAttendance } from "../../../drizzle/schema";

const { mockCountActiveStudents } = vi.hoisted(() => ({ mockCountActiveStudents: vi.fn() }));
vi.mock("./activitySignals", () => ({ countActiveStudents: (...args: unknown[]) => mockCountActiveStudents(...args) }));

import { getOverviewSnapshot } from "./commandCenterOverview";
import type { DashboardFilterContext } from "./dashboardFilters";
import { LIVE_LOYALTY_ENABLED } from "../tokens/tokenEngine";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const CTX: DashboardFilterContext = { communityId: null, from: new Date("2026-07-15T00:00:00.000Z"), to: NOW, rangeLabel: "30d" };

function fakeDb(opts: {
  usersRowsQueue?: unknown[][];
  ticketOrdersRows?: unknown[];
  tokenLedgerRowsQueue?: unknown[][];
  tokenWalletsRows?: unknown[];
  userBenefitsRowsQueue?: unknown[][];
  eventAttendanceRows?: unknown[];
  executeQueue?: unknown[][];
}) {
  const usersQueue = [...(opts.usersRowsQueue ?? [[], []])];
  const tokenLedgerQueue = [...(opts.tokenLedgerRowsQueue ?? [[{ s: 0 }], [{ s: 0 }]])];
  const userBenefitsQueue = [...(opts.userBenefitsRowsQueue ?? [[{ n: 0 }], [{ n: 0 }], [{ n: 0 }], [{ n: 0 }]])];
  const executeQueue = [...(opts.executeQueue ?? [[], []])];

  const db = {
    select: (_cols?: unknown) => ({
      from: (table: unknown) => {
        const rowsFor = () => {
          if (table === users) return usersQueue.shift() ?? [];
          if (table === ticketOrders) return opts.ticketOrdersRows ?? [];
          if (table === tokenLedger) return tokenLedgerQueue.shift() ?? [{ s: 0 }];
          if (table === tokenWallets) return opts.tokenWalletsRows ?? [{ s: 0 }];
          if (table === userBenefits) return userBenefitsQueue.shift() ?? [{ n: 0 }];
          if (table === eventAttendance) return opts.eventAttendanceRows ?? [];
          return [];
        };
        return {
          innerJoin: (_t: unknown) => ({
            where: (_cond?: unknown) => ({
              groupBy: async () => rowsFor(),
              then: (resolve: (v: unknown[]) => void) => Promise.resolve(rowsFor()).then(resolve),
            }),
          }),
          where: (_cond?: unknown) => ({
            groupBy: async () => rowsFor(),
            then: (resolve: (v: unknown[]) => void) => Promise.resolve(rowsFor()).then(resolve),
          }),
        };
      },
    }),
    execute: vi.fn(async () => {
      const next = executeQueue.shift() ?? [];
      return [next, []];
    }),
  };
  return db;
}

describe("getOverviewSnapshot", () => {
  beforeEach(() => {
    mockCountActiveStudents.mockReset();
  });

  it("compone los 6 KPIs reales sin lanzar, con liveStatus real en SegoTokens (SegoTokens Live Activation)", async () => {
    mockCountActiveStudents.mockResolvedValue(10);
    const db = fakeDb({
      usersRowsQueue: [[{ n: 500 }], [{ n: 20 }]],
      ticketOrdersRows: [{ status: "paid", n: 30, revenue: 150000 }],
      tokenLedgerRowsQueue: [[{ s: 800 }], [{ s: 300 }]],
      tokenWalletsRows: [{ s: 5000 }],
      executeQueue: [[{ n: 25 }], [{ n: 3 }]],
    });
    const snapshot = await getOverviewSnapshot(CTX, db as never);
    expect(snapshot.students).toEqual({ total: 500, newInPeriod: 20 });
    expect(snapshot.tickets.paid).toBe(30);
    expect(snapshot.tickets.ticketRevenueCents).toBe(150000);
    expect(snapshot.segoTokens).toEqual({ earnedInPeriod: 800, spentInPeriod: 300, circulatingBalance: 5000, liveStatus: LIVE_LOYALTY_ENABLED ? "LIVE_ACTIVE" : "LIVE_LOCKED" });
    expect(snapshot.attendance.eligibleTickets).toBe(25);
    expect(snapshot.attendance.unresolvedHistoricalCount).toBe(3);
  });

  it("Tickets: separa paid/cancelled/refunded correctamente desde el GROUP BY status, y paid por provider (SEGOLIFE — Native Ticket Sales, spec §28)", async () => {
    mockCountActiveStudents.mockResolvedValue(0);
    const db = fakeDb({
      ticketOrdersRows: [
        { status: "paid", provider: "segolife", n: 4, revenue: 20000 },
        { status: "paid", provider: "fourvenues", n: 6, revenue: 30000 },
        { status: "cancelled", n: 2, revenue: 0 },
        { status: "failed", n: 1, revenue: 0 },
        { status: "refunded", n: 3, revenue: 0 },
        { status: "partially_refunded", n: 1, revenue: 0 },
      ],
    });
    const snapshot = await getOverviewSnapshot(CTX, db as never);
    expect(snapshot.tickets).toEqual({
      ordersInPeriod: 17, paid: 10, cancelled: 3, refunded: 4, ticketRevenueCents: 50000,
      nativePaid: 4, nativeRevenueCents: 20000, fourvenuesPaid: 6, fourvenuesRevenueCents: 30000,
    });
  });

  it("Attendance: attendanceRatePct es null sin tickets elegibles, nunca división por cero", async () => {
    mockCountActiveStudents.mockResolvedValue(0);
    const db = fakeDb({});
    const snapshot = await getOverviewSnapshot(CTX, db as never);
    expect(snapshot.attendance.attendanceRatePct).toBeNull();
    expect(snapshot.attendance.eligibleTickets).toBe(0);
  });

  it("Benefits: expiración perezosa — expired cuenta status='expired' OR (active AND validUntil vencido)", async () => {
    mockCountActiveStudents.mockResolvedValue(0);
    const db = fakeDb({
      userBenefitsRowsQueue: [[{ n: 20 }], [{ n: 5 }], [{ n: 8 }], [{ n: 7 }]],
    });
    const snapshot = await getOverviewSnapshot(CTX, db as never);
    expect(snapshot.benefits).toEqual({ generated: 20, available: 5, redeemed: 8, expired: 7, redemptionRatePct: 40 });
  });

  it("Active: reutiliza countActiveStudents para period/DAU/WAU/MAU — nunca redefine 'actividad' aquí", async () => {
    mockCountActiveStudents.mockResolvedValueOnce(50).mockResolvedValueOnce(5).mockResolvedValueOnce(20).mockResolvedValueOnce(45);
    const db = fakeDb({});
    const snapshot = await getOverviewSnapshot(CTX, db as never);
    expect(snapshot.active).toEqual({ activeInPeriod: 50, dau: 5, wau: 20, mau: 45 });
    expect(mockCountActiveStudents).toHaveBeenCalledTimes(4);
  });
});
