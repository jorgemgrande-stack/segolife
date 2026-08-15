/**
 * staffCheckin.test.ts — SEGOLIFE VENUE & PARTNER APP (spec §7/§10/§11).
 * `checkIn` mapeaba la respuesta de `checkInStudentIdentity` con un
 * ternario binario escrito ANTES de que venue_visits existiera —
 * `visit_already_recorded` (un reescaneo duplicado, p. ej. 23:55 → 00:20 en
 * el mismo venue sin evento vigente) colapsaba silenciosamente en
 * "identity_checked_in", un falso positivo de check-in NUEVO en vez de
 * AMBAR/duplicado. Este archivo prueba el mapeo 1:1 corregido para los 4
 * estados reales — no re-prueba `checkInStudentIdentity` en sí (eso ya lo
 * cubre unifiedCheckinService.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetVenueStaffAccess } = vi.hoisted(() => ({ mockGetVenueStaffAccess: vi.fn() }));
vi.mock("../segolife/benefits/venueStaffAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/benefits/venueStaffAccess")>();
  return { ...actual, getVenueStaffAccess: mockGetVenueStaffAccess };
});

const { mockResolveScannedCredential, mockCheckInStudentIdentity } = vi.hoisted(() => ({
  mockResolveScannedCredential: vi.fn(),
  mockCheckInStudentIdentity: vi.fn(),
}));
vi.mock("../segolife/ticketing/unifiedCheckinService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/ticketing/unifiedCheckinService")>();
  return { ...actual, resolveScannedCredential: mockResolveScannedCredential, checkInStudentIdentity: mockCheckInStudentIdentity };
});

import { staffCheckinRouter } from "./staffCheckin";

// role "admin" satisface el fallback legacy de attendanceRedeemProcedure
// (permissionProcedure("attendance.redeem", ["admin"])) sin tocar BD real —
// lo que se está probando aquí es el mapeo de resultado, no el gate RBAC.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(userId: number) {
  return staffCheckinRouter.createCaller({ user: { id: userId, role: "admin" } } as any);
}

const TOKEN = "a".repeat(20);
const VENUE_ID = 1;

describe("staffCheckin.checkIn — mapeo 1:1 de los 4 estados de checkInStudentIdentity (spec §7)", () => {
  beforeEach(() => {
    mockGetVenueStaffAccess.mockReset();
    mockResolveScannedCredential.mockReset();
    mockCheckInStudentIdentity.mockReset();
    mockGetVenueStaffAccess.mockResolvedValue([VENUE_ID]);
    mockResolveScannedCredential.mockResolvedValue({ type: "student_identity", student: { userId: 7, name: "Ana" } });
  });

  it("checked_in -> kind identity_checked_in (GREEN, check-in nuevo)", async () => {
    mockCheckInStudentIdentity.mockResolvedValue({ status: "checked_in", studentName: "Ana", event: { id: 1, name: "Noche IE" } });
    const res = await callerAs(10).checkIn({ token: TOKEN, venueId: VENUE_ID });
    expect(res).toMatchObject({ kind: "identity_checked_in", studentName: "Ana", eventName: "Noche IE" });
  });

  it("already_checked_in -> kind identity_already_checked_in (AMBER, duplicado con evento)", async () => {
    mockCheckInStudentIdentity.mockResolvedValue({ status: "already_checked_in", studentName: "Ana", event: { id: 1, name: "Noche IE" } });
    const res = await callerAs(10).checkIn({ token: TOKEN, venueId: VENUE_ID });
    expect(res).toMatchObject({ kind: "identity_already_checked_in" });
  });

  it("visit_recorded -> kind visit_recorded (BLUE, identificado sin evento vigente) — NUNCA identity_checked_in", async () => {
    mockCheckInStudentIdentity.mockResolvedValue({ status: "visit_recorded", studentName: "Ana", event: null });
    const res = await callerAs(10).checkIn({ token: TOKEN, venueId: VENUE_ID });
    expect(res).toMatchObject({ kind: "visit_recorded", eventName: null });
  });

  it("visit_already_recorded -> kind visit_already_recorded (AMBER, reescaneo duplicado) — el bug real: NUNCA debe reportarse como identity_checked_in", async () => {
    mockCheckInStudentIdentity.mockResolvedValue({ status: "visit_already_recorded", studentName: "Ana", event: null });
    const res = await callerAs(10).checkIn({ token: TOKEN, venueId: VENUE_ID });
    expect(res).toMatchObject({ kind: "visit_already_recorded" });
    expect(res).not.toMatchObject({ kind: "identity_checked_in" });
  });
});
