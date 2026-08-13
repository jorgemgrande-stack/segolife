/**
 * historicalIdentities.ts — Historical Fourvenues Identity → Segolife Student
 * (SEGOLIFE — HISTORICAL STUDENT IDENTITY CLAIM). Reutiliza exactamente el
 * mismo RBAC que server/routers/students.ts (students.view/students.manage)
 * — esta es una sub-área de Students, no un módulo nuevo con su propio
 * permiso (spec §4: "dentro del área /admin/students").
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import {
  listHistoricalIdentities,
  getHistoricalIdentityDetail,
  claimHistoricalIdentity,
  unclaimHistoricalIdentity,
  classifyMatch,
  HistoricalIdentityError,
} from "../segolife/students/historicalIdentityService";
import { getStudentByUserId } from "../db/studentsDb";

const historicalIdentitiesViewProcedure = permissionProcedure("students.view", ["admin"]);
const historicalIdentitiesManageProcedure = permissionProcedure("students.manage", ["admin"]);

// Enmascarado por defecto (spec §35: "NO mostrar PII completa en el listado
// por defecto") — el servicio interno trabaja con el valor real para poder
// matchear; esta es la única capa de presentación hacia el admin.
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user[0] ?? "*"}***@${domain}`;
}
function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return `***${phone.slice(-4)}`;
}
function maskItem<T extends { email: string | null; phone: string | null }>(item: T): T {
  return { ...item, email: maskEmail(item.email), phone: maskPhone(item.phone) };
}

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
    .query(async ({ input }) => {
      const result = await listHistoricalIdentities(input);
      return { ...result, items: result.items.map(maskItem) };
    }),

  detail: historicalIdentitiesViewProcedure
    .input(z.object({ identityKey: z.string().min(1) }))
    .query(async ({ input }) => {
      const detail = await getHistoricalIdentityDetail(input.identityKey);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Identidad histórica no encontrada" });
      return maskItem(detail);
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
});
