/**
 * stockService.ts — SEGOLIFE FASE 10 (spec §27-43). Stock FÍSICO de
 * venue_products — distinto y nunca fusionado con la capacidad de entradas
 * (inventoryHoldService.ts, spec §27). Verdad canónica = SUM(delta_quantity)
 * de inventory_movements; `venue_products.current_stock_cached` es solo
 * caché de lectura, actualizada TRANSACCIONALMENTE junto a cada movimiento
 * (spec §30) — nunca se escribe directamente desde el cliente (spec §89).
 *
 * CONCURRENCIA (spec §40): decremento con SELECT...FOR UPDATE sobre la fila
 * de venue_products, filas bloqueadas en orden ascendente de id (mismo
 * criterio anti-deadlock que inventoryHoldService.ts). Dos ventas
 * simultáneas de la última unidad quedan serializadas por MySQL.
 */
import { eq, and, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { venueProducts, inventoryMovements, type InventoryMovement, type VenueProduct } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class StockError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "StockError";
  }
}

export type MovementType = "opening" | "purchase" | "sale" | "refund" | "adjustment_in" | "adjustment_out" | "waste" | "transfer_in" | "transfer_out";

/** Movimiento atómico de UN producto — asume que `tx` ya es una transacción abierta por el llamador. Idempotente si se pasa idempotencyKey. */
async function applyMovementInTx(tx: TxHandle, params: {
  venueProductId: number; venueId: number; type: MovementType; deltaQuantity: number;
  referenceType?: string | null; referenceId?: number | null; reason?: string | null;
  actorUserId?: number | null; idempotencyKey?: string | null;
}): Promise<InventoryMovement> {
  if (params.idempotencyKey) {
    const [existing] = await tx.select().from(inventoryMovements).where(eq(inventoryMovements.idempotencyKey, params.idempotencyKey)).limit(1);
    if (existing) return existing;
  }

  const [product] = await tx.select().from(venueProducts).where(eq(venueProducts.id, params.venueProductId)).limit(1).for("update");
  if (!product) throw new StockError("PRODUCT_NOT_FOUND", "Producto no encontrado");
  if (product.venueId !== params.venueId) throw new StockError("WRONG_VENUE", "El producto no pertenece a este venue");
  if (!product.stockTracked) throw new StockError("NOT_STOCK_TRACKED", "Este producto no lleva control de stock");

  const currentBalance = product.currentStockCached ?? 0;
  const newBalance = currentBalance + params.deltaQuantity;
  if (newBalance < 0 && !product.allowNegativeStock) {
    throw new StockError("INSUFFICIENT_STOCK", `Stock insuficiente de "${product.name}" (disponible: ${currentBalance})`);
  }

  let movement: InventoryMovement;
  try {
    const [result] = await tx.insert(inventoryMovements).values({
      venueProductId: params.venueProductId, venueId: params.venueId, type: params.type,
      deltaQuantity: params.deltaQuantity, balanceAfter: newBalance,
      referenceType: params.referenceType ?? null, referenceId: params.referenceId ?? null,
      reason: params.reason ?? null, actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
    });
    const insertId = (result as unknown as { insertId: number }).insertId;
    const [row] = await tx.select().from(inventoryMovements).where(eq(inventoryMovements.id, insertId)).limit(1);
    movement = row!;
  } catch (err: unknown) {
    const mysqlErr = err as { code?: string };
    if (mysqlErr?.code === "ER_DUP_ENTRY" && params.idempotencyKey) {
      const [existing] = await tx.select().from(inventoryMovements).where(eq(inventoryMovements.idempotencyKey, params.idempotencyKey)).limit(1);
      if (existing) return existing;
    }
    throw err;
  }

  await tx.update(venueProducts).set({ currentStockCached: newBalance }).where(eq(venueProducts.id, params.venueProductId));
  return movement;
}

export interface SaleLine { venueProductId: number; quantity: number; }

/**
 * Reserva/decrementa stock para una venta de POS — se llama ANTES de
 * confirmar cobro (spec §32/§40): si falta stock de cualquier línea, nada se
 * decrementa (transacción completa revierte) y la venta se aborta antes de
 * capturar SegoTokens/dinero. Productos no marcados stockTracked se omiten
 * en silencio (spec §28, no todo producto tiene stock físico). Idempotente
 * por (idempotencyKeyPrefix, venueProductId) — un reintento de red nunca
 * decrementa dos veces (spec §32).
 */
export async function reserveAndDecrementForSale(lines: SaleLine[], venueId: number, idempotencyKeyPrefix: string, actorUserId: number | null, db?: DbHandle): Promise<InventoryMovement[]> {
  const conn = db ?? (await getDb());
  const sorted = [...lines].sort((a, b) => a.venueProductId - b.venueProductId); // orden ascendente — evita deadlocks (mismo criterio que inventoryHoldService.ts)
  return conn.transaction(async (tx) => {
    const movements: InventoryMovement[] = [];
    for (const line of sorted) {
      const [product] = await tx.select().from(venueProducts).where(eq(venueProducts.id, line.venueProductId)).limit(1);
      if (!product || !product.stockTracked) continue; // sin stock físico — spec §28
      const movement = await applyMovementInTx(tx, {
        venueProductId: line.venueProductId, venueId, type: "sale", deltaQuantity: -line.quantity,
        referenceType: "commerce_transaction", referenceId: null, actorUserId,
        idempotencyKey: `${idempotencyKeyPrefix}:${line.venueProductId}`,
      });
      movements.push(movement);
    }
    return movements;
  });
}

/** Enlaza a posteriori el referenceId real (el commerce_transaction.id no existe hasta después de decrementar) — enlace best-effort, mismo criterio que nativeCommerceService.ts con tokenReservationId. */
export async function linkStockMovementsToTransaction(idempotencyKeyPrefix: string, transactionId: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(inventoryMovements).set({ referenceId: transactionId })
    .where(and(like(inventoryMovements.idempotencyKey, `${idempotencyKeyPrefix}:%`), eq(inventoryMovements.referenceType, "commerce_transaction")));
}

/** Compensación simétrica (spec, mismo criterio que reverseTokenSpend en nativeCommerceService.ts): la venta no se pudo completar tras decrementar stock — revertir. */
export async function reverseStockForSale(idempotencyKeyPrefix: string, actorUserId: number | null, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  const movements = await conn.select().from(inventoryMovements).where(like(inventoryMovements.idempotencyKey, `${idempotencyKeyPrefix}:%`));
  await conn.transaction(async (tx) => {
    for (const m of movements) {
      await applyMovementInTx(tx, {
        venueProductId: m.venueProductId, venueId: m.venueId, type: "adjustment_in", deltaQuantity: -m.deltaQuantity,
        referenceType: "compensation", referenceId: m.id, reason: "Venta no completada — compensación automática", actorUserId,
        idempotencyKey: `${idempotencyKeyPrefix}:reverse:${m.venueProductId}`,
      });
    }
  });
}

export interface RestockLine extends SaleLine {
  /**
   * Componente único de idempotencia por LÍNEA DE REEMBOLSO (no por
   * producto) — un mismo producto puede reembolsarse (y por tanto
   * reponerse) en más de un reembolso parcial distinto de la misma venta;
   * si se deduplicara solo por venueProductId, el segundo restock legítimo
   * se perdería silenciosamente. El llamador pasa algo estable-por-reintento
   * pero distinto-por-evento (ej. itemId + cantidad ya reembolsada antes de
   * esta línea).
   */
  key: string;
}

/**
 * Restock de un reembolso — SOLO si el operador decide que el producto
 * vuelve físicamente al stock (spec §33, nunca automático). Acepta
 * `AnyDbHandle` porque refundOrchestrator.ts la llama desde DENTRO de su
 * propia transacción (mismo commit atómico que el reembolso) — drizzle-orm
 * soporta transacciones anidadas (SAVEPOINT) sobre un TxHandle ya abierto.
 */
export async function recordRefundRestock(lines: RestockLine[], venueId: number, referenceType: string, referenceId: number, actorUserId: number | null, db?: AnyDbHandle): Promise<InventoryMovement[]> {
  const conn = (db ?? (await getDb())) as DbHandle;
  return conn.transaction(async (tx) => {
    const movements: InventoryMovement[] = [];
    for (const line of lines) {
      const [product] = await tx.select().from(venueProducts).where(eq(venueProducts.id, line.venueProductId)).limit(1);
      if (!product || !product.stockTracked) continue;
      movements.push(await applyMovementInTx(tx, {
        venueProductId: line.venueProductId, venueId, type: "refund", deltaQuantity: line.quantity,
        referenceType, referenceId, actorUserId, idempotencyKey: `refund_restock:${referenceType}:${referenceId}:${line.key}`,
      }));
    }
    return movements;
  });
}

/** Consumo de stock por canje de un Benefit "free_product" (spec §34) — el pago sea €0/ST no cambia que el producto físico se consume. */
export async function recordBenefitRedemptionStock(venueProductId: number, venueId: number, referenceId: number, actorUserId: number | null, db?: DbHandle): Promise<InventoryMovement | null> {
  const conn = db ?? (await getDb());
  const [product] = await conn.select().from(venueProducts).where(eq(venueProducts.id, venueProductId)).limit(1);
  if (!product || !product.stockTracked) return null;
  return conn.transaction((tx) => applyMovementInTx(tx, {
    venueProductId, venueId, type: "sale", deltaQuantity: -1,
    referenceType: "benefit_redemption", referenceId, actorUserId,
    idempotencyKey: `benefit_redemption_stock:${referenceId}`,
  }));
}

export interface WasteInput { venueProductId: number; venueId: number; quantity: number; reason: string; actorUserId: number; }

export async function recordWaste(input: WasteInput, db?: DbHandle): Promise<InventoryMovement> {
  const conn = db ?? (await getDb());
  if (!input.reason.trim()) throw new StockError("REASON_REQUIRED", "El motivo de la merma es obligatorio");
  if (input.quantity <= 0) throw new StockError("INVALID_QUANTITY", "Cantidad no válida");
  return conn.transaction((tx) => applyMovementInTx(tx, {
    venueProductId: input.venueProductId, venueId: input.venueId, type: "waste", deltaQuantity: -input.quantity,
    reason: input.reason, actorUserId: input.actorUserId,
  }));
}

export interface AdjustmentInput { venueProductId: number; venueId: number; delta: number; reason: string; actorUserId: number; }

export async function recordAdjustment(input: AdjustmentInput, db?: DbHandle): Promise<InventoryMovement> {
  const conn = db ?? (await getDb());
  if (!input.reason.trim()) throw new StockError("REASON_REQUIRED", "El motivo del ajuste es obligatorio");
  if (input.delta === 0) throw new StockError("INVALID_QUANTITY", "El ajuste no puede ser 0");
  return conn.transaction((tx) => applyMovementInTx(tx, {
    venueProductId: input.venueProductId, venueId: input.venueId, type: input.delta > 0 ? "adjustment_in" : "adjustment_out",
    deltaQuantity: input.delta, reason: input.reason, actorUserId: input.actorUserId,
  }));
}

export interface OpeningInput { venueProductId: number; venueId: number; quantity: number; actorUserId: number; }

export async function recordOpening(input: OpeningInput, db?: DbHandle): Promise<InventoryMovement> {
  const conn = db ?? (await getDb());
  if (input.quantity < 0) throw new StockError("INVALID_QUANTITY", "Cantidad no válida");
  return conn.transaction((tx) => applyMovementInTx(tx, {
    venueProductId: input.venueProductId, venueId: input.venueId, type: "opening", deltaQuantity: input.quantity,
    reason: "Stock inicial", actorUserId: input.actorUserId,
  }));
}

export async function getBalance(venueProductId: number, db?: AnyDbHandle): Promise<number | null> {
  const conn = db ?? (await getDb());
  const [product] = await conn.select().from(venueProducts).where(eq(venueProducts.id, venueProductId)).limit(1);
  if (!product || !product.stockTracked) return null;
  return product.currentStockCached ?? 0;
}

export async function listMovements(venueProductId: number, limit = 100, db?: AnyDbHandle): Promise<InventoryMovement[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(inventoryMovements).where(eq(inventoryMovements.venueProductId, venueProductId)).orderBy(inventoryMovements.createdAt).limit(limit);
}

export async function listStockProducts(venueId: number, db?: AnyDbHandle): Promise<VenueProduct[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(venueProducts).where(and(eq(venueProducts.venueId, venueId), eq(venueProducts.stockTracked, true)));
}

export async function listLowStock(venueId: number, db?: AnyDbHandle): Promise<VenueProduct[]> {
  const products = await listStockProducts(venueId, db);
  return products.filter(p => p.lowStockThreshold != null && (p.currentStockCached ?? 0) <= p.lowStockThreshold);
}

export async function setStockConfig(venueProductId: number, config: { stockTracked?: boolean; lowStockThreshold?: number | null; allowNegativeStock?: boolean }, db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(venueProducts).set(config).where(eq(venueProducts.id, venueProductId));
}
