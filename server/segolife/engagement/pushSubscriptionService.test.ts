/**
 * pushSubscriptionService.test.ts — F67 (Push + WhatsApp). Mismo helper
 * genérico que cashSessionService.test.ts/fiscalDocumentService.test.ts
 * (drizzleConditionMockFactory + MockTable + createMockDb) — interpreta el
 * WHERE real, necesario porque saveSubscription hace un lookup por endpoint
 * y luego un update/insert + reselect por id, dos condiciones distintas
 * sobre la MISMA tabla dentro de una sola llamada.
 */
import { describe, it, expect, vi } from "vitest";
import { drizzleConditionMockFactory, MockTable, createMockDb } from "../_testHelpers/drizzleTableMock";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, ...drizzleConditionMockFactory() };
});

import { pushSubscriptions } from "../../../drizzle/schema";
import {
  saveSubscription, revokeSubscriptionForUser, revokeSubscriptionByEndpoint,
  listActiveSubscriptionsForUser, hasActivePushSubscription,
} from "./pushSubscriptionService";

function makeDb(rows: Array<Record<string, unknown>> = []) {
  const table = new MockTable(pushSubscriptions as unknown as Record<string, unknown>, rows);
  const db = createMockDb(new Map([[pushSubscriptions, table]]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, table };
}

describe("pushSubscriptionService — saveSubscription (upsert por endpoint)", () => {
  it("un endpoint nuevo crea una fila", async () => {
    const { db, table } = makeDb();
    const created = await saveSubscription({ userId: 42, endpoint: "https://push.example/abc", keysP256dh: "p1", keysAuth: "a1" }, db);
    expect(created.userId).toBe(42);
    expect(table.rows).toHaveLength(1);
  });

  it("re-suscribirse con el MISMO endpoint actualiza in-place — nunca duplica la fila (unique real de BD)", async () => {
    const { db, table } = makeDb([
      { id: 1, userId: 42, endpoint: "https://push.example/abc", keysP256dh: "old", keysAuth: "old", revokedAt: new Date("2020-01-01") },
    ]);

    const updated = await saveSubscription({ userId: 42, endpoint: "https://push.example/abc", keysP256dh: "new", keysAuth: "new" }, db);

    expect(table.rows).toHaveLength(1); // nunca una segunda fila
    expect(updated.keysP256dh).toBe("new");
    expect(updated.revokedAt).toBeNull(); // reactivada, no queda revocada
  });

  it("el mismo endpoint pero de OTRO usuario (dispositivo compartido/reinstalación) se reasigna, no crea fila duplicada", async () => {
    const { db, table } = makeDb([{ id: 1, userId: 1, endpoint: "https://push.example/shared", keysP256dh: "x", keysAuth: "x", revokedAt: null }]);
    const updated = await saveSubscription({ userId: 2, endpoint: "https://push.example/shared", keysP256dh: "y", keysAuth: "y" }, db);
    expect(table.rows).toHaveLength(1);
    expect(updated.userId).toBe(2);
  });
});

describe("pushSubscriptionService — revocación", () => {
  it("revokeSubscriptionForUser solo revoca si el endpoint pertenece a ESE userId", async () => {
    const { db, table } = makeDb([{ id: 1, userId: 42, endpoint: "https://push.example/mine", revokedAt: null }]);

    await revokeSubscriptionForUser(99, "https://push.example/mine", db); // otro usuario intentando revocar lo ajeno

    expect(table.rows[0].revokedAt).toBeNull(); // nunca se tocó — no coincidía el dueño real
  });

  it("revokeSubscriptionForUser revoca cuando el userId+endpoint SÍ coinciden", async () => {
    const { db, table } = makeDb([{ id: 1, userId: 42, endpoint: "https://push.example/mine", revokedAt: null }]);
    await revokeSubscriptionForUser(42, "https://push.example/mine", db);
    expect(table.rows[0].revokedAt).toBeInstanceOf(Date);
  });

  it("revokeSubscriptionByEndpoint (auto-limpieza del provider) no exige propietario", async () => {
    const { db, table } = makeDb([{ id: 1, userId: 42, endpoint: "https://push.example/gone", revokedAt: null }]);
    await revokeSubscriptionByEndpoint("https://push.example/gone", db);
    expect(table.rows[0].revokedAt).toBeInstanceOf(Date);
  });
});

describe("pushSubscriptionService — lecturas", () => {
  it("listActiveSubscriptionsForUser nunca devuelve suscripciones revocadas ni de otro usuario", async () => {
    const { db } = makeDb([
      { id: 1, userId: 42, endpoint: "a", revokedAt: null },
      { id: 2, userId: 42, endpoint: "b", revokedAt: new Date() },
      { id: 3, userId: 99, endpoint: "c", revokedAt: null },
    ]);
    const active = await listActiveSubscriptionsForUser(42, db);
    expect(active).toHaveLength(1);
    expect(active[0].endpoint).toBe("a");
  });

  it("hasActivePushSubscription: true con al menos una activa, false sin ninguna", async () => {
    const { db: withOne } = makeDb([{ id: 1, userId: 42, endpoint: "a", revokedAt: null }]);
    expect(await hasActivePushSubscription(42, withOne)).toBe(true);

    const { db: withNone } = makeDb([{ id: 1, userId: 42, endpoint: "a", revokedAt: new Date() }]);
    expect(await hasActivePushSubscription(42, withNone)).toBe(false);
  });
});
