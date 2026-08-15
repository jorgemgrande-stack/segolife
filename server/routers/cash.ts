/**
 * cash.ts — SEGOLIFE FASE 10 (spec §44-53). Sesiones de caja por venue.
 * cash.view/cash.operate son operativa de venue (venue_admin/staff, alcance
 * por venue_staff) — cash.manage reservado para uso futuro (correcciones),
 * GLOBAL_ADMIN exclusivo.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import { getVenueStaffAccess } from "../segolife/benefits/venueStaffAccess";
import {
  getOpenSession, openCashSession, closeCashSession, recordCashMovement,
  listCashSessions, getCashSession, computeSessionSummary, CashSessionError,
} from "../segolife/cash/cashSessionService";

const cashViewProcedure = permissionProcedure("cash.view", ["admin"]);
const cashOperateProcedure = permissionProcedure("cash.operate", ["admin"]);

function mapCashError(err: unknown): never {
  if (err instanceof CashSessionError) {
    const codeMap: Record<string, "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN"> = {
      VENUE_NOT_FOUND: "NOT_FOUND", NOT_FOUND: "NOT_FOUND", ALREADY_OPEN: "CONFLICT",
      ALREADY_CLOSED: "CONFLICT", SESSION_CLOSED: "CONFLICT", INVALID_AMOUNT: "BAD_REQUEST", REASON_REQUIRED: "BAD_REQUEST",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

async function assertVenueAuthorized(userId: number, role: string, venueId: number): Promise<void> {
  const access = await getVenueStaffAccess(userId, role, undefined, "cash.manage");
  if (access !== "all" && !access.includes(venueId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tienes autorización de caja para este venue" });
  }
}

export const cashRouter = router({
  currentSession: cashViewProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      const session = await getOpenSession(input.venueId);
      if (!session) return null;
      return computeSessionSummary(session);
    }),

  openSession: cashOperateProcedure
    .input(z.object({ venueId: z.number().int().positive(), openingCashCents: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      try { return await openCashSession(input.venueId, ctx.user.id, input.openingCashCents); } catch (err) { mapCashError(err); }
    }),

  closeSession: cashOperateProcedure
    .input(z.object({ venueId: z.number().int().positive(), sessionId: z.number().int().positive(), countedCashCents: z.number().int().min(0), notes: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      const session = await getCashSession(input.sessionId);
      if (!session || session.venueId !== input.venueId) throw new TRPCError({ code: "NOT_FOUND", message: "Sesión de caja no encontrada" });
      try { return await closeCashSession(input.sessionId, ctx.user.id, input.countedCashCents, input.notes ?? null); } catch (err) { mapCashError(err); }
    }),

  recordMovement: cashOperateProcedure
    .input(z.object({ venueId: z.number().int().positive(), cashSessionId: z.number().int().positive(), type: z.enum(["cash_in", "cash_out"]), amountCents: z.number().int().positive(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      const session = await getCashSession(input.cashSessionId);
      if (!session || session.venueId !== input.venueId) throw new TRPCError({ code: "NOT_FOUND", message: "Sesión de caja no encontrada" });
      try { return await recordCashMovement({ cashSessionId: input.cashSessionId, type: input.type, amountCents: input.amountCents, reason: input.reason, actorUserId: ctx.user.id }); } catch (err) { mapCashError(err); }
    }),

  history: cashViewProcedure
    .input(z.object({ venueId: z.number().int().positive(), limit: z.number().int().min(1).max(200).optional() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      return listCashSessions(input.venueId, input.limit);
    }),

  sessionDetail: cashViewProcedure
    .input(z.object({ venueId: z.number().int().positive(), sessionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      const session = await getCashSession(input.sessionId);
      if (!session || session.venueId !== input.venueId) throw new TRPCError({ code: "NOT_FOUND", message: "Sesión de caja no encontrada" });
      return computeSessionSummary(session);
    }),
});
