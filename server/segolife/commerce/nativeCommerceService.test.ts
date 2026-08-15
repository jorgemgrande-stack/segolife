/**
 * nativeCommerceService.test.ts — POS nativo mínimo (Fase 8, spec puntos
 * 19-24, 35). ingestCommerceTransaction ya está probado en
 * commercePipeline.test.ts (Fase 5) — aquí se prueba SOLO la lógica propia
 * y nueva: el precio SIEMPRE se recalcula desde venue_products (nunca del
 * frontend), y la validación de producto/venue/cantidad.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIngestCommerceTransaction } = vi.hoisted(() => ({ mockIngestCommerceTransaction: vi.fn() }));
vi.mock("./commercePipeline", () => ({ ingestCommerceTransaction: mockIngestCommerceTransaction }));

// SEGOLIFE — SEGOTOKENS UNIVERSAL SPEND (Fase 7).
const { mockReserveAndCaptureTokenSpend, mockReverseTokenSpend } = vi.hoisted(() => ({
  mockReserveAndCaptureTokenSpend: vi.fn(),
  mockReverseTokenSpend: vi.fn(),
}));
vi.mock("../tokens/tokenSpendService", () => ({
  reserveAndCaptureTokenSpend: mockReserveAndCaptureTokenSpend,
  reverseTokenSpend: mockReverseTokenSpend,
}));

import { recordNativeSale, PosError } from "./nativeCommerceService";

function productFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, venueId: 10, name: "Cóctel", price: "8.50", isActive: true, ...overrides };
}

function makeMockDb(products: Array<Record<string, unknown>>) {
  let mode: "select" | "update" = "select";
  const b: any = {};
  b.select = () => { mode = "select"; return b; };
  b.update = () => { mode = "update"; return b; };
  b.from = () => b;
  b.set = () => b;
  b.where = () => b;
  b.limit = () => b;
  b.for = () => b;
  // Chainable Y thenable — así tanto `await ...where(...)` (código legacy de
  // este archivo) como `await ...where(...).limit(1).for("update")` (nuevo,
  // stockService.ts) funcionan sobre el mismo builder.
  b.then = (resolve: (v: unknown) => void) => resolve(mode === "select" ? products : [{ affectedRows: 1 }]);
  // SEGOLIFE — FASE 10: recordNativeSale ahora llama a reserveAndDecrementForSale
  // (stockService.ts), que abre su propia conn.transaction() — ninguno de los
  // productFixture() de este archivo marca stockTracked=true, así que la
  // decisión real (continue/skip) ocurre antes de tocar nada más; solo hace
  // falta que `.transaction()` exista y reutilice el mismo builder como tx.
  b.transaction = (cb: (tx: unknown) => Promise<unknown>) => cb(b);
  return b as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIngestCommerceTransaction.mockResolvedValue({ status: "processed_with_loyalty", transaction: { id: 1 } });
  mockReverseTokenSpend.mockResolvedValue(undefined);
});

// SEGOLIFE — SEGOTOKENS UNIVERSAL SPEND (Fase 7, spec §22/§23/§27).
describe("nativeCommerceService — recordNativeSale con SegoTokens (spec §22/§23)", () => {
  it("tokensToApply sin identifiedUserId: rechaza ANTES de tocar el motor de tokens", async () => {
    const db = makeMockDb([productFixture()]);
    await expect(recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 1 }], staffUserId: 9, idempotencyKey: "k7", tokensToApply: 100 }, db))
      .rejects.toBeInstanceOf(PosError);
    expect(mockReserveAndCaptureTokenSpend).not.toHaveBeenCalled();
  });

  it("sin política activa (no_policy): rechaza, nunca llega a registrar la venta", async () => {
    mockReserveAndCaptureTokenSpend.mockResolvedValue({ status: "no_policy" });
    const db = makeMockDb([productFixture()]);
    await expect(recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 1 }], identifiedUserId: 42, staffUserId: 9, idempotencyKey: "k8", tokensToApply: 100 }, db))
      .rejects.toBeInstanceOf(PosError);
    expect(mockIngestCommerceTransaction).not.toHaveBeenCalled();
  });

  it("captura exitosa: la venta se registra con el precio BRUTO sin cambios (nunca muta subtotalCents/totalCents, spec §10)", async () => {
    mockReserveAndCaptureTokenSpend.mockResolvedValue({ reservation: { id: 501 }, alreadyCaptured: false });
    const db = makeMockDb([productFixture({ price: "8.50" })]);
    await recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 2 }], identifiedUserId: 42, staffUserId: 9, idempotencyKey: "k9", tokensToApply: 100 }, db);

    expect(mockReserveAndCaptureTokenSpend).toHaveBeenCalledOnce();
    expect(mockReserveAndCaptureTokenSpend.mock.calls[0][0]).toMatchObject({ userId: 42, grossAmountCents: 1700, requestedTokens: 100, referenceType: "commerce_transaction" });
    expect(mockIngestCommerceTransaction).toHaveBeenCalledOnce();
    expect(mockIngestCommerceTransaction.mock.calls[0][0].transaction.totalCents).toBe(1700); // precio bruto real, sin descontar
  });

  it("si ingestCommerceTransaction falla TRAS capturar tokens reales, se revierte la captura (compensación — nunca tokens gastados sin ninguna venta asociada)", async () => {
    mockReserveAndCaptureTokenSpend.mockResolvedValue({ reservation: { id: 502 }, alreadyCaptured: false });
    mockIngestCommerceTransaction.mockRejectedValue(new Error("fallo de BD"));
    const db = makeMockDb([productFixture()]);

    await expect(recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 1 }], identifiedUserId: 42, staffUserId: 9, idempotencyKey: "k10", tokensToApply: 100 }, db))
      .rejects.toThrow("fallo de BD");
    expect(mockReverseTokenSpend).toHaveBeenCalledOnce();
    expect(mockReverseTokenSpend.mock.calls[0][0]).toMatchObject({ reservationId: 502 });
  });

  it("sin tokensToApply, nunca invoca el motor de SegoTokens — la venta en efectivo tradicional queda intacta", async () => {
    const db = makeMockDb([productFixture()]);
    await recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 1 }], identifiedUserId: 42, staffUserId: 9, idempotencyKey: "k11" }, db);
    expect(mockReserveAndCaptureTokenSpend).not.toHaveBeenCalled();
  });
});

describe("nativeCommerceService — recordNativeSale", () => {
  it("recalcula el importe SIEMPRE desde venue_products.price — nunca confía en un importe del frontend", async () => {
    const db = makeMockDb([productFixture({ price: "8.50" })]);
    await recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 2 }], staffUserId: 9, idempotencyKey: "k1" }, db);

    expect(mockIngestCommerceTransaction).toHaveBeenCalledOnce();
    const call = mockIngestCommerceTransaction.mock.calls[0][0];
    expect(call.transaction.totalCents).toBe(1700); // 8.50€ × 2 = 17.00€ = 1700 céntimos
    expect(call.transaction.paymentMethod).toBe("cash"); // nunca un método digital sin PaymentProvider real
    expect(call.provider).toBe("segolife");
  });

  it("rechaza un producto que no pertenece a este venue", async () => {
    const db = makeMockDb([productFixture({ venueId: 99 })]);
    await expect(recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 1 }], staffUserId: 9, idempotencyKey: "k2" }, db))
      .rejects.toBeInstanceOf(PosError);
  });

  it("rechaza un producto inactivo", async () => {
    const db = makeMockDb([productFixture({ isActive: false })]);
    await expect(recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 1 }], staffUserId: 9, idempotencyKey: "k3" }, db))
      .rejects.toBeInstanceOf(PosError);
  });

  it("estudiante identificado → resolvedUserId se pasa a ingestCommerceTransaction (loyalty real)", async () => {
    const db = makeMockDb([productFixture()]);
    await recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 1 }], identifiedUserId: 77, staffUserId: 9, idempotencyKey: "k4" }, db);
    expect(mockIngestCommerceTransaction.mock.calls[0][0].resolvedUserId).toBe(77);
  });

  it("sin estudiante identificado → resolvedUserId null, la venta sigue siendo válida (sin loyalty personal)", async () => {
    const db = makeMockDb([productFixture()]);
    await recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 1 }], staffUserId: 9, idempotencyKey: "k5" }, db);
    expect(mockIngestCommerceTransaction.mock.calls[0][0].resolvedUserId).toBeNull();
  });

  it("rechaza un carrito vacío", async () => {
    const db = makeMockDb([]);
    await expect(recordNativeSale({ venueId: 10, items: [], staffUserId: 9, idempotencyKey: "k6" }, db)).rejects.toBeInstanceOf(PosError);
  });
});
