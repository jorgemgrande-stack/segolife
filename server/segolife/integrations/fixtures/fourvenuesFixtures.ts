/**
 * fourvenuesFixtures.ts — payloads SINTÉTICOS con la forma documentada en
 * docs/integrations/fourvenues.md (Channel Manager API + Integrations API).
 * Ningún dato personal real — nombres/emails inventados y claramente
 * ficticios. Los fixtures `*IntegrationsFixture` replican la forma
 * confirmada empíricamente 2026-08-12 con las tres API keys reales (ver
 * docs/integrations/fourvenues.md, "Esquemas reales verificados") — nunca
 * los valores reales observados, solo la estructura de campos.
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

// ─── Integrations API (ik_live_... — modelo real de Segolife) ──────────────

export const fourvenuesIntEventsFixture = {
  success: true,
  data: [
    {
      _id: "fvi_evt_001",
      name: "Fixture Night @ Casanova",
      slug: "fixture-night",
      description: "Evento sintético de prueba — no es un evento real.",
      flyer: "https://example.invalid/flyer.jpg",
      start: 1799650800, // 2027-01-10T23:00:00Z (fixture)
      end: 1799672400, // 2027-01-11T05:00:00Z (fixture)
    },
  ],
};

export const fourvenuesIntTicketRatesFixture = {
  success: true,
  data: [
    {
      _id: "fvi_rate_001",
      slug: "acceso-general",
      name: "ACCESO GENERAL",
      options: [
        { _id: "fvi_opt_001", until: 23400, max_quantity: 100, price: 8, age: 18, content: "1 copa antes de la 1:30" },
        { _id: "fvi_opt_002", until: 0, max_quantity: 50, price: 12, age: 18, content: "" },
      ],
    },
  ],
};

export const fourvenuesIntTicketsFixture = {
  success: true,
  data: [
    {
      _id: "fvi_tkt_001",
      code: "FIX0001",
      event_id: "fvi_evt_001",
      rate_id: "fvi_rate_001",
      status: "activated",
      name: "Estudiante de Prueba Uno",
      email: "fixture.uno@example.invalid",
      phone: "+34600000001",
      total_paid: 8.35,
      total_fees: 0.35,
      refunded: 0,
      payment_id: "fvi_pay_001",
      enter: 1,
      entry_date: 1799694000,
      created_at: "2026-09-01T10:00:00.000Z",
      updated_at: "2026-09-12T23:15:00.000Z",
    },
    {
      _id: "fvi_tkt_002",
      code: "FIX0002",
      event_id: "fvi_evt_001",
      rate_id: "fvi_rate_001",
      status: "activated",
      name: "Estudiante de Prueba Dos",
      email: "fixture.dos@example.invalid",
      phone: "+34600000002",
      total_paid: 8.35,
      total_fees: 0.35,
      refunded: 0,
      payment_id: "fvi_pay_001", // mismo payment_id — mismo pedido que fvi_tkt_001
      enter: 0,
      entry_date: undefined,
      created_at: "2026-09-01T10:00:00.000Z",
      updated_at: "2026-09-01T10:00:00.000Z",
    },
    {
      _id: "fvi_tkt_003",
      code: "FIX0003",
      event_id: "fvi_evt_001",
      rate_id: "fvi_rate_001",
      status: "activated",
      name: "Estudiante de Prueba Tres",
      email: "fixture.tres@example.invalid",
      phone: "+34600000003",
      total_paid: 12,
      total_fees: 0,
      refunded: 1,
      payment_id: "fvi_pay_002",
      enter: 0,
      entry_date: undefined,
      created_at: "2026-09-02T10:00:00.000Z",
      updated_at: "2026-09-05T09:00:00.000Z",
    },
  ],
};

/** Entrada gratuita (0€) — comprada Y asistida, para probar que 0€ excluye tokens por importe pero no por asistencia (spec §30). */
export const fourvenuesIntTicketFreeFixture = {
  success: true,
  data: [{
    _id: "fvi_tkt_free_001",
    code: "FIXF0001",
    event_id: "fvi_evt_001",
    rate_id: "fvi_rate_001",
    status: "activated",
    name: "Estudiante Becado",
    email: "fixture.becado@example.invalid",
    phone: "+34600000009",
    total_paid: 0,
    total_fees: 0,
    refunded: 0,
    payment_id: "fvi_pay_free",
    enter: 1,
    entry_date: 1799694000,
    created_at: "2026-09-03T10:00:00.000Z",
    updated_at: "2026-09-03T10:00:00.000Z",
  }],
};

/**
 * Case B (spec §28, "MULTI-TICKET CASE B — PROTECCIÓN OBLIGATORIA"): 4
 * tickets del MISMO payment_id, los 4 con el MISMO email/teléfono/nombre —
 * Fourvenues replicó los datos del comprador porque su checkout no pidió el
 * nombre de cada asistente. Sin protección, esto resolvería a un único
 * Student 4 veces para el mismo evento. Ver attendancePipeline.ts (Case B)
 * y ticketPurchasePipeline.test.ts.
 */
export const fourvenuesIntTicketsCaseBFixture = {
  success: true,
  data: [1, 2, 3, 4].map(n => ({
    _id: `fvi_tkt_caseb_${n}`,
    code: `FIXB000${n}`,
    event_id: "fvi_evt_001",
    rate_id: "fvi_rate_001",
    status: "activated",
    name: "Comprador Único",
    email: "comprador.unico@example.invalid",
    phone: "+34600000099",
    total_paid: 8.35,
    total_fees: 0.35,
    refunded: 0,
    payment_id: "fvi_pay_caseb",
    enter: 1,
    entry_date: 1799694000,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
  })),
};

/**
 * Case A: mismo payment_id, 4 tickets con participante INDIVIDUAL distinto
 * cada uno — el escenario "bien resuelto" que confirma que Fourvenues SÍ
 * puede dar datos por asistente cuando el venue los pide en su checkout.
 */
export const fourvenuesIntTicketsCaseAFixture = {
  success: true,
  data: [1, 2, 3, 4].map(n => ({
    _id: `fvi_tkt_casea_${n}`,
    code: `FIXA000${n}`,
    event_id: "fvi_evt_001",
    rate_id: "fvi_rate_001",
    status: "activated",
    name: `Asistente Individual ${n}`,
    email: `asistente.${n}@example.invalid`,
    phone: `+3460000010${n}`,
    total_paid: 8.35,
    total_fees: 0.35,
    refunded: 0,
    payment_id: "fvi_pay_casea",
    enter: n <= 2 ? 1 : 0, // 2 de los 4 asisten realmente — no todos los tickets pagados implican asistencia
    entry_date: n <= 2 ? 1799694000 : undefined,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
  })),
};
