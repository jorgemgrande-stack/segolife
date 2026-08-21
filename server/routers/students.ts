import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, permissionProcedure } from "../_core/trpc";
import { getCommunityAccess, resolveCommunityFilter } from "../_core/communityAccess";
import {
  listStudents,
  getStudentById,
  getStudentByUserId,
  ensureStudentProfile,
  updateStudentProfile,
  updateStudentAdminFields,
  updateStudentAdminProfile,
  StudentEmailConflictError,
  listStudentNotes,
  addStudentNote,
  updateStudentNote,
  deleteStudentNote,
  listStudentTags,
  assignStudentTag,
  unassignStudentTag,
} from "../db/studentsDb";
import { recordStudentAdminAction } from "../segolife/students/studentAdminActionsDb";
import {
  evaluateStudentDeletionEligibility,
  deleteStudent,
  StudentDeleteBlockedError,
  StudentDeleteForbiddenError,
} from "../segolife/students/studentLifecycleService";
import { listStudentsBySegment } from "../segolife/students/studentSegmentFilterService";
import { removeMyPhoto } from "../segolife/students/studentPhotoService";
import { listPhotoEventsByUserId } from "../segolife/students/studentPhotoEventsDb";
import { getDb } from "../db";

// Lectura del CRM de estudiantes: ver el listado/fichas.
const studentsViewProcedure = permissionProcedure("students.view", ["admin"]);
// Escritura administrativa: status, etiquetas, notas.
const studentsManageProcedure = permissionProcedure("students.manage", ["admin"]);

const communityFilterInput = z.union([z.number().int().positive(), z.literal("all")]).optional();

const editableProfileSchema = z.object({
  firstName: z.string().min(1).max(128).nullish(),
  lastName: z.string().min(1).max(128).nullish(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  nationality: z.string().length(2).nullish(),
  countryOfOrigin: z.string().length(2).nullish(),
  preferredLocale: z.enum(["en", "es"]).nullish(),
  universityId: z.number().int().positive().nullish(),
  degreeProgram: z.string().max(256).nullish(),
  academicYear: z.string().max(32).nullish(),
  arrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  expectedDepartureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  addressLine: z.string().max(256).nullish(),
  postalCode: z.string().max(16).nullish(),
  city: z.string().max(128).nullish(),
});

// STU-01 — edición administrativa: mismos campos de studentProfiles que el
// autoservicio (editableProfileSchema) + email/phone (users), que el propio
// estudiante no gestiona desde este flujo. Comunidad/rol/wallet/tickets/
// auth quedan deliberadamente fuera — nunca editables por esta vía.
const adminEditableStudentSchema = editableProfileSchema.extend({
  email: z.string().email().max(320).nullish(),
  phone: z.string().max(32).nullish(),
});

/** Lanza FORBIDDEN si el alcance del admin no cubre ninguna comunidad del estudiante. */
function assertStudentAccessible(access: "all" | number[], studentCommunityIds: number[]) {
  if (access === "all") return;
  const hasOverlap = studentCommunityIds.some(id => access.includes(id));
  if (!hasOverlap) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este estudiante" });
  }
}

export const studentsRouter = router({
  // ─── CRM ADMIN — lectura ────────────────────────────────────────────────────

  list: studentsViewProcedure
    .input(
      z.object({
        communityId: communityFilterInput,
        search: z.string().max(256).optional(),
        universityId: z.number().int().positive().optional(),
        nationality: z.string().length(2).optional(),
        status: z.enum(["active", "inactive"]).optional(),
        profileCompleted: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
        sortBy: z.enum(["createdAt", "name"]).default("createdAt"),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
      })
    )
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      const communityIds = resolveCommunityFilter(access, input.communityId);
      return listStudents({ ...input, communityIds });
    }),

  /**
   * Deep navigation desde el Command Center (Student Intelligence, spec §10
   * de la fase "Production Polish Gate") — el gap conocido: los segmentos
   * (new/active/highly_engaged/at_risk/dormant/high_spend) no eran
   * filtrables porque son computados, no una columna. Reutiliza
   * `studentSegmentFilterService.ts` — nunca modifica `listStudents`.
   */
  listBySegment: studentsViewProcedure
    .input(
      z.object({
        segment: z.enum(["new", "active", "highly_engaged", "at_risk", "dormant", "high_spend"]),
        communityId: communityFilterInput,
        search: z.string().max(256).optional(),
        universityId: z.number().int().positive().optional(),
        nationality: z.string().length(2).optional(),
        profileCompleted: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      const communityIds = resolveCommunityFilter(access, input.communityId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
      return listStudentsBySegment(input.segment, { ...input, communityIds }, db as never);
    }),

  getById: studentsViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const detail = await getStudentById(input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Estudiante no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertStudentAccessible(access, detail.communities.map(c => c.id));
      return detail;
    }),

  getByUserId: studentsViewProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const detail = await getStudentByUserId(input.userId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Estudiante no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertStudentAccessible(access, detail.communities.map(c => c.id));
      return detail;
    }),

  listTags: studentsViewProcedure.query(async () => listStudentTags()),

  listNotes: studentsViewProcedure
    .input(z.object({ studentProfileId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const detail = await getStudentById(input.studentProfileId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Estudiante no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertStudentAccessible(access, detail.communities.map(c => c.id));
      return listStudentNotes(input.studentProfileId);
    }),

  // ─── CRM ADMIN — escritura ──────────────────────────────────────────────────

  updateAdminFields: studentsManageProcedure
    .input(z.object({
      studentProfileId: z.number().int().positive(),
      status: z.enum(["active", "inactive"]),
      // Trazabilidad obligatoria — auditoría Student 360 §7: era el único
      // cambio administrativo sin actor/motivo/histórico en toda la ficha.
      reason: z.string().min(1).max(512),
    }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getStudentById(input.studentProfileId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Estudiante no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertStudentAccessible(access, detail.communities.map(c => c.id));
      const beforeStatus = detail.profile.status;
      const updated = await updateStudentAdminFields(input.studentProfileId, { status: input.status });
      if (beforeStatus !== input.status) {
        await recordStudentAdminAction({
          studentProfileId: input.studentProfileId,
          actorUserId: ctx.user.id,
          action: "status_changed",
          beforeValue: beforeStatus,
          afterValue: input.status,
          reason: input.reason,
        });
      }
      return { success: true, profile: updated };
    }),

  /** STU-01 — Editar. Mismo backend que llame la lista o la ficha (nunca diverge por superficie). */
  adminUpdateProfile: studentsManageProcedure
    .input(adminEditableStudentSchema.extend({ studentProfileId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const { studentProfileId, ...fields } = input;
      const detail = await getStudentById(studentProfileId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "El estudiante ya no existe." });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertStudentAccessible(access, detail.communities.map(c => c.id));
      try {
        const updated = await updateStudentAdminProfile(studentProfileId, fields, ctx.user.id);
        if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "El estudiante ya no existe." });
        return { success: true, student: updated };
      } catch (err) {
        if (err instanceof StudentEmailConflictError) {
          throw new TRPCError({ code: "CONFLICT", message: err.message });
        }
        throw err;
      }
    }),

  /** STU-01 — Borrar: elegibilidad. Consulta cara solo bajo demanda (nunca por fila del listado). */
  deleteEligibility: studentsManageProcedure
    .input(z.object({ studentProfileId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const detail = await getStudentById(input.studentProfileId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "El estudiante ya no existe." });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertStudentAccessible(access, detail.communities.map(c => c.id));
      return evaluateStudentDeletionEligibility(detail.profile.userId);
    }),

  /** STU-01 — Borrar. Revalida elegibilidad dentro de la propia transacción (nunca confía en un check previo). */
  delete: studentsManageProcedure
    .input(z.object({ studentProfileId: z.number().int().positive(), reason: z.string().min(1).max(512) }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getStudentById(input.studentProfileId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "El estudiante ya no existe." });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertStudentAccessible(access, detail.communities.map(c => c.id));
      try {
        const result = await deleteStudent(input.studentProfileId, ctx.user.id, input.reason);
        if (!result.deleted) throw new TRPCError({ code: "NOT_FOUND", message: "El estudiante ya no existe." });
        return { success: true };
      } catch (err) {
        if (err instanceof StudentDeleteBlockedError) {
          throw new TRPCError({ code: "CONFLICT", message: err.message });
        }
        if (err instanceof StudentDeleteForbiddenError) {
          throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        }
        throw err;
      }
    }),

  addNote: studentsManageProcedure
    .input(z.object({ studentProfileId: z.number().int().positive(), note: z.string().min(1).max(4000) }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getStudentById(input.studentProfileId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Estudiante no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertStudentAccessible(access, detail.communities.map(c => c.id));
      return addStudentNote(input.studentProfileId, ctx.user.id, input.note);
    }),

  updateNote: studentsManageProcedure
    .input(z.object({ studentProfileId: z.number().int().positive(), noteId: z.number().int().positive(), note: z.string().min(1).max(4000) }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getStudentById(input.studentProfileId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Estudiante no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertStudentAccessible(access, detail.communities.map(c => c.id));
      const updated = await updateStudentNote(input.noteId, ctx.user.id, input.note);
      if (!updated) throw new TRPCError({ code: "FORBIDDEN", message: "Solo el autor puede editar esta nota" });
      return updated;
    }),

  deleteNote: studentsManageProcedure
    .input(z.object({ studentProfileId: z.number().int().positive(), noteId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getStudentById(input.studentProfileId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Estudiante no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertStudentAccessible(access, detail.communities.map(c => c.id));
      const deleted = await deleteStudentNote(input.noteId, ctx.user.id);
      if (!deleted) throw new TRPCError({ code: "FORBIDDEN", message: "Solo el autor puede borrar esta nota" });
      return { success: true };
    }),

  assignTag: studentsManageProcedure
    .input(z.object({ studentProfileId: z.number().int().positive(), tagId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getStudentById(input.studentProfileId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Estudiante no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertStudentAccessible(access, detail.communities.map(c => c.id));
      await assignStudentTag(input.studentProfileId, input.tagId, ctx.user.id);
      return { success: true };
    }),

  unassignTag: studentsManageProcedure
    .input(z.object({ studentProfileId: z.number().int().positive(), tagId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getStudentById(input.studentProfileId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Estudiante no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertStudentAccessible(access, detail.communities.map(c => c.id));
      await unassignStudentTag(input.studentProfileId, input.tagId);
      return { success: true };
    }),

  // ─── AUTOSERVICIO DEL ESTUDIANTE ────────────────────────────────────────────
  // Nunca devuelve notas ni etiquetas internas — ver docs/SEGOLIFE_ROADMAP.md
  // §privacidad. `ensureStudentProfile` crea la fila vacía en el primer acceso
  // (onboarding), así "me" nunca es null para un usuario autenticado.

  me: protectedProcedure.query(async ({ ctx }) => {
    await ensureStudentProfile(ctx.user.id);
    const detail = await getStudentByUserId(ctx.user.id);
    if (!detail) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo crear el perfil" });
    // Autoservicio: nunca se exponen tags/notas internas al propio estudiante.
    const { tags: _tags, ...publicDetail } = detail;
    return publicDetail;
  }),

  updateProfile: protectedProcedure
    .input(editableProfileSchema)
    .mutation(async ({ input, ctx }) => {
      const updated = await updateStudentProfile(ctx.user.id, input);
      return { success: true, profile: updated };
    }),

  // MG-03 — la subida vive en studentPhotoRoutes.ts (REST, multipart) por lo
  // mismo que el resto de uploads de este proyecto; eliminar no maneja
  // bytes, así que sigue aquí el patrón normal de mutación tRPC self-service
  // (nunca un userId de input — siempre ctx.user.id, mismo criterio que
  // updateProfile de arriba).
  removeMyPhoto: protectedProcedure.mutation(async ({ ctx }) => {
    await removeMyPhoto(ctx.user.id);
    return { success: true };
  }),

  // MG-03B — Profile Photo Activity: siempre ctx.user.id (nunca un userId de
  // input), mismo criterio de autoservicio que el resto de este router —
  // ningún Student puede leer la actividad de foto de otro.
  myPhotoActivity: protectedProcedure.query(async ({ ctx }) => listPhotoEventsByUserId(ctx.user.id)),
});
