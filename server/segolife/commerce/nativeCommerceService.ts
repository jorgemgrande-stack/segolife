/**
 * nativeCommerceService.ts — POS nativo mínimo (Fase 8, spec puntos 19-24).
 * NO es un ERP: sin fiscalidad, sin IVA/REAV, sin factura, sin caja/cierres
 * — solo registrar una venta real de consumiciones en un venue. REUTILIZA
 * `commerceTransactions`/`commerceTransactionItems` con `provider="segolife"`
 * (reservado desde Fase 5, ver comentario en drizzle/schema.ts) y
 * `venue_products` para el catálogo — nunca tablas paralelas.
 *
 * PAGO: solo `paymentMethod="cash"` — el staff registra manualmente una
 * venta en efectivo que YA presenció en persona (no es "fingir un pago": no
 * se invoca ningún PaymentProvider digital, el staff es el testigo real de
 * la transacción, igual que cualquier POS físico del mundo). Nunca se
 * ofrece un método de pago digital sin un PaymentProvider real conectado.
 *
 * `commercePipeline.ingestCommerceTransaction()` sigue siendo el ÚNICO
 * punto de entrada a loyalty — este servicio nunca llama a earnTokens()/
 * evaluateBenefitsForOrigin() directamente.
 */
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { venueProducts, type VenueProduct } from "../../../drizzle/schema";
import { ingestCommerceTransaction, type IngestCommerceResult } from "./commercePipeline";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class PosError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "PosError";
  }
}

export interface PosCartItem {
  venueProductId: number;
  quantity: number;
}

export interface RecordNativeSaleInput {
  venueId: number;
  items: PosCartItem[];
  /** Estudiante ya identificado (QR de identidad) — opcional, ver spec punto 23. */
  identifiedUserId?: number | null;
  staffUserId: number;
  idempotencyKey: string;
}

/** Catálogo de productos activos de un venue para el carrito del POS — misma tabla que /admin (VenueSegoTokensTab), lectura directa sin pasar por el permiso admin `tokens.view`. */
export async function listPosProducts(venueId: number, db?: DbHandle): Promise<VenueProduct[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(venueProducts).where(eq(venueProducts.venueId, venueId)).orderBy(venueProducts.name);
}

export async function recordNativeSale(input: RecordNativeSaleInput, db?: DbHandle): Promise<IngestCommerceResult> {
  const conn = db ?? (await getDb());
  if (!input.items.length) throw new PosError("EMPTY_CART", "El carrito está vacío");

  const productIds = input.items.map(i => i.venueProductId);
  const products = await conn.select().from(venueProducts).where(inArray(venueProducts.id, productIds));
  const byId = new Map(products.map(p => [p.id, p]));

  let totalCents = 0;
  const items = input.items.map(item => {
    const product = byId.get(item.venueProductId);
    if (!product || product.venueId !== input.venueId || !product.isActive) {
      throw new PosError("PRODUCT_UNAVAILABLE", `Producto ${item.venueProductId} no disponible en este venue`);
    }
    if (item.quantity < 1) throw new PosError("INVALID_QUANTITY", "Cantidad no válida");
    // price es decimal string (venue_products.price) — nunca se confía en un importe enviado por el frontend, se recalcula desde el catálogo.
    const unitAmountCents = Math.round(Number(product.price ?? "0") * 100);
    totalCents += unitAmountCents * item.quantity;
    return {
      externalProductId: String(product.id),
      description: product.name,
      quantity: item.quantity,
      unitAmountCents,
      totalAmountCents: unitAmountCents * item.quantity,
    };
  });

  return ingestCommerceTransaction({
    provider: "segolife",
    venueId: input.venueId,
    resolvedUserId: input.identifiedUserId ?? null,
    transaction: {
      externalTransactionId: input.idempotencyKey,
      status: "confirmed",
      subtotalCents: totalCents,
      feesCents: 0,
      totalCents,
      currency: "EUR",
      paymentMethod: "cash",
      buyer: { email: null, phone: null, name: null },
      occurredAt: new Date(),
      items,
    },
  }, conn);
}
