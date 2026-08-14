/**
 * historicalIdentities.test.ts — SEGOLIFE HISTORICAL STUDENT CLAIM (spec
 * §40/§45). Dos familias de procedures: admin (permissionProcedure
 * students.view/students.manage, ya cubiertas indirectamente por el resto
 * de la suite) y autoservicio (protectedProcedure, nuevas esta fase).
 *
 * Seguridad clave del autoservicio (spec §30/§40): `myHistoricalMatch` y
 * `claimMyHistory` NUNCA aceptan identityKey/userId del cliente — no tienen
 * `.input()` en absoluto, así que no hay ningún parámetro que un cliente
 * malicioso pueda usar para apuntar a la identidad de otra persona. Se
 * verifica aquí que el servicio subyacente se llama SIEMPRE con
 * ctx.user.id, nunca con ningún valor derivado del request.
 */
import { describe, it, expect, vi } from "vitest";

const { mockGetMyHistoricalMatchPreview, mockClaimMyHistoricalIdentity } = vi.hoisted(() => ({
  mockGetMyHistoricalMatchPreview: vi.fn(),
  mockClaimMyHistoricalIdentity: vi.fn(),
}));
vi.mock("../segolife/students/historicalIdentityService", async () => {
  const actual = await vi.importActual<typeof import("../segolife/students/historicalIdentityService")>("../segolife/students/historicalIdentityService");
  return {
    ...actual,
    getMyHistoricalMatchPreview: mockGetMyHistoricalMatchPreview,
    claimMyHistoricalIdentity: mockClaimMyHistoricalIdentity,
  };
});

import { historicalIdentitiesRouter } from "./historicalIdentities";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return historicalIdentitiesRouter.createCaller({ user: null } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(userId: number) {
  return historicalIdentitiesRouter.createCaller({ user: { id: userId, role: "user" } } as any);
}

describe("historicalIdentities router — endpoints admin (nunca públicos)", () => {
  it("list rechaza sin sesión", async () => {
    await expect(callerWithoutSession().list({ limit: 25, offset: 0, sortBy: "lastActivity", sortDir: "desc" })).rejects.toThrow(/please login/i);
  });
  it("detail rechaza sin sesión", async () => {
    await expect(callerWithoutSession().detail({ identityKey: "email:ana@example.com" })).rejects.toThrow(/please login/i);
  });
  it("claim (admin) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().claim({ identityKey: "email:ana@example.com", userId: 1 })).rejects.toThrow(/please login/i);
  });
  it("unclaim (admin) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().unclaim({ identityKey: "email:ana@example.com", reason: "motivo" })).rejects.toThrow(/please login/i);
  });
});

describe("historicalIdentities router — autoservicio (spec §7/§40, Production Safety Gate)", () => {
  it("myHistoricalMatch rechaza sin sesión", async () => {
    await expect(callerWithoutSession().myHistoricalMatch()).rejects.toThrow(/please login/i);
  });

  it("claimMyHistory rechaza sin sesión", async () => {
    await expect(callerWithoutSession().claimMyHistory()).rejects.toThrow(/please login/i);
  });

  it("myHistoricalMatch se resuelve SIEMPRE con ctx.user.id, nunca con un id externo", async () => {
    mockGetMyHistoricalMatchPreview.mockResolvedValue({ status: "AVAILABLE", eventsCount: 2, ticketsCount: 3, attendanceCount: 1, venuesCount: 1, firstActivity: null, lastActivity: null, claimedAt: null });
    await callerAs(42).myHistoricalMatch();
    expect(mockGetMyHistoricalMatchPreview).toHaveBeenCalledWith(42);
  });

  it("claimMyHistory se resuelve SIEMPRE con ctx.user.id — ningún input del cliente puede desviar el claim a otro userId", async () => {
    mockClaimMyHistoricalIdentity.mockResolvedValue({ status: "CLAIMED", identityKey: "email:ana@example.com", userId: 42, operationsLinked: 2, operationsAlreadyLinked: 0, ticketsAttributed: 1, attendanceMaterialized: 1 });
    // El procedure no tiene `.input()` — pasar un payload arbitrario (p.ej.
    // intentando "suplantar" a otro userId) no tiene ningún efecto: tRPC ni
    // siquiera lo entrega al resolver.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (callerAs(42).claimMyHistory as any)({ userId: 999, identityKey: "email:otra@example.com" });
    expect(mockClaimMyHistoricalIdentity).toHaveBeenCalledWith(42);
    expect(mockClaimMyHistoricalIdentity).not.toHaveBeenCalledWith(999);
  });

  it("claimMyHistory propaga NOT_FOUND como BAD_REQUEST (sin revelar si la identidad pertenece a otra persona, spec §30)", async () => {
    const { HistoricalIdentityError } = await vi.importActual<typeof import("../segolife/students/historicalIdentityService")>("../segolife/students/historicalIdentityService");
    mockClaimMyHistoricalIdentity.mockRejectedValue(new HistoricalIdentityError("NOT_FOUND", "No hay ningún historial disponible para reclamar"));
    await expect(callerAs(7).claimMyHistory()).rejects.toThrow(/no hay ningún historial disponible/i);
  });
});
