/**
 * mockPaymentProvider.ts — SOLO test/dev (Fase 8, spec punto 6). Nunca se
 * registra en producción — ver paymentProviderRegistry.ts, que solo lo
 * expone si `NODE_ENV !== "production"` Y `PAYMENT_PROVIDER=mock`
 * explícito. Simula un pago que siempre tiene éxito, para poder probar el
 * checkout/emisión de tickets/reembolsos de extremo a extremo sin depender
 * de credenciales reales.
 */
import crypto from "crypto";
import type { PaymentProvider, CreatePaymentInput, PaymentResult, RefundPaymentInput } from "./paymentProvider";

export function createMockPaymentProvider(): PaymentProvider {
  return {
    providerKey: "mock",
    capabilities: { configured: true, supportsRefunds: true, supportsPartialRefunds: true, supportsWebhooks: false },

    async createPayment(input: CreatePaymentInput): Promise<PaymentResult> {
      return { status: "succeeded", externalPaymentId: `mock_${crypto.randomBytes(8).toString("hex")}_${input.orderId}` };
    },

    async getPaymentStatus(externalPaymentId: string): Promise<PaymentResult> {
      return { status: "succeeded", externalPaymentId };
    },

    async refundPayment(input: RefundPaymentInput): Promise<PaymentResult> {
      return { status: "refunded", externalPaymentId: input.externalPaymentId };
    },

    async verifyWebhook(rawBody: string): Promise<Record<string, unknown> | null> {
      try {
        return JSON.parse(rawBody);
      } catch {
        return null;
      }
    },
  };
}
