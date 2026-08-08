/**
 * paymentProvider.ts — abstracción propia de SEGOLIFE (Fase 8, spec punto
 * 6). El Ticketing Core NUNCA conoce Stripe/Redsys/Adyen/lo que sea —
 * siempre habla contra esta interfaz. NO se reutiliza server/redsys.ts (es
 * de Náyade, acoplado a su flujo fiscal de reservas — ver auditoría en
 * docs/ticketing/payment-provider.md).
 */
export interface CreatePaymentInput {
  orderId: number;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";

export interface PaymentResult {
  status: PaymentStatus;
  externalPaymentId?: string | null;
  /** URL a la que redirigir para completar el pago (checkout hospedado) — null si el provider no lo necesita o no está configurado. */
  redirectUrl?: string | null;
  error?: string | null;
}

export interface RefundPaymentInput {
  externalPaymentId: string;
  amountCents: number;
  reason?: string;
}

export interface PaymentProviderCapabilities {
  configured: boolean;
  supportsRefunds: boolean;
  supportsPartialRefunds: boolean;
  supportsWebhooks: boolean;
}

/**
 * Contrato único. `createPayment` inicia el intento; `getPaymentStatus`
 * consulta el estado real (poll, si el provider no ofrece webhook fiable);
 * `refundPayment` deshace total/parcialmente un pago ya confirmado;
 * `verifyWebhook` valida la firma/autenticidad de una notificación entrante
 * ANTES de confiar en su payload (nunca procesar un webhook sin verificar).
 */
export interface PaymentProvider {
  readonly providerKey: string;
  readonly capabilities: PaymentProviderCapabilities;

  createPayment(input: CreatePaymentInput): Promise<PaymentResult>;
  getPaymentStatus(externalPaymentId: string): Promise<PaymentResult>;
  refundPayment(input: RefundPaymentInput): Promise<PaymentResult>;
  /** Devuelve el payload verificado, o null si la firma no es válida — nunca lanza para no filtrar detalles de la validación en el error. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<Record<string, unknown> | null>;
}
