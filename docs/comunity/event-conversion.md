# COMUNITY — Convertir en Evento

`server/segolife/community/communityEventConversionService.ts` — la acción que cierra el círculo IDEA→PREGUNTA→DEMANDA REAL→EVENTO. **Siempre admin-triggered, nunca automática.**

## 1. `convertProposalToEventDraft()`

- **Idempotente** (spec punto 67): si `proposal.convertedEventId` ya está fijado, devuelve el evento existente en vez de crear uno duplicado — protegido contra doble-clic o doble-llamada.
- **Requiere una fecha** — `events.starts_at` es `NOT NULL` en el schema (auditado antes de escribir código). Se usa `proposal.startsAt` si existe; si no, el admin debe indicar una fecha explícita al convertir (`ConvertProposalInput.startsAt`) — si falta, lanza `MISSING_DATE` en vez de inventar una fecha.
- **Se crea SIEMPRE como borrador** — `status: "inactive"` explícito, nunca `"active"`. Convertir nunca publica un evento por sí solo (spec punto 44, "nunca automático").
- **Mapeo campo a campo, nunca spread ciego** — mismo patrón que `duplicateTicketType` (`ticketingDb.ts`): se lee la propuesta completa y se construye un `CreateEventInput` explícito (`name`, `slug` único generado, `description`, `venueId`, `startsAt`, `endsAt`, `capacity`, `imageUrl`).
- **Origen trazable** — `sourceType: "community_proposal"`, `sourceId: proposal.id` (columnas nuevas en `events`, mismo patrón que `token_ledger.sourceType/sourceId`). Esto permite en el futuro, sin cambios de schema, preguntar "¿qué eventos nacieron de COMUNITY?" con una query directa.
- **La relación se persiste en ambos sentidos**: el evento sabe su origen (`source_id`) y la propuesta sabe su destino (`community_proposals.converted_event_id`) — nunca solo texto libre en una descripción.
- **Comunidades del evento heredadas del scoping de la propuesta** (`community_proposal_communities`), no de la audiencia de respuesta — un evento pertenece a comunidades administrativamente, igual que cualquier otro evento del sistema.

## 2. Notificar interesados (`notifyInterestedRespondents`)

- **Acción explícita y separada** (spec punto 83, "Notify interested" es un botón propio) — nunca se dispara automáticamente al publicar el evento convertido, precisamente para no acoplar el ciclo de vida de COMUNITY al de Events.
- **"Interesado" = respondente positivo** (`isPositiveRespondent`, ver `scoring.md`) — nunca "todo el mundo que vio la pregunta".
- Solo tiene efecto si `proposal.convertedEventId` ya existe; si no, devuelve `{ notified: 0 }` sin error (llamarlo antes de convertir es un no-op seguro, no un fallo).
- Notificación **in-app únicamente**, vía la plantilla `community_interested_event_published` ("Lo pedisteis. Ya está aquí.") con deep link al evento real (`/${slug}/events/${event.slug}`) — canales externos ni se intentan (spec punto 21/95).
- Un fallo al notificar a un destinatario concreto (p. ej. sin comunidad resuelta) se registra y se salta — nunca aborta el resto del lote.

## 3. Relación con `related_event_id`

`community_proposals.related_event_id` es un campo **distinto** de `converted_event_id` (spec punto 52-53): una propuesta puede referirse a un evento **ya existente** (p. ej. "¿qué música para este evento?") sin que eso implique conversión — son dos relaciones semánticamente distintas y así se modelan, nunca se reutiliza un mismo campo para ambos sentidos.
