/**
 * commandCenterCommerce.ts — SEGOLIFE ADMIN AI/BI/COMMAND CENTER (Fase 12,
 * spec §15/§16/§69). `dashboard.getPosProducts` (unidades vendidas/top
 * productos, spec §69 — "no separate POS analytics database") y
 * `dashboard.getPaymentMix` (desglose cash/card/mixed_cash/mixed_card/
 * segotokens, spec §16). Ambos LEEN `commerce_transactions`/
 * `commerce_transaction_items` — nunca una tabla paralela, nunca
 * recalculan lo que salesReadModel.ts ya resuelve para el bruto/promocional.
 *
 * SegoTokens NUNCA es "revenue" (spec §16/§52) — `promotionalValueCents` se
 * reporta aparte, nunca sumado a `moneyDueCents`.
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { DashboardFilterContext } from "./dashboardFilters";

const TOP_N = 10;

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[]])[0] ?? [];
}

export interface TopProductRow {
  venueProductId: number;
  productName: string;
  venueId: number;
  venueName: string;
  unitsSold: number;
  grossSalesCents: number;
}

/** spec §69 — solo líneas de transacciones confirmadas, unidades netas de reembolso (quantity - refundedQuantity nunca negativo). */
export async function getPosProductPerformance(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<TopProductRow[]> {
  const communityCond = ctx.communityId != null ? sql`AND ct.user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${ctx.communityId})` : sql``;

  const result = await db.execute(sql`
    SELECT
      cti.venue_product_id AS venue_product_id, vp.name AS product_name,
      ct.venue_id AS venue_id, v.name AS venue_name,
      SUM(GREATEST(cti.quantity - COALESCE(cti.refunded_quantity, 0), 0)) AS units_sold,
      SUM(cti.total_amount_cents) AS gross_sales_cents
    FROM commerce_transaction_items cti
    JOIN commerce_transactions ct ON ct.id = cti.transaction_id
    JOIN venue_products vp ON vp.id = cti.venue_product_id
    JOIN venues v ON v.id = ct.venue_id
    WHERE cti.venue_product_id IS NOT NULL
      AND ct.status IN ('confirmed', 'refunded', 'partially_refunded')
      AND ct.occurred_at >= ${ctx.from} AND ct.occurred_at < ${ctx.to}
      ${communityCond}
    GROUP BY cti.venue_product_id, vp.name, ct.venue_id, v.name
    ORDER BY units_sold DESC
    LIMIT ${TOP_N}
  `);

  return rowsOf<{ venue_product_id: number; product_name: string; venue_id: number; venue_name: string; units_sold: number | string; gross_sales_cents: number | string }>(result)
    .map(r => ({
      venueProductId: Number(r.venue_product_id), productName: r.product_name,
      venueId: Number(r.venue_id), venueName: r.venue_name,
      unitsSold: Number(r.units_sold), grossSalesCents: Number(r.gross_sales_cents),
    }));
}

export interface PaymentMixRow {
  paymentMethod: string;
  transactionCount: number;
  grossSalesCents: number;
}

export interface PaymentMixSnapshot {
  rows: PaymentMixRow[];
  /** spec §16 — SegoTokens nunca es "revenue": suma real de token_spend_reservations.promotionalValueCents de las transacciones del periodo, reportada aparte. */
  segoTokensPromotionalValueCents: number;
}

/** spec §16 — "cash"/"card"/"mixed_cash"/"mixed_card"/"segotokens" (Fase 10.7) tal cual persistidos, nunca colapsados. */
export async function getPaymentMix(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<PaymentMixSnapshot> {
  const communityCond = ctx.communityId != null ? sql`AND ct.user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${ctx.communityId})` : sql``;

  const [mixResult, promoResult] = await Promise.all([
    db.execute(sql`
      SELECT COALESCE(ct.payment_method, 'desconocido') AS payment_method, COUNT(*) AS n, SUM(ct.total_cents) AS gross
      FROM commerce_transactions ct
      WHERE ct.status IN ('confirmed', 'refunded', 'partially_refunded')
        AND ct.occurred_at >= ${ctx.from} AND ct.occurred_at < ${ctx.to}
        ${communityCond}
      GROUP BY ct.payment_method
      ORDER BY gross DESC
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(tsr.promotional_value_cents), 0) AS n
      FROM commerce_transactions ct
      JOIN token_spend_reservations tsr ON tsr.id = ct.token_reservation_id
      WHERE ct.status IN ('confirmed', 'refunded', 'partially_refunded')
        AND ct.occurred_at >= ${ctx.from} AND ct.occurred_at < ${ctx.to}
        ${communityCond}
    `),
  ]);

  return {
    rows: rowsOf<{ payment_method: string; n: number | string; gross: number | string }>(mixResult)
      .map(r => ({ paymentMethod: r.payment_method, transactionCount: Number(r.n), grossSalesCents: Number(r.gross ?? 0) })),
    segoTokensPromotionalValueCents: Number(rowsOf<{ n: number | string }>(promoResult)[0]?.n ?? 0),
  };
}
