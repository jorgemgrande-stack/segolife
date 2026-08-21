/**
 * students.test.ts — endpoint público/privado correcto a nivel de router.
 *
 * Ninguna procedure de `studentsRouter` es `publicProcedure` (a diferencia
 * de `communitiesRouter` en Fase 1B) — todas exigen sesión. El middleware de
 * protectedProcedure/permissionProcedure rechaza ANTES de llamar al
 * resolver, así que se puede probar con `ctx.user = null` sin tocar la BD.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRemoveMyPhoto, mockListPhotoEventsByUserId,
  mockGetStudentById, mockUpdateStudentAdminProfile,
  mockEvaluateStudentDeletionEligibility, mockDeleteStudent,
  mockGetCommunityAccess,
} = vi.hoisted(() => ({
  mockRemoveMyPhoto: vi.fn(),
  mockListPhotoEventsByUserId: vi.fn(),
  mockGetStudentById: vi.fn(),
  mockUpdateStudentAdminProfile: vi.fn(),
  mockEvaluateStudentDeletionEligibility: vi.fn(),
  mockDeleteStudent: vi.fn(),
  mockGetCommunityAccess: vi.fn(),
}));
vi.mock("../segolife/students/studentPhotoService", () => ({ removeMyPhoto: mockRemoveMyPhoto }));
vi.mock("../segolife/students/studentPhotoEventsDb", () => ({ listPhotoEventsByUserId: mockListPhotoEventsByUserId }));
vi.mock("../db/studentsDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/studentsDb")>();
  return { ...actual, getStudentById: mockGetStudentById, updateStudentAdminProfile: mockUpdateStudentAdminProfile };
});
vi.mock("../segolife/students/studentLifecycleService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/students/studentLifecycleService")>();
  return { ...actual, evaluateStudentDeletionEligibility: mockEvaluateStudentDeletionEligibility, deleteStudent: mockDeleteStudent };
});
vi.mock("../_core/communityAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_core/communityAccess")>();
  return { ...actual, getCommunityAccess: mockGetCommunityAccess };
});

import { studentsRouter } from "./students";
import { StudentEmailConflictError } from "../db/studentsDb";
import { StudentDeleteBlockedError, StudentDeleteForbiddenError } from "../segolife/students/studentLifecycleService";

const STUDENT_DETAIL_FIXTURE = {
  profile: { id: 1, userId: 42, status: "active" as const, firstName: "Ana", lastName: "García" },
  user: { id: 42, name: "Ana García", email: "ana@example.test", phone: null, avatarUrl: null, lastSignedIn: null },
  university: null,
  communities: [{ id: 1, name: "IE", slug: "ie" }],
  tags: [],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(id: number, role: string) {
  return studentsRouter.createCaller({ user: { id, role } } as any);
}

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

  it("students.adminUpdateProfile (STU-01 Editar) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().adminUpdateProfile({ studentProfileId: 1 })).rejects.toThrow(/please login/i);
  });

  it("students.deleteEligibility (STU-01 Borrar) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().deleteEligibility({ studentProfileId: 1 })).rejects.toThrow(/please login/i);
  });

  it("students.delete (STU-01 Borrar) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().delete({ studentProfileId: 1, reason: "x" })).rejects.toThrow(/please login/i);
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

// ─── STU-01 — RBAC/IDOR de Editar/Ocultar/Borrar ────────────────────────────
// Sin mock de la capa RBAC real (rbac_user_roles): sin conexión a BD en este
// test, checkRbacOrLegacy cae a su propio fallback documentado
// ("cualquier error de BD cae a fallbackAllowedRoles.includes(legacyRole)")
// — exactamente lo que permite probar aquí "admin pasa, user/venue_admin no"
// sin abrir ninguna conexión real, mismo criterio que community.test.ts.

describe("students.adminUpdateProfile — RBAC/IDOR (STU-01 Editar)", () => {
  beforeEach(() => {
    mockGetStudentById.mockResolvedValue(STUDENT_DETAIL_FIXTURE);
    mockGetCommunityAccess.mockResolvedValue("all");
  });

  it("un Student (role=user) es rechazado", async () => {
    await expect(callerAs(1, "user").adminUpdateProfile({ studentProfileId: 1, firstName: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockUpdateStudentAdminProfile).not.toHaveBeenCalled();
  });

  it("venue_admin es rechazado — nunca gana acceso global a Students por esta vía", async () => {
    await expect(callerAs(1, "venue_admin").adminUpdateProfile({ studentProfileId: 1, firstName: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockUpdateStudentAdminProfile).not.toHaveBeenCalled();
  });

  it("un admin sin acceso a la comunidad del estudiante es rechazado (IDOR de alcance)", async () => {
    mockGetCommunityAccess.mockResolvedValue([999]); // ninguna comunidad del estudiante (id 1)
    await expect(callerAs(1, "admin").adminUpdateProfile({ studentProfileId: 1, firstName: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockUpdateStudentAdminProfile).not.toHaveBeenCalled();
  });

  it("un admin con acceso real actualiza correctamente y delega en updateStudentAdminProfile con su propio actorUserId", async () => {
    mockUpdateStudentAdminProfile.mockResolvedValue(STUDENT_DETAIL_FIXTURE);
    const result = await callerAs(7, "admin").adminUpdateProfile({ studentProfileId: 1, firstName: "Ana" });
    expect(result.success).toBe(true);
    expect(mockUpdateStudentAdminProfile).toHaveBeenCalledWith(1, expect.objectContaining({ firstName: "Ana" }), 7);
  });

  it("email duplicado se traduce en CONFLICT, nunca un 500 crudo", async () => {
    mockUpdateStudentAdminProfile.mockRejectedValue(new StudentEmailConflictError());
    await expect(callerAs(7, "admin").adminUpdateProfile({ studentProfileId: 1, email: "otro@example.test" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("estudiante ya no existe → NOT_FOUND", async () => {
    mockGetStudentById.mockResolvedValue(null);
    await expect(callerAs(7, "admin").adminUpdateProfile({ studentProfileId: 999, firstName: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("students.deleteEligibility / students.delete — RBAC/IDOR/mapeo de errores (STU-01 Borrar)", () => {
  beforeEach(() => {
    mockGetStudentById.mockResolvedValue(STUDENT_DETAIL_FIXTURE);
    mockGetCommunityAccess.mockResolvedValue("all");
  });

  it("un Student (role=user) nunca puede consultar elegibilidad ni borrar a otro estudiante", async () => {
    await expect(callerAs(1, "user").deleteEligibility({ studentProfileId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs(1, "user").delete({ studentProfileId: 1, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockDeleteStudent).not.toHaveBeenCalled();
  });

  it("venue_admin nunca puede borrar Students (sin acceso global por esta vía)", async () => {
    await expect(callerAs(1, "venue_admin").delete({ studentProfileId: 1, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockDeleteStudent).not.toHaveBeenCalled();
  });

  it("con actividad real, deleteEligibility devuelve los motivos reales (nunca oculta el bloqueo)", async () => {
    mockEvaluateStudentDeletionEligibility.mockResolvedValue({ canDelete: false, reasons: ["tiene movimientos de SegoTokens"] });
    const result = await callerAs(7, "admin").deleteEligibility({ studentProfileId: 1 });
    expect(result).toEqual({ canDelete: false, reasons: ["tiene movimientos de SegoTokens"] });
  });

  it("delete bloqueado por actividad real se traduce en CONFLICT con el motivo, nunca un 500 crudo", async () => {
    mockDeleteStudent.mockRejectedValue(new StudentDeleteBlockedError(["tiene entradas emitidas"]));
    await expect(callerAs(7, "admin").delete({ studentProfileId: 1, reason: "test" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("auto-borrado / cuenta privilegiada se traduce en FORBIDDEN, nunca un 500 crudo", async () => {
    mockDeleteStudent.mockRejectedValue(new StudentDeleteForbiddenError("No puedes eliminar tu propia cuenta desde este panel."));
    await expect(callerAs(7, "admin").delete({ studentProfileId: 1, reason: "test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un admin con acceso real borra correctamente y delega con su propio actorUserId", async () => {
    mockDeleteStudent.mockResolvedValue({ deleted: true });
    const result = await callerAs(7, "admin").delete({ studentProfileId: 1, reason: "cuenta QA vacía" });
    expect(result.success).toBe(true);
    expect(mockDeleteStudent).toHaveBeenCalledWith(1, 7, "cuenta QA vacía");
  });

  it("segundo intento sobre un estudiante ya borrado (deleted:false) se traduce en NOT_FOUND, nunca un 500", async () => {
    mockDeleteStudent.mockResolvedValue({ deleted: false });
    await expect(callerAs(7, "admin").delete({ studentProfileId: 1, reason: "reintento" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
