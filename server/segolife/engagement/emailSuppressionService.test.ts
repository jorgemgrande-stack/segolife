/**
 * emailSuppressionService.test.ts — Communication Center, supresión técnica
 * (spec §21). Distinto de notificationPreferencesService.ts (opt-out de
 * marketing) — probado por separado, ver notificationPreferencesService.test.ts.
 */
import { describe, it, expect } from "vitest";
import { isEmailSuppressed, suppressEmail, listSuppressions, removeSuppression } from "./emailSuppressionService";

function makeMockDb(initialRows: Array<Record<string, unknown>> = []) {
  const rows = [...initialRows];
  let nextId = rows.length > 0 ? Math.max(...rows.map(r => r.id as number)) + 1 : 1;
  const b: any = {};
  b.select = () => b;
  b.from = () => b;
  b.where = () => {
    // eq(emailSuppressions.email, X) — el mock no interpreta el SQL; cada test siembra exactamente las filas que espera que esta query encuentre.
    return { limit: (n: number) => Promise.resolve(rows.slice(0, n)), then: (resolve: any) => resolve(rows) };
  };
  b.limit = (n: number) => Promise.resolve(rows.slice(0, n));
  b.orderBy = () => ({ limit: (n: number) => Promise.resolve(rows.slice(0, n)) });
  b.insert = () => ({
    ignore: () => ({
      values: (v: Record<string, unknown>) => {
        const dup = rows.find(r => r.email === v.email);
        if (dup) return Promise.resolve([{ insertId: 0 }]);
        const row = { id: nextId++, suppressedAt: new Date(), ...v };
        rows.push(row);
        return Promise.resolve([{ insertId: row.id }]);
      },
    }),
  });
  b.delete = () => ({ where: () => { rows.length = 0; return Promise.resolve([{}]); } });
  return { db: b, rows };
}

describe("isEmailSuppressed", () => {
  it("devuelve true si existe una fila para el email (normalizado a minúsculas)", async () => {
    const { db } = makeMockDb([{ id: 1, email: "bounced@example.invalid", reason: "hard_bounce" }]);
    // El mock siempre devuelve las filas configuradas para cualquier .where() —
    // aquí se comprueba el caso "hay coincidencia" con el email exacto sembrado.
    expect(await isEmailSuppressed("bounced@example.invalid", db as any)).toBe(true);
  });

  it("devuelve false sin filas", async () => {
    const { db } = makeMockDb([]);
    expect(await isEmailSuppressed("clean@example.invalid", db as any)).toBe(false);
  });
});

describe("suppressEmail — idempotente", () => {
  it("una misma dirección suprimida dos veces no duplica la fila (UNIQUE + INSERT IGNORE)", async () => {
    const { db, rows } = makeMockDb([]);
    await suppressEmail({ email: "Bounced@Example.invalid", reason: "hard_bounce", source: "brevo_webhook" }, db as any);
    await suppressEmail({ email: "bounced@example.invalid", reason: "hard_bounce", source: "brevo_webhook" }, db as any);
    expect(rows).toHaveLength(1);
  });

  it("normaliza el email a minúsculas antes de guardar", async () => {
    const { db, rows } = makeMockDb([]);
    await suppressEmail({ email: "Mixed.Case@Example.invalid", reason: "spam", source: "manual" }, db as any);
    expect(rows[0].email).toBe("mixed.case@example.invalid");
  });
});

describe("listSuppressions / removeSuppression", () => {
  it("removeSuppression vacía la lista (admin puede revertir una supresión, spec §21)", async () => {
    const { db, rows } = makeMockDb([{ id: 1, email: "x@example.invalid", reason: "manual", source: "admin" }]);
    expect(await listSuppressions(100, db as any)).toHaveLength(1);
    await removeSuppression("x@example.invalid", db as any);
    expect(rows).toHaveLength(0);
  });
});
