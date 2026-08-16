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

// SEGOLIFE — SEGOTOKENS PRESENCIALES (Pre-16.1): recordNativeSale ya no
// decide/captura tokens por su cuenta — solo liquida una autorización que
// el Student ya confirmó, vía tokenPaymentRequestService.settleTokenPaymentRequest.
const { mockReverseTokenSpend } = vi.hoisted(() => ({ mockReverseTokenSpend: vi.fn() }));
vi.mock("../tokens/tokenSpendService", () => ({ reverseTokenSpend: mockReverseTokenSpend }));

const { mockSettleTokenPaymentRequest, mockLinkSettledOrder, MockTokenPaymentRequestError } = vi.hoisted(() => {
  class MockTokenPaymentRequestError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.name = "TokenPaymentRequestError"; this.code = code; }
  }
  return { mockSettleTokenPaymentRequest: vi.fn(), mockLinkSettledOrder: vi.fn(), MockTokenPaymentRequestError };
});
vi.mock("../tokens/tokenPaymentRequestService", () => ({
  settleTokenPaymentRequest: mockSettleTokenPaymentRequest,
  linkSettledOrder: mockLinkSettledOrder,
  TokenPaymentRequestError: MockTokenPaymentRequestError,
}));

import { recordNativeSale, PosError, resolvePaymentMethod } from "./nativeCommerceService";

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
  mockLinkSettledOrder.mockResolvedValue(undefined);
});

// SEGOLIFE — SEGOTOKENS PRESENCIALES (Pre-16.1, spec §2): recordNativeSale
// solo LIQUIDA una autorización ya confirmada por el Student — nunca decide
// ni captura tokens de un Student meramente identificado por staff.
describe("nativeCommerceService — recordNativeSale con SegoTokens presenciales (Pre-16.1)", () => {
  it("confirmedTokenRequestId sin identifiedUserId: rechaza ANTES de tocar el motor de tokens", async () => {
    const db = makeMockDb([productFixture()]);
    await expect(recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 1 }], staffUserId: 9, idempotencyKey: "k7", confirmedTokenRequestId: 1 }, db))
      .rejects.toBeInstanceOf(PosError);
    expect(mockSettleTokenPaymentRequest).not.toHaveBeenCalled();
  });

  it("solicitud no liquidable (p.ej. aún no confirmada por el Student): rechaza, nunca llega a registrar la venta", async () => {
    mockSettleTokenPaymentRequest.mockRejectedValue(new MockTokenPaymentRequestError("INVALID_STATE", "El Student debe confirmar primero"));
    const db = makeMockDb([productFixture()]);
    await expect(recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 1 }], identifiedUserId: 42, staffUserId: 9, idempotencyKey: "k8", confirmedTokenRequestId: 1 }, db))
      .rejects.toBeInstanceOf(PosError);
    expect(mockIngestCommerceTransaction).not.toHaveBeenCalled();
  });

  it("liquidación exitosa: la venta se registra con el precio BRUTO sin cambios (nunca muta subtotalCents/totalCents, spec §10)", async () => {
    mockSettleTokenPaymentRequest.mockResolvedValue({ reservation: { id: 501, userId: 42, grossAmountCents: 1700, promotionalValueCents: 500 }, request: { id: 1 } });
    const db = makeMockDb([productFixture({ price: "8.50" })]);
    await recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 2 }], identifiedUserId: 42, staffUserId: 9, idempotencyKey: "k9", confirmedTokenRequestId: 1 }, db);

    expect(mockSettleTokenPaymentRequest).toHaveBeenCalledOnce();
    expect(mockSettleTokenPaymentRequest.mock.calls[0][0]).toBe(1);
    expect(mockSettleTokenPaymentRequest.mock.calls[0][1]).toBe("pos");
    expect(mockIngestCommerceTransaction).toHaveBeenCalledOnce();
    expect(mockIngestCommerceTransaction.mock.calls[0][0].transaction.totalCents).toBe(1700); // precio bruto real, sin descontar
    expect(mockLinkSettledOrder).toHaveBeenCalledWith(1, 1, expect.anything());
  });

  it("reservation.userId no coincide con el Student identificado en esta venta: rechaza (nunca confía en el userId enviado por el frontend)", async () => {
    mockSettleTokenPaymentRequest.mockResolvedValue({ reservation: { id: 503, userId: 999, grossAmountCents: 1700, promotionalValueCents: 500 }, request: { id: 1 } });
    const db = makeMockDb([productFixture({ price: "8.50" })]);
    await expect(recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 2 }], identifiedUserId: 42, staffUserId: 9, idempotencyKey: "k13", confirmedTokenRequestId: 1 }, db))
      .rejects.toMatchObject({ code: "REQUEST_STUDENT_MISMATCH" });
    expect(mockIngestCommerceTransaction).not.toHaveBeenCalled();
    // Ya se capturó dentro de settleTokenPaymentRequest — el mismatch se detecta DESPUÉS, así que debe revertirse.
    expect(mockReverseTokenSpend).toHaveBeenCalledOnce();
  });

  it("el carrito cambió entre la solicitud y la confirmación (total distinto al aprobado por el Student): rechaza y revierte", async () => {
    mockSettleTokenPaymentRequest.mockResolvedValue({ reservation: { id: 504, userId: 42, grossAmountCents: 999, promotionalValueCents: 500 }, request: { id: 1 } });
    const db = makeMockDb([productFixture({ price: "8.50" })]);
    await expect(recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 2 }], identifiedUserId: 42, staffUserId: 9, idempotencyKey: "k14", confirmedTokenRequestId: 1 }, db))
      .rejects.toMatchObject({ code: "CART_CHANGED_SINCE_REQUEST" });
    expect(mockReverseTokenSpend).toHaveBeenCalledOnce();
  });

  it("si ingestCommerceTransaction falla TRAS liquidar tokens reales, se revierte la captura (compensación — nunca tokens gastados sin ninguna venta asociada)", async () => {
    mockSettleTokenPaymentRequest.mockResolvedValue({ reservation: { id: 502, userId: 42, grossAmountCents: 850, promotionalValueCents: 500 }, request: { id: 1 } });
    mockIngestCommerceTransaction.mockRejectedValue(new Error("fallo de BD"));
    const db = makeMockDb([productFixture()]);

    await expect(recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 1 }], identifiedUserId: 42, staffUserId: 9, idempotencyKey: "k10", confirmedTokenRequestId: 1 }, db))
      .rejects.toThrow("fallo de BD");
    expect(mockReverseTokenSpend).toHaveBeenCalledOnce();
    expect(mockReverseTokenSpend.mock.calls[0][0]).toMatchObject({ reservationId: 502 });
  });

  it("sin confirmedTokenRequestId, nunca invoca el motor de SegoTokens — la venta en efectivo tradicional queda intacta", async () => {
    const db = makeMockDb([productFixture()]);
    await recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 1 }], identifiedUserId: 42, staffUserId: 9, idempotencyKey: "k11" }, db);
    expect(mockSettleTokenPaymentRequest).not.toHaveBeenCalled();
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

  it("moneyPaymentMethod='card' sin SegoTokens: paymentMethod final es 'card', nunca 'cash' (Fase 10.7)", async () => {
    const db = makeMockDb([productFixture()]);
    await recordNativeSale({ venueId: 10, items: [{ venueProductId: 1, quantity: 1 }], staffUserId: 9, idempotencyKey: "k12", moneyPaymentMethod: "card" }, db);
    expect(mockIngestCommerceTransaction.mock.calls[0][0].transaction.paymentMethod).toBe("card");
  });
});

// SEGOLIFE — VENUE BAR POS & LIVE COMMERCE TERMINAL (Fase 10.7, spec §10):
// distinción honesta cash/card/mixed_cash/mixed_card/segotokens — nunca
// cuenta tarjeta como efectivo (ver cashSessionService.test.ts para el lado
// del arqueo de caja).
describe("nativeCommerceService — resolvePaymentMethod (Fase 10.7 §10)", () => {
  it("sin reserva de ST, dinero en efectivo → 'cash'", () => {
    expect(resolvePaymentMethod(null, 2000, "cash")).toBe("cash");
  });
  it("sin reserva de ST, dinero con tarjeta → 'card'", () => {
    expect(resolvePaymentMethod(null, 2000, "card")).toBe("card");
  });
  it("con reserva de ST y moneyDueCents=0 (100% SegoTokens) → 'segotokens', sin importar moneyPaymentMethod", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolvePaymentMethod({ id: 1 } as any, 0, "card")).toBe("segotokens");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolvePaymentMethod({ id: 1 } as any, 0, "cash")).toBe("segotokens");
  });
  it("con reserva de ST y resto en efectivo → 'mixed_cash'", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolvePaymentMethod({ id: 1 } as any, 1400, "cash")).toBe("mixed_cash");
  });
  it("con reserva de ST y resto con tarjeta → 'mixed_card'", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolvePaymentMethod({ id: 1 } as any, 1400, "card")).toBe("mixed_card");
  });
});
