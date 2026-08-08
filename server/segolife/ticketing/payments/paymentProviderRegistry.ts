/**
 * paymentProviderRegistry.ts — único lugar que decide QUÉ PaymentProvider
 * usar (Fase 8, spec punto 6). checkoutService.ts nunca importa un provider
 * concreto directamente. MockPaymentProvider SOLO puede activarse fuera de
 * producción y con la variable explícita `PAYMENT_PROVIDER=mock` — nunca
 * por accidente en un despliegue real (spec: "nunca simular un pago
 * exitoso en producción").
 */
import type { PaymentProvider } from "./paymentProvider";
import { unconfiguredPaymentProvider } from "./unconfiguredPaymentProvider";
import { createMockPaymentProvider } from "./mockPaymentProvider";

let mockInstance: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  const isProduction = process.env.NODE_ENV === "production";
  const requestedMock = process.env.PAYMENT_PROVIDER === "mock";

  if (!isProduction && requestedMock) {
    if (!mockInstance) mockInstance = createMockPaymentProvider();
    return mockInstance;
  }

  // Futuro: aquí se añadiría `if (process.env.PAYMENT_PROVIDER === "stripe" && ...) return createStripeProvider(...)`
  // cuando exista una decisión comercial real y credenciales propias de Segolife.
  return unconfiguredPaymentProvider;
}
