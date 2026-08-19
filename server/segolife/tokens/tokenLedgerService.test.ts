/**
 * tokenLedgerService.test.ts — núcleo atómico del motor de SegoTokens (Fase 2).
 * Mismo patrón de inyección de dependencia que server/db/venuesDb.test.ts:
 * cada función acepta un `db` opcional mockeable. El mock trackea el estado
 * real de UN wallet + su ledger (suficiente para estos tests — cada test usa
 * un escenario propio, mismo enfoque que makeCreateVenueMockDb).
 */
import { describe, it, expect } from "vitest";
import {
  ensureWallet,
  postLedgerMovement,
  adjustManualTokens,
  reverseTransaction,
  isLedgerEntryReversed,
  findActiveGrantBySource,
  TokenEngineError,
} from "./tokenLedgerService";
import { tokenWallets, tokenLedger } from "../../../drizzle/schema";

function blankWallet(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, userId: 42, balance: 0, lifetimeEarned: 0, lifetimeSpent: 0,
    status: "active" as const, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

/**
 * Mock con estado real de UN wallet + su ledger. Cada función bajo test hace
 * hasta 2 SELECTs a tokenLedger ANTES de insertar (idempotencia; o
 * "original"+"¿ya revertido?" en reverseTransaction) y 1 relectura DESPUÉS
 * de insertar — como no se puede inspeccionar la condición real de `.where()`,
 * cada test declara EXPLÍCITAMENTE (mismo patrón que setNextQuery en
 * communitiesDb.test.ts) qué debe devolver cada SELECT pre-insert, en orden,
 * vía `queuePreInsertSelect`. La relectura post-insert siempre devuelve la
 * fila recién insertada — esa parte sí es inequívoca.
 */
function makeLedgerMockDb(initialWallet: Record<string, unknown> | null) {
  let wallet: Record<string, unknown> | null = initialWallet;
  const ledgerRows: Array<Record<string, unknown>> = [];
  let nextLedgerId = 1;
  let table: unknown = null;
  let hasInsertedLedgerThisCall = false;
  let insertedLedgerRow: Record<string, unknown> | null = null;
  let forceDuplicateOnce = false;
  const preInsertSelectQueue: Array<Array<Record<string, unknown>>> = [];

  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.from = (t: unknown) => { table = t; return builder; };
  builder.where = () => builder;
  builder.limit = () => builder;
  builder.for = () => builder;
  builder.insert = (t: unknown) => { table = t; return builder; };
  builder.update = (t: unknown) => { table = t; return builder; };
  builder.set = (fields: Record<string, unknown>) => {
    if (table === tokenWallets && wallet) wallet = { ...wallet, ...fields };
    return builder;
  };
  builder.values = (v: Record<string, unknown>) => {
    if (table === tokenWallets) {
      wallet = { id: 1, balance: 0, lifetimeEarned: 0, lifetimeSpent: 0, status: "active", createdAt: new Date(), updatedAt: new Date(), ...v };
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (forceDuplicateOnce) {
      forceDuplicateOnce = false;
      const err = new Error("Duplicate entry") as Error & { errno: number };
      err.errno = 1062;
      throw err;
    }
    const row = { id: nextLedgerId++, ...v };
    ledgerRows.push(row);
    insertedLedgerRow = row;
    hasInsertedLedgerThisCall = true;
    return Promise.resolve([{ insertId: row.id }]);
  };
  builder.then = (resolve: (v: unknown) => void) => {
    if (table === tokenWallets) return resolve(wallet ? [wallet] : []);
    if (table === tokenLedger) {
      if (!hasInsertedLedgerThisCall) {
        const next = preInsertSelectQueue.shift();
        return resolve(next ?? []);
      }
      return resolve(insertedLedgerRow ? [insertedLedgerRow] : []);
    }
    return resolve([]);
  };
  builder.transaction = (cb: (tx: unknown) => Promise<unknown>) => {
    hasInsertedLedgerThisCall = false;
    insertedLedgerRow = null;
    return cb(builder);
  };

  return {
    db: builder as unknown as Parameters<typeof postLedgerMovement>[1],
    getWallet: () => wallet,
    getLedgerRows: () => ledgerRows,
    seedLedgerRow: (row: Record<string, unknown>) => { ledgerRows.push(row); nextLedgerId = Math.max(nextLedgerId, (row.id as number) + 1); },
    forceDuplicateOnce: () => { forceDuplicateOnce = true; },
    queuePreInsertSelect: (rows: Array<Record<string, unknown>>) => { preInsertSelectQueue.push(rows); },
  };
}

describe("tokenLedgerService — wallet única por usuario (ensureWallet)", () => {
  it("crea un wallet con balance inicial 0 si el usuario no tiene ninguno", async () => {
    const { db, getWallet } = makeLedgerMockDb(null);
    const wallet = await ensureWallet(42, db);
    expect(wallet.userId).toBe(42);
    expect(wallet.balance).toBe(0);
    expect(getWallet()).not.toBeNull();
  });

  it("devuelve el wallet existente sin crear uno nuevo", async () => {
    const existing = blankWallet({ balance: 50 });
    const { db } = makeLedgerMockDb(existing);
    const wallet = await ensureWallet(42, db);
    expect(wallet.balance).toBe(50);
  });
});

describe("tokenLedgerService — crédito y débito (postLedgerMovement)", () => {
  it("un crédito incrementa balance y lifetimeEarned, y crea la fila de ledger con balanceAfter correcto", async () => {
    const { db, getWallet, getLedgerRows } = makeLedgerMockDb(blankWallet({ balance: 10, lifetimeEarned: 10 }));
    const { wallet, ledger } = await postLedgerMovement({
      userId: 42, direction: "credit", amount: 20, reason: "test", sourceType: "manual",
    }, db);
    expect(wallet.balance).toBe(30);
    expect(wallet.lifetimeEarned).toBe(30);
    expect(ledger.balanceAfter).toBe(30);
    expect(ledger.direction).toBe("credit");
    expect(getLedgerRows()).toHaveLength(1);
    expect(getWallet()?.balance).toBe(30);
  });

  it("un débito decrementa balance e incrementa lifetimeSpent", async () => {
    const { db, getWallet } = makeLedgerMockDb(blankWallet({ balance: 30 }));
    const { wallet } = await postLedgerMovement({
      userId: 42, direction: "debit", amount: 10, reason: "gasto", sourceType: "product",
    }, db);
    expect(wallet.balance).toBe(20);
    expect(wallet.lifetimeSpent).toBe(10);
    expect(getWallet()?.balance).toBe(20);
  });

  it("un débito que dejaría el saldo negativo lanza INSUFFICIENT_BALANCE y no modifica nada", async () => {
    const { db, getWallet, getLedgerRows } = makeLedgerMockDb(blankWallet({ balance: 5 }));
    await expect(
      postLedgerMovement({ userId: 42, direction: "debit", amount: 10, reason: "gasto", sourceType: "product" }, db)
    ).rejects.toThrow(TokenEngineError);
    expect(getWallet()?.balance).toBe(5);
    expect(getLedgerRows()).toHaveLength(0);
  });

  it("un importe no entero o <= 0 lanza INVALID_AMOUNT", async () => {
    const { db } = makeLedgerMockDb(blankWallet());
    await expect(
      postLedgerMovement({ userId: 42, direction: "credit", amount: 0, reason: "x", sourceType: "manual" }, db)
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(
      postLedgerMovement({ userId: 42, direction: "credit", amount: 1.5, reason: "x", sourceType: "manual" }, db)
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("crea el wallet automáticamente si el usuario no tenía ninguno (primer movimiento)", async () => {
    const { db, getWallet } = makeLedgerMockDb(null);
    const { wallet } = await postLedgerMovement({
      userId: 99, direction: "credit", amount: 15, reason: "bienvenida", sourceType: "manual",
    }, db);
    expect(wallet.balance).toBe(15);
    expect(getWallet()?.userId).toBe(99);
  });
});

describe("tokenLedgerService — idempotencia (idempotency_key)", () => {
  it("una segunda llamada con la misma idempotencyKey devuelve el movimiento existente sin duplicar el efecto", async () => {
    const { db, queuePreInsertSelect, getLedgerRows } = makeLedgerMockDb(blankWallet({ balance: 0 }));
    const existingLedger = { id: 1, walletId: 1, userId: 42, direction: "credit", amount: 10, balanceAfter: 10, reason: "x", sourceType: "manual", idempotencyKey: "evt-1", createdAt: new Date() };
    queuePreInsertSelect([existingLedger]); // el pre-check de idempotencia SÍ la encuentra
    const { wallet, ledger } = await postLedgerMovement({
      userId: 42, direction: "credit", amount: 10, reason: "x", sourceType: "manual", idempotencyKey: "evt-1",
    }, db);
    expect(ledger.id).toBe(1);
    expect(getLedgerRows()).toHaveLength(0); // no se llegó a insertar nada nuevo
    expect(wallet.balance).toBe(0); // el wallet no se tocó — se devolvió el existente sin re-aplicar el efecto
  });

  it("una carrera real (ER_DUP_ENTRY al insertar) se resuelve reconsultando el movimiento existente, sin lanzar", async () => {
    const { db, queuePreInsertSelect, forceDuplicateOnce } = makeLedgerMockDb(blankWallet({ balance: 0 }));
    const existingLedger = { id: 1, walletId: 1, userId: 42, direction: "credit", amount: 10, balanceAfter: 10, reason: "x", sourceType: "manual", idempotencyKey: "evt-race", createdAt: new Date() };
    // 1er pre-check: no la encuentra (dos peticiones pasan el pre-check antes
    // de que ninguna inserte). 2º pre-check (dentro del catch, tras el
    // ER_DUP_ENTRY forzado): SÍ la encuentra — otro proceso ganó la carrera.
    queuePreInsertSelect([]);
    queuePreInsertSelect([existingLedger]);
    forceDuplicateOnce();
    const { ledger } = await postLedgerMovement({
      userId: 42, direction: "credit", amount: 10, reason: "x", sourceType: "manual", idempotencyKey: "evt-race",
    }, db);
    expect(ledger.id).toBe(1);
  });
});

describe("tokenLedgerService — ajuste manual (adjustManualTokens)", () => {
  it("requiere un motivo — REASON_REQUIRED si viene vacío", async () => {
    const { db } = makeLedgerMockDb(blankWallet());
    await expect(
      adjustManualTokens({ userId: 42, direction: "credit", amount: 10, reason: "  ", adminUserId: 1 }, db)
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });

  it("aplica el ajuste como movimiento normal (source_type=manual_adjustment)", async () => {
    const { db } = makeLedgerMockDb(blankWallet({ balance: 0 }));
    const { ledger } = await adjustManualTokens({ userId: 42, direction: "credit", amount: 25, reason: "Bienvenida", adminUserId: 1 }, db);
    expect(ledger.sourceType).toBe("manual_adjustment");
    expect(ledger.amount).toBe(25);
    expect(ledger.createdByUserId).toBe(1);
  });
});

describe("tokenLedgerService — reversión administrativa (reverseTransaction)", () => {
  it("revierte un crédito con un débito opuesto del mismo importe", async () => {
    const { db, queuePreInsertSelect, getWallet } = makeLedgerMockDb(blankWallet({ balance: 50 }));
    const original = { id: 1, walletId: 1, userId: 42, direction: "credit", amount: 50, balanceAfter: 50, reason: "x", sourceType: "manual", createdAt: new Date() };
    queuePreInsertSelect([original]); // lookup por id
    queuePreInsertSelect([]);         // ¿ya revertido? — no
    const { wallet, ledger } = await reverseTransaction({ ledgerId: 1, reason: "Error de carga", adminUserId: 1 }, db);
    expect(ledger.direction).toBe("debit");
    expect(ledger.amount).toBe(50);
    expect(ledger.reversedLedgerId).toBe(1);
    expect(wallet.balance).toBe(0);
    expect(getWallet()?.balance).toBe(0);
  });

  it("impide una segunda reversión del mismo movimiento (ALREADY_REVERSED)", async () => {
    const { db, queuePreInsertSelect } = makeLedgerMockDb(blankWallet({ balance: 50 }));
    const original = { id: 1, walletId: 1, userId: 42, direction: "credit", amount: 50, balanceAfter: 50, reason: "x", sourceType: "manual", createdAt: new Date() };
    const previousReversal = { id: 2, walletId: 1, userId: 42, direction: "debit", amount: 50, balanceAfter: 0, reason: "rev", sourceType: "reversal", reversedLedgerId: 1, createdAt: new Date() };
    queuePreInsertSelect([original]);        // lookup por id
    queuePreInsertSelect([previousReversal]); // ¿ya revertido? — sí
    await expect(
      reverseTransaction({ ledgerId: 1, reason: "otro intento", adminUserId: 1 }, db)
    ).rejects.toMatchObject({ code: "ALREADY_REVERSED" });
  });

  it("lanza NOT_FOUND si el movimiento no existe", async () => {
    const { db, queuePreInsertSelect } = makeLedgerMockDb(blankWallet());
    queuePreInsertSelect([]); // lookup por id — no existe
    await expect(
      reverseTransaction({ ledgerId: 999, reason: "x", adminUserId: 1 }, db)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requiere un motivo", async () => {
    const { db } = makeLedgerMockDb(blankWallet({ balance: 50 }));
    await expect(
      reverseTransaction({ ledgerId: 1, reason: "", adminUserId: 1 }, db)
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });
});

describe("tokenLedgerService — atomicidad y concurrencia (dos gastos simultáneos)", () => {
  /**
   * Simula la garantía real de MySQL (SELECT...FOR UPDATE dentro de una
   * transacción serializa el acceso a la misma fila de wallet): este mock
   * encadena cada `.transaction()` tras la anterior, de forma que la 2ª
   * llamada solo empieza a leer el wallet cuando la 1ª ya ha terminado de
   * escribirlo — exactamente lo que un lock de fila real garantizaría.
   */
  function makeConcurrentMockDb(initialWallet: Record<string, unknown>) {
    let wallet = { ...initialWallet };
    const ledgerRows: Array<Record<string, unknown>> = [];
    let nextLedgerId = 1;
    let lockChain: Promise<unknown> = Promise.resolve();

    function makeTxBuilder() {
      let table: unknown = null;
      let insertedLedgerRow: Record<string, unknown> | null = null;
      let hasInserted = false;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.from = (t: unknown) => { table = t; return b; };
      b.where = () => b;
      b.limit = () => b;
      b.for = () => b;
      b.insert = (t: unknown) => { table = t; return b; };
      b.update = (t: unknown) => { table = t; return b; };
      b.set = (fields: Record<string, unknown>) => { if (table === tokenWallets) wallet = { ...wallet, ...fields }; return b; };
      b.values = (v: Record<string, unknown>) => {
        if (table === tokenWallets) { wallet = { id: 1, ...v }; return Promise.resolve([{ insertId: 1 }]); }
        const row = { id: nextLedgerId++, ...v };
        ledgerRows.push(row);
        insertedLedgerRow = row;
        hasInserted = true;
        return Promise.resolve([{ insertId: row.id }]);
      };
      b.then = (resolve: (v: unknown) => void) => {
        if (table === tokenWallets) return resolve([wallet]);
        if (table === tokenLedger) return resolve(hasInserted ? [insertedLedgerRow] : []);
        return resolve([]);
      };
      return b;
    }

    const db: Record<string, unknown> = {
      transaction: (cb: (tx: unknown) => Promise<unknown>) => {
        const run = lockChain.then(() => cb(makeTxBuilder()));
        lockChain = run.catch(() => {});
        return run;
      },
    };
    return { db: db as unknown as Parameters<typeof postLedgerMovement>[1], getWallet: () => wallet, getLedgerRows: () => ledgerRows };
  }

  it("dos débitos concurrentes sobre el mismo wallet nunca permiten un saldo negativo (no se gasta dos veces el mismo saldo)", async () => {
    const { db, getWallet, getLedgerRows } = makeConcurrentMockDb(blankWallet({ balance: 100 }));

    const results = await Promise.allSettled([
      postLedgerMovement({ userId: 42, direction: "debit", amount: 70, reason: "gasto A", sourceType: "product" }, db),
      postLedgerMovement({ userId: 42, direction: "debit", amount: 70, reason: "gasto B", sourceType: "product" }, db),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    expect(fulfilled).toHaveLength(1); // solo uno de los dos puede completarse (100 - 70 = 30, no llega para el segundo)
    expect(rejected).toHaveLength(1);
    expect(getWallet()?.balance).toBeGreaterThanOrEqual(0);
    expect(getLedgerRows()).toHaveLength(1); // solo un movimiento quedó registrado
  });
});

describe("tokenLedgerService — política de saldo negativo (Loyalty Production Hardening, spec §7)", () => {
  it("una reversión SÍ puede dejar el wallet en negativo (earn ya gastado)", async () => {
    // wallet=100 → gasta 100 → wallet=0 → se revierte el earn original de 100 → wallet=-100
    const { db, queuePreInsertSelect, getWallet } = makeLedgerMockDb(blankWallet({ balance: 0, lifetimeEarned: 100, lifetimeSpent: 100 }));
    const original = { id: 1, walletId: 1, userId: 42, direction: "credit", amount: 100, balanceAfter: 100, reason: "x", sourceType: "manual", createdAt: new Date() };
    queuePreInsertSelect([original]); // lookup por id
    queuePreInsertSelect([]);         // ¿ya revertido? — no
    const { wallet, ledger } = await reverseTransaction({ ledgerId: 1, reason: "Compra reembolsada", adminUserId: null }, db);
    expect(ledger.direction).toBe("debit");
    expect(wallet.balance).toBe(-100);
    expect(getWallet()?.balance).toBe(-100);
  });

  it("un gasto ORDINARIO sigue bloqueado en negativo aunque el wallet ya esté negativo por una reversión previa", async () => {
    const { db } = makeLedgerMockDb(blankWallet({ balance: -100 }));
    await expect(
      postLedgerMovement({ userId: 42, direction: "debit", amount: 10, reason: "canje QR", sourceType: "consumption" }, db)
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  // FIX-01 — bug real encontrado escribiendo la saga del spec §41: el guard
  // de saldo negativo comprobaba `newBalance < 0` sin mirar `direction`, así
  // que un CREDIT (earn) que no cubriera de una vez toda la deuda de un
  // wallet ya negativo también lanzaba INSUFFICIENT_BALANCE — rompiendo por
  // completo la "amortización natural de la deuda" (spec §30 caso 16) que
  // el propio comentario de cabecera de este archivo ya prometía.
  it("un CRÉDITO (earn) SIEMPRE se aplica íntegro aunque el wallet esté en negativo — nunca lanza INSUFFICIENT_BALANCE, solo amortiza la deuda", async () => {
    const { db, getWallet } = makeLedgerMockDb(blankWallet({ balance: -100, lifetimeEarned: 0, lifetimeSpent: 100 }));
    const { wallet } = await postLedgerMovement(
      { userId: 42, direction: "credit", amount: 40, reason: "Asistencia", sourceType: "attendance" }, db
    );
    expect(wallet.balance).toBe(-60); // amortiza, nunca se rechaza
    expect(getWallet()?.balance).toBe(-60);
  });

  it("reverseTransaction acepta adminUserId=null (reversión automática por refund, sin admin humano)", async () => {
    const { db, queuePreInsertSelect } = makeLedgerMockDb(blankWallet({ balance: 50 }));
    const original = { id: 1, walletId: 1, userId: 42, direction: "credit", amount: 50, balanceAfter: 50, reason: "x", sourceType: "manual", createdAt: new Date() };
    queuePreInsertSelect([original]);
    queuePreInsertSelect([]);
    const { ledger } = await reverseTransaction({ ledgerId: 1, reason: "Refund automático Fourvenues", adminUserId: null }, db);
    expect(ledger.createdByUserId).toBeNull();
  });
});

describe("tokenLedgerService — FIX-01: reverseTransaction es idempotente frente a reversión concurrente/duplicada", () => {
  it("la idempotencyKey que reverseTransaction pasa al insert es determinista: 'reversal:<ledgerId>' (no aleatoria, no basada en reason)", async () => {
    const { db, queuePreInsertSelect, getLedgerRows } = makeLedgerMockDb(blankWallet({ balance: 50 }));
    const original = { id: 7, walletId: 1, userId: 42, direction: "credit", amount: 50, balanceAfter: 50, reason: "x", sourceType: "manual", createdAt: new Date() };
    queuePreInsertSelect([original]); // lookup por id
    queuePreInsertSelect([]);         // ¿ya revertido? — no
    queuePreInsertSelect([]);         // pre-check de idempotencia dentro de postLedgerMovementInTx — no existe todavía
    await reverseTransaction({ ledgerId: 7, reason: "Reembolso de entrada — pedido #900", adminUserId: 1 }, db);
    expect(getLedgerRows()[0].idempotencyKey).toBe("reversal:7");
  });

  it("dos reversiones 'concurrentes' del MISMO ledgerId (simulado como ER_DUP_ENTRY en el insert, mismo mecanismo ya probado para postLedgerMovement) convergen en UNA sola fila — la segunda nunca duplica el clawback económico", async () => {
    // Antes de este fix, reverseTransaction() nunca pasaba idempotencyKey, así
    // que esta colisión no podía ni producirse: cada llamada insertaba su
    // propia fila de reversión sin que el UNIQUE de MySQL la protegiera —
    // doble clawback real. Este test prueba que, tras el fix, el mismo
    // mecanismo de "ER_DUP_ENTRY → reconsultar por idempotencyKey" que ya
    // protege postLedgerMovement ahora también cubre reverseTransaction.
    const { db, queuePreInsertSelect, forceDuplicateOnce, getLedgerRows } = makeLedgerMockDb(blankWallet({ balance: 50 }));
    const original = { id: 1, walletId: 1, userId: 42, direction: "credit", amount: 50, balanceAfter: 50, reason: "x", sourceType: "manual", createdAt: new Date() };
    const winningReversal = {
      id: 2, walletId: 1, userId: 42, direction: "debit", amount: 50, balanceAfter: 0,
      reason: "Reembolso — proceso A", sourceType: "reversal", reversedLedgerId: 1,
      idempotencyKey: "reversal:1", createdAt: new Date(),
    };
    queuePreInsertSelect([original]);        // lookup por id (ninguno de los "dos procesos" ha comprometido nada aún)
    queuePreInsertSelect([]);                // ¿ya revertido? — no, todavía no (misma condición de carrera que motiva el fix)
    queuePreInsertSelect([]);                // pre-check de idempotencia — no lo ve todavía
    queuePreInsertSelect([winningReversal]); // reconsulta tras el ER_DUP_ENTRY forzado — el otro proceso ya ganó la carrera
    forceDuplicateOnce();
    const { ledger } = await reverseTransaction({ ledgerId: 1, reason: "Reembolso — proceso B", adminUserId: null }, db);
    expect(ledger.id).toBe(2); // devuelve la reversión que YA existía, no una nueva
    expect(getLedgerRows()).toHaveLength(0); // este proceso nunca insertó nada — cero duplicación
  });
});

describe("tokenLedgerService — lifetime_earned/lifetime_spent correctos en reversiones (Loyalty Production Hardening)", () => {
  it("revertir un CRÉDITO resta de lifetime_earned — NUNCA suma a lifetime_spent", async () => {
    const { db, queuePreInsertSelect, getWallet } = makeLedgerMockDb(blankWallet({ balance: 100, lifetimeEarned: 100, lifetimeSpent: 0 }));
    const original = { id: 1, walletId: 1, userId: 42, direction: "credit", amount: 100, balanceAfter: 100, reason: "x", sourceType: "manual", createdAt: new Date() };
    queuePreInsertSelect([original]);
    queuePreInsertSelect([]);
    await reverseTransaction({ ledgerId: 1, reason: "Error de carga", adminUserId: 1 }, db);
    expect(getWallet()?.lifetimeEarned).toBe(0);
    expect(getWallet()?.lifetimeSpent).toBe(0); // el Student nunca "gastó" nada — no debe aparecer como spend
  });

  it("revertir un DÉBITO resta de lifetime_spent — NUNCA suma a lifetime_earned", async () => {
    const { db, queuePreInsertSelect, getWallet } = makeLedgerMockDb(blankWallet({ balance: 0, lifetimeEarned: 100, lifetimeSpent: 100 }));
    const original = { id: 1, walletId: 1, userId: 42, direction: "debit", amount: 100, balanceAfter: 0, reason: "canje", sourceType: "consumption", createdAt: new Date() };
    queuePreInsertSelect([original]);
    queuePreInsertSelect([]);
    await reverseTransaction({ ledgerId: 1, reason: "Canje anulado", adminUserId: 1 }, db);
    expect(getWallet()?.lifetimeSpent).toBe(0);
    expect(getWallet()?.lifetimeEarned).toBe(100); // no debe aparecer como si hubiera ganado tokens nuevos
  });

  it("lifetime_earned/lifetime_spent nunca bajan de 0 aunque la reversión sea mayor que el contador actual (defensivo)", async () => {
    const { db, queuePreInsertSelect, getWallet } = makeLedgerMockDb(blankWallet({ balance: 100, lifetimeEarned: 30, lifetimeSpent: 0 }));
    const original = { id: 1, walletId: 1, userId: 42, direction: "credit", amount: 100, balanceAfter: 100, reason: "x", sourceType: "manual", createdAt: new Date() };
    queuePreInsertSelect([original]);
    queuePreInsertSelect([]);
    await reverseTransaction({ ledgerId: 1, reason: "x", adminUserId: 1 }, db);
    expect(getWallet()?.lifetimeEarned).toBe(0); // clamp, nunca negativo
  });

  it("un movimiento ORDINARIO (no reversión) sigue sumando lifetime_earned/lifetime_spent como siempre", async () => {
    const { db, getWallet } = makeLedgerMockDb(blankWallet({ balance: 0, lifetimeEarned: 10, lifetimeSpent: 5 }));
    await postLedgerMovement({ userId: 42, direction: "credit", amount: 20, reason: "x", sourceType: "attendance" }, db);
    expect(getWallet()?.lifetimeEarned).toBe(30);
    expect(getWallet()?.lifetimeSpent).toBe(5);
  });
});

describe("tokenLedgerService — FIX-01: saga económica canónica del refund clawback (spec §41)", () => {
  it("compra +100 → gasta -100 → reembolso -100 clawback → balance -100 → no puede gastar → gana +40 → -60 → sigue sin poder gastar → gana +100 → +40 → solo puede gastar 40, nunca 100", async () => {
    const { db, getWallet, queuePreInsertSelect } = makeLedgerMockDb(blankWallet({ balance: 0 }));

    // 1) Compra: +100 ST (recompensa de compra real)
    const { ledger: purchaseGrant } = await postLedgerMovement(
      { userId: 42, direction: "credit", amount: 100, reason: "Compra de entrada", sourceType: "ticket", sourceId: 900 }, db
    );
    expect(getWallet()?.balance).toBe(100);

    // 2) El Student gasta esos 100 ST enteros
    await postLedgerMovement(
      { userId: 42, direction: "debit", amount: 100, reason: "Canje universal", sourceType: "universal_spend" }, db
    );
    expect(getWallet()?.balance).toBe(0);

    // 3) Reembolso total de la compra → clawback del importe HISTÓRICO real (100), no de "lo que quede"
    queuePreInsertSelect([purchaseGrant]); // lookup por id
    queuePreInsertSelect([]);              // ¿ya revertido? — no
    queuePreInsertSelect([]);              // pre-check de idempotencia — no existe todavía
    const { wallet: afterRefund } = await reverseTransaction(
      { ledgerId: purchaseGrant.id, reason: "Reembolso de entrada — pedido #900", adminUserId: null }, db
    );
    expect(afterRefund.balance).toBe(-100); // NUNCA 0, NUNCA "clawback omitido por falta de saldo"

    // 4) Con saldo negativo, un gasto ordinario de 1 ST se rechaza SIEMPRE
    await expect(
      postLedgerMovement({ userId: 42, direction: "debit", amount: 1, reason: "intento de gasto", sourceType: "universal_spend" }, db)
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    // 5) Gana 40 ST reales — la deuda se amortiza parcialmente, sigue en negativo
    await postLedgerMovement({ userId: 42, direction: "credit", amount: 40, reason: "Asistencia", sourceType: "attendance" }, db);
    expect(getWallet()?.balance).toBe(-60);

    // 6) Sigue sin poder gastar nada mientras el saldo sea negativo
    await expect(
      postLedgerMovement({ userId: 42, direction: "debit", amount: 1, reason: "intento de gasto", sourceType: "universal_spend" }, db)
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    // 7) Gana 100 ST más — la deuda queda saldada y sobran 40 ST reales gastables
    await postLedgerMovement({ userId: 42, direction: "credit", amount: 100, reason: "Compra de entrada", sourceType: "ticket", sourceId: 950 }, db);
    expect(getWallet()?.balance).toBe(40);

    // 8) Puede gastar exactamente 40 — nunca 41, y desde luego nunca 100
    await expect(
      postLedgerMovement({ userId: 42, direction: "debit", amount: 41, reason: "intento de gasto excesivo", sourceType: "universal_spend" }, db)
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    await postLedgerMovement({ userId: 42, direction: "debit", amount: 40, reason: "canje real", sourceType: "universal_spend" }, db);
    expect(getWallet()?.balance).toBe(0);
  });

  it("reembolso total tras un gasto PARCIAL (spec §2 ejemplo): +100, gasta 80, reembolso → balance -80, no 0 y no 20", async () => {
    const { db, getWallet, queuePreInsertSelect } = makeLedgerMockDb(blankWallet({ balance: 0 }));
    const { ledger: purchaseGrant } = await postLedgerMovement(
      { userId: 42, direction: "credit", amount: 100, reason: "Compra de entrada", sourceType: "ticket", sourceId: 901 }, db
    );
    await postLedgerMovement({ userId: 42, direction: "debit", amount: 80, reason: "Canje universal", sourceType: "universal_spend" }, db);
    expect(getWallet()?.balance).toBe(20);

    queuePreInsertSelect([purchaseGrant]);
    queuePreInsertSelect([]);
    queuePreInsertSelect([]);
    const { wallet } = await reverseTransaction({ ledgerId: purchaseGrant.id, reason: "Reembolso de entrada — pedido #901", adminUserId: null }, db);
    expect(wallet.balance).toBe(-80); // el importe HISTÓRICO completo (100), no "lo que le quedaba" (20)
  });

  it("una compra que NO generó SegoTokens (0 ST) no tiene nada que revertir — no-op limpio, nunca un movimiento de importe 0", async () => {
    // postLedgerMovement ya rechaza amount<=0 con INVALID_AMOUNT (ver arriba)
    // — este test documenta que ese guard es, en sí mismo, la garantía de
    // que un clawback nunca puede intentar crear una fila "-0 ST" real.
    const { db } = makeLedgerMockDb(blankWallet({ balance: 0 }));
    await expect(
      postLedgerMovement({ userId: 42, direction: "debit", amount: 0, reason: "clawback de una compra sin recompensa", sourceType: "reversal" }, db)
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });
});

describe("tokenLedgerService — isLedgerEntryReversed", () => {
  it("devuelve true si otra fila referencia reversedLedgerId", async () => {
    const { db, queuePreInsertSelect } = makeLedgerMockDb(blankWallet());
    queuePreInsertSelect([{ id: 2 }]);
    expect(await isLedgerEntryReversed(1, db)).toBe(true);
  });

  it("devuelve false si ninguna fila lo referencia", async () => {
    const { db, queuePreInsertSelect } = makeLedgerMockDb(blankWallet());
    queuePreInsertSelect([]);
    expect(await isLedgerEntryReversed(1, db)).toBe(false);
  });
});

describe("tokenLedgerService — findActiveGrantBySource (MG-02, confirmación de compra §11)", () => {
  it("existe un grant real y no revertido → devuelve ledgerId + amount", async () => {
    const { db, queuePreInsertSelect } = makeLedgerMockDb(blankWallet());
    queuePreInsertSelect([{ id: 501, amount: 100, direction: "credit" }]); // el grant
    queuePreInsertSelect([]); // isLedgerEntryReversed → nadie lo referencia
    const result = await findActiveGrantBySource(42, "ticket", 900, db);
    expect(result).toEqual({ ledgerId: 501, amount: 100 });
  });

  it("el grant existe pero YA fue revertido (reembolso) → nunca se reporta como ganado", async () => {
    const { db, queuePreInsertSelect } = makeLedgerMockDb(blankWallet());
    queuePreInsertSelect([{ id: 501, amount: 100, direction: "credit" }]);
    queuePreInsertSelect([{ id: 777 }]); // isLedgerEntryReversed → SÍ hay una reversión
    const result = await findActiveGrantBySource(42, "ticket", 900, db);
    expect(result).toBeNull();
  });

  it("no existe ningún grant para ese origen/sourceId → null (nunca fabrica una recompensa)", async () => {
    const { db, queuePreInsertSelect } = makeLedgerMockDb(blankWallet());
    queuePreInsertSelect([]); // sin fila de ledger
    const result = await findActiveGrantBySource(42, "ticket", 900, db);
    expect(result).toBeNull();
  });
});
