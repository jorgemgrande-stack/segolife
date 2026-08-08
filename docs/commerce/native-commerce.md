# Native Commerce/POS — Fase 8

POS mínimo nativo (`/staff/pos`) construido sobre el Commerce Core de Fase 5 (`venue_products`, `commerce_transactions`, `commercePipeline.ingestCommerceTransaction`) — sin tabla nueva, `provider="segolife"` distingue una venta nativa de una externa.

## Alcance deliberadamente mínimo

Solo `paymentMethod:"cash"` — el staff presencia el pago físicamente, ningún gateway se invoca. Esto NO es "fingir un pago digital": es la única forma de dar utilidad real al POS sin violar la restricción explícita de la fase de nunca simular un cobro que no ocurrió. Cobro con tarjeta/digital queda fuera de alcance hasta que exista un `PaymentProvider` real (ver `docs/ticketing/payment-provider.md`).

## Flujo

```
staff abre /staff/pos → selecciona venue autorizado → añade venue_products al carrito
  → (opcional) identifica estudiante vía QR de identidad → confirma venta en efectivo
  → recordNativeSale() → commercePipeline.ingestCommerceTransaction() → commerce_transactions + (si identificado) loyalty
```

## Precio siempre recalculado en servidor

`nativeCommerceService.recordNativeSale()` **nunca** confía en un importe enviado desde el cliente — recalcula `totalCents` desde `venue_products.price` en servidor para cada línea del carrito, y rechaza productos inactivos o que no pertenecen al `venueId` indicado (`PosError`). Mismo principio que Fase 5 ya aplicaba a Fourvenues/Weezevent: el precio de venta nunca es de confianza si viene de fuera del propio dominio.

## Identificación de estudiante — QR de identidad

Nueva tabla `student_identity_tokens` (migración 0133) — un QR de **identidad**, no de autorización. Perfil de riesgo deliberadamente distinto del QR de Benefit (Fase 4):

| | QR Benefit | QR Ticket | QR Identidad (nuevo) |
|---|---|---|---|
| Qué autoriza | Canjear un beneficio real | Entrar a un evento | Nada por sí solo |
| Si se filtra | Alguien canjea tu beneficio | Alguien entra en tu lugar | Alguien ve tu nombre en el POS |
| Radio de impacto | Alto | Alto | Bajo |

El staff lo escanea únicamente para **adjuntar** la venta al estudiante correcto (`identifiedUserId` → `resolvedUserId` en el pipeline, habilitando loyalty real) — nunca autoriza un cargo ni un descuento por sí mismo. Rotable por el propio estudiante en cualquier momento (`rotateMyIdentityToken`) sin ningún efecto sobre historiales ya registrados (las ventas ya guardan el `userId` resuelto, no el token).

## Loyalty opcional, venta siempre válida

Si no se identifica estudiante, `resolvedUserId` es `null` — la venta se registra igualmente (POS es una necesidad operativa del venue, no un requisito de loyalty), solo no genera SegoTokens/Benefits personales. Esto reutiliza el fast-path `resolvedUserId` opcional añadido en Fase 8 a `commercePipeline.ingestCommerceTransaction()` — cuando está presente, se salta `resolveIdentity()`/`persistIdentityMapping()` (el estudiante ya es conocido, sin heurística de email/teléfono), 100% compatible con las llamadas existentes de proveedores externos que no lo pasan.

## Idempotencia y RBAC

`recordNativeSale` exige `idempotencyKey` (reintento de red no duplica venta) — reutiliza el mismo mecanismo de idempotencia de `commerce_transactions` ya existente de Fase 5. Acceso de staff vía `venueStaffAccess.getVenueStaffAccess()` (Fase 4) parametrizado con `permissionKey="commerce.manage"` como bypass global; staff de venue normal requiere el nuevo permiso `commerce.record`, mirroring exacto de `benefits.redeem`/`benefits.manage`. Rate limit dedicado `posRecordSaleRateLimit` (mismo mecanismo `express-rate-limit` ya usado por `benefitRedeemRateLimit`).

## Fuera de alcance explícito de esta fase

Caja/cierres, arqueo, fiscalidad/factura simplificada, cobro con tarjeta/digital real, catálogo de producto propio del POS (reutiliza `venue_products` de Fase 5 tal cual), informes de venta.
