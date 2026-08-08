/**
 * paymentProviders.test.ts — UnconfiguredPaymentProvider nunca finge un
 * pago exitoso (spec Fase 8 punto 6/45.5); MockPaymentProvider (solo test/
 * dev) sí lo hace, para poder probar el resto del pipeline de extremo a
 * extremo; el registry nunca activa el mock en producción.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unconfiguredPaymentProvider } from "./unconfiguredPaymentProvider";
import { createMockPaymentProvider } from "./mockPaymentProvider";
import { getPaymentProvider } from "./paymentProviderRegistry";

describe("unconfiguredPaymentProvider", () => {
  it("createPayment SIEMPRE devuelve failed — nunca simula un pago exitoso", async () => {
    const result = await unconfiguredPaymentProvider.createPayment({ orderId: 1, amountCents: 1000, currency: "EUR", idempotencyKey: "k" });
    expect(result.status).toBe("failed");
  });
  it("capabilities.configured es false", () => {
    expect(unconfiguredPaymentProvider.capabilities.configured).toBe(false);
  });
  it("refundPayment nunca devuelve refunded", async () => {
    const result = await unconfiguredPaymentProvider.refundPayment({ externalPaymentId: "x", amountCents: 100 });
    expect(result.status).toBe("failed");
  });
});

describe("mockPaymentProvider — SOLO test/dev", () => {
  it("createPayment siempre tiene éxito (para poder probar checkout de extremo a extremo)", async () => {
    const provider = createMockPaymentProvider();
    const result = await provider.createPayment({ orderId: 1, amountCents: 1000, currency: "EUR", idempotencyKey: "k" });
    expect(result.status).toBe("succeeded");
    expect(result.externalPaymentId).toBeTruthy();
  });
});

describe("paymentProviderRegistry — nunca activa el mock en producción", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalProvider = process.env.PAYMENT_PROVIDER;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.PAYMENT_PROVIDER = originalProvider;
  });

  it("en producción, incluso con PAYMENT_PROVIDER=mock, devuelve unconfiguredPaymentProvider", () => {
    process.env.NODE_ENV = "production";
    process.env.PAYMENT_PROVIDER = "mock";
    expect(getPaymentProvider().providerKey).toBe("unconfigured");
  });

  it("fuera de producción, sin PAYMENT_PROVIDER=mock explícito, sigue devolviendo unconfigured", () => {
    process.env.NODE_ENV = "test";
    delete process.env.PAYMENT_PROVIDER;
    expect(getPaymentProvider().providerKey).toBe("unconfigured");
  });

  it("fuera de producción CON PAYMENT_PROVIDER=mock explícito, activa el mock", () => {
    process.env.NODE_ENV = "test";
    process.env.PAYMENT_PROVIDER = "mock";
    expect(getPaymentProvider().providerKey).toBe("mock");
  });
});
