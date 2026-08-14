/**
 * ticketPaymentWebhookRoutes.ts — endpoint REST para la confirmación de pago
 * de un `ticket_order` nativo (SEGOLIFE — Native Ticket Sales, spec §10).
 * Espejo minimalista de `redsysRoutes.ts` (mismo patrón de Express Router
 * standalone, montado en `_core/index.ts`) pero agnóstico de proveedor —
 * nunca importa Redsys/Stripe/lo-que-sea directamente, solo habla contra
 * `PaymentProvider.verifyWebhook()` (ver `payments/paymentProvider.ts`).
 *
 * NUNCA se confía en el body sin verificar (spec §10/§37): el body crudo se
 * pasa tal cual a `provider.verifyWebhook(rawBody, signatureHeader)` —
 * `confirmPaymentByWebhook()` solo se llama si esa verificación devuelve un
 * payload no-nulo. Con `unconfiguredPaymentProvider` (el que corre hoy en
 * producción, ver spec §6/§53) `verifyWebhook` siempre devuelve `null`, así
 * que este endpoint responde 400 a CUALQUIER llamada real — correcto: sin
 * proveedor real no hay ninguna firma que pueda ser válida, nunca se finge
 * una confirmación de pago.
 *
 * CONTRATO DEL PAYLOAD VERIFICADO (a definir en firme por la implementación
 * concreta de `verifyWebhook()` de cada proveedor real, cuando exista):
 * debe incluir `orderId` (number, el `ticket_orders.id` interno — nunca se
 * confía en un id que el proveedor externo pueda enviar como referencia
 * propia si no coincide) y `externalPaymentId` (string). Validado aquí con
 * zod antes de tocar nada.
 */
import express from "express";
import { z } from "zod";
import { getPaymentProvider } from "./segolife/ticketing/payments/paymentProviderRegistry";
import { confirmPaymentByWebhook, CheckoutError } from "./segolife/ticketing/checkoutService";

const ticketPaymentWebhookRouter = express.Router();

const verifiedPayloadSchema = z.object({
  orderId: z.number().int().positive(),
  externalPaymentId: z.string().min(1),
});

ticketPaymentWebhookRouter.get("/api/ticket-payments/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), service: "ticket-payment-webhook" });
});

ticketPaymentWebhookRouter.post(
  "/api/ticket-payments/webhook",
  express.text({ type: "*/*" }),
  async (req, res) => {
    const rawBody = typeof req.body === "string" ? req.body : "";
    const signatureHeader = (req.headers["x-payment-signature"] as string | undefined) ?? null;

    let verified: Record<string, unknown> | null;
    try {
      verified = await getPaymentProvider().verifyWebhook(rawBody, signatureHeader);
    } catch (err) {
      console.error("[ticket-payment-webhook] verifyWebhook lanzó (nunca debería):", err);
      res.status(400).json({ ok: false, error: "verification_failed" });
      return;
    }

    if (!verified) {
      res.status(400).json({ ok: false, error: "invalid_signature_or_no_provider_configured" });
      return;
    }

    const parsed = verifiedPayloadSchema.safeParse(verified);
    if (!parsed.success) {
      console.error("[ticket-payment-webhook] payload verificado con forma inesperada:", parsed.error.flatten());
      res.status(400).json({ ok: false, error: "unexpected_payload_shape" });
      return;
    }

    try {
      const result = await confirmPaymentByWebhook(parsed.data.orderId, parsed.data.externalPaymentId);
      res.status(200).json({ ok: true, orderId: result.order.id, status: result.order.status });
    } catch (err) {
      if (err instanceof CheckoutError) {
        res.status(409).json({ ok: false, error: err.code });
        return;
      }
      console.error("[ticket-payment-webhook] confirmPaymentByWebhook falló:", err);
      res.status(500).json({ ok: false, error: "internal_error" });
    }
  }
);

export default ticketPaymentWebhookRouter;
