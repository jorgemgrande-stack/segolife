/**
 * fiscalDocumentService.test.ts — SEGOLIFE FASE 10 (spec §13-25/§108).
 * Numeración concurrency-safe (§14 CRITICAL), inmutabilidad de facturas
 * emitidas (§17), abonos que nunca superan el original (§19/§22).
 */
import { describe, it, expect, vi } from "vitest";
import { drizzleConditionMockFactory, MockTable, createMockDb } from "../_testHelpers/drizzleTableMock";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, ...drizzleConditionMockFactory() };
});

const { mockEnsureFiscalSnapshot } = vi.hoisted(() => ({ mockEnsureFiscalSnapshot: vi.fn() }));
vi.mock("./fiscalSnapshotService", () => ({ ensureFiscalSnapshot: mockEnsureFiscalSnapshot }));

import { invoiceSeries, fiscalDocumentCounters, fiscalDocuments, fiscalDocumentLines, billingProfiles } from "../../../drizzle/schema";
import { issueInvoice, issueCreditNote } from "./fiscalDocumentService";

function snapshotFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, sourceType: "commerce_transaction", sourceId: 1, venueId: 10, sellerEntityId: 3,
    sellerLegalName: "Casanova SL", sellerTaxId: "B1", buyerUserId: 42, occurredAt: new Date("2026-08-01T20:00:00Z"),
    currency: "EUR", grossAmountCents: 1000, promotionalValueCents: 0, moneyDueCents: 1000,
    taxRateBasisPoints: 2100, taxBaseCents: 826, taxAmountCents: 174,
    itemsSnapshot: [{ description: "Copa", quantity: 1, unitAmountCents: 1000, totalAmountCents: 1000 }],
    paymentMethod: "cash", ...overrides,
  };
}
function seriesFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, sellerEntityId: 3, documentType: "invoice", code: "SEG", active: true, ...overrides };
}

function makeDb(config: { series?: Array<Record<string, unknown>>; counters?: Array<Record<string, unknown>>; documents?: Array<Record<string, unknown>>; profiles?: Array<Record<string, unknown>> } = {}) {
  const tables = new Map<unknown, MockTable<Record<string, unknown>>>([
    [invoiceSeries, new MockTable(invoiceSeries as unknown as Record<string, unknown>, config.series ?? [seriesFixture()])],
    [fiscalDocumentCounters, new MockTable(fiscalDocumentCounters as unknown as Record<string, unknown>, config.counters ?? [])],
    [fiscalDocuments, new MockTable(fiscalDocuments as unknown as Record<string, unknown>, config.documents ?? [])],
    [fiscalDocumentLines, new MockTable(fiscalDocumentLines as unknown as Record<string, unknown>, [])],
    [billingProfiles, new MockTable(billingProfiles as unknown as Record<string, unknown>, config.profiles ?? [])],
  ]);
  const db = createMockDb(tables);
  return { db, documentsTable: tables.get(fiscalDocuments)!, countersTable: tables.get(fiscalDocumentCounters)!, linesTable: tables.get(fiscalDocumentLines)! };
}

describe("issueInvoice — elegibilidad (spec §71/§72, nunca factura una venta externa)", () => {
  it("#1 rechaza cuando la venta no es nativa/finalizada (ensureFiscalSnapshot devuelve null)", async () => {
    mockEnsureFiscalSnapshot.mockResolvedValue(null);
    const { db } = makeDb();
    await expect(issueInvoice({ sourceType: "commerce_transaction", sourceId: 1, seriesId: 1, issuedByUserId: 9 }, db))
      .rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("#2 rechaza cuando el venue no tiene vendedor configurado (nunca fabrica uno)", async () => {
    mockEnsureFiscalSnapshot.mockResolvedValue(snapshotFixture({ sellerEntityId: null }));
    const { db } = makeDb();
    await expect(issueInvoice({ sourceType: "commerce_transaction", sourceId: 1, seriesId: 1, issuedByUserId: 9 }, db))
      .rejects.toMatchObject({ code: "SELLER_NOT_CONFIGURED" });
  });

  it("#3 rechaza cuando el IVA no está configurado en todas las líneas (nunca adivina un tipo)", async () => {
    mockEnsureFiscalSnapshot.mockResolvedValue(snapshotFixture({ taxRateBasisPoints: null, taxBaseCents: null, taxAmountCents: null }));
    const { db } = makeDb();
    await expect(issueInvoice({ sourceType: "commerce_transaction", sourceId: 1, seriesId: 1, issuedByUserId: 9 }, db))
      .rejects.toMatchObject({ code: "TAX_NOT_CONFIGURED" });
  });

  it("#4 rechaza una serie de otra entidad vendedora", async () => {
    mockEnsureFiscalSnapshot.mockResolvedValue(snapshotFixture({ sellerEntityId: 3 }));
    const { db } = makeDb({ series: [seriesFixture({ sellerEntityId: 99 })] });
    await expect(issueInvoice({ sourceType: "commerce_transaction", sourceId: 1, seriesId: 1, issuedByUserId: 9 }, db))
      .rejects.toMatchObject({ code: "SERIES_MISMATCH" });
  });
});

describe("issueInvoice — numeración (spec §14 CRITICAL, §16, §17)", () => {
  it("#5 primera factura de una serie/año obtiene el número 0001", async () => {
    mockEnsureFiscalSnapshot.mockResolvedValue(snapshotFixture());
    const { db } = makeDb();
    const doc = await issueInvoice({ sourceType: "commerce_transaction", sourceId: 1, seriesId: 1, issuedByUserId: 9 }, db);
    expect(doc.documentNumber).toBe("SEG-2026-0001");
  });

  it("#6 facturas sucesivas de la MISMA serie/año son estrictamente correlativas, nunca se repiten", async () => {
    const { db } = makeDb();
    mockEnsureFiscalSnapshot.mockResolvedValueOnce(snapshotFixture({ id: 1, sourceId: 1 }));
    const a = await issueInvoice({ sourceType: "commerce_transaction", sourceId: 1, seriesId: 1, issuedByUserId: 9 }, db);
    mockEnsureFiscalSnapshot.mockResolvedValueOnce(snapshotFixture({ id: 2, sourceId: 2 }));
    const b = await issueInvoice({ sourceType: "commerce_transaction", sourceId: 2, seriesId: 1, issuedByUserId: 9 }, db);
    expect(a.documentNumber).toBe("SEG-2026-0001");
    expect(b.documentNumber).toBe("SEG-2026-0002");
  });

  it("#7 emitir dos veces sobre el MISMO snapshot es idempotente — nunca duplica número (spec §22)", async () => {
    mockEnsureFiscalSnapshot.mockResolvedValue(snapshotFixture({ id: 1, sourceId: 1 }));
    const { db, documentsTable } = makeDb();
    const a = await issueInvoice({ sourceType: "commerce_transaction", sourceId: 1, seriesId: 1, issuedByUserId: 9 }, db);
    const b = await issueInvoice({ sourceType: "commerce_transaction", sourceId: 1, seriesId: 1, issuedByUserId: 9 }, db);
    expect(a.id).toBe(b.id);
    expect(a.documentNumber).toBe(b.documentNumber);
    expect(documentsTable.rows).toHaveLength(1);
  });

  it("#8 nunca asigna número a un borrador — solo existe fila tras emisión real (spec §16)", async () => {
    mockEnsureFiscalSnapshot.mockResolvedValue(null);
    const { db, documentsTable } = makeDb();
    await expect(issueInvoice({ sourceType: "commerce_transaction", sourceId: 1, seriesId: 1, issuedByUserId: 9 }, db)).rejects.toThrow();
    expect(documentsTable.rows).toHaveLength(0);
  });

  it("#9 el total de la factura es exactamente el bruto del snapshot — base+cuota cuadran", async () => {
    mockEnsureFiscalSnapshot.mockResolvedValue(snapshotFixture({ grossAmountCents: 1000, taxBaseCents: 826, taxAmountCents: 174 }));
    const { db } = makeDb();
    const doc = await issueInvoice({ sourceType: "commerce_transaction", sourceId: 1, seriesId: 1, issuedByUserId: 9 }, db);
    expect(doc.totalCents).toBe(1000);
    expect(doc.taxBaseCents + doc.taxAmountCents).toBe(1000);
  });
});

describe("issueCreditNote — rectificación (spec §18/§19/§22)", () => {
  async function issueOriginal(db: ReturnType<typeof makeDb>["db"]) {
    mockEnsureFiscalSnapshot.mockResolvedValueOnce(snapshotFixture());
    return issueInvoice({ sourceType: "commerce_transaction", sourceId: 1, seriesId: 1, issuedByUserId: 9 }, db);
  }

  it("#10 abono total contra una factura existente, número de la serie de abonos", async () => {
    const { db } = makeDb({ series: [seriesFixture(), seriesFixture({ id: 2, documentType: "credit_note", code: "SEGA" })] });
    const original = await issueOriginal(db);
    const credit = await issueCreditNote({ originalDocumentId: original.id, amountCents: 1000, reason: "cliente insatisfecho", issuedByUserId: 9 }, db);
    expect(credit.documentNumber).toBe("SEGA-2026-0001");
    expect(credit.totalCents).toBe(1000);
    expect(credit.originalDocumentId).toBe(original.id);
  });

  it("#11 abono parcial calcula proporcionalmente base/cuota con el tipo EFECTIVO del original", async () => {
    const { db } = makeDb({ series: [seriesFixture(), seriesFixture({ id: 2, documentType: "credit_note", code: "SEGA" })] });
    const original = await issueOriginal(db); // gross 1000, base 826, cuota 174 -> tipo efectivo ~21%
    const credit = await issueCreditNote({ originalDocumentId: original.id, amountCents: 500, reason: "medio pedido", issuedByUserId: 9 }, db);
    expect(credit.totalCents).toBe(500);
    expect(credit.taxBaseCents + credit.taxAmountCents).toBe(500);
  });

  it("#12 rechaza un abono que superaría el total original acumulado (spec §22, nunca doble reembolso fiscal)", async () => {
    const { db } = makeDb({ series: [seriesFixture(), seriesFixture({ id: 2, documentType: "credit_note", code: "SEGA" })] });
    const original = await issueOriginal(db);
    await issueCreditNote({ originalDocumentId: original.id, amountCents: 700, reason: "primero", issuedByUserId: 9 }, db);
    await expect(issueCreditNote({ originalDocumentId: original.id, amountCents: 400, reason: "segundo, se pasa", issuedByUserId: 9 }, db))
      .rejects.toMatchObject({ code: "OVER_REFUND" });
  });

  it("#13 el documento ORIGINAL nunca se modifica al emitir un abono (inmutabilidad, spec §17)", async () => {
    const { db, documentsTable } = makeDb({ series: [seriesFixture(), seriesFixture({ id: 2, documentType: "credit_note", code: "SEGA" })] });
    const original = await issueOriginal(db);
    const originalSnapshotBefore = { ...documentsTable.rows.find(d => d.id === original.id) };
    await issueCreditNote({ originalDocumentId: original.id, amountCents: 300, reason: "parcial", issuedByUserId: 9 }, db);
    const originalAfter = documentsTable.rows.find(d => d.id === original.id);
    expect(originalAfter).toEqual(originalSnapshotBefore);
  });

  it("#14 rechaza rectificar un abono (solo se rectifican facturas)", async () => {
    const { db } = makeDb({ series: [seriesFixture(), seriesFixture({ id: 2, documentType: "credit_note", code: "SEGA" })] });
    const original = await issueOriginal(db);
    const credit = await issueCreditNote({ originalDocumentId: original.id, amountCents: 200, reason: "x", issuedByUserId: 9 }, db);
    await expect(issueCreditNote({ originalDocumentId: credit.id, amountCents: 100, reason: "y", issuedByUserId: 9 }, db))
      .rejects.toMatchObject({ code: "INVALID_ORIGINAL" });
  });

  it("#15 exige motivo", async () => {
    const { db, documentsTable } = makeDb();
    documentsTable.insert({ documentType: "invoice", sellerEntityId: 3, totalCents: 1000, taxBaseCents: 826, taxAmountCents: 174, documentNumber: "SEG-2026-0001" } as Record<string, unknown>);
    await expect(issueCreditNote({ originalDocumentId: 1, amountCents: 100, reason: "", issuedByUserId: 9 }, db))
      .rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });
});
