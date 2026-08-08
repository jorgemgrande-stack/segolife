/**
 * unconfiguredPaymentProvider.ts — provider por defecto en producción
 * mientras SEGOLIFE no tenga una pasarela real conectada (Fase 8, spec
 * punto 6). NUNCA simula un pago exitoso — `createPayment` siempre
 * devuelve `status: "failed"` con un motivo honesto. Esto es lo que
 * garantiza el criterio de cierre "sin proveedor real, producción
 * permanece incapaz de fingir un pago" (spec punto 45.5).
 */
import type { PaymentProvider, CreatePaymentInput, PaymentResult, RefundPaymentInput } from "./paymentProvider";

export const unconfiguredPaymentProvider: PaymentProvider = {
  providerKey: "unconfigured",
  capabilities: { configured: false, supportsRefunds: false, supportsPartialRefunds: false, supportsWebhooks: false },

  async createPayment(_input: CreatePaymentInput): Promise<PaymentResult> {
    return { status: "failed", error: "No hay ningún PaymentProvider real configurado todavía — el checkout nativo no puede completar un pago." };
  },

  async getPaymentStatus(_externalPaymentId: string): Promise<PaymentResult> {
    return { status: "failed", error: "PaymentProvider no configurado." };
  },

  async refundPayment(_input: RefundPaymentInput): Promise<PaymentResult> {
    return { status: "failed", error: "PaymentProvider no configurado — no se puede procesar un reembolso real." };
  },

  async verifyWebhook(): Promise<Record<string, unknown> | null> {
    return null; // sin proveedor real no hay ninguna firma que pueda ser válida
  },
};
