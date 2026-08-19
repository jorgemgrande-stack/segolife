# SEGOLIFE — MG-03B + MG-04 Final Closure

> Documento de cierre dedicado, generado a petición explícita del "FINAL
> REMAINDER COMPLETION PROMPT" que autorizó ambas especificaciones como
> canónicas, anulando la clasificación previa ("NO ACTION" / "BUSINESS SPEC
> NOT FOUND") documentada en `docs/OVERNIGHT_EXECUTION_LOG.md` secciones 3/4.
> Ver también `docs/OVERNIGHT_EXECUTION_LOG.md` sección 8 (resumen) y
> `docs/OVERNIGHT_BACKLOG.md` (entradas marcadas DONE sin borrarse).

## MG-03B — Profile Photo Activity

**Objetivo:** cuando un Student gestiona su foto de perfil, `/:community/activity`
debe reflejarlo como una actividad más (añadida/actualizada/eliminada), sin
conceder SegoTokens ni crear un sistema de auditoría paralelo.

**Arquitectura:** tabla dedicada `student_photo_events` (`id`, `user_id`,
`occurred_at`, `action` enum `added|updated|removed`) — mismo patrón que
`student_login_events`, ya establecido en el repo para tipos de evento no
económicos. `studentPhotoEventsDb.ts` expone `recordStudentPhotoEvent` /
`listPhotoEventsByUserId`.

**Flujo real:** `studentPhotoService.ts::replaceMyPhoto` captura
`previousKey` (ya lo necesitaba para su propia lógica de limpieza) ANTES de
escribir — si había foto previa, registra `updated`; si no, `added`.
`removeMyPhoto` solo registra `removed` si de verdad había una foto que
borrar (idempotencia real, no solo de red: llamar a "eliminar" sin foto es
un no-op y nunca genera una actividad falsa). El registro es best-effort:
si falla, la foto ya guardada/eliminada nunca se deshace ni se revierte.

**Exposición:** nuevo procedure `students.myPhotoActivity` (protectedProcedure,
consulta solo por `ctx.user.id` — nunca acepta un userId del cliente).
`Activity.tsx` funde estos eventos con el resto del historial (ledger +
benefits) en el mismo `useMemo`, sin tocar `amount` — por construcción nunca
puede mostrar "+0 ST" ni ningún importe.

**Privacidad:** la tabla solo guarda `userId` + `action` + timestamp — nunca
la imagen, la URL, la key de storage ni ningún metadato interno.

**i18n:** EN "Profile photo added/updated/removed", ES "Foto de perfil
añadida/actualizada/eliminada" — claves reales en
`client/src/locales/{en,es}/segolife.json`, nunca texto hardcodeado.

**IDOR:** verificado — `myPhotoActivity` consulta exclusivamente
`ctx.user.id`; dos llamadas de dos usuarios distintos nunca pueden
cruzarse (test dedicado en `students.test.ts`).

**Tests:** `studentPhotoEventsDb.test.ts` (3), `studentPhotoService.test.ts`
(+6), `students.test.ts` (+2), `Activity.test.tsx` (+5) = 16 tests nuevos.

**Commit:** `6870431`. **Deploy:** Railway Online, deployment
`0ddf4b31-e25a-427d-9a68-197df087d820`, SHA verificada desde dentro del
contenedor, health/ready 200, logs limpios.

## MG-04 — Community Proposals 2.0 (imagen de portada + urgencia)

**Contexto previo:** la extensión de venue/fecha sugerida de esta misma
noche (commit `1363293`) ya estaba en producción. La imagen de portada
había quedado clasificada "BUSINESS DECISION REQUIRED" — el propio wizard
Admin (`ComunityWizard.tsx`) no tiene subida real, solo pega una URL a mano
desde CMS→Multimedia. La autorización explícita de este prompt anula esa
clasificación.

### Imagen de portada

`communityProposalImageService.ts` reutiliza el mismo NIVEL DE RIGOR de
validación que MG-03 (`sharp()` decodifica de verdad — nunca confía en la
extensión ni el `Content-Type` declarado; SVG siempre rechazado por riesgo
XSS/XXE; límite 8 MB; dimensiones 32–8000px; sin copiar EXIF al resultado),
pero con dos diferencias deliberadas frente al avatar: usa `storagePut`
**público** (nunca el storage privado del avatar — la imagen de una idea es
visible por cualquier Student de Trending/Mis ideas) y redimensiona en
modo "cover" (ancho máximo 1200px conservando proporción, nunca recorta a
cuadrado — no es una foto de identificación).

`POST /api/community/proposal-image` — REST multipart, mismo patrón que
`studentPhotoRoutes.ts`: exige sesión (`getUserFromRequest`), valida,
sube, devuelve `{success, url}` o un error tipado.

Storage: el fallback local (`S3`/Forge no configurados en este entorno)
escribe en `/tmp/local-storage`, que coincide exactamente con el volumen
persistente real de Railway (`segolife-volume`) ya montado en esa ruta —
confirmado durable, no en riesgo de pérdida en cada redeploy.

Frontend (`ComunityHub.tsx`): input de archivo oculto + preview con botón
de quitar, subida inmediata al seleccionar (antes de enviar el formulario),
validación cliente (tipo/tamaño) como UX — el servidor sigue siendo la
única puerta real.

### Urgencia

Enum propio `no_rush|soon|urgent` en `community_student_proposals.urgency`
— deliberadamente NO reutiliza `community_proposals.urgencyType` (tabla y
semántica distintas: ventana de cierre de una encuesta Admin vs. preferencia
simple del Student). Selector de 3 botones, click de nuevo para deseleccionar.
Nunca concede SegoTokens, nunca altera la prioridad interna de moderación.

### Comunidad — IDOR (retest)

El fix `b8850c4` (comunidad SIEMPRE derivada de `getUserCommunities(ctx.user.id)`,
nunca del `communityId` del body) sigue vigente y fue re-testeado
explícitamente con el payload nuevo: `coverImageUrl`/`urgency` en el body
nunca reabren la vía de manipular `communityId` (test dedicado en
`community.test.ts`).

### Campos reservados de Admin

El `z.object()` del router (`submitProposal`) solo declara los campos que
el Student puede enviar — cualquier clave no declarada (`status`,
`approved`, `featured`, `moderationNotes`, `segoTokens`, etc.) es
descartada por el comportamiento por defecto de zod, nunca llega a
`submitStudentProposal` aunque el cliente la incluya manipulando el body
(test dedicado).

### Gap corregido

`venueId` ya se guardaba en `community_student_proposals` desde la
extensión de esta noche, pero nunca se exponía resuelto a un nombre real
para Admin. Se añadió un `leftJoin` con `venues` en
`listStudentProposals` (`communityStudentProposalDb.ts`) — corrección
mínima, sin rediseñar el resto del wizard de moderación.

### Notificaciones

Confirmación al Student (toast) y alerta a Admin (creación) ya existían de
la extensión de esta noche — verificadas sin regresión ni duplicación con
el payload nuevo. La notificación de aprobación/rechazo de una idea sigue
sin existir (requeriría definir un lifecycle de notificación que nunca se
diseñó) — clasificada **FOLLOW-UP PRODUCT ENHANCEMENT**, no bloquea el
cierre de MG-04 (autorizado explícitamente así por el propio prompt).

### Visibilidad Admin

`ComunityModeration.tsx` muestra ahora la miniatura de la imagen, el
nombre del venue resuelto y un badge de urgencia cuando el Student los
rellenó.

### Tests nuevos

- `communityProposalImageService.test.ts` (11) — validación real con
  sharp(), nunca mockeada.
- `communityStudentProposalDb.test.ts` (6) — primer test de este fichero;
  escritura de `coverImageUrl`/`urgency`, leftJoin de `venueName`.
- `community.test.ts` (+6) — passthrough de imagen/urgencia, rechazo de
  urgencia fuera de enum, rechazo de URL inválida, IDOR retest con el
  payload nuevo, campos reservados de Admin descartados.
- `ComunityHub.test.tsx` (+9) — subida/preview/quitar imagen, rechazo
  client-side de tipo no permitido, error 500 no bloquea el formulario,
  selección/deselección de urgencia, i18n ES de los 3 niveles, payload
  nunca incluye campos reservados.
- `ComunityModeration.test.tsx` (5) — primer test de este fichero;
  miniatura, ausencia de miniatura sin imagen, nombre de venue, badge de
  urgencia, ausencia de badge sin urgencia.

Total: 37 tests nuevos, todos verdes.

### Regresión global

3309 passed / 18 failed — exactamente los mismos 4 ficheros y los mismos
nombres de test que el baseline de sesión (`nayade.test.ts`,
`regression.recalculate.test.ts`, `reservationEmails.test.ts`,
`transferConfirmationEmail.test.ts`). Cero regresión real.

### TypeScript / Build

`npx tsc --noEmit`: 118 errores (baseline exacto, cero nuevos — verificado
línea por línea que ninguno cae en un fichero tocado esta noche).
`pnpm build`: limpio.

### Migración

`drizzle/0158_community_student_proposals_image_urgency.sql` (`cover_image_url`
varchar(512), `urgency` enum) + `scripts/apply-community-proposals-image-urgency.cjs`
(idempotente, mismo patrón que `0157`). Aplicada en producción vía
`railway ssh` dentro de `/app` (la red interna de Railway solo es alcanzable
desde dentro del contenedor, no desde `railway run` en la máquina local —
mismo hallazgo operativo que MG-03B). Verificada con un `DESCRIBE` real:
ambas columnas presentes.

### Git / Deploy

Rama `feat/mg04-community-proposals-2` → merge fast-forward a `main` → push
→ verificado Online, `RAILWAY_GIT_COMMIT_SHA` comprobada desde dentro del
contenedor coincide con `origin/main`, `/api/health`/`/api/ready` 200,
logs limpios.

### Integridad de datos

Cero pedidos/entradas/movimientos de ledger/reembolsos/asistencia/compras
de Benefits/empleados/eventos reales creados o mutados por este trabajo.
La migración es puramente aditiva (dos columnas nullable, sin backfill).

### Seguridad transversal (retest)

- IDOR de `submitProposal` (`b8850c4`): sigue vigente, retesteado con el
  payload nuevo.
- Foto de perfil cruzada (MG-03B): `myPhotoActivity` consulta
  exclusivamente `ctx.user.id`, sin cambios este bloque.
- Un Student sin ninguna comunidad real (edge case, incluye
  estructuralmente cualquier cuenta que no sea Student — p.ej. un venue
  operator) es rechazado con `FORBIDDEN`: `getUserCommunities` nunca
  devuelve membresías para una cuenta que no sea Student real.
- Anónimo: `submitProposal` es `protectedProcedure` — rechazado sin sesión
  (test ya existente, sin regresión).

## Cierre

**MG-03B COMPLETE = YES.** **MG-04 COMPLETE = YES** (notificación de
aprobación/rechazo queda como FOLLOW-UP PRODUCT ENHANCEMENT, explícitamente
autorizado a no bloquear el cierre).

No se inicia MG-05, FIX-06 ni ninguna fase nueva — cierre explícito según
la instrucción del prompt que autorizó este trabajo.
