# Segolife — Arquitectura de Ticketing & Commerce Core + Integration Hub

Fase 5. Decisiones de diseño propias (no copiadas de ningún proveedor).

## Regla fundamental

**Fourvenues y Weezevent son CANALES. Segolife es el SISTEMA DE DOMINIO.**

Ninguna entidad central depende semánticamente de un proveedor externo. Todo
dato externo se normaliza primero en entidades internas de Segolife antes de
alimentar CRM, SegoTokens, Benefits, recurrencia o analítica. Las entidades
centrales se llaman `SegolifeEvent` (ya existe, Fase 1D), `TicketType`,
`TicketOrder`, `EventTicket`, `EventAttendance`, `CommerceTransaction` — nunca
`FourvenuesTicket` ni `WeezeventOrder`. Los IDs externos son *mappings*, no
identidad.

## Por qué NO se reutiliza `transactions` (legacy)

Auditado en detalle (ver `docs/integrations/` commit y `drizzle/schema.ts`,
comentario ya existente en el bloque `TOKEN_WALLETS`). `transactions` es el
libro mayor fiscal REAL de Náyade: régimen REAV, IVA por tramo, comisiones de
partner, vínculo a `bookings`/`quotes`/facturación. Reutilizarla mezclaría
dinero fiscal real de un negocio ajeno con operaciones de comercio de
Segolife. Se crea `commerce_transactions` como dominio nuevo, propio,
sin ninguna columna ni concepto fiscal heredado.

Tampoco se reutilizan `bookings`, `dailyOrders`, `reservations`
(reserva turística + pago Redsys), ni `discountCodes`/`couponRedemptions`
(cupón externo tipo Groupon/Smartbox) — dominios sin relación semántica.

## Qué SÍ se reutiliza

- `earnTokens()` (`server/segolife/tokens/tokenEngine.ts`) — el comentario de
  cabecera de este archivo YA anticipaba esta fase literalmente: *"QR,
  Benefits y Fourvenues (fases futuras) deberán llamar a earnTokens/
  spendTokens en vez de reimplementar esta secuencia"*. `TokenRule.origin`
  (enum) ya incluye `attendance`, `event`, `ticket`, `purchase`,
  `consumption`, `product` — no hace falta ninguna migración de enum para
  que Attendance/Commerce alimenten tokens.
- `evaluateBenefitsForOrigin()` (`server/segolife/benefits/benefitRuleEngine.ts`)
  — mismo caso: `BenefitOrigin.type` es un `varchar` libre
  (`BenefitRule.sourceType`), el comentario de cabecera menciona
  explícitamente `type: "event_attendance"` como caso futuro de Fourvenues.
- `venues`, `events`, `communityVenues`, `communityEvents` (Fase 1D) — Ticketing
  Core se ENGANCHA a estas tablas vía `event_id`/`venue_id`, nunca las
  extiende con columnas nuevas (evita riesgo sobre tablas ya en producción).
- `venueProducts` (Fase 2) — mapping opcional de línea de Commerce cuando el
  proveedor aporta detalle de producto.
- `users`, `student_profiles` — destino de la resolución de identidad.
- `permissionProcedure`/`anyPermissionProcedure` (RBAC progresivo),
  `getCommunityAccess` (scoping por comunidad), y el patrón idempotente de
  `rbacSeed.ts` — se replican tal cual para los permisos nuevos.
- El patrón de cifrado de `server/utils/emailCrypto.ts` (AES-256-GCM,
  clave derivada por scrypt) — se reutiliza el PATRÓN en un módulo nuevo
  (`server/segolife/integrations/integrationCredentialCrypto.ts`) con su
  propia variable de entorno (`INTEGRATION_ENCRYPTION_KEY`), en vez de
  acoplar semánticamente credenciales de integraciones a "email".

## Dominio central (Ticketing Core)

```
SegolifeEvent (events, ya existe)
  └─ SalesChannel (sales_channels)        -- N canales por evento
       channel_type: fourvenues | weezevent | segolife_native | manual | partner
       sales_mode:   external_redirect | external_checkout | native
       external_url, integration_id (nullable → venue_integrations/event_integrations)
  └─ TicketType (event_ticket_types)      -- N tarifas por evento
       └─ TicketOrder (ticket_orders) ──> TicketOrderItem (ticket_order_items)
            └─ EventTicket (event_tickets) -- 1 fila por entrada física/nominal
  └─ EventAttendance (event_attendance)   -- fuente de verdad de asistencia
```

**"hybrid" no es un valor almacenado.** Un evento es "hybrid" cuando tiene
más de un `sales_channel` con `status=active` — se DERIVA, no se persiste,
evitando que el dato pueda desincronizarse de la realidad (evento con 1 canal
pero marcado "hybrid" a mano).

**Inventory** (sección 7) no es una tabla de contadores mutable aparte —
mismo criterio que `token_ledger`/`user_activity_counters` en Fase 2
(evitar una segunda fuente de verdad que pueda desincronizarse). Se calcula
en caliente: `available = ticket_types.capacity - SUM(ticket_order_items.quantity
WHERE order.status IN ('paid','confirmed'))`. Documentado como estrategia
futura si el volumen lo exige: introducir `reserved_until` en
`ticket_order_items` para holds temporales con expiración, o una tabla
`event_ticket_inventory_locks` — NO implementado en esta fase (no hace falta
todavía, according to spec punto 7).

**El order Segolife existe incluso si viene de Fourvenues** (sección 8) — un
`ticket_order` con `provider='fourvenues'` y `external_order_id` poblado es
tan real como uno `provider='segolife_native'`. El resto del sistema
(CRM, analítica) nunca necesita saber de dónde vino.

## Integration Hub

Arquitectura provider-agnostic. Todo adapter implementa
`ExternalTicketingProvider` y declara sus `capabilities` explícitas — el
código NUNCA asume una capacidad, siempre la consulta
(`adapter.capabilities.individualAttendance === true`).

```
integration_providers        -- catálogo: fourvenues, weezevent, segolife_native
venue_integrations           -- Fourvenues: 1 fila por LOCAL (Casanova, Tía Felisa, Limoncello
                                 tendrán cada uno su propia fila cuando se den de alta —
                                 NO se siembran en esta fase, solo la infraestructura)
event_integrations           -- Weezevent: 1 fila por EVENTO puntual (Tankers, Mambo —
                                 tampoco se siembran)
external_entity_mappings     -- genérico: provider+integration+external_type+external_id
                                 ↔ internal_type+internal_id (evento, ticket, order...)
integration_sync_runs        -- auditoría de cada sync: fetched/created/updated/unresolved/failed/duration
integration_sync_state       -- cursor/updatedSince por integración (incremental sync)
```

Cada `venue_integration`/`event_integration` es independiente: credenciales,
entorno (sandbox/producción), estado, capacidades, ajustes de sync y último
error propios — Casanova puede tener credenciales inválidas mientras Tía
Felisa sincroniza con normalidad, sin acoplamiento.

## Resolución de identidad

Una operación externa (compra, asistencia, consumición) puede llegar sin que
Segolife sepa a qué estudiante corresponde. Política de resolución, en este
orden estricto (sección 32 — nunca fuzzy match por nombre):

1. `external_identity_mappings` ya confirmado para ese `provider` + identidad externa.
2. email del participante (`participantEmail`, si el proveedor lo distingue del comprador).
3. teléfono del participante.
4. email del comprador (`buyerEmail`) — SOLO si semánticamente es la misma persona (compra individual, no un profesor comprando 20 entradas).
5. `unresolved` — nunca se descarta la operación.

Una vez resuelta (automática con confianza suficiente, o manual vía
`/admin/integrations/unresolved`), se persiste en
`external_identity_mappings` para no volver a resolver.

## Pipeline único: Attendance → loyalty

```
event_attendance (idempotente por provider+integration+external_attendance_id)
  ↓
earnTokens({ origin: "attendance", userId, eventId, venueId, communityId, idempotencyKey })
  ↓
evaluateBenefitsForOrigin({ type: "event_attendance", userId, eventId, venueId, communityId, sourceId, occurredAt })
```

## Pipeline único: Commerce → loyalty

```
commerce_transactions (idempotente por provider+integration+external_transaction_id)
  ↓ (solo si user_id resuelto)
earnTokens({ origin: "consumption", userId, venueId, eventId, amountSpent, idempotencyKey })
  ↓
evaluateBenefitsForOrigin({ type: "consumption", userId, venueId, eventId, sourceId, occurredAt })
```

Ningún adapter (`FourvenuesAdapter`, `WeezeventAdapter`) llama a `earnTokens`
ni a `evaluateBenefitsForOrigin` directamente — solo producen
`EventAttendance`/`CommerceTransaction` normalizados. Un único servicio de
orquestación (`attendancePipeline.ts` / `commercePipeline.ts`) consume esas
filas y llama al motor. Así ningún adapter futuro puede "reinventar" loyalty.

## Kill switch

`EXTERNAL_INTEGRATIONS_ENABLED=true` (env, default `false`) **Y**
`venue_integrations.enabled=true` / `event_integrations.enabled=true` por fila
**Y** credenciales configuradas **Y** capability de sync habilitada. Los
cuatro deben cumplirse. En una BD nueva, sin ninguna fila de integración,
ningún worker arranca — mismo criterio que evitó el problema de jobs legacy
arrancando solos en Fase 4.

## Sales mode y CTA público

El frontend público NUNCA pregunta `if (provider === 'fourvenues')`. El
backend calcula `purchaseAction` a partir del `sales_channel` activo con
mayor prioridad del evento:

- `external_redirect` con `external_url` → `purchaseAction: { type: "external_url", url }`
- `native` (futuro, no activado) → `purchaseAction: { type: "native_checkout" }`
- sin canal activo → `purchaseAction: { type: "unavailable" }`

## Qué NO se hace en esta fase

Sin pagos reales, sin checkout Segolife, sin credenciales reales, sin
conexiones externas, sin TPV completo, sin scanner de check-in propio (el
scanner de Benefits es un dominio distinto y no se reutiliza), sin seed de
Casanova/Tía Felisa/Limoncello/Tankers/Mambo ni de tarifas reales.
