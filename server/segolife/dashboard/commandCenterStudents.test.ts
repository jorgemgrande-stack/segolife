/**
 * commandCenterStudents.test.ts — Student Intelligence: verifica que la
 * clasificación por SQL agregado reproduce EXACTAMENTE las mismas reglas
 * que studentIntelligenceService.computeSegment() (spec §10) para los casos
 * frontera de cada segmento, y que MULTI-VENUE se computa como dimensión
 * aparte (no mutuamente excluyente).
 */
import { describe, it, expect, vi } from "vitest";
import { getStudentIntelligence } from "./commandCenterStudents";

/** Cola FIFO de resultados de `db.execute` — mismo orden exacto en que el código real los invoca: studentRows, spendResult, luego (en paralelo mediante Promise.all, pero iniciados en este orden) lastActivity, frequency, venues. */
function fakeExecuteDb(queue: unknown[][]) {
  const execute = vi.fn();
  for (const rows of queue) execute.mockResolvedValueOnce([rows, []]);
  return { execute };
}

const NOW = new Date("2026-08-14T12:00:00.000Z");

describe("getStudentIntelligence — clasificación (mismos umbrales que computeSegment)", () => {
  it("un Student registrado hace 5 días → 'new', independientemente de su actividad", async () => {
    const db = fakeExecuteDb([
      [{ user_id: 1, created_at: "2026-08-09T00:00:00.000Z", tokens_lifetime_earned: 0 }], // studentRows
      [], // spend
      [], // lastActivity
      [], // frequency
      [], // venues
    ]);
    const snapshot = await getStudentIntelligence(null, db as never, NOW);
    expect(snapshot.segments.find(s => s.key === "new")?.count).toBe(1);
    expect(snapshot.totalStudents).toBe(1);
  });

  it("sin ninguna actividad nunca registrada, fuera del periodo de gracia → 'dormant'", async () => {
    const db = fakeExecuteDb([
      [{ user_id: 1, created_at: "2026-01-01T00:00:00.000Z", tokens_lifetime_earned: 0 }],
      [], [], [], [],
    ]);
    const snapshot = await getStudentIntelligence(null, db as never, NOW);
    expect(snapshot.segments.find(s => s.key === "dormant")?.count).toBe(1);
  });

  it("última actividad hace 45 días (30 &lt; x &lt;= 60) → 'at_risk'", async () => {
    const db = fakeExecuteDb([
      [{ user_id: 1, created_at: "2026-01-01T00:00:00.000Z", tokens_lifetime_earned: 0 }],
      [],
      [{ user_id: 1, last_at: "2026-06-30T12:00:00.000Z" }], // hace 45 días
      [], [],
    ]);
    const snapshot = await getStudentIntelligence(null, db as never, NOW);
    expect(snapshot.segments.find(s => s.key === "at_risk")?.count).toBe(1);
  });

  it("gasto acumulado >= 200€ (2x el target) y actividad reciente → 'high_spend', gana sobre 'active'", async () => {
    const db = fakeExecuteDb([
      [{ user_id: 1, created_at: "2026-01-01T00:00:00.000Z", tokens_lifetime_earned: 0 }],
      [{ user_id: 1, total: 25000 }], // 250€
      [{ user_id: 1, last_at: "2026-08-13T00:00:00.000Z" }], // ayer
      [], [],
    ]);
    const snapshot = await getStudentIntelligence(null, db as never, NOW);
    expect(snapshot.segments.find(s => s.key === "high_spend")?.count).toBe(1);
    expect(snapshot.segments.find(s => s.key === "active")?.count).toBe(0);
  });

  it("tokens lifetime earned >= 200 (20x el target de loyalty) y actividad reciente → 'high_spend'", async () => {
    const db = fakeExecuteDb([
      [{ user_id: 1, created_at: "2026-01-01T00:00:00.000Z", tokens_lifetime_earned: 250 }],
      [],
      [{ user_id: 1, last_at: "2026-08-13T00:00:00.000Z" }],
      [], [],
    ]);
    const snapshot = await getStudentIntelligence(null, db as never, NOW);
    expect(snapshot.segments.find(s => s.key === "high_spend")?.count).toBe(1);
  });

  it("10+ eventos de actividad en 90 días y actividad hace <=14 días → 'highly_engaged'", async () => {
    const db = fakeExecuteDb([
      [{ user_id: 1, created_at: "2026-01-01T00:00:00.000Z", tokens_lifetime_earned: 0 }],
      [],
      [{ user_id: 1, last_at: "2026-08-10T00:00:00.000Z" }], // hace 4 días
      [{ user_id: 1, cnt: 12 }],
      [],
    ]);
    const snapshot = await getStudentIntelligence(null, db as never, NOW);
    expect(snapshot.segments.find(s => s.key === "highly_engaged")?.count).toBe(1);
  });

  it("actividad reciente sin cumplir ningún umbral especial → 'active' (fallback)", async () => {
    const db = fakeExecuteDb([
      [{ user_id: 1, created_at: "2026-01-01T00:00:00.000Z", tokens_lifetime_earned: 0 }],
      [],
      [{ user_id: 1, last_at: "2026-08-05T00:00:00.000Z" }], // hace 9 días
      [{ user_id: 1, cnt: 2 }],
      [],
    ]);
    const snapshot = await getStudentIntelligence(null, db as never, NOW);
    expect(snapshot.segments.find(s => s.key === "active")?.count).toBe(1);
  });

  it("MULTI-VENUE: se computa como dimensión aparte, no como segmento excluyente (spec §10)", async () => {
    const db = fakeExecuteDb([
      [{ user_id: 1, created_at: "2026-01-01T00:00:00.000Z", tokens_lifetime_earned: 0 }],
      [],
      [{ user_id: 1, last_at: "2026-08-13T00:00:00.000Z" }],
      [{ user_id: 1, cnt: 2 }],
      [{ user_id: 1, cnt: 3 }], // 3 venues distintos
    ]);
    const snapshot = await getStudentIntelligence(null, db as never, NOW);
    expect(snapshot.multiVenue.count).toBe(1);
    expect(snapshot.multiVenue.avgVenuesPerActiveStudent).toBe(3);
  });

  it("cada Student cuenta en EXACTAMENTE un segmento — la suma de counts es igual al total", async () => {
    const db = fakeExecuteDb([
      [
        { user_id: 1, created_at: "2026-08-09T00:00:00.000Z", tokens_lifetime_earned: 0 }, // new
        { user_id: 2, created_at: "2026-01-01T00:00:00.000Z", tokens_lifetime_earned: 0 }, // dormant (sin actividad)
        { user_id: 3, created_at: "2026-01-01T00:00:00.000Z", tokens_lifetime_earned: 0 }, // active
      ],
      [],
      [{ user_id: 3, last_at: "2026-08-13T00:00:00.000Z" }],
      [],
      [],
    ]);
    const snapshot = await getStudentIntelligence(null, db as never, NOW);
    const sum = snapshot.segments.reduce((s, seg) => s + seg.count, 0);
    expect(sum).toBe(snapshot.totalStudents);
    expect(snapshot.totalStudents).toBe(3);
  });

  it("sin ningún Student → todos los segmentos en 0, porcentajes en 0 (nunca división por cero)", async () => {
    const db = fakeExecuteDb([[], [], [], [], []]);
    const snapshot = await getStudentIntelligence(null, db as never, NOW);
    expect(snapshot.totalStudents).toBe(0);
    expect(snapshot.segments.every(s => s.count === 0 && s.populationPct === 0)).toBe(true);
    expect(snapshot.multiVenue.avgVenuesPerActiveStudent).toBeNull();
  });
});
