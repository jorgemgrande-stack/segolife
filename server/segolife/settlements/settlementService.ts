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

async function tokenSubsidyForModel(sales: Array<{ tokenReservationId: number | null }>, model: string, conn: DbHandle): Promise<number> {
  if (model === "no_settlement_value" || model === "venue_funded") return 0;
  let total = 0;
  for (const s of sales) {
    if (!s.tokenReservationId) continue;
    const [r] = await conn.select({ promotionalValueCents: tokenSpendReservations.promotionalValueCents }).from(tokenSpendReservations).where(eq(tokenSpendReservations.id, s.tokenReservationId)).limit(1);
    total += r?.promotionalValueCents ?? 0;
  }
  return model === "shared" ? Math.round(total / 2) : total; // platform_funded = 100%, shared = 50/50 (spec §60, split simple documentado)
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

  const tokenSubsidyCents = await tokenSubsidyForModel(
    [...posSales.map(t => ({ tokenReservationId: t.tokenReservationId })), ...doorSales.map(d => ({ tokenReservationId: d.order.tokenReservationId }))],
    tokenFundingModel, conn,
  );
  // Benefits (spec §61/§62): arquitectura lista (benefitFundingModel
  // configurable), pero SIEMPRE 0 hoy — un Benefit no lleva un valor
  // monetario propio almacenado en Fase 4-6, y la spec prohíbe explícitamente
  // "guess who finances" — nunca se inventa un importe.
  const benefitSubsidyCents = 0;
  void benefitFundingModel;

  const collectorIsVenue = !seller.collectorEntity || seller.collectorEntity.id === seller.sellerEntity?.id;
  const base = collectorIsVenue ? -commissionCents : netSalesCents - commissionCents;
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

export async function getSettlementDetail(settlementId: number, db?: DbHandle): Promise<{ settlement: Settlement; lines: SettlementLine[] } | null> {
  const conn = db ?? (await getDb());
  const [settlement] = await conn.select().from(settlements).where(eq(settlements.id, settlementId)).limit(1);
  if (!settlement) return null;
  const lines = await conn.select().from(settlementLines).where(eq(settlementLines.settlementId, settlementId));
  return { settlement, lines };
}
