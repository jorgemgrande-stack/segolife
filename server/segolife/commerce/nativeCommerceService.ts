/**
 * nativeCommerceService.ts — POS nativo (Fase 8, endurecido en Fase 10.7
 * "Venue Bar POS & Live Commerce Terminal"). NO es un ERP: sin IVA/REAV
 * propios, sin factura — solo registrar una venta real de consumiciones en
 * un venue. REUTILIZA `commerceTransactions`/`commerceTransactionItems` con
 * `provider="segolife"` (reservado desde Fase 5, ver comentario en
 * drizzle/schema.ts) y `venue_products` para el catálogo — nunca tablas
 * paralelas.
 *
 * PAGO: el staff registra manualmente un cobro que YA presenció en persona
 * (no es "fingir un pago": no se invoca ningún PaymentProvider digital, el
 * staff es el testigo real de la transacción, igual que cualquier POS
 * físico del mundo). `moneyPaymentMethod` ("cash"|"card", Fase 10.7)
 * distingue HONESTAMENTE cómo se cobró la parte en dinero — nunca verifica
 * un datáfono real (SEGOLIFE no lo controla), solo registra lo que el
 * operador confirma. El `paymentMethod` final persistido combina esto con
 * si hubo SegoTokens aplicados: "cash"|"card"|"mixed_cash"|"mixed_card"|
 * "segotokens" — mismo patrón de composición que ya usa doorSaleService.ts
 * (cash/segotokens/mixed), extendido con la distinción cash/card que Fase 9
 * documentó explícitamente como pendiente (ver cashSessionService.ts).
 *
 * `commercePipeline.ingestCommerceTransaction()` sigue siendo el ÚNICO
 * punto de entrada a loyalty — este servicio nunca llama a earnTokens()/
 * evaluateBenefitsForOrigin() directamente.
 *
 * SEGOTOKENS PRESENCIALES (Pre-16.1, spec §2 "IDENTIFICATION != PAYMENT
 * AUTHORIZATION"): este servicio YA NO llama a reserveAndCaptureTokenSpend()
 * directo — eso permitía a un operador aplicar tokens de un Student
 * identificado sin que el Student autorizara nada desde su teléfono. Ahora
 * solo acepta `confirmedTokenRequestId`: el id de un token_payment_request
 * que el Student YA confirmó (tokenPaymentRequestService.ts), creado antes
 * mediante el router `commerce.requestTokenPayment`. Sin ese id, la venta
 * simplemente no lleva SegoTokens — ninguna vía sigue permitiendo un gasto
 * unilateral del operador.
 */
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { venueProducts, commerceTransactions, type VenueProduct } from "../../../drizzle/schema";
import { ingestCommerceTransaction, type IngestCommerceResult } from "./commercePipeline";
import { reverseTokenSpend, type TokenSpendReservation } from "../tokens/tokenSpendService";
import { settleTokenPaymentRequest, linkSettledOrder, TokenPaymentRequestError } from "../tokens/tokenPaymentRequestService";
import { reserveAndDecrementForSale, reverseStockForSale, linkStockMovementsToTransaction, StockError } from "../stock/stockService";

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
   * SEGOLIFE — SEGOTOKENS PRESENCIALES (Pre-16.1): id de un
   * token_payment_request ya CONFIRMADO por el Student desde su propio
   * teléfono (tokenPaymentRequestService.ts, creado antes vía
   * `commerce.requestTokenPayment`). Sustituye al antiguo `tokensToApply`
   * directo — este servicio ya no decide por sí mismo cuántos tokens
   * aplicar, solo liquida una autorización que ya existe y ya fue aprobada.
   * Sin este id, la venta no lleva SegoTokens.
   */
  confirmedTokenRequestId?: number | null;
  /** Fase 10.7 — cómo se cobró la porción en DINERO (nunca la porción en SegoTokens). Por defecto "cash" (compatibilidad con el comportamiento previo a esta fase). */
  moneyPaymentMethod?: "cash" | "card" | null;
}

/** Combina si hubo SegoTokens con cómo se cobró el dinero restante — mismo criterio de composición que doorSaleService.ts, extendido con la distinción cash/card (Fase 10.7). */
export function resolvePaymentMethod(reservation: TokenSpendReservation | null, moneyDueCents: number, moneyPaymentMethod: "cash" | "card"): string {
  if (reservation) {
    if (moneyDueCents === 0) return "segotokens";
    return moneyPaymentMethod === "card" ? "mixed_card" : "mixed_cash";
  }
  return moneyPaymentMethod === "card" ? "card" : "cash";
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

  // SEGOLIFE — FASE 10 (spec §32/§40): decremento de stock ANTES de tocar
  // SegoTokens/dinero — si falta stock de cualquier línea (y el producto no
  // permite negativo), la venta se aborta AQUÍ, nada se ha cobrado todavía.
  // Productos sin stockTracked se omiten en silencio (spec §28). Idempotente
  // por idempotencyKey — un reintento de red nunca decrementa dos veces
  // (spec §32/§62).
  const stockKeyPrefix = `pos_sale_stock:${input.idempotencyKey}`;
  let stockReserved = false;
  try {
    await reserveAndDecrementForSale(
      input.items.map(i => ({ venueProductId: i.venueProductId, quantity: i.quantity })),
      input.venueId, stockKeyPrefix, input.staffUserId, conn,
    );
    stockReserved = true;
  } catch (err) {
    if (err instanceof StockError) throw new PosError(err.code, err.message);
    throw err;
  }

  // SEGOLIFE — SEGOTOKENS PRESENCIALES (Pre-16.1): totalCents/subtotalCents
  // de commerce_transactions siguen siendo el precio BRUTO real — nunca se
  // muta para reflejar lo aplicado en SegoTokens (spec §10, "do NOT mutate
  // the product price"). El valor promocional/dinero debido vive en
  // token_spend_reservations, enlazada vía token_reservation_id.
  //
  // La captura (liquidación) ocurre AQUÍ, ANTES de crear la orden — mismo
  // orden que el reserveAndCaptureTokenSpend() que sustituye, para que el
  // catch-and-reverse de más abajo siga cubriendo el caso "se capturaron
  // tokens pero la orden no se pudo crear" sin ningún cambio.
  let reservation: TokenSpendReservation | null = null;
  try {
    if (input.confirmedTokenRequestId != null) {
      if (!input.identifiedUserId) throw new PosError("STUDENT_REQUIRED", "Se necesita identificar al Student para aplicar SegoTokens");
      let settleResult;
      try {
        settleResult = await settleTokenPaymentRequest(input.confirmedTokenRequestId, "pos", conn);
      } catch (err) {
        if (err instanceof TokenPaymentRequestError) throw new PosError(err.code, err.message);
        throw err;
      }
      // Se asigna ANTES de las validaciones siguientes (no solo al final):
      // los tokens YA se capturaron dentro de settleTokenPaymentRequest —
      // settleResult existe. Si alguna validación de abajo lanza, el catch
      // de más abajo debe poder revertir esta captura, y solo puede hacerlo
      // si `reservation` ya está asignada aquí.
      reservation = settleResult.reservation;
      if (reservation.userId !== input.identifiedUserId) {
        throw new PosError("REQUEST_STUDENT_MISMATCH", "La solicitud de pago no corresponde al Student identificado para esta venta");
      }
      if (reservation.grossAmountCents !== totalCents) {
        // El carrito cambió entre la solicitud y esta confirmación — nunca
        // se liquida contra un total distinto del que el Student aprobó.
        throw new PosError("CART_CHANGED_SINCE_REQUEST", "El carrito cambió desde que se solicitó el pago con SegoTokens — vuelve a solicitarlo");
      }
    }

    const moneyDueCents = totalCents - (reservation?.promotionalValueCents ?? 0);
    const paymentMethod = resolvePaymentMethod(reservation, moneyDueCents, input.moneyPaymentMethod ?? "cash");

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
        paymentMethod,
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
      if (input.confirmedTokenRequestId != null) {
        await linkSettledOrder(input.confirmedTokenRequestId, result.transaction.id, conn);
      }
    }
    await linkStockMovementsToTransaction(stockKeyPrefix, result.transaction.id, conn).catch(() => {});
    return result;
  } catch (err) {
    // Compensación: la venta no se pudo registrar tras capturar SegoTokens
    // reales y/o decrementar stock — revertir ambos para no dejar tokens
    // gastados o stock descontado sin ninguna venta asociada (nunca "wallet
    // descontada sin operación", mismo principio que benefitPurchaseService.ts,
    // ahora también aplicado a stock).
    if (reservation) {
      await reverseTokenSpend({ reservationId: reservation.id, reason: "Venta no pudo completarse tras capturar SegoTokens", adminUserId: input.staffUserId }, conn).catch(() => {});
    }
    if (stockReserved) {
      await reverseStockForSale(stockKeyPrefix, input.staffUserId, conn).catch(() => {});
    }
    throw err;
  }
}
