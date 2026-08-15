/**
 * drizzleTableMock.ts — helper de test compartido para SEGOLIFE FASE 10.
 *
 * A diferencia del patrón "table+mode dispatch, ignora WHERE" ya usado en
 * Fase 9 (refundOrchestrator.test.ts), aquí SÍ se interpreta el WHERE real
 * — necesario porque varios servicios nuevos (stockService, cashSession,
 * settlementService) consultan/actualizan FILAS ESPECÍFICAS entre varias en
 * juego dentro del mismo test (varios productos, varios movimientos), no
 * una única fila fija. Debe usarse junto con `vi.mock("drizzle-orm", ...)`
 * (ver mockDrizzleConditions()) para que eq/and/or/gte/lte/like/inArray
 * produzcan objetos interpretables en vez de SQL real.
 */
export type MockCond =
  | { __op: "eq"; col: unknown; val: unknown }
  | { __op: "and"; conds: MockCond[] }
  | { __op: "or"; conds: MockCond[] }
  | { __op: "gte"; col: unknown; val: unknown }
  | { __op: "lte"; col: unknown; val: unknown }
  | { __op: "like"; col: unknown; val: unknown }
  | { __op: "inArray"; col: unknown; vals: unknown[] }
  | { __op: "isNull"; col: unknown }
  | undefined;

/** Debe llamarse con vi.mock(...) en el propio archivo de test (hoisted) — ver ejemplo de uso en stockService.test.ts. */
export function drizzleConditionMockFactory() {
  return {
    eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __op: "and", conds }),
    or: (...conds: unknown[]) => ({ __op: "or", conds }),
    gte: (col: unknown, val: unknown) => ({ __op: "gte", col, val }),
    lte: (col: unknown, val: unknown) => ({ __op: "lte", col, val }),
    like: (col: unknown, val: unknown) => ({ __op: "like", col, val }),
    inArray: (col: unknown, vals: unknown[]) => ({ __op: "inArray", col, vals }),
    isNull: (col: unknown) => ({ __op: "isNull", col }),
    sql: (strings: TemplateStringsArray, ...exprs: unknown[]) => ({ __op: "sql", strings, exprs }),
  };
}

/**
 * Detecta el patrón `sql\`col + N\`` / `sql\`${col} + ${n}\`` usado para
 * incrementos atómicos (contadores de numeración, refundedQuantity, etc.) —
 * nunca evalúa SQL arbitrario, solo esta forma concreta y ya usada en el
 * código real (server/documentNumbers.ts, fiscalDocumentService.ts,
 * refundOrchestrator.ts). Devuelve null si `val` no es un sql-tag.
 */
function resolveSqlIncrement(val: unknown): number | null {
  const tagged = val as { __op?: string; exprs?: unknown[]; strings?: TemplateStringsArray } | undefined;
  if (!tagged || tagged.__op !== "sql") return null;
  const numericExprs = (tagged.exprs ?? []).filter((e): e is number => typeof e === "number");
  if (numericExprs.length) return numericExprs[numericExprs.length - 1];
  const text = tagged.strings ? Array.from(tagged.strings).join("") : "";
  const m = text.match(/\+\s*(\d+)/);
  return m ? Number(m[1]) : 1;
}

function colKey(col: unknown, table: Record<string, unknown>): string | null {
  for (const [key, val] of Object.entries(table)) {
    if (val === col) return key;
  }
  return null;
}

/** Evalúa una condición mock contra una fila, resolviendo el nombre de columna via el objeto de tabla real (import de drizzle/schema). */
export function evalCond(cond: MockCond, row: Record<string, unknown>, table: Record<string, unknown>): boolean {
  if (!cond) return true;
  switch (cond.__op) {
    case "and": return cond.conds.every(c => evalCond(c as MockCond, row, table));
    case "or": return cond.conds.some(c => evalCond(c as MockCond, row, table));
    case "eq": { const k = colKey(cond.col, table); return k != null && row[k] === cond.val; }
    case "gte": { const k = colKey(cond.col, table); return k != null && (row[k] as any) >= (cond.val as any); }
    case "lte": { const k = colKey(cond.col, table); return k != null && (row[k] as any) <= (cond.val as any); }
    case "like": {
      const k = colKey(cond.col, table);
      if (k == null) return false;
      const pattern = String(cond.val).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
      return new RegExp(`^${pattern}$`).test(String(row[k] ?? ""));
    }
    case "inArray": { const k = colKey(cond.col, table); return k != null && cond.vals.includes(row[k]); }
    case "isNull": { const k = colKey(cond.col, table); return k != null && row[k] == null; }
    default: return true;
  }
}

/** Simple almacén en memoria por tabla, con autoincrement e idempotencyKey opcional. */
export class MockTable<T extends Record<string, unknown>> {
  rows: T[] = [];
  private nextId = 1;
  constructor(public tableObj: Record<string, unknown>, seed: T[] = []) {
    this.rows = seed.map(r => ({ ...r }));
    this.nextId = (Math.max(0, ...this.rows.map(r => Number(r.id ?? 0))) || 0) + 1;
  }
  select(cond: MockCond): T[] {
    return this.rows.filter(r => evalCond(cond, r, this.tableObj));
  }
  insert(values: Partial<T>): T {
    const row = { id: this.nextId++, ...values } as T;
    this.rows.push(row);
    return row;
  }
  update(cond: MockCond, values: Partial<T>): number {
    let n = 0;
    for (const r of this.rows) {
      if (evalCond(cond, r, this.tableObj)) {
        for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
          const inc = resolveSqlIncrement(v);
          (r as Record<string, unknown>)[k] = inc != null ? (Number((r as Record<string, unknown>)[k] ?? 0) + inc) : v;
        }
        n++;
      }
    }
    return n;
  }
  delete(cond: MockCond): number {
    const before = this.rows.length;
    this.rows = this.rows.filter(r => !evalCond(cond, r, this.tableObj));
    return before - this.rows.length;
  }
}

/**
 * Simula el ROLLBACK real de `conn.transaction(cb)`: si `cb` lanza, restaura
 * las filas de todas las MockTable dadas a su estado previo — necesario
 * porque el mock in-memory no revierte solo (a diferencia de MySQL real),
 * y varios servicios de Fase 10 dependen de atomicidad "todo o nada" dentro
 * de una transacción (spec §40 stock, §22 reembolsos).
 */
export async function runMockTransaction<T>(tables: Array<MockTable<Record<string, unknown>>>, cb: () => Promise<T>): Promise<T> {
  const snapshots = tables.map(t => t.rows.map(r => ({ ...r })));
  try {
    return await cb();
  } catch (err) {
    tables.forEach((t, i) => { t.rows = snapshots[i]; });
    throw err;
  }
}

/**
 * DB mock genérica multi-tabla — cubre select/insert/update/delete/
 * transaction para cualquier número de tablas registradas en `tables`
 * (Map de objeto-de-tabla-real → MockTable). Reduce duplicación entre
 * archivos de test que antes reimplementaban su propio `builder()` cada vez.
 * `conn.transaction(cb)` hace rollback real (snapshot/restaura TODAS las
 * tablas registradas) si `cb` lanza.
 */
export function createMockDb(tables: Map<unknown, MockTable<Record<string, unknown>>>) {
  function tableFor(t: unknown): MockTable<Record<string, unknown>> {
    const mt = tables.get(t);
    if (!mt) throw new Error("mock: tabla no registrada en createMockDb");
    return mt;
  }
  function builder() {
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let table: unknown = null;
    let cond: MockCond = undefined;
    let setValues: Record<string, unknown> | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.select = () => { mode = "select"; return b; };
    b.from = (t: unknown) => { table = t; return b; };
    b.insert = (t: unknown) => { mode = "insert"; table = t; return b; };
    b.update = (t: unknown) => { mode = "update"; table = t; return b; };
    b.delete = (t: unknown) => { mode = "delete"; table = t; return b; };
    b.set = (v: Record<string, unknown>) => { setValues = v; return b; };
    b.where = (c: MockCond) => { cond = c; return b; };
    b.for = () => b;
    b.limit = () => b;
    b.orderBy = () => b;
    b.innerJoin = () => b;
    b.ignore = () => b;
    b.values = (v: Record<string, unknown>) => {
      const row = tableFor(table).insert(v);
      return Promise.resolve([{ insertId: row.id }]);
    };
    b.then = (resolve: (v: unknown) => void) => {
      if (mode === "select") return resolve(tableFor(table).select(cond));
      if (mode === "update") return resolve([{ affectedRows: tableFor(table).update(cond, setValues!) }]);
      if (mode === "delete") return resolve([{ affectedRows: tableFor(table).delete(cond) }]);
      return resolve([]);
    };
    return b;
  }
  const outer = builder();
  outer.transaction = (cb: (tx: unknown) => Promise<unknown>) => runMockTransaction([...tables.values()], () => cb(builder()));
  return outer;
}
