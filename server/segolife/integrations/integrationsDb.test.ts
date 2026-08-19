/**
 * integrationsDb.test.ts — Production Scheduler (2026-08-13): lock
 * (tryAcquireSyncLock) y cálculo de "debido" (isDueForScheduledSync). Mismo
 * criterio que el resto del proyecto: se prueba la ORQUESTACIÓN (qué
 * decide, qué inserta/actualiza y en qué orden), no la semántica interna de
 * `FOR UPDATE` de MySQL — eso se demuestra con evidencia real contra
 * producción (ver informe final), un fake no puede probar locking real
 * entre conexiones distintas.
 */
import { describe, it, expect } from "vitest";
import { tryAcquireSyncLock, isDueForScheduledSync, getLastSuccessfulModeRunAt, SYNC_STALE_LOCK_MINUTES } from "./integrationsDb";

/**
 * Fake de `db.transaction()` — reproduce la secuencia EXACTA de queries que
 * hace tryAcquireSyncLock dentro de la transacción:
 *  1. insert(sync_state).values().onDuplicateKeyUpdate()  — upsert, sin retorno usado
 *  2. select(sync_state)...limit(1).for("update")          — lock de fila, retorno sin usar
 *  3. select(sync_runs) WHERE status='running' ...limit(1) — runningRows
 *  4. [solo si stale] update(sync_runs).set({status:'failed'...})
 *  5. insert(sync_runs).values({...})                      — nueva fila running
 *  6. select(sync_runs) WHERE id=insertId ...limit(1)       — lectura final
 */
function fakeLockDb({ runningRows = [] as Array<Record<string, unknown>>, insertId = 900 } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  let selectCallIndex = 0;

  function chain(resolveValue: unknown) {
    const c: any = {
      from: () => c,
      where: () => c,
      orderBy: () => c,
      limit: () => c,
      for: () => Promise.resolve(resolveValue),
      then: (resolve: (v: unknown) => void) => resolve(resolveValue),
    };
    return c;
  }

  const tx = {
    insert: (_table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return {
          onDuplicateKeyUpdate: () => Promise.resolve([{}]),
          then: (resolve: (v: unknown) => void) => resolve([{ insertId }]),
        };
      },
    }),
    select: (..._args: unknown[]) => {
      selectCallIndex++;
      if (selectCallIndex === 1) return chain([]); // FOR UPDATE — retorno no usado
      if (selectCallIndex === 2) return chain(runningRows);
      return chain([{ id: insertId, status: "running", startedAt: new Date(), integrationType: "venue_integration", integrationId: 1, syncType: "incremental" }]);
    },
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({ where: () => { updates.push(values); return Promise.resolve([{}]); } }),
    }),
  };

  return { db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) } as never, updates, inserts };
}

describe("tryAcquireSyncLock — Production Scheduler (spec §26-31)", () => {
  it("sin run en curso → adquiere inmediatamente, inserta la nueva fila 'running'", async () => {
    const { db, inserts } = fakeLockDb({ runningRows: [] });
    const result = await tryAcquireSyncLock("venue_integration", 1, "incremental", { trigger: "scheduler" }, db);

    expect(result.acquired).toBe(true);
    expect(result.run?.id).toBe(900);
    // 2 inserts: el upsert de sync_state (paso 1) + la nueva fila de sync_runs (paso 5).
    expect(inserts).toHaveLength(2);
    expect(inserts[1]).toMatchObject({ integrationType: "venue_integration", integrationId: 1, syncType: "incremental", status: "running", metadata: { trigger: "scheduler" } });
    // Regresión real de producción (piloto 2026-08-13): updatedSince=new Date(0)
    // (epoch) hacía fallar el upsert en MySQL estricto ("Incorrect datetime
    // value") — CADA tick del scheduler fallaba en silencio. Nunca debe volver.
    const syncStateInsert = inserts[0] as { updatedSince?: Date };
    expect(syncStateInsert.updatedSince).toBeInstanceOf(Date);
    expect(syncStateInsert.updatedSince!.getTime()).toBeGreaterThan(0);
  });

  it("ya hay un run 'running' RECIENTE (dentro del umbral) → NO adquiere, no inserta nueva fila, no actualiza nada", async () => {
    const freshRunning = { id: 42, status: "running", startedAt: new Date(Date.now() - 2 * 60_000) }; // 2 min — muy por debajo de SYNC_STALE_LOCK_MINUTES
    const { db, inserts, updates } = fakeLockDb({ runningRows: [freshRunning] });

    const result = await tryAcquireSyncLock("venue_integration", 1, "incremental", undefined, db);

    expect(result.acquired).toBe(false);
    expect(result.run).toBeNull();
    expect(result.reason).toContain("already running");
    expect(result.reason).toContain("#42");
    // Solo el upsert de sync_state (paso 1) — NUNCA se llega a insertar una 2ª fila de sync_runs.
    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(0);
  });

  it("hay un run 'running' pero OBSOLETO (más viejo que SYNC_STALE_LOCK_MINUTES) → se marca failed automáticamente y SÍ adquiere el lock (auto-recuperación, spec §35)", async () => {
    const staleRunning = { id: 41, status: "running", startedAt: new Date(Date.now() - (SYNC_STALE_LOCK_MINUTES + 5) * 60_000) };
    const { db, inserts, updates } = fakeLockDb({ runningRows: [staleRunning] });

    const result = await tryAcquireSyncLock("venue_integration", 1, "incremental", undefined, db);

    expect(result.acquired).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "failed" });
    expect(inserts).toHaveLength(2); // upsert de sync_state + nueva fila running
  });
});

describe("isDueForScheduledSync — cálculo puro (spec §53)", () => {
  const now = new Date("2026-08-13T12:00:00.000Z");

  it("nunca sincronizada (lastSuccessAt=null) → debida", () => {
    expect(isDueForScheduledSync({ lastSuccessAt: null, syncIntervalMinutes: 10 }, now, 10)).toBe(true);
  });

  it("último éxito hace 11 minutos, intervalo=10 → debida", () => {
    const lastSuccessAt = new Date(now.getTime() - 11 * 60_000);
    expect(isDueForScheduledSync({ lastSuccessAt, syncIntervalMinutes: 10 }, now, 10)).toBe(true);
  });

  it("último éxito hace 5 minutos, intervalo=10 → NO debida", () => {
    const lastSuccessAt = new Date(now.getTime() - 5 * 60_000);
    expect(isDueForScheduledSync({ lastSuccessAt, syncIntervalMinutes: 10 }, now, 10)).toBe(false);
  });

  it("exactamente en el borde (10 min transcurridos, intervalo=10) → debida (>=, no estricta)", () => {
    const lastSuccessAt = new Date(now.getTime() - 10 * 60_000);
    expect(isDueForScheduledSync({ lastSuccessAt, syncIntervalMinutes: 10 }, now, 10)).toBe(true);
  });

  it("syncIntervalMinutes de la fila (null) usa el default recibido, nunca un valor hardcodeado dentro de la función (spec §13)", () => {
    const lastSuccessAt = new Date(now.getTime() - 20 * 60_000);
    expect(isDueForScheduledSync({ lastSuccessAt, syncIntervalMinutes: null }, now, 30)).toBe(false); // con default=30 no está debida a los 20 min
    expect(isDueForScheduledSync({ lastSuccessAt, syncIntervalMinutes: null }, now, 15)).toBe(true); // con default=15 sí
  });

  it("syncIntervalMinutes de la fila SIEMPRE gana sobre el default cuando está definido", () => {
    const lastSuccessAt = new Date(now.getTime() - 20 * 60_000);
    expect(isDueForScheduledSync({ lastSuccessAt, syncIntervalMinutes: 5 }, now, 9999)).toBe(true); // fila pide 5 min, ya pasaron 20 — debida pese al default enorme
  });
});

/** Fake mínimo para getLastSuccessfulModeRunAt: select().from().where().orderBy().limit() → array de filas. */
function fakeModeRunsDb(rows: Array<{ startedAt: Date; metadata: Record<string, unknown> | null }>) {
  const chain: any = { from: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain, then: (resolve: (v: unknown) => void) => resolve(rows) };
  return { select: () => chain } as never;
}

describe("getLastSuccessfulModeRunAt — FIX-05 (3ª cadencia 'catalog', ventana ampliada 20→150)", () => {
  it("encuentra el último run 'catalog' entre runs de otros modos intercalados", async () => {
    const db = fakeModeRunsDb([
      { startedAt: new Date("2026-08-19T16:30:00Z"), metadata: { mode: "incremental" } },
      { startedAt: new Date("2026-08-19T16:29:00Z"), metadata: { mode: "catalog" } },
      { startedAt: new Date("2026-08-19T16:20:00Z"), metadata: { mode: "incremental" } },
    ]);
    const result = await getLastSuccessfulModeRunAt("venue_integration", 1, "catalog", db);
    expect(result).toEqual(new Date("2026-08-19T16:29:00Z"));
  });

  it("acepta 'incremental'/'reconciliation'/'catalog' como modos válidos (regresión de tipo — antes solo 2)", async () => {
    const db = fakeModeRunsDb([{ startedAt: new Date("2026-08-19T10:00:00Z"), metadata: { mode: "reconciliation" } }]);
    expect(await getLastSuccessfulModeRunAt("venue_integration", 1, "incremental", db)).toBeNull();
    expect(await getLastSuccessfulModeRunAt("venue_integration", 1, "reconciliation", db)).toEqual(new Date("2026-08-19T10:00:00Z"));
    expect(await getLastSuccessfulModeRunAt("venue_integration", 1, "catalog", db)).toBeNull();
  });

  it("modo nunca encontrado en la ventana → null, nunca lanza", async () => {
    const db = fakeModeRunsDb([{ startedAt: new Date(), metadata: { mode: "incremental" } }]);
    expect(await getLastSuccessfulModeRunAt("venue_integration", 1, "reconciliation", db)).toBeNull();
  });

  it("regresión real (spec §48): con 3 cadencias activas (incremental+catalog @10min, reconciliation @6h), el último 'reconciliation' puede quedar hasta ~72 runs atrás — el límite de 150 debe seguir encontrándolo, 20 (el valor original) no lo habría hecho", async () => {
    const denseRows: Array<{ startedAt: Date; metadata: Record<string, unknown> }> = [];
    for (let i = 0; i < 72; i++) {
      denseRows.push({ startedAt: new Date(Date.now() - i * 5 * 60_000), metadata: { mode: i % 2 === 0 ? "incremental" : "catalog" } });
    }
    denseRows.push({ startedAt: new Date(Date.now() - 72 * 5 * 60_000), metadata: { mode: "reconciliation" } });
    const db = fakeModeRunsDb(denseRows);
    const result = await getLastSuccessfulModeRunAt("venue_integration", 1, "reconciliation", db);
    expect(result).not.toBeNull(); // con el límite anterior de 20 esto habría sido null — reconciliation se habría disparado en cada tick
  });
});
