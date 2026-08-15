/**
 * settlementService.test.ts — SEGOLIFE FASE 10 (spec §55-69/§111). Motor de
 * liquidaciones: signo según quién cobra (§59 CRÍTICO, respuestas P/Q),
 * exclusión estricta de Fourvenues (§70-72, respuesta T), inmutabilidad tras
 * aprobar/pagar (§67).
 */
import { describe, it, expect, vi } from "vitest";
import { drizzleConditionMockFactory, MockTable, createMockDb } from "../_testHelpers/drizzleTableMock";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, ...drizzleConditionMockFactory() };
});

const { mockResolveSellerForVenue } = vi.hoisted(() => ({ mockResolveSellerForVenue: vi.fn() }));
vi.mock("../fiscal/commercialEntityService", () => ({ resolveSellerForVenue: mockResolveSellerForVenue }));

const { mockResolveAgreement } = vi.hoisted(() => ({ mockResolveAgreement: vi.fn() }));
vi.mock("./commercialAgreementService", () => ({ resolveAgreement: mockResolveAgreement }));

import { settlements, venueSettlementLines, commerceTransactions, ticketOrders, events, commerceRefunds, tokenSpendReservations } from "../../../drizzle/schema";
import { calculateSettlement, approveSettlement, markSettlementPaid } from "./settlementService";

function makeDb(config: {
  settlementsRows?: Array<Record<string, unknown>>;
  commerceTx?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  eventsRows?: Array<Record<string, unknown>>;
  refunds?: Array<Record<string, unknown>>;
  reservations?: Array<Record<string, unknown>>;
} = {}) {
  const tables = new Map<unknown, MockTable<Record<string, unknown>>>([
    [settlements, new MockTable(settlements as unknown as Record<string, unknown>, config.settlementsRows ?? [])],
    [venueSettlementLines, new MockTable(venueSettlementLines as unknown as Record<string, unknown>, [])],
    [commerceTransactions, new MockTable(commerceTransactions as unknown as Record<string, unknown>, config.commerceTx ?? [])],
    [ticketOrders, new MockTable(ticketOrders as unknown as Record<string, unknown>, config.orders ?? [])],
    [events, new MockTable(events as unknown as Record<string, unknown>, config.eventsRows ?? [{ id: 5, venueId: 10 }])],
    [commerceRefunds, new MockTable(commerceRefunds as unknown as Record<string, unknown>, config.refunds ?? [])],
    [tokenSpendReservations, new MockTable(tokenSpendReservations as unknown as Record<string, unknown>, config.reservations ?? [])],
  ]);
  const db = createMockDb(tables);
  return { db, settlementsTable: tables.get(settlements)!, linesTable: tables.get(venueSettlementLines)! };
}

const PERIOD = { periodStart: new Date("2026-08-01T00:00:00Z"), periodEnd: new Date("2026-08-31T23:59:59Z") };

describe("calculateSettlement — signo según quién cobra (spec §59 CRÍTICO, respuestas P/Q)", () => {
  it("#1 el venue COBRA (collectorEntity=null): con comisión 10% sobre 1000, el venue DEBE 100 a la plataforma (negativo)", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: null });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "platform_commission_percent", commissionBasisPoints: 1000, fixedFeeCents: 0, tokenFundingModel: "no_settlement_value", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: null }],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.commissionCents).toBe(100);
    expect(s.netPayableToVenueCents).toBe(-100);
  });

  it("#2 LA PLATAFORMA COBRA (collectorEntity=id distinto del seller): con comisión 10% sobre 1000, la plataforma DEBE 900 al venue (positivo)", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: { id: 7 } });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "platform_commission_percent", commissionBasisPoints: 1000, fixedFeeCents: 0, tokenFundingModel: "no_settlement_value", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: null }],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.commissionCents).toBe(100);
    expect(s.netPayableToVenueCents).toBe(900);
  });

  it("#3 sin acuerdo configurado, comisión 0 — nunca se inventa un porcentaje (spec §56/§106)", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: false, sellerEntity: null, collectorEntity: null });
    mockResolveAgreement.mockResolvedValue(null);
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: null }],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.commissionCents).toBe(0);
  });
});

describe("calculateSettlement — SegoTokens funding (spec §60/§61, respuesta R: nunca se adivina)", () => {
  it("#4 tokenFundingModel='platform_funded': la plataforma reembolsa el 100% del valor promocional al venue", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: null });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "platform_funded", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: 500 }],
      reservations: [{ id: 500, promotionalValueCents: 300, moneyDueCents: 700 }],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.tokenSubsidyCents).toBe(300);
    expect(s.netPayableToVenueCents).toBe(300); // sin comisión, solo el reembolso ST
  });

  it("#5 tokenFundingModel='venue_funded': el venue asume el coste — 0 subsidio", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: null });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "venue_funded", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: 500 }],
      reservations: [{ id: 500, promotionalValueCents: 300, moneyDueCents: 700 }],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.tokenSubsidyCents).toBe(0);
  });

  it("#6 tokenFundingModel='shared': reparto 50/50", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: null });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "shared", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: 500 }],
      reservations: [{ id: 500, promotionalValueCents: 300, moneyDueCents: 700 }],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.tokenSubsidyCents).toBe(150);
  });

  it("#7 Benefits: benefitSubsidyCents siempre 0 hoy — nunca se inventa un valor económico (spec §61, respuesta R)", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: null });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "no_settlement_value", benefitFundingModel: "platform_funded" });
    const { db } = makeDb({ commerceTx: [] });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.benefitSubsidyCents).toBe(0);
  });
});

describe("calculateSettlement — SOLO ventas nativas (spec §70-72, respuesta T CRÍTICA)", () => {
  it("#8 una venta de Fourvenues (provider≠segolife) NUNCA entra en el cálculo", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: null });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "no_settlement_value", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "fourvenues", eventId: null, status: "confirmed", totalCents: 99999, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: null }],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.grossSalesCents).toBe(0);
  });

  it("#9 refunds del periodo se restan del bruto para obtener el neto", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: null });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "no_settlement_value", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: null }],
      refunds: [{ id: 1, sourceType: "commerce_transaction", sourceId: 1, venueId: 10, eventId: null, amountCents: 200, createdAt: new Date("2026-08-16T20:00:00Z") }],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.grossSalesCents).toBe(1000);
    expect(s.refundsCents).toBe(200);
    expect(s.netSalesCents).toBe(800);
  });
});

describe("Inmutabilidad y ciclo de vida (spec §66/§67)", () => {
  it("#10 recalcular un periodo ya APROBADO lanza ALREADY_FINALIZED — nunca sobrescribe", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: false, sellerEntity: null, collectorEntity: null });
    mockResolveAgreement.mockResolvedValue(null);
    const { db } = makeDb({
      settlementsRows: [{ id: 1, venueId: 10, eventId: null, periodStart: PERIOD.periodStart, periodEnd: PERIOD.periodEnd, status: "approved" }],
    });
    await expect(calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db)).rejects.toMatchObject({ code: "ALREADY_FINALIZED" });
  });

  it("#11 aprobar exige estado 'calculated'", async () => {
    const { db } = makeDb({ settlementsRows: [{ id: 1, venueId: 10, status: "draft" }] });
    await expect(approveSettlement(1, 9, db)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("#12 marcar pagada exige estado 'approved'", async () => {
    const { db } = makeDb({ settlementsRows: [{ id: 1, venueId: 10, status: "calculated" }] });
    await expect(markSettlementPaid(1, 9, db)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("#13 flujo completo calculated -> approved -> paid funciona en orden", async () => {
    const { db } = makeDb({ settlementsRows: [{ id: 1, venueId: 10, status: "calculated" }] });
    const approved = await approveSettlement(1, 9, db);
    expect(approved.status).toBe("approved");
    const paid = await markSettlementPaid(1, 9, db);
    expect(paid.status).toBe("paid");
  });
});
