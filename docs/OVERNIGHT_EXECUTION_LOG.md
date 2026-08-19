# SEGOLIFE — Overnight Execution Log

Registro append-only de la sesión nocturna autónoma de cierre de roadmap
(post FIX-01). Cada fase añade su propia sección — nunca se sobrescribe
historia previa.

---

## 0. Baseline inicial

- **Fecha/hora inicio:** 2026-08-19 (continuación de la misma sesión que cerró FIX-01)
- **HEAD:** `994f4c3` — coincide con `origin/main`
- **Working tree:** clean
- **Producción:** Railway `thorough-liberation`/`segolife`, deployment `6a9c7dc5-6491-4da8-8718-a1ae42b16db9`, status Online
- **Health:** `/api/health` = 200
- **Ready:** `/api/ready` = 200
- **Tests (verificados al cierre de FIX-01, misma sesión, sin cambios desde entonces):** 3201 PASS / 18 FAIL heredados / 3219 total
- **TypeScript:** 118 errores heredados (idénticos a main)
- **Build:** PASS

Baseline confirmado — se procede con el roadmap en el orden de prioridad indicado (FIX-02 → FIX-03 → MG-03B → MG-04 → Community Proposals → Fourvenues date-change → Integration health → QA final → Production final).

---

## 1. FIX-02 — Operational Day Consistency (pickTicketToday)

**Arquitectura encontrada:** `server/segolife/home/homeSummaryService.ts` tiene dos funciones hermanas: `filterTonight` (ya corregida en MG-01 para usar `resolveOperationalDate`, corte 06:00 Europe/Madrid, en vez de medianoche de calendario) y `pickTicketToday` (nunca recibió el mismo fix — seguía usando `resolveMadridMoment` puro, comparando fechas de calendario).

**Causa raíz:** exactamente el mismo bug que MG-01 ya documentó y corrigió para `filterTonight`, pero en su función hermana. Un ticket para una fiesta que empezó antes de medianoche desaparecía de "tu entrada de hoy" en cuanto el reloj cruzaba las 00:00 de calendario, aunque la noche operativa siguiera en curso hasta las 06:00.

**Fix:** `pickTicketToday` ahora usa `resolveOperationalDate(at) === resolveOperationalDate(event.startsAt)` — el MISMO predicado exacto que `filterTonight`, sin duplicar lógica de fecha. Import de `resolveMadridMoment` eliminado (quedó sin uso). Única función consumidora confirmada (`getHomeSummary`, línea ~334) — sin otros consumidores directos.

**Tests:** 12 nuevos en `homeSummaryService.test.ts` (exportada `pickTicketToday` para testabilidad directa, mismo criterio que `filterTonight`): 23:59, 00:00 exacto (regresión central), 00:30, 02:00, 05:59, 06:00 exacto (corte correcto), DST Europe/Madrid (2026-10-25 CEST→CET), noche anterior, noche siguiente, ticket `used` excluido, ticket `issued` válido con datos correctos, múltiples tickets (solo el correcto se propone). 18/18 tests del fichero en verde (6 preexistentes + 12 nuevos).

**Regresión:** `server/segolife/home/` completo (30/30), TypeScript (118 errores, idéntico a baseline, cero nuevos), build no re-ejecutado individualmente (se hará antes del cierre de bloque combinado más adelante si aplica — build ya había pasado limpio al cierre de FIX-01 con este mismo código base).

**Playwright:** no se fuerza un E2E visual — un "ticket de hoy" real requiere un evento y ticket QA vigentes en producción en el momento exacto de ejecución, no garantizable de forma determinista; clasificado DATA STATE. Cobertura completa vía los 12 tests unitarios deterministas.

**Commit:** `1e30dfd` (rama `fix/fix02-operational-ticket-today`, fast-forward a main).

**Deploy:** Railway Online, deployment `8af146c1-1d02-4f58-87a1-62644ab9cbd7`, `/api/health`=200, `/api/ready`=200, logs limpios, schedulers esperados activos (Fourvenues, Engagement).

**Resultado: DONE.**

---

## 2. FIX-03 — Rewards ?tab=benefits deep-link

**Arquitectura encontrada:** `client/src/pages/segolife/Rewards.tsx` está registrada en DOS rutas (`App.tsx`): `/:community/rewards` (canónica) y `/:community/benefits` (alias compat de Fase 4). El cálculo de la pestaña inicial (`defaultTab`) comprobaba `tabParam === "invite"` y `location.endsWith("/benefits")` (el alias por path), pero **nunca** `tabParam === "benefits"` — el deep-link por query quedaba sin rama, cayendo siempre al "spend" por defecto. Además `<Tabs defaultValue=...>` era no controlado — un cambio de query sin remount (navegación interna a la misma ruta, atrás/adelante del navegador) tampoco actualizaba la pestaña visible.

**Fix:** `resolveActiveTab()` (función pura, exportada y testeada) añade la rama que faltaba. `<Tabs>` pasa a ser controlado (`value`+`onValueChange`), derivado reactivamente de `useSearchParams()`/`useLocation()` (wouter, ambos hooks reactivos vía `useSyncExternalStore`). Cada click de pestaña normaliza la URL a `/rewards[?tab=...]`, así que el alias `/benefits` no "atasca" al Student si decide cambiar de pestaña manualmente.

**Tests:** 10 unitarios (`Rewards.test.tsx`, nuevo — 5 sobre `resolveActiveTab` puro, 5 de render/interacción con `userEvent` real; se confirmó que Radix Tabs requiere `userEvent` en vez de `fireEvent.click` para disparar `onValueChange` de forma fiable en jsdom, mismo patrón ya establecido en `Home.test.tsx`). 3 escenarios Playwright (`fix03-rewards-tab-deeplink.responsive.spec.ts`, nuevo) × 3 viewports.

**Regresión:** `Profile.test.tsx` (enlaza a `?tab=invite`) sin cambios, 19/19 verde. TypeScript 118 (baseline, cero nuevos).

**Commit:** `788c26a` (rama `fix/fix03-benefits-tab-navigation`).

**Deploy:** Railway Online, deployment `69aa1f7b-18aa-4dcb-b7be-4a347d5f45ce`, health/ready 200, logs limpios.

**Playwright contra producción:** primer intento (antes de desplegar) 3/9 pass — confirmando exactamente el bug esperado (las 2 escenarios que dependen del fix fallaban en las 3 resoluciones, el alias `/benefits` preexistente pasaba). Tras el deploy: 8/9 pass, 1 fallo en tablet por rate-limit real del login ("Demasiados intentos, espera 1 minuto" — causado por ejecutar dos suites completas seguidas contra producción, no un bug de producto). Re-ejecutado en solitario tras esperar el minuto: PASS limpio. **9/9 confirmado, cero regresión real.**

**Resultado: DONE.**

---

## 3. MG-03B — Residuals Discovery

Búsqueda exhaustiva de una definición canónica previa: `git log --all --oneline` (solo 2 commits MG-03 existen: `533b362` feat Student Profile Photo & Visual Identity, `601743e` su fix E2E — ninguno menciona un "MG-03B" ni deja residuales documentados), `grep -rn "MG-03B"` en todo el repo (0 resultados fuera de este propio log), `docs/SEGOLIFE_ROADMAP.md` (roadmap original Fase 1A-6, anterior por completo al esquema de nomenclatura "MG-XX", sin ninguna referencia), `docs/PRE16_OVERNIGHT_WORKLOG.md` (0 resultados). Ambos commits de MG-03 están completos y autocontenidos (feature + su propio fix de E2E), sin ningún TODO/pendiente documentado.

**Clasificación: MG-03B = NO ACTION / NO CANONICAL RESIDUAL FOUND.**

---

## 4. MG-04 — Discovery from Canonical Roadmap

Misma búsqueda exhaustiva: `git log --all` (0 commits con "MG-04"/"MG04"), `grep -rn "MG-04"` en todo el repo (0 resultados), `docs/SEGOLIFE_ROADMAP.md` y `docs/PRE16_OVERNIGHT_WORKLOG.md` (0 resultados), memoria de sesiones previas (0 referencias). No existe ninguna especificación de negocio para "MG-04" en ningún lugar del repositorio ni de las conversaciones previas indexadas.

**Clasificación: MG-04 = BUSINESS SPEC NOT FOUND.**

---

## 6. Fourvenues — cambio de fecha de eventos (backlog §16/§17)

**Auditoría:** el flujo YA convergía correctamente, sin código nuevo necesario. `eventCatalogSync.ts::syncEventCatalog` — un evento ya mapeado (vía `external_entity_mappings`, matching determinista, nunca por nombre/fecha una vez vinculado) SOLO actualiza `startsAt`/`endsAt`/`sourcePublicationStatus` en la fila existente — jamás crea un duplicado, jamás toca slug/comunidades/descripción editorial (field ownership documentado en cabecera del propio fichero desde FIX-04/FIX-05). `eventsDb.ts::updateEvent` compara before/after y emite `event_updated` (bus interno `engagementEvents`) SOLO cuando `startsAt`/`endsAt`/`venueId` cambian de verdad — nunca en un re-sync con el mismo valor, nunca para un evento inactivo. `eventLifecycleListener.ts` (registrado siempre en bootstrap, `_core/index.ts:793`) reacciona con fan-out SOLO a compradores reales con `ticket_orders.status="paid"` del evento concreto — nunca un broadcast general —, community resuelta por membresía real de cada destinatario, idempotente por `eventId:orderId:changedFields` (dos ediciones materiales distintas SÍ notifican cada una; la misma edición reprocesada nunca duplica).

**Gaps encontrados:** cero cobertura de test para `updateEvent`'s guard de "solo material" y cero cobertura para `eventLifecycleListener.ts` en absoluto (primer test de ese fichero). Añadidos 16 tests nuevos (8+8), cero cambios de producto — el comportamiento ya era correcto.

**Duplicación de eventos:** imposible por diseño — el matching por `external_entity_mappings` es la única vía para un evento ya vinculado, nunca vuelve a evaluarse por nombre/fecha.

**Slug/comunidad:** intactos — `updateEvent` nunca los toca.

**Notificación duplicada:** imposible — idempotencyKey real por `eventId:orderId:changedFields`, respaldado por el UNIQUE de `notifications.idempotencyKey`.

**Commit:** `aecebd5` (rama `test/fourvenues-date-change-coverage`, solo tests, sin cambios de producción).

**Deploy:** Railway Online, deployment `d7629337-1043-49c5-99a1-4a673e98e9a3`, health/ready 200, logs limpios.

**Resultado: DONE — ALREADY CORRECT, cobertura añadida.**

---

## 7. Integration Health (backlog §18) + FIX-01 Operational Review (§19)

**Superficie ya existente encontrada:** `client/src/pages/admin/integrations/IntegrationsManager.tsx` + `integrations.getSchedulerStatus` — panel admin YA completo por integración (`schedulerProcessRunning`, `lastSuccessAt`, `lastErrorMessage`, `due`/`nextDueAt`, `syncIntervalMinutes`, `loyaltyEnabled`, polling cada 30s). No se construye nada nuevo — spec §18 explícitamente lo pide así ("reutiliza... Command Center... NO construyas una plataforma de observabilidad nueva").

**Fourvenues:** configured=SÍ (credenciales por integración en BD, no env vars globales). Scheduler activo (`fourvenues_scheduler_enabled=true`), confirmado en los logs de CADA uno de los ~9 despliegues de esta sesión — tick cada minuto, catalog+incremental sync, `status=success` sin una sola vez `failed>0` observada en toda la noche. Último evento real: 29 eventos en catálogo, sincronización limpia.

**Brevo:** `BREVO_API_KEY`/`BREVO_WEBHOOK_TOKEN` presentes en Railway (verificado por NOMBRE de variable únicamente, vía `railway variables --json`, nunca se imprimió ningún valor). Estado operativo completo (si el envío real funciona de extremo a extremo) no verificable esta noche sin credenciales admin ni un envío real controlado — clasificado **MANUAL/CONTROLLED TEST REQUIRED** (spec §22), no forzado.

**Payment Provider:** confirmado **EXTERNAL DEPENDENCY** — cero variables `REDSYS_*`/`PAYMENT_*` en Railway (verificado por nombre), consistente con el hallazgo de código de FIX-01 (`unconfiguredPaymentProvider` en uso). Sin cambios — no se inventan credenciales, no se conecta ningún sandbox como si fuera producción.

**Schedulers:** `FourvenuesScheduler` y `EngagementScheduler` activos (confirmado en logs de cada deploy). El resto (Abandoned Checkout, Installment Overdue, Cancellation Stale, Email Ingestion, Expense Email Ingestion, Commercial Email Sync, Card Terminal Matching/Relink, Email Automation, Tax Reminder) desactivados por feature flag — estado esperado, sin cambios.

**Token Clawback Reconciliation (FIX-01 Operational Review, spec §19):** query READ-ONLY real en producción (`ticket_orders` con `status IN ('refunded','partially_refunded')`, filtrado por `metadata.loyaltyReconciliationRequired=true`) — **0 de 0** órdenes en ese estado existen en producción hoy. Cero clawbacks pendientes, cero riesgo. **Recomendación: mantener `token_clawback_reconciliation_enabled=false`** — no hay nada que reconciliar y no existe justificación operacional para activarlo esta noche. Cero mutación económica.

**`/api/health`/`/api/ready`:** revisados — ya separan correctamente liveness (nunca toca BD) de readiness (SELECT 1 real), y **deliberadamente NO** acoplan ninguna integración externa a su resultado — exactamente lo que pide el spec ("nunca hagas que /api/health caiga por una integración opcional externa"). Sin cambios: ya está bien diseñado, tocar esto sería introducir riesgo sin beneficio.

**Resultado: DONE.**

---

## 7B. Benefit "Bienvenida nuevo estudiante" — auditoría Fase 19 (backlog §20)

Query READ-ONLY real en producción (`benefit_definitions`, todas las filas): **solo existen 3 definiciones activas hoy** — "Mañana Updown en tia Felisa" (id=1, Tía Felisa), "2x1 en consumición" (id=2, Tía Felisa), "20% de descuento" (id=3, Casanova). Ninguna se llama "Bienvenida"/"Welcome" ni nada similar — el hallazgo histórico de Fase 19 (incompleto/caducado/asociado a Tía Felisa/ya comprado por Students reales) describe un Benefit que **ya no existe en esta forma** en el catálogo actual.

**Clasificación: NO LONGER RELEVANT.** El catálogo actual (3 definiciones, todas activas, sin anomalías visibles) ha sustituido por completo lo que describía el hallazgo de Fase 19. Cero mutación — no se modificó, eliminó ni se devolvió ST de ninguna compra.

---

## 5. Community Proposals — auditoría inicial y hallazgo CRITICAL/HIGH (IDOR)

**Arquitectura encontrada:** dos sistemas SEPARADOS bajo el nombre "COMUNITY", confirmados por el propio comentario de `drizzle/schema.ts` (línea ~6060): `community_student_proposals` (ideas simples de Student — título/descripción/venue/suggestedDate/category, apoyo tipo "me gusta" vía `community_supports`, lifecycle de moderación `pending_moderation→approved/rejected`) y `community_proposals` (encuestas estructuradas de Admin — tipo de pregunta, audiencia segmentada, timing/urgencia, visibilidad de resultados). Un admin puede "convertir" una idea aprobada en una encuesta formal (`sourceStudentProposalId`), pero nunca se reescribe la fila original. El wizard Admin (`ComunityWizard.tsx`) es de la SEGUNDA familia — sus campos de audiencia/tipo de pregunta/visibilidad de resultados son estructuralmente admin-only y quedan fuera de alcance para el formulario Student, tal y como exige el spec (§12: "NO permitir al Student elegir... moderación... estados internos").

**Hallazgo CRITICAL/HIGH (IDOR real, corregido antes de continuar per spec §5):** `server/routers/community.ts::submitProposal` aceptaba `communityId` directamente del body de la petición SIN comprobar nunca que el Student que llama fuera realmente miembro de esa comunidad — ni el router ni `submitStudentProposal` (`communityStudentProposalDb.ts`) validaban membresía. El cliente (`ProponerTab`) siempre envía la comunidad real vía `useCommunity()`, pero nada en el servidor impedía manipular la petición (devtools/API directa) para proponer en la comunidad de otro Student — vulnerabilidad activa en producción hasta este fix.

**Fix:** se añade una comprobación de membresía real (`getUserCommunities(ctx.user.id)` + `FORBIDDEN` si no hay overlap) en el router, antes de llamar a `submitStudentProposal` — sin tocar su firma ni su lógica de escritura, reutilizando el mismo patrón `getUserCommunities`/`assertUserAccessible` ya establecido en `tokens.ts`.

**Tests:** 4 nuevos en `community.test.ts` (regresión IDOR explícita, caso feliz con membresía real, edge case sin ninguna comunidad, membresía IE+UVA doble). 19/19 verde. TypeScript 118 (baseline, cero nuevos).

**Commit:** `b8850c4` (rama `fix/community-proposal-idor`).

**Deploy:** Railway Online, deployment `1ab414ab-7221-49a2-82e6-0c2786abbe8f`, health/ready 200, logs limpios.

**Hallazgo adicional (no bug, oportunidad de reutilización):** el backend YA acepta `venueId`/`suggestedDate`/`category` en `submitProposal` (validados por zod, escritos en `communityStudentProposalDb.ts`) — el frontend (`ProponerTab`) nunca los expone. Esto reduce sustancialmente el trabajo de la extensión de UX pedida en el backlog (§12): no hace falta tocar backend/schema para venue/fecha sugerida/categoría, solo el formulario.

**Extensión de UI (§12/§13):** `ProponerTab` (ComunityHub.tsx) gana venue relacionado (desplegable real, `venues.publicActive`) y "cuándo te gustaría que fuera" (presets "Este finde"/"La semana que viene" + fecha personalizada, mismo espíritu que los `FLASH_PRESETS` de urgencia del wizard Admin, adaptado a fecha sugerida en vez de cierre de votación — un idea de Student no tiene ventana de voto). Nunca comunidad/scope/audiencia/tipo de pregunta/visibilidad de resultados — estructuralmente admin-only (`community_proposals`, otra tabla). Imagen de portada **NO implementada** — **BUSINESS DECISION REQUIRED**: ni el propio wizard Admin tiene subida real (solo URL pegada desde CMS→Multimedia), así que no existe ningún patrón de subida pública de imágenes ya construido y seguro que un Student pueda reutilizar; construir uno nuevo es superficie de abuso/moderación que merece su propio diseño. Commit `1363293`.

**Notificación admin (§15.B):** nuevo notificador `communityProposalNotifier.ts`, plantilla nueva y correctamente categorizada (`community_student_proposal_submitted`, adminCategory COMMUNITY) — deliberadamente NO reutiliza `planplay_proposal_approved` (adminCategory PLAN_AND_PLAY, status "prepared", template de un hueco ya documentado en una auditoría previa) por la instrucción permanente de no construir nada alrededor de Plan & Play. Confirmación al Student (item A del spec) ya existía (toast al enviar) — sin trabajo adicional. Item C (notificar cambios de estado/aprobación) queda **BUSINESS DECISION REQUIRED** — requeriría decidir si se resucita/renombra `planplay_proposal_approved` o se crea otra plantilla nueva, decisión de producto no técnica. Deep link `/admin/comunity/moderacion` añadido a la whitelist (patrón literal exacto, nunca comodín). Commit `8065f02`.

**Tests totales de este bloque:** 4 (IDOR) + 6 (UI Student) + 12 (notificador+router+whitelist) = 22 nuevos, todos verdes. TypeScript 118 (baseline, cero nuevos) en los tres commits.

**Deploy:** los 3 commits verificados Online tras cada push (deployments `1ab414ab...`, y el último `547eb9c4-2bc5-44f8-9ff8-de10570c51d2`), health/ready 200, logs limpios en cada verificación.

**Resultado: DONE** (imagen de portada y notificación de aprobación quedan explícitamente BUSINESS DECISION REQUIRED, documentadas — no silenciosamente omitidas).
