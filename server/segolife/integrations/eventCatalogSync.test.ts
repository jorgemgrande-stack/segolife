/**
 * eventCatalogSync.test.ts — orquestación de syncEventCatalog/syncTicketTypes
 * (Fourvenues Operational Sync). Mismo patrón que attendancePipeline.test.ts:
 * se mockean los límites del módulo (eventsDb.ts) y se usa un fake mínimo de
 * `conn` que responde en el ORDEN EXACTO en que eventCatalogSync.ts emite
 * sus queries — se prueba la orquestación (matching/field ownership/
 * ambigüedad), no la semántica de drizzle-orm en sí.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateEvent, mockUpdateEvent, mockGetEventBySlug } = vi.hoisted(() => ({
  mockCreateEvent: vi.fn(),
  mockUpdateEvent: vi.fn(),
  mockGetEventBySlug: vi.fn(),
}));

vi.mock("../../db/eventsDb", () => ({
  createEvent: mockCreateEvent,
  updateEvent: mockUpdateEvent,
  getEventBySlug: mockGetEventBySlug,
}));

import { syncEventCatalog, syncTicketTypes } from "./eventCatalogSync";

function awaitableRows(rows: unknown[]) {
  return {
    then: (resolve: (v: unknown[]) => void) => Promise.resolve(rows).then(resolve),
    limit: async (n: number) => rows.slice(0, n),
  };
}

/** `selectQueue` — una entrada por cada `conn.select(...).from(...).where(...)` esperado, EN ORDEN. */
function fakeDb(selectQueue: unknown[][]) {
  let i = 0;
  const inserts: Array<{ values: Record<string, unknown>; ignored: boolean }> = [];
  const updates: Array<{ values: Record<string, unknown> }> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => awaitableRows(selectQueue[i++] ?? []),
      }),
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        inserts.push({ values, ignored: false });
        return [{ insertId: 9001 }];
      },
      ignore: () => ({
        values: async (values: Record<string, unknown>) => {
          inserts.push({ values, ignored: true });
          return [{ insertId: 0 }];
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push({ values });
          return [{ affectedRows: 1 }];
        },
      }),
    }),
  };
  return { db: db as never, inserts, updates };
}

function normalizedEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    externalId: "fvi_evt_001",
    name: "Fixture Night @ Casanova",
    description: "desc",
    imageUrl: "https://example.invalid/flyer.jpg",
    startsAt: new Date("2027-01-10T23:00:00.000Z"),
    endsAt: new Date("2027-01-11T05:00:00.000Z"),
    sourcePublicationStatus: "published" as const,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEventBySlug.mockResolvedValue(null);
});

describe("syncEventCatalog — matching (spec §12-13)", () => {
  it("mapping ya confirmado, el evento YA tiene su propia descripción → SOLO actualiza fecha/hora/estado de publicación (nunca nombre/imagen/descripción real)", async () => {
    const { db, updates, inserts } = fakeDb([
      [{ internalId: 42 }], // existingMapping
      [{ sourcePublicationStatus: "published", description: "Ya tiene su propio texto en Segolife" }], // getEventPreUpdateState (before)
    ]);
    mockUpdateEvent.mockResolvedValue({ id: 42 });

    const result = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent()],
    }, db);

    expect(result.items[0]).toMatchObject({ outcome: "mapped_existing", eventId: 42 });
    expect(mockUpdateEvent).toHaveBeenCalledWith(42, { startsAt: normalizedEvent().startsAt, endsAt: normalizedEvent().endsAt, sourcePublicationStatus: "published" }, db);
    expect(mockCreateEvent).not.toHaveBeenCalled();
    expect(inserts.some(i => "externalId" in i.values)).toBe(false); // no crea un mapping nuevo, ya existía
    expect(updates).toHaveLength(0); // el update pasa por eventsDb (mockeado), no por conn.update directo
  });

  // 2026-08-23 — hallazgo real "Felisa's been expecting you" (evento 200):
  // Fourvenues se crea con lo mínimo y el texto de marketing se escribe
  // DESPUÉS del primer sync — sin este backfill, la descripción vacía
  // quedaba cerrada para siempre. Ver EXCEPCIÓN en la cabecera del archivo.
  it("mapping ya confirmado, la descripción sigue VACÍA en Segolife → SÍ se rellena desde Fourvenues en este sync", async () => {
    const { db } = fakeDb([
      [{ internalId: 42 }], // existingMapping
      [{ sourcePublicationStatus: "published", description: "" }], // getEventPreUpdateState (before) — sin escribir todavía
    ]);
    mockUpdateEvent.mockResolvedValue({ id: 42 });

    await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent({ description: "FELISA'S BEEN EXPECTING YOU…" })],
    }, db);

    expect(mockUpdateEvent).toHaveBeenCalledWith(42, {
      startsAt: normalizedEvent().startsAt, endsAt: normalizedEvent().endsAt, sourcePublicationStatus: "published",
      description: "FELISA'S BEEN EXPECTING YOU…",
    }, db);
  });

  it("mapping ya confirmado, descripción vacía en Segolife PERO Fourvenues tampoco trae ninguna → nunca añade la clave description al update (no-op, no escribe un vacío sobre un vacío)", async () => {
    const { db } = fakeDb([
      [{ internalId: 42 }], // existingMapping
      [{ sourcePublicationStatus: "published", description: null }], // getEventPreUpdateState (before)
    ]);
    mockUpdateEvent.mockResolvedValue({ id: 42 });

    await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent({ description: null })],
    }, db);

    expect(mockUpdateEvent).toHaveBeenCalledWith(42, { startsAt: normalizedEvent().startsAt, endsAt: normalizedEvent().endsAt, sourcePublicationStatus: "published" }, db);
  });

  it("sin mapping y sin candidato → crea un evento nuevo gobernado por Fourvenues + mapping", async () => {
    const { db, inserts } = fakeDb([
      [], // existingMapping
      [], // alreadyMapped (findUnambiguousCandidate)
      [], // sameVenue
    ]);
    mockCreateEvent.mockResolvedValue({ id: 77 });

    const result = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [3], normalizedEvents: [normalizedEvent()],
    }, db);

    expect(result.items[0]).toMatchObject({ outcome: "created", eventId: 77 });
    expect(result.createdCount).toBe(1);
    expect(mockCreateEvent).toHaveBeenCalledOnce();
    expect(mockCreateEvent.mock.calls[0][0]).toMatchObject({ name: "Fixture Night @ Casanova", venueId: 10, sourceType: "integration:fourvenues_integrations" });
    expect(inserts.some(i => i.values.externalType === "event" && i.values.internalId === 77)).toBe(true);
  });

  it("sin mapping, exactamente 1 candidato inequívoco (mismo venue+día+nombre normalizado) CON su propia descripción → lo ADOPTA sin sobreescribir su contenido editorial", async () => {
    const candidateEvent = { id: 55, name: "Fixture Night @ Casanova", venueId: 10, startsAt: new Date("2027-01-10T23:00:00.000Z"), description: "Descripción nativa ya escrita" };
    const { db, inserts } = fakeDb([
      [], // existingMapping
      [], // alreadyMapped
      [candidateEvent], // sameVenue
    ]);

    const result = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent()],
    }, db);

    expect(result.items[0]).toMatchObject({ outcome: "candidate_adopted", eventId: 55 });
    expect(mockCreateEvent).not.toHaveBeenCalled();
    // FIX-04 — adoptar SÍ registra el origen (antes no quedaba rastro de que
    // este evento nativo ya estaba vinculado a Fourvenues, y
    // isEventStudentVisible() nunca podía protegerlo) — pero NUNCA toca
    // contenido editorial (name/description/imageUrl) YA EXISTENTE, que es
    // lo que esta prueba protege realmente.
    expect(mockUpdateEvent).toHaveBeenCalledWith(55, {
      sourceType: "integration:fourvenues_integrations", sourceId: 1, sourcePublicationStatus: "published",
    }, db);
    expect(inserts.some(i => i.values.externalType === "event" && i.values.internalId === 55)).toBe(true);
  });

  it("candidato adoptado SIN descripción propia (nativo, nunca escrita) → SÍ se rellena desde Fourvenues (mismo criterio que mapped_existing, spec 'Felisa's been expecting you')", async () => {
    const candidateEvent = { id: 55, name: "Fixture Night @ Casanova", venueId: 10, startsAt: new Date("2027-01-10T23:00:00.000Z"), description: "" };
    const { db } = fakeDb([
      [], // existingMapping
      [], // alreadyMapped
      [candidateEvent], // sameVenue
    ]);

    await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent({ description: "Texto real de Fourvenues" })],
    }, db);

    expect(mockUpdateEvent).toHaveBeenCalledWith(55, {
      sourceType: "integration:fourvenues_integrations", sourceId: 1, sourcePublicationStatus: "published",
      description: "Texto real de Fourvenues",
    }, db);
  });

  it("sin mapping, ≥2 candidatos ambiguos → NO autovincula NI crea duplicado, se omite del sync", async () => {
    const candidate1 = { id: 55, name: "Fixture Night @ Casanova", venueId: 10, startsAt: new Date("2027-01-10T23:00:00.000Z") };
    // normalizedEvent().startsAt = 2027-01-10T23:00:00Z = 2027-01-11T00:00 en Europe/Madrid (CET, UTC+1, sin DST en enero) — candidate2 debe caer en ESE mismo día Madrid para ser un candidato genuinamente ambiguo.
    const candidate2 = { id: 56, name: "Fixture Night @ Casanova", venueId: 10, startsAt: new Date("2027-01-11T20:00:00.000Z") };
    const { db, inserts } = fakeDb([
      [], // existingMapping
      [], // alreadyMapped
      [candidate1, candidate2], // sameVenue — 2 candidatos
    ]);

    const result = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent()],
    }, db);

    expect(result.ambiguousCount).toBe(1);
    expect(result.items[0].outcome).toBe("ambiguous");
    expect(result.items[0].eventId).toBeNull();
    expect(mockCreateEvent).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("un candidato con nombre distinto (aunque parecido) NUNCA hace match — sin fuzzy", async () => {
    const almostSame = { id: 55, name: "Fixture Night @ Casanova Vol 2", venueId: 10, startsAt: new Date("2027-01-10T23:00:00.000Z") };
    const { db } = fakeDb([
      [], // existingMapping
      [], // alreadyMapped
      [almostSame], // sameVenue — nombre distinto, no debería contar como candidato
    ]);
    mockCreateEvent.mockResolvedValue({ id: 99 });

    const result = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent()],
    }, db);

    // findUnambiguousCandidate filtra en memoria por nombre exacto — "Vol 2" no matchea, candidates.length === 0 → crea nuevo.
    expect(result.items[0].outcome).toBe("created");
  });
});

describe("syncEventCatalog — publicationTransition (FIX-05, base para notificaciones Admin)", () => {
  it("mapped_existing: sourcePublicationStatus cambia (unpublished→published) → publicationTransition poblado", async () => {
    const { db } = fakeDb([
      [{ internalId: 42 }], // existingMapping
      [{ sourcePublicationStatus: "unpublished" }], // getCurrentPublicationStatus (before)
    ]);
    mockUpdateEvent.mockResolvedValue({ id: 42 });

    const result = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent({ sourcePublicationStatus: "published" })],
    }, db);

    expect(result.items[0].publicationTransition).toMatchObject({ eventId: 42, from: "unpublished", to: "published" });
  });

  it("mapped_existing: sourcePublicationStatus NO cambia (published→published) → publicationTransition=null (nunca notifica por un no-cambio)", async () => {
    const { db } = fakeDb([
      [{ internalId: 42 }], // existingMapping
      [{ sourcePublicationStatus: "published" }], // getCurrentPublicationStatus (before) — igual al nuevo valor
    ]);
    mockUpdateEvent.mockResolvedValue({ id: 42 });

    const result = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent({ sourcePublicationStatus: "published" })],
    }, db);

    expect(result.items[0].publicationTransition).toBeNull();
  });

  it("created: evento nunca visto antes, llega ya published → publicationTransition {from:null, to:'published'} (spec §26, no necesita pasar por unpublished)", async () => {
    const { db } = fakeDb([
      [], // existingMapping
      [], // alreadyMapped
      [], // sameVenue
    ]);
    mockCreateEvent.mockResolvedValue({ id: 77 });

    const result = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent({ sourcePublicationStatus: "published" })],
    }, db);

    expect(result.items[0].publicationTransition).toMatchObject({ eventId: 77, from: null, to: "published" });
  });

  it("candidate_adopted: origen Fourvenues nunca registrado antes → publicationTransition {from:null, to:...}", async () => {
    const candidateEvent = { id: 55, name: "Fixture Night @ Casanova", venueId: 10, startsAt: new Date("2027-01-10T23:00:00.000Z") };
    const { db } = fakeDb([
      [], // existingMapping
      [], // alreadyMapped
      [candidateEvent], // sameVenue
    ]);

    const result = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent({ sourcePublicationStatus: "unpublished" })],
    }, db);

    expect(result.items[0].publicationTransition).toMatchObject({ eventId: 55, from: null, to: "unpublished" });
  });

  it("invalid_missing_startsAt / ambiguous → publicationTransition siempre null (ningún evento se toca)", async () => {
    const { db: db1 } = fakeDb([]);
    const invalidResult = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent({ startsAt: null })],
    }, db1);
    expect(invalidResult.items[0].publicationTransition).toBeNull();

    const candidate1 = { id: 55, name: "Fixture Night @ Casanova", venueId: 10, startsAt: new Date("2027-01-10T23:00:00.000Z") };
    const candidate2 = { id: 56, name: "Fixture Night @ Casanova", venueId: 10, startsAt: new Date("2027-01-11T20:00:00.000Z") };
    const { db: db2 } = fakeDb([[], [], [candidate1, candidate2]]);
    const ambiguousResult = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent()],
    }, db2);
    expect(ambiguousResult.items[0].publicationTransition).toBeNull();
  });
});

describe("syncEventCatalog — startsAt ausente (Tía Felisa rollout, spec §9/§63)", () => {
  it("evento SIN mapping y startsAt=null → outcome 'invalid_missing_startsAt', NUNCA crea el evento ni un mapping, NUNCA inventa epoch", async () => {
    const { db, inserts } = fakeDb([]); // ni siquiera se llega a consultar existingMapping — se descarta antes

    const result = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent({ startsAt: null })],
    }, db);

    expect(result.items[0]).toMatchObject({ outcome: "invalid_missing_startsAt", eventId: null });
    expect(result.invalidCount).toBe(1);
    expect(result.createdCount).toBe(0);
    expect(mockCreateEvent).not.toHaveBeenCalled();
    expect(mockUpdateEvent).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0); // ni el evento ni el mapping se tocan
  });

  it("evento YA MAPEADO y startsAt=null en este run → outcome 'invalid_missing_startsAt', NUNCA llama a updateEvent (conserva su fecha anterior intacta)", async () => {
    const { db } = fakeDb([]); // no debería ni consultar existingMapping

    const result = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [], normalizedEvents: [normalizedEvent({ startsAt: null })],
    }, db);

    expect(result.items[0].outcome).toBe("invalid_missing_startsAt");
    expect(mockUpdateEvent).not.toHaveBeenCalled(); // nunca escribe una fecha inválida sobre un evento ya existente
  });

  it("lote mixto (1 evento válido + 1 sin startsAt) → el válido se procesa con normalidad, el inválido queda aparte — ZERO SILENT DROP, ninguno desaparece", async () => {
    const { db, inserts } = fakeDb([
      [], // existingMapping del evento VÁLIDO
      [], // alreadyMapped
      [], // sameVenue
    ]);
    mockCreateEvent.mockResolvedValue({ id: 77 });

    const result = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      venueId: 10, communityIds: [],
      normalizedEvents: [
        normalizedEvent({ externalId: "fvi_evt_valid", startsAt: new Date("2027-01-10T23:00:00.000Z") }),
        normalizedEvent({ externalId: "fvi_evt_sin_fecha", name: "Evento sin fecha", startsAt: null }),
      ],
    }, db);

    expect(result.items).toHaveLength(2);
    expect(result.items.find(i => i.externalId === "fvi_evt_valid")).toMatchObject({ outcome: "created", eventId: 77 });
    expect(result.items.find(i => i.externalId === "fvi_evt_sin_fecha")).toMatchObject({ outcome: "invalid_missing_startsAt", eventId: null });
    expect(result.createdCount).toBe(1);
    expect(result.invalidCount).toBe(1);
    expect(inserts.some(i => i.values.externalId === "fvi_evt_valid")).toBe(true);
    expect(inserts.some(i => i.values.externalId === "fvi_evt_sin_fecha")).toBe(false);
  });
});

describe("syncTicketTypes", () => {
  it("rate nueva → crea event_ticket_type + mapping, precio ya en céntimos", async () => {
    const { db, inserts } = fakeDb([[]]); // sin mapping previo

    const result = await syncTicketTypes({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1, eventId: 77,
      normalizedTicketTypes: [{ externalId: "fvi_rate_001", externalEventId: "fvi_evt_001", name: "ACCESO GENERAL", priceCents: 800, currency: "EUR", capacity: 100, raw: { options: [{ price: 8 }, { price: 12 }] } }],
    }, db);

    expect(result.createdCount).toBe(1);
    expect(result.ticketTypeIdByExternalId.get("fvi_rate_001")).toBe(9001);
    const ticketTypeInsert = inserts.find(i => "priceCents" in i.values);
    expect(ticketTypeInsert?.values).toMatchObject({ priceCents: 800, eventId: 77 });
    expect((ticketTypeInsert?.values.metadata as { options: unknown[] }).options).toHaveLength(2); // las opciones no elegidas NO se pierden
  });

  it("rate ya mapeada → actualiza precio/capacidad, no duplica", async () => {
    const { db, updates } = fakeDb([[{ internalId: 500 }]]); // mapping existente

    const result = await syncTicketTypes({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1, eventId: 77,
      normalizedTicketTypes: [{ externalId: "fvi_rate_001", externalEventId: "fvi_evt_001", name: "ACCESO GENERAL", priceCents: 900, currency: "EUR" }],
    }, db);

    expect(result.updatedCount).toBe(1);
    expect(result.ticketTypeIdByExternalId.get("fvi_rate_001")).toBe(500);
    expect(updates[0].values).toMatchObject({ priceCents: 900 });
  });
});
