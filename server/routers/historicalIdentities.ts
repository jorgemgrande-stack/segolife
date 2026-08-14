/**
 * historicalIdentities.ts — Historical Fourvenues Identity → Segolife Student
 * (SEGOLIFE — HISTORICAL STUDENT IDENTITY CLAIM). Reutiliza exactamente el
 * mismo RBAC que server/routers/students.ts (students.view/students.manage)
 * — esta es una sub-área de Students, no un módulo nuevo con su propio
 * permiso (spec §4: "dentro del área /admin/students").
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure, protectedProcedure } from "../_core/trpc";
import {
  listHistoricalIdentities,
  getHistoricalIdentityDetail,
  claimHistoricalIdentity,
  unclaimHistoricalIdentity,
  classifyMatch,
  getMyHistoricalMatchPreview,
  claimMyHistoricalIdentity,
  HistoricalIdentityError,
} from "../segolife/students/historicalIdentityService";
import { getStudentByUserId } from "../db/studentsDb";

const historicalIdentitiesViewProcedure = permissionProcedure("students.view", ["admin"]);
const historicalIdentitiesManageProcedure = permissionProcedure("students.manage", ["admin"]);

// PII COMPLETA, SIN ENMASCARAR (Historical Students Admin — Full Identity
// Visibility, 2026-08-14): esta superficie está protegida por RBAC real
// server-side (permissionProcedure lanza UNAUTHORIZED/FORBIDDEN antes de
// ejecutar el resolver — ver server/_core/trpc.ts) y es de uso exclusivo
// del admin autorizado (students.view/students.manage). El enmascarado
// previo dificultaba el propósito administrativo de la herramienta (no se
// podía identificar a la persona real). Nunca se expone por esta vía a
// superficies públicas ni a otros routers — historicalIdentityService.ts
// solo lo importan este router y el hook best-effort de registro (que
// nunca devuelve datos al cliente).

function mapHistoricalIdentityError(err: unknown): never {
  if (err instanceof HistoricalIdentityError) {
    const code = err.code === "NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST";
    throw new TRPCError({ code, message: err.message });
  }
  throw err;
}

export const historicalIdentitiesRouter = router({
  list: historicalIdentitiesViewProcedure
    .input(
      z.object({
        search: z.string().max(256).optional(),
        venueId: z.number().int().positive().optional(),
        crossVenueOnly: z.boolean().optional(),
        status: z.enum(["UNREGISTERED", "POSSIBLE_MATCH", "AUTO_MATCH_CANDIDATE", "LINKED", "CONFLICT"]).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
        sortBy: z.enum(["lastActivity", "eventsCount", "historicalSpendCents", "venueIds"]).default("lastActivity"),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
      })
    )
    .query(({ input }) => listHistoricalIdentities(input)),

  detail: historicalIdentitiesViewProcedure
    .input(z.object({ identityKey: z.string().min(1) }))
    .query(async ({ input }) => {
      const detail = await getHistoricalIdentityDetail(input.identityKey);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Identidad histórica no encontrada" });
      return detail;
    }),

  /** Propone el match para un userId concreto elegido en el picker — solo consulta, nunca vincula. */
  previewMatchForStudent: historicalIdentitiesViewProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const student = await getStudentByUserId(input.userId);
      if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Estudiante no encontrado" });
      return classifyMatch(student.user.email, student.user.phone);
    }),

  claim: historicalIdentitiesManageProcedure
    .input(z.object({ identityKey: z.string().min(1), userId: z.number().int().positive(), reason: z.string().max(512).optional() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await claimHistoricalIdentity({
          identityKey: input.identityKey,
          userId: input.userId,
          actorUserId: ctx.user.id,
          method: "admin_manual",
          reason: input.reason ?? null,
        });
      } catch (err) {
        mapHistoricalIdentityError(err);
      }
    }),

  unclaim: historicalIdentitiesManageProcedure
    .input(z.object({ identityKey: z.string().min(1), reason: z.string().min(1).max(512) }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await unclaimHistoricalIdentity({ identityKey: input.identityKey, actorUserId: ctx.user.id, reason: input.reason });
      } catch (err) {
        mapHistoricalIdentityError(err);
      }
    }),

  // ─── AUTOSERVICIO DEL ESTUDIANTE (spec §7/§40, Production Safety Gate) ────
  // protectedProcedure (cualquier usuario autenticado), NUNCA permissionProcedure
  // — no hace falta students.view/manage porque el alcance está limitado por
  // construcción a la PROPIA identidad de ctx.user. Ninguno de los dos
  // procedures acepta identityKey/userId del cliente: ambos se resuelven
  // SIEMPRE a partir de ctx.user.id, así que no hay superficie para que un
  // estudiante reclame o consulte la identidad de otro adivinando un ID.

  myHistoricalMatch: protectedProcedure.query(({ ctx }) => getMyHistoricalMatchPreview(ctx.user.id)),

  claimMyHistory: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      return await claimMyHistoricalIdentity(ctx.user.id);
    } catch (err) {
      mapHistoricalIdentityError(err);
    }
  }),
});
