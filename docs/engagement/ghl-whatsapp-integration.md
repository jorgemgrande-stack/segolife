# GHL → WhatsApp — arquitectura futura (NO implementada)

Estado: **solo diseño**. Ningún código de este documento llama a una API real, ningún endpoint webhook existe todavía, ninguna credencial se ha guardado. `futureGhlWebhookProvider.ts` existe únicamente como referencia de contrato — `configured` es un literal `false`, `send()` nunca hace red.

## Por qué GHL

SEGOLIFE ya usa GoHighLevel (GHL) para otros flujos comerciales del repo heredado (`server/routes/ghlInboxRouter.ts`, integración WhatsApp/conversaciones del CRM legacy). La vía previsible para activar WhatsApp en el Communication Center es un webhook saliente hacia un flujo de GHL que ya sepa reenviar por WhatsApp Business — no una integración directa con la API de WhatsApp.

## Payload normalizado (contrato, ya definido en código)

`buildNormalizedGhlPayload()` en `server/segolife/engagement/providers/futureGhlWebhookProvider.ts`:

```json
{
  "eventId": "ticket_purchased:1234",
  "communicationType": "ticket_purchased",
  "userId": 42,
  "locale": "en",
  "transactional": true,
  "recipient": { "firstName": "Cristina", "phone": "+34600000000" },
  "content": { "title": "Your ticket is ready", "shortText": "Casanova — 23 Jun", "ctaLabel": "View ticket", "ctaUrl": "/ie/tickets/1234" },
  "context": { "eventId": 12, "venueId": 3, "benefitId": null, "tokens": null }
}
```

`eventId` es el `idempotencyKey` de la notificación (string estable), **nunca** el id numérico interno de la tabla. `locale` ya viene resuelto por SEGOLIFE (`resolveCommunicationLocale()`) — **GHL nunca decide traducción**, solo reenvía contenido ya en el idioma correcto.

**Explícitamente excluido del payload** (spec punto 29): password, JWT, cualquier secret, perfil completo del estudiante. `futureGhlWebhookProvider.test.ts` verifica esto por contrato (whitelist exacta de claves + grep de substrings prohibidos).

## Cuando se active de verdad (checklist, ninguno hecho todavía)

1. **Endpoint outbound** — variable de entorno propia (p.ej. `GHL_WEBHOOK_URL`), nunca hardcodeada.
2. **Firma HMAC-SHA256** del body con un secret propio (`GHL_WEBHOOK_SECRET`), header `X-Segolife-Signature` — mismo criterio que Fourvenues webhooks (ver `docs/integrations/fourvenues.md`, sección Webhooks, ya implementado como referencia de patrón en este repo).
3. **Timestamp + replay protection** — rechazar payloads con timestamp fuera de una ventana razonable (p.ej. 5 min).
4. **Idempotencia en ambos lados** — `eventId` ya es único por notificación; el lado receptor (GHL o el propio endpoint que GHL consulte) debe también deduplicar por si reintenta.
5. **Retry con backoff** — igual criterio que `notification_deliveries.attemptCount`/`maxAttempts` ya existente, reutilizable tal cual (el nuevo canal es solo otro `channel` en la misma tabla).
6. **Mapeo de teléfono** — `users.phone` ya existe en schema; confirmar formato E.164 antes de enviar.
7. **Consentimiento** (spec puntos 76-77) — WhatsApp marketing requiere opt-in explícito, **nunca inferido por tener teléfono**. `notification_preferences` ya soporta `channel: "whatsapp"` en su enum — falta el flujo de UI para que el estudiante lo active (hoy no existe ningún control de preferencia de WhatsApp en el frontend).
8. **Delivery status callback** — GHL debería poder confirmar entrega/fallo de vuelta; mapear a `notification_deliveries.status`.
9. **`WHATSAPP_NOTIFICATIONS_ENABLED=true`** — el kill switch por canal ya existe (`providerRegistry.ts`) y seguiría aplicando sin cambios.

## Qué NO hacer al activar (recordatorio)

- No sustituir `whatsappProvider.ts` por el stub sin escribir la implementación real primero — el stub es una referencia, no un provider funcional.
- No registrar `futureGhlWebhookProvider` en `providerRegistry.ts` hasta que `send()` haga lo que promete.
- No asumir que un estudiante con teléfono quiere WhatsApp — el email sigue siendo el canal por defecto; sin consentimiento, `email only`.
