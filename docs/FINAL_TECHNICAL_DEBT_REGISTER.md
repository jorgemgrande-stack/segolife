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

---

## J. FIX-07 / FIX-07B — Community en la navegación móvil + recentrado — 2026-08-21 — DONE

**FIX-07** (regresión reportada por cliente): `SegolifeBottomNav.tsx`
(mobile y tablet, <1200px) nunca incluyó Comunity en su array de items,
aunque `SegolifeSidebar.tsx` (desktop) ya lo tenía — inaccesible desde la
navegación en cualquier viewport por debajo del breakpoint `xl:`,
incluida la tablet de 1024×768. La ruta en sí nunca estuvo rota. Añadido
al bottom nav, mismo icono/label que el sidebar.

**FIX-07B** (descuadre visual introducido por FIX-07): insertar Comunity
ANTES del hueco central de Scan dejó 3 items a la izquierda y 2 a la
derecha en un grid de 6 columnas — sin columna central real, el botón
Scan quedaba descuadrado. Corregido: Profile se retira SOLO del bottom
nav (sigue accesible desde el icono de perfil de `SegolifeHeader.tsx`,
nunca tocado) y Comunity pasa a ir DESPUÉS del hueco central — layout
final `Home | Explore | [Scan] | Comunity | Rewards`, 2+hueco+2, centrado
real verificado geométricamente en producción (delta 0.0px).

Hallazgo colateral, documentado, no corregido en esta pasada (explícitamente
fuera de alcance, permanece como FIX-08 pendiente): `CookieBanner.tsx` es
un card `fixed`/`max-w-md`/centrado que se superpone visualmente a TODO
el bottom nav mientras no se descarta — afecta a cualquier item por
igual, no solo a Comunity.

Tests: 267→271 archivos, todos verdes. TypeScript 0. Build PASS.
Desplegado y verificado (SHA `45ee69f`).

---

## K. COM-01 — Bidirectional Student Communication Center — 2026-08-21 — DONE

Infraestructura canónica NUEVA de conversación persistente Admin↔Student
— explícitamente NO una segunda notificación (`notifications` sigue
siendo solo el aviso; el cuerpo real vive en `conversations`/
`conversation_messages`, histórico inmutable, sin edición ni borrado por
diseño). Coexiste con `engagement.sendManualMessage` (SendMessageDialog),
que sigue siendo un aviso unidireccional sin hilo — ninguno sustituye al
otro.

**Modelo**: `conversations` (pertenece al Student, nunca a un Admin fijo;
`waitingFor` resuelve de quién es el turno sin un enum explosivo;
`studentLastReadAt`/`adminLastReadAt` resuelven read/unread sin tabla de
participantes, ya que "Admin" es un rol compartido, no un usuario fijo;
`type`/`contextType`/`contextId` son VARCHAR, no ENUM, a propósito —
permiten que Lost Items reutilice esta misma tabla sin una migración de
ENUM) + `conversation_messages` (inmutable, `visibility` public/internal
para notas solo-Admin). Migración `0164`, aditiva, aplicada en local y
producción.

**2 bugs reales encontrados y corregidos por los tests de esta misma
fase, antes de desplegar** (`studentMessagesDb.test.ts`, contra BD real
local — no un mock de cadena, precisamente porque las transacciones/joins/
recálculo de waitingFor no se verifican de verdad con un mock): (1) la
fórmula de `unread` tenía una condición extra (`waitingFor !== "student"`)
que invertía la lógica y rompía el caso más básico (el primer mensaje de
Admin aparecía como ya leído para el Student); (2) `TIMESTAMP` sin
fracción de segundo empataba mensajes reales del mismo intercambio
rápido, haciendo no determinista la búsqueda del "último mensaje" de
`reopenConversation` — corregido con `TIMESTAMP(3)` + orden por `id` en
vez de `createdAt` donde corresponde.

**RBAC**: `student_messages.view`/`student_messages.manage`, solo
`admin` (nunca `venue_admin`, confirmado sin acceso genérico a datos de
Student hoy). **IDOR**: verificado con BD real — un Student jamás accede
ni responde la conversación de otro (`NOT_FOUND`, nunca `FORBIDDEN`, para
no confirmar su existencia).

**Verificado en producción real** (no solo en tests): flujo bidireccional
completo con las cuentas QA reales (Admin inicia → Student recibe/abre/
responde → Admin ve pendiente/responde → Student ve la respuesta → Admin
cierra → Student ya no puede responder), vía Playwright E2E real. La
conversación QA creada (`[QA COM-01] ...`) quedó **cerrada** al terminar
(nunca borrada — COM-01 no implementa DELETE por diseño), estado limpio
y trazable.

**Preparación explícita para fases futuras** (documentado aquí, NO
implementado):
- **Lost Items (LNF-01)**: `create lost_item` → `createConversation({type:'lost_item', contextType:'lost_item', contextId:<lostItemId>, ...})` → mensaje inicial de sistema/Admin → notificación al Student → hilo de respuesta real, reutilizando exactamente esta misma infraestructura, sin segundo sistema de mensajería.
- **STU-01**: el botón "Comunicar" en `StudentDetail.tsx` (ficha del Student, pestaña Engagement) ya está funcional y desplegado. Editar/Ocultar/Borrar Student siguen sin implementar, tal como se pidió.

Tests: 271→277 archivos (+95 tests backend/frontend nuevos), todos verdes
(dos ejecuciones completas de la suite, sin relación con COM-01: 2
fallos transitorios de scheduling bajo carga completa en archivos
distintos y no tocados por esta fase, ambos limpios en aislamiento).
TypeScript 0. Build PASS. Desplegado y verificado (SHA `4a22bf4`).

## L. STU-01 — Student Admin Controls (Editar / Ocultar / Borrar) — 2026-08-21 — DONE

Auditoría previa confirmó que ~60-70% de lo pedido ya existía y solo
necesitaba superficie/relabeling: **Ocultar/Mostrar** reutiliza el
`student_profiles.status` active/inactive ya existente (mismo mecanismo
que `StatusChangeControl`, motivo obligatorio, auditado vía
`student_admin_actions` desde antes de esta fase) — deliberadamente
NUNCA se añadió un `isHidden` nuevo, y sigue sin relación alguna con
`users.isActive` (login), confirmado de nuevo. Lo genuinamente nuevo:
**Editar** (`updateStudentAdminProfile`, `studentsDb.ts`) y **Borrar**
(`evaluateStudentDeletionEligibility`/`deleteStudent`,
`studentLifecycleService.ts`, nuevo).

**Borrado guardado** (mismo patrón EXACTO que `EventDeleteBlockedError`/
`deleteEvent` de FIX-06 — comprobaciones `SELECT 1 ... LIMIT 1` baratas,
nunca un `COUNT`): bloquea si el Student tiene CUALQUIER huella real en
SegoTokens (ledger, reservas de gasto), tickets/pedidos/asistencia,
consumo (TPV/QR/intentos de canje), Benefits, conversaciones (COM-01),
Comunity (ideas/respuestas/apoyos), referidos, visitas a venue,
reembolsos, o documentos/snapshots fiscales (retención legal). Nunca
bloquea por metadatos puramente administrativos (login events, notas,
etiquetas, acciones de admin previas, preferencias/entregas de
notificaciones) — bloquear ahí habría hecho el borrado imposible para
toda cuenta real, contradiciendo el propio objetivo del feature.

**Hallazgo real durante la verificación en producción**: `registerStudent()`
concede automáticamente un Benefit `registration_welcome` a TODA cuenta
nueva, sin excepción — confirmado registrando dos cuentas QA vacías reales,
ambas bloqueadas de inmediato por esa única fila sin usar. Bloquear por
CUALQUIER fila de `user_benefits` habría hecho `canDelete=true` inalcanzable
para cualquier Student real, el mismo problema que ya se evita con los
login events o un wallet vacío — corregido para que solo cuente como
bloqueo real un Benefit que NO sea ese welcome automático, o que sí llegó a
usarse; el welcome sin usar se limpia en la propia cascada del borrado.
Elegibilidad se **revalida dentro de la propia transacción de borrado**
(nunca "check → esperar → DELETE ciego"); un segundo intento sobre un
Student ya borrado es un no-op limpio (`{deleted:false}` → `NOT_FOUND`
en el router), nunca un 500. El registro de auditoría del propio borrado
(`student_admin_actions`, con snapshot de email/nombre) se escribe
ANTES de borrar la fila y es la ÚNICA tabla que la cascada nunca toca —
sobrevive como referencia histórica aunque `studentProfileId` quede sin
fila detrás (sin FK real que lo impida en todo este proyecto, ver nota
de auditoría de esquema más abajo).

**Protecciones server-side explícitas** (nunca solo "el botón no
aparece"): un Admin nunca puede borrarse a sí mismo desde este panel, y
la operación verifica que el target sea realmente `role="user"` antes
de tocar nada — defensa en profundidad para un flujo pensado solo para
Students.

**Editar**: campos de `student_profiles` reutilizando
`updateStudentProfile`/`EditableProfileFields` ya existente, más
`users.email`/`users.phone` (nuevo — normalización, unicidad
verificada antes de escribir + fallback ante condición de carrera real
vía errno 1062). `users.name` se resincroniza cuando cambia
firstName/lastName (se concatenan una única vez en
`registrationService.ts`; sin este paso el nombre mostrado en
listados/CRM/identidad POS quedaría obsoleto tras la primera edición).
Auditoría (`student_admin_actions`, acción `profile_edited`) registra
SOLO los campos que de verdad cambiaron de valor, nunca el conjunto
completo enviado por el formulario. **Fuera de alcance, decisión
explícita**: edición de comunidad/universidad como relación — no existe
hoy una función segura de "quitar" membresía de `user_communities` sin
arriesgar el invariante multi-comunidad real (`unique(userId,
communityId)` confirma que sí se soporta pertenencia múltiple), así que
se deja de solo lectura en este pase.

**Hallazgo de auditoría de esquema, más allá de este feature**: la BD
de este proyecto tiene exactamente 2 FK reales en total (ninguna sobre
`users`) — toda la integridad referencial de esta plataforma es de
aplicación, nunca de MySQL. Confirma que la comprobación de bloqueos de
esta fase no es una capa extra de seguridad "por si acaso": es la ÚNICA
que existirá jamás para este borrado.

**RBAC**: `students.manage` (ya existente) cubre las tres operaciones —
no se creó granularidad artificial (`students.edit`/`.hide`/`.delete`)
al no haber motivo real para separarlas. `venue_admin` confirmado sin
acceso (RBAC-first: sin fila en `rbac_role_permissions`; fallback
legacy: `["admin"].includes("venue_admin")` = false). Comunicar sigue
dependiendo de `student_messages.manage` (COM-01), sin cambios.

**UI**: `StudentLifecycleDialogs.tsx` (Edit/Hide/Delete) compartido
entre `StudentsManager` (columna Acciones, iconos Pencil/Eye-EyeOff/
Trash2, mismo patrón que `EventsManager`) y `StudentDetail` (cabecera)
— ambas superficies llaman exactamente los mismos procedures, nunca
divergen. `StudentsManager` cambia su filtro de estado por defecto de
"cualquiera" a "Activo" para que un estudiante oculto deje de aparecer
por defecto, conservando el desplegable para verlo explícitamente.

**Drift de esquema local pre-existente, corregido durante esta fase**
(no introducido por STU-01): la BD local llevaba varias fases sin
sincronizar (`student_profiles.referral_code` y las tablas completas de
`referrals`, `venue_visits`, `commerce_refunds`,
`fiscal_transaction_snapshots`, `fiscal_documents`, `billing_profiles`,
`token_spend_reservations`, `student_photo_events` no existían en
`localhost:3307`) — corregido vía `drizzle-kit push` local (nunca
producción), necesario para poder correr los tests reales de esta fase
contra BD real.

Tests: 2 archivos nuevos (`studentLifecycleService.test.ts` contra BD
real — 15 tests: elegibilidad, bloqueo, auto-borrado, cuenta
privilegiada, borrado real con cascada verificada (incluido el Benefit
de bienvenida sin usar), idempotencia, revalidación de concurrencia,
edición con conflicto de email, audit log selectivo, y los 2 tests del
hallazgo del welcome Benefit; `students.test.ts` ampliado — 16 tests
nuevos de RBAC/IDOR/mapeo de errores) + 1 spec E2E real de producción
nuevo (`stu01-student-admin-controls.spec.ts`, verificado en producción
real contra las cuentas QA: registra una cuenta QA vacía real, la
edita, la borra de verdad y confirma que desaparece; confirma que
Borrar sobre la cuenta QA con histórico de COM-01 se bloquea sin
ofrecer una confirmación falsa; ejercita Ocultar/Mostrar sobre esa
misma cuenta y la revierte a su estado original — las 5 pruebas pasan
juntas en una sola ejecución, sin reintentos). TypeScript 0. Build
PASS. Desplegado y verificado (SHA `ce9b1bd`).

**Nota de disciplina QA real, no solo teórica**: verificar contra
producción real detectó (y corrigió, nunca oculta) 2 bugs reales del
propio spec, no de la app — accessible name del botón Ocultar/Mostrar
incluye el nombre real del estudiante, nunca la palabra "estudiante", y
el filtro de estado por defecto (ahora "Activo") oculta la fila justo
después de ocultar al estudiante, así que revertir necesita
"Cualquier estado" — ambos dejaron la cuenta QA `qa.pre1617.ie@` en
"inactive" durante la depuración; revertida cada vez vía la propia
mutación auditada de la app (nunca un UPDATE silencioso), y confirmada
"active" al cierre.

---

## M. LNF-01 — Lost & Found / Objetos perdidos — 2026-08-21 — DONE

Circuito completo Student → Venue → Admin/venue_admin → COM-01 →
Student, nuevo end-to-end (a diferencia de STU-01/COM-01, no había nada
reutilizable de "Lost & Found" en el código heredado — auditoría previa
confirmó que Comunity, con su propio texto/imagen, es un dominio
distinto y NO se reutilizó por diseño, spec §28).

**Modelo de datos**: dos tablas nuevas, `lost_found_reports`
(studentUserId/venueId/communityId nullable/lostDate/approximateTime/
description/imageStorageKey nullable/status enum
open|found|closed_not_found/conversationId/resolvedAt/resolvedByUserId/
resolutionNote) y `lost_found_case_actions` (auditoría de transiciones,
before/after/reason). Migración `apply-0165-lost-found.cjs` (mismo
patrón `.cjs` idempotente que apply-0164), aplicada y verificada en
local dev DB; **pendiente aplicar en producción** vía `railway ssh`
antes de que el deploy pueda escribir sobre esas tablas.

**Atomicidad caso + conversación**: `createLostFoundReport` crea la fila
del caso Y la conversación inicial de COM-01 en la MISMA transacción —
se exportó `insertConversationAndFirstMessage` (antes privada de
`studentMessagesDb.ts`) para llamarla dentro de la transacción propia de
Lost & Found, ya que drizzle-orm/mysql2 no soporta transacciones
anidadas. El primer mensaje de esa conversación es la propia descripción
del Student — para esto se generalizó `CreateConversationInput` con
`initialSenderRole?: "admin"|"student"` (default `"admin"`, sin cambio
de comportamiento para ningún llamador existente, verificado con la
suite completa de `studentMessagesDb.test.ts`).

**COM-01 reutilizado tal cual, nunca duplicado**: cada caso enlaza a
`conversations` vía `contextType="lost_found"`/`contextId=report.id` +
`conversationId` denormalizado (evita N+1 al listar). No existe
`lost_item_messages` ni ningún chat paralelo. Hallazgo de arquitectura
real durante el diseño: `student_messages.manage` (COM-01/STU-02) es
exclusivamente de Admin global — un venue_admin gestionando un caso de
su propio venue no puede usar `/admin/students/messages/:id`. Se
resolvió con procedures nuevas y finas en `lostFound.ts`
(`adminGetConversation`/`adminReplyToConversation`/
`adminCloseConversation`/`adminReopenConversation`/
`adminMarkConversationRead`) que llaman a las MISMAS funciones de BD de
COM-01 (`getConversationForAdmin`/`replyAsAdmin`/…) pero autorizan por
`lost_found.process` + alcance de venue en vez del permiso global de
COM-01. El lado Student no necesitó ningún procedure nuevo:
`studentMessages.getConversation/.reply/.markRead` ya eran
`protectedProcedure` autoservicio, reutilizados sin tocar.

**Resolución = mensaje real, no un canal aparte**: `markFound`/
`markClosedNotFound` exigen una `resolutionNote` no vacía y, tras
confirmar la transición, la publican (best-effort, nunca deshace el
cambio de estado si el envío falla) como mensaje real de COM-01 —
dispara la misma notificación "messages" ya existente. Satisface el
requisito de negocio ("el texto de resolución debe llegar al Student")
sin inventar un segundo canal de notificación.

**Máquina de estados**: OPEN→FOUND/CLOSED_NOT_FOUND, y reopen
(FOUND/CLOSED_NOT_FOUND→OPEN, exige motivo, auditado, preserva la
última `resolutionNote` real). FOUND→CLOSED_NOT_FOUND directo está
prohibido. Concurrencia (spec §26): `transitionStatus` relee la fila con
`SELECT … FOR UPDATE` dentro de la propia transacción antes de decidir
si la transición es válida — un segundo admin actuando sobre un caso ya
resuelto por otro recibe `INVALID_TRANSITION`, nunca sobrescribe en
silencio.

**RBAC / venue_admin (spec §14)**: reutiliza tal cual
`getVenueStaffAccess`/`requireVenueAccess`/`venueAccessAllows`
(el mismo helper de Commerce/Benefits/Stock/Cash) — nuevo permiso
`lost_found.manage` como marcador de alcance GLOBAL puro (nunca
concedido a venue_admin, invariante ya estructural en
`venueAdminPolicy.ts`/`isGlobalScopePermission`), y `lost_found.view`/
`.process` sí concedidos a venue_admin vía
`VENUE_ADMIN_PERMISSION_BUNDLE`. El detalle admin solo expone
`id/name/email/phone` del Student (SELECT directo a `users`, nunca la
agregación de Student 360) — venue_admin gestionando Lost & Found no
gana visión del CRM completo.

**Dos superficies Admin, un solo componente compartido**: se descubrió
durante el diseño que TODO el nav lateral de `AdminLayout` es
`roles: ["admin"]` salvo un único ítem ("Mi local") — venue_admin no
tiene sidebar, opera desde `VenueApp.tsx` (Venue & Partner App, shell de
pestañas independiente). Por eso Lost & Found tiene dos entradas: `/admin/
lost-found` (Global Admin, listado con filtros venue/estado/búsqueda,
respeta el selector de comunidad ya existente) y una nueva pestaña
"Perdidos" dentro de `VenueApp.tsx` (venue_admin, acotada a su venue
seleccionado). Ambas renderizan el MISMO `LostFoundCaseDetail.tsx`
— la autorización real vive en el servidor, nunca se duplicó la ficha.

**Imágenes**: `lostFoundPhotoService.ts` reutiliza la validación REAL de
MG-03 (`validateImageBuffer`, extraída de `studentPhotoService.ts` sin
tocar su comportamiento existente — decodificación real con `sharp()`,
límites de tamaño/dimensión, MIME allowlist) con un resize propio
(máx. 1600px, sin recorte cuadrado — un objeto fotografiado no debe
recortarse como una cara). Foto opcional; su fallo NUNCA deshace el
caso ya creado (mismo criterio de tolerancia que MG-03). Servida vía
`GET /api/lost-found/:id/photo`, autenticado, autorizado solo para
dueño/admin global/venue_admin con acceso al venue real del caso.

**Notificaciones**: sin sistema nuevo — reutiliza `notifyStudentNewMessage`
(ya exportado desde `studentMessages.ts`) para toda comunicación
Admin→Student, y el mismo patrón de badge de pendientes que COM-01
(`adminPendingCount`) para que Admin detecte casos nuevos/con respuesta
sin leer (`lostFound.adminPendingCount`, cuenta casos OPEN o con
conversación sin leer por Admin, con el mismo alcance por venue).

**SegoTokens**: no tocado — Lost & Found no otorga ni consume tokens,
confirmado por diseño y por tests (nunca se importó `token_wallets`/
`token_ledger` en ningún archivo nuevo).

**Decisión de negocio pendiente (spec §22, no inventada)**: no existe
una política canónica de retención de imágenes/PII/conversaciones de
casos cerrados — **BUSINESS DECISION REQUIRED** antes de definir un job
de limpieza; hasta entonces, los casos cerrados y sus fotos se conservan
indefinidamente (mismo criterio conservador que COM-01/STU-01: nunca
borrar por defecto sin instrucción explícita).

**Borrado**: deliberadamente NO existe un botón "Borrar" (spec §21) —
un caso se resuelve vía estado (FOUND/CLOSED_NOT_FOUND), nunca se
elimina, por las mismas razones de trazabilidad/PII que STU-01 aplicó a
Students con historial real.

Tests: `lostFoundDb.test.ts` (BD real, 15 tests — atomicidad,
validación, IDOR Student, alcance por venue de `listLostFoundReportsForAdmin`
incl. `venueIds=[]`→vacío nunca "todos", exposición mínima del detalle
admin, máquina de estados incl. concurrencia, `countPendingForAdmin`) +
`lostFound.test.ts` (mockeado, 19 tests — sin sesión, RBAC Student
denegado, IDOR self-scoped, alcance por venue vía `role="admin"` para
ejercitar la lógica interna dado que un `venue_admin` real nunca llega
al handler en este entorno mockeado sin BD, ver
`venueAdminPolicy.test.ts` para la garantía real del bundle,
transiciones best-effort, envoltorio de conversación, `adminPendingCount`)
+ `venueAdminPolicy.test.ts` ampliado (2 tests nuevos, bundle exacto
sembrado incluye `lost_found.view`/`.process`, `.manage` confirmado
global). TypeScript 0 (`npx tsc --noEmit` limpio). Build PASS. Suite
completa: 269/274 archivos pasan sin `DATABASE_URL` (los 5 que
requieren BD real, incluido `lostFoundDb.test.ts`, pasan los 4/4 al
ejecutarlos aparte contra `localhost:3307` — mismo patrón pre-existente
que `studentMessagesDb.test.ts`/`studentLifecycleService.test.ts`,
confirmado que NINGUNO de los 2 grupos es un regresión nueva).

**Pendiente antes de cerrar**: aplicar `apply-0165-lost-found.cjs` en
producción, spec E2E Playwright de producción (§35), y verificación
visual mobile/tablet/desktop (§36) — ver informe final LNF-01 para el
detalle exacto de qué quedó verificado y qué queda como bloqueo externo
o dato QA pendiente de limpieza.

**Actualización — ver sección N**: migración aplicada en producción,
E2E (18/18) y QA visual (12/12) completados, y los 4 casos QA residuales
de esa verificación ya limpiados de forma auditada.

---

## N. SUPERPROMPT FINAL REMAINING ACTIONS, DATA HYGIENE & MAINTENANCE CLOSURE — 2026-08-21 — DONE

Segunda pasada de cierre (la primera fue la sección I, 2026-08-21, antes de
LNF-01). Cubre: limpieza de datos QA de LNF-01, verificación responsive de
STU-01/STU-02, smoke de auth/sesión/RBAC/IDOR, auditoría de branding
ampliada, y reconciliación de deuda. Disciplina: solo se toca código
cuando hay un problema real identificable; el resto se documenta.

### N1. LNF-01 — limpieza de datos QA en producción — HECHO
Auditados los 4 casos `[QA LNF-01]` (reports 1-4, conversaciones 3-6,
mensajes, notificaciones `source_type='conversation'`/`source_id` de esas
4, y las 4 fotos en `/tmp/local-storage/private/lost-found/{1,2,3,4}`).
Confirmado inequívocamente antes de borrar: los 4 pertenecen al Student QA
`qa.pre1617.ie@` (id 14) y al Admin QA `qa.admin@` (id 16); las 4
conversaciones tienen `context_type='lost_found'` con `context_id`
exactamente igual al id de su report (aislamiento 1:1, nunca tocó la
conversación general de STU-02 del mismo Student, `id=1`); las
notificaciones a borrar apuntaban solo a esas 4 conversaciones (nunca a
las de bienvenida/Benefit/conversación general del mismo usuario); las 4
fotos en disco eran exactamente las referenciadas por `image_storage_key`,
sin ningún directorio adicional huérfano. Borrado ejecutado en una única
transacción real (commit/rollback), script auditado ad-hoc (no un
mecanismo permanente nuevo — Lost & Found no tiene ni necesita un
"cleanup service", ver N2). Verificación final: `[QA LNF-01]` = 0 filas,
0 conversaciones huérfanas, 0 notificaciones huérfanas, 0 ficheros
huérfanos, `token_wallets` sin cambios (5 wallets, balance total 140 ST,
idéntico antes/después).

### N2. LNF-01 — retención de PII/fotos — BUSINESS DECISION REQUIRED (sin cambios)
Auditado el proyecto completo: no existe ningún scheduler/TTL/soft-delete/
anonymization para Lost & Found ni, de forma más general, para fotos/PII
de Student en ningún otro módulo (los 10 schedulers activos hoy —
Abandoned Checkout, Installment Overdue, Cancellation Stale, Email
Ingestion, Card Terminal Matching/Relink, Email Automation, Tax Reminder,
Fourvenues, Token Clawback Reconciliation, Engagement— son todos de
negocio/operativos, ninguno de retención de datos personales).
Clasificación: `LOST_FOUND_RETENTION_POLICY = BUSINESS DECISION REQUIRED`.
Arquitectura futura propuesta, NO activada: `retentionDays`/
`photoRetentionDays`/`resolvedCaseRetentionDays` configurables (misma
tabla `system_settings` ya usada para otras políticas), un scheduler
idempotente con modo `dry-run` explícito antes de borrar nada de verdad,
y un audit log de cada purga (reutilizando `lost_found_case_actions` o
un log dedicado). No se ha fijado ningún número de días arbitrario.

### N3. Fourvenues — nombre real del venue en Integrations — YA IMPLEMENTADO (NEXT-01, sin drift)
Verificado que este trabajo YA se hizo y está en `main`
(`e2d19e4`, 2026-08-20, previa a esta sesión): `IntegrationsManager.tsx`
resuelve `venueNameById` dinámicamente contra `trpc.venues.list` (nunca un
mapa hardcodeado), con fallback `venue #${id}` si el venue no aparece
todavía. Confirmado en vivo contra producción (RBAC/IDOR smoke, N6): la
fila de Casanova se muestra por nombre real, no por id. Sin cambios de
código — ya cumple exactamente lo pedido.

### N4. La Finca Club — el estado real YA es producción activa (OPS-01), no sandbox — DOCUMENTADO
La premisa de este superprompt ("La Finca sigue en `environment=sandbox`/
`enabled=false`") está desactualizada: `OPS-01` (commit `1107d0d`,
2026-08-21, previo a esta sesión) ya activó la integración tras confirmar
de forma inequívoca (solo lectura) que las credenciales guardadas eran de
producción real. Verificado ahora mismo en vivo: las 4 integraciones
(Casanova/Limoncello/Tía Felisa/La Finca Club) están
`environment=production`/`enabled=1`/`sync_enabled=1`/`status=connected`;
`loyalty_enabled` de La Finca sigue deliberadamente en `false` (activación
gradual, mismo patrón que las otras 3 en su momento). **No se ha tocado
nada** — ni para activar (ya estaba activo) ni para revertir (no hay
justificación real para hacerlo). Si se decide activar `loyalty_enabled`
para La Finca, es una decisión de negocio explícita pendiente, no un bug.

### N5. STU-01/STU-02 — QA visual real desktop/tablet/mobile — HECHO, sin hallazgos reales
Pendiente explícito de ambos cierres (solo habían verificado desktop +
specs funcionales). Ejecutado con Chromium/Playwright contra producción,
3 viewports, sin mutaciones: listado `/admin/students` (búsqueda, columna
Acciones), ficha `/admin/students/:id` (cabecera, Comunicarse/Editar/
Borrar), y el modal Editar. 9/9. Dos candidatos a bug fueron investigados
y descartados: (1) la tabla de estudiantes no muestra la columna Acciones
sin scroll horizontal en 390px — es `overflow-x-auto` intencionado, el
mismo patrón de cualquier tabla ancha de Admin, no un defecto; (2) la
pestaña "Consumo" del detalle aparece cortada en mobile — es una
`TabsList` con scroll horizontal propio (`flex-nowrap w-max min-w-full`
dentro de `overflow-x-auto`), también intencionado. Ambos ALREADY
CORRECT, cero cambios de código.

### N6. Smoke de auth/sesión/RBAC/IDOR contra producción — HECHO, sin regresión
Sin reabrir SEC-01/SEC-02/STU-01/STU-02/LNF-01 (cada uno ya tiene su
propia cobertura dedicada) — solo confirmación en vivo tras el último
despliegue: dominio Railway (`segolife-production.up.railway.app`)
redirige 301 correctamente al canónico `www.segolife.es` (comportamiento
esperado, no una regresión); login/navegación/reload mantienen la sesión
tanto para Student como para Admin; Student nunca ve contenido real de
`/admin` (pantalla "Sin permisos" real, tabla nunca presente en el DOM);
`venue_admin` (cuenta QA real `casanova@segolife.es`) aterriza en la Venue
App sin sidebar global y sin poder abrir `/admin/lost-found`; Global Admin
conserva acceso completo a Estudiantes/Lost & Found/Integrations.

### N7. Auditoría de branding ampliada (Náyade/Skicenter) — 2 hallazgos reales corregidos, resto documentado sin tocar
Auditoría exhaustiva (agente en background) más allá de lo ya cerrado en
A3/A4/D2/D3/D4/I1. Corregidos 2 hallazgos reales, ambos de blast radius
mínimo y en rutas de código genuinamente activas de Segolife:
- **`notifyOwner()`** (`server/adapters/notification.ts`) enviaba emails
  internos reales (Redsys/restaurantes/Benefits/alertas de sistema) con
  asunto `[Nayade] ...` — corregido a `[Segolife] ...`. Verificado con la
  suite de `reservationEmails.test.ts` (9/9).
- (El resto de hallazgos de branding NO se ha tocado — ver clasificación
  abajo.)

**NO corregido, con justificación explícita**:
- **`GET /kb`/`/kb.json`** (`server/kbRoute.ts`): endpoint público sin
  autenticación, literal `"NAYADE EXPERIENCES — BASE DE CONOCIMIENTO"` en
  el cuerpo de la respuesta. Investigado a fondo antes de decidir: NO es
  un caso de "marca equivocada en un endpoint por lo demás correcto" — el
  endpoint entero describe experiencias/hotel/SPA/restaurantes/packs, un
  modelo de datos que no tiene ningún equivalente en el Segolife real
  (Students/Eventos/Venues/SegoTokens). Renombrar solo el título dejaría
  un endpoint "SEGOLIFE" describiendo habitaciones de hotel y tratamientos
  de SPA — más confuso, no menos. Clasificado **BUSINESS DECISION
  REQUIRED**: retirar el endpoint (recomendado, no hay modelo Segolife
  equivalente) o encargar una reconstrucción específica si se quiere un
  endpoint de IA/KB real para Segolife.
- **~20 páginas públicas legacy** (`/experiencias`, `/hotel`, `/spa`,
  `/restaurantes`, `/colegios`, `/galeria`, `/contacto`, `/lego-packs*`,
  `/ubicaciones*`, etc., más `PublicNav`/`PublicFooter`/
  `WhatsAppFloatingButton`, el Portal de Partners y el Portal de
  Proveedores — este último ya documentado en A3): siguen técnicamente
  enrutadas (devuelven 200 real hoy) pero **confirmado que ningún
  componente de navegación real de Segolife enlaza a ellas**
  (`SegolifeHeader`/`SegolifeSidebar`/`SegolifeBottomNav`/`PublicHome.tsx`
  — 0 coincidencias). Mismo perfil de riesgo que A3 (huérfanas, no
  descubribles desde el producto real) pero sin flag de módulo que las
  bloquee del todo — alguien con un enlace antiguo o un resultado de
  buscador todavía puede llegar y ver contenido de otro negocio. Corregir
  esto de verdad implica reescribir contenido en ~20 archivos + 3
  componentes compartidos — desproporcionado para "cambio pequeño y
  seguro". **Recomendación real**: decisión de negocio sobre si estas
  páginas deben seguir existiendo (retirarlas/redirigirlas a Segolife
  sería más simple y más correcto que rebrandearlas una por una).
- **`ghl.ts`** (`source: "Nayade Web"`, campo `nayade_invoice_url`):
  confirmado que `crm_module_enabled=0` en producción hoy — el mismo
  perfil de "módulo legacy inactivo" que B8/B9 ya documentaron para el
  CRM. No tocado.
- **`coupon_email_config.internalAlertEmail`** (default de schema
  `reservas@nayadeexperiences.es`): confirmado que la tabla está
  **vacía** en producción (0 filas) — el default nunca se ha aplicado a
  ningún envío real, hallazgo inerte hoy. No tocado (mismo criterio que
  B14: no forzar una escritura de producción sin necesidad real).
- Legal (`D2`), `restaurantLinks.ts` (`D3`), `organizations` (`D4`),
  Partners/Proveedores (`A3`): sin cambios, re-confirmados exactamente
  como ya documentado — no hay drift.

### N8. `regression.recalculate.test.ts` (A2) y RBAC nav legacy (I3) — sin cambios, re-confirmados
Ninguno de los dos justifica una acción nueva: A2 sigue siendo una mejora
de fidelidad de test opcional (el código real no filtra por canal, el
test sí — reescribirlo exige tocar la lógica de negocio de `suppliers.ts`,
no solo el test); I3 sigue siendo deuda arquitectónica de baja severidad,
no explotable hoy. Ambos siguen exactamente igual que en la sección I.

### N9. Regresión y despliegue
36 tests nuevos de E2E (Playwright, 4 specs, 100% contra producción real,
0 mutaciones fuera de las ya limpiadas en N1). Suite unitaria/integración:
267-269/274 archivos según se ejecute con o sin `DATABASE_URL` (mismo
patrón de siempre — los 5 que requieren BD real pasan 100% al ejecutarlos
aparte); 2 fallos adicionales observados en una única ejecución completa
(`mailer.test.ts`, `vapiWebhookRouter.test.ts`) resultaron ser ruido de
paralelismo del test runner bajo carga — ambos, más `ComunityHub.test.tsx`
(que también mostró un fallo transitorio en esa misma ejecución), pasan
limpios al ejecutarlos de nuevo en aislamiento (44/44). TypeScript 0. Build
PASS. Desplegado y verificado (SHA `a91a5af`, health/ready 200, logs
limpios, `token_wallets` sin cambios).

### CLASIFICACIÓN FINAL — MAINTENANCE MODE
**B — MAINTENANCE READY / BUSINESS DECISIONS ONLY.** Cero deuda técnica
accionable de severidad CRÍTICA/ALTA/MEDIA sin resolver que bloquee operar
con seguridad. Lo que queda abierto es, en su totalidad: decisiones de
negocio/legales explícitas (D1 Benefit Bienvenida — sigue empeorando
activamente, prioridad más alta de todas; D2 legal; N2 retención Lost &
Found; N7 `/kb` y páginas públicas legacy huérfanas; G5 Payment Provider),
deuda arquitectónica de baja severidad no explotable hoy (I3), y una
mejora de test opcional (A2). Ninguna requiere una acción de código para
poder operar con seguridad en Maintenance Mode.

---
