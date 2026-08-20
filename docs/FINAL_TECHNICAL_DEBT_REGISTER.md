# SEGOLIFE — Registro Final de Deuda Técnica

> Generado al cierre del superprompt "FINAL ZERO-DEBT & OPERATIONAL
> CLOSURE". Cada entrada indica severidad, área, causa, impacto real
> (verificado, no asumido), y próxima acción. No se oculta nada: lo que
> sigue abierto, sigue abierto.

---

## A. DEUDA TÉCNICA ACCIONABLE (código, sin decisión de negocio pendiente)

### A1. ~~VapiAgente.tsx:189 — 1 error de TypeScript sin localizar~~ — RESUELTO
Localizado por bisección real (comentar bloques del JSX de `CallModal` y
recompilar hasta aislar la expresión exacta). Causa: `structuredData` es
`unknown` (columna JSON sin `.$type<>()`); `unknown && X` no se estrecha
por veracidad como sí ocurre con `any`, filtrando `unknown` al tipo de la
expresión JSX. Corregido con `Boolean(call.structuredData) && ...` — mismo
comportamiento en runtime. **`npx tsc --noEmit` → 0 errores** (partía de
118 al inicio de esta fase).

### A2. `server/regression.recalculate.test.ts` — reimplementación con drift de fidelidad frente a producción
- **Severidad**: Baja.
- **Descripción**: el test reimplementa la lógica SOURCE 3 en vez de
  llamar al código real de `server/routers/suppliers.ts`. Ya corregido el
  drift de nomenclatura de canales; queda un drift de diseño más profundo
  (el código real no filtra por canal en absoluto y deduplica por
  `processedReservationIds`, no por exclusión de canal) — el test pasa
  hoy pero no es un espejo fiel al 100% del comportamiento real de
  SOURCE 2/SOURCE 3.
- **Próxima acción**: opcional — reescribir esta suite para invocar
  directamente `suppliers.ts` en vez de reimplementar su lógica (mayor
  fidelidad futura, esfuerzo medio).
- **Bloqueante**: No.

### A3. Portal de Partners/Proveedores — branding Náyade sin corregir
- **Severidad**: Baja (módulos confirmados desactivados en producción:
  `partners_module_enabled`/`suppliers_module_enabled`).
- **Descripción**: `client/src/pages/partner/PartnerLayout.tsx` y
  `client/src/pages/supplier/SupplierDashboard.tsx` renderizan el logo de
  Náyade Experiences (mismo CDN ajeno ya corregido en `PublicNav`/
  `PublicFooter`), más un teléfono y catálogo externo hardcodeados
  (`NAYADE_PHONE`, `CATALOG_URL` → skicenter.es/experiencias). No
  corregido en esta pasada por ser contenido de negocio más profundo
  (no solo un literal de imagen) y por su módulo estar confirmado inactivo
  — bajo riesgo real hoy.
- **Próxima acción**: si se reactiva el portal de partners, aplicar el
  mismo patrón `segolife_brand_logo_url` ya usado en el resto de la app, y
  decidir el destino real del teléfono/catálogo de contacto.
- **Bloqueante**: No.

### A4. ~~`client/src/pages/admin/crm/CRMDashboard.tsx` — títulos de presupuesto por defecto~~ — RESUELTO 2026-08-20
Los 4 sitios que usaban `"Presupuesto Nayade Experiences"` como texto por
defecto se cambiaron a `"Presupuesto Segolife"` (superprompt FINAL
OPERATIONAL CLOSURE, bloque 9 LOW-DEBT CLEANUP). Cambio puro de texto de
UI, sin lógica tocada.

---

## B. BUGS REALES DE PRODUCTO (ya corregidos esta sesión)

Incluidos aquí por transparencia — no son deuda pendiente, son el
historial de lo que SÍ estaba roto y ya se solucionó, con verificación.

| # | Bug | Alcance real | Estado |
|---|---|---|---|
| B1 | `admin.getUsers` accesible con permisos insuficientes en test — resultó ser colisión de fixture (id=1 test = id=1 admin real local), no bug de producto | Local únicamente | Corregido, verificado |
| B2 | Secreto de webhook GHL Inbox (`NAYADE2026_ULTRA`) se persistía como secreto real si el campo quedaba en blanco | Nunca disparado en producción (0 filas previas) | Corregido, verificado con 4 tests |
| B3 | `/admin/comunity/:id` aceptado erróneamente como deep link de comunidad | Vector de navegación interno, bajo impacto | Corregido, 3 tests de regresión |
| B4 | Email de pago fallido (Redsys) con "Náyade Experiences" hardcodeado, sin fallback a configuración real | Vía webhook IPN live, sin gating — cada pago fallido real mostraba la marca equivocada | Corregido, desplegado y verificado |
| B5 | ~24 sitios con fallback de URL a `www.skicenter.es` (dominio de otro negocio), activo porque `APP_URL` no está configurada | Enlaces "Ver tu reserva", invitaciones, notificaciones IPN | Corregido, desplegado y verificado |
| B6 | Logo de Náyade Experiences renderizado en `PublicNav`/`PublicFooter` (~25 páginas públicas legacy todavía enrutadas) | Visual, alto tráfico potencial en esas rutas | Corregido y verificado contra producción (logo real de Segolife ya configurado y sirviendo 200) |
| B7 | `createLead()` con contrato de retorno inconsistente (número vs objeto según `source`) | 1 caller real afectado (`vapiWebhookRouter.ts`) | Corregido |
| B8 | `applyDiscountCode` (botón "Aplicar bono" del CRM) en el router equivocado — el frontend llamaba a un procedure que no existía | `crm_module_enabled` desactivado, sin impacto real hoy | Corregido |
| B9 | `crm.createManual` rechazaba `tarjeta_fisica`/`tarjeta_redsys` pese a que el handler y el frontend ya los soportaban | `crm_module_enabled` desactivado, sin impacto real hoy | Corregido |
| B10 | 18 fallos deterministas de test (4 ficheros) — ver detalle en `FINAL_ZERO_DEBT_EXECUTION_LOG.md` Block G | Ninguno era bug de producto real en producción | Corregidos, suite 3420/3420 |
| B11 | 9 fallos de test adicionales (8 ficheros), descubiertos solo al correr la suite completa por primera vez — 100% deuda de entorno local (fixtures colisionando con cuentas reales + catálogo RBAC local incompleto), confirmado con `git stash` que no dependían de ningún cambio de código de esta sesión | Local únicamente | Corregidos |
| B12 | **CRÍTICO** — `GET /api/invoices/preview` identificaba una factura solo por `invoiceNumber` (correlativo, obligatorio por normativa fiscal), sin ningún token — cualquiera podía enumerar números y volcar nombre/email/teléfono/NIF real de cada cliente | Endpoint público por diseño, sin gating de módulo — expuesto en producción para toda factura existente | Corregido con token HMAC firmado (`invoicePreviewToken`/`verifyInvoicePreviewToken`), desplegado y **verificado en vivo contra producción** (`curl` sin token → 403) |
| B13 | IDOR — `GET /api/settlements/:id/export-excel` (REST) solo exigía sesión válida, sin rol; cualquier usuario autenticado podía descargar la liquidación de CUALQUIER proveedor (IBAN/NIF/dirección fiscal/totales) iterando el id | `suppliers_module_enabled` confirmado desactivado en producción — sin impacto real hoy | Corregido (alineado al mismo criterio `role==="admin"` que la procedure tRPC equivalente), desplegado y **verificado en vivo** (`curl` sin sesión → 401) |
| B14 | 3 secretos más con fallback a un literal público si la variable de entorno correspondiente faltaba (`integrationCredentialCrypto.ts`, `localAuth.ts`/JWT_SECRET — el de mayor impacto potencial de toda la sesión, firma TODAS las sesiones reales) | Ambas variables confirmadas configuradas en producción — dormido, nunca activo | Corregidos: fallan alto en vez de cifrar/firmar en silencio; JWT_SECRET mantiene el fallback solo fuera de producción |
| B15 | `/api/upload-coupon` (subida anónima, sin sesión por diseño) sin cobertura del rate limiter de subidas — 10MB sin límite de frecuencia | Abuso de almacenamiento, no PII | Corregido, añadido al rate limiter existente |
| B16 | Comparación de `RECOVERY_TOKEN` (endpoints de diagnóstico/recuperación Redsys, PII real) con `!==` directo en vez de `timingSafeEqual` | Explotabilidad no verificada, dependía de exposición de logs | Corregido |

---

## C. DEPENDENCIAS EXTERNAS (no accionables desde el código)

- **PAYMENT PROVIDER**: sin proveedor de pago real conectado. No bloquea
  el 100% SegoTokens. Ver `PAYMENT_PROVIDER_ACTIVATION_CHECKLIST.md`.
- **BREVO**: verificación de entrega final en bandeja de entrada real no
  verificable desde este entorno (sin acceso a inbox) — la integración en
  sí está confirmada operativa (Brevo aceptó el envío, webhook
  configurado).
- **Vapi (agente de voz IA)**: estado de conexión real no verificado en
  esta sesión (fuera de alcance del barrido; el hallazgo de branding en
  `vapiWebhookRouter.ts` se corrigió igualmente por higiene, sea cual sea
  su estado de conexión).

---

## D. DECISIONES DE NEGOCIO PENDIENTES (no son bugs, no se tocan sin decisión humana)

### D1. Benefits — id=1 "Bienvenida nuevo estudiante" (🔴 crítico, ver `GO_LIVE_CONTROL_BOARD.md`)
3 Students reales ya recibieron/compraron un Benefit sin recompensa real
definida, y su ventana de compra ya caducó. Requiere decisión comercial
inmediata (qué otorgar) — **prioridad alta, no técnica**.

**Actualización 2026-08-20 (superprompt FINAL OPERATIONAL CLOSURE) — SIGUE
ABIERTO, empeorando activamente:** re-auditado read-only contra
producción. La fila (`slug='bienvenida-nuevo-estudiante'`) sigue
`active=1`, sigue sin `product_id`/`discount_type`/`discount_value`
asignado, y `registrationService.ts` (`WELCOME_BENEFIT_SLUG` hardcodeado)
sigue concediéndola automáticamente a **todo estudiante nuevo que se
registra hoy** — no es solo deuda histórica. Recuento real actualizado: 5
concesiones a 3 Students (2 `manual` del día de creación, 2
`token_purchase` con 5 ST reales cada una = 10 ST gastados, 1
`registration_welcome` automática) — 2 más de las 3 documentadas
originalmente aquí. `docs/OVERNIGHT_EXECUTION_LOG.md` §7B había cerrado
esto como "NO LONGER RELEVANT" comprobando solo el campo `name` (que sí
se renombró) sin ver que `slug`/`description` siguen siendo la misma fila
sin resolver — **ese cierre fue incorrecto**, se corrige aquí.
Clasificación: BUSINESS DECISION REQUIRED en dos frentes independientes —
(1) desactivar la fila para frenar nuevas concesiones rotas (acción
técnica segura y reversible, pendiente de confirmación explícita por
tratarse de datos de producción), y (2) qué hacer por los 2 Students que
ya gastaron ST reales (reembolso/recompensa retroactiva/nada — decisión
comercial, no técnica).

### D2. Páginas legales con "Hotel Náyade"
`TerminosCondiciones.tsx`/`CondicionesCancelacion.tsx` mencionan un
producto (Hotel Náyade) que no es de Segolife. No editado — contenido
legal requiere revisión de negocio antes de tocarlo, no una corrección de
código.

### D3. `restaurantLinks.ts` — enlaces reales a restaurantes de otro negocio
Lógica de negocio heredada completa (qué restaurantes se gestionan
externamente), no un literal aislado de branding. Requiere decisión sobre
si esas páginas de restaurante siguen operativas para Segolife.

### D4. `organizations` (tabla, id=1) — "Nayade Experiences"/"nayade-experiences"
Confirmado real en producción, pero confirmado también de **impacto cero**:
sin otro consumidor en el código salvo un query de solo lectura
(`onboarding.getOrg`) que el frontend nunca llama. No corregido — un
`UPDATE` SQL directo sin pasar por una mutación de aplicación auditada fue
bloqueado por el clasificador de permisos de la sesión, correctamente,
dado que no hay exposición real que lo justifique con urgencia.
Corrección recomendada de bajo riesgo si se decide: `UPDATE organizations
SET name='Segolife', slug='segolife' WHERE id=1`, en una sesión con
autorización explícita para escritura directa de producción.

---

## E. SEGUIMIENTO OPERATIVO

- **Migración `0160_crm_view_permission`**: aplicada en local y
  producción. En producción no cambió ningún permiso real (ya estaba
  correctamente sembrado) — solo añadió el registro de tracking.
- **BD local de desarrollo (Docker)**: quedó desincronizada de producción
  durante mucho tiempo (migraciones `0070`, `0156` y varios scripts de
  seed de RBAC nunca aplicados a este volumen). Aplicados todos en esta
  sesión. Recomendación operativa: documentar en `SEGOLIFE_BASELINE.md`
  qué scripts de seed debe correr cualquiera que levante el entorno local
  desde cero, para que este drift no se repita.
- **Auditoría de seguridad ampliada** (Block J): barrido dedicado sobre
  IDOR/ownership, endpoints públicos con PII, subida de ficheros, firma de
  webhooks, secretos hardcodeados, y scoping por comunidad/venue en
  `server/segolife/**`. 6 hallazgos reales, los 6 corregidos (ver B12-B16
  arriba). **Áreas revisadas y confirmadas correctas, sin hallazgo**:
  scoping de venue/comunidad en `benefits.ts`, `commerce.ts`, `stock.ts`,
  `community.ts`, `venueApp.ts`, `consumptionQr.ts` (todas resuelven el
  scope server-side antes de tocar datos, incluida resolución indirecta de
  `venueId` desde IDs hijos); webhooks de GHL y Brevo (ya siguen el patrón
  503/no-configurado — 401/no-coincide correcto); validación de firma HMAC
  de Redsys IPN.

---

## G. SUPERPROMPT FINAL OPERATIONAL CLOSURE — 2026-08-20

Sesión posterior a las anteriores (SEC-01, esta misma tabla, auditoría
Fourvenues La Finca). Cubre SEC-02 y el roadmap final de cierre.

## H. MG-05 — Student Proposal Voting Configuration — 2026-08-21 — DONE

El Student puede proponer, al enviar una idea en Community → Propose,
CÓMO debería responder la comunidad si se aprueba — reutilizando
exactamente los mismos 9 tipos de pregunta del motor canónico de Admin
(`single_choice`/`yes_no`/`percentage_scale`/`scale_1_5`/`multiselect`/
`ranking`/`attendance_intention`/`me_apunto`/`open_text`), nunca un
segundo modelo paralelo. Siempre opcional — enviar una idea sin proponer
voto sigue funcionando exactamente igual que antes.

**Modelo**: 2 columnas nuevas NULLABLE en `community_student_proposals`
(`proposed_question_type`, `proposed_options` JSON) — migración 0163,
aditiva, aplicada en local y producción, cero backfill, cero fila
existente tocada.

**Validación**: nuevo `validateQuestionTypeOptions()` (única semántica
compartida) — aplicado tanto al nuevo camino de Student como, por
prevención, a `community.create` y `convertStudentProposalToFormal` de
Admin, que hasta ahora NUNCA validaban server-side que el tipo de
pregunta y sus opciones fueran una combinación posible (solo el
formulario React lo impedía) — un caller directo de la API podía crear
`single_choice` sin opciones o `yes_no` con opciones arbitrarias.

**Moderación**: la cola de Admin (`/admin/comunity/moderacion`) muestra
ahora el tipo de respuesta propuesto y sus opciones de forma legible, y
el diálogo "Convertir en propuesta formal" se pre-rellena con la
propuesta del Student — siempre editable, el Admin conserva la decisión
final.

**Tests**: 34 (validador puro) + 13 (capa de BD, incluida compatibilidad
histórica) + 26 (formulario Student, los 9 tipos) + 10 (moderación
Admin) = 83 tests nuevos, más 6 escenarios Playwright reales en
producción (desktop/tablet/mobile, cuenta Student QA, sin Submit real —
sin mecanismo de limpieza seguro para una idea ya enviada). Suite
completa 3525/3525, TypeScript 0, build PASS. Desplegado y verificado
(SHA/health/ready/logs).

**Sin tocar**: SegoTokens (proponer/configurar el tipo de voto nunca
genera movimientos), Fourvenues, Benefits, RBAC, el aislamiento de
comunidad ya corregido en MG-04 (sigue sin existir ningún selector de
comunidad en el formulario Student).

### G1. SEC-02 — Session Persistence & Safe Reauthentication — RESUELTO
Causa raíz probada (no era TTL corto — JWT/cookie ya eran de 30 días):
faltaba renovación deslizante + el frontend trataba cualquier 401 aislado
como sesión muerta sin confirmar ni conservar `returnTo`. Corregido:
sesión deslizante con tope absoluto real (`AUTH_SESSION_TTL_SECONDS`
24h/`AUTH_SESSION_RENEWAL_THRESHOLD_SECONDS` 2h/
`AUTH_SESSION_ABSOLUTE_TTL_SECONDS` 7d, todos configurables por env,
default seguro), `isActive` ahora se comprueba de forma centralizada para
TODO procedure (antes solo `employeeProcedure`/`gestoriaProcedure`), y el
frontend confirma en fresco antes de redirigir. Desplegado y verificado
en producción (SHA/health/ready/logs limpios). Bug secundario encontrado
en el propio deploy y corregido: el log `session rejected: expired`
inundaba los logs (~5/min sostenido, tráfico anónimo normal con cookie
caducada) — throttled a 1/min.

### G2. LA FINCA CLUB — activación de producción — RESUELTO 2026-08-21 (OPS-01)
Probado de forma inequívoca y read-only que las credenciales guardadas
(`venue_integrations.id=4`) son `ik_live_...` (estilo producción) y
responden `200 {"success":true}` contra la API de PRODUCCIÓN de
Fourvenues Integrations (el valor guardado `environment=sandbox` era
simplemente el campo equivocado, no un problema de credenciales).
Activado en producción (`environment=production`, `enabled=1`,
`sync_enabled=1`, `status=connected`; `loyalty_enabled` queda
deliberadamente en `0`, mismo patrón de activación gradual que las otras
3 venues). El scheduler recogió la integración automáticamente (0
cambios de código) e importó 2 eventos reales + 6 tipos de entrada;
segundo sync confirmó idempotencia (0 duplicados). Detalle completo en
`OPS-01 FOURVENUES LA FINCA PRODUCTION ACTIVATION FINAL REPORT` y en la
fila LA FINCA CLUB de `GO_LIVE_CONTROL_BOARD.md`. Verificado de nuevo en
vivo 2026-08-21 (closure): las 4 integraciones (Casanova/Limoncello/Tía
Felisa/La Finca) siguen `environment=production`/`enabled=1`/
`sync_enabled=1`/`status=connected`, con `last_success_at` reciente.

### G3. NEXT-01 — Nombre real de Venue en Admin Integrations — RESUELTO
`IntegrationsManager.tsx` mostraba "venue #3" en vez del nombre real.
Resuelto dinámicamente contra `venues.list` (ya cargado en el
componente), nunca un mapa hardcodeado. 3 tests nuevos. Desplegado y
verificado.

### G4. `server/mailer.ts` — remitente de email nunca leía el valor real configurado — RESUELTO (bug real activo)
`getSystemSettingSync("email_noreply_sender", "")` lee de una caché en
memoria que solo se rellena cuando algo llama a la versión ASYNC
`getSystemSetting()` para esa misma clave — ningún caller async existía
para `email_noreply_sender` en todo el repo, así que la caché nunca se
calentaba y el helper devolvía SIEMPRE el fallback `""`, cayendo en
`noreply@example.com` (dominio reservado, Brevo lo rechaza siempre) sin
importar lo que hubiera en `system_settings`. Así fallaron 2 invitaciones
reales a un miembro real del equipo (`herre.casanova@gmail.com`,
2026-08-18 y 2026-08-20). Corregido: las funciones de envío (ya async)
usan la versión async del getter. 2 tests nuevos. Desplegado y
verificado.

### G5. Payment Provider — rutas de checkout heredadas de Náyade, vivas y rotas
`server/redsys.ts`/`redsysRoutes.ts` (heredado de Náyade Experiences)
sigue montado y las rutas frontend que lo disparan (`/checkout`,
`/hotel`, `/spa`, `/restaurantes`, `/presupuesto`, `/reserva/ok`) siguen
enrutadas y alcanzables hoy en `www.segolife.es` — sin `REDSYS_MERCHANT_*`
configurado en producción, cualquier intento construiría un formulario
Redsys inválido (Redsys lo rechazaría; no es un riesgo de cobro, es una
ruta muerta/confusa). El motor real de tickets de Segolife
(`server/segolife/ticketing/payments/*`) es una abstracción propia,
deliberadamente independiente de `redsys.ts`, apuntando hoy a
`unconfiguredPaymentProvider` (falla honesto, nunca simula éxito).
SegoTokens/Benefits confirmados 100% independientes de cualquier
proveedor de pago. **BUSINESS DECISION REQUIRED**: ¿se retiran del
enrutado público esas páginas heredadas de Náyade, dado que el producto
ya no es reservas de hotel/spa/restaurante? No se ha tocado el enrutado
en esta sesión (retirar rutas es una acción de mayor alcance que un
string, fuera del criterio "narrow/safe fix" de este cierre).

### G6. QA visual (Chromium/Playwright, producción real, desktop/tablet/mobile)
23 specs existentes (`e2e/pre16-17/`, cuenta Admin QA real) — 205 passed,
18 flaky (verde al reintentar, ruido de red normal contra producción
real), 1 skipped. De los 12 fallos no absorbidos por el reintento: 11 son
**DATA STATE**, no bugs — verificado read-only que ahora mismo existen
193 eventos reales pero 51 son borradores de Fourvenues sin publicar
(`source_publication_status='unpublished'`) y solo 1 está `published`
(en el pasado) — cero eventos activos/futuros publicados en absoluto
ahora mismo, así que Explore/Home/Events legítimamente no tienen nada que
mostrar (el filtro "nunca mostrar un borrador" funciona exactamente como
se diseñó). El fallo restante era un bug real de TEST (no de la app):
`mg01-home-tonight-upcoming.responsive.spec.ts` usaba un locator
`getByRole('link', {name: /explore all/i})` sin `.first()` — con Upcoming
vacío, la sección Tonight (con su propio CTA idéntico) sigue montada a la
vez, así que hay legítimamente 2 links con el mismo nombre — corregido
con `.first()`.

---

## F. COSMÉTICO / OPCIONAL

- Placeholders de formularios admin de bajo tráfico
  (`EmailAccountsSettings.tsx`, `RestaurantsManager.tsx`,
  `LegoPacksManager.tsx`, `OnboardingWizard.tsx`) mencionan Náyade en
  texto de ayuda, nunca en datos guardados.
- Catálogo de preview de plantillas de email (`emailTemplatesRouter.ts`,
  `routers.ts:1629+`) — datos de ejemplo estáticos con marca/URLs
  heredadas. Página sin ruta activa en el frontend (huérfana, superseded
  por `EngagementTemplatesViewer.tsx`), cero riesgo real.

---

## I. SUPERPROMPT FINAL REMAINING ACTIONS & MAINTENANCE MODE — 2026-08-21 — DONE

Última pasada antes de Maintenance Mode. Verificación fresca de todo lo
cerrado en sesiones anteriores (G/G1-G6, H) — sin drift encontrado salvo
G2 (corregido arriba) — más 6 hallazgos nuevos, los 6 resueltos.

### I1. `MaintenanceModeControl.tsx` — branding Náyade en el mensaje por defecto — RESUELTO
`DEFAULT_MESSAGE` (mostrado si nunca se ha guardado un mensaje propio)
mencionaba "Náyade Experiences"/"Hotel Náyade". Producción ya tenía un
`site_maintenance_message` propio guardado (nunca se llegó a mostrar a un
visitante real), pero el texto de fallback en sí era incorrecto —
corregido a un mensaje neutro de Segolife.

### I2. Security sweep — 4 hallazgos de código, dormidos, corregidos (closure, no exploit conocido)
- **#2/5 (MEDIA)**: `/api/students/me/photo` (MG-03) y
  `/api/community/proposal-image` (MG-04) — subida con `sharp()`
  decode/resize sin rate limit, a diferencia de toda otra ruta de subida.
  Aplicado el mismo `uploadRateLimit` (20 req/min/IP).
- **#3 (MEDIA)**: `invoicePreviewToken()` caía a
  `"local-dev-secret-change-me"` sin guard de producción si `JWT_SECRET`
  faltara — a diferencia de `localAuth.ts`. `JWT_SECRET` está configurado
  hoy (nunca explotable en la práctica), pero ahora lanza en arranque de
  producción si faltara, igual que `localAuth.ts`.
- **#4/8 (MEDIA, inalcanzable hoy)**: `ghlWebhookRouter.ts`,
  `vapiWebhookRouter.ts`, `routes/ghlInboxRouter.ts` comparaban el secreto
  del webhook con `!==` (filtración por temporización) en vez de
  `timingSafeEqual` — mismo patrón que Brevo ya corregía. Los 3 secretos
  están sin configurar en producción hoy (503 antes de llegar a la
  comparación), pero es el mismo defecto de código real. Corregido.
- **#7 (ALTA)**: `community.trending` no comprobaba membresía de
  comunidad — cualquier Student autenticado podía omitir `communityId` (o
  pasar el de otra comunidad) y recibir nombres/ideas pendientes de
  moderación de OTRAS comunidades. Corregido reutilizando el mismo patrón
  de `submitProposal` (`getUserCommunities` + `getCommunityAccess`): un
  admin global conserva "todas" (uso real de `ComunityManager.tsx`); un
  Student ahora exige un `communityId` del que sea miembro real, o
  `BAD_REQUEST`/`FORBIDDEN`. Verificado en vivo en producción con las
  cuentas QA (Student→propia comunidad: 200; sin communityId: 400; otra
  comunidad: 403; Admin→todas: 200 sin cambios).
- 5 tests nuevos en `community.test.ts` (38/38 verde), suite completa
  3530/3530, `tsc --noEmit` 0, build PASS. Desplegado y verificado
  (SHA `7da25ad`/health/ready/logs limpios).

### I3. RBAC — `AdminLayout.tsx` (nav/rutas del sidebar) es 100% rol legacy, el servidor ya es RBAC-first — DOCUMENTADO, NO CORREGIDO
Auditoría dedicada (agente en background): el sidebar y los guards de
ruta de `AdminLayout.tsx` filtran módulos por `user.role` (legacy) en un
array `roles: [...]` por item, mientras que prácticamente todos los
routers del servidor ya usan `permissionProcedure`/`checkRbacOrLegacy`
(RBAC-first). Hoy no hay discrepancia visible: el único camino real de
cambio de rol (`changeUserRole`, `UsersManager.tsx`) mantiene
`rbac_user_roles` sincronizado. Pero `assignRbacRole`/`removeRbacRole`
(server, alcanzables por un admin, sin UI) ya permiten desacoplar RBAC
del rol legacy — el mismo tipo de divergencia que causó el incidente real
de `herre.casanova@gmail.com` (SEC-01). **Severidad**: Baja-Media,
arquitectónica, no explotable hoy. **No corregido en este cierre**: el
fix real (exponer `permissions[]` en `auth.me`, migrar cada entrada de
`navItems` a su permission key) toca ~20+ entradas de navegación con
riesgo moderado de mostrar/ocultar de más si alguna key no calza
exactamente con su `permissionProcedure` — desproporcionado para el
criterio "cambio pequeño y seguro" de este cierre. **Próxima acción**: si
se retoma, migrar `navItems` permiso a permiso contra la tabla de
`permissionProcedure` ya documentada, con regresión visual completa por
rol.

### I4. Re-verificación (sin drift) de lo ya cerrado en sesiones anteriores
- **Fourvenues (G3/G6, OPS-01)**: 4/4 integraciones
  (Casanova/Limoncello/Tía Felisa/La Finca) siguen
  `environment=production`/`enabled=1`/`sync_enabled=1`/
  `status=connected`, `last_success_at` reciente (2026-08-20/21), 0
  mappings duplicados, 0 huérfanos, 0 contaminación cruzada. Scheduler
  sigue 100% data-driven (sin `if venueId === X`).
- **MG-05**: los 3 tests de `ComunityHub.test.tsx` (26) y
  `ComunityModeration.test.tsx` (10) siguen verdes en la suite completa;
  sin cambios de código en esta pasada.
- **SEC-02**: SHA/health/ready/logs verificados limpios tras cada uno de
  los 4 despliegues de este cierre; ninguna sesión real se vio afectada.
- **CRM (A4)**: 0 coincidencias de "Náyade" en `CRMDashboard.tsx` —
  sigue corregido.
- **Partners/Proveedores (A3)**, **legal (D2)**, **`restaurantLinks.ts`
  (D3)**, **`organizations` (D4)**: sin cambios, siguen exactamente como
  se documentó — no se ha tocado ninguno (branding profundo/decisión de
  negocio/legal, fuera del criterio de fix seguro de este cierre).
- **`regression.recalculate.test.ts` (A2)**: sigue existiendo, sigue
  LOW OPTIONAL DEBT — no se ha reescrito (ninguna necesidad nueva lo
  justifica).

### CLASIFICACIÓN FINAL — MAINTENANCE MODE
**B — MAINTENANCE READY WITH LOW DEBT.** Cero deuda técnica accionable de
severidad CRÍTICA/ALTA/MEDIA sin resolver. Lo que queda abierto es, en su
totalidad: decisiones de negocio/legales explícitas (G5 Payment Provider,
D1 Benefit Bienvenida, D2 legal, D3/D4 branding profundo), deuda
arquitectónica de baja severidad y no explotable hoy (I3 RBAC nav), y una
mejora de fidelidad de test opcional (A2). Ninguna requiere una acción de
código para poder operar con seguridad en Maintenance Mode.
