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

  it("getWeezeventAccessToken envía Content-Type application/x-www-form-urlencoded con username/password/api_key en el body — la doc oficial exige form-encoding, no JSON, para este endpoint", async () => {
    let capturedOpts: { headers?: Record<string, string>; body?: unknown } | undefined;
    const transport = createMockTransport({
      "POST /auth/access_token": (_q, opts) => { capturedOpts = opts; return weezeventAuthFixture; },
    });
    await getWeezeventAccessToken(transport, credentials);
    expect(capturedOpts?.headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(capturedOpts?.body).toMatchObject({ username: credentials.username, password: credentials.password, api_key: credentials.apiKey });
  });

  it("listEvents normaliza eventos", async () => {
    const transport = createMockTransport({ "GET /events": weezeventEventsFixture });
    const adapter = createWeezeventAdapter(transport);
    const events = await adapter.listEvents(credentials);
    expect(events[0].externalId).toBe("501");
    expect(events[0].name).toContain("Tankers");
  });

  it("listEvents lee startsAt/endsAt de date.start/date.end ANIDADOS — regresión real: confirmado contra producción que Weezevent nunca los manda como campos planos", async () => {
    const transport = createMockTransport({ "GET /events": weezeventEventsFixture });
    const adapter = createWeezeventAdapter(transport);
    const events = await adapter.listEvents(credentials);
    expect(events[0].startsAt).toEqual(new Date("2026-10-03T18:00:00.000Z"));
    expect(events[0].endsAt).toEqual(new Date("2026-10-04T04:00:00.000Z"));
  });

  it("listEvents captura sales_status.libelle_status en raw — señal real de publicación, aunque no se use para sourcePublicationStatus (sin catálogo confirmado de todos los id_status)", async () => {
    const transport = createMockTransport({
      "GET /events": { events: [{ id: 501, name: "Fixture", date: {}, sales_status: { id_status: 5, libelle_status: "Évènement non publié ou clôturé" } }] },
    });
    const adapter = createWeezeventAdapter(transport);
    const events = await adapter.listEvents(credentials);
    expect((events[0].raw as { salesStatusLabel?: string }).salesStatusLabel).toBe("Évènement non publié ou clôturé");
    expect(events[0].sourcePublicationStatus).toBe("unknown");
  });

  it("listTicketTypes convierte price (euros) a priceCents enteros", async () => {
    const transport = createMockTransport({ "GET /tickets": weezeventTicketsFixture });
    const adapter = createWeezeventAdapter(transport);
    const types = await adapter.listTicketTypes(credentials, "501");
    expect(types[0].priceCents).toBe(2500);
    expect(Number.isInteger(types[0].priceCents)).toBe(true);
  });

  it("listTicketTypes navega events[].categories[].tickets[] ANIDADOS — regresión real: confirmado contra producción (5 categorías reales, decenas de tarifas) que la API nunca devuelve { tickets: [...] } plano", async () => {
    const transport = createMockTransport({
      "GET /tickets": {
        events: [{
          id: 501,
          categories: [
            { id: "c1", name: "GENERAL", tickets: [{ id: "t1", name: "Drop 1", price: 10, quotas: 100, participants: 5 }, { id: "t2", name: "Drop 2", price: 20, quotas: 50, participants: 0 }] },
            { id: "c2", name: "VIP", tickets: [{ id: "t3", name: "VIP 1", price: 100, quotas: 1, participants: 0 }] },
          ],
        }],
      },
    });
    const adapter = createWeezeventAdapter(transport);
    const types = await adapter.listTicketTypes(credentials, "501");
    expect(types).toHaveLength(3);
    expect(types.map(t => t.externalId)).toEqual(["t1", "t2", "t3"]);
    expect(types[0].capacity).toBe(100);
    expect((types[0].raw as { categoryName?: string }).categoryName).toBe("GENERAL");
    expect((types[2].raw as { categoryName?: string }).categoryName).toBe("VIP");
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

  it("listTickets trata deleted='0' (string) como NO eliminado — regresión real: '0' es truthy en JS, nunca confiar en !p.deleted directamente", async () => {
    const transport = createMockTransport({
      "GET /participant/list": {
        participants: [{ ...weezeventParticipantsNotScannedFixture.participants[0], deleted: "0" }],
      },
    });
    const adapter = createWeezeventAdapter(transport);
    const tickets = await adapter.listTickets(credentials, "501");
    expect(tickets).toHaveLength(1);
  });

  it("listTickets excluye deleted='1' (string) y deleted=1 (number), no solo deleted=true (boolean)", async () => {
    const base = weezeventParticipantsNotScannedFixture.participants[0];
    const transport = createMockTransport({
      "GET /participant/list": {
        participants: [
          { ...base, id_participant: 1, deleted: "1" },
          { ...base, id_participant: 2, deleted: 1 },
          { ...base, id_participant: 3, deleted: true },
        ],
      },
    });
    const adapter = createWeezeventAdapter(transport);
    const tickets = await adapter.listTickets(credentials, "501");
    expect(tickets).toHaveLength(0);
  });

  it("listTickets reconoce refund como escalar '1' (no solo como objeto {status})— la doc oficial lo describe como escalar", async () => {
    const base = weezeventParticipantsNotScannedFixture.participants[0];
    const transport = createMockTransport({
      "GET /participant/list": { participants: [{ ...base, refund: "1" }] },
    });
    const adapter = createWeezeventAdapter(transport);
    const tickets = await adapter.listTickets(credentials, "501");
    expect(tickets[0].status).toBe("refunded");
  });

  it("listTickets/listAttendance paginan /participant/list hasta agotar resultados (max/page) — un evento con más participantes que una página no debe perder datos en silencio", async () => {
    const base = weezeventParticipantsNotScannedFixture.participants[0];
    const pageSize = 500;
    let calls = 0;
    const transport = createMockTransport({
      "GET /participant/list": (query) => {
        calls++;
        const page = Number(query?.page ?? 1);
        if (page === 1) {
          return { participants: Array.from({ length: pageSize }, (_, i) => ({ ...base, id_participant: i + 1 })) };
        }
        if (page === 2) {
          return { participants: [{ ...base, id_participant: pageSize + 1 }] }; // última página, menos de pageSize → detiene la paginación
        }
        throw new Error(`no debería pedirse la página ${page}`);
      },
    });
    const adapter = createWeezeventAdapter(transport);
    const tickets = await adapter.listTickets(credentials, "501");
    expect(tickets).toHaveLength(pageSize + 1);
    expect(calls).toBe(2);
  });

  it("capabilities refleja exactamente lo confirmado en docs/integrations/weezevent.md", () => {
    const adapter = createWeezeventAdapter(createMockTransport({}));
    expect(adapter.capabilities.individualAttendance).toBe(true);
    expect(adapter.capabilities.orders).toBe(false);
    expect(adapter.capabilities.webhooks).toBe(false);
    expect(adapter.capabilities.checkout).toBe(false);
  });
});
