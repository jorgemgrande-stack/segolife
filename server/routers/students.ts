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
  listStudentNotes,
  addStudentNote,
  listStudentTags,
  assignStudentTag,
  unassignStudentTag,
} from "../db/studentsDb";

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
      })
    )
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      const communityIds = resolveCommunityFilter(access, input.communityId);
      return listStudents({ ...input, communityIds });
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
    .input(z.object({ studentProfileId: z.number().int().positive(), status: z.enum(["active", "inactive"]) }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getStudentById(input.studentProfileId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Estudiante no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertStudentAccessible(access, detail.communities.map(c => c.id));
      const updated = await updateStudentAdminFields(input.studentProfileId, { status: input.status });
      return { success: true, profile: updated };
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
});
