/**
 * historicalIdentityService.test.ts — SEGOLIFE HISTORICAL STUDENT IDENTITY
 * CLAIM (spec §60). Se mockean los módulos importados (unresolvedOperationsService,
 * attendancePipeline, studentAdminActionsDb) y se usa un fake `db` mínimo
 * cuyas respuestas dependen de QUÉ TABLA se consulta (no del orden estricto,
 * a diferencia de eventCatalogSync.test.ts — este servicio interlava
 * queries a varias tablas distintas).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { unresolvedOperations, users, events, venues, eventTickets, studentProfiles } from "../../../drizzle/schema";

const { mockLinkUnresolvedOperation, mockIgnoreUnresolvedOperation, mockIngestAttendance, mockRecordStudentAdminAction } = vi.hoisted(() => ({
  mockLinkUnresolvedOperation: vi.fn(),
  mockIgnoreUnresolvedOperation: vi.fn(),
  mockIngestAttendance: vi.fn(),
  mockRecordStudentAdminAction: vi.fn(),
}));

vi.mock("../integrations/unresolvedOperationsService", async () => {
  const actual = await vi.importActual<typeof import("../integrations/unresolvedOperationsService")>("../integrations/unresolvedOperationsService");
  return {
    ...actual,
    linkUnresolvedOperation: mockLinkUnresolvedOperation,
    ignoreUnresolvedOperation: mockIgnoreUnresolvedOperation,
  };
});
vi.mock("../ticketing/attendancePipeline", () => ({ ingestAttendance: mockIngestAttendance }));
vi.mock("./studentAdminActionsDb", () => ({ recordStudentAdminAction: mockRecordStudentAdminAction }));

import {
  classifyMatch, normalizePhone, normalizeEmail, identityKeyFor,
  listHistoricalIdentities, claimHistoricalIdentity, unclaimHistoricalIdentity,
  getHistoricalIdentityStats,
  getHistoricalIdentityStatsByVenue,
  getMyHistoricalMatchPreview, claimMyHistoricalIdentity, resolveHistoricalIdentityBestEffort,
  getHistoricalOverviewForStudent, getHistoricalTimelineForStudent,
  HistoricalIdentityError,
} from "./historicalIdentityService";
import { UnresolvedOperationError } from "../integrations/unresolvedOperationsService";

/** Fake db — responde por tabla (`from(table)`), no por orden estricto. */
function fakeDb(opts: {
  usersRows?: Array<{ id: number; email?: string | null; phone?: string | null }>;
  unresolvedRows?: unknown[];
  eventsRows?: Array<{ id: number; name: string }>;
  venuesRows?: Array<{ id: number; name: string }>;
  studentProfileRows?: Array<{ id: number }>;
}) {
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const executed: unknown[] = [];

  const db = {
    select: (_cols?: unknown) => ({
      from: (table: unknown) => {
        const rowsFor = () => {
          if (table === users) return opts.usersRows ?? [];
          if (table === unresolvedOperations) return opts.unresolvedRows ?? [];
          if (table === events) return opts.eventsRows ?? [];
          if (table === venues) return opts.venuesRows ?? [];
          if (table === studentProfiles) return opts.studentProfileRows ?? [];
          return [];
        };
        return {
          // select(...).from(table) sin .where() — usado por loadAllIdentityGroups para traer TODOS los users.
          then: (resolve: (v: unknown[]) => void) => Promise.resolve(rowsFor()).then(resolve),
          where: (_cond?: unknown) => ({
            limit: async (n: number) => rowsFor().slice(0, n),
            then: (resolve: (v: unknown[]) => void) => Promise.resolve(rowsFor()).then(resolve),
          }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { updates.push({ table, values }); return [{ affectedRows: 1 }]; },
      }),
    }),
    execute: async (_sql: unknown) => {
      executed.push(_sql);
      return [{ affectedRows: 1 }];
    },
    __updates: updates,
    __executed: executed,
  };
  return db as unknown as Parameters<typeof classifyMatch>[2] & { __updates: typeof updates; __executed: typeof executed };
}

function unresolvedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, operationType: "order", provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
    referenceType: "event_ticket", referenceId: 501, externalReferenceId: "ext-1", eventId: 10, venueId: 1,
    occurredAt: new Date("2026-01-15T20:00:00Z"), identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222",
    identityHintName: "Ana", amountCents: 1500, status: "unresolved", linkedUserId: null, linkedByUserId: null, linkedAt: null,
    createdAt: new Date("2026-01-15T20:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizePhone", () => {
  it("trim + quita espacios/guiones/paréntesis", () => {
    expect(normalizePhone(" +34 600 111 222 ")).toBe("+34600111222");
    expect(normalizePhone("(34) 600-111-222")).toBe("34600111222");
  });
  it("00 -> +", () => {
    expect(normalizePhone("0034600111222")).toBe("+34600111222");
  });
  it("nunca antepone +34 a un número ambiguo sin prefijo", () => {
    expect(normalizePhone("600111222")).toBe("600111222");
  });
  it("null/undefined -> null", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe("identityKeyFor", () => {
  it("prioriza email sobre teléfono", () => {
    expect(identityKeyFor("Ana@Example.com", "+34600111222")).toBe("email:ana@example.com");
  });
  it("usa teléfono si no hay email", () => {
    expect(identityKeyFor(null, "+34600111222")).toBe("phone:+34600111222");
  });
  it("null si no hay ningún indicio", () => {
    expect(identityKeyFor(null, null)).toBeNull();
  });
});

describe("classifyMatch — niveles de confianza (spec §14/§60)", () => {
  it("EXACT_EMAIL_AND_PHONE — email y teléfono apuntan al mismo usuario", async () => {
    const db = fakeDb({ usersRows: [{ id: 7, email: "ana@example.com", phone: "+34600111222" }] });
    const result = await classifyMatch("ana@example.com", "+34600111222", db);
    expect(result).toEqual({ confidence: "EXACT_EMAIL_AND_PHONE", candidateUserId: 7 });
  });

  it("EXACT_EMAIL — solo el email coincide (sin teléfono aportado)", async () => {
    const db = fakeDb({ usersRows: [{ id: 7, email: "ana@example.com" }] });
    const result = await classifyMatch("ana@example.com", null, db);
    expect(result.confidence).toBe("EXACT_EMAIL");
    expect(result.candidateUserId).toBe(7);
  });

  it("EXACT_PHONE — solo el teléfono coincide (sin email aportado)", async () => {
    const db = fakeDb({ usersRows: [{ id: 9, phone: "+34600111222" }] });
    const result = await classifyMatch(null, "+34600111222", db);
    expect(result.confidence).toBe("EXACT_PHONE");
    expect(result.candidateUserId).toBe(9);
  });

  it("CONFLICT_EMAIL_PHONE — email apunta a un usuario, teléfono a otro distinto", async () => {
    // classifyMatch hace 2 selects independientes sobre `users` (email,
    // luego phone) — este fake responde cada uno con su propio dataset,
    // simulando que el email solo matchea la fila 7 y el phone solo la 9.
    const combined = fakeDbWithSeparateEmailPhone([{ id: 7, email: "ana@example.com" }], [{ id: 9, phone: "+34600111222" }]);
    const result = await classifyMatch("ana@example.com", "+34600111222", combined);
    expect(result.confidence).toBe("CONFLICT_EMAIL_PHONE");
    expect(result.candidateUserId).toBeNull();
    expect(result.conflictUserId).toBe(9);
  });

  it("AMBIGUOUS — el teléfono coincide con 2+ usuarios distintos", async () => {
    // email=null: classifyMatch NUNCA consulta email (solo phone) — un único select.
    const db = fakeDb({ usersRows: [{ id: 9 }, { id: 11 }] });
    const result = await classifyMatch(null, "+34600111222", db);
    expect(result.confidence).toBe("AMBIGUOUS");
    expect(result.candidateUserId).toBeNull();
  });

  it("NO_MATCH — ni email ni teléfono coinciden con nada", async () => {
    const db = fakeDb({ usersRows: [] });
    const result = await classifyMatch("nadie@example.com", "+34600000000", db);
    expect(result.confidence).toBe("NO_MATCH");
  });
});

/** classifyMatch hace 2 selects independientes (email, luego phone) — este helper responde cada uno con su propio dataset. */
function fakeDbWithSeparateEmailPhone(emailRows: Array<{ id: number }>, phoneRows: Array<{ id: number }>) {
  let call = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async (n: number) => {
            call++;
            return (call === 1 ? emailRows : phoneRows).slice(0, n);
          },
        }),
      }),
    }),
  };
  return db as unknown as Parameters<typeof classifyMatch>[2];
}

describe("listHistoricalIdentities — agregación y cross-venue (spec §43, §60)", () => {
  it("agrupa por identityKey, calcula eventsCount/ticketsCount/attendanceCount/spend y detecta cross-venue", async () => {
    const rows = [
      unresolvedRow({ id: 1, operationType: "order", eventId: 10, venueId: 1, amountCents: 1000 }),
      unresolvedRow({ id: 2, operationType: "attendance", eventId: 10, venueId: 1, amountCents: null }),
      unresolvedRow({ id: 3, operationType: "order", eventId: 20, venueId: 7, amountCents: 500 }),
    ];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [] });
    const { items, total } = await listHistoricalIdentities({ limit: 25, offset: 0, sortBy: "lastActivity", sortDir: "desc" }, db);
    expect(total).toBe(1);
    expect(items[0].eventsCount).toBe(2);
    expect(items[0].ticketsCount).toBe(2);
    expect(items[0].attendanceCount).toBe(1);
    expect(items[0].historicalSpendCents).toBe(1500);
    expect(items[0].crossVenue).toBe(true);
    expect(items[0].venueIds.sort()).toEqual([1, 7]);
  });

  it("misma identidad en 3 venues -> crossVenue true, 3 venueIds", async () => {
    const rows = [
      unresolvedRow({ id: 1, venueId: 1 }),
      unresolvedRow({ id: 2, venueId: 4 }),
      unresolvedRow({ id: 3, venueId: 7 }),
    ];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [] });
    const { items } = await listHistoricalIdentities({ limit: 25, offset: 0, sortBy: "lastActivity", sortDir: "desc" }, db);
    expect(items[0].venueIds.sort()).toEqual([1, 4, 7]);
    expect(items[0].crossVenue).toBe(true);
  });

  it("status=LINKED cuando todas las filas están vinculadas al mismo userId", async () => {
    const rows = [unresolvedRow({ id: 1, status: "linked", linkedUserId: 42 })];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [] });
    const { items } = await listHistoricalIdentities({ limit: 25, offset: 0, sortBy: "lastActivity", sortDir: "desc" }, db);
    expect(items[0].status).toBe("LINKED");
    expect(items[0].linkedUserId).toBe(42);
  });

  it("status=CONFLICT cuando filas de la misma identidad están linked a userIds distintos", async () => {
    const rows = [
      unresolvedRow({ id: 1, status: "linked", linkedUserId: 42 }),
      unresolvedRow({ id: 2, status: "linked", linkedUserId: 99 }),
    ];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [] });
    const { items } = await listHistoricalIdentities({ limit: 25, offset: 0, sortBy: "lastActivity", sortDir: "desc" }, db);
    expect(items[0].status).toBe("CONFLICT");
  });

  it("filtro venueId y crossVenueOnly", async () => {
    const rows = [
      unresolvedRow({ id: 1, identityHintEmail: "solo1@example.com", venueId: 1 }),
      unresolvedRow({ id: 2, identityHintEmail: "cross@example.com", venueId: 1 }),
      unresolvedRow({ id: 3, identityHintEmail: "cross@example.com", venueId: 7 }),
    ];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [] });
    const { items } = await listHistoricalIdentities({ crossVenueOnly: true, limit: 25, offset: 0, sortBy: "lastActivity", sortDir: "desc" }, db);
    expect(items).toHaveLength(1);
    expect(items[0].email).toBe("cross@example.com");
  });
});

describe("name — Historical Students Admin Full Identity Visibility (2026-08-14)", () => {
  it("propaga el nombre real (identity_hint_name), sin enmascarar, en el listado y la ficha", async () => {
    const rows = [unresolvedRow({ id: 1, identityHintName: "Ana García López" })];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [] });
    const { items } = await listHistoricalIdentities({ limit: 25, offset: 0, sortBy: "lastActivity", sortDir: "desc" }, db);
    expect(items[0].name).toBe("Ana García López");
    expect(items[0].email).toBe("ana@example.com"); // email/phone reales, nunca enmascarados a nivel de motor
    expect(items[0].phone).toBe("+34600111222");
  });

  it("cuando la misma identidad trae variantes de nombre distintas entre operaciones, gana la MÁS RECIENTE (nunca decide matching)", async () => {
    const rows = [
      unresolvedRow({ id: 1, identityHintName: "Ana G.", occurredAt: new Date("2025-01-01T00:00:00Z") }),
      unresolvedRow({ id: 2, identityHintName: "Ana García López", occurredAt: new Date("2026-01-01T00:00:00Z") }),
      unresolvedRow({ id: 3, identityHintName: "ANA GARCIA", occurredAt: new Date("2025-06-01T00:00:00Z") }),
    ];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [] });
    const { items } = await listHistoricalIdentities({ limit: 25, offset: 0, sortBy: "lastActivity", sortDir: "desc" }, db);
    expect(items[0].name).toBe("Ana García López"); // la de 2026-01-01, la más reciente de las 3
  });

  it("búsqueda por nombre (parcial, insensible a mayúsculas) — nunca alimenta classifyMatch", async () => {
    const rows = [
      unresolvedRow({ id: 1, identityHintEmail: "persona1@example.com", identityHintName: "Carlos Ruiz" }),
      unresolvedRow({ id: 2, identityHintEmail: "persona2@example.com", identityHintName: "Marta Send" }),
    ];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [] });
    const { items } = await listHistoricalIdentities({ search: "ruiz", limit: 25, offset: 0, sortBy: "lastActivity", sortDir: "desc" }, db);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Carlos Ruiz");
  });

  it("sin nombre en ninguna operación -> name null (nunca inventado)", async () => {
    const rows = [unresolvedRow({ id: 1, identityHintName: null })];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [] });
    const { items } = await listHistoricalIdentities({ limit: 25, offset: 0, sortBy: "lastActivity", sortDir: "desc" }, db);
    expect(items[0].name).toBeNull();
  });
});

describe("claimHistoricalIdentity — seguridad/idempotencia/loyalty (spec §18-19, §32, §44, §60)", () => {
  it("vincula tickets (order) y materializa attendance con suppressLoyalty:true SIEMPRE", async () => {
    const rows = [
      unresolvedRow({ id: 1, operationType: "order", referenceType: "event_ticket", referenceId: 501, status: "unresolved" }),
      unresolvedRow({ id: 2, operationType: "attendance", eventId: 10, status: "unresolved" }),
    ];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [], studentProfileRows: [{ id: 55 }] });
    mockLinkUnresolvedOperation.mockImplementation(async (id: number, userId: number) => ({ ...rows.find(r => r.id === id), status: "linked", linkedUserId: userId }));
    mockIngestAttendance.mockResolvedValue({ status: "processed", attendance: { id: 900 } });

    const result = await claimHistoricalIdentity({ identityKey: "email:ana@example.com", userId: 42, actorUserId: 1, method: "admin_manual" }, db);

    expect(result.status).toBe("CLAIMED");
    expect(result.operationsLinked).toBe(2);
    expect(result.ticketsAttributed).toBe(1);
    expect(result.attendanceMaterialized).toBe(1);
    expect(mockIngestAttendance).toHaveBeenCalledTimes(1);
    expect(mockIngestAttendance.mock.calls[0][0]).toMatchObject({ suppressLoyalty: true, resolvedUserId: 42 });
    expect(mockRecordStudentAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ studentProfileId: 55, action: "historical_identity_claimed" }), db
    );
  });

  it("ALREADY_CLAIMED_BY_THIS_USER — repetir el mismo claim no duplica nada (idempotencia, spec §44)", async () => {
    const rows = [unresolvedRow({ id: 1, status: "linked", linkedUserId: 42 })];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [], studentProfileRows: [] });
    const result = await claimHistoricalIdentity({ identityKey: "email:ana@example.com", userId: 42, actorUserId: 1, method: "admin_manual" }, db);
    expect(result.status).toBe("ALREADY_CLAIMED_BY_THIS_USER");
    expect(mockLinkUnresolvedOperation).not.toHaveBeenCalled();
    expect(mockIngestAttendance).not.toHaveBeenCalled();
  });

  it("CLAIM_CONFLICT — la identidad ya está vinculada a OTRO userId, nunca reasigna (spec §41)", async () => {
    const rows = [unresolvedRow({ id: 1, status: "linked", linkedUserId: 99 })];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [], studentProfileRows: [] });
    const result = await claimHistoricalIdentity({ identityKey: "email:ana@example.com", userId: 42, actorUserId: 1, method: "admin_manual" }, db);
    expect(result.status).toBe("CLAIM_CONFLICT");
    expect(mockLinkUnresolvedOperation).not.toHaveBeenCalled();
  });

  it("identidad no encontrada -> HistoricalIdentityError NOT_FOUND", async () => {
    const db = fakeDb({ unresolvedRows: [], usersRows: [] });
    await expect(claimHistoricalIdentity({ identityKey: "email:nadie@example.com", userId: 1, actorUserId: 1, method: "admin_manual" }, db))
      .rejects.toThrow(HistoricalIdentityError);
  });

  it("carrera (ALREADY_RESOLVED en linkUnresolvedOperation) se ignora limpiamente, no revienta el claim completo", async () => {
    const rows = [unresolvedRow({ id: 1, status: "unresolved" }), unresolvedRow({ id: 2, status: "unresolved" })];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [], studentProfileRows: [] });
    mockLinkUnresolvedOperation
      .mockRejectedValueOnce(new UnresolvedOperationError("ALREADY_RESOLVED", "ya resuelta"))
      .mockResolvedValueOnce({ ...rows[1], status: "linked", linkedUserId: 42 });
    const result = await claimHistoricalIdentity({ identityKey: "email:ana@example.com", userId: 42, actorUserId: 1, method: "admin_manual" }, db);
    expect(result.status).toBe("CLAIMED");
    expect(result.operationsLinked).toBe(1); // solo la segunda se contó — la primera fue una carrera ya resuelta
  });
});

describe("unclaimHistoricalIdentity — reversibilidad (spec §45, §52, §60)", () => {
  it("requiere motivo obligatorio", async () => {
    const db = fakeDb({ unresolvedRows: [], usersRows: [] });
    await expect(unclaimHistoricalIdentity({ identityKey: "email:ana@example.com", actorUserId: 1, reason: "" }, db))
      .rejects.toThrow(HistoricalIdentityError);
  });

  it("revierte tickets a userId=null, borra event_attendance materializada y vuelve unresolved_operations a 'unresolved'", async () => {
    const rows = [
      unresolvedRow({ id: 1, operationType: "order", referenceType: "event_ticket", referenceId: 501, status: "linked", linkedUserId: 42 }),
      unresolvedRow({ id: 2, operationType: "attendance", eventId: 10, status: "linked", linkedUserId: 42 }),
    ];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [], studentProfileRows: [{ id: 55 }] });
    const result = await unclaimHistoricalIdentity({ identityKey: "email:ana@example.com", actorUserId: 1, reason: "Error de vinculación" }, db);
    expect(result.operationsReverted).toBe(2);
    expect(result.ticketsReverted).toBe(1);
    expect(result.attendanceRemoved).toBe(1);
    // el DELETE de event_attendance exige tokens_ledger_id IS NULL — nunca revierte loyalty (spec §32).
    expect(db.__executed.length).toBe(1);
  });

  it("identidad no vinculada -> HistoricalIdentityError NOT_LINKED", async () => {
    const rows = [unresolvedRow({ id: 1, status: "unresolved" })];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [] });
    await expect(unclaimHistoricalIdentity({ identityKey: "email:ana@example.com", actorUserId: 1, reason: "motivo" }, db))
      .rejects.toThrow(HistoricalIdentityError);
  });
});

describe("getHistoricalIdentityStats — Admin Command Center (spec §15, una sola pasada)", () => {
  it("agrega total/status/cross-venue en una única pasada sobre loadAllIdentityGroups", async () => {
    const rows = [
      // identidad 1 — email:ana@example.com — cross-venue (2 venues), UNREGISTERED
      unresolvedRow({ id: 1, identityHintEmail: "ana@example.com", identityHintPhone: null, venueId: 1, status: "unresolved" }),
      unresolvedRow({ id: 2, identityHintEmail: "ana@example.com", identityHintPhone: null, venueId: 7, status: "unresolved" }),
      // identidad 2 — email:carlos@example.com — LINKED a un user real
      unresolvedRow({ id: 3, identityHintEmail: "carlos@example.com", identityHintPhone: null, venueId: 1, status: "linked", linkedUserId: 42 }),
    ];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [{ id: 42, email: "carlos@example.com", phone: null }] });

    const stats = await getHistoricalIdentityStats(db);

    expect(stats.total).toBe(2); // 2 identityKeys distintas, no 3 filas
    expect(stats.linked).toBe(1);
    expect(stats.crossVenue).toBe(1);
    expect(stats.unregistered + stats.possibleMatch + stats.autoMatchCandidate + stats.linked + stats.conflict).toBe(stats.total);
  });

  it("sin ninguna identidad → todo en 0, nunca lanza", async () => {
    const db = fakeDb({ unresolvedRows: [], usersRows: [] });
    const stats = await getHistoricalIdentityStats(db);
    expect(stats).toEqual({ total: 0, unregistered: 0, possibleMatch: 0, autoMatchCandidate: 0, linked: 0, conflict: 0, crossVenue: 0 });
  });
});

describe("getHistoricalIdentityStatsByVenue — Venue Performance (spec §14, misma pasada que getHistoricalIdentityStats)", () => {
  it("una identidad cross-venue cuenta en el total de CADA venue que tocó", async () => {
    const rows = [
      // identidad 1 — presente en venue 1 y venue 7 (cross-venue)
      unresolvedRow({ id: 1, identityHintEmail: "ana@example.com", identityHintPhone: null, venueId: 1, status: "unresolved" }),
      unresolvedRow({ id: 2, identityHintEmail: "ana@example.com", identityHintPhone: null, venueId: 7, status: "unresolved" }),
      // identidad 2 — solo venue 1
      unresolvedRow({ id: 3, identityHintEmail: "carlos@example.com", identityHintPhone: null, venueId: 1, status: "unresolved" }),
    ];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [] });

    const byVenue = await getHistoricalIdentityStatsByVenue(db);
    const byVenueMap = new Map(byVenue.map(v => [v.venueId, v]));

    expect(byVenueMap.get(1)?.total).toBe(2); // ana + carlos
    expect(byVenueMap.get(1)?.crossVenue).toBe(1); // solo ana es cross-venue
    expect(byVenueMap.get(7)?.total).toBe(1); // solo ana
    expect(byVenueMap.get(7)?.crossVenue).toBe(1);
  });

  it("sin ninguna identidad → array vacío, nunca lanza", async () => {
    const db = fakeDb({ unresolvedRows: [], usersRows: [] });
    const byVenue = await getHistoricalIdentityStatsByVenue(db);
    expect(byVenue).toEqual([]);
  });
});

describe("resolveHistoricalIdentityBestEffort — SEGURIDAD (Production Safety Gate §8): NUNCA auto-vincula", () => {
  it("con un historial que coincide exactamente por email+teléfono, SOLO detecta — nunca llama a linkUnresolvedOperation/ingestAttendance/recordStudentAdminAction", async () => {
    const rows = [unresolvedRow({ id: 1, identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222", status: "unresolved" })];
    const db = fakeDb({ unresolvedRows: rows, usersRows: [] });
    await resolveHistoricalIdentityBestEffort(42, "ana@example.com", "+34600111222", db);
    expect(mockLinkUnresolvedOperation).not.toHaveBeenCalled();
    expect(mockIngestAttendance).not.toHaveBeenCalled();
    expect(mockRecordStudentAdminAction).not.toHaveBeenCalled();
  });

  it("sin ningún historial coincidente -> no hace nada, no lanza", async () => {
    const db = fakeDb({ unresolvedRows: [], usersRows: [] });
    await expect(resolveHistoricalIdentityBestEffort(42, "nadie@example.com", "+34600000000", db)).resolves.toBeUndefined();
    expect(mockLinkUnresolvedOperation).not.toHaveBeenCalled();
  });

  it("un fallo interno nunca se propaga (best-effort — nunca debe romper el alta)", async () => {
    const brokenDb = { select: () => { throw new Error("DB caída"); } };
    await expect(resolveHistoricalIdentityBestEffort(42, "ana@example.com", "+34600111222", brokenDb as never)).resolves.toBeUndefined();
  });
});

describe("getMyHistoricalMatchPreview — autoservicio, privacy-safe (spec §7/§9/§30)", () => {
  it("usuario sin fila en `users` -> NOT_AVAILABLE", async () => {
    const db = fakeDb({ usersRows: [], unresolvedRows: [] });
    const result = await getMyHistoricalMatchPreview(42, db);
    expect(result.status).toBe("NOT_AVAILABLE");
  });

  it("sin ningún historial coincidente -> NOT_AVAILABLE", async () => {
    const db = fakeDb({ usersRows: [{ id: 42, email: "ana@example.com", phone: "+34600111222" }], unresolvedRows: [] });
    const result = await getMyHistoricalMatchPreview(42, db);
    expect(result.status).toBe("NOT_AVAILABLE");
  });

  it("historial disponible (nunca reclamado) -> AVAILABLE con agregados, sin exponer email/teléfono histórico", async () => {
    const rows = [
      unresolvedRow({ id: 1, identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222", operationType: "order", eventId: 10, venueId: 1, amountCents: 1000, status: "unresolved" }),
      unresolvedRow({ id: 2, identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222", operationType: "attendance", eventId: 10, venueId: 1, status: "unresolved" }),
    ];
    const db = fakeDb({ usersRows: [{ id: 42, email: "ana@example.com", phone: "+34600111222" }], unresolvedRows: rows });
    const result = await getMyHistoricalMatchPreview(42, db);
    expect(result).toMatchObject({ status: "AVAILABLE", eventsCount: 1, ticketsCount: 1, attendanceCount: 1 });
    expect(result).not.toHaveProperty("email");
    expect(result).not.toHaveProperty("phone");
  });

  it("identidad ya reclamada por OTRO userId -> NOT_AVAILABLE (nunca revela que pertenece a otra persona, spec §30)", async () => {
    const rows = [unresolvedRow({ id: 1, identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222", status: "linked", linkedUserId: 99 })];
    const db = fakeDb({ usersRows: [{ id: 42, email: "ana@example.com", phone: "+34600111222" }], unresolvedRows: rows });
    const result = await getMyHistoricalMatchPreview(42, db);
    expect(result.status).toBe("NOT_AVAILABLE");
  });

  it("identidad ya reclamada por ESTE MISMO userId -> ALREADY_CLAIMED con fecha (spec §37)", async () => {
    const rows = [unresolvedRow({ id: 1, identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222", status: "linked", linkedUserId: 42, linkedAt: new Date("2026-08-01T10:00:00Z") })];
    const db = fakeDb({ usersRows: [{ id: 42, email: "ana@example.com", phone: "+34600111222" }], unresolvedRows: rows });
    const result = await getMyHistoricalMatchPreview(42, db);
    expect(result.status).toBe("ALREADY_CLAIMED");
    expect(result.claimedAt).toBe("2026-08-01T10:00:00.000Z");
  });

  it("identidad en CONFLICT (linked a userIds distintos) -> NOT_AVAILABLE, nunca self-serve (spec §6)", async () => {
    const rows = [
      unresolvedRow({ id: 1, identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222", status: "linked", linkedUserId: 10 }),
      unresolvedRow({ id: 2, identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222", status: "linked", linkedUserId: 20 }),
    ];
    const db = fakeDb({ usersRows: [{ id: 42, email: "ana@example.com", phone: "+34600111222" }], unresolvedRows: rows });
    const result = await getMyHistoricalMatchPreview(42, db);
    expect(result.status).toBe("NOT_AVAILABLE");
  });

  it("una fila de otra identidad no contamina el resultado", async () => {
    const rows = [
      unresolvedRow({ id: 1, identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222", status: "unresolved" }),
      unresolvedRow({ id: 2, identityHintEmail: "otra@example.com", identityHintPhone: null, status: "unresolved" }),
    ];
    const db = fakeDb({ usersRows: [{ id: 42, email: "ana@example.com", phone: "+34600111222" }], unresolvedRows: rows });
    const result = await getMyHistoricalMatchPreview(42, db);
    expect(result.status).toBe("AVAILABLE");
    expect(result.ticketsCount).toBe(1); // solo la fila de "ana", no la de "otra"
  });
});

describe("claimMyHistoricalIdentity — autoservicio autenticado (spec §7/§40)", () => {
  it("reclama correctamente cuando hay un historial disponible propio", async () => {
    const rows = [unresolvedRow({ id: 1, identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222", operationType: "order", referenceType: "event_ticket", referenceId: 501, status: "unresolved" })];
    const db = fakeDb({ usersRows: [{ id: 42, email: "ana@example.com", phone: "+34600111222" }], unresolvedRows: rows, studentProfileRows: [{ id: 55 }] });
    mockLinkUnresolvedOperation.mockResolvedValue({ ...rows[0], status: "linked", linkedUserId: 42 });
    const result = await claimMyHistoricalIdentity(42, db);
    expect(result.status).toBe("CLAIMED");
    expect(result.userId).toBe(42);
  });

  it("sin ningún historial disponible -> HistoricalIdentityError NOT_FOUND", async () => {
    const db = fakeDb({ usersRows: [{ id: 42, email: "ana@example.com", phone: "+34600111222" }], unresolvedRows: [] });
    await expect(claimMyHistoricalIdentity(42, db)).rejects.toThrow(HistoricalIdentityError);
  });

  it("identidad en CONFLICT -> NOT_FOUND, nunca reclama un conflicto vía autoservicio", async () => {
    const rows = [
      unresolvedRow({ id: 1, identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222", status: "linked", linkedUserId: 10 }),
      unresolvedRow({ id: 2, identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222", status: "linked", linkedUserId: 20 }),
    ];
    const db = fakeDb({ usersRows: [{ id: 42, email: "ana@example.com", phone: "+34600111222" }], unresolvedRows: rows });
    await expect(claimMyHistoricalIdentity(42, db)).rejects.toThrow(HistoricalIdentityError);
  });

  it("identidad ya reclamada por OTRO userId -> NOT_FOUND, nunca permite un cross-claim (spec §30/§45)", async () => {
    const rows = [unresolvedRow({ id: 1, identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222", status: "linked", linkedUserId: 99 })];
    const db = fakeDb({ usersRows: [{ id: 42, email: "ana@example.com", phone: "+34600111222" }], unresolvedRows: rows });
    await expect(claimMyHistoricalIdentity(42, db)).rejects.toThrow(HistoricalIdentityError);
    expect(mockLinkUnresolvedOperation).not.toHaveBeenCalled();
  });

  it("re-reclamar tras ya haberlo reclamado uno mismo -> ALREADY_CLAIMED_BY_THIS_USER, idempotente (spec §44)", async () => {
    const rows = [unresolvedRow({ id: 1, identityHintEmail: "ana@example.com", identityHintPhone: "+34600111222", status: "linked", linkedUserId: 42 })];
    const db = fakeDb({ usersRows: [{ id: 42, email: "ana@example.com", phone: "+34600111222" }], unresolvedRows: rows, studentProfileRows: [] });
    const result = await claimMyHistoricalIdentity(42, db);
    expect(result.status).toBe("ALREADY_CLAIMED_BY_THIS_USER");
  });
});

describe("getHistoricalOverviewForStudent — Student 360 (spec §17)", () => {
  it("sin ninguna operación vinculada -> hasHistory:false, todo en 0", async () => {
    const db = fakeDb({ unresolvedRows: [] });
    const result = await getHistoricalOverviewForStudent(42, db);
    expect(result).toEqual({ hasHistory: false, identityKey: null, eventsCount: 0, ticketsCount: 0, attendanceCount: 0, historicalSpendCents: 0, venuesCount: 0, crossVenue: false, firstActivity: null, lastActivity: null, claimedAt: null });
  });

  it("agrega eventos/tickets/asistencias/gasto/venues/cross-venue/claimedAt desde operaciones linked", async () => {
    const rows = [
      unresolvedRow({ id: 1, operationType: "order", eventId: 10, venueId: 1, amountCents: 1000, status: "linked", linkedUserId: 42, linkedAt: new Date("2026-08-01T10:00:00Z") }),
      unresolvedRow({ id: 2, operationType: "attendance", eventId: 10, venueId: 1, status: "linked", linkedUserId: 42, linkedAt: new Date("2026-08-01T10:00:00Z") }),
      unresolvedRow({ id: 3, operationType: "order", eventId: 20, venueId: 7, amountCents: 500, status: "linked", linkedUserId: 42, linkedAt: new Date("2026-08-02T10:00:00Z") }),
    ];
    const db = fakeDb({ unresolvedRows: rows });
    const result = await getHistoricalOverviewForStudent(42, db);
    expect(result.hasHistory).toBe(true);
    expect(result.eventsCount).toBe(2);
    expect(result.ticketsCount).toBe(2);
    expect(result.attendanceCount).toBe(1);
    expect(result.historicalSpendCents).toBe(1500);
    expect(result.venuesCount).toBe(2);
    expect(result.crossVenue).toBe(true);
    expect(result.claimedAt).toBe("2026-08-01T10:00:00.000Z"); // la PRIMERA vinculación, no la última
  });
});

describe("getHistoricalTimelineForStudent — Student 360 (spec §16)", () => {
  it("ordena por fecha DESC y resuelve nombres de evento/venue", async () => {
    const rows = [
      unresolvedRow({ id: 1, eventId: 10, venueId: 1, occurredAt: new Date("2026-01-01T00:00:00Z"), status: "linked", linkedUserId: 42 }),
      unresolvedRow({ id: 2, eventId: 20, venueId: 7, occurredAt: new Date("2026-06-01T00:00:00Z"), status: "linked", linkedUserId: 42 }),
    ];
    const db = fakeDb({ unresolvedRows: rows, eventsRows: [{ id: 10, name: "Fiesta Enero" }, { id: 20, name: "Fiesta Junio" }], venuesRows: [{ id: 1, name: "Casanova" }, { id: 7, name: "Limoncello" }] });
    const result = await getHistoricalTimelineForStudent(42, 10, 0, db);
    expect(result.total).toBe(2);
    expect(result.items[0].eventName).toBe("Fiesta Junio"); // más reciente primero
    expect(result.items[0].venueName).toBe("Limoncello");
    expect(result.items[1].eventName).toBe("Fiesta Enero");
  });

  it("paginación: total refleja todas, items solo la página pedida", async () => {
    const rows = [1, 2, 3].map(n => unresolvedRow({ id: n, occurredAt: new Date(`2026-0${n}-01T00:00:00Z`), status: "linked", linkedUserId: 42 }));
    const db = fakeDb({ unresolvedRows: rows, eventsRows: [], venuesRows: [] });
    const result = await getHistoricalTimelineForStudent(42, 2, 0, db);
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(2);
  });
});
