/**
 * crossModuleSpendConcurrency.test.ts — PRE-16.2 gate de seguridad económica
 * (riesgo "concurrencia cruzada", spec del gate §4): tokenPaymentRequestService.ts
 * (PRE-16.1, pago presencial) y checkoutService.ts (PRE-16.2, checkout online)
 * NUNCA gastan SegoTokens por su cuenta — ambos delegan la captura real al
 * MISMO punto único, captureTokenSpend() (tokenSpendService.ts), que a su vez
 * delega el movimiento de ledger a postLedgerMovementInTx()
 * (tokenLedgerService.ts, SELECT...FOR UPDATE real dentro de una transacción).
 *
 * A diferencia de:
 *  - tokenSpendService.test.ts, que MOCKEA postLedgerMovementInTx para
 *    probar solo la lógica propia de reserve/capture/release en aislamiento;
 *  - checkoutService.test.ts / tokenPaymentRequestService.test.ts, que
 *    MOCKEAN captureTokenSpend para probar solo su propia orquestación;
 * este archivo NO mockea ninguno de los dos — usa la cadena real
 * captureTokenSpend → postLedgerMovementInTx sin ningún vi.mock, para
 * demostrar la garantía real de mutua exclusión entre AMBOS módulos sobre
 * el MISMO wallet de un Student.
 *
 * Reutiliza EXACTAMENTE la técnica de simulación de concurrencia ya
 * establecida en tokenLedgerService.test.ts ("atomicidad y concurrencia —
 * dos gastos simultáneos"): encadenar cada `.transaction()` tras el
 * anterior, de forma que la 2ª llamada solo empieza a leer una vez la 1ª ya
 * ha terminado de escribir — exactamente la garantía que un lock de fila
 * real (SELECT...FOR UPDATE dentro de una transacción MySQL) da en
 * producción. No se levanta ninguna base de datos real ni se construye
 * infraestructura nueva.
 *
 * LÍMITE HONESTO (a reportar tal cual en el gate): esto prueba que dos
 * llamadas a captureTokenSpend() para el mismo wallet nunca completan
 * ambas — la garantía real que importa (ninguna combinación de módulos
 * puede hacer doble gasto del mismo saldo) — pero sigue siendo un mock de
 * un único proceso Node de un solo hilo, no dos conexiones MySQL reales en
 * paralelo. Este repositorio no tiene infraestructura de test contra una
 * base de datos real (ningún *.test.ts levanta un contenedor MySQL) —
 * replicar eso sería construir infraestructura nueva, explícitamente fuera
 * de alcance de este gate.
 */
import { describe, it, expect } from "vitest";
import { captureTokenSpend } from "./tokenSpendService";
import { tokenSpendReservations, tokenWallets, tokenLedger } from "../../../drizzle/schema";

// ─── mismo extractor/matcher de condiciones que tokenSpendService.test.ts / benefitRuleEngine.test.ts ──
type CondPair = [column: string, op: "=" | "<>", value: unknown];
function extractCondPairs(node: any, pairs: CondPair[] = []): CondPair[] {
  if (!node || typeof node !== "object" || !Array.isArray(node.queryChunks)) return pairs;
  const chunks = node.queryChunks;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c && typeof c === "object" && "columnType" in c && typeof c.name === "string") {
      let op: "=" | "<>" = "=";
      for (let j = i + 1; j < chunks.length; j++) {
        const p = chunks[j];
        if (p && typeof p === "object" && "value" in p && Array.isArray((p as { value?: unknown }).value) && !("columnType" in p)) {
          const opStr = (p as { value: unknown[] }).value.join("");
          if (opStr.includes("<>") || opStr.includes("!=")) op = "<>";
        }
        if (p && typeof p === "object" && "brand" in p && "value" in p && !("columnType" in p)) {
          pairs.push([c.name as string, op, (p as { value: unknown }).value]);
          break;
        }
        if (p && typeof p === "object" && Array.isArray((p as { queryChunks?: unknown }).queryChunks)) break;
      }
    } else if (c && typeof c === "object" && Array.isArray(c.queryChunks)) {
      extractCondPairs(c, pairs);
    }
  }
  return pairs;
}
function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
function matchesCondition(row: Record<string, unknown>, cond: unknown): boolean {
  const pairs = extractCondPairs(cond);
  if (pairs.length === 0) return true;
  return pairs.every(([col, op, val]) => {
    const rowVal = row[toCamelCase(col)];
    return op === "=" ? rowVal === val : rowVal !== val;
  });
}

/**
 * Simula la garantía real de MySQL (SELECT...FOR UPDATE dentro de una
 * transacción serializa el acceso a la misma fila): cada `.transaction()`
 * se encadena tras el anterior — la 2ª llamada solo empieza a ejecutar su
 * callback cuando la 1ª ya ha terminado por completo (éxito o fallo),
 * idéntico al patrón ya usado en tokenLedgerService.test.ts.
 */
function makeCrossModuleConcurrentDb(initialWallet: Record<string, unknown>, initialReservations: Record<string, unknown>[]) {
  let wallet = { ...initialWallet };
  const reservations = initialReservations.map(r => ({ ...r }));
  const ledgerRows: Record<string, unknown>[] = [];
  let nextLedgerId = 1;
  let lockChain: Promise<unknown> = Promise.resolve();

  function makeTxBuilder() {
    let table: unknown = null;
    let mode: "select" | "insert" | "update" = "select";
    let lastCond: unknown = null;
    let updateValues: Record<string, unknown> | null = null;
    const b: any = {};
    b.select = () => { mode = "select"; return b; };
    b.from = (t: unknown) => { table = t; return b; };
    b.where = (cond: unknown) => { lastCond = cond; return b; };
    b.limit = () => b;
    b.for = () => b; // FOR UPDATE — la exclusión mutua real la da el encadenamiento de lockChain, no este no-op
    b.insert = (t: unknown) => { mode = "insert"; table = t; return b; };
    b.update = (t: unknown) => { mode = "update"; table = t; return b; };
    b.set = (v: Record<string, unknown>) => { updateValues = v; return b; };
    b.values = (v: Record<string, unknown>) => {
      if (table === tokenWallets) { wallet = { ...wallet, ...v }; return Promise.resolve([{ insertId: 1 }]); }
      const row = { id: nextLedgerId++, ...v };
      ledgerRows.push(row);
      return Promise.resolve([{ insertId: row.id }]);
    };
    b.then = (resolve: (v: unknown) => void) => {
      if (mode === "update") {
        if (table === tokenWallets) { wallet = { ...wallet, ...(updateValues ?? {}) }; return resolve(undefined); }
        if (table === tokenSpendReservations) {
          const row = reservations.find(r => matchesCondition(r, lastCond));
          if (row && updateValues) Object.assign(row, updateValues);
          return resolve(undefined);
        }
        return resolve(undefined);
      }
      if (table === tokenWallets) return resolve([wallet]);
      if (table === tokenLedger) {
        const match = ledgerRows.find(r => matchesCondition(r, lastCond));
        return resolve(match ? [match] : []);
      }
      if (table === tokenSpendReservations) return resolve(reservations.filter(r => matchesCondition(r, lastCond)));
      return resolve([]);
    };
    return b;
  }

  const db: any = {
    transaction: (cb: (tx: unknown) => Promise<unknown>) => {
      const run = lockChain.then(() => cb(makeTxBuilder()));
      lockChain = run.catch(() => {});
      return run;
    },
  };
  return { db, getWallet: () => wallet, getReservations: () => reservations, getLedgerRows: () => ledgerRows };
}

function reservationFixture(overrides: Record<string, unknown>) {
  return {
    userId: 42, walletId: 1, policyId: 1, venueId: 10, eventId: null, communityId: null,
    grossAmountCents: 7000, promotionalValueCents: 700, moneyDueCents: 0,
    status: "reserved", ledgerId: null, capturedAt: null, releasedAt: null, reversedAt: null,
    reversalLedgerId: null, expiresAt: new Date(Date.now() + 15 * 60_000), createdByUserId: 42, createdAt: new Date(),
    ...overrides,
  };
}

describe("captureTokenSpend — concurrencia CRUZADA entre módulos sobre el mismo wallet (Pre-16.2 gate §4)", () => {
  it("PRE-16.1 (pago presencial, tokenPaymentRequestService) y PRE-16.2 (checkout online, checkoutService) compitiendo por el MISMO wallet: nunca capturan ambas, el wallet nunca queda negativo, la perdedora queda visiblemente sin capturar (no a medias)", async () => {
    // wallet=100 ST; dos reservas de 70 ST cada una ya "reserved" (una nacida
    // del flujo presencial vía settleTokenPaymentRequest, otra del checkout
    // online vía settleAfterMoneyConfirmed) — juntas (140) superan el saldo.
    const presencial = reservationFixture({ id: 501, referenceType: "token_payment_request", referenceId: 77, tokensReserved: 70, idempotencyKey: "presential-req-77" });
    const online = reservationFixture({ id: 502, referenceType: "ticket_order", eventId: 5, referenceId: 88, tokensReserved: 70, idempotencyKey: "ticket_order_tokens:88" });
    const { db, getWallet, getReservations, getLedgerRows } = makeCrossModuleConcurrentDb(
      { id: 1, userId: 42, balance: 100, lifetimeEarned: 500, lifetimeSpent: 400 },
      [presencial, online],
    );

    // Mismas llamadas EXACTAS que hacen los call sites reales:
    // tokenPaymentRequestService.ts::settleTokenPaymentRequest (línea
    // `captureTokenSpend(view.reservation.id, tx)`) y
    // checkoutService.ts::settleAfterMoneyConfirmed (línea
    // `captureTokenSpend(opts.tokenReservationId, conn)`).
    const results = await Promise.allSettled([
      captureTokenSpend(501, db),
      captureTokenSpend(502, db),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    expect(getWallet().balance).toBe(30); // 100 - 70 — nunca se descuentan los dos tramos de 70
    expect(getWallet().balance as number).toBeGreaterThanOrEqual(0);
    expect(getLedgerRows()).toHaveLength(1); // un único movimiento de ledger — nunca doble gasto

    const captured = getReservations().filter(r => r.status === "captured");
    const stillReserved = getReservations().filter(r => r.status === "reserved");
    expect(captured).toHaveLength(1);
    expect(stillReserved).toHaveLength(1); // la perdedora vuelve a quedar "reserved" tal cual — nunca "capturada a medias"
  });

  it("dos checkouts online simultáneos (Pre-16.2) del MISMO Student — p.ej. doble pestaña/doble clic sobre dos pedidos distintos — compitiendo por el mismo wallet: la misma garantía aplica sin que intervenga el flujo presencial", async () => {
    const onlineA = reservationFixture({ id: 601, referenceType: "ticket_order", eventId: 5, referenceId: 91, tokensReserved: 60, idempotencyKey: "ticket_order_tokens:91" });
    const onlineB = reservationFixture({ id: 602, referenceType: "ticket_order", eventId: 6, referenceId: 92, tokensReserved: 60, idempotencyKey: "ticket_order_tokens:92" });
    const { db, getWallet, getReservations, getLedgerRows } = makeCrossModuleConcurrentDb(
      { id: 1, userId: 42, balance: 100, lifetimeEarned: 500, lifetimeSpent: 400 },
      [onlineA, onlineB],
    );

    const results = await Promise.allSettled([
      captureTokenSpend(601, db),
      captureTokenSpend(602, db),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(getWallet().balance as number).toBeGreaterThanOrEqual(0);
    expect(getLedgerRows()).toHaveLength(1);
    expect(getReservations().filter(r => r.status === "captured")).toHaveLength(1);
    expect(getReservations().filter(r => r.status === "reserved")).toHaveLength(1);
  });
});
