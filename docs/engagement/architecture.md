# Segolife — Engagement, Notifications & Communications Core

Fase 7. Decisiones de diseño propias.

## Regla fundamental

**Segolife genera eventos de dominio. El Engagement Core decide qué
comunicar, a quién, cuándo y por qué canal.** Los motores de Benefits,
SegoTokens, Ticketing, Attendance, Commerce y Events NUNCA saben cómo se
envía una comunicación — solo emiten un evento de dominio (o, en el caso de
Benefits, ya lo hacían desde Fase 4). Email/push/WhatsApp son adapters
intercambiables detrás de `NotificationProvider`, igual que Fourvenues/
Weezevent fueron adapters detrás de `ExternalTicketingProvider` en Fase 5.

## Auditoría previa — REUSE / ADAPT / DO NOT USE

**REUSE (literal):**
- `sendEmail()` (`server/mailer.ts`) — transporte Brevo API + SMTP fallback
  genérico, sin acoplar a ninguna plantilla. Se reutiliza como transporte de
  `EmailNotificationProvider`, pero SIEMPRE con `from` explícito propio de
  Segolife — nunca se deja caer al fallback `"Skicenter"` ni a
  `noreply@example.com`.
- `benefitEvents.ts` (Fase 4) — patrón EventEmitter + aislamiento por
  listener vía microtask (`Promise.resolve().then(listener).catch(...)`).
  El catálogo de domain events de Fase 7 replica exactamente este patrón en
  `engagementEvents.ts`.
- `BenefitGranted` — evento YA EXISTENTE, reutilizado literalmente. El
  Engagement Core se registra como UN LISTENER MÁS (`benefitEvents.onTyped`),
  nunca se crea un segundo evento paralelo ni se modifica el emisor.
- `conditionallyStartJob` (`server/_core/index.ts`) — patrón de arranque
  condicional de jobs, replicado (variante por env var) para el scheduler.
- `node-cron` — ya es dependencia del proyecto.
- `communities`, `communityVenues`, `communityEvents`, `venues`, `events`,
  `student_tags`, `token_wallets`, `user_benefits`, `event_attendance`,
  `commerce_transactions` — dimensiones de audiencia, TODAS de solo lectura.
- Patrón de capabilities/kill-switch de Fase 5 (`capabilities.ts`,
  `EXTERNAL_INTEGRATIONS_ENABLED`) — mismo criterio arquitectónico aplicado
  a `ProviderCapabilities`/`ENGAGEMENT_DELIVERY_ENABLED`.

**ADAPT (patrón de referencia, nunca reutilizado literalmente):**
- `email_comm_log`/`email_scheduled_jobs` (legacy) — su FORMA (relatedEntity
  tracking, `attempts`/`lockedAt`, enum de status) inspira el diseño de
  `notification_deliveries`, pero son tablas de OTRO dominio (comercial
  Náyade: leads/quotes/reservations) — nunca se leen ni se escriben desde
  Engagement Core.
- Disciplina `GLOBAL_CC_EMAIL` (sin default, nunca copia a nadie hasta
  configurar explícitamente) — mismo criterio aplicado al remitente de
  Segolife.

**DO NOT USE:**
- `emailManager.ts`, `emailTemplateConfigs`, `emailCommLog`,
  `emailScheduledJobs`, `customerEmailPrefs`, `emailAutomationRules` — todo
  el pipeline de automatización comercial de Náyade (presupuestos,
  recordatorios de pago). `customerEmailPrefs` además solo tiene UN booleano
  global por email, insuficiente para preferencias por canal/categoría.
- `emailTemplates.ts` (2755 líneas) — plantillas HTML con marca real de
  Náyade Experiences (naranja/beige, `reservas@nayadeexperiences.es`).
- `ghl.ts`, `ghlInboxEvents.ts`, `ghlWebhookRouter.ts` — CRM GoHighLevel,
  externo, dominio comercial ajeno. Prohibido explícitamente por el spec.
- `vapiWebhookRouter.ts` — asistente de voz VAPI. Prohibido explícitamente.
- `metaCapiRoute.ts` — Meta Conversions API: reporta conversiones a
  plataformas de anuncios, NO es un canal de comunicación a usuarios. Fuera
  de alcance de Engagement Core (ya auditado/endurecido en Fase 6 para el
  Pixel de cliente).
- `notifyOwner`/`server/_core/notification.ts` — acoplado a credenciales de
  Manus Forge que Segolife no tiene; además es para alertar al OWNER, no
  para comunicarse con estudiantes.

**⚠️ Colisión de nombres detectada y evitada:** `server/routers/notifications.ts`
YA EXISTE — es la campana de administración legacy (agrega 6 fuentes de
negocio: leads/quotes/cancellations/pending_payments/tpv_alerts/
upcoming_reservations) y el router key `notifications` YA ESTÁ REGISTRADO
en `server/routers.ts`. El router de estudiante de esta fase se registra
como `studentNotifications` — nunca se toca ni se renombra el existente.

## Dominio (6 tablas + 1 opcional)

```
notifications                    -- entidad canónica, alimenta la inbox in-app
  └─ notification_deliveries     -- 1 fila por canal intentado (in_app/email/push/whatsapp)
notification_preferences         -- (user_id, category, channel) → enabled
                                     ausencia de fila = default (marketing OFF, resto ON)
engagement_campaigns              -- manual | scheduled | triggered
  ├─ engagement_campaign_audiences   -- snapshot de user_id únicos al programar
  └─ engagement_campaign_messages    -- contenido por canal
push_subscriptions                -- suscripciones reales del navegador/dispositivo
```

**Por qué NO hay tabla `notification_events`.** El catálogo de eventos de
dominio (`engagementEvents.ts`) es un catálogo TIPADO EN CÓDIGO (mismo
criterio que `BenefitOrigin`/`TokenRule.origin` en Fases 2/4), no una tabla.
La durabilidad que pide el spec (punto 5-6: "un restart no debe perder una
comunicación") no depende de persistir el evento crudo — depende de que, en
el momento en que un listener decide "esto merece una notificación", la fila
de `notifications` se escriba de forma SÍNCRONA antes de responder. Una vez
esa fila existe, sobrevive a cualquier reinicio; el trabajo pendiente
(`notification_deliveries` con `status='pending'`) es lo que un scheduler
futuro reprocesa. Añadir una tabla de eventos crudos sería una segunda
fuente de verdad sin aportar durabilidad adicional real.

## Transactional vs marketing

`notifications.audience_type` (`transactional` | `marketing`) decide si las
preferencias del usuario pueden bloquear el envío. Las transaccionales
(`benefit_granted`, `benefit_expiring`, cambios de cuenta) SIEMPRE se
entregan en `in_app` — el canal in-app nunca se puede desactivar del todo,
solo email/push/whatsapp por categoría. Las de marketing respetan
`notification_preferences` estrictamente, con default `enabled=false`
(sin fila = sin consentimiento — spec punto 10: "marketing OFF unless
explicitly granted"). `notification_preferences` ES el registro de consentimiento
de marketing — no se crea una tabla de consentimiento separada y redundante.

## Snapshot de contenido (auditabilidad)

`notifications` guarda `title_en/es` + `body_en/es` YA RENDERIZADOS en el
momento del envío, junto a `template_key`/`template_version` (spec punto 72).
Así, editar una plantilla mañana no cambia lo que un estudiante ya recibió
— el histórico es inmutable por diseño (nunca se hace UPDATE de esos
campos tras crear la fila).

## Audience snapshot (campañas programadas)

Decisión (spec punto 70): al PROGRAMAR una campaña (`status='scheduled'`),
se resuelve y persiste el snapshot en `engagement_campaign_audiences`
inmediatamente — no se re-resuelve al momento de enviar. Esto da
consistencia/auditoría (quién iba a recibir esto exactamente cuando se
programó) a costa de no reflejar cambios de audiencia entre programar y
enviar (p.ej. un usuario que se da de baja después de programarse sigue
en el snapshot — el envío real debe re-comprobar preferencias en el momento
de la entrega, no solo la pertenencia a audiencia). Las campañas `manual`
(envío inmediato) resuelven y snapshotan en el mismo instante.

## Kill switches

```
ENGAGEMENT_DELIVERY_ENABLED     default false — scheduler de deliveries programadas — ON en producción
EMAIL_NOTIFICATIONS_ENABLED     default false — canal email — ON en producción (Brevo, confirmado con envío real)
PUSH_NOTIFICATIONS_ENABLED      default false — canal push — ON en producción desde 2026-08-23 (cierre post-roadmap), VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT configurados y verificados (firma real aceptada por FCM)
WHATSAPP_NOTIFICATIONS_ENABLED  default false — canal whatsapp — sigue OFF, sin proveedor real conectado (bloqueo de negocio, no técnico)
```

`in_app` NUNCA requiere un kill switch — no sale del sistema, es solo una
fila en `notifications` + lectura desde la propia BD. El scheduler
(`engagementScheduler.ts`) solo arranca si `ENGAGEMENT_DELIVERY_ENABLED=true`
— en una BD nueva, sin esa variable, no arranca ningún worker (mismo
criterio que Fase 5).

## Fuera de alcance de esta fase

Sin activar Brevo real, sin enviar email real, sin WhatsApp real, sin push
real, sin GHL, sin Vapi, sin SMS, sin marketing automation compleja, sin
campañas generadas por IA. Toda la infraestructura queda PREPARADA y
verificada, nunca ejecutada contra estudiantes reales.
