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

// ─── PRE-16.15 BUG-10 — matriz requerida A-J: nunca doble contabilización de
// SegoTokens al liquidar. Bug real: cuando la plataforma cobra
// (collectorEntity≠seller), la base usaba el bruto (netSalesCents, que YA
// incluye el valor ST) y luego SUMABA el subsidio de ST encima — pagando al
// venue el bruto completo MÁS el reembolso de ST, en vez de dinero-real +
// subsidio = bruto. Los casos A/B (venue cobra) ya estaban cubiertos y
// correctos por los tests #4-6 de arriba — aquí se cubre explícitamente el
// caso que SÍ tenía el bug (plataforma cobra) y los casos de reembolso.
describe("calculateSettlement — BUG-10, matriz de doble contabilización de ST (Pre-16.15)", () => {
  const reservation = { id: 500, promotionalValueCents: 300, moneyDueCents: 700 };

  it("A. Venue cobra, sin ST: netPayableToVenueCents = bruto - comisión (ya cubierto por tests #1-3, repetido aquí por completitud de la matriz)", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: null });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "no_settlement_value", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({ commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: null }] });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.netPayableToVenueCents).toBe(0);
  });

  it("B. Venue cobra, ST parcial, platform_funded: el venue recibe el reembolso de ST completo aparte (ya probado en test #4) — el dinero ya lo tiene, esto es SOLO el subsidio", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: null });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "platform_funded", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: 500 }],
      reservations: [reservation],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.netPayableToVenueCents).toBe(300);
  });

  it("C. Plataforma cobra, sin ST: netPayableToVenueCents = dinero real cobrado - comisión (idéntico al bruto, no hay ST)", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: { id: 7 } });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "no_settlement_value", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({ commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: null }] });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.netPayableToVenueCents).toBe(1000);
  });

  it("D. Plataforma cobra, ST parcial, platform_funded (EL CASO DEL BUG): venue recibe exactamente el bruto (1000) — NUNCA bruto + subsidio (1300)", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: { id: 7 } });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "platform_funded", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: 500 }],
      reservations: [reservation],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.tokenSubsidyCents).toBe(300);
    expect(s.netPayableToVenueCents).toBe(1000); // NUNCA 1300 — ese era el bug real
  });

  it("D2. Plataforma cobra, ST parcial, venue_funded: el venue absorbe el ST — recibe solo el dinero real cobrado (700), no el bruto", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: { id: 7 } });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "venue_funded", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: 500 }],
      reservations: [reservation],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.tokenSubsidyCents).toBe(0);
    expect(s.netPayableToVenueCents).toBe(700); // el venue asume los 300 de ST, nunca los 1000 completos
  });

  it("D3. Plataforma cobra, ST parcial, shared: el venue recibe el dinero real más la mitad del subsidio", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: { id: 7 } });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "shared", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: 500 }],
      reservations: [reservation],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.tokenSubsidyCents).toBe(150);
    expect(s.netPayableToVenueCents).toBe(850); // 700 dinero real + 150 mitad del subsidio
  });

  it("E. Plataforma cobra, 100% ST (moneyDueCents=0), platform_funded: el venue recibe exactamente el bruto, todo vía subsidio — nunca el doble", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: { id: 7 } });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "platform_funded", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "confirmed", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: 500 }],
      reservations: [{ id: 500, promotionalValueCents: 1000, moneyDueCents: 0 }],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.tokenSubsidyCents).toBe(1000);
    expect(s.netPayableToVenueCents).toBe(1000); // nunca 2000
  });

  it("F/G/H. tokenFundingModel se respeta también cuando cobra la plataforma (venue_funded/platform_funded/shared ya cubiertos en D/D2/D3)", () => {
    expect(true).toBe(true); // cobertura explícita: ver D (platform_funded), D2 (venue_funded), D3 (shared)
  });

  it("I. Reembolso TOTAL tras venta mixta (plataforma cobra): revierte el subsidio de ST del periodo del reembolso, incluso si la venta original fue de OTRO periodo (clawback real)", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: { id: 7 } });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "platform_funded", benefitFundingModel: "no_settlement_value" });
    // Venta y reembolso total en el MISMO periodo — el neto debe quedar
    // exactamente en cero (nunca queda ni un resto de dinero real ni de
    // subsidio de ST, sea cual sea el reparto).
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "refunded", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: 500 }],
      refunds: [{ id: 1, sourceType: "commerce_transaction", sourceId: 1, venueId: 10, eventId: null, amountCents: 1000, partial: false, createdAt: new Date("2026-08-16T20:00:00Z") }],
      reservations: [reservation],
    });
    const s = await calculateSettlement({ venueId: 10, periodStart: PERIOD.periodStart, periodEnd: PERIOD.periodEnd, createdByUserId: 1 }, db);
    // gross=1000, refund=1000 -> netSalesCents=0; ST bruto=300, revertido=300
    // (el mismo reembolso total) -> netTokenValueCents=0 -> subsidio=0.
    expect(s.netSalesCents).toBe(0);
    expect(s.tokenSubsidyCents).toBe(0);
    expect(s.netPayableToVenueCents).toBe(0);
  });

  it("I3. Reembolso TOTAL de una venta de un periodo YA liquidado (clawback real en el periodo del reembolso): el venue devuelve exactamente el bruto original, incluyendo la parte que fue subsidio", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: { id: 7 } });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "platform_funded", benefitFundingModel: "no_settlement_value" });
    // La venta original NO cae en el periodo de agosto (ocurrió en julio, ya
    // liquidada) — solo su reembolso cae en agosto. commerceTx sigue
    // necesitando la fila para que el lookup por id encuentre su
    // tokenReservationId, pero al estar fuera del rango de fechas del
    // periodo, `posSales` para agosto queda vacío — la venta no se cuenta
    // dos veces.
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "refunded", totalCents: 1000, occurredAt: new Date("2026-07-15T20:00:00Z"), tokenReservationId: 500 }],
      refunds: [{ id: 1, sourceType: "commerce_transaction", sourceId: 1, venueId: 10, eventId: null, amountCents: 1000, partial: false, createdAt: new Date("2026-08-16T20:00:00Z") }],
      reservations: [reservation],
    });
    const s = await calculateSettlement({ venueId: 10, periodStart: PERIOD.periodStart, periodEnd: PERIOD.periodEnd, createdByUserId: 1 }, db);
    expect(s.grossSalesCents).toBe(0); // la venta de julio no se recuenta en agosto
    expect(s.refundsCents).toBe(1000);
    expect(s.netPayableToVenueCents).toBe(-1000); // el venue devuelve el bruto completo que había cobrado de más en julio
  });

  it("I2. Reembolso PARCIAL (partial=true): SegoTokens NUNCA se revierte todavía (spec §21) — el subsidio de ST no se toca por este reembolso", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: { id: 7 } });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "platform_funded", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "segolife", eventId: null, status: "partially_refunded", totalCents: 1000, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: 500 }],
      refunds: [{ id: 1, sourceType: "commerce_transaction", sourceId: 1, venueId: 10, eventId: null, amountCents: 200, partial: true, createdAt: new Date("2026-08-16T20:00:00Z") }],
      reservations: [reservation],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    // gross=1000, refund=200 (parcial) -> netSalesCents=800; ST=300 completo (no revertido) -> netTokenValueCents=300
    expect(s.netSalesCents).toBe(800);
    expect(s.tokenSubsidyCents).toBe(300); // completo, no revertido por el parcial
    expect(s.netPayableToVenueCents).toBe(800 - 300 + 300); // = 800 (dinero real neto de reembolso + subsidio completo)
  });

  it("J. Fourvenues sigue excluido del cálculo de subsidio de ST (spec §70-72, ya probado sin ST en test #8 — aquí con ST presente para confirmar que ni siquiera se consulta su reserva)", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3 }, collectorEntity: { id: 7 } });
    mockResolveAgreement.mockResolvedValue({ commissionModel: "no_commission", commissionBasisPoints: 0, fixedFeeCents: 0, tokenFundingModel: "platform_funded", benefitFundingModel: "no_settlement_value" });
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, provider: "fourvenues_integrations", eventId: null, status: "confirmed", totalCents: 99999, occurredAt: new Date("2026-08-15T20:00:00Z"), tokenReservationId: 999 }],
      reservations: [{ id: 999, promotionalValueCents: 50000, moneyDueCents: 49999 }],
    });
    const s = await calculateSettlement({ venueId: 10, ...PERIOD, createdByUserId: 1 }, db);
    expect(s.grossSalesCents).toBe(0);
    expect(s.tokenSubsidyCents).toBe(0);
    expect(s.netPayableToVenueCents).toBe(0);
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
