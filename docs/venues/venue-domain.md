# Venue domain (Fase 8.6)

> Contexto: `docs/SEGOLIFE_DOMAIN_MODEL.md` (modelo general), `docs/SEGOLIFE_MULTICOMMUNITY_ARCHITECTURE.md` (regla de comunidades). Este documento cubre específicamente lo añadido/reorganizado en la Fase 8.6 — Venues Experience + Event Operations Core.

## Qué es un Venue

Un Venue es una entidad editorial+operativa de primer nivel: un local real de Segovia (discoteca, restaurante, espacio de eventos) que puede tener eventos, comercio, SegoTokens, beneficios e integraciones externas propias. **No existe distinción arquitectónica entre "venue" y "organizador"** — Tanker Events (un espacio de eventos) usa exactamente el mismo modelo, tabla, router y componentes que Casanova (una discoteca) o Selfish Poke (un restaurante). No hay tabla `event_organizers`, no hay campo `organizerId`, no hay ninguna rama de código `if (venue.type === "organizer")`.

Tabla: `venues` (`drizzle/schema.ts`). Categorías: `venue_categories`, catálogo configurable (no enum rígido) — ver `listVenueCategories`/`createVenueCategory` en `server/db/venuesDb.ts`.

## Comunidades

Relación M2M `community_venues` (nunca `ie_venues`/`uva_venues`). Un venue puede pertenecer a IE, a UVA, o a ambas simultáneamente — el mismo componente público (`client/src/pages/segolife/VenueDetail.tsx`, ruta `/:community/venues/:slug`) sirve cualquier combinación sin lógica condicional por nombre de comunidad (regla arquitectónica fundamental del proyecto, ver CLAUDE.md).

## Media: LOGO vs COVER vs GALLERY

Tres campos/fuentes distintos, cada uno con un propósito real:

| Campo | Uso | Tratamiento CSS |
|---|---|---|
| `venues.imageUrl` (preexistente, reutilizado) | LOGO — insignia pequeña superpuesta al hero | `object-contain`, admite transparencia |
| `venues.coverImageUrl` (nuevo, migración 0138) | COVER — foto grande del hero de la ficha | `object-cover` |
| `gallery_items` con `venueId` + `category="venue_gallery"` | Galería de fotos adicionales | grid, lazy-loaded |

`category="venue_gallery"` es un valor deliberadamente distinto de `"home_hero"` (reservado para el hero de PublicHome) — el endpoint público `gallery.getItems({ venueId, category })` ya soportaba filtrar por `venueId` desde Fase 8.5; Fase 8.6 solo añadió el valor de categoría y los admin de asociación (`gallery.adminCreate`/`adminDelete` con `venueId`).

**Nota real encontrada en QA visual**: la insignia del logo usaba fondo blanco (`bg-white`). Varios logos reales de venues nightlife son marcas blancas/claras sobre transparencia (Casanova, Tanker Events) — sobre blanco quedaban invisibles. Corregido a un fondo oscuro semitransparente con blur (`bg-black/50 backdrop-blur-sm`), que da contraste a un logo claro y sigue funcionando con uno oscuro u opaco (ver `VenueDetail.tsx`, badge del hero).

**Gap editorial conocido, no corregido**: el logo de Selfish Poke y su primera foto de portada comparten la misma URL en los assets reales proporcionados por el usuario — no se ha inventado un logo alternativo (regla explícita: nunca fabricar datos). Queda documentado como pendiente de que el propio negocio suba un logo dedicado.

## Relación con Event

`events.venueId` (preexistente) — un evento pertenece opcionalmente a un venue. `events.publicByVenue({ venueId })` (nuevo) devuelve los eventos de un venue para la ficha pública; el mismo shape de evento (`EventListItem`, con `venue` embebido) permite navegar Event→Venue desde el propio `EventDetail` público.

## Público vs privado

El DTO público (`venues.publicGetBySlug`) devuelve `{ venue, category, communities }` — nunca credenciales de integración, nunca campos internos. Las credenciales de Fourvenues/Weezevent viven en `venue_integrations.credentialsEncrypted`/`credentialsLast4`, tabla que el router público **nunca** consulta. Cubierto por tests en `server/routers/venuesPublic.test.ts` ("no-credentials-in-public-DTO").

Un venue con `status='inactive'` nunca se expone en `publicGetBySlug`/`publicActive`/`publicFeatured`, aunque el slug exista y se conozca — evita enumeración accidental de fichas no publicadas.

## Ticketing, Attendance, SegoTokens, Benefits, Commerce, Integrations

Todo esto se **reutiliza en su totalidad** desde el propio Venue — no hay dominios paralelos:

- **Commerce**: `venue_products`/`commerce_transactions` vía `VenueCommerceTab` (admin) — ya existía desde antes de esta fase, solo se auditó y se confirmó que sigue siendo la única vía.
- **SegoTokens**: `venue_token_schedules` vía `VenueSegoTokensTab` (admin) — igual, preexistente.
- **Benefits**: motor de `benefit_rules`/`user_benefits`, mostrado en `VenueBenefitsTab` (admin) cuando existe una regla real vinculada al venue como origen o destino.
- **Integrations**: `venue_integrations` (Fourvenues/Weezevent), estado real (`not_configured`/`configured`/`connected`/`error`/`disabled`) mostrado en `VenueCommerceTab`. **Ningún proveedor está activo en esta fase** — ver `docs/integrations/fourvenues.md` y `docs/integrations/weezevent.md` para el estado real. Tanker Events, pese a ser el venue con mayor probabilidad futura de usar Weezevent para sus eventos, no tiene ninguna integración activada — Weezevent será, a futuro, un *proveedor/canal* para sus eventos, nunca una característica que lo distinga arquitectónicamente como venue.

Ninguna de estas piezas se muestra en la ficha **pública** del venue en esta fase (ver comentario en `VenueDetail.tsx`): no existe todavía un endpoint público de SegoTokens/Benefits por venue, y construirlo queda fuera de alcance — se prefiere omitir a afirmar sin dato real ("Gana 50 SegoTokens" sin una regla real detrás).

## Admin

`/admin/venues` (`VenuesManager.tsx`) — listado operativo: categoría, comunidades, estado, destacado, integración, eventos próximos.
`/admin/venues/:id` (`VenueDetail.tsx`) — pestañas: **Datos generales** / **Media** (nueva, Fase 8.6) / **Comunidades** / **Eventos** (rehecha: separa próximos/pasados + botón "Nuevo evento en este venue") / **SegoTokens** / **QR/Consumiciones** / **Benefits** / **Commerce/Integrations**.

## Los 7 venues reales

Casanova, Chin Chin, La Finca Club, Limoncello, Selfish Poke, Tanker Events, Tía Felisa — **nunca sembrados vía migración SQL**. Durante esta fase de implementación existen únicamente como fixture local (`nayade_db`, puerto 3307) para poder hacer QA visual real; la creación en producción queda pendiente de una fase de cierre explícita con una estrategia de content-bootstrap segura (ver informe final, sección de estrategia de datos de producción).
