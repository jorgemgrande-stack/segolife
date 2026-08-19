import { describe, it, expect } from "vitest";
import { createFourvenuesIntegrationsAdapter, deriveSourcePublicationStatus } from "./fourvenuesIntegrationsAdapter";
import { CapabilityNotSupportedError, type IntegrationTransport } from "./externalTicketingProvider";
import { createMockTransport } from "./mockTransport";
import {
  fourvenuesIntEventsFixture,
  fourvenuesIntTicketRatesFixture,
  fourvenuesIntTicketsFixture,
  fourvenuesIntTicketsCaseAFixture,
  fourvenuesIntTicketsCaseBFixture,
  fourvenuesIntTicketFreeFixture,
} from "./fixtures/fourvenuesFixtures";

/** Envuelve un transport contando llamadas por "METHOD path" — para verificar que listOrders/listTickets/listAttendance comparten UNA sola llamada real a /tickets/ por evento (sección 50, ver createTicketsFetcher). */
function withCallCounts(transport: IntegrationTransport): { transport: IntegrationTransport; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  return {
    counts,
    transport: {
      request: (opts) => {
        const key = `${opts.method} ${opts.path}`;
        counts[key] = (counts[key] ?? 0) + 1;
        return transport.request(opts);
      },
    },
  };
}

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

  it("Tía Felisa rollout (spec §9/§63) — evento sin 'start' (campo opcional real) → startsAt=null, NUNCA epoch new Date(0)", async () => {
    const t = createMockTransport({
      "GET /events/": { success: true, data: [{ ...fourvenuesIntEventsFixture.data[0], start: undefined }] },
    });
    const a = createFourvenuesIntegrationsAdapter(t);
    const events = await a.listEvents(credentials);
    expect(events[0].startsAt).toBeNull();
  });

  it("listEvents mapea event.url a externalUrl cuando el proveedor lo envía", async () => {
    const t = createMockTransport({
      "GET /events/": { success: true, data: [{ ...fourvenuesIntEventsFixture.data[0], url: "https://www.fourvenues.com/casanova/fixture" }] },
    });
    const a = createFourvenuesIntegrationsAdapter(t);
    const events = await a.listEvents(credentials);
    expect(events[0].externalUrl).toBe("https://www.fourvenues.com/casanova/fixture");
  });

  it("listEvents deriva sourcePublicationStatus='published' del fixture base (active=true, visible=true)", async () => {
    const events = await adapter.listEvents(credentials);
    expect(events[0].sourcePublicationStatus).toBe("published");
  });

  // FIX-04 — deriveSourcePublicationStatus: confirmado empíricamente contra
  // Casanova/Tía Felisa 2026-08-19 (pre-opening-x-fcking-wednesdays,
  // reportado en borrador por un humano en Fourvenues: active=false,
  // visible=true; "PRUEBA para viernes FV", evento de prueba histórico:
  // active=true, visible=false). NUNCA asume "published" ante ausencia de
  // datos (fail-closed) — ver eventsDb.ts::isEventStudentVisible.
  describe("deriveSourcePublicationStatus (spec §mapper — nunca inventar 'published')", () => {
    it("active=true, visible=true → published", () => {
      expect(deriveSourcePublicationStatus({ active: true, visible: true })).toBe("published");
    });
    it("active=false, visible=true → unpublished (caso real: pre-opening-x-fcking-wednesdays)", () => {
      expect(deriveSourcePublicationStatus({ active: false, visible: true })).toBe("unpublished");
    });
    it("active=true, visible=false → unpublished (caso real: evento de prueba oculto en Fourvenues)", () => {
      expect(deriveSourcePublicationStatus({ active: true, visible: false })).toBe("unpublished");
    });
    it("active=false, visible=false → unpublished", () => {
      expect(deriveSourcePublicationStatus({ active: false, visible: false })).toBe("unpublished");
    });
    it("ambos campos ausentes → unknown, NUNCA published por defecto", () => {
      expect(deriveSourcePublicationStatus({})).toBe("unknown");
    });
    it("solo 'visible' presente (sin 'active') → unpublished, fail-closed (nunca published sin active=true confirmado)", () => {
      expect(deriveSourcePublicationStatus({ visible: true })).toBe("unpublished");
    });
  });

  it("listEvents — proveedor sin active/visible en absoluto (payload legacy) → sourcePublicationStatus='unknown', nunca 'published'", async () => {
    const t = createMockTransport({
      "GET /events/": { success: true, data: [{ ...fourvenuesIntEventsFixture.data[0], active: undefined, visible: undefined }] },
    });
    const a = createFourvenuesIntegrationsAdapter(t);
    const events = await a.listEvents(credentials);
    expect(events[0].sourcePublicationStatus).toBe("unknown");
  });

  it("listTicketTypes aplana options[] eligiendo la opción más barata, precio en céntimos, PERO preserva todas las opciones en raw.options (nunca se pierden)", async () => {
    const types = await adapter.listTicketTypes(credentials, "fvi_evt_001");
    expect(types).toHaveLength(1);
    expect(types[0].priceCents).toBe(800); // 8€ (la opción más barata, no 12€)
    expect(types[0].currency).toBe("EUR");
    expect(Number.isInteger(types[0].priceCents)).toBe(true);
    expect(types[0].raw?.options).toHaveLength(2);
    expect((types[0].raw?.options as { price: number }[])[1].price).toBe(12); // la opción de 12€ sigue accesible, no descartada
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

  it("listTickets expone el importe/fecha REALES de cada entrada individual (no el agregado del pedido), en céntimos", async () => {
    const tickets = await adapter.listTickets(credentials, "fvi_evt_001");
    const t1 = tickets.find(t => t.externalId === "fvi_tkt_001")!;
    expect(t1.amountPaidCents).toBe(835); // 8.35€
    expect(t1.feesCents).toBe(35); // 0.35€
    expect(t1.purchasedAt).toBeInstanceOf(Date);
  });

  it("listOrders/listTickets/listAttendance para el MISMO evento comparten una única llamada de red a GET /tickets/ (nunca 3)", async () => {
    const { transport: counted, counts } = withCallCounts(transport);
    const a = createFourvenuesIntegrationsAdapter(counted);
    await a.listOrders(credentials, "fvi_evt_001");
    await a.listTickets(credentials, "fvi_evt_001");
    await a.listAttendance(credentials, "fvi_evt_001");
    expect(counts["GET /tickets/"]).toBe(1);
  });

  it("una instancia de adapter distinta (otro sync run) NO reutiliza la caché de la anterior", async () => {
    const { transport: counted, counts } = withCallCounts(transport);
    const a1 = createFourvenuesIntegrationsAdapter(counted);
    const a2 = createFourvenuesIntegrationsAdapter(counted);
    await a1.listTickets(credentials, "fvi_evt_001");
    await a2.listTickets(credentials, "fvi_evt_001");
    expect(counts["GET /tickets/"]).toBe(2);
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

  it("Case A (spec §27/71) — 4 tickets del mismo payment_id con participante individual distinto se normalizan como 1 order de 4 tickets con 4 identidades DIFERENTES, 2 asistencias reales", async () => {
    const t = createMockTransport({ "GET /tickets/": fourvenuesIntTicketsCaseAFixture });
    const a = createFourvenuesIntegrationsAdapter(t);
    const orders = await a.listOrders(credentials, "fvi_evt_001");
    const tickets = await a.listTickets(credentials, "fvi_evt_001");
    const attendance = await a.listAttendance(credentials, "fvi_evt_001");

    expect(orders).toHaveLength(1);
    expect(orders[0].totalCents).toBe(3340); // 4 × 8.35€
    expect(tickets).toHaveLength(4);
    expect(new Set(tickets.map(t => t.participant.email)).size).toBe(4); // 4 emails distintos — nunca colapsan al comprador
    expect(attendance).toHaveLength(2); // solo 2 de los 4 asistieron realmente
  });

  it("Case B (spec §28/71) — 4 tickets del mismo payment_id con el MISMO participante se normalizan igualmente como 4 tickets (nunca se deduplican a nivel de adapter — la protección vive en attendancePipeline/ticketPurchasePipeline)", async () => {
    const t = createMockTransport({ "GET /tickets/": fourvenuesIntTicketsCaseBFixture });
    const a = createFourvenuesIntegrationsAdapter(t);
    const tickets = await a.listTickets(credentials, "fvi_evt_001");
    const attendance = await a.listAttendance(credentials, "fvi_evt_001");

    expect(tickets).toHaveLength(4);
    expect(new Set(tickets.map(t => t.participant.email)).size).toBe(1); // el "problema" es real a nivel de dato — mismo email en los 4
    expect(attendance).toHaveLength(4); // el adapter normaliza los 4 hechos de asistencia tal cual — la deduplicación de REWARD, no del hecho, vive en el pipeline
  });

  it("entrada gratuita (0€) se normaliza con amountPaidCents=0, sin error ni división por cero", async () => {
    const t = createMockTransport({ "GET /tickets/": fourvenuesIntTicketFreeFixture });
    const a = createFourvenuesIntegrationsAdapter(t);
    const tickets = await a.listTickets(credentials, "fvi_evt_001");
    const orders = await a.listOrders(credentials, "fvi_evt_001");

    expect(tickets[0].amountPaidCents).toBe(0);
    expect(orders[0].totalCents).toBe(0);
    expect(orders[0].status).toBe("paid"); // gratuita y no reembolsada — sigue siendo un pedido "paid" válido, no un caso especial roto
  });

  it("capabilities refleja lo confirmado empíricamente 2026-08-12", () => {
    expect(adapter.capabilities.individualAttendance).toBe(true);
    expect(adapter.capabilities.orders).toBe(true);
    expect(adapter.capabilities.consumptions).toBe(false);
    expect(adapter.capabilities.webhooks).toBe(false);
  });
});
