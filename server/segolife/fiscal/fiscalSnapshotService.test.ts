/**
 * fiscalSnapshotService.test.ts — SEGOLIFE FASE 10 (spec §10/§71/§72/§S
 * CRÍTICO). Propiedad de seguridad más importante de todo Fase 10: una
 * venta de Fourvenues NUNCA genera un snapshot fiscal (visibilidad en
 * Ventas ≠ responsabilidad fiscal de Segolife) — si esto fallara, Fase 10
 * podría acabar facturando ventas que Segolife nunca vendió.
 */
import { describe, it, expect, vi } from "vitest";
import { drizzleConditionMockFactory, MockTable, createMockDb } from "../_testHelpers/drizzleTableMock";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, ...drizzleConditionMockFactory() };
});

const { mockResolveSellerForVenue } = vi.hoisted(() => ({ mockResolveSellerForVenue: vi.fn() }));
vi.mock("./commercialEntityService", () => ({ resolveSellerForVenue: mockResolveSellerForVenue }));

import {
  commerceTransactions, commerceTransactionItems, venueProducts,
  ticketOrders, ticketOrderItems, eventTicketTypes, events,
  tokenSpendReservations, fiscalTransactionSnapshots,
} from "../../../drizzle/schema";
import { ensureFiscalSnapshot } from "./fiscalSnapshotService";

function commerceTxFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, provider: "segolife", venueId: 10, eventId: null, userId: 42, status: "confirmed", totalCents: 2000, paymentMethod: "cash", tokenReservationId: null, occurredAt: new Date("2026-08-01T20:00:00Z"), currency: "EUR", ...overrides };
}
function ticketOrderFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, channel: "door", eventId: 5, userId: 42, status: "paid", totalCents: 1500, paymentMethod: "cash", tokenReservationId: null, purchasedAt: new Date("2026-08-01T21:00:00Z"), createdAt: new Date(), currency: "EUR", ...overrides };
}

function makeDb(config: {
  commerceTx?: Array<Record<string, unknown>>;
  commerceItems?: Array<Record<string, unknown>>;
  products?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  orderItems?: Array<Record<string, unknown>>;
  ticketTypes?: Array<Record<string, unknown>>;
  eventsRows?: Array<Record<string, unknown>>;
  reservations?: Array<Record<string, unknown>>;
  snapshots?: Array<Record<string, unknown>>;
} = {}) {
  const tables = new Map<unknown, MockTable<Record<string, unknown>>>([
    [commerceTransactions, new MockTable(commerceTransactions as unknown as Record<string, unknown>, config.commerceTx ?? [])],
    [commerceTransactionItems, new MockTable(commerceTransactionItems as unknown as Record<string, unknown>, config.commerceItems ?? [])],
    [venueProducts, new MockTable(venueProducts as unknown as Record<string, unknown>, config.products ?? [])],
    [ticketOrders, new MockTable(ticketOrders as unknown as Record<string, unknown>, config.orders ?? [])],
    [ticketOrderItems, new MockTable(ticketOrderItems as unknown as Record<string, unknown>, config.orderItems ?? [])],
    [eventTicketTypes, new MockTable(eventTicketTypes as unknown as Record<string, unknown>, config.ticketTypes ?? [])],
    [events, new MockTable(events as unknown as Record<string, unknown>, config.eventsRows ?? [{ id: 5, venueId: 10 }])],
    [tokenSpendReservations, new MockTable(tokenSpendReservations as unknown as Record<string, unknown>, config.reservations ?? [])],
    [fiscalTransactionSnapshots, new MockTable(fiscalTransactionSnapshots as unknown as Record<string, unknown>, config.snapshots ?? [])],
  ]);
  const db = createMockDb(tables);
  return { db, snapshotsTable: tables.get(fiscalTransactionSnapshots)! };
}

describe("ensureFiscalSnapshot — SOLO ventas nativas (spec §71/§72/§S CRÍTICO)", () => {
  it("#1 commerce_transaction de Fourvenues (provider≠segolife) NUNCA genera snapshot", async () => {
    const { db, snapshotsTable } = makeDb({ commerceTx: [commerceTxFixture({ provider: "fourvenues" })] });
    const result = await ensureFiscalSnapshot("commerce_transaction", 1, db);
    expect(result).toBeNull();
    expect(snapshotsTable.rows).toHaveLength(0);
  });

  it("#2 ticket_order de Fourvenues (channel NULL) NUNCA genera snapshot", async () => {
    const { db, snapshotsTable } = makeDb({ orders: [ticketOrderFixture({ channel: null })] });
    const result = await ensureFiscalSnapshot("ticket_order", 1, db);
    expect(result).toBeNull();
    expect(snapshotsTable.rows).toHaveLength(0);
  });

  it("#3 venta nativa PENDIENTE (no finalizada) no genera snapshot todavía", async () => {
    const { db } = makeDb({ commerceTx: [commerceTxFixture({ status: "pending" })] });
    expect(await ensureFiscalSnapshot("commerce_transaction", 1, db)).toBeNull();
  });

  it("#4 venta nativa CONFIRMADA genera snapshot con el gross/promotional/money correctos", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: false, sellerEntity: null, collectorEntity: null });
    const { db } = makeDb({
      commerceTx: [commerceTxFixture({ tokenReservationId: 900, totalCents: 2000 })],
      commerceItems: [{ id: 1, transactionId: 1, venueProductId: null, description: "Copa", quantity: 1, unitAmountCents: 2000, totalAmountCents: 2000 }],
      reservations: [{ id: 900, promotionalValueCents: 500, moneyDueCents: 1500 }],
    });
    const snapshot = await ensureFiscalSnapshot("commerce_transaction", 1, db);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.grossAmountCents).toBe(2000);
    expect(snapshot!.promotionalValueCents).toBe(500);
    expect(snapshot!.moneyDueCents).toBe(1500);
  });

  it("#5 venta de puerta nativa (ticket_order channel='door') SÍ genera snapshot", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: false, sellerEntity: null, collectorEntity: null });
    const { db } = makeDb({
      orders: [ticketOrderFixture()],
      orderItems: [{ id: 1, orderId: 1, ticketTypeId: null, quantity: 1, unitPriceCents: 1500, totalPriceCents: 1500 }],
    });
    const snapshot = await ensureFiscalSnapshot("ticket_order", 1, db);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.venueId).toBe(10); // resuelto vía events.venueId
  });

  it("#6 idempotente — get-or-create, no duplica en una segunda llamada", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: false, sellerEntity: null, collectorEntity: null });
    const { db, snapshotsTable } = makeDb({
      commerceTx: [commerceTxFixture()],
      commerceItems: [{ id: 1, transactionId: 1, venueProductId: null, description: "Copa", quantity: 1, unitAmountCents: 2000, totalAmountCents: 2000 }],
    });
    const a = await ensureFiscalSnapshot("commerce_transaction", 1, db);
    const b = await ensureFiscalSnapshot("commerce_transaction", 1, db);
    expect(a!.id).toBe(b!.id);
    expect(snapshotsTable.rows).toHaveLength(1);
  });

  it("#7 tipo de IVA sin configurar en NINGUNA línea → taxRateBasisPoints/taxBaseCents/taxAmountCents quedan null (nunca se adivina, spec §106)", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: false, sellerEntity: null, collectorEntity: null });
    const { db } = makeDb({
      commerceTx: [commerceTxFixture()],
      commerceItems: [{ id: 1, transactionId: 1, venueProductId: 7, description: "Copa", quantity: 1, unitAmountCents: 2000, totalAmountCents: 2000 }],
      products: [{ id: 7, venueId: 10, taxRateId: null }],
    });
    const snapshot = await ensureFiscalSnapshot("commerce_transaction", 1, db);
    expect(snapshot!.taxRateBasisPoints).toBeNull();
    expect(snapshot!.taxBaseCents).toBeNull();
  });

  it("#8 tipo de IVA configurado en TODAS las líneas → calcula base/cuota reales", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: false, sellerEntity: null, collectorEntity: null });
    const { db } = makeDb({
      commerceTx: [commerceTxFixture({ totalCents: 1000 })],
      commerceItems: [{ id: 1, transactionId: 1, venueProductId: 7, description: "Copa", quantity: 1, unitAmountCents: 1000, totalAmountCents: 1000 }],
      products: [{ id: 7, venueId: 10, taxRateId: 2100 }],
    });
    const snapshot = await ensureFiscalSnapshot("commerce_transaction", 1, db);
    expect(snapshot!.taxRateBasisPoints).toBe(2100);
    expect(snapshot!.taxBaseCents! + snapshot!.taxAmountCents!).toBe(1000);
  });

  it("#9 seller configurado se copia como SNAPSHOT textual (legalName/taxId), no solo el id", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: true, sellerEntity: { id: 3, legalName: "Casanova SL", taxId: "B12345678" }, collectorEntity: null });
    const { db } = makeDb({
      commerceTx: [commerceTxFixture()],
      commerceItems: [{ id: 1, transactionId: 1, venueProductId: null, description: "Copa", quantity: 1, unitAmountCents: 2000, totalAmountCents: 2000 }],
    });
    const snapshot = await ensureFiscalSnapshot("commerce_transaction", 1, db);
    expect(snapshot!.sellerEntityId).toBe(3);
    expect(snapshot!.sellerLegalName).toBe("Casanova SL");
    expect(snapshot!.sellerTaxId).toBe("B12345678");
  });

  it("#10 venta reembolsada (status='refunded') sigue siendo elegible para snapshot (hecho fiscal ya ocurrió)", async () => {
    mockResolveSellerForVenue.mockResolvedValue({ configured: false, sellerEntity: null, collectorEntity: null });
    const { db } = makeDb({
      commerceTx: [commerceTxFixture({ status: "refunded" })],
      commerceItems: [{ id: 1, transactionId: 1, venueProductId: null, description: "Copa", quantity: 1, unitAmountCents: 2000, totalAmountCents: 2000 }],
    });
    expect(await ensureFiscalSnapshot("commerce_transaction", 1, db)).not.toBeNull();
  });
});
