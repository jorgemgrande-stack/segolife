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

import { recordNativeSale, PosError } from "./nativeCommerceService";

function productFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, venueId: 10, name: "Cóctel", price: "8.50", isActive: true, ...overrides };
}

function makeMockDb(products: Array<Record<string, unknown>>) {
  const b: any = {};
  b.select = () => b;
  b.from = () => b;
  b.where = () => Promise.resolve(products);
  return b as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIngestCommerceTransaction.mockResolvedValue({ status: "processed_with_loyalty", transaction: { id: 1 } });
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
