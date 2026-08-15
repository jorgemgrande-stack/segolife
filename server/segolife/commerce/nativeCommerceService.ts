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
import { venueProducts, commerceTransactions, type VenueProduct } from "../../../drizzle/schema";
import { ingestCommerceTransaction, type IngestCommerceResult } from "./commercePipeline";
import { reserveAndCaptureTokenSpend, reverseTokenSpend, type TokenSpendReservation } from "../tokens/tokenSpendService";

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
  /**
   * SEGOLIFE — SEGOTOKENS UNIVERSAL SPEND (Fase 7, spec §22/§23/§71-74):
   * cantidad de SegoTokens que el Student aplica contra el precio bruto de
   * esta venta. Requiere `identifiedUserId` — el ROUTER (server/routers/
   * commerce.ts) es quien re-verifica ese userId contra un escaneo FRESCO
   * del QR de identidad antes de llegar aquí (spec §33/§34: "identidad no
   * es un cheque en blanco de pago") — este servicio confía en el userId
   * que recibe, igual que confía en `staffUserId`, nunca revalida el QR él
   * mismo (esa responsabilidad es de la capa de router, como en el resto
   * del código base).
   */
  tokensToApply?: number | null;
}

/** Catálogo de productos activos de un venue para el carrito del POS — misma tabla que /admin (VenueSegoTokensTab), lectura directa sin pasar por el permiso admin `tokens.view`. */
export async function listPosProducts(venueId: number, db?: DbHandle): Promise<VenueProduct[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(venueProducts).where(eq(venueProducts.venueId, venueId)).orderBy(venueProducts.name);
}

interface ResolvedCartItem {
  venueProductId: number;
  externalProductId: string;
  description: string;
  quantity: number;
  unitAmountCents: number;
  totalAmountCents: number;
}

/**
 * Recalcula el carrito desde el catálogo real (nunca un importe enviado por
 * el frontend) — extraído para que la previsualización de canje de
 * SegoTokens (spec §36, "checkout UX contract") pueda resolver el mismo
 * `grossAmountCents` que recordNativeSale usará al confirmar, sin duplicar
 * la lógica de precio ni arriesgar que diverjan.
 */
export async function resolveCartTotalCents(venueId: number, cartItems: PosCartItem[], db?: DbHandle): Promise<{ totalCents: number; items: ResolvedCartItem[] }> {
  const conn = db ?? (await getDb());
  if (!cartItems.length) throw new PosError("EMPTY_CART", "El carrito está vacío");

  const productIds = cartItems.map(i => i.venueProductId);
  const products = await conn.select().from(venueProducts).where(inArray(venueProducts.id, productIds));
  const byId = new Map(products.map(p => [p.id, p]));

  let totalCents = 0;
  const items = cartItems.map(item => {
    const product = byId.get(item.venueProductId);
    if (!product || product.venueId !== venueId || !product.isActive) {
      throw new PosError("PRODUCT_UNAVAILABLE", `Producto ${item.venueProductId} no disponible en este venue`);
    }
    if (item.quantity < 1) throw new PosError("INVALID_QUANTITY", "Cantidad no válida");
    // price es decimal string (venue_products.price) — nunca se confía en un importe enviado por el frontend, se recalcula desde el catálogo.
    const unitAmountCents = Math.round(Number(product.price ?? "0") * 100);
    totalCents += unitAmountCents * item.quantity;
    return {
      // venueProductId real además de externalProductId — antes se perdía
      // (columna commerce_transaction_items.venue_product_id nunca se
      // rellenaba pese a existir, ver auditoría Student 360 §C).
      venueProductId: product.id,
      externalProductId: String(product.id),
      description: product.name,
      quantity: item.quantity,
      unitAmountCents,
      totalAmountCents: unitAmountCents * item.quantity,
    };
  });
  return { totalCents, items };
}

export async function recordNativeSale(input: RecordNativeSaleInput, db?: DbHandle): Promise<IngestCommerceResult> {
  const conn = db ?? (await getDb());
  const { totalCents, items } = await resolveCartTotalCents(input.venueId, input.items, conn);

  // SEGOLIFE — SEGOTOKENS UNIVERSAL SPEND (Fase 7): totalCents/subtotalCents
  // de commerce_transactions siguen siendo el precio BRUTO real — nunca se
  // muta para reflejar lo cobrado tras aplicar SegoTokens (spec §10, "do
  // NOT mutate the product price"). El valor promocional/dinero debido vive
  // en token_spend_reservations, enlazada vía token_reservation_id.
  let reservation: TokenSpendReservation | null = null;
  if (input.tokensToApply != null && input.tokensToApply > 0) {
    if (!input.identifiedUserId) throw new PosError("STUDENT_REQUIRED", "Se necesita identificar al Student para aplicar SegoTokens");
    const spendResult = await reserveAndCaptureTokenSpend({
      userId: input.identifiedUserId,
      venueId: input.venueId,
      grossAmountCents: totalCents,
      requestedTokens: input.tokensToApply,
      referenceType: "commerce_transaction",
      idempotencyKey: `pos_sale_tokens:${input.idempotencyKey}`,
      createdByUserId: input.staffUserId,
    }, conn);
    if ("status" in spendResult) {
      if (spendResult.status === "no_policy") throw new PosError("NO_REDEMPTION_POLICY", "No hay ninguna política de canje de SegoTokens activa para este venue");
      throw new PosError("INVALID_TOKEN_AMOUNT", "Importe de SegoTokens no válido");
    }
    reservation = spendResult.reservation;
  }

  try {
    const result = await ingestCommerceTransaction({
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

    if (reservation) {
      // Enlace best-effort — si esta UPDATE fallara/reintenta, la fuente de
      // verdad económica (token_spend_reservations, ya capturada) no se ve
      // afectada, solo el atajo de navegación para el reembolso simétrico.
      await conn.update(commerceTransactions).set({ tokenReservationId: reservation.id }).where(eq(commerceTransactions.id, result.transaction.id));
    }
    return result;
  } catch (err) {
    // Compensación: la venta no se pudo registrar tras capturar SegoTokens
    // reales — revertir para no dejar tokens gastados sin ninguna venta
    // asociada (nunca "wallet descontada sin operación", mismo principio
    // que benefitPurchaseService.ts).
    if (reservation) {
      await reverseTokenSpend({ reservationId: reservation.id, reason: "Venta no pudo completarse tras capturar SegoTokens", adminUserId: input.staffUserId }, conn).catch(() => {});
    }
    throw err;
  }
}
