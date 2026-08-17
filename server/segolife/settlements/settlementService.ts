/**
 * settlementService.ts — SEGOLIFE FASE 10 (spec §55-69). "Después de toda la
 * actividad comercial, ¿quién debe a quién cuánto?" — NUNCA la misma
 * pregunta que el cierre de caja (cashSessionService.ts, spec §55).
 *
 * SIGNO de `netPayableToVenueCents` (spec §59): positivo = el
 * cobrador/plataforma debe pagar al venue; negativo = el venue debe pagar al
 * cobrador. El MISMO motor calcula ambos flujos de caja según quién cobró
 * (venueSellerConfig.collectorEntityId).
 *
 * SOLO VENTAS NATIVAS (spec §70-72/§S/§T CRÍTICO): Fourvenues nunca entra en
 * una liquidación solo por ser visible en Ventas — igual que
 * fiscalSnapshotService.ts, se filtra por provider="segolife"/channel nativo.
 */
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  settlements, venueSettlementLines as settlementLines, commerceTransactions, ticketOrders, events,
  commerceRefunds, tokenSpendReservations,
  type Settlement, type VenueSettlementLine as SettlementLine,
} from "../../../drizzle/schema";
import { resolveSellerForVenue } from "../fiscal/commercialEntityService";
import { resolveAgreement } from "./commercialAgreementService";
import { calcCommissionCents } from "../fiscal/moneyTax";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class SettlementError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "SettlementError";
  }
}

export interface CalculateSettlementInput {
  venueId: number;
  eventId?: number | null;
  periodStart: Date;
  periodEnd: Date;
  createdByUserId: number;
}

/** Suma cruda de promotionalValueCents de una lista de reservas — SIN aplicar todavía ningún reparto por tokenFundingModel (spec Pre-16.15 §5-8: separar "cuánto valor ST hay" de "quién lo financia" para poder nettear reembolsos antes de repartir). */
// PRE-16.15 (auditoría overnight, Q — performance, trivial y seguro junto a
// BUG-10): una consulta por reservationId (N+1 real en periodos con muchas
// ventas) sustituida por un único inArray + suma en JS — mismo resultado,
// una sola ida a BD. reservationIds nunca repite un id (cada venta tiene su
// propia reserva), así que no hay riesgo de doble conteo.
async function sumPromotionalValueCents(reservationIds: number[], conn: DbHandle): Promise<number> {
  if (reservationIds.length === 0) return 0;
  const rows = await conn.select({ promotionalValueCents: tokenSpendReservations.promotionalValueCents })
    .from(tokenSpendReservations).where(inArray(tokenSpendReservations.id, reservationIds));
  return rows.reduce((sum, r) => sum + (r.promotionalValueCents ?? 0), 0);
}

/** Aplica el reparto de tokenFundingModel sobre un valor de ST ya neto (ventas del periodo menos lo revertido por reembolsos totales del periodo — ver calculateSettlement). */
function applyTokenFundingModel(netTokenValueCents: number, model: string): number {
  if (model === "no_settlement_value" || model === "venue_funded") return 0;
  if (model === "shared") return Math.round(netTokenValueCents / 2); // spec §60, split simple documentado
  return netTokenValueCents; // platform_funded = 100%
}

/**
 * Calcula (nunca aprueba/paga) una liquidación para venue+periodo. Crea una
 * fila DRAFT->CALCULATED con líneas auditables (spec §65) — nunca solo un
 * total. Idempotente por (venueId, eventId, periodStart, periodEnd): un
 * recálculo del MISMO periodo antes de aprobar sustituye sus líneas
 * anteriores (spec §66, solo DRAFT/CALCULATED son mutables; una vez
 * approved/paid, nunca se recalcula — hay que crear un periodo nuevo).
 */
export async function calculateSettlement(input: CalculateSettlementInput, db?: DbHandle): Promise<Settlement> {
  const conn = db ?? (await getDb());
  if (input.periodEnd <= input.periodStart) throw new SettlementError("INVALID_PERIOD", "El periodo debe tener fin posterior al inicio");

  const seller = await resolveSellerForVenue(input.venueId, conn);
  const agreement = await resolveAgreement(input.venueId, input.eventId, conn);

  const commissionModel = agreement?.commissionModel ?? "no_commission";
  const commissionBasisPoints = agreement?.commissionBasisPoints ?? 0;
  const fixedFeeCents = agreement?.fixedFeeCents ?? 0;
  const tokenFundingModel = agreement?.tokenFundingModel ?? "no_settlement_value";
  const benefitFundingModel = agreement?.benefitFundingModel ?? "no_settlement_value";

  const posConditions = [
    eq(commerceTransactions.venueId, input.venueId),
    eq(commerceTransactions.provider, "segolife"), // solo nativo — spec §70-72
    gte(commerceTransactions.occurredAt, input.periodStart),
    lte(commerceTransactions.occurredAt, input.periodEnd),
    inArray(commerceTransactions.status, ["confirmed", "refunded", "partially_refunded"]),
  ];
  if (input.eventId != null) posConditions.push(eq(commerceTransactions.eventId, input.eventId));
  const posSales = await conn.select().from(commerceTransactions).where(and(...posConditions));

  const doorSales = await conn.select({ order: ticketOrders }).from(ticketOrders)
    .innerJoin(events, eq(events.id, ticketOrders.eventId))
    .where(and(
      eq(events.venueId, input.venueId),
      inArray(ticketOrders.channel, ["online", "door"]), // solo nativo — spec §70-72
      gte(ticketOrders.purchasedAt, input.periodStart),
      lte(ticketOrders.purchasedAt, input.periodEnd),
      inArray(ticketOrders.status, ["paid", "refunded", "partially_refunded"]),
      ...(input.eventId != null ? [eq(ticketOrders.eventId, input.eventId)] : []),
    ));

  const refundConditions = [
    eq(commerceRefunds.venueId, input.venueId),
    gte(commerceRefunds.createdAt, input.periodStart),
    lte(commerceRefunds.createdAt, input.periodEnd),
  ];
  if (input.eventId != null) refundConditions.push(eq(commerceRefunds.eventId, input.eventId));
  const refunds = await conn.select().from(commerceRefunds).where(and(...refundConditions));

  const isPercent = commissionModel === "platform_commission_percent";
  const lines: Array<Omit<typeof settlementLines.$inferInsert, "settlementId">> = [];

  let grossSalesCents = 0;
  for (const tx of posSales) {
    const commissionCents = isPercent ? calcCommissionCents(tx.totalCents, commissionBasisPoints) : 0;
    lines.push({ sourceType: "commerce_transaction", sourceId: tx.id, grossAmountCents: tx.totalCents, commissionCents, netCents: tx.totalCents - commissionCents });
    grossSalesCents += tx.totalCents;
  }
  for (const { order } of doorSales) {
    const commissionCents = isPercent ? calcCommissionCents(order.totalCents, commissionBasisPoints) : 0;
    lines.push({ sourceType: "ticket_order", sourceId: order.id, grossAmountCents: order.totalCents, commissionCents, netCents: order.totalCents - commissionCents });
    grossSalesCents += order.totalCents;
  }

  let refundsCents = 0;
  for (const refund of refunds) {
    const commissionClawbackCents = isPercent ? -calcCommissionCents(refund.amountCents, commissionBasisPoints) : 0;
    lines.push({ sourceType: "commerce_refund", sourceId: refund.id, grossAmountCents: -refund.amountCents, commissionCents: commissionClawbackCents, netCents: -refund.amountCents - commissionClawbackCents });
    refundsCents += refund.amountCents;
  }

  const netSalesCents = grossSalesCents - refundsCents;
  const lineCommissionCents = lines.reduce((sum, l) => sum + (l.commissionCents ?? 0), 0);
  const commissionCents = commissionModel === "fixed_fee" ? fixedFeeCents : lineCommissionCents;

  // PRE-16.15 BUG-10 (auditoría overnight — corrección de doble contabilización
  // de SegoTokens): `grossSalesCents`/`netSalesCents` son SIEMPRE brutos —
  // `totalCents` nunca se reduce por ST aplicado (mismo invariante que
  // commerce_transactions/ticket_orders en todo el resto del dominio). El
  // valor promocional de ST ya vive DENTRO de ese bruto — nunca es dinero
  // real adicional que la plataforma cobró. El bug original sumaba
  // `tokenSubsidyCents` ENCIMA de una base ya bruta cuando la plataforma
  // cobraba (`collectorIsVenue=false`), pagando al venue el bruto completo
  // Y ADEMÁS el reembolso ST — doble. La base correcta para "la plataforma
  // paga al venue" es el DINERO REAL cobrado (bruto menos el valor ST), y
  // el subsidio se SUMA aparte para reconstruir cuánto le corresponde
  // realmente al venue según quién financia el ST (spec §60): así
  // "plataforma cobra 31€ reales + financia 15€ de ST = paga 46€ al venue"
  // en vez de "paga 46€ + 15€ = 61€".
  //
  // Reembolsos totales (`!refund.partial`, spec §21: SegoTokens/recompensa
  // solo se revierten cuando el reembolso acumulado llega al 100%) revierten
  // el valor ST de la venta ORIGINAL en el periodo en que ocurre el
  // REEMBOLSO — no en el periodo de la venta original (que puede ya estar
  // aprobado/pagado). Esto puede dejar netTokenValueCents/el subsidio en
  // negativo en el periodo del reembolso — correcto: es un clawback real de
  // lo que se sobrepagó al venue en un periodo anterior por una venta que ya
  // no se sostiene.
  const salesReservationIds = [...posSales.map(t => t.tokenReservationId), ...doorSales.map(d => d.order.tokenReservationId)]
    .filter((id): id is number => id != null);
  const grossTokenValueCents = await sumPromotionalValueCents(salesReservationIds, conn);

  let reversedTokenValueCents = 0;
  for (const refund of refunds) {
    if (refund.partial) continue; // reembolso parcial -> spec §21, ST NUNCA se revierte todavía
    const [original] = refund.sourceType === "commerce_transaction"
      ? await conn.select({ tokenReservationId: commerceTransactions.tokenReservationId }).from(commerceTransactions).where(eq(commerceTransactions.id, refund.sourceId)).limit(1)
      : await conn.select({ tokenReservationId: ticketOrders.tokenReservationId }).from(ticketOrders).where(eq(ticketOrders.id, refund.sourceId)).limit(1);
    if (!original?.tokenReservationId) continue;
    reversedTokenValueCents += await sumPromotionalValueCents([original.tokenReservationId], conn);
  }

  const netTokenValueCents = grossTokenValueCents - reversedTokenValueCents;
  const tokenSubsidyCents = applyTokenFundingModel(netTokenValueCents, tokenFundingModel);
  // Dinero real neto del periodo (bruto neto de reembolsos, menos el valor
  // ST neto de reembolsos) — SOLO relevante cuando la plataforma cobra: es
  // lo que la plataforma tiene efectivamente en mano para empezar a pagarle
  // al venue, antes de sumar el subsidio de ST que le corresponda.
  const netMoneyCollectedCents = netSalesCents - netTokenValueCents;

  // Benefits (spec §61/§62): arquitectura lista (benefitFundingModel
  // configurable), pero SIEMPRE 0 hoy — un Benefit no lleva un valor
  // monetario propio almacenado en Fase 4-6, y la spec prohíbe explícitamente
  // "guess who finances" — nunca se inventa un importe.
  const benefitSubsidyCents = 0;
  void benefitFundingModel;

  const collectorIsVenue = !seller.collectorEntity || seller.collectorEntity.id === seller.sellerEntity?.id;
  const base = collectorIsVenue ? -commissionCents : netMoneyCollectedCents - commissionCents;
  const netPayableToVenueCents = base + tokenSubsidyCents + benefitSubsidyCents;

  // Recálculo del mismo periodo (antes de aprobar) sustituye sus líneas.
  const existingConditions = [
    eq(settlements.venueId, input.venueId),
    eq(settlements.periodStart, input.periodStart),
    eq(settlements.periodEnd, input.periodEnd),
  ];
  const [existing] = input.eventId != null
    ? await conn.select().from(settlements).where(and(...existingConditions, eq(settlements.eventId, input.eventId))).limit(1)
    : await conn.select().from(settlements).where(and(...existingConditions)).limit(1);
  if (existing && existing.status !== "draft" && existing.status !== "calculated") {
    throw new SettlementError("ALREADY_FINALIZED", "Esta liquidación ya fue aprobada o pagada — no se puede recalcular. Crea un nuevo periodo.");
  }

  const values = {
    venueId: input.venueId, eventId: input.eventId ?? null,
    periodStart: input.periodStart, periodEnd: input.periodEnd,
    status: "calculated" as const,
    sellerEntityId: seller.sellerEntity?.id ?? null,
    collectorEntityId: seller.collectorEntity?.id ?? seller.sellerEntity?.id ?? null,
    commissionModel, commissionBasisPoints, fixedFeeCents,
    tokenFundingModel, benefitFundingModel,
    grossSalesCents, refundsCents, netSalesCents, commissionCents,
    tokenSubsidyCents, benefitSubsidyCents, netPayableToVenueCents,
    calculatedAt: new Date(),
  };

  let settlementId: number;
  if (existing) {
    await conn.update(settlements).set(values).where(eq(settlements.id, existing.id));
    settlementId = existing.id;
    await conn.delete(settlementLines).where(eq(settlementLines.settlementId, settlementId));
  } else {
    const [result] = await conn.insert(settlements).values(values);
    settlementId = (result as unknown as { insertId: number }).insertId;
  }
  for (const line of lines) {
    await conn.insert(settlementLines).values({ ...line, settlementId });
  }

  const [row] = await conn.select().from(settlements).where(eq(settlements.id, settlementId)).limit(1);
  return row!;
}

export async function approveSettlement(settlementId: number, approvedByUserId: number, db?: DbHandle): Promise<Settlement> {
  const conn = db ?? (await getDb());
  const [result] = await conn.update(settlements).set({ status: "approved", approvedAt: new Date(), approvedByUserId })
    .where(and(eq(settlements.id, settlementId), eq(settlements.status, "calculated")));
  if ((result as unknown as { affectedRows: number }).affectedRows === 0) {
    throw new SettlementError("INVALID_STATE", "Solo se puede aprobar una liquidación en estado 'calculada'");
  }
  const [row] = await conn.select().from(settlements).where(eq(settlements.id, settlementId)).limit(1);
  return row!;
}

export async function markSettlementPaid(settlementId: number, paidByUserId: number, db?: DbHandle): Promise<Settlement> {
  const conn = db ?? (await getDb());
  const [result] = await conn.update(settlements).set({ status: "paid", paidAt: new Date(), paidByUserId })
    .where(and(eq(settlements.id, settlementId), eq(settlements.status, "approved")));
  if ((result as unknown as { affectedRows: number }).affectedRows === 0) {
    throw new SettlementError("INVALID_STATE", "Solo se puede marcar como pagada una liquidación ya aprobada");
  }
  const [row] = await conn.select().from(settlements).where(eq(settlements.id, settlementId)).limit(1);
  return row!;
}

export async function listSettlements(venueId?: number, db?: DbHandle): Promise<Settlement[]> {
  const conn = db ?? (await getDb());
  if (venueId != null) return conn.select().from(settlements).where(eq(settlements.venueId, venueId)).orderBy(settlements.periodStart);
  return conn.select().from(settlements).orderBy(settlements.periodStart);
}

/**
 * SEGOLIFE ADMIN AI/BI/COMMAND CENTER (Fase 12, spec §32): "needing
 * attention" = liquidaciones que ya empezaron su ciclo de vida real
 * (calculated/approved) pero todavía no llegaron a `paid` — nunca se infiere
 * un pago completado sin evidencia (`markSettlementPaid` real).
 */
export async function listSettlementsNeedingAttention(db?: DbHandle): Promise<Settlement[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(settlements).where(inArray(settlements.status, ["calculated", "approved"])).orderBy(settlements.periodStart);
}

export async function getSettlementDetail(settlementId: number, db?: DbHandle): Promise<{ settlement: Settlement; lines: SettlementLine[] } | null> {
  const conn = db ?? (await getDb());
  const [settlement] = await conn.select().from(settlements).where(eq(settlements.id, settlementId)).limit(1);
  if (!settlement) return null;
  const lines = await conn.select().from(settlementLines).where(eq(settlementLines.settlementId, settlementId));
  return { settlement, lines };
}
