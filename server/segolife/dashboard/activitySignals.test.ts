/**
 * activitySignals.test.ts — verifica que cada función construye el SQL
 * esperado (contiene las tablas/columnas correctas, filtra por comunidad
 * solo cuando corresponde) y parsea correctamente el shape real de
 * `db.execute()` en este repo — `[rows, fields]`, confirmado en
 * server/routers.ts (`(result as any[][])[0]` es el array de filas).
 */
import { describe, it, expect, vi } from "vitest";
import {
  countActiveStudents, dailyActiveStudents, lastActivityByStudent,
  activityCountByStudentSince, distinctVenuesByStudent, activeStudentsByVenue,
} from "./activitySignals";

/** Aplana un fragmento `sql\`...\`` de drizzle-orm (queryChunks anidados) a texto plano legible, para poder aserir sobre su contenido sin acoplarse a los valores de los parámetros. */
function flattenSql(fragment: unknown): string {
  const chunks = (fragment as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks.map(c => {
    if (c && typeof c === "object" && "value" in (c as Record<string, unknown>)) {
      const v = (c as { value: unknown }).value;
      return Array.isArray(v) ? v.join("") : String(v);
    }
    if (c && typeof c === "object" && "queryChunks" in (c as Record<string, unknown>)) return flattenSql(c);
    return "?";
  }).join("");
}

function fakeExecuteDb(returnRows: unknown[]) {
  const execute = vi.fn().mockResolvedValue([returnRows, []]);
  return { execute } as unknown as { execute: ReturnType<typeof vi.fn> };
}

describe("countActiveStudents", () => {
  it("parsea correctamente el shape [rows, fields] y devuelve el número", async () => {
    const db = fakeExecuteDb([{ cnt: 42 }]);
    const result = await countActiveStudents(new Date("2026-08-01"), new Date("2026-08-14"), null, db as never);
    expect(result).toBe(42);
  });

  it("sin filas → 0, nunca NaN ni excepción", async () => {
    const db = fakeExecuteDb([]);
    const result = await countActiveStudents(new Date("2026-08-01"), new Date("2026-08-14"), null, db as never);
    expect(result).toBe(0);
  });

  it("communityId=null → el SQL generado NO incluye el JOIN de comunidad ('Todas')", async () => {
    const db = fakeExecuteDb([{ cnt: 1 }]);
    await countActiveStudents(new Date("2026-08-01"), new Date("2026-08-14"), null, db as never);
    const text = flattenSql(db.execute.mock.calls[0][0]);
    expect(text).not.toMatch(/JOIN user_communities/);
  });

  it("communityId=3 → el SQL generado SÍ incluye el JOIN real a user_communities (nunca inferido de venue)", async () => {
    const db = fakeExecuteDb([{ cnt: 1 }]);
    await countActiveStudents(new Date("2026-08-01"), new Date("2026-08-14"), 3, db as never);
    const text = flattenSql(db.execute.mock.calls[0][0]);
    expect(text).toMatch(/JOIN user_communities/);
  });

  it("la unión SQL incluye las 10 fuentes reales de señal genuina, y NUNCA notifications/student_profiles", async () => {
    const db = fakeExecuteDb([{ cnt: 1 }]);
    await countActiveStudents(new Date("2026-08-01"), new Date("2026-08-14"), null, db as never);
    const text = flattenSql(db.execute.mock.calls[0][0]);
    for (const table of ["ticket_orders", "event_attendance", "commerce_transactions", "consumption_qr_codes", "token_ledger", "user_benefits", "community_responses", "community_supports", "community_student_proposals", "student_login_events"]) {
      expect(text).toContain(table);
    }
    expect(text).not.toMatch(/\bnotifications\b/);
    expect(text).not.toMatch(/student_profiles/);
  });
});

describe("dailyActiveStudents", () => {
  it("mapea day/cnt a { date, activeCount }, ordenado por la propia query", async () => {
    const db = fakeExecuteDb([{ day: "2026-08-01", cnt: 5 }, { day: "2026-08-02", cnt: 8 }]);
    const result = await dailyActiveStudents(new Date("2026-08-01"), new Date("2026-08-14"), null, db as never);
    expect(result).toEqual([{ date: "2026-08-01", activeCount: 5 }, { date: "2026-08-02", activeCount: 8 }]);
  });

  it("sin filas → array vacío, nunca lanza", async () => {
    const db = fakeExecuteDb([]);
    const result = await dailyActiveStudents(new Date("2026-08-01"), new Date("2026-08-14"), null, db as never);
    expect(result).toEqual([]);
  });
});

describe("lastActivityByStudent", () => {
  it("devuelve un Map userId→Date de la última señal", async () => {
    const db = fakeExecuteDb([{ user_id: 4, last_at: "2026-08-10T00:00:00.000Z" }, { user_id: 5, last_at: "2026-08-12T00:00:00.000Z" }]);
    const map = await lastActivityByStudent(db as never);
    expect(map.size).toBe(2);
    expect(map.get(4)?.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });
});

describe("activityCountByStudentSince", () => {
  it("devuelve un Map userId→count", async () => {
    const db = fakeExecuteDb([{ user_id: 4, cnt: 7 }]);
    const map = await activityCountByStudentSince(new Date("2026-05-01"), new Date("2026-08-14"), db as never);
    expect(map.get(4)).toBe(7);
  });
});

describe("distinctVenuesByStudent", () => {
  it("devuelve un Map userId→nº de venues distintos", async () => {
    const db = fakeExecuteDb([{ user_id: 4, cnt: 2 }]);
    const map = await distinctVenuesByStudent(db as never);
    expect(map.get(4)).toBe(2);
  });
});

describe("activeStudentsByVenue", () => {
  it("devuelve un Map venueId→nº de Students activos únicos", async () => {
    const db = fakeExecuteDb([{ venue_id: 10, cnt: 3 }, { venue_id: 11, cnt: 1 }]);
    const map = await activeStudentsByVenue(new Date("2026-08-01"), new Date("2026-08-14"), null, db as never);
    expect(map.get(10)).toBe(3);
    expect(map.get(11)).toBe(1);
  });

  it("sin filas → Map vacío, nunca lanza", async () => {
    const db = fakeExecuteDb([]);
    const map = await activeStudentsByVenue(new Date("2026-08-01"), new Date("2026-08-14"), null, db as never);
    expect(map.size).toBe(0);
  });

  it("resuelve el venue de ticket_orders vía events (no tiene venue_id propio) y usa las 3 fuentes con venue_id directo", async () => {
    const db = fakeExecuteDb([{ venue_id: 10, cnt: 1 }]);
    await activeStudentsByVenue(new Date("2026-08-01"), new Date("2026-08-14"), null, db as never);
    const text = flattenSql(db.execute.mock.calls[0][0]);
    expect(text).toContain("ticket_orders");
    expect(text).toMatch(/JOIN events/);
    expect(text).toContain("event_attendance");
    expect(text).toContain("commerce_transactions");
    expect(text).toContain("consumption_qr_codes");
  });

  it("communityId=7 → filtra vía user_communities (nunca inferido del venue)", async () => {
    const db = fakeExecuteDb([{ venue_id: 10, cnt: 1 }]);
    await activeStudentsByVenue(new Date("2026-08-01"), new Date("2026-08-14"), 7, db as never);
    const text = flattenSql(db.execute.mock.calls[0][0]);
    expect(text).toMatch(/user_communities/);
  });
});
