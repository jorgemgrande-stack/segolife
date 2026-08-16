/**
 * commandCenterRetention.test.ts — Fase 14, spec §15/§40 (retención,
 * primera vez vs recurrente, división por cero, filtro de comunidad).
 */
import { describe, it, expect, vi } from "vitest";
import { getRetentionSnapshot } from "./commandCenterRetention";
import type { DashboardFilterContext } from "./dashboardFilters";

function fakeExecuteDb(rows: unknown[]) {
  const execute = vi.fn().mockResolvedValueOnce([rows, []]);
  return { execute };
}

const CTX: DashboardFilterContext = { communityId: null, from: new Date("2026-08-08T00:00:00.000Z"), to: new Date("2026-08-15T00:00:00.000Z"), rangeLabel: "7d" };

describe("getRetentionSnapshot", () => {
  it("calcula returningRatePct y avgActiveDaysPerStudent correctamente en el caso normal", async () => {
    const db = fakeExecuteDb([{ active_students: 100, first_time: 30, returning: 70, total_active_days: 250, multi_venue_students: 12 }]);
    const snapshot = await getRetentionSnapshot(CTX, db as never);
    expect(snapshot.activeStudents).toBe(100);
    expect(snapshot.firstTimeInPeriod).toBe(30);
    expect(snapshot.returningInPeriod).toBe(70);
    expect(snapshot.returningRatePct).toBe(70);
    expect(snapshot.avgActiveDaysPerStudent).toBe(2.5);
    expect(snapshot.multiVenueStudents).toBe(12);
  });

  it("con 0 estudiantes activos, nunca división por cero — returningRatePct y avgActiveDaysPerStudent son null, no NaN", async () => {
    const db = fakeExecuteDb([{ active_students: 0, first_time: 0, returning: 0, total_active_days: 0, multi_venue_students: 0 }]);
    const snapshot = await getRetentionSnapshot(CTX, db as never);
    expect(snapshot.returningRatePct).toBeNull();
    expect(snapshot.avgActiveDaysPerStudent).toBeNull();
    expect(Number.isNaN(snapshot.returningRatePct as unknown as number)).toBe(false);
  });

  it("dataset vacío (sin fila agregada) se trata como todo-cero, nunca lanza", async () => {
    const db = fakeExecuteDb([]);
    const snapshot = await getRetentionSnapshot(CTX, db as never);
    expect(snapshot.activeStudents).toBe(0);
    expect(snapshot.returningRatePct).toBeNull();
  });

  it("100% recurrentes (sin nuevos) -> returningRatePct 100", async () => {
    const db = fakeExecuteDb([{ active_students: 50, first_time: 0, returning: 50, total_active_days: 50, multi_venue_students: 0 }]);
    const snapshot = await getRetentionSnapshot(CTX, db as never);
    expect(snapshot.returningRatePct).toBe(100);
    expect(snapshot.firstTimeInPeriod).toBe(0);
  });

  it("100% nuevos (sin recurrentes) -> returningRatePct 0", async () => {
    const db = fakeExecuteDb([{ active_students: 20, first_time: 20, returning: 0, total_active_days: 20, multi_venue_students: 0 }]);
    const snapshot = await getRetentionSnapshot(CTX, db as never);
    expect(snapshot.returningRatePct).toBe(0);
  });

  it("aplica el filtro de comunidad dentro de la CTE cuando communityId no es null", async () => {
    const db = fakeExecuteDb([{ active_students: 1, first_time: 1, returning: 0, total_active_days: 1, multi_venue_students: 0 }]);
    await getRetentionSnapshot({ ...CTX, communityId: 3 }, db as never);
    const queryText = JSON.stringify(db.execute.mock.calls[0][0]);
    expect(queryText).toContain("community_id");
  });

  it("sin comunidad, no añade la subconsulta de user_communities", async () => {
    const db = fakeExecuteDb([{ active_students: 1, first_time: 1, returning: 0, total_active_days: 1, multi_venue_students: 0 }]);
    await getRetentionSnapshot(CTX, db as never);
    const queryText = JSON.stringify(db.execute.mock.calls[0][0]);
    expect(queryText).not.toContain("community_id");
  });
});
