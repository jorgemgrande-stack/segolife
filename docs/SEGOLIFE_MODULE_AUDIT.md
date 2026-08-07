# SEGOLIFE — Auditoría de Acoplamiento (Fase 1, Paso 1)

**Fecha:** 2026-08-07
**Método:** auditoría de solo lectura sobre el código real (`server/`, `client/`, `drizzle/schema.ts`) mediante 4 agentes de investigación en paralelo (schema, infraestructura core, routers de negocio, frontend/i18n). Ningún módulo se ha eliminado ni desactivado en esta fase salvo lo indicado explícitamente en `docs/SEGOLIFE_ROADMAP.md` §"Cambios realizados".

Categorías usadas (definidas por el usuario):

- **A. GENÉRICO Y REUTILIZABLE** — sirve tal cual o casi para Segolife
- **B. REUTILIZABLE CON ADAPTACIÓN** — el patrón/infraestructura sirve, el dominio concreto no
- **C. ESPECÍFICO DE NÁYADE** — lógica de negocio turística sin aplicación clara
- **D. DEBE DESACTIVARSE** — activo hoy y potencialmente peligroso o confuso si sigue activo
- **E. DEBE REEMPLAZARSE EN SEGOLIFE** — el concepto es necesario pero la implementación actual no sirve
- **F. PUEDE ELIMINARSE MÁS ADELANTE** — código muerto o sin valor ni como referencia

---

## Mapa de reutilización

| Área | Clasificación | Piezas concretas | Justificación |
|---|---|---|---|
| **Auth (login local)** | **A** | `server/localAuth.ts`, `server/context.local.ts`, `server/passwordReset.ts` | JWT + bcrypt genérico, sin lógica de negocio de Náyade. Ajustes cosméticos menores (nombre de cookie, fallback de marca en el asunto del email). |
| **Auth (Manus OAuth)** | **D → F** | `server/_core/oauth.ts`, `server/_core/sdk.ts`, `server/_core/context.ts` | Atado 100% a infraestructura Manus inexistente para Segolife. Ya inerte con `LOCAL_AUTH=true`, pero es el fallback silencioso si esa variable se omite. |
| **RBAC (motor de permisos)** | **A** | `server/_core/rbac.ts`, `server/_core/trpc.ts` (`permissionProcedure`, `anyPermissionProcedure`, `adminProcedure`, `protectedProcedure`) | Motor de permisos por claves string (`"crm.view"`), sin roles de Náyade hardcodeados en su lógica. La pieza mejor diseñada de todo el core para reutilizar tal cual. |
| **RBAC (roles concretos)** | **E** | `users.role` ENUM, procedimientos por audiencia (`staffProcedure`, `partnerProcedure`, `supplierProcedure`, `employeeProcedure`, `gestoriaProcedure`) | Vocabulario de roles 100% Náyade (agente, adminrest, controler, gestoria...). El *mecanismo* de "procedure por audiencia" es reutilizable como patrón; el contenido no. |
| **Admin (usuarios/settings/flags)** | **A** | `routers.ts` (`admin`), `configRouter.ts`, `pdfTemplatesRouter.ts`, `documentNumbers` | Gestión de usuarios, feature flags, numeración documental — back-office genérico. |
| **CMS (motor)** | **A** | Bloques/páginas/slideshow/media en `routers.ts` (`cms`), `server/db.ts` (helpers CMS) | Motor genérico de contenido, sin acoplamiento turístico. |
| **CMS (modelo de contenido actual)** | **C** | Home con `heroSlides`/`actividades`/`habitaciones` hardcodeados en `client/src/pages/Home.tsx` | Contenido de negocio de Náyade embebido en JSX, no gobernado realmente por el CMS pese a existir un panel admin para ello. |
| **Usuarios (`users` + invitaciones)** | **A** | Tabla `users`, `createInvitedUser`, `getUserByInviteToken`, `setUserPassword` en `db.ts` | Estructura sólida y genérica (openId, email, hash, invite flow). Solo el enum `role` es específico. |
| **Emails (motor)** | **A** | `emailAccounts.ts`, `emailInbox.ts`, `emailTemplatesRouter.ts`, `emailManager.ts`, `mailer.ts`, `emailAutomationJob.ts` | Multi-cuenta IMAP/SMTP, plantillas con preview, automatizaciones, cola programada — infraestructura genérica de comunicación. |
| **Emails (contenido)** | **C** | Catálogo `CATALOG_DEFAULTS` en `emailCommunications.ts`, ~20 plantillas en `emailTemplates.ts` | Contenido y asuntos 100% turísticos de Náyade, a vaciar/rehacer. |
| **Notificaciones (feed admin)** | **A** | `server/routers/notifications.ts` | Agregador de 6 fuentes con dismiss por usuario — solo cambian las fuentes. |
| **Notificaciones (al owner / push)** | **D** | `server/_core/notification.ts`, `server/adapters/notification.ts` (sin cablear) | El `_core` real usado depende de Manus Forge (roto sin esas credenciales); el adapter genérico existe pero no está conectado por ningún caller. |
| **Marketing (GHL/Meta/Vapi)** | **D** | `ghl.ts`, `ghlWebhookRouter.ts`, `routers/ghlInbox.ts`, `routes/ghlInboxRouter.ts`, `metaCapiRoute.ts`, `vapiCalls.ts`, `vapiWebhookRouter.ts` | Rutas Express montadas **incondicionalmente** en `server/_core/index.ts` (sin gate de feature flag). Riesgo de procesar webhooks reales si quedan credenciales. El patrón de bandeja unificada (SSE + idempotencia) sí es reutilizable. |
| **Analytics/Dashboards** | **B** | `dailyControl.ts`, `executiveSummary.ts`, `accounting.getDashboardMetrics` | Patrón de agregación por canal/fecha reutilizable; las fuentes de datos son específicas de Náyade. |
| **Storage (S3/MinIO)** | **B** | `server/storage.ts` (activo), `server/adapters/storage.ts` (sin cablear) | Funciona hoy vía Forge→S3/MinIO→local. El adapter genérico existe pero no está en uso; conviene migrar los call sites a él y simplificar. |
| **LLM / IA** | **D** | `server/_core/llm.ts` (activo, atado a Manus Forge — roto sin esas credenciales), `server/adapters/llm.ts` (genérico, sin cablear) | Cualquier feature de IA (ej. OCR de ticketing) está rota hoy en Segolife porque el código llama al módulo equivocado. |
| **Maps** | **F (hoy sin uso)** | `server/_core/map.ts`, `server/adapters/maps.ts` | No se encontró ningún caller vivo en routers actuales. |
| **Partners** | **B** | `server/routers/partners.ts` | Portal B2B con invitación/activación y liquidación por lotes — patrón inspirador para un futuro panel de "negocio/venue", modelo de comisión no aplica directo. |
| **Suppliers** | **C** | `suppliers.ts`, `supplierPortal.ts` | Proveedores turísticos + plataformas de cupones. Sin aplicación clara; liquidación duplica el patrón de Partners. |
| **Contabilidad/Finanzas** | **B** | `expenses.ts`, `bankMovements.ts`, `cashRegister.ts`, `cardTerminalBatches/Operations.ts` | Necesidad real como operación interna de la empresa (gastos, caja, banco), pero los parsers de extracto bancario son específicos del proveedor de Náyade. |
| **TPV** | **C** | `tpv.ts`, `emailIngestion.ts` | Punto de venta hostelero con reparto fiscal REAV — fuertemente turístico-fiscal. `emailIngestion.ts` es una integración IMAP activa, debe permanecer con su flag en OFF. |
| **Hotel** | **C** (patrón **B**) | `hotel.ts`, `hotelDb.ts` — 4 tablas | Sin alojamiento en Segolife. El motor de disponibilidad (temporada/tarifa/bloqueo) es la referencia técnica más limpia del repo, no se reutiliza literal. |
| **SPA** | **C** (patrón **B**) | `spa.ts`, `spaDb.ts` — 5 tablas | Sin aplicación de dominio. El patrón slot-based (recurso + plantilla horaria + generación de slots) es el candidato más directo para un futuro sistema de aforo por evento. |
| **Restaurantes** | **B fuerte** | `restaurants.ts`, `restaurantsDb.ts` — 6 tablas | **El dominio heredado más próximo al negocio real de Segolife** (discotecas/bares/restaurantes). Turnos, cierres, disponibilidad y reserva con depósito son directamente inspirables para "reserva en un local". |
| **REAV / Fiscal / Gestoría** | **C → F** | `server/reav.ts`, `gestoria.ts`, `gestoriaTax.ts`, `fiscalAuditRouter.ts`, `taxUtils.ts` — 12 tablas | Régimen fiscal de agencias de viajes españolas. Sin aplicación a Segolife como producto. `fiscalAuditRouter.ts` es código muerto de un bug histórico puntual (**F** directo). |
| **Reservas/Bookings** | **E** | `routers.ts` (`reservations`, `bookings`), `redsysRoutes.ts` — tabla `reservations` (95+ columnas, la de mayor fan-in del sistema) | El concepto "reserva con fecha/hora + pago" se necesita como "inscripción/entrada a evento", pero el modelo de datos debe reemplazarse. El flujo transaccional (pre-reserva → pago → confirmación idempotente por webhook) es un patrón **A** a preservar íntegro. |
| **Productos/Experiencias/Packs** | **E** | `routers.ts` (`products`), `legoPacks.ts` — tabla `experiences` (hub del catálogo) | Se reemplaza por catálogo de "eventos". El patrón CRUD+categorías+variantes+packs configurables es reutilizable. |
| **Reviews** | **A** | `reviews.ts`, `server/db/reviewsDb.ts` | Genérico por tipo de entidad (`entityType`) — cambiar los valores del enum es trivial. |
| **RRHH** | **A** (como operación interna, no como producto) | `hr.ts` — 11 tablas | Nómina/fichaje/vacaciones son necesidad real de Segolife como empresa española con empleados, no parte del producto de cara a estudiantes. |
| **Onboarding** | **A**, con matiz | `onboardingRouter.ts` | Wizard genérico, pero usa `DEFAULT_ORG_ID = 1` hardcodeado — hoy el código **no es multi-tenant** de verdad. |
| **Ticketing (cupones externos)** | **C** | `ticketing.ts` | Canje de cupones Groupon/Smartbox con OCR vía LLM. Sin aplicación hoy; el patrón de estados de confianza podría inspirar a futuro la validación de QR. |
| **Descuentos/Cupones** | **A/B** | `discounts.ts` (`discount_codes`) | Directamente reutilizable para códigos promocionales de eventos/membresías. `coupon_redemptions` (canje Groupon con OCR) → **C**. |
| **Jobs/cron transversales** | **D** | `cancellationStaleJob.ts`, `taxReminderJob.ts`, `emailAutomationJob.ts`, servicios de ingesta IMAP | Ya tienen apagador por feature flag — verificar explícitamente que las ~9 flags estén en `false` en cualquier BD nueva de Segolife, no basta con no tocarlas. |

## Mapa de módulos a retirar (candidatos, no ejecutado en esta fase)

Agrupados por bloques que ya están razonablemente aislados entre sí (ver dependencias FK en `docs/SEGOLIFE_DOMAIN_MODEL.md`):

1. **Hotel + SPA + Restaurantes** (verticales turísticos inexistentes en Segolife) — Restaurantes se retiene más tiempo como referencia de patrón por su cercanía funcional.
2. **REAV + Fiscal/Gestoría + TPV físico + Conciliación bancaria** — back-office fiscal-contable de la empresa operadora española de Náyade, no del producto.
3. **RRHH/nóminas** — igual que el bloque anterior, si Segolife como empresa no necesita este back-office concreto.
4. **Plataformas externas (Groupon/Smartbox) + Ticketing OCR** — subsistema aislado de venta de cupones en marketplaces turísticos.
5. **GHL + Vapi + Meta CAPI** — integraciones de marketing activas específicas de Náyade; deben quedar **desactivadas** (no solo "a retirar") antes de cualquier prueba con credenciales reales.
6. **Manus OAuth** (`_core/oauth.ts`, `_core/sdk.ts`) y **`_core/llm.ts`/`_core/notification.ts`/`_core/map.ts`/`_core/imageGeneration.ts`** (atados a Manus Forge) — reemplazar por los adapters genéricos ya existentes en `server/adapters/` (hoy sin cablear).

**Ninguno de estos bloques se ha tocado en esta fase.** El detalle de dependencias FK que justifica por qué son relativamente seguros de aislar está en `docs/SEGOLIFE_DOMAIN_MODEL.md`.

## Hallazgo de seguridad corregido en esta fase

`server/mailer.ts` tenía `GLOBAL_CC_EMAIL` con fallback hardcodeado a `reservas@nayadeexperiences.es`: **todo** email saliente (incluidos los de recuperación de contraseña con datos de estudiantes) se copiaba automáticamente a esa bandeja real de Náyade en cuanto se configurara SMTP/Brevo. `server/config/index.ts` (`EMAIL_FALLBACKS`) tenía el mismo email como fallback de `reservations`/`cancellations`. Corregido: fallback vacío en `mailer.ts` (sin CC forzado por defecto) y fallback neutro (`admin@tuempresa.com`, ya usado en el resto de claves del mismo diccionario) en `config/index.ts`. Ver `docs/SEGOLIFE_ROADMAP.md` para el detalle del cambio.

## Otros hardcodings heredados detectados, no corregidos (documentados para una fase posterior)

El código arrastra contaminación de **tres** proyectos distintos (Skicenter → Náyade → Segolife), no solo de Náyade:

| Archivo | Valor hardcodeado | Riesgo |
|---|---|---|
| `server/_core/index.ts` (bootstrap) | Auto-repara `brand_phone`/plantillas de email con datos reales de Náyade en cada arranque; siembra CMS/experiencias con contenido real de Náyade si las tablas están vacías | Bajo si la BD es propia de Segolife (que lo es), pero confunde a cualquiera que inspeccione datos de arranque |
| `server/passwordReset.ts`, `server/mailer.ts` | Fallback de nombre de marca `"Skicenter"` (ni siquiera Náyade) | Cosmético — aparecería en el asunto de un email de recuperación de contraseña si `brand_name` no está sembrado |
| `env.example.txt` | `DATABASE_URL=...skicenter_db`, `SMTP_FROM=Skicenter <reservas@skicenter.es>`, `S3_BUCKET=skicenter-media` | La plantilla de entorno del repo sigue en marca Skicenter, ni siquiera Náyade |
| `routers.ts`, `hotel.ts`, `restaurants.ts`, `crm.ts`, `tpv.ts` | `SITE_URL` con fallback `'https://www.skicenter.es'` | Si falta `APP_URL` en el entorno, URLs de retorno de pago apuntarían a un dominio ajeno |
| Cookie de sesión `"nayade_session"` (`localAuth.ts`, `authGuard.ts`, `settlementExportRoutes.ts`, `ghlInboxRouter.ts`) | Nombre de cookie con marca Náyade | Cosmético, sin riesgo funcional |
| `server/_core/env.ts` | `S3_BUCKET` fallback `"nayade-media"` | Bajo riesgo si no se reutilizan credenciales S3 reales |

No se han tocado estos puntos en esta fase (no son "peligrosos" en el sentido de fuga de datos como el de `GLOBAL_CC_EMAIL`, son cosméticos o de bajo riesgo con la configuración local actual) — quedan documentados para abordarlos junto con el trabajo de branding real, fuera del alcance de Fase 1.
