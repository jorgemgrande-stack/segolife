# SEGOLIFE — FIX-06: Admin Events Operational Controls & Date Range

Implementación real (no solo auditoría) de tres acciones administrativas
por fila (Editar/Ocultar-Mostrar/Eliminar) y un filtro de rango de fechas
(Desde/Hasta) en `/admin/events`.

## Arquitectura encontrada (auditoría previa a tocar nada)

`events` (`drizzle/schema.ts`) ya tenía DOS dimensiones de visibilidad
completamente separadas y correctamente distinguidas por el código
existente:

- `status` ("active"|"inactive") — toggle admin-curado, ya con su propio
  botón (`setEventActive`/`Switch` en `EventDetail.tsx`).
- `sourcePublicationStatus` ("published"|"unpublished"|"unknown"|NULL) —
  lo que dice el PROVEEDOR externo (Fourvenues) sobre su propia
  publicación, escrito únicamente por `eventCatalogSync.ts`, nunca por un
  admin.

**No existía ninguna tercera dimensión de visibilidad LOCAL** ("¿lo
enseña Segolife en discovery público, independientemente de lo anterior?")
— había que añadirla de cero, nunca reutilizar `status` (cambiaría también
su semántica de lifecycle) ni `sourcePublicationStatus` (falsearía lo que
dice el proveedor real).

**`deleteEvent` no existía en absoluto** — cero borrado físico de eventos
en todo el codebase antes de este cambio. Auditoría de FKs: `drizzle/schema.ts`
no tiene NINGÚN `.references(` real hacia `events.id` en ninguna de las ~20
tablas que guardan un `eventId` (`sales_channels`, `event_ticket_types`,
`ticket_orders`, `event_tickets`, `event_attendance`, `external_entity_mappings`
incluidos) — MySQL permitiría un DELETE físico dejando miles de filas
huérfanas sin ningún error. Esto define toda la política de borrado (ver
abajo).

`eventsDb.ts::isEventStudentVisible` ya era la única fuente de verdad de
"¿ve esto el Student?", reutilizada por Home/Explore/Venue Detail/Ended
Events. `getMyTicketById` (ticketing) nunca pasa por esa función — un
Student con ticket ya comprado accede a su entrada por propiedad
(`userId` + `ticketId`), nunca por discovery — confirmado antes de tocar
nada que ocultar un evento NUNCA rompería ese acceso.

## Política final — Editar

Se reutiliza el editor existente (`/admin/events/:id`, `EventDetail.tsx`) —
no se crea un segundo editor. Único cambio real: un aviso visible cuando el
evento es de Fourvenues, explicando que **Inicio** y **Fin** son
PROVIDER-MANAGED (el próximo sync los sobrescribe silenciosamente, ver
`eventCatalogSync.ts` — solo esos dos campos + `sourcePublicationStatus` se
re-sincronizan en cada tick) y que nombre/descripción/imagen/venue/
comunidades/destacado son SEGOLIFE-MANAGED (seguros de editar, el sync
nunca vuelve a tocarlos). No se construye ningún sistema de overrides —
explícitamente fuera de alcance de esta fase.

## Política final — Ocultar / Mostrar

Nueva columna `events.is_hidden` (boolean, default false). `setEventHidden()`
es un toggle puro, mismo patrón que `setEventFeatured()` — nunca toca
`status` ni `sourcePublicationStatus`, nunca dispara `event_updated`/
`event_cancelled`.

**VISIBILIDAD FINAL = `status==="active"` AND (no-Fourvenues O publicado-en-
origen-o-ya-pasado) AND `!isHidden`** — un cuarto AND añadido a
`isEventStudentVisible()`, nunca una alternativa. Mostrar un evento oculto
nunca "salta" el resto de las reglas: un borrador Fourvenues futuro sigue
sin ser visible aunque `isHidden=false`.

Excluido de: Home (`listActiveEvents`/`listFeaturedEvents`, vía
`studentSafe:true` — condición SQL `eq(events.isHidden, false)`, mismo
punto donde ya vivía el filtro de publicación de Fourvenues), Explore/Venue
Detail/Ended Events (`listEventsByVenue`/`listEndedEvents`, vía el propio
`isEventStudentVisible()` en JS). Nunca excluido de: el panel Admin
(`events.list` no aplica `studentSafe`), ni de `getMyTicketById` (ver
arriba — un Student con ticket ya comprado sigue viendo su entrada aunque
el evento se oculte después).

UI: badge "Oculto" en el listado y switch en la ficha — ambos **conviven**
con el badge/switch de `status`, nunca lo sustituyen (un evento puede ser
"Finalizado" y "Oculto" a la vez, dos hechos distintos).

## Política final — Eliminar

**Conservadora por diseño**, justificada por la ausencia total de FKs
reales (ver arriba). `deleteEvent(id)` bloquea el borrado — lanza
`EventDeleteBlockedError` con los motivos reales — si el evento tiene
CUALQUIERA de:

- origen Fourvenues (`sourceType`) — evita que el siguiente sync reintente
  actualizar una fila que ya no existe (mapping huérfano en
  `external_entity_mappings`, confirmado en la auditoría: sin FK, sin
  cascade, el sync haría un no-op silencioso para siempre sobre ese id).
- una integración externa vinculada (`external_entity_mappings`, por si
  existiera sin `sourceType` — Weezevent u otro proveedor futuro).
- canales de venta (`sales_channels`), tipos de entrada
  (`event_ticket_types`), pedidos (`ticket_orders`), entradas emitidas
  (`event_tickets`) o asistencia (`event_attendance`) reales.

Solo un evento **manual, sin ninguna actividad real** se borra físicamente
— la única categoría segura. El error de bloqueo se traduce en el router a
un `TRPCError({code:"CONFLICT"})` con el mensaje real (nunca genérico),
sugiriendo ocultar en su lugar. Confirmación explícita en el cliente
(modal con nombre/fecha/venue, botón destructivo distinguible, nunca borra
al primer click) — componente compartido (`DeleteEventDialog.tsx`) entre
el listado y la ficha.

## RBAC / Community scoping

`setHidden`/`delete` reutilizan exactamente `eventsManageProcedure`
(`permissionProcedure("events.manage", ["admin"])`, ya usado por
`update`/`setActive`/`setFeatured`/`setCommunities`) y el mismo patrón
`getCommunityAccess` + `assertEventAccessible` que el resto de mutaciones
del router — ningún permiso nuevo, ninguna comprobación nueva inventada.
Sin confiar en ocultar botones: la única defensa real es server-side (los
botones del cliente se renderizan siempre, igual que el resto de acciones
ya existentes en este mismo listado — p.ej. destacar).

## Rango de fechas — arquitectura

Nuevo helper `madridDateRangeToUtcBounds()` (`shared/segolife/eventTiming.ts`,
DST-safe, mismo criterio `Intl.DateTimeFormat` sin librería de zonas
horarias nueva que el resto del fichero) convierte dos strings
"YYYY-MM-DD" (día calendario Europe/Madrid) en límites UTC `[from, to)` —
`to` se traduce al inicio del día SIGUIENTE para usarse como límite
superior EXCLUSIVO, evitando el problema de milisegundos de comparar
contra "23:59:59.999". `EventListFilters.toDate` es nuevo en
`eventsDb.ts::listEvents` (`fromDate` ya existía a nivel de BD pero nunca
se exponía en el router — ahora ambos llegan hasta `events.list`).
Validación de rango invertido (`Desde > Hasta`) ANTES de tocar comunidad/BD
(fail-fast) — `BAD_REQUEST` con mensaje claro, nunca una consulta
incoherente. Se combina con todos los filtros existentes (venue/estado/
destacado/comunidad/canal de venta/filtro temporal cliente) sin
desplazarlos ni cambiar el ordering ya establecido.

## Tests nuevos

- `shared/segolife/eventTiming.test.ts` (+24) — `madridDayStartUtc`/
  `madridDateRangeToUtcBounds`, incluyendo los 4 días exactos de cambio de
  hora en España 2026 (29 marzo, 30 marzo, 25 octubre, 26 octubre).
- `server/db/eventsDb.test.ts` (+20) — `isEventStudentVisible` con
  `isHidden`, `setEventHidden`, `deleteEvent` (las 7 categorías de bloqueo
  una por una + el único caso permitido + idempotencia + mensaje legible),
  `listEvents` con `toDate`.
- `server/routers/events.test.ts` (+19) — sesión, NOT_FOUND, IDOR
  (community scoping) para `setHidden`/`delete`, traducción de
  `EventDeleteBlockedError` a CONFLICT, propagación de errores inesperados,
  validación de rango de fechas (invertido/formato inválido/límites
  correctos/combinación con otros filtros).
- `client/src/pages/admin/events/EventsManager.actions.test.tsx` (10,
  primer test de render de este directorio) — columna Acciones completa,
  badge Oculto conviviendo con el badge de estado, filtro de fechas
  (incluida la validación inline de rango inválido y "Limpiar fechas").
- `client/src/pages/admin/events/EventDetail.test.tsx` (7, primer test de
  este fichero) — switch Oculto, diálogo de borrado, aviso de campos
  PROVIDER-MANAGED.

Total: 80 tests nuevos, todos verdes. Regresión global: 3377 passed / 18
failed — mismos 4 ficheros y mismos nombres que el baseline de sesión,
cero regresión real. TypeScript: 118 baseline, 0 nuevos. Build: limpio.

## Migración

`drizzle/0159_events_is_hidden.sql` (`is_hidden` boolean NOT NULL DEFAULT
false) + `scripts/apply-0159-events-is-hidden.cjs` (idempotente, mismo
patrón que `apply-0157-event-source-publication-status.cjs`). Puramente
aditiva — ningún evento existente cambia de comportamiento (todos quedan
`is_hidden=false`, idéntico al estado actual sin la columna).
