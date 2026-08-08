import { describe, it, expect } from "vitest";
import { createWeezeventAdapter, getWeezeventAccessToken } from "./weezeventAdapter";
import { CapabilityNotSupportedError } from "./externalTicketingProvider";
import { createMockTransport } from "./mockTransport";
import {
  weezeventAuthFixture,
  weezeventEventsFixture,
  weezeventTicketsFixture,
  weezeventParticipantsNotScannedFixture,
  weezeventParticipantsScannedFixture,
} from "./fixtures/weezeventFixtures";

describe("WeezeventAdapter — contract tests (payload con forma oficial → objeto normalizado)", () => {
  const credentials = { apiKey: "fixture-key", accessToken: "fixture-token", username: "fixture@example.invalid", password: "fixture" };

  it("getWeezeventAccessToken obtiene el token del endpoint de auth de dos pasos", async () => {
    const transport = createMockTransport({ "POST /auth/access_token": weezeventAuthFixture });
    const token = await getWeezeventAccessToken(transport, credentials);
    expect(token).toBe("fixture-access-token");
  });

  it("listEvents normaliza eventos", async () => {
    const transport = createMockTransport({ "GET /events": weezeventEventsFixture });
    const adapter = createWeezeventAdapter(transport);
    const events = await adapter.listEvents(credentials);
    expect(events[0].externalId).toBe("501");
    expect(events[0].name).toContain("Tankers");
  });

  it("listTicketTypes convierte price (euros) a priceCents enteros", async () => {
    const transport = createMockTransport({ "GET /tickets": weezeventTicketsFixture });
    const adapter = createWeezeventAdapter(transport);
    const types = await adapter.listTicketTypes(credentials, "501");
    expect(types[0].priceCents).toBe(2500);
    expect(Number.isInteger(types[0].priceCents)).toBe(true);
  });

  it("listOrders lanza CapabilityNotSupportedError — sin endpoint de pedidos documentado", async () => {
    const transport = createMockTransport({});
    const adapter = createWeezeventAdapter(transport);
    await expect(adapter.listOrders(credentials, "501")).rejects.toThrow(CapabilityNotSupportedError);
  });

  it("listTickets trata cada participant como una entrada individual", async () => {
    const transport = createMockTransport({ "GET /participant/list": weezeventParticipantsNotScannedFixture });
    const adapter = createWeezeventAdapter(transport);
    const tickets = await adapter.listTickets(credentials, "501");
    expect(tickets).toHaveLength(1);
    expect(tickets[0].participant.email).toBe("fixture.buyer@example.invalid");
  });

  it("listAttendance IGNORA participantes con control_status.status='0' (no escaneados)", async () => {
    const transport = createMockTransport({ "GET /participant/list": weezeventParticipantsNotScannedFixture });
    const adapter = createWeezeventAdapter(transport);
    const attendance = await adapter.listAttendance(credentials, "501");
    expect(attendance).toHaveLength(0);
  });

  it("listAttendance normaliza a NormalizedAttendance cuando control_status indica escaneado — CONFIRMED individual, no agregado", async () => {
    const transport = createMockTransport({ "GET /participant/list": weezeventParticipantsScannedFixture });
    const adapter = createWeezeventAdapter(transport);
    const attendance = await adapter.listAttendance(credentials, "501");
    expect(attendance).toHaveLength(1);
    expect(attendance[0].occurredAt).toBeInstanceOf(Date);
    expect(attendance[0].participant.email).toBe("fixture.attendee@example.invalid");
  });

  it("listCommerceTransactions lanza CapabilityNotSupportedError — sin POS documentado", async () => {
    const transport = createMockTransport({});
    const adapter = createWeezeventAdapter(transport);
    await expect(adapter.listCommerceTransactions(credentials, "501")).rejects.toThrow(CapabilityNotSupportedError);
  });

  it("capabilities refleja exactamente lo confirmado en docs/integrations/weezevent.md", () => {
    const adapter = createWeezeventAdapter(createMockTransport({}));
    expect(adapter.capabilities.individualAttendance).toBe(true);
    expect(adapter.capabilities.orders).toBe(false);
    expect(adapter.capabilities.webhooks).toBe(false);
    expect(adapter.capabilities.checkout).toBe(false);
  });
});
