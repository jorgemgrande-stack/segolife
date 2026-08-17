import { describe, it, expect, vi, beforeEach } from "vitest";

// PRE-16.15 — privacidad cross-venue en linkTicketToIdentityAndCheckIn.
const { mockLookupStudentByIdentityToken, mockCheckInTicketById } = vi.hoisted(() => ({
  mockLookupStudentByIdentityToken: vi.fn(),
  mockCheckInTicketById: vi.fn(),
}));
vi.mock("../commerce/studentIdentityService", () => ({ lookupStudentByIdentityToken: mockLookupStudentByIdentityToken }));
vi.mock("./nativeCheckinService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./nativeCheckinService")>();
  return { ...actual, checkInTicketById: mockCheckInTicketById };
});
vi.mock("./attendancePipeline", () => ({ ingestAttendance: vi.fn() }));
vi.mock("../venues/venueVisitService", () => ({ recordVenueVisit: vi.fn() }));

import { isEventCurrentlyOpen, pickCurrentEvent, linkTicketToIdentityAndCheckIn } from "./unifiedCheckinService";
import { eventTickets, events } from "../../../drizzle/schema";
import { CheckinError } from "./nativeCheckinService";

type TestEvent = { id: number; startsAt: Date; endsAt: Date | null };

function ev(id: number, startsAt: string, endsAt: string | null): TestEvent {
  return { id, startsAt: new Date(startsAt), endsAt: endsAt ? new Date(endsAt) : null };
}

describe("isEventCurrentlyOpen — spec §21/§30/§34 invariante 9 (nightlife crossing midnight)", () => {
  it("un evento 23:30->05:00 sigue abierto justo antes de medianoche", () => {
    const event = ev(1, "2026-08-15T23:30:00+02:00", "2026-08-16T05:00:00+02:00");
    expect(isEventCurrentlyOpen(event, new Date("2026-08-15T23:45:00+02:00"))).toBe(true);
  });

  it("el MISMO evento sigue abierto justo después de medianoche — no se parte en dos por el cambio de día de calendario", () => {
    const event = ev(1, "2026-08-15T23:30:00+02:00", "2026-08-16T05:00:00+02:00");
    expect(isEventCurrentlyOpen(event, new Date("2026-08-16T00:15:00+02:00"))).toBe(true);
  });

  it("sigue abierto cerca del final (04:45), cerrado ya pasado endsAt (05:30)", () => {
    const event = ev(1, "2026-08-15T23:30:00+02:00", "2026-08-16T05:00:00+02:00");
    expect(isEventCurrentlyOpen(event, new Date("2026-08-16T04:45:00+02:00"))).toBe(true);
    expect(isEventCurrentlyOpen(event, new Date("2026-08-16T05:30:00+02:00"))).toBe(false);
  });

  it("puerta abierta 90 min antes del inicio (margen de llegada temprana)", () => {
    const event = ev(1, "2026-08-15T23:30:00+02:00", "2026-08-16T05:00:00+02:00");
    expect(isEventCurrentlyOpen(event, new Date("2026-08-15T22:15:00+02:00"))).toBe(true); // 75 min antes
    expect(isEventCurrentlyOpen(event, new Date("2026-08-15T21:30:00+02:00"))).toBe(false); // 120 min antes, fuera de margen
  });

  it("evento sin endsAt: se considera en curso 8h desde el inicio (ventana por defecto)", () => {
    const event = ev(1, "2026-08-15T23:30:00+02:00", null);
    expect(isEventCurrentlyOpen(event, new Date("2026-08-16T06:00:00+02:00"))).toBe(true);  // +6.5h
    expect(isEventCurrentlyOpen(event, new Date("2026-08-16T08:30:00+02:00"))).toBe(false); // +9h, fuera
  });

  it("evento de otro día ya no está en curso", () => {
    const event = ev(1, "2026-08-10T23:30:00+02:00", "2026-08-11T05:00:00+02:00");
    expect(isEventCurrentlyOpen(event, new Date("2026-08-15T23:45:00+02:00"))).toBe(false);
  });
});

describe("pickCurrentEvent — spec §10 (nunca adivinar si es ambiguo)", () => {
  it("0 eventos vigentes -> status none", () => {
    const result = pickCurrentEvent<TestEvent>([], new Date("2026-08-15T23:45:00+02:00"));
    expect(result.status).toBe("none");
  });

  it("exactamente 1 evento vigente -> resuelto sin ambigüedad", () => {
    const wrongDay = ev(1, "2026-08-10T23:30:00+02:00", "2026-08-11T05:00:00+02:00");
    const tonight = ev(2, "2026-08-15T23:30:00+02:00", "2026-08-16T05:00:00+02:00");
    const result = pickCurrentEvent([wrongDay, tonight], new Date("2026-08-15T23:45:00+02:00"));
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.event.id).toBe(2);
  });

  it("2+ eventos vigentes a la vez en el mismo venue -> ambiguous, NUNCA elige uno a ciegas", () => {
    const eventA = ev(1, "2026-08-15T23:00:00+02:00", "2026-08-16T02:00:00+02:00");
    const eventB = ev(2, "2026-08-15T23:30:00+02:00", "2026-08-16T05:00:00+02:00");
    const result = pickCurrentEvent([eventA, eventB], new Date("2026-08-15T23:45:00+02:00"));
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") expect(result.candidates.map(e => e.id).sort()).toEqual([1, 2]);
  });
});

describe("linkTicketToIdentityAndCheckIn — privacidad cross-venue (PRE-16.15, auditoría overnight)", () => {
  function makeLinkMockDb(ticket: Record<string, unknown> | null, event: Record<string, unknown> | null) {
    let mode: "select" | "update" = "select";
    let table: unknown = null;
    const b: any = {};
    b.select = (_proj?: unknown) => { mode = "select"; return b; };
    b.update = (t: unknown) => { mode = "update"; table = t; return b; };
    b.set = () => b;
    b.from = (t: unknown) => { table = t; return b; };
    b.where = () => {
      if (mode === "update") return Promise.resolve([{ affectedRows: 1 }]);
      return b;
    };
    b.limit = () => {
      if (mode === "update") return b;
      if (table === eventTickets) return Promise.resolve(ticket ? [ticket] : []);
      if (table === events) return Promise.resolve(event ? [event] : []);
      return Promise.resolve([]);
    };
    return b as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockLookupStudentByIdentityToken.mockResolvedValue({ userId: 42, name: "Ana" });
  });

  it("venue AJENO al staff → UNAUTHORIZED_STAFF, NUNCA revela si el ticket ya tenía Student vinculado (ALREADY_LINKED)", async () => {
    const db = makeLinkMockDb({ id: 1, eventId: 5, userId: 999 }, { id: 5, venueId: 99 });
    await expect(linkTicketToIdentityAndCheckIn({ ticketId: 1, identityToken: "tok", staffUserId: 9, staffAuthorizedVenueIds: [1, 2, 3] }, db))
      .rejects.toMatchObject({ code: "UNAUTHORIZED_STAFF" });
    expect(mockCheckInTicketById).not.toHaveBeenCalled();
  });

  it("venue AJENO al staff + ticket SIN vincular (userId=null) → sigue siendo UNAUTHORIZED_STAFF, no NOT_FOUND ni otra distinción de estado", async () => {
    const db = makeLinkMockDb({ id: 1, eventId: 5, userId: null }, { id: 5, venueId: 99 });
    await expect(linkTicketToIdentityAndCheckIn({ ticketId: 1, identityToken: "tok", staffUserId: 9, staffAuthorizedVenueIds: [1, 2, 3] }, db))
      .rejects.toMatchObject({ code: "UNAUTHORIZED_STAFF" });
  });

  it("venue AUTORIZADO + ticket ya vinculado → ALREADY_LINKED (la privacidad es solo cross-venue, dentro del propio venue el estado real sigue siendo visible)", async () => {
    const db = makeLinkMockDb({ id: 1, eventId: 5, userId: 999 }, { id: 5, venueId: 1 });
    await expect(linkTicketToIdentityAndCheckIn({ ticketId: 1, identityToken: "tok", staffUserId: 9, staffAuthorizedVenueIds: [1, 2, 3] }, db))
      .rejects.toMatchObject({ code: "ALREADY_LINKED" });
  });
});
