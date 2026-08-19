/**
 * studentPhotoEventsDb.test.ts — MG-03B, Profile Photo Activity. Primer test
 * de este fichero. Mismo patrón de mock por inyección de `db` que el resto
 * del repo (venuesDb.test.ts, eventsDb.test.ts).
 */
import { describe, it, expect } from "vitest";
import { recordStudentPhotoEvent, listPhotoEventsByUserId } from "./studentPhotoEventsDb";

function makeMockDb(seed: Array<Record<string, unknown>> = []) {
  const rows = [...seed];
  let nextId = rows.length + 1;
  const db: Record<string, unknown> = {
    insert: () => db,
    values: (v: Record<string, unknown>) => {
      rows.push({ id: nextId++, occurredAt: new Date(), ...v });
      return Promise.resolve([{ insertId: nextId - 1 }]);
    },
    select: () => db,
    from: () => db,
    where: () => db,
    orderBy: () => db,
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
  };
  return { db: db as unknown as Parameters<typeof recordStudentPhotoEvent>[2], getRows: () => rows };
}

describe("studentPhotoEventsDb — recordStudentPhotoEvent / listPhotoEventsByUserId", () => {
  it("recordStudentPhotoEvent inserta la acción real, nunca la imagen/URL/path de storage", async () => {
    const { db, getRows } = makeMockDb();
    await recordStudentPhotoEvent(42, "added", db);
    expect(getRows()).toHaveLength(1);
    expect(getRows()[0]).toMatchObject({ userId: 42, action: "added" });
    expect(getRows()[0]).not.toHaveProperty("url");
    expect(getRows()[0]).not.toHaveProperty("storageKey");
  });

  it("listPhotoEventsByUserId devuelve las filas reales, acotadas por límite", async () => {
    const { db } = makeMockDb([
      { id: 1, userId: 42, action: "added", occurredAt: new Date("2026-08-01") },
      { id: 2, userId: 42, action: "updated", occurredAt: new Date("2026-08-02") },
      { id: 3, userId: 42, action: "removed", occurredAt: new Date("2026-08-03") },
    ]);
    const result = await listPhotoEventsByUserId(42, 2, db);
    expect(result).toHaveLength(2);
  });

  it("acepta las tres acciones válidas (added/updated/removed)", async () => {
    const { db, getRows } = makeMockDb();
    await recordStudentPhotoEvent(1, "added", db);
    await recordStudentPhotoEvent(1, "updated", db);
    await recordStudentPhotoEvent(1, "removed", db);
    expect(getRows().map(r => r.action)).toEqual(["added", "updated", "removed"]);
  });
});
