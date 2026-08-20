# SEGOLIFE — Registro Final de Deuda Técnica

> Generado al cierre del superprompt "FINAL ZERO-DEBT & OPERATIONAL
> CLOSURE". Cada entrada indica severidad, área, causa, impacto real
> (verificado, no asumido), y próxima acción. No se oculta nada: lo que
> sigue abierto, sigue abierto.

---

## A. DEUDA TÉCNICA ACCIONABLE (código, sin decisión de negocio pendiente)

### A1. VapiAgente.tsx:189 — 1 error de TypeScript sin localizar
- **Severidad**: Baja (cero impacto en runtime, el componente funciona).
- **Descripción**: TS2322 "unknown no asignable a ReactNode". El
  diagnóstico apunta a un comentario JSX vacío, que no puede producir el
  error — confirmado con 4 métodos de lectura distintos. 2 hipótesis
  descartadas mediante fix dirigido + recompilación (no cambiaron el
  conteo).
- **Próxima acción**: sesión de bisección manual (comentar bloques del
  JSX de `CallModal` y recompilar hasta aislar la expresión exacta).
- **Bloqueante**: No.

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

### A4. `client/src/pages/admin/crm/CRMDashboard.tsx` — títulos de presupuesto por defecto
- **Severidad**: Cosmética.
- **Descripción**: 4 sitios usan `"Presupuesto Nayade Experiences"` como
  texto por defecto en campos editables del formulario de creación de
  presupuesto. Admin-only, editable antes de guardar, detrás de
  `crm_module_enabled` desactivado.
- **Próxima acción**: cambio trivial de 4 strings si se reactiva el CRM.
- **Bloqueante**: No.

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

## F. COSMÉTICO / OPCIONAL

- Placeholders de formularios admin de bajo tráfico
  (`EmailAccountsSettings.tsx`, `RestaurantsManager.tsx`,
  `LegoPacksManager.tsx`, `OnboardingWizard.tsx`) mencionan Náyade en
  texto de ayuda, nunca en datos guardados.
- Catálogo de preview de plantillas de email (`emailTemplatesRouter.ts`,
  `routers.ts:1629+`) — datos de ejemplo estáticos con marca/URLs
  heredadas. Página sin ruta activa en el frontend (huérfana, superseded
  por `EngagementTemplatesViewer.tsx`), cero riesgo real.
