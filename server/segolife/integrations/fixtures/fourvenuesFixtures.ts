/**
 * fourvenuesFixtures.ts — payloads SINTÉTICOS con la forma documentada en
 * docs/integrations/fourvenues.md (Channel Manager API). Ningún dato
 * personal real — nombres/emails inventados y claramente ficticios.
 */
export const fourvenuesAuthFixture = {
  channel: { _id: "channel_segolife", name: "Segolife" },
  hosts: [
    { _id: "org_casanova", name: "Casanova" },
    { _id: "org_tia_felisa", name: "Tía Felisa" },
  ],
};

export const fourvenuesEventsFixture = {
  data: [
    {
      _id: "fv_evt_001",
      name: "Erasmus Night @ Casanova (fixture)",
      slug: "erasmus-night-fixture",
      description: "Evento sintético de prueba — no es un evento real.",
      image: "https://example.invalid/flyer.jpg",
      start_date: "2026-09-12T23:00:00.000Z",
      end_date: "2026-09-13T05:00:00.000Z",
      location_id: "loc_casanova",
    },
  ],
};

export const fourvenuesTicketRatesFixture = {
  data: [
    {
      _id: "fv_rate_001",
      event_id: "fv_evt_001",
      name: "General (fixture)",
      current_price: { amount_cents: 1500, currency: "EUR" },
      availability: { available: 200 },
      start_sale: "2026-09-01T00:00:00.000Z",
      end_sale: "2026-09-12T22:00:00.000Z",
    },
  ],
};

export const fourvenuesPaymentsFixture = {
  data: [
    {
      _id: "fv_pay_001",
      status: "paid",
      event_id: "fv_evt_001",
      resource_ids: ["fv_tkt_001"],
      total: { amount_cents: 1500, fees_cents: 100, currency: "EUR" },
      paid_at: "2026-09-05T10:00:00.000Z",
    },
  ],
};

export const fourvenuesTicketsFixture = {
  data: [
    {
      _id: "fv_tkt_001",
      event_id: "fv_evt_001",
      ticket_rate_id: "fv_rate_001",
      status: "active",
      full_name: "Estudiante de Prueba",
      email: "fixture.student@example.invalid",
      phone: "+34600000001",
    },
  ],
};
