# COMUNITY — Arquitectura

**Rama:** `feat/segolife-comunity`
**Estado:** implementación completa en local/rama. **No mergeado, no desplegado, sin migración en producción.**
**Filosofía del encargo:** "AUDIT FIRST. REUSE FIRST. DATA FIRST. THEN BUILD."

COMUNITY es la capa de inteligencia social y activación rápida de Segolife: sondeos/preguntas rápidas, intención de asistencia, propuestas de estudiantes, moderación, segmentación y conversión de demanda real en Eventos. No es un sistema de encuestas genérico — cada pieza de dato tiene una fuente, cada métrica una fórmula documentada, y ninguna pantalla decide nada que no pueda explicar.

---

## 1. Auditoría previa (REUSE / ADAPT / CREATE)

Antes de escribir una sola tabla se auditó el repo completo (3 agentes de exploración en paralelo). Resultado:

| Necesidad | Decisión | Fuente reutilizada |
|---|---|---|
| Motor de segmentación de audiencia | **REUSE** | `server/segolife/engagement/audienceEngine.ts` — `resolveAudience()`, extendido con un campo `allStudents?: boolean` (spec: "TODOS" es un target válido; antes una `AudienceDefinition` vacía devolvía `[]` a propósito — "nunca todos por accidente" — así que hacía falta un opt-in explícito, no un workaround). |
| Snapshot de audiencia al publicar | **REUSE del patrón** | Mismo criterio que `engagement_campaigns → engagement_campaign_audiences` (ver `campaignService.ts`, `sendCampaignNow`). Aquí: `community_proposal_audiences`. |
| Notificaciones in-app + deep link | **REUSE** | `server/segolife/engagement/notificationService.ts` (`createNotification`) + `templates.ts` (`renderTemplate`) — 2 plantillas nuevas (`community_proposal_published`, `community_interested_event_published`), nunca un `RenderedTemplate` construido a mano. |
| SegoTokens | **REUSE** | `postLedgerMovement` (primitiva atómica que también usa `earnTokens()`/`adjustManualTokens()`), nunca se toca `token_ledger`/`token_wallets` directamente. |
| RBAC / scoping por comunidad | **REUSE del patrón** | `permissionProcedure` + `communityAccess.ts` + `assert*Accessible`, mismo criterio que `students.ts`/`events.ts`. Se creó RBAC nuevo (4 permisos) porque no existía ninguno semánticamente correcto — nunca se reutilizó uno ajeno. |
| Encuestas/sondeos/propuestas de estudiante | **CREATE** | No existía ninguna infraestructura de polls/voting en el repo (confirmado exhaustivamente). |
| Concepto de Evento "borrador" + origen | **ADAPT** | `events.status` era estrictamente `["active","inactive"]` sin concepto de origen. Se añadieron `events.source_type`/`events.source_id` (mismo patrón que `token_ledger.sourceType/sourceId`) y `CreateEventInput.status/sourceType/sourceId` opcionales — sin romper ningún flujo existente (todos los campos son opcionales, `createEvent()` sigue funcionando igual si no se pasan). |

**Colisión de nombres evitada:** ya existían tablas `proposals`/`proposal_options` para el dominio comercial heredado de Náyade (Lead→Propuesta→Presupuesto). Dominio completamente distinto — todas las tablas nuevas usan el prefijo `community_` para que nunca se confundan ni en código ni en una consulta SQL manual.

---

## 2. Modelo de datos

8 tablas nuevas (prefijo `community_`) + 2 columnas nuevas en `events` (`source_type`, `source_id`). Migración: `drizzle/0142_comunity.sql` (aplicada solo en local, nunca en producción).

| Tabla | Propósito |
|---|---|
| `community_proposals` | La propuesta/pregunta en sí — tipo, estado, ventana temporal, visibilidad de resultados, recompensa, audiencia (JSON), venue/evento relacionado, evento convertido. |
| `community_proposal_communities` | Alcance **administrativo** (qué comunidad gestiona/ve esta propuesta en el admin) — bridge table, convención "sin fila = universal" (mismo criterio que `benefit_communities`/`campaign_communities`). **Deliberadamente distinto** de `audienceDefinition` (quién puede responder) — scoping ≠ audiencia, son conceptos independientes. |
| `community_options` | Opciones de una pregunta (single_choice/multiselect/ranking/percentage_scale). `isPositiveIntent` marca qué opción cuenta como "respuesta positiva" (spec punto 48), nunca visible al estudiante. |
| `community_proposal_audiences` | Snapshot de quién PODÍA responder, fijado en el momento de publicar (spec punto 11 — decisión explícita: la audiencia no cambia si luego cambian tags/segmentos). |
| `community_responses` | Una fila por (propuesta, estudiante) — `UNIQUE(proposal_id, user_id)`. Controla si ya se concedió recompensa (`reward_granted`) y el ledger asociado. |
| `community_response_values` | N filas por respuesta (multiselect/ranking/percentage_scale) o 1 fila (resto de tipos) — equilibrio entre "todo en JSON" y "una tabla por tipo" (spec punto 66). |
| `community_student_proposals` | Ideas de estudiante — lifecycle propio, nunca se reescribe como si fuera ya una encuesta formal. |
| `community_supports` | Apoyos a una idea de estudiante — `UNIQUE(student_proposal_id, user_id)`. El conteo de apoyos **nunca** se denormaliza, siempre `COUNT(*)` en vivo. |

Índices diseñados sobre `proposal_id`/`user_id`/`community_id`/`status`/`starts_at`/`ends_at`/`created_at` — validados contra MySQL 8/9.4 (`docker exec` local, sin drift).

---

## 3. Capas de servicio

| Archivo | Responsabilidad |
|---|---|
| `server/segolife/community/communityDb.ts` | CRUD de propuestas/opciones/scoping. `isProposalOpenForResponses()` — **la única fuente de verdad** de si una propuesta acepta respuestas ahora mismo (nunca confía solo en `status`, siempre revalida `starts_at`/`ends_at`, incluso con el scheduler apagado). |
| `communityAudienceService.ts` | `previewProposalAudience()` (preview antes de publicar, spec punto 10) y `publishProposal()` (snapshot + transición de estado + notificación in-app). |
| `communityIntentService.ts` | Funciones puras: pesos de intención de asistencia, `isPositiveRespondent()` por tipo de pregunta. |
| `communityResponseService.ts` | `submitResponse()` — valida tipo/ventana/duplicado, upsert idempotente, recompensa en SegoTokens solo en el primer envío. |
| `communityResultsService.ts` | Agregación **server-side** por tipo de pregunta (spec punto 63 — nunca se traen respuestas crudas al frontend). |
| `communityScoreService.ts` | COMUNITY Score — función pura, ver `scoring.md`. |
| `communityStudentProposalDb.ts` | Ideas de estudiante, moderación, apoyos, tendencia — ver `moderation.md`. |
| `communityEventConversionService.ts` | Convertir en Evento borrador + notificar interesados — ver `event-conversion.md`. |

Router: `server/routers/community.ts`, montado en `server/routers.ts` como `community: communityRouter`.

---

## 4. RBAC

4 permisos nuevos (`server/_core/rbacSeed.ts`, sembrados con `pnpm db:seed`), ninguno reutilizado de un dominio ajeno:

- `community.view` — ver propuestas/respuestas/resultados/ideas.
- `community.manage` — crear/editar/programar/cancelar/convertir a Evento.
- `community.moderate` — aprobar/rechazar ideas, ocultar/destacar texto libre.
- `community.publish` — publicar (acción separada de crear, deliberadamente).

El rol `admin` recibe los 4. El scoping por comunidad reutiliza `communityAccess.ts` — un admin de comunidad nunca puede gestionar una propuesta fuera de su alcance (`assertProposalAccessible`/`assertCommunityIdsWithinAccess`).

---

## 5. Rate limiting

Mismo patrón manual ya usado en todo el repo (`express-rate-limit`, sin librería genérica): `communityRespondRateLimit` (20/min), `communitySubmitProposalRateLimit` (5/min), `communitySupportRateLimit` (30/min) — registrados en `server/_core/index.ts` antes del `authGuard`.

---

## 6. Scheduler — apagado por diseño en esta fase

`COMUNITY_SCHEDULER_ENABLED` (flag, default `false`) — **no se activó ningún worker** en esta implementación. Esto es seguro porque `isProposalOpenForResponses()` ya revalida la ventana temporal en cada request pública, con o sin scheduler: una propuesta con `ends_at` vencido deja de aceptar respuestas aunque nadie haya "cerrado" su `status` todavía.

---

## 7. Integración con Student 360

`shared/segolife/student360.ts` — `TimelineEventType` extendido con `community_response`/`community_support`/`community_proposal_submitted` (solo los eventos con valor directo para un admin viendo la ficha; `proposal_approved`/`reward`/`event_conversion` ya quedan cubiertos por `admin_action`/`token_credit` existentes — no se duplican).

`server/segolife/students/studentActivityAggregator.ts` — 3 nuevas fuentes en `collectAllEvents()`, alimentadas por `listResponsesByUserId`/`listSupportsByUserId`/`listStudentProposalsByUserId` (nuevas funciones en las capas de servicio de COMUNITY, mismo patrón que el resto de fuentes del aggregator). El SegoScore **no cambia** — la recompensa de tokens ya se refleja como su propio `token_credit`, y este dato no altera ninguna fórmula existente, solo enriquece el timeline.

---

## 8. Frontend

**Admin** (`client/src/pages/admin/comunity/`): `ComunityManager` (dashboard + lista operativa en una sola pantalla, `/admin/comunity`), `ComunityWizard` (7 pasos, `/admin/comunity/nueva`), `ComunityDetail` (`/admin/comunity/:id`), `ComunityModeration` (`/admin/comunity/moderacion`). Navegación añadida en `AdminLayout.tsx` junto a Engagement.

**Estudiante** (`client/src/pages/segolife/`): `ComunityHub` (`/:community/comunity`, pestañas Activas/Respondidas/Resultados/Proponer) y `ComunityQuestionDetail` (`/:community/comunity/:id`, formulario de voto por tipo + resultados). Entrada de navegación: módulo real en `Home.tsx` (solo se muestra si `community.myActive` devuelve datos reales — "REAL DATA ONLY", mismo criterio que el resto de Home) + ítem en `SegolifeSidebar.tsx` (desktop). El bottom-nav móvil (5 columnas fijas: Home/Explore/Scan/Rewards/Profile) **no se tocó** — está deliberadamente al límite y el propio encargo advierte de no romperlo; la Home module card es el punto de entrada móvil real, tal y como el propio spec anticipa en su punto 22.

---

## 9. Qué NO se ha hecho (documentado, no un olvido)

- **NO merge, NO push, NO deploy, NO migración en producción** (spec punto 94, cumplido).
- **NO** notificaciones externas (email/push/WhatsApp) — solo intención in-app (spec punto 21).
- **NO** streaks de participación (arquitectura preparada, no forzada — spec punto 19 lo permite explícitamente como futuro).
- **NO** exportación de resultados (no existe infraestructura de export genérica en el repo; no se ha inventado una para esta feature).
- **NO** análisis de texto libre con IA (spec punto 30, explícitamente fuera de fase).
- **NO** aprendizaje automático (spec punto 51, solo arquitectura/datos preparados).
