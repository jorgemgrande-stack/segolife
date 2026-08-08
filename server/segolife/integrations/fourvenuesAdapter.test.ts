import { describe, it, expect } from "vitest";
import { createFourvenuesAdapter } from "./fourvenuesAdapter";
import { CapabilityNotSupportedError } from "./externalTicketingProvider";
import { createMockTransport } from "./mockTransport";
import {
  fourvenuesAuthFixture,
  fourvenuesEventsFixture,
  fourvenuesTicketRatesFixture,
  fourvenuesPaymentsFixture,
  fourvenuesTicketsFixture,
} from "./fixtures/fourvenuesFixtures";

describe("FourvenuesAdapter — contract tests (payload con forma oficial → objeto normalizado)", () => {
  const transport = createMockTransport({
    "GET /auth": fourvenuesAuthFixture,
    "GET /events": fourvenuesEventsFixture,
    "GET /ticket-rates": fourvenuesTicketRatesFixture,
    "GET /payments": fourvenuesPaymentsFixture,
    "GET /tickets": fourvenuesTicketsFixture,
  });
  const adapter = createFourvenuesAdapter(transport);
  const credentials = { apiKey: "fixture-key" };

  it("testConnection informa cuántos hosts partner ve el channel", async () => {
    const result = await adapter.testConnection(credentials);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("2");
  });

  it("listEvents normaliza a NormalizedEvent (fechas reales, nunca strings crudas)", async () => {
    const events = await adapter.listEvents(credentials);
    expect(events).toHaveLength(1);
    expect(events[0].externalId).toBe("fv_evt_001");
    expect(events[0].startsAt).toBeInstanceOf(Date);
    expect(events[0].name).toContain("Erasmus Night");
  });

  it("listTicketTypes normaliza precio a céntimos enteros", async () => {
    const types = await adapter.listTicketTypes(credentials, "fv_evt_001");
    expect(types[0].priceCents).toBe(1500);
    expect(types[0].currency).toBe("EUR");
    expect(Number.isInteger(types[0].priceCents)).toBe(true);
  });

  it("listOrders se deriva de /payments, separa fees de subtotal", async () => {
    const orders = await adapter.listOrders(credentials, "fv_evt_001");
    expect(orders[0].totalCents).toBe(1500);
    expect(orders[0].feesCents).toBe(100);
    expect(orders[0].subtotalCents).toBe(1400);
    expect(orders[0].status).toBe("paid");
  });

  it("listTickets normaliza participante con email/nombre", async () => {
    const tickets = await adapter.listTickets(credentials, "fv_evt_001");
    expect(tickets[0].participant.email).toBe("fixture.student@example.invalid");
    expect(tickets[0].status).toBe("issued");
  });

  it("listAttendance lanza CapabilityNotSupportedError — Channel Manager confirmado sin check-in", async () => {
    await expect(adapter.listAttendance(credentials, "fv_evt_001")).rejects.toThrow(CapabilityNotSupportedError);
  });

  it("listCommerceTransactions lanza CapabilityNotSupportedError — sin POS confirmado", async () => {
    await expect(adapter.listCommerceTransactions(credentials, "fv_evt_001")).rejects.toThrow(CapabilityNotSupportedError);
  });

  it("capabilities refleja exactamente lo confirmado en docs/integrations/fourvenues.md", () => {
    expect(adapter.capabilities.individualAttendance).toBe(false);
    expect(adapter.capabilities.consumptions).toBe(false);
    expect(adapter.capabilities.checkout).toBe(true);
    expect(adapter.capabilities.webhooks).toBe(true);
  });
});
