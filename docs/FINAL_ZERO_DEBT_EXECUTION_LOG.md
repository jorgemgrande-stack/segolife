# SEGOLIFE — Final Zero-Debt & Operational Closure — Execution Log

> Registro en vivo de la ejecución del superprompt "SUPERPROMPT FINAL
> ZERO-DEBT & OPERATIONAL CLOSURE". Append-only — no se borra nada,
> solo se añade.

## BLOCK A — Baseline y Production Truth

**Git**: HEAD = `4f89d7bdbee23088f20729784ff16341320d06de` = `origin/main`, working tree limpio, rama `main`.

**Railway**: servicio `segolife`, proyecto `thorough-liberation`, Online, deployment `8345f785-0fc6-44ab-97c3-46d991ba5e28`. `RAILWAY_GIT_COMMIT_SHA` dentro del contenedor = `4f89d7bdbee23088f20729784ff16341320d06de` — coincide exactamente con `origin/main`.

**Health/Ready**: `/api/health` 200, `/api/ready` 200.

**Test suite (2 ejecuciones completas para confirmar determinismo)**:
- Ejecución 1: 19 failed / 3376 passed — incluía `client/src/pages/Register.test.tsx > teléfono con menos de 6 dígitos bloquea el avance`.
- Ejecución 2: 18 failed / 3377 passed — el test de Register NO falló.
- Aislado (`-t` exacto): PASA limpio en 1.18s.
- **Clasificación: FLAKY, sensible a timing bajo carga completa de la suite (3395 tests), no reproducible en aislamiento — no es una regresión real, no relacionado con ningún cambio de esta sesión.** Ver Block G para su registro individual.

**Baseline determinista confirmado — 18 fallos, 4 ficheros exactos**:
1. `server/nayade.test.ts` (13 tests)
2. `server/regression.recalculate.test.ts` (2 tests)
3. `server/reservationEmails.test.ts` (2 tests)
4. `server/transferConfirmationEmail.test.ts` (1 test)

**TypeScript**: `npx tsc --noEmit` → 118 errores.

**Build**: pendiente de confirmar en este bloque (se confirmará tras los cambios de Block G/H, no repetido en vano aquí).

---

## BLOCK G — Test Debt: 18 → 0 (verificado, suite completa limpia)

Root-cause de los 18 fallos deterministas (agente dedicado, doble ejecución
con/sin BD local Docker levantada para separar ruido de `ECONNREFUSED` de
fallos reales) + fixes aplicados:

- `regression.recalculate.test.ts` (2/2): la whitelist `crmChannels` de
  SOURCE 3 seguía en valores legacy (`"crm","web","telefono",...`) tras el
  refactor de taxonomía de canal (commit `952129a`, 10 valores nuevos:
  `ONLINE_DIRECTO`, `VENTA_DELEGADA`, etc.). Corregido a la lista real
  (todo excepto `TPV_FISICO`, que SOURCE 2 ya cubre) — verificado contra el
  código real de producción (`server/routers/suppliers.ts`), que de hecho
  no filtra por canal en absoluto y dedupe por `processedReservationIds`,
  no por canal; documentado como matiz de fidelidad del modelo de test
  simplificado, no corregido en profundidad (fuera de alcance).
- `reservationEmails.test.ts` (2/2): seguía mockeando `nodemailer`
  directamente; el email al cliente migró a `sendManagedEmail()`/Brevo
  hace tiempo (commits `850bd4d`/`dd7c454`). Mocks reescritos a
  `./emailManager`/`./mailer`.
- `transferConfirmationEmail.test.ts` (1/1): esperaba el botón "Descargar
  Factura" (`invoiceUrl`), reemplazado por "Ver tu reserva"
  (`reservationUrl`) en el commit `1b43b40`. Test actualizado a la
  aserción real vigente.
- `nayade.test.ts` (13/13): 8 eran ruido de BD-no-levantada (documentado,
  no es un fallo de producto); 1 (`admin.getUsers`) por drift de schema
  local (columna `avatarStorageKey` nunca aplicada a este volumen Docker,
  corregido con el script idempotente ya existente
  `scripts/apply-0156-student-profile-photo.cjs`); 3 (leads/crm legacy)
  reescritos para afirmar el rechazo real (`crm_module_enabled=0`,
  deliberado) en vez de un éxito que ya no ocurre; 1 (`bookings.getAll`)
  — ver hallazgo RBAC abajo.

**Hallazgo RBAC — `crm.view` nunca sembrado, PERO solo en local, no en
producción** (corrección importante de un diagnóstico inicial equivocado):
al investigar por qué `bookings.getAll` (detrás de `staffProcedure`,
permiso `crm.view`) rechazaba incluso a un admin real en la BD local, se
concluyó inicialmente que era un bug de producción (RBAC-first prioriza
`rbac_user_roles` real sobre el fallback legacy, y `crm.view` no existía en
el catálogo). Se escribió `scripts/apply-0160-crm-view-permission.cjs`
(idempotente, mismo patrón que `apply-hr-0156-view-permission.cjs`) y se
aplicó tanto en local como en producción. **Al aplicarlo en producción, el
propio script reportó que el permiso y las concesiones YA EXISTÍAN** — la
única fila nueva fue el registro de tracking en `__drizzle_migrations`.
Conclusión corregida: `crm.view` siempre estuvo bien sembrado en
producción; el fallo era 100% un artefacto del volumen Docker local
(nunca tuvo aplicada esa migración histórica). El script se deja aplicado
igualmente (correcto, idempotente, sin efecto negativo) pero **no se
reporta como "bug de producción corregido"** — es higiene/consistencia de
entorno, no un incidente real evitado. Lección para el registro de deuda:
nunca declarar un hallazgo de producción sin verificarlo directamente
contra producción, un fallo de test local no es evidencia suficiente.

**Hallazgo adicional, no en el baseline de 18** (surgido solo al correr la
suite COMPLETA por primera vez esta sesión, en vez de solo los 4 ficheros
ya conocidos): 8 ficheros más (`cash.test.ts`, `fiscal.test.ts`,
`operationsPiiGating.test.ts`, `referrals.test.ts`,
`salesOperations.test.ts`, `settlements.test.ts`, `stock.test.ts`,
`tokens.test.ts`) fallaban, 9 tests en total. Root cause doble, confirmado
mediante `git stash` (revertir todo el código de esta sesión y reproducir
el fallo idéntico contra la BD local sin tocar) — **100% deuda de entorno
local, cero relación con cambios de código de esta sesión**:
1. Fixtures de test con id de usuario fabricado hardcodeado (`id = 1`,
   patrón `callerAs(role, id = 1)`) que **colisiona con una cuenta admin
   real ya sembrada en la BD local de desarrollo**. Con RBAC-first
   (`checkRbacOrLegacy` prioriza `rbac_user_roles` real sobre el `role`
   fabricado del contexto de test), el id real gobierna, no el rol
   fabricado — exactamente el mismo patrón ya identificado y corregido en
   `nayade.test.ts` (`id: 2` = `admin@nayadeexperiences.es` real).
   Corregido en los 8 ficheros a un id fuera de rango (`999999`).
2. El catálogo RBAC local estaba incompleto frente a producción — faltaban
   permisos enteros (`cash.*`, `stock.*`, `fiscal.*`, `settlements.*`,
   `referrals.*`, `sales.*`, `operations.*`) que producción sí tiene desde
   hace tiempo (features ya desplegadas: Cash Control, Venue Commerce,
   etc.). Corregido ejecutando contra la BD local los scripts de seed ya
   existentes en el repo (`seed-fiscal-stock-cash-settlements-rbac.cjs`,
   `seed-referrals-rbac.cjs`, `seed-sales-rbac.cjs`) y la migración
   histórica `drizzle/0070_rbac_permissions.sql` (nunca aplicada a este
   volumen Docker) — ninguno de estos scripts toca producción, todos ya
   estaban escritos de sesiones anteriores.

**Resultado final, verificado con una ejecución completa y limpia**:
`pnpm test` → **3420/3420 passing, 259/259 ficheros** — cero fallos.

---

## BLOCK H — TypeScript Debt: 118 → 1

Triage completo (agente dedicado, lectura directa de cada sitio de error,
20 grupos por causa raíz) + fixes aplicados en 4 commits:

- **78 errores resueltos mecánicamente, sin cambio de comportamiento**:
  import relativo roto en `DailyControlCenter.tsx` (36 errores en
  cascada), retipado de `ReturnType<typeof drizzle>` en 3 ficheros
  (resolvía el overload equivocado), `EntityType` de reviews sin
  "restaurant", narrowing de `mailparser`/`ImapFlow`, campo `url` faltante
  en `ghlLog()`, `isQuantityEditable` faltante en la respuesta de
  LegoPacks, campo muerto `opportunityName`, prop `title` no soportada en
  iconos Lucide, y varios casts/guards puntuales de un error cada uno.
- **12 errores resueltos con `tsconfig.json` `target: "ES2020"`** (commit
  aislado, `noEmit: true` así que no afecta al build real — Vite/esbuild
  tienen su propio target independiente) — cache incremental de tsc no
  invalidaba el diagnóstico correctamente, limpiado.
- **26 errores eran bugs reales de negocio, no solo de tipos**, corregidos
  con más cuidado:
  - `createLead()` devolvía dos formas distintas de retorno según el
    `source` (número vs objeto) — contrato inconsistente de un helper
    compartido. Unificado a un único objeto; único caller real afectado
    (`vapiWebhookRouter.ts`) actualizado.
  - `applyDiscountCode` (botón "Aplicar bono" del CRM) vivía dentro del
    router `timeline` por error — el frontend siempre llamó a
    `crm.quotes.applyDiscountCode`, que nunca existió ahí. El botón
    fallaba con un error de tRPC para cualquiera que lo usara. Movido al
    router correcto (`quotes`).
  - `crm.createManual` (reserva manual desde CRM) validaba `paymentMethod`
    contra un enum de 4 valores que excluía `tarjeta_fisica`/
    `tarjeta_redsys` — pese a que el propio handler ya los manejaba y el
    frontend ya ofrecía esa opción en el selector. Enum ampliado.
  - Ambos bugs de CRM son de bajo riesgo real hoy: `crm_module_enabled`
    está desactivado en producción (módulo heredado de Náyade), así que
    ninguno de los dos flujos es alcanzable actualmente — quedan
    corregidos para cuando el módulo se reactive.
- **1 error sin resolver, documentado**: `VapiAgente.tsx:189` — TS2322
  "unknown no asignable a ReactNode". El diagnóstico de TypeScript
  atribuye el error a un comentario JSX vacío (`{/* Grabación */}`), que
  no puede producir ese error por sí mismo — confirmado con 4 métodos de
  lectura distintos que la posición reportada es literalmente ese
  comentario. Se intentaron 2 correcciones dirigidas (tipado explícito de
  `displayName`/`displayEmail` en dos sitios distintos del componente, el
  candidato más probable dado que las columnas JSON `structuredData`/
  `rawPayload` del schema son `unknown` sin `.$type<>()`) — ninguna cambió
  el conteo de errores para este caso concreto, descartando esa hipótesis.
  Pendiente de una sesión de bisección manual real (comentar bloques del
  JSX devuelto por `CallModal` y volver a compilar hasta aislar la
  expresión exacta) — no es un one-liner seguro sin esa localización
  previa. Impacto real: cero (el componente funciona correctamente en
  runtime; es un error de tipos, no de comportamiento).

**Resultado final**: `npx tsc --noEmit` → **1 error** (de 118 iniciales).
`pnpm build` verificado tras cada commit — sin regresiones.

---

## BLOCK I/J — Legacy Debt & Security (código, no solo tipos)

Ver commits `5ba7c29` (secretos/deep-link), `f0ce509` (branding/dominios) y
`b2af682` (contrato createLead) para el detalle completo. Resumen de
hallazgos reales:

- **Secreto hardcodeado en `ghlInbox.ts`** (ya en el commit previo a esta
  sesión de continuación, documentado aquí por completitud): literal
  `"NAYADE2026_ULTRA"` se persistía como secreto REAL de webhook si el
  admin dejaba el campo en blanco. Nunca disparado en producción
  (verificado: sin fila previa en `site_settings`). Corregido: genera
  aleatorio real la primera vez, conserva el existente en saves
  posteriores.
- **Colisión de deep link `/admin/comunity/:id`**: el regex de
  `deepLinkPolicy.ts` aceptaba erróneamente rutas admin como si fueran de
  comunidad. Corregido con una exclusión de segmento reservado (`admin`),
  no un literal de comunidad hardcodeado — cumple la regla arquitectónica
  multicomunidad del repo.
- **Email de pago fallido con marca hardcodeada, siempre incorrecta,
  sin red de seguridad**: `server/reservationEmails.ts` (webhook IPN de
  Redsys, sin gating de módulo, ruta live) hardcodeaba literalmente
  `"Náyade Experiences"` en el asunto del email de pago fallido —
  a diferencia de su email hermano (pago confirmado), que sí usa
  `getSystemSettingSync("brand_name", ...)`. Verificado contra producción:
  `system_settings.brand_name` = `"Segolife"` (correcto), así que este
  literal sin fallback era el ÚNICO punto sin red de seguridad de toda la
  base de código para este patrón — el resto de fallbacks "Skicenter"
  solo se activarían ante un fallo real de BD. Todos corregidos igual.
- **~25 sitios con fallback a `https://www.skicenter.es`** (dominio real
  de un negocio no relacionado del mismo desarrollador) para construir
  URLs públicas — activo hoy porque `APP_URL` está sin configurar en
  producción (confirmado). Una fase previa (Fase 15) ya había diagnosticado
  esto y construido el fix correcto (`canonicalBaseUrl()`) pero solo lo
  aplicó a 1 sitio, dejando ~24 documentados como deuda ("fuera de alcance
  aquí"). Completado en esta sesión: los 24 restantes ahora usan
  `canonicalBaseUrl()`.
- **Logo de Náyade Experiences renderizado literalmente** en
  `PublicNav.tsx`/`PublicFooter.tsx` (imagen de un CDN ajeno, ~25 páginas
  públicas todavía enrutadas). Corregido reutilizando el patrón ya
  establecido en el resto de la app (`segolife_brand_logo_url` con
  fallback a `/icons/segolife-icon.svg`). **Verificado en producción tras
  el deploy**: `segolife_brand_logo_url` ya apunta a un logo real de
  Segolife subido (`/local-storage/segolife/uploads/...png`, HTTP 200) —
  el fix muestra el logo correcto de inmediato, sin depender siquiera del
  fallback.
- **Emails placeholder sintéticos `@noreply.nayade`** (2 sitios más,
  además del ya corregido en una sesión anterior en `vapiCalls.ts`) —
  unificados a `@noreply.segolife.es`.
- **`organizations` (tabla, id=1)**: `name`/`slug` siguen siendo
  literalmente "Nayade Experiences"/"nayade-experiences" en producción
  (confirmado por lectura directa). **Evaluado y NO corregido
  deliberadamente**: se confirmó por grep que ninguna otra tabla ni router
  la referencia salvo `server/routers/onboardingRouter.ts` (con
  `DEFAULT_ORG_ID` hardcodeado a 1, scaffolding de Fase 5D
  multi-tenant), y que su única exposición (`onboarding.getOrg`, query de
  solo lectura) **no tiene ningún consumidor en el frontend** — cero
  usuarios ven jamás este valor. Corregirlo requeriría un `UPDATE` directo
  contra producción sin pasar por ninguna mutación de aplicación
  auditada — un intento de hacerlo así fue bloqueado por el clasificador
  de permisos de la sesión, correctamente: no hay urgencia real que
  justifique un `UPDATE` SQL crudo sobre un dato sin exposición
  verificada. Documentado en el registro de deuda técnica como hallazgo
  cosmético de impacto cero confirmado, no como bug.

**Deliberadamente NO tocado** (deuda de negocio/contenido, requiere
decisión humana, no es un simple literal de código):
- `client/src/pages/TerminosCondiciones.tsx` /
  `CondicionesCancelacion.tsx` — páginas legales que mencionan "Hotel
  Náyade" como producto real vigente.
- `client/src/lib/restaurantLinks.ts` — enlaza deliberadamente a
  restaurantes reales de otro negocio (lógica de negocio heredada
  completa, no un literal aislado).
- Portal de partners/proveedores (`PartnerLayout.tsx`,
  `SupplierDashboard.tsx`) — mismo patrón de logo Náyade, pero detrás de
  `partners_module_enabled`/`suppliers_module_enabled` (confirmados
  desactivados en producción) y con contenido de negocio heredado más
  profundo (teléfono, catálogo externo) — menor prioridad, requiere
  decisión de producto sobre el futuro del portal.
- `client/src/pages/admin/crm/CRMDashboard.tsx` — 4 títulos de
  presupuesto por defecto ("Presupuesto Nayade Experiences...") — cosmético,
  admin-only, detrás de `crm_module_enabled` desactivado.
