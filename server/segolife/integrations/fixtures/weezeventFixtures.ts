/**
 * weezeventFixtures.ts — payloads SINTÉTICOS con la forma documentada en
 * docs/integrations/weezevent.md. Ningún dato personal real.
 */
export const weezeventAuthFixture = { accessToken: "fixture-access-token" };

// Cierre F71 (2026-08-23) — `date.start`/`date.end` ANIDADOS, confirmado
// contra una respuesta real de producción (nunca campos planos start/end,
// como se asumía antes de tener credenciales reales).
export const weezeventEventsFixture = {
  events: [
    { id: 501, name: "Tankers Festival (fixture)", date: { start: "2026-10-03T18:00:00.000Z", end: "2026-10-04T04:00:00.000Z" }, site_url: "https://example.invalid/tankers" },
  ],
};

// Cierre F71 (2026-08-23) — forma real confirmada contra producción:
// { events: [{ id, categories: [{ id, name, tickets: [...] }] }] }, NUNCA
// { tickets: [...] } plano.
export const weezeventTicketsFixture = {
  events: [
    {
      id: 501,
      categories: [
        {
          id: "9000", name: "GENERAL SALES (fixture)",
          tickets: [
            { id: "9001", name: "Early Bird (fixture)", price: 25, quotas: 100, participants: 10, start_sale: "2026-08-01T00:00:00.000Z", end_sale: "2026-09-30T23:59:00.000Z" },
          ],
        },
      ],
    },
  ],
};

export const weezeventParticipantsNotScannedFixture = {
  participants: [
    {
      id_participant: 700001,
      id_event: 501,
      id_ticket: 9001,
      id_transaction: "wz_txn_001",
      owner: { email: "fixture.buyer@example.invalid", phone: "+34600000002", first_name: "Fixture", last_name: "Buyer" },
      control_status: { status: "0", scan_date: "0000-00-00 00:00:00", scan_user_name: "" },
      deleted: false,
    },
  ],
};

export const weezeventParticipantsScannedFixture = {
  participants: [
    {
      id_participant: 700002,
      id_event: 501,
      id_ticket: 9001,
      id_transaction: "wz_txn_002",
      owner: { email: "fixture.attendee@example.invalid", phone: "+34600000003", first_name: "Fixture", last_name: "Attendee" },
      control_status: { status: "1", scan_date: "2026-10-03T22:15:00.000Z", scan_user_name: "Door Staff Fixture" },
      deleted: false,
    },
  ],
};
