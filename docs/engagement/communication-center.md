# SEGOLIFE Communication Center

Fecha: 2026-08-12. Estado: arquitectura + V1 implementados en rama `feat/segolife-communication-center`, **sin mergear, sin desplegar, sin activar canales reales**.

## Principio central

```
DOMAIN EVENT → COMMUNICATION INTENT → TEMPLATE → CHANNEL → DELIVERY
```

Un evento de negocio (`BenefitGranted`, `TicketPurchased`...) nunca decide directamente "mandar un email" — dispara un dominio event (`engagementEvents.ts` o `benefitEvents.ts`), un **listener** interpreta ese evento como una intención de comunicación y llama a `createNotification()` (`notificationService.ts`) con una plantilla ya renderizada. `createNotification()` decide, por canal, si se intenta la entrega (respetando preferencias/kill switches) — nunca el listener ni el motor de negocio.

**Regla que nunca se rompe**: `earnTokens()`, `checkoutService.ts`, `benefitGrantService.ts` no conocen `notificationService.ts` ni ningún provider — solo emiten el evento. Si mañana se añade WhatsApp, no se toca ningún motor de negocio, solo se registra un canal nuevo en `providerRegistry.ts` y se declara en la plantilla.

## Qué se reutilizó de Fase 7 (Engagement Core) — todo

Auditoría previa (ver informe final) confirmó que la infraestructura de Fase 7 ya estaba diseñada como capa de comunicación genérica. Se reutilizó TAL CUAL:

- Schema: `notifications`, `notification_deliveries`, `notification_preferences` (sin migración).
- `notificationService.ts` → `createNotification()`, único punto de entrada.
- `NotificationProvider` (interfaz) + `providerRegistry.ts` — canal desacoplado de contenido.
- `audienceEngine.resolveAudience()`, `campaignService.ts`, `engagementScheduler.ts`, `notificationPreferencesService.ts`.
- Kill switches en capas: `ENGAGEMENT_DELIVERY_ENABLED` (scheduler) + `EMAIL_NOTIFICATIONS_ENABLED`/`PUSH_...`/`WHATSAPP_...` (por canal) + `provider.capabilities.configured` (credenciales reales).

Lo único que se ADAPTÓ fue `templates.ts` (extendido, no sustituido — ver más abajo).

## Qué es nuevo

| Pieza | Archivo | Qué resuelve |
|---|---|---|
| Resolución de idioma | `communicationLocale.ts` | Regla no negociable IE=EN/UVA=ES — **corrige un bug activo**: antes, todo envío externo (email/push/whatsapp) salía siempre en inglés (`notificationService.ts`/`engagementScheduler.ts` leían `.titleEn`/`.bodyEn` directo) |
| Sistema de diseño de email | `email/emailShell.ts` | Componentes reutilizables (EmailShell/Hero/EventCard/TokensCard/BenefitCard/CTA/InfoBox/AlertBox), branding SEGOLIFE violeta/lila, compatible tablas+inline styles, sin CSS moderno |
| Catálogo extendido | `templates.ts` | 29 plantillas (15 V1 obligatorias + 4 preexistentes Fase 7 + 10 V2 preparadas), cada una con `adminCategory` (taxonomía de 10 categorías, solo presentación — no toca el enum de BD `notifications.category`), `subjectEn/Es`, `preheaderEn/Es`, `status: active\|prepared`, `buildEmailBody` (HTML enriquecido opcional) |
| Matriz de canales | `communicationChannelMatrix.ts` | `resolveAdditionalChannels(templateKey)` — única fuente de qué canal adicional se intenta; WhatsApp NUNCA se traduce a un intento real aunque una plantilla lo declare |
| Metadata de email enriquecido | `notificationMetadata.ts` | Forma del snapshot HTML/texto guardado en `notifications.metadata` (columna JSON ya existente, sin migración) |
| Envío inmediato | `notificationService.ts` (`sendImmediately`) | Comunicaciones de seguridad/momento puntual (password reset, ticket comprado) no pueden depender de que el scheduler tickee (hasta 1 min, y solo si `ENGAGEMENT_DELIVERY_ENABLED=true`) |
| Stub GHL/WhatsApp | `providers/futureGhlWebhookProvider.ts` | Contrato + payload normalizado, `configured: false` siempre — ver `ghl-whatsapp-integration.md` |

## Bugs reales corregidos (no solo arquitectura nueva)

1. **Idioma siempre inglés en canales externos** — `notificationService.ts:117`/`engagementScheduler.ts:42-43` ignoraban `communities.defaultLocale`/`student_profiles.preferredLocale`. Corregido vía `resolveCommunicationLocale()`.
2. **`recipient` siempre vacío en el scheduler** — `engagementScheduler.ts` pasaba `recipient: {}` a todo envío vía cola/pending, así que `emailProvider.ts` descartaba cualquier email programado ("Recipient has no email address"). Corregido resolviendo `users.email/phone` en el momento de la entrega.
3. **`benefit_granted` declaraba email pero nunca lo intentaba** — `benefitGrantedListener.ts` no pasaba `additionalChannels`. Corregido (v2).
4. **`TicketPurchased`/`TokensEarned` se emitían/catalogaban pero sin ningún listener** — confirmado por auditoría ("el evento se dispara al vacío"). Conectados en esta fase.
5. **`EventUpdated`/`EventCancelled` no existían ni como tipo de evento** — añadidos al catálogo + trigger real en `eventsDb.ts` (solo cambios materiales: fecha/hora/venue; cancelación = active→inactive de un evento ya activo).

## Eventos V1 conectados de verdad

| Template | Trigger real | Archivo |
|---|---|---|
| `account_welcome` | No conectado — ver "Pendiente" abajo | — |
| `password_reset_requested` | `POST /api/auth/forgot-password` | `passwordReset.ts` (migrado del pipeline legacy Náyade) |
| `password_changed` | `POST /api/auth/reset-password` (éxito) | `passwordReset.ts` |
| `ticket_purchased` | `checkoutService.ts` → `ticket_purchased` | `ticketPurchasedListener.ts` (nuevo) |
| `tokens_earned_relevant` | `tokenEngine.ts earnTokens()` → `tokens_earned` (nuevo emit) | `tokensEarnedListener.ts` (nuevo) |
| `event_updated` / `event_cancelled` | `eventsDb.ts updateEvent()`/`setEventActive()` (nuevo emit condicional) | `eventLifecycleListener.ts` (nuevo, fan-out a todo comprador pagado) |
| `benefit_granted` (v2) | `benefitGrantService.ts` (sin cambios) → `BenefitGranted` | `benefitGrantedListener.ts` (email añadido) |

**Pendiente, no conectado en esta fase** (documentado, no fabricado): `account_welcome` (no hay hook en `registrationService.ts`), `tokens_adjusted_admin` (no hay endpoint admin de ajuste manual identificado con claridad), `benefit_expiring`/`profile_incomplete` (requieren un job programado que recorra BD, no un evento síncrono — mismo patrón que `EventReminder24h`, no implementado). Todas estas SÍ tienen su plantilla completa (EN/ES + email) lista en el catálogo — solo falta el trigger.

## Resolución de idioma — contrato

```ts
resolveCommunicationLocale({ userId, communityId }) → "en" | "es"
```
Orden: 1) `student_profiles.preferredLocale` (override explícito) → 2) `communities.defaultLocale` de la comunidad **de origen de la comunicación concreta** (nunca "la comunidad del usuario" en abstracto — un estudiante puede pertenecer a IE+UVA a la vez) → 3) fallback de plataforma `"es"`.

`communities.defaultLocale` ya existía y ya estaba bien sembrado (`ie`→`en`, `uva`→`es`) — no fue necesario derivar nada por slug.

## Matriz de canales (spec punto 27)

`resolveAdditionalChannels(templateKey)` consulta `EngagementTemplate.channels` + `status`. Hoy solo `"email"` se traduce a un intento real (`push` sin flujo de registro de subscripciones; `whatsapp` deliberadamente excluido, ver GHL doc). Ninguna plantilla `status: "prepared"` dispara nunca, aunque su listener existiera — es el guardrail contra activar V2 por accidente.

## Limpieza legacy

`/admin/plantillas-email` y `/admin/engagement/templates` apuntan ahora al mismo componente (`TemplatesViewer.tsx`, reescrito). `EmailTemplatesManager.tsx` (legacy Náyade/Skicenter) y su router `emailTemplatesRouter.ts` quedan **ARCHIVADOS**: código intacto, sin ruta, sin entrada de menú — nada los importa. `server/emailTemplates.ts` (los ~35 builders HTML reales) se deja completamente intacto porque ~15 módulos de negocio activos (reservas/TPV/cupones/anulaciones/CRM/restaurante) siguen dependiendo de él — no es del dominio SEGOLIFE, tocarlo rompería funcionalidad real. Ver informe final para la tabla completa de clasificación.

## Test coverage nuevo

`communicationLocale.test.ts`, `email/emailShell.test.ts`, `communicationChannelMatrix.test.ts`, `providers/futureGhlWebhookProvider.test.ts`, `benefitGrantedListener.test.ts` (extendido). Ver informe final para lo que queda sin cobertura dedicada (principalmente los 3 listeners nuevos por su necesidad de mocking extenso de BD).
