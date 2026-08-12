/**
 * futureGhlWebhookProvider.test.ts — el contrato del payload FUTURO (spec
 * punto 29): nunca password/JWT/secrets/perfil completo, y el provider en sí
 * nunca queda "configured" hasta una implementación real deliberada (spec:
 * "NO ACTIVES WHATSAPP").
 */
import { describe, it, expect } from "vitest";
import { buildNormalizedGhlPayload, futureGhlWebhookProvider } from "./futureGhlWebhookProvider";

describe("futureGhlWebhookProvider — nunca activado", () => {
  it("configured es siempre false", () => {
    expect(futureGhlWebhookProvider.configured).toBe(false);
  });

  it("send() nunca hace red — devuelve not_implemented", async () => {
    const payload = buildNormalizedGhlPayload({
      idempotencyKey: "ticket_purchased:1", templateKey: "ticket_purchased", userId: 1, locale: "en", transactional: true,
      firstName: "Cristina", phone: "+34600000000", title: "Your ticket is ready", shortText: "Casanova — 23 Jun",
      ctaLabel: "View ticket", ctaUrl: "/ie/tickets",
    });
    const result = await futureGhlWebhookProvider.send(payload);
    expect(result.status).toBe("not_implemented");
  });
});

describe("buildNormalizedGhlPayload — contrato mínimo, nunca PII innecesaria", () => {
  it("nunca incluye password/JWT/secrets ni ningún campo fuera del contrato declarado", () => {
    const payload = buildNormalizedGhlPayload({
      idempotencyKey: "benefit_granted:5", templateKey: "benefit_granted", userId: 42, locale: "es", transactional: true,
      firstName: "Cristina", phone: "+34600000000", title: "Beneficio desbloqueado", shortText: "Entrada gratis",
      ctaLabel: "Usar beneficio", ctaUrl: "/uva/benefits/5",
    });
    const keys = Object.keys(payload);
    expect(keys.sort()).toEqual(["communicationType", "content", "context", "eventId", "locale", "recipient", "transactional", "userId"].sort());
    // "tokens" SÍ aparece legítimamente (context.tokens = cantidad de
    // SegoTokens) — se comprueba que no exista un campo de credencial, no
    // que la subcadena "token" esté ausente del todo.
    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("jwt");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toMatch(/[^s]token(?!s)/); // "token"/"authtoken" sí, "tokens" no
  });

  it("eventId del payload es el idempotencyKey de la notificación, nunca el id numérico interno", () => {
    const payload = buildNormalizedGhlPayload({
      idempotencyKey: "tokens_earned:99", templateKey: "tokens_earned_relevant", userId: 1, locale: "en", transactional: true,
      firstName: null, phone: null, title: "x", shortText: "x", ctaLabel: null, ctaUrl: null,
    });
    expect(payload.eventId).toBe("tokens_earned:99");
  });

  it("context sin datos se rellena con null explícito, nunca undefined (contrato estable para JSON.stringify)", () => {
    const payload = buildNormalizedGhlPayload({
      idempotencyKey: "x", templateKey: "x", userId: 1, locale: "es", transactional: false,
      firstName: null, phone: null, title: "x", shortText: "x", ctaLabel: null, ctaUrl: null,
    });
    expect(payload.context).toEqual({ eventId: null, venueId: null, benefitId: null, tokens: null });
  });
});
