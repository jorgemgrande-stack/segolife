import { describe, it, expect } from "vitest";
import { createFourvenuesIntegrationsAdapter } from "./fourvenuesIntegrationsAdapter";
import { CapabilityNotSupportedError } from "./externalTicketingProvider";
import { createMockTransport } from "./mockTransport";
import {
  fourvenuesIntEventsFixture,
  fourvenuesIntTicketRatesFixture,
  fourvenuesIntTicketsFixture,
} from "./fixtures/fourvenuesFixtures";

describe("FourvenuesIntegrationsAdapter — contract tests (Integrations API, forma real confirmada 2026-08-12)", () => {
  const transport = createMockTransport({
    "GET /events/": fourvenuesIntEventsFixture,
    "GET /tickets-rates/": fourvenuesIntTicketRatesFixture,
    "GET /tickets/": fourvenuesIntTicketsFixture,
  });
  const adapter = createFourvenuesIntegrationsAdapter(transport);
  const credentials = { apiKey: "ik_fixture_key" };

  it("testConnection informa cuántos eventos ve en el rango de prueba", async () => {
    const result = await adapter.testConnection(credentials);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("1");
  });

  it("listEvents normaliza fechas unix a Date y flyer a imageUrl", async () => {
    const events = await adapter.listEvents(credentials);
    expect(events).toHaveLength(1);
    expect(events[0].externalId).toBe("fvi_evt_001");
    expect(events[0].startsAt).toBeInstanceOf(Date);
    expect(events[0].startsAt.getUTCFullYear()).toBe(2027);
    expect(events[0].imageUrl).toBe("https://example.invalid/flyer.jpg");
  });

  it("listTicketTypes aplana options[] eligiendo la opción más barata, precio en céntimos", async () => {
    const types = await adapter.listTicketTypes(credentials, "fvi_evt_001");
    expect(types).toHaveLength(1);
    expect(types[0].priceCents).toBe(800); // 8€ (la opción más barata, no 12€)
    expect(types[0].currency).toBe("EUR");
    expect(Number.isInteger(types[0].priceCents)).toBe(true);
  });

  it("listOrders se deriva agrupando tickets por payment_id, no de un endpoint nativo", async () => {
    const orders = await adapter.listOrders(credentials, "fvi_evt_001");
    // fvi_tkt_001 + fvi_tkt_002 comparten payment_id → 1 pedido de 2 tickets
    const grouped = orders.find(o => o.externalId === "fvi_pay_001");
    expect(grouped).toBeDefined();
    expect(grouped!.totalCents).toBe(1670); // 8.35 + 8.35 en céntimos
    expect(grouped!.feesCents).toBe(70); // 0.35 + 0.35
    expect(grouped!.status).toBe("paid");
  });

  it("listOrders marca el pedido como refunded si cualquier ticket del grupo lo está", async () => {
    const orders = await adapter.listOrders(credentials, "fvi_evt_001");
    const refundedOrder = orders.find(o => o.externalId === "fvi_pay_002");
    expect(refundedOrder!.status).toBe("refunded");
  });

  it("listTickets mapea status: used si enter=1, refunded si refunded=1, issued en otro caso", async () => {
    const tickets = await adapter.listTickets(credentials, "fvi_evt_001");
    expect(tickets.find(t => t.externalId === "fvi_tkt_001")!.status).toBe("used");
    expect(tickets.find(t => t.externalId === "fvi_tkt_002")!.status).toBe("issued");
    expect(tickets.find(t => t.externalId === "fvi_tkt_003")!.status).toBe("refunded");
  });

  it("listAttendance solo incluye tickets con enter=1, usa entry_date real", async () => {
    const attendance = await adapter.listAttendance(credentials, "fvi_evt_001");
    expect(attendance).toHaveLength(1);
    expect(attendance[0].externalTicketId).toBe("fvi_tkt_001");
    expect(attendance[0].occurredAt).toBeInstanceOf(Date);
  });

  it("listCommerceTransactions lanza CapabilityNotSupportedError — sin POS confirmado", async () => {
    await expect(adapter.listCommerceTransactions(credentials, "fvi_evt_001")).rejects.toThrow(CapabilityNotSupportedError);
  });

  it("capabilities refleja lo confirmado empíricamente 2026-08-12", () => {
    expect(adapter.capabilities.individualAttendance).toBe(true);
    expect(adapter.capabilities.orders).toBe(true);
    expect(adapter.capabilities.consumptions).toBe(false);
    expect(adapter.capabilities.webhooks).toBe(false);
  });
});
