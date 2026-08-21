/**
 * studentLifecycleService.test.ts — STU-01. Mismo criterio que
 * studentMessagesDb.test.ts (COM-01): requiere DATABASE_URL real
 * (`mysql://nayade:nayade_pass@localhost:3307/nayade_db`), nunca mockea la
 * cadena de Drizzle — lo que se prueba aquí (transacción con revalidación,
 * detección de bloqueos cruzando ~15 tablas reales, cascada de borrado) es
 * precisamente lo que un mock no verificaría de verdad. Usuarios de prueba
 * dedicados (openId con prefijo `test-stu01-`), creados en beforeAll y
 * limpiados en afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, like } from "drizzle-orm";
import {
  users, studentProfiles, eventAttendance, studentAdminActions,
  notificationPreferences,
} from "../../../drizzle/schema";
import {
  evaluateStudentDeletionEligibility, deleteStudent,
  StudentDeleteBlockedError, StudentDeleteForbiddenError,
} from "./studentLifecycleService";
import { updateStudentAdminProfile, StudentEmailConflictError } from "../../db/studentsDb";

const pool = mysql.createPool({ uri: process.env.DATABASE_URL });
const db = drizzle(pool);

let adminId: number;
let emptyStudentUserId: number;
let emptyStudentProfileId: number;
let blockedStudentUserId: number;
let blockedStudentProfileId: number;
let editTargetUserId: number;
let editTargetProfileId: number;
let takenEmailUserId: number;
let privilegedProfileId: number; // student_profiles apuntando a una cuenta admin (caso defensivo)

async function insertUser(openId: string, role: "user" | "admin", extra: Partial<typeof users.$inferInsert> = {}): Promise<number> {
  const [res] = await db.insert(users).values({ openId, name: `QA ${openId}`, role, ...extra });
  return (res as unknown as { insertId: number }).insertId;
}

async function insertProfile(userId: number): Promise<number> {
  const [res] = await db.insert(studentProfiles).values({ userId });
  return (res as unknown as { insertId: number }).insertId;
}

beforeAll(async () => {
  adminId = await insertUser("test-stu01-admin", "admin");
  emptyStudentUserId = await insertUser("test-stu01-empty", "user");
  emptyStudentProfileId = await insertProfile(emptyStudentUserId);

  blockedStudentUserId = await insertUser("test-stu01-blocked", "user");
  blockedStudentProfileId = await insertProfile(blockedStudentUserId);
  await db.insert(eventAttendance).values({
    eventId: 999999, userId: blockedStudentUserId, provider: "test",
    occurredAt: new Date(), idempotencyKey: `test-stu01-attendance-${blockedStudentUserId}`,
  });

  editTargetUserId = await insertUser("test-stu01-edit-target", "user", { email: "stu01-edit-target@example.test", phone: "+34600000001" });
  editTargetProfileId = await insertProfile(editTargetUserId);

  takenEmailUserId = await insertUser("test-stu01-taken-email", "user", { email: "stu01-taken@example.test" });

  privilegedProfileId = await insertProfile(adminId);
});

afterAll(async () => {
  await db.delete(studentAdminActions).where(eq(studentAdminActions.actorUserId, adminId));
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.openId, "test-stu01-%"));
  for (const u of testUsers) {
    await db.delete(eventAttendance).where(eq(eventAttendance.userId, u.id));
    await db.delete(notificationPreferences).where(eq(notificationPreferences.userId, u.id));
    await db.delete(studentProfiles).where(eq(studentProfiles.userId, u.id));
    await db.delete(users).where(eq(users.id, u.id));
  }
  await pool.end();
});

describe("evaluateStudentDeletionEligibility", () => {
  it("cuenta vacía: canDelete=true, sin motivos", async () => {
    const result = await evaluateStudentDeletionEligibility(emptyStudentUserId, db);
    expect(result.canDelete).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("cuenta con asistencia registrada: canDelete=false, motivo legible", async () => {
    const result = await evaluateStudentDeletionEligibility(blockedStudentUserId, db);
    expect(result.canDelete).toBe(false);
    expect(result.reasons).toContain("tiene asistencia registrada");
  });
});

describe("deleteStudent — borrado guardado", () => {
  it("bloquea el borrado si hay actividad real (no borra nada)", async () => {
    await expect(deleteStudent(blockedStudentProfileId, adminId, "test", db)).rejects.toThrow(StudentDeleteBlockedError);
    const [stillThere] = await db.select().from(studentProfiles).where(eq(studentProfiles.id, blockedStudentProfileId)).limit(1);
    expect(stillThere).toBeDefined();
  });

  it("nunca permite que un Admin se borre a sí mismo, aunque tuviera studentProfileId", async () => {
    await expect(deleteStudent(privilegedProfileId, adminId, "test", db)).rejects.toThrow(StudentDeleteForbiddenError);
  });

  it("nunca borra una cuenta que no sea role=user, aunque otro actor lo intente", async () => {
    // Actor distinto del propio admin objetivo — para aislar el guard de
    // rol del guard de auto-borrado (ambos existen, se prueban por separado).
    const otherActorId = await insertUser("test-stu01-other-actor", "admin");
    try {
      await expect(deleteStudent(privilegedProfileId, otherActorId, "test", db)).rejects.toThrow(StudentDeleteForbiddenError);
    } finally {
      await db.delete(users).where(eq(users.id, otherActorId));
    }
  });

  it("borra de verdad una cuenta vacía: users/student_profiles desaparecen, la cascada limpia, y el audit log SOBREVIVE", async () => {
    await db.insert(notificationPreferences).values({ userId: emptyStudentUserId, category: "account", channel: "in_app", enabled: true });

    const result = await deleteStudent(emptyStudentProfileId, adminId, "cuenta QA vacía, cierre STU-01", db);
    expect(result.deleted).toBe(true);

    const [userRow] = await db.select().from(users).where(eq(users.id, emptyStudentUserId)).limit(1);
    expect(userRow).toBeUndefined();
    const [profileRow] = await db.select().from(studentProfiles).where(eq(studentProfiles.id, emptyStudentProfileId)).limit(1);
    expect(profileRow).toBeUndefined();
    const prefs = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, emptyStudentUserId));
    expect(prefs).toHaveLength(0);

    const auditRows = await db.select().from(studentAdminActions).where(eq(studentAdminActions.studentProfileId, emptyStudentProfileId));
    const deleteAction = auditRows.find(a => a.action === "deleted");
    expect(deleteAction).toBeDefined();
    expect((deleteAction!.metadata as Record<string, unknown> | null)?.emailSnapshot).toBeDefined();
  });

  it("idempotente: un segundo intento sobre el mismo studentProfileId ya borrado devuelve deleted:false, nunca lanza", async () => {
    const result = await deleteStudent(emptyStudentProfileId, adminId, "reintento", db);
    expect(result.deleted).toBe(false);
  });

  it("revalida elegibilidad DENTRO de la propia operación: si aparece actividad justo antes de borrar, bloquea igualmente", async () => {
    const raceUserId = await insertUser("test-stu01-race", "user");
    const raceProfileId = await insertProfile(raceUserId);
    try {
      const before = await evaluateStudentDeletionEligibility(raceUserId, db);
      expect(before.canDelete).toBe(true);
      // Actividad real llega DESPUÉS del check inicial, ANTES del borrado.
      await db.insert(eventAttendance).values({
        eventId: 999999, userId: raceUserId, provider: "test",
        occurredAt: new Date(), idempotencyKey: `test-stu01-race-${raceUserId}`,
      });
      await expect(deleteStudent(raceProfileId, adminId, "test", db)).rejects.toThrow(StudentDeleteBlockedError);
      const [stillThere] = await db.select().from(studentProfiles).where(eq(studentProfiles.id, raceProfileId)).limit(1);
      expect(stillThere).toBeDefined();
    } finally {
      await db.delete(eventAttendance).where(eq(eventAttendance.userId, raceUserId));
      await db.delete(studentProfiles).where(eq(studentProfiles.userId, raceUserId));
      await db.delete(users).where(eq(users.id, raceUserId));
    }
  });
});

describe("updateStudentAdminProfile — edición administrativa", () => {
  it("actualiza campos de studentProfiles y sincroniza users.name al cambiar firstName/lastName", async () => {
    const updated = await updateStudentAdminProfile(editTargetProfileId, { firstName: "Ana", lastName: "García" }, adminId, db);
    expect(updated?.profile.firstName).toBe("Ana");
    expect(updated?.profile.lastName).toBe("García");
    expect(updated?.user.name).toBe("Ana García");
  });

  it("actualiza el email cuando está libre", async () => {
    const updated = await updateStudentAdminProfile(editTargetProfileId, { email: "stu01-edit-target-2@example.test" }, adminId, db);
    expect(updated?.user.email).toBe("stu01-edit-target-2@example.test");
  });

  it("rechaza el email si ya lo usa otra cuenta, sin dejar la fila a medio actualizar", async () => {
    await expect(
      updateStudentAdminProfile(editTargetProfileId, { email: "stu01-taken@example.test" }, adminId, db)
    ).rejects.toThrow(StudentEmailConflictError);
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, editTargetUserId)).limit(1);
    expect(row?.email).toBe("stu01-edit-target-2@example.test"); // no cambió
  });

  it("solo registra en el audit log los campos que realmente cambiaron", async () => {
    await updateStudentAdminProfile(editTargetProfileId, { firstName: "Ana", phone: "+34600000002" }, adminId, db); // firstName igual, phone distinto
    const auditRows = await db.select().from(studentAdminActions)
      .where(eq(studentAdminActions.studentProfileId, editTargetProfileId));
    const editAction = auditRows.filter(a => a.action === "profile_edited").pop();
    expect(editAction).toBeDefined();
    const changedFields = (editAction!.metadata as Record<string, unknown> | null)?.changedFields as string[];
    expect(changedFields).toContain("phone");
    expect(changedFields).not.toContain("firstName");
  });

  it("devuelve null si el studentProfileId ya no existe", async () => {
    const result = await updateStudentAdminProfile(emptyStudentProfileId, { firstName: "X" }, adminId, db);
    expect(result).toBeNull();
  });
});
