# Event operations (Fase 8.6)

> Contexto: `docs/SEGOLIFE_DOMAIN_MODEL.md`, `docs/ticketing/native-ticketing.md`, `docs/ticketing/payment-provider.md`, `docs/integrations/ticketing-commerce-architecture.md`. Este documento cubre lo añadido/reorganizado en Fase 8.6 sobre el núcleo operativo de eventos.

## Modelo

Tabla `events` (preexistente desde Fase 1D). Un evento pertenece opcionalmente a un `venueId`, y a N comunidades vía `community_events`. Estados reales: `active`/`inactive` (`events.status`) — no existen `draft`/`published`/`finished` como valores de enum; el estado "pasado" es **temporal**, no un estado de fila (ver más abajo).

## Lógica temporal centralizada

Antes de esta fase, cada componente repetía su propia comparación `new Date() < event.startsAt`, con riesgo real de divergencia entre pantallas. Fase 8.6 introduce `shared/segolife/eventTiming.ts` como única fuente de verdad:

- `getEventTemporalStatus(event, now)` → `"upcoming" | "ongoing" | "past"`.
- Un evento **sin** `endsAt` se considera `ongoing` durante `DEFAULT_EVENT_DURATION_HOURS = 6` horas desde `startsAt` — evita marcar como "pasado" una fiesta que acaba de empezar (caso normal en nightlife, donde no siempre se fija hora de cierre).
- `isEventTonight(event, now)` compara la fecha de calendario en **Europe/Madrid** (vía `Intl.DateTimeFormat`), no en UTC — un evento que empieza a las 00:30 UTC puede seguir siendo "esta noche" en hora de Madrid.
- `splitUpcomingPast(events)` — próximos ascendente (el más cercano primero), pasados descendente (el más reciente primero).

Usado por: `computePurchaseAction` (servidor), `VenueDetail`/`EventDetail` públicos, `EventsManager`/admin `VenueDetail` (cliente). Test dedicado: `shared/segolife/eventTiming.test.ts` (incluye casos explícitos de zona horaria).

## Bug real corregido: compra en eventos pasados

`computePurchaseAction(eventId, eventTiming, db?)` — antes de Fase 8.6 no recibía el timing del evento y, si un tipo de entrada no tenía ventana de venta explícita, un evento **ya pasado** podía seguir devolviendo un `native_checkout` operativo. Ahora corta con `{ type: "unavailable" }` **antes** de consultar `sales_channels`/tipos de entrada — verificado con test que comprueba que `listTicketTypes` ni siquiera se llama (`server/segolife/ticketing/purchaseAction.test.ts`).

## Público vs privado

`events.publicGetBySlug({ slug })` devuelve `{ event, venue, communities, purchaseAction }` — el frontend **nunca** conoce el proveedor real (Fourvenues/Weezevent/nativo): solo recibe `purchaseAction.type` (`"external_url" | "native_checkout" | "unavailable"`). Un evento `status='inactive'` nunca se expone, aunque el slug exista. Cubierto por `server/routers/eventsPublic.test.ts`.

`events.publicByVenue({ venueId })` — grafo Venue→Event, usado por la ficha pública del venue para sus secciones "Próximos"/"Pasados".

## Ticketing, Attendance, SegoTokens, Benefits — reutilización total

- **Ticketing**: `event_ticket_types`/`sales_channels`/`ticket_orders`/`ticket_order_items`/`event_tickets` (Fase 5) — sin tablas paralelas. `PaymentProvider` sigue **sin configurar** en esta fase; el Native Checkout se comporta de forma segura (nunca simula un cobro real, no se activa ningún `MockPaymentProvider`). Ver `docs/ticketing/payment-provider.md`.
- **Attendance**: `event_attendance` — el procedimiento `eventTicketing.listEventAttendance` ya existía sin consumidor de UI; Fase 8.6 lo conecta a una pestaña nueva en el admin de evento (`EventAttendanceTab`). Nunca se fabrican check-ins.
- **Integrations**: `integrations.listEventIntegrations` (preexistente sin UI) conectado a `EventIntegrationsTab` — muestra el estado real de Weezevent para ese evento (`not_configured` si no hay fila en `event_integrations`, nunca simulado).
- **SegoTokens/Benefits**: motor de `attendancePipeline`/reglas de tokens y beneficios, sin tablas paralelas (`event_points` no existe).

## Admin — Eventos como núcleo operativo

`/admin/events` (`EventsManager.tsx`) — chips de filtro temporal (Todos/Próximos/Esta noche/Pasados, usando `eventTiming.ts`), búsqueda, filtro por venue/comunidad/estado/destacado, columna de flyer.

`/admin/events/new` (`EventCreate.tsx`, nueva página — sustituye el modal de 4 campos) — secciones **Datos básicos** / **Fecha y venue** (con preselección real de `venueId` desde `?venueId=X`, usado por el botón "Nuevo evento en este venue" de la ficha de Venue) / **Flyer** / **Visibilidad**. Mínimo real exigido: nombre, slug, inicio — nunca exige completar ticketing para crear un borrador.

`/admin/events/:id` (`EventDetail.tsx`) — pestañas: **General** / **Media** (nueva) / **Comunidades** / **Ticketing** / **Attendance** (nueva) / **Integrations** (nueva).

## Fixtures QA (solo local)

8 eventos con prefijo `QA ` (nunca en producción, nunca vía `db:seed`): un par Upcoming/Past en Casanova (referencia dorada) y un evento cada uno en Tanker Events/Selfish Poke (tests de generalidad de dominio) más el resto de venues, para poblar Explore/PublicHome con datos mínimos realistas.
