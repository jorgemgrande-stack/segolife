# Native Ticketing — Fase 8

Camino nativo completo de venta de entradas de SEGOLIFE, construido **sobre** el Ticketing Core de Fase 5 (`sales_channels`, `event_ticket_types`, `ticket_orders`, `ticket_order_items`, `event_tickets`, `event_attendance`) — nunca un dominio paralelo. Fourvenues/Weezevent siguen siendo canales; el dominio siempre es SEGOLIFE (ver `docs/ticketing/architecture-external-channels.md`, sección al final de este documento).

## Dominio y flujo

```
event → ticket type → hold (order pending) → PaymentProvider → paid → event_tickets (QR) → check-in → event_attendance → attendancePipeline (tokens/benefits)
```

Ninguna tabla nueva para el flujo principal — `provider="segolife"`/`"segolife_native"` en las columnas ya existentes distingue nativo de externo, exactamente como Fase 5 ya preveía en sus comentarios de schema.

## purchaseAction (contrato público)

`server/segolife/ticketing/purchaseAction.ts` — el frontend nunca pregunta `if provider === "fourvenues"`. Recibe:

```ts
type PurchaseAction =
  | { type: "external_url"; url: string }
  | { type: "native_checkout"; eventId: number; ticketTypes: PurchaseActionTicketType[] }
  | { type: "unavailable" };
```

`native_checkout` solo se devuelve si el canal primario activo es `salesMode="native"` **y** existe al menos un tipo de entrada activo dentro de su ventana de venta — nunca un checkout vacío.

## Inventario y HOLD (sin overselling)

Se mantiene la decisión de Fase 5: `inventory = capacity − comprometido`, **siempre calculado en caliente**, nunca un contador mutable. "Comprometido" ahora incluye `status='paid'` **y** holds vigentes (`status IN ('pending','awaiting_payment')` con `expires_at > NOW()`).

Concurrencia real: `inventoryHoldService.createHold()` abre una transacción y toma `SELECT ... FOR UPDATE` sobre las filas de `event_ticket_types` implicadas (mismo patrón que `tokenLedgerService.ts` con `token_wallets`) — dos holds concurrentes para el MISMO tipo de entrada quedan serializados por MySQL; tipos distintos no se bloquean entre sí. Los `ticketTypeId` se bloquean siempre en orden ascendente para evitar deadlocks entre holds multi-item.

Un hold "expira" simplemente dejando de contar como comprometido tras `expires_at` (15 min, `HOLD_DURATION_MINUTES`) — ningún job/cron necesario para la corrección del inventario. `expireStaleHoldsForUser()` solo actualiza el `status` visible a `expired` de forma perezosa (al listar pedidos), por higiene.

## Order state machine

`server/segolife/ticketing/orderStateMachine.ts` — transiciones explícitas, nunca arbitrarias:

```
(creación)         → pending
pending             → awaiting_payment | expired | cancelled
awaiting_payment    → paid | expired | failed | cancelled
paid                → refunded | partially_refunded | reconciliation_required
partially_refunded  → refunded | reconciliation_required
reconciliation_required → refunded | cancelled
```

`paid` **nunca** transiciona directamente a `cancelled` — la única salida es un reembolso. Aplicado con `UPDATE ... WHERE status IN (from)` + `affectedRows`, mismo patrón que `benefitRedemptionService.ts`.

## Idempotencia

| Paso | Mecanismo |
|---|---|
| Hold / order | UNIQUE `ticket_orders.idempotency_key` (proporcionado por el cliente, sobrevive reintentos de red) |
| Intento de pago | UNIQUE `ticket_payments.idempotency_key` = `ticket_payment:<orderId>:attempt` |
| Emisión de ticket | Reutiliza UNIQUE `(provider, external_ticket_id)` de Fase 5 — `external_ticket_id = "native:<orderId>:<itemId>:<n>"`, sin tabla/columna nueva |
| Check-in | UPDATE condicional `WHERE status='issued'` + `affectedRows` (nunca dos `event_attendance` para el mismo ticket) |
| Asistencia | Reutiliza `event_attendance.idempotency_key` ya existente de Fase 5 |

## QR seguro (auditoría de seguridad antes de decidir)

Comparado Fase 3 (Consumption QR, hash-only, un solo intento) vs Fase 4 (Benefit QR, plaintext+hash, redisplay repetido). Un ticket nativo debe poder volver a mostrarse hasta el evento — mismo perfil que Benefits, no que Consumption. `event_tickets.qr_token`/`qr_token_hash` (columnas ya reservadas por Fase 5) se rellenan con: `crypto.randomBytes(32).base64url()` + SHA-256 hash. El canje SIEMPRE resuelve por hash, nunca compara el texto plano (evita timing attacks). Riesgo aceptado idéntico al ya documentado para `user_benefits` en `drizzle/schema.ts`.

## Check-in nativo

`server/segolife/ticketing/nativeCheckinService.ts` + `/staff/events/scan` — dominio explícitamente distinto de StudentScan (Fase 3) y StaffBenefitScan (Fase 4). Solo valida `provider="segolife_native"` — nunca finge check-in de Fourvenues (no soporta `individualAttendance`) ni de Weezevent (aunque sí lo soporta vía su propia API, ese flujo sigue siendo responsabilidad del Integration Hub, no de este scanner).

Atómico: `UPDATE event_tickets SET status='used' WHERE id=? AND status='issued'`, comprobando `affectedRows`. El scanner **nunca** llama a `earnTokens()`/`evaluateBenefitsForOrigin()` directamente — solo a `ingestAttendance()` (Fase 5), extendido con un parámetro opcional `resolvedUserId` que salta `resolveIdentity()` por completo (el comprador YA es un usuario Segolife conocido, `event_tickets.userId`, sin heurística de email/teléfono).

Alcance de staff: `venueStaffAccess.getVenueStaffAccess()` (Fase 4) parametrizado con un `permissionKey` — Ticketing usa `"attendance.manage"` como bypass global, Benefits sigue usando `"benefits.manage"` sin ningún cambio en sus llamadas existentes.

## Bloqueador de Fase 5 resuelto

Vincular manualmente una asistencia no resuelta (`unresolved_operations`, `operationType="attendance"`) ahora SÍ reprocesa `event_attendance` retroactivamente — `server/routers/integrations.ts`, procedimiento `linkUnresolved`, reconstruye el `IngestAttendanceInput` desde la propia fila de `unresolved_operations` (ya guardaba `eventId`/`venueId`/`occurredAt`/`externalReferenceId`) y llama a `ingestAttendance()` con `resolvedUserId` = el userId que el admin decidió. Idempotente por el mismo `idempotency_key` — vincular dos veces (o que el evento ya se procesara por otra vía) no duplica. Esto deja **Weezevent realmente preparado para activación futura** sin trabajo adicional, aunque siga OFF hoy.

## Cancelaciones y reembolsos

Nunca `DELETE`. `cancelOrder()` solo desde `pending`/`awaiting_payment` (antes de pagar, sin consecuencias). `refundOrder()` desde `paid`:

- Si **ningún** ticket del order se ha usado (check-in): reembolso real vía `PaymentProvider.refundPayment()`, tickets no usados pasan a `refunded`.
- Si **algún** ticket ya se usó: el estudiante ya disfrutó del evento y puede tener SegoTokens/Benefits concedidos por esa asistencia. Ni `reverseTransaction` (Fase 2) ni la política de Benefits definen hoy qué hacer en ese caso — **nunca se improvisa**: el order queda en `reconciliation_required` para resolución manual admin.

## Relación con Fourvenues/Weezevent

Fourvenues/Weezevent son **canales**, nunca el dominio. Un payload de proveedor externo pasa siempre por su adapter (`fourvenuesAdapter.ts`/`weezeventAdapter.ts`) → tipos `Normalized*` → `attendancePipeline`/`commercePipeline` → entidades canónicas Segolife. El checkout/scanner nativos son un canal MÁS (`provider="segolife"`), no una excepción a esa regla. Si un proveedor externo deja de funcionar, activar venta/check-in nativo no requiere reconstruir nada del dominio — ya está aquí, solo hace falta un `sales_channels` con `salesMode="native"` y (cuando exista) un `PaymentProvider` real.

## Fuera de alcance explícito de esta fase

Fiscalidad, factura, caja/cierres, IVA/REAV, adquirente/pasarela de pago real, activación de Fourvenues/Weezevent, WhatsApp/push/email reales, seat maps, reserved seating, dynamic pricing, promo codes, subscriptions.
