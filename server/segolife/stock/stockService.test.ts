/**
 * stockService.test.ts — SEGOLIFE FASE 10 (spec §27-43/§107-109). Stock
 * físico de venue_products — concurrencia, idempotencia, política de stock
 * negativo, restock de reembolso solo si el operador lo decide.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzleConditionMockFactory, MockTable, type MockCond } from "../_testHelpers/drizzleTableMock";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, ...drizzleConditionMockFactory() };
});

import { venueProducts, inventoryMovements } from "../../../drizzle/schema";
import {
  reserveAndDecrementForSale, reverseStockForSale, linkStockMovementsToTransaction,
  recordRefundRestock, recordBenefitRedemptionStock, recordWaste, recordAdjustment, recordOpening,
} from "./stockService";

function productFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, venueId: 10, name: "Cerveza", stockTracked: true, currentStockCached: 10, allowNegativeStock: false, lowStockThreshold: null, ...overrides };
}

function makeDb(products: Array<Record<string, unknown>>, movements: Array<Record<string, unknown>> = []) {
  const productsTable = new MockTable(venueProducts as unknown as Record<string, unknown>, products);
  const movementsTable = new MockTable(inventoryMovements as unknown as Record<string, unknown>, movements);

  function tableFor(t: unknown) {
    if (t === venueProducts) return productsTable;
    if (t === inventoryMovements) return movementsTable;
    throw new Error("mock: tabla desconocida");
  }

  function builder() {
    let mode: "select" | "insert" | "update" = "select";
    let table: unknown = null;
    let cond: MockCond = undefined;
    let setValues: Record<string, unknown> | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.select = () => { mode = "select"; return b; };
    b.from = (t: unknown) => { table = t; return b; };
    b.insert = (t: unknown) => { mode = "insert"; table = t; return b; };
    b.update = (t: unknown) => { mode = "update"; table = t; return b; };
    b.set = (v: Record<string, unknown>) => { setValues = v; return b; };
    b.where = (c: MockCond) => { cond = c; return b; };
    b.for = () => b;
    b.limit = () => b;
    b.orderBy = () => b;
    b.values = (v: Record<string, unknown>) => {
      const row = tableFor(table).insert(v);
      return Promise.resolve([{ insertId: row.id }]);
    };
    b.then = (resolve: (v: unknown) => void) => {
      if (mode === "select") return resolve(tableFor(table).select(cond));
      if (mode === "update") return resolve([{ affectedRows: tableFor(table).update(cond, setValues!) }]);
      return resolve([]);
    };
    return b;
  }
  const outer = builder();
  // Simula el rollback real de conn.transaction(): si el callback lanza, las
  // filas mutadas dentro de la transacción se restauran (MySQL real hace
  // esto vía ROLLBACK — el mock in-memory no lo hace solo, hay que emularlo
  // para probar de verdad la atomicidad "todo o nada" del spec §40).
  outer.transaction = async (cb: (tx: unknown) => Promise<unknown>) => {
    const productsSnapshot = productsTable.rows.map(r => ({ ...r }));
    const movementsSnapshot = movementsTable.rows.map(r => ({ ...r }));
    try {
      return await cb(builder());
    } catch (err) {
      productsTable.rows = productsSnapshot;
      movementsTable.rows = movementsSnapshot;
      throw err;
    }
  };
  return { db: outer, productsTable, movementsTable };
}

describe("reserveAndDecrementForSale — spec §32/§40/§62", () => {
  it("#1 decrementa stock de un producto tracked por la cantidad vendida", async () => {
    const { db, productsTable } = makeDb([productFixture({ currentStockCached: 10 })]);
    await reserveAndDecrementForSale([{ venueProductId: 1, quantity: 3 }], 10, "sale:abc", 5, db);
    expect(productsTable.rows[0].currentStockCached).toBe(7);
  });

  it("#2 omite en silencio productos sin stockTracked (spec §28)", async () => {
    const { db, productsTable, movementsTable } = makeDb([productFixture({ stockTracked: false, currentStockCached: 10 })]);
    await reserveAndDecrementForSale([{ venueProductId: 1, quantity: 3 }], 10, "sale:abc", 5, db);
    expect(productsTable.rows[0].currentStockCached).toBe(10); // sin cambios
    expect(movementsTable.rows).toHaveLength(0);
  });

  it("#3 bloquea la venta completa si falta stock de CUALQUIER línea (allowNegativeStock=false)", async () => {
    const { db, productsTable, movementsTable } = makeDb([
      productFixture({ id: 1, currentStockCached: 10 }),
      productFixture({ id: 2, currentStockCached: 1 }),
    ]);
    await expect(reserveAndDecrementForSale(
      [{ venueProductId: 1, quantity: 2 }, { venueProductId: 2, quantity: 5 }], 10, "sale:xyz", 5, db,
    )).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    // Producto 1 NO debe quedar decrementado aunque su línea individualmente fuera válida — todo o nada.
    expect(productsTable.rows.find(r => r.id === 1)!.currentStockCached).toBe(10);
    expect(movementsTable.rows).toHaveLength(0);
  });

  it("#4 permite negativo cuando allowNegativeStock=true", async () => {
    const { db, productsTable } = makeDb([productFixture({ currentStockCached: 2, allowNegativeStock: true })]);
    await reserveAndDecrementForSale([{ venueProductId: 1, quantity: 5 }], 10, "sale:neg", 5, db);
    expect(productsTable.rows[0].currentStockCached).toBe(-3);
  });

  it("#5 reintento con el MISMO idempotencyKeyPrefix no decrementa dos veces (spec §32/§62, retry de red)", async () => {
    const { db, productsTable, movementsTable } = makeDb([productFixture({ currentStockCached: 10 })]);
    await reserveAndDecrementForSale([{ venueProductId: 1, quantity: 3 }], 10, "sale:retry", 5, db);
    await reserveAndDecrementForSale([{ venueProductId: 1, quantity: 3 }], 10, "sale:retry", 5, db); // mismo prefix — reintento
    expect(productsTable.rows[0].currentStockCached).toBe(7); // NUNCA 4
    expect(movementsTable.rows).toHaveLength(1);
  });

  it("#6 decrementa correctamente varios productos distintos en una misma venta", async () => {
    const { db, productsTable } = makeDb([
      productFixture({ id: 1, currentStockCached: 10 }),
      productFixture({ id: 2, currentStockCached: 5 }),
    ]);
    await reserveAndDecrementForSale([{ venueProductId: 1, quantity: 2 }, { venueProductId: 2, quantity: 1 }], 10, "sale:multi", 5, db);
    expect(productsTable.rows.find(r => r.id === 1)!.currentStockCached).toBe(8);
    expect(productsTable.rows.find(r => r.id === 2)!.currentStockCached).toBe(4);
  });
});

describe("reverseStockForSale — compensación simétrica (spec, mismo criterio que reverseTokenSpend)", () => {
  it("#7 revierte exactamente el decremento aplicado, restaurando el balance original", async () => {
    const { db, productsTable } = makeDb([productFixture({ currentStockCached: 10 })]);
    await reserveAndDecrementForSale([{ venueProductId: 1, quantity: 4 }], 10, "sale:fail", 5, db);
    expect(productsTable.rows[0].currentStockCached).toBe(6);
    await reverseStockForSale("sale:fail", 5, db);
    expect(productsTable.rows[0].currentStockCached).toBe(10);
  });

  it("#8 reversión es idempotente — repetirla no vuelve a sumar stock", async () => {
    const { db, productsTable } = makeDb([productFixture({ currentStockCached: 10 })]);
    await reserveAndDecrementForSale([{ venueProductId: 1, quantity: 4 }], 10, "sale:fail2", 5, db);
    await reverseStockForSale("sale:fail2", 5, db);
    await reverseStockForSale("sale:fail2", 5, db);
    expect(productsTable.rows[0].currentStockCached).toBe(10); // nunca 14
  });
});

describe("linkStockMovementsToTransaction — enlace best-effort (referenceId a posteriori)", () => {
  it("#9 actualiza referenceId de los movimientos con ese prefix", async () => {
    const { db, movementsTable } = makeDb([productFixture({ currentStockCached: 10 })]);
    await reserveAndDecrementForSale([{ venueProductId: 1, quantity: 1 }], 10, "sale:link", 5, db);
    await linkStockMovementsToTransaction("sale:link", 999, db);
    expect(movementsTable.rows[0].referenceId).toBe(999);
  });
});

describe("recordRefundRestock — spec §33, decisión explícita del operador", () => {
  it("#10 restock aumenta el stock exactamente la cantidad devuelta", async () => {
    const { db, productsTable } = makeDb([productFixture({ currentStockCached: 5 })]);
    await recordRefundRestock([{ venueProductId: 1, quantity: 2, key: "item1:0:2" }], 10, "commerce_transaction", 55, 5, db);
    expect(productsTable.rows[0].currentStockCached).toBe(7);
  });

  it("#11 omite productos sin stockTracked", async () => {
    const { db, productsTable, movementsTable } = makeDb([productFixture({ stockTracked: false, currentStockCached: 5 })]);
    await recordRefundRestock([{ venueProductId: 1, quantity: 2, key: "item1:0:2" }], 10, "commerce_transaction", 55, 5, db);
    expect(productsTable.rows[0].currentStockCached).toBe(5);
    expect(movementsTable.rows).toHaveLength(0);
  });

  it("#12 dos restocks de líneas DISTINTAS del mismo producto/venta no se deduplican entre sí (keys distintas)", async () => {
    const { db, productsTable } = makeDb([productFixture({ currentStockCached: 5 })]);
    await recordRefundRestock([{ venueProductId: 1, quantity: 1, key: "item1:0:1" }], 10, "commerce_transaction", 55, 5, db);
    await recordRefundRestock([{ venueProductId: 1, quantity: 1, key: "item1:1:1" }], 10, "commerce_transaction", 55, 5, db);
    expect(productsTable.rows[0].currentStockCached).toBe(7); // ambos restocks reales aplicados
  });

  it("#13 un restock con la MISMA key reintentado no duplica (idempotente)", async () => {
    const { db, productsTable } = makeDb([productFixture({ currentStockCached: 5 })]);
    await recordRefundRestock([{ venueProductId: 1, quantity: 1, key: "item1:0:1" }], 10, "commerce_transaction", 55, 5, db);
    await recordRefundRestock([{ venueProductId: 1, quantity: 1, key: "item1:0:1" }], 10, "commerce_transaction", 55, 5, db);
    expect(productsTable.rows[0].currentStockCached).toBe(6); // NUNCA 7
  });
});

describe("recordBenefitRedemptionStock — spec §34, Benefit gratuito consume stock físico real", () => {
  it("#14 decrementa 1 unidad de un producto stockTracked al canjear un Benefit free_product", async () => {
    const { db, productsTable } = makeDb([productFixture({ currentStockCached: 5 })]);
    await recordBenefitRedemptionStock(1, 10, 777, 9, db);
    expect(productsTable.rows[0].currentStockCached).toBe(4);
  });

  it("#15 no hace nada si el producto no lleva stockTracked (devuelve null)", async () => {
    const { db, movementsTable } = makeDb([productFixture({ stockTracked: false, currentStockCached: 5 })]);
    const result = await recordBenefitRedemptionStock(1, 10, 777, 9, db);
    expect(result).toBeNull();
    expect(movementsTable.rows).toHaveLength(0);
  });

  it("#16 idempotente por referenceId (userBenefit.id) — un doble canje accidental no decrementa dos veces", async () => {
    const { db, productsTable } = makeDb([productFixture({ currentStockCached: 5 })]);
    await recordBenefitRedemptionStock(1, 10, 777, 9, db);
    await recordBenefitRedemptionStock(1, 10, 777, 9, db);
    expect(productsTable.rows[0].currentStockCached).toBe(4);
  });
});

describe("recordWaste / recordAdjustment / recordOpening — spec §36/§37/§29", () => {
  it("#17 merma exige motivo", async () => {
    const { db } = makeDb([productFixture()]);
    await expect(recordWaste({ venueProductId: 1, venueId: 10, quantity: 1, reason: "", actorUserId: 9 }, db)).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });

  it("#18 merma decrementa stock y queda auditada con reason", async () => {
    const { db, productsTable, movementsTable } = makeDb([productFixture({ currentStockCached: 10 })]);
    await recordWaste({ venueProductId: 1, venueId: 10, quantity: 2, reason: "rotura", actorUserId: 9 }, db);
    expect(productsTable.rows[0].currentStockCached).toBe(8);
    expect(movementsTable.rows[0]).toMatchObject({ type: "waste", deltaQuantity: -2, reason: "rotura", actorUserId: 9 });
  });

  it("#19 ajuste positivo usa type='adjustment_in', negativo 'adjustment_out'", async () => {
    const { db, movementsTable } = makeDb([productFixture({ currentStockCached: 10 })]);
    await recordAdjustment({ venueProductId: 1, venueId: 10, delta: 5, reason: "recuento", actorUserId: 9 }, db);
    expect(movementsTable.rows[0].type).toBe("adjustment_in");
  });

  it("#20 ajuste de 0 se rechaza", async () => {
    const { db } = makeDb([productFixture()]);
    await expect(recordAdjustment({ venueProductId: 1, venueId: 10, delta: 0, reason: "x", actorUserId: 9 }, db)).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
  });

  it("#21 apertura de stock inicial registra type='opening'", async () => {
    const { db, movementsTable, productsTable } = makeDb([productFixture({ currentStockCached: 0 })]);
    await recordOpening({ venueProductId: 1, venueId: 10, quantity: 24, actorUserId: 9 }, db);
    expect(movementsTable.rows[0].type).toBe("opening");
    expect(productsTable.rows[0].currentStockCached).toBe(24);
  });
});

describe("IDOR de venue (spec §84/§89)", () => {
  it("#22 rechaza operar sobre un producto de OTRO venue", async () => {
    const { db } = makeDb([productFixture({ venueId: 99 })]);
    await expect(recordWaste({ venueProductId: 1, venueId: 10, quantity: 1, reason: "x", actorUserId: 9 }, db)).rejects.toMatchObject({ code: "WRONG_VENUE" });
  });
});

beforeEach(() => vi.clearAllMocks());
