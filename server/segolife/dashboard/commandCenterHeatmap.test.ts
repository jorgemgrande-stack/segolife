/**
 * commandCenterHeatmap.test.ts — Fase 14, spec §16/§40. Verifica bucketing
 * por hora/día de semana en Madrid-local (vía resolveMadridMoment real, no
 * reimplementado), truncamiento defensivo, y que solo se devuelven conteos
 * agregados (nunca filas individuales).
 */
import { describe, it, expect, vi } from "vitest";
import { getHeatmapSnapshot } from "./commandCenterHeatmap";
import type { DashboardFilterContext } from "./dashboardFilters";
import { resolveMadridMoment } from "../tokens/tokenScheduleService";

function fakeExecuteDb(queue: unknown[][]) {
  const execute = vi.fn();
  for (const rows of queue) execute.mockResolvedValueOnce([rows, []]);
  return { execute };
}

const CTX: DashboardFilterContext = { communityId: null, from: new Date("2026-08-01T00:00:00.000Z"), to: new Date("2026-08-15T00:00:00.000Z"), rangeLabel: "30d" };

describe("getHeatmapSnapshot", () => {
  it("agrupa timestamps reales por hora y día de semana Madrid-local (vía resolveMadridMoment, sin reimplementar la conversión)", async () => {
    const ts1 = new Date("2026-08-14T22:30:00.000Z"); // verano CEST +2
    const ts2 = new Date("2026-08-14T22:45:00.000Z"); // misma hora Madrid que ts1
    const expected1 = resolveMadridMoment(ts1);
    const expectedHour = Number(expected1.time.split(":")[0]);

    const db = fakeExecuteDb([
      [{ ts: ts1 }, { ts: ts2 }], // event_attendance
      [], // commerce_transactions
    ]);
    const snapshot = await getHeatmapSnapshot(CTX, db as never);

    expect(snapshot.attendance.sampleSize).toBe(2);
    const bucket = snapshot.attendance.byHour.find(b => b.hour === expectedHour);
    expect(bucket?.count).toBe(2);
    const weekdayBucket = snapshot.attendance.byWeekday.find(b => b.weekday === expected1.dayOfWeek);
    expect(weekdayBucket?.count).toBe(2);
  });

  it("24 buckets de hora y 7 de día de semana siempre presentes, incluso en 0 (sin huecos)", async () => {
    const db = fakeExecuteDb([[], []]);
    const snapshot = await getHeatmapSnapshot(CTX, db as never);
    expect(snapshot.attendance.byHour).toHaveLength(24);
    expect(snapshot.attendance.byWeekday).toHaveLength(7);
    expect(snapshot.attendance.byHour.every(b => b.count === 0)).toBe(true);
    expect(snapshot.attendance.sampleSize).toBe(0);
    expect(snapshot.attendance.truncated).toBe(false);
  });

  it("commerce y attendance se calculan por separado, nunca mezclados", async () => {
    const attendanceTs = new Date("2026-08-05T20:00:00.000Z");
    const commerceTs = new Date("2026-08-06T21:00:00.000Z");
    const db = fakeExecuteDb([[{ ts: attendanceTs }], [{ ts: commerceTs }, { ts: commerceTs }]]);
    const snapshot = await getHeatmapSnapshot(CTX, db as never);
    expect(snapshot.attendance.sampleSize).toBe(1);
    expect(snapshot.commerce.sampleSize).toBe(2);
  });

  it("trunca defensivamente por encima del límite y marca truncated=true", async () => {
    const rows = Array.from({ length: 5001 }, () => ({ ts: new Date("2026-08-05T20:00:00.000Z") }));
    const db = fakeExecuteDb([rows, []]);
    const snapshot = await getHeatmapSnapshot(CTX, db as never);
    expect(snapshot.attendance.sampleSize).toBe(5000);
    expect(snapshot.attendance.truncated).toBe(true);
  });

  it("nunca devuelve filas individuales ni identificadores de Student — solo conteos agregados por hora/día", async () => {
    const db = fakeExecuteDb([[{ ts: new Date() }], []]);
    const snapshot = await getHeatmapSnapshot(CTX, db as never);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/userId|user_id|studentId/i);
  });

  it("aplica el filtro de comunidad a ambas series (attendance y commerce)", async () => {
    const db = fakeExecuteDb([[], []]);
    await getHeatmapSnapshot({ ...CTX, communityId: 3 }, db as never);
    expect(db.execute).toHaveBeenCalledTimes(2);
    for (const call of db.execute.mock.calls) {
      expect(JSON.stringify(call[0])).toContain("community_id");
    }
  });

  it("filtra commerce_transactions solo a estados confirmados/reembolsados, nunca pending/cancelled", async () => {
    const db = fakeExecuteDb([[], []]);
    await getHeatmapSnapshot(CTX, db as never);
    const commerceCallSql = JSON.stringify(db.execute.mock.calls[1][0]);
    expect(commerceCallSql).toContain("confirmed");
    expect(commerceCallSql).not.toContain("pending");
  });
});
