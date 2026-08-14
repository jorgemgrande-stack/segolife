/**
 * commandCenterActivity.test.ts — SEGOLIFE LIVE: mismas 10 fuentes reales que
 * activitySignals.ts (más registration/login), nunca PII (email/teléfono),
 * paginación server-side con clamping real, y mapeo correcto de filas.
 */
import { describe, it, expect, vi } from "vitest";
import { getActivityFeed } from "./commandCenterActivity";

/** Aplana un fragmento sql`...` a texto plano (mismo criterio que activitySignals.test.ts). */
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

/** Extrae los parámetros crudos (números/strings/Dates) interpolados directamente en el template, en orden — LIMIT/OFFSET son los dos últimos del template real. */
function rawParams(fragment: unknown): unknown[] {
  const chunks = (fragment as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks.filter(c => !(c && typeof c === "object" && ("value" in (c as Record<string, unknown>) || "queryChunks" in (c as Record<string, unknown>))));
}

function fakeExecuteDb(returnRows: unknown[]) {
  const execute = vi.fn().mockResolvedValue([returnRows, []]);
  return { execute };
}

describe("getActivityFeed", () => {
  it("mapea correctamente occurred_at→timestamp ISO y el resto de campos", async () => {
    const db = fakeExecuteDb([{ occurred_at: "2026-08-14T10:00:00.000Z", type: "ticket_purchase", user_id: 4, student_name: "Ana", venue_id: 10, event_id: 55, value_label: "25€" }]);
    const items = await getActivityFeed(20, 0, null, db as never);
    expect(items).toEqual([{ timestamp: "2026-08-14T10:00:00.000Z", type: "ticket_purchase", studentUserId: 4, studentName: "Ana", venueId: 10, eventId: 55, valueLabel: "25€" }]);
  });

  it("sin filas → array vacío, nunca lanza", async () => {
    const db = fakeExecuteDb([]);
    const items = await getActivityFeed(20, 0, null, db as never);
    expect(items).toEqual([]);
  });

  it("incluye las 10 fuentes reales de actividad más registration/login — nunca PII (email/teléfono)", async () => {
    const db = fakeExecuteDb([]);
    await getActivityFeed(20, 0, null, db as never);
    const text = flattenSql(db.execute.mock.calls[0][0]);
    for (const table of ["ticket_orders", "event_attendance", "commerce_transactions", "consumption_qr_codes", "token_ledger", "user_benefits", "community_responses", "community_supports", "community_student_proposals", "student_login_events"]) {
      expect(text).toContain(table);
    }
    expect(text).not.toMatch(/\bemail\b/i);
    expect(text).not.toMatch(/\bphone\b/i);
  });

  it("communityId=null → sin filtro de comunidad en el SQL generado", async () => {
    const db = fakeExecuteDb([]);
    await getActivityFeed(20, 0, null, db as never);
    const text = flattenSql(db.execute.mock.calls[0][0]);
    expect(text).not.toMatch(/user_communities/);
  });

  it("communityId=5 → filtra vía user_communities real", async () => {
    const db = fakeExecuteDb([]);
    await getActivityFeed(20, 0, 5, db as never);
    const text = flattenSql(db.execute.mock.calls[0][0]);
    expect(text).toMatch(/user_communities/);
  });

  it("clamping: limit por encima de 100 se recorta a 100; offset negativo se recorta a 0", async () => {
    const db = fakeExecuteDb([]);
    await getActivityFeed(9999, -50, null, db as never);
    const params = rawParams(db.execute.mock.calls[0][0]);
    // Los dos últimos parámetros crudos del template son LIMIT y OFFSET, en ese orden.
    expect(params.slice(-2)).toEqual([100, 0]);
  });

  it("clamping: limit por debajo de 1 se sube a 1", async () => {
    const db = fakeExecuteDb([]);
    await getActivityFeed(0, 3, null, db as never);
    const params = rawParams(db.execute.mock.calls[0][0]);
    expect(params.slice(-2)).toEqual([1, 3]);
  });

  it("paginación server-side: LIMIT/OFFSET viajan en la propia query, nunca se trae todo y se recorta en Node", async () => {
    const db = fakeExecuteDb([]);
    await getActivityFeed(20, 40, null, db as never);
    const text = flattenSql(db.execute.mock.calls[0][0]);
    expect(text).toMatch(/LIMIT/);
    expect(text).toMatch(/OFFSET/);
  });
});
