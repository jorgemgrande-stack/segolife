# SEGOLIFE — Payment Provider Activation Checklist

Verificado contra código real el 2026-08-18. Este documento existe para que,
cuando se elija un proveedor de pago real, se pueda conectar sin volver a
auditar toda la plataforma — toda la arquitectura ya está lista y en su
sitio, solo falta una implementación concreta.

## 0. Lo más importante primero

**`server/redsys.ts` NO es el camino.** Ese fichero es la integración de
Redsys heredada de Náyade, acoplada a su flujo de reservas/hotel/spa/
restaurantes — no lo usa ninguna parte de SEGOLIFE (tickets, TPV, eventos).
No tocar `server/redsys.ts` ni `server/redsysRoutes.ts` como parte de esta
activación.

**SEGOLIFE ya tiene su propia abstracción de pago, lista y a la espera:**
`server/segolife/ticketing/payments/paymentProvider.ts` — interfaz
`PaymentProvider` con `createPayment`, `getPaymentStatus`, `refundPayment`,
`verifyWebhook`, `capabilities`. Hoy solo existen dos implementaciones:
`unconfiguredPaymentProvider` (falla siempre, nunca finge un éxito — es lo
que corre en producción hoy) y `mockPaymentProvider` (solo test/desarrollo,
nunca en producción incluso si se fuerza la variable).

**Dato clave para el negocio:** con el proveedor sin configurar, hoy mismo
un Student YA puede completar una compra de entrada real de principio a fin
si la paga al 100% con SegoTokens — el código nunca llama al proveedor de
pago cuando el importe en dinero real a cobrar es 0€
(`checkoutService.ts::initiatePayment()`, variable `isFree`). Solo el tramo
en dinero real de una compra (parcial o total) queda bloqueado sin
proveedor.

## 1. Antes de nada: decisión comercial

Elegir el proveedor real (Stripe / Redsys propio de SEGOLIFE / Adyen /
otro) y obtener credenciales propias de SEGOLIFE — nunca reutilizar las
credenciales de Redsys de Náyade. Esto es una decisión de negocio, no
técnica; no se toma en este documento.

## 2. Pasos técnicos de activación (una vez elegido el proveedor)

1. **Implementar un nuevo `PaymentProvider`** en
   `server/segolife/ticketing/payments/` (p. ej. `stripePaymentProvider.ts`)
   que cumpla la interfaz existente: `createPayment`, `getPaymentStatus`,
   `refundPayment`, `verifyWebhook`, `capabilities`.
2. **Conectarlo en el registro** —
   `paymentProviderRegistry.ts::getPaymentProvider()` ya tiene el punto de
   extensión comentado (línea 24: `// Futuro: aquí se añadiría if
   (process.env.PAYMENT_PROVIDER === "stripe" ...`). Añadir esa rama,
   devolviendo el proveedor real solo si sus credenciales están realmente
   presentes — nunca a medio configurar (fail-closed a
   `unconfiguredPaymentProvider` en cualquier otro caso).
3. **Variables de entorno del proveedor elegido** — a definir según el SDK
   (p. ej. `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, o unas
   `REDSYS_MERCHANT_*` propias de SEGOLIFE y distintas de las de Náyade).
   Ninguna existe todavía porque no hay implementación real escrita.
4. **Activar la variable `PAYMENT_PROVIDER`** (p. ej. `PAYMENT_PROVIDER=
   stripe`) en producción, solo después de confirmar que las credenciales
   funcionan en un entorno inferior.
5. **Registrar la URL de webhook en el panel del proveedor:**
   `POST https://www.segolife.es/api/ticket-payments/webhook` — la ruta ya
   existe, ya está montada y ya tiene rate limit (30 req/min,
   `server/ticketPaymentWebhookRoutes.ts`, `server/_core/index.ts:314/355`).
   No hace falta cambiar la ruta, solo apuntar el proveedor ahí e
   implementar la verificación de firma real dentro del nuevo
   `verifyWebhook()`.
6. **Confirmar el formato del payload verificado**: `{ orderId: number,
   externalPaymentId: string }` (zod en `ticketPaymentWebhookRoutes.ts:32-
   35`) — mapear el payload/metadata real del proveedor a esa forma dentro
   de `verifyWebhook()` (p. ej. guardar `orderId` en los metadatos de
   Stripe al crear el pago y leerlo de vuelta en el webhook).
7. **Redirección de checkout alojado (si el proveedor lo requiere)** —
   `TicketCheckout.tsx` hoy ignora `PaymentResult.redirectUrl`; haría falta
   implementar la salida y el retorno a `/:community/checkout/:orderId` (no
   existen páginas dedicadas de éxito/error/cancelación para tickets
   nativos, a diferencia del par heredado `/reserva/ok`/`/reserva/error`).
8. **Tests del nuevo proveedor** — replicar el patrón de
   `paymentProviders.test.ts` (garantía de "nunca finge un éxito") más,
   si el proveedor lo permite, una prueba real contra sus credenciales de
   sandbox antes de activar `PAYMENT_PROVIDER` en producción.

## 3. Lo que YA está construido y no hace falta tocar

- **Reembolso**: `ticketCancellationService.ts::refundOrder()` — completo,
  independiente del proveedor elegido, ya reversa SegoTokens y registra el
  reembolso en el feed unificado `commerce_refunds`. Si el proveedor falla
  al reembolsar, el pedido pasa a `reconciliation_required` — nunca se
  marca como reembolsado o pagado falsamente.
- **Pago mixto (parte SegoTokens + parte dinero)**: completo en
  `checkoutService.ts::initiatePayment()` — el proveedor de pago, cuando
  hace falta, solo se llama por el importe restante tras aplicar
  SegoTokens, nunca por el total bruto.
- **Pago 100% SegoTokens**: completo, sin tocar nunca el proveedor de pago
  (ver sección 0).
- **Conciliación**: usa el mismo estado genérico `reconciliation_required`
  que ya usa el resto de la plataforma (p. ej. discrepancias de
  Fourvenues) — mismo camino de resolución manual por un Administrador, sin
  lógica separada por proveedor de tarjeta que construir.
- **Tests de la capa de checkout/cancelación/holds** — ya cubren el 100%
  ST, el pago mixto, el doble pago idempotente y la compensación cuando el
  hold expira a mitad de pago (`checkoutService.test.ts`,
  `ticketCancellationService.test.ts`, `inventoryHoldService.test.ts`).

## 4. Fuera de alcance de esta activación

`server/redsys.ts` y `server/redsysRoutes.ts` (Náyade: reservas, hotel,
SPA, restaurantes) — sistema real, funcional, separado, sin relación con
SEGOLIFE. No se toca como parte de conectar un proveedor de pago para
entradas nativas de SEGOLIFE.
