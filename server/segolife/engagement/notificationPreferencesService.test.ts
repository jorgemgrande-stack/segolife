/**
 * notificationPreferencesService.test.ts — tabla de verdad de
 * isChannelAllowed (spec puntos 9-11, 61): in_app nunca desactivable,
 * transactional siempre pasa (ignora preferencias), marketing sin fila
 * previa = OFF por defecto, marketing con fila respeta el valor guardado.
 */
import { describe, it, expect } from "vitest";
import { isChannelAllowed, listMyPreferences, updatePreference } from "./notificationPreferencesService";
import { notificationPreferences } from "../../../drizzle/schema";

function makeMockDb(rows: Array<Record<string, unknown>> = []) {
  const b: any = {};
  let pendingValues: Record<string, unknown> = {};
  b.select = () => b;
  b.from = () => b;
  b.where = () => b;
  b.limit = (_n: number) => Promise.resolve(rows);
  // listMyPreferences() termina directamente en .where() (sin .limit()) —
  // hace falta que el propio builder sea thenable para ese caso.
  b.then = (resolve: (v: unknown) => void) => resolve(rows);
  b.insert = () => b;
  b.values = (v: Record<string, unknown>) => { pendingValues = v; return b; };
  b.onDuplicateKeyUpdate = ({ set }: { set: Record<string, unknown> }) => {
    const existing = rows.find(r => r.userId === pendingValues.userId && r.category === pendingValues.category && r.channel === pendingValues.channel);
    if (existing) Object.assign(existing, set);
    else rows.push({ ...pendingValues });
    return Promise.resolve([{}]);
  };
  return { db: b as any, rows };
}

describe("notificationPreferencesService — isChannelAllowed", () => {
  it("in_app siempre permitido, sin consultar la tabla — nunca desactivable del todo", async () => {
    const { db } = makeMockDb([]);
    const allowed = await isChannelAllowed({ userId: 1, category: "promotions", channel: "in_app", audienceType: "marketing" }, db);
    expect(allowed).toBe(true);
  });

  it("audienceType transactional siempre permitido en cualquier canal, ignora la tabla de preferencias", async () => {
    const { db } = makeMockDb([]); // sin fila alguna
    const allowed = await isChannelAllowed({ userId: 1, category: "account", channel: "email", audienceType: "transactional" }, db);
    expect(allowed).toBe(true);
  });

  it("marketing + canal externo SIN fila previa = OFF por defecto (nunca opt-in inventado)", async () => {
    const { db } = makeMockDb([]);
    const allowed = await isChannelAllowed({ userId: 1, category: "promotions", channel: "email", audienceType: "marketing" }, db);
    expect(allowed).toBe(false);
  });

  it("marketing + canal externo CON fila enabled=true = permitido", async () => {
    const { db } = makeMockDb([{ userId: 1, category: "promotions", channel: "email", enabled: true }]);
    const allowed = await isChannelAllowed({ userId: 1, category: "promotions", channel: "email", audienceType: "marketing" }, db);
    expect(allowed).toBe(true);
  });

  it("marketing + canal externo CON fila enabled=false = bloqueado", async () => {
    const { db } = makeMockDb([{ userId: 1, category: "promotions", channel: "email", enabled: false }]);
    const allowed = await isChannelAllowed({ userId: 1, category: "promotions", channel: "email", audienceType: "marketing" }, db);
    expect(allowed).toBe(false);
  });

  it("una preferencia OFF en 'promotions' no afecta a otra categoría distinta", async () => {
    const { db } = makeMockDb([{ userId: 1, category: "promotions", channel: "email", enabled: false }]);
    const allowedOtherCategory = await isChannelAllowed({ userId: 1, category: "rewards", channel: "email", audienceType: "marketing" }, db);
    expect(allowedOtherCategory).toBe(false); // rewards+email tampoco tiene fila -> también OFF por defecto, pero por SU PROPIA ausencia, no por la de promotions
  });
});

describe("notificationPreferencesService — updatePreference / listMyPreferences", () => {
  it("updatePreference crea la fila si no existía y listMyPreferences la refleja", async () => {
    const { db, rows } = makeMockDb([]);
    await updatePreference({ userId: 7, category: "rewards", channel: "push", enabled: true }, db);
    expect(rows).toHaveLength(1);
    const mine = await listMyPreferences(7, db);
    expect(mine).toEqual(rows);
  });

  it("updatePreference sobre una fila existente actualiza en vez de duplicar", async () => {
    const { db, rows } = makeMockDb([{ userId: 7, category: "rewards", channel: "push", enabled: false }]);
    await updatePreference({ userId: 7, category: "rewards", channel: "push", enabled: true }, db);
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(true);
  });
});
