# PaymentProvider — abstracción de pago (Fase 8)

Nueva abstracción, **nunca** reutiliza `server/redsys.ts` (integración Redsys real de Náyade — pertenece a otro proyecto y usa credenciales/comercio propios de Náyade). SEGOLIFE no tiene pasarela real contratada; esta abstracción existe para que el dominio de ticketing sea correcto y completo HOY, sin fingir un cobro que no puede procesar de verdad.

## Contrato

`server/segolife/ticketing/payments/paymentProvider.ts`:

```ts
interface PaymentProvider {
  readonly providerKey: string;
  createPayment(input: CreatePaymentInput): Promise<PaymentResult>;
  refundPayment(input: RefundPaymentInput): Promise<PaymentResult>;
  readonly capabilities: PaymentProviderCapabilities;
}

type PaymentResult =
  | { status: "succeeded"; externalPaymentId: string }
  | { status: "failed"; error: string }
  | { status: "pending"; externalPaymentId: string }; // reservado para pasarelas con redirect/3DS futuras
```

Ningún llamador (`checkoutService.ts`) conoce el proveedor concreto — siempre pasa por `getPaymentProvider()` del registry.

## Implementaciones

### `UnconfiguredPaymentProvider` — default de producción

`providerKey: "unconfigured"`. `createPayment()` **siempre** devuelve `{status:"failed", error:"..."}`. `refundPayment()` igual. No tiene ninguna rama que pueda devolver `succeeded` — es la garantía arquitectónica de que producción **nunca puede fingir un pago exitoso**, ni por error de configuración ni por un flag mal puesto. Verificado por test: se llama expresamente con distintos `NODE_ENV`/variables de entorno y siempre falla.

### `MockPaymentProvider` — solo test/dev

`providerKey: "mock"`. Siempre devuelve `succeeded` con un `externalPaymentId` sintético (`mock_<random>`). Existe únicamente para poder probar el flujo de checkout completo (hold → pago → emisión de ticket → check-in) sin una pasarela real.

### Registry — activación fail-closed

`paymentProviderRegistry.ts` → `getPaymentProvider()`:

```ts
if (process.env.NODE_ENV !== "production" && process.env.PAYMENT_PROVIDER === "mock") {
  return createMockPaymentProvider();
}
return unconfiguredPaymentProvider; // default absoluto, incluida producción con la variable puesta
```

Doble condición explícita — ni `NODE_ENV!=="production"` solo, ni la variable de entorno sola, activan el mock. **En producción, `PAYMENT_PROVIDER=mock` puesto por error NO activa nada** — sigue devolviendo `UnconfiguredPaymentProvider`. Verificado por test dedicado (`paymentProviderRegistry.test.ts`).

## Efecto en el order al fallar el pago

`checkoutService.initiatePayment()`: si `createPayment()` devuelve `failed`, el order transiciona `awaiting_payment → pending` (nunca queda atascado en `awaiting_payment`, el usuario puede reintentar), no se emiten tickets, no se emite ningún evento de Engagement. La respuesta al cliente indica el fallo real — nunca un éxito simulado.

## Persistencia del intento de pago

`ticket_payments` (migración 0133) registra cada intento — `orderId`, `providerKey`, `status`, `externalPaymentId`, `idempotencyKey` UNIQUE. Un segundo `initiatePayment()` sobre un order que YA tiene un `ticket_payments` en `succeeded` es un no-op idempotente: no vuelve a llamar al provider, simplemente devuelve el resultado ya persistido (probado en `checkoutService.test.ts`).

## Arquitectura externa — regla obligatoria

**Fourvenues/Weezevent son canales — SEGOLIFE es el dominio.** Nunca `evento de Fourvenues/Weezevent → lógica de negocio` directamente. Siempre:

```
payload del proveedor → adapter (fourvenuesAdapter.ts / weezeventAdapter.ts) → tipo Normalized* → attendancePipeline / commercePipeline → entidades canónicas Segolife (ticket_orders, event_tickets, event_attendance, commerce_transactions)
```

El checkout/PaymentProvider/scanner nativos de esta fase son exactamente OTRO canal (`provider="segolife"`) que entra por la MISMA puerta canónica — nunca una ruta especial. Esto es lo que permite que Fourvenues/Weezevent activarse en el futuro (con credenciales reales) no requiera tocar el dominio: ya está completo y es correcto sin ellos.

## Estrategia de fallback

Si un canal externo (Fourvenues/Weezevent) falla o no está disponible, el canal nativo puede activarse de forma independiente por evento simplemente creando un `sales_channels` con `salesMode="native"` — no requiere ningún cambio de código, solo configuración de datos, porque el dominio (order state machine, inventario, tickets, check-in, asistencia) ya es agnóstico del canal de origen.

## Explícitamente NO construido esta fase

Pasarela de pago real (Redsys/Stripe/cualquier adquirente), activación de credenciales reales de Fourvenues, activación de credenciales reales de Weezevent, WhatsApp real, push real, email real, GHL, Vapi, SMS, fiscalidad/factura, caja/arqueo, seat maps, dynamic pricing, promo codes, subscriptions.
