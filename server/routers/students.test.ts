/**
 * students.test.ts — endpoint público/privado correcto a nivel de router.
 *
 * Ninguna procedure de `studentsRouter` es `publicProcedure` (a diferencia
 * de `communitiesRouter` en Fase 1B) — todas exigen sesión. El middleware de
 * protectedProcedure/permissionProcedure rechaza ANTES de llamar al
 * resolver, así que se puede probar con `ctx.user = null` sin tocar la BD.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRemoveMyPhoto, mockListPhotoEventsByUserId } = vi.hoisted(() => ({
  mockRemoveMyPhoto: vi.fn(),
  mockListPhotoEventsByUserId: vi.fn(),
}));
vi.mock("../segolife/students/studentPhotoService", () => ({ removeMyPhoto: mockRemoveMyPhoto }));
vi.mock("../segolife/students/studentPhotoEventsDb", () => ({ listPhotoEventsByUserId: mockListPhotoEventsByUserId }));

import { studentsRouter } from "./students";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return studentsRouter.createCaller({ user: null } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("students router — endpoint privado (nunca público)", () => {
  it("students.me (autoservicio) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().me()).rejects.toThrow(/please login/i);
  });

  it("students.updateProfile rechaza sin sesión", async () => {
    await expect(callerWithoutSession().updateProfile({})).rejects.toThrow(/please login/i);
  });

  it("students.list (CRM admin) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().list({ limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });

  it("students.getById (CRM admin) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getById({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("students.listBySegment (deep navigation desde el Command Center) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listBySegment({ segment: "at_risk", limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });

  it("students.addNote (escritura admin) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().addNote({ studentProfileId: 1, note: "x" })).rejects.toThrow(/please login/i);
  });

  it("students.removeMyPhoto (MG-03, autoservicio) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().removeMyPhoto()).rejects.toThrow(/please login/i);
  });

  it("students.myPhotoActivity (MG-03B, autoservicio) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().myPhotoActivity()).rejects.toThrow(/please login/i);
  });
});

describe("students.removeMyPhoto — siempre el propio ctx.user.id, nunca un id del cliente (MG-03)", () => {
  it("con sesión, llama al servicio con el id de la sesión real (el input no acepta ningún userId)", async () => {
    mockRemoveMyPhoto.mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caller = studentsRouter.createCaller({ user: { id: 42, role: "user" } } as any);
    const result = await caller.removeMyPhoto();
    expect(result).toEqual({ success: true });
    expect(mockRemoveMyPhoto).toHaveBeenCalledWith(42);
    expect(mockRemoveMyPhoto).toHaveBeenCalledTimes(1);
  });
});

describe("students.myPhotoActivity — IDOR: siempre el propio ctx.user.id, ningún Student puede leer la actividad de otro (MG-03B)", () => {
  it("con sesión, consulta SOLO con el id de la sesión real — el procedure no acepta ningún userId de input", async () => {
    mockListPhotoEventsByUserId.mockResolvedValue([{ id: 1, userId: 42, action: "added", occurredAt: new Date() }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callerA = studentsRouter.createCaller({ user: { id: 42, role: "user" } } as any);
    await callerA.myPhotoActivity();
    expect(mockListPhotoEventsByUserId).toHaveBeenCalledWith(42);

    mockListPhotoEventsByUserId.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callerB = studentsRouter.createCaller({ user: { id: 99, role: "user" } } as any);
    await callerB.myPhotoActivity();
    expect(mockListPhotoEventsByUserId).toHaveBeenCalledWith(99);
    expect(mockListPhotoEventsByUserId).not.toHaveBeenCalledWith(42);
  });
});
