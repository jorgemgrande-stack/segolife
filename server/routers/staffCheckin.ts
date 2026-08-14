/**
 * staffCheckin.ts — check-in nativo de STAFF en puerta (Fase 8, spec puntos
 * 11-14; búsqueda manual añadida en SEGOLIFE — Native Ticket Sales, spec
 * §27). Gate de RBAC: `attendance.redeem` (nuevo, mirroring
 * `benefits.redeem` de Fase 4). El alcance por venue se resuelve con
 * `getVenueStaffAccess(..., "attendance.manage")` — un admin global de
 * asistencia (attendance.manage) valida cualquier venue; sin ese permiso,
 * solo los venues con fila en venue_staff.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import { checkInTicket, checkInTicketById, searchTickets, CheckinError } from "../segolife/ticketing/nativeCheckinService";
import { getVenueStaffAccess } from "../segolife/benefits/venueStaffAccess";

const attendanceRedeemProcedure = permissionProcedure("attendance.redeem", ["admin"]);

function mapCheckinError(err: unknown): never {
  if (err instanceof CheckinError) {
    const codeMap: Record<string, "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST" | "FORBIDDEN"> = {
      NOT_FOUND: "NOT_FOUND",
      ALREADY_USED: "CONFLICT",
      CANCELLED: "BAD_REQUEST",
      REFUNDED: "BAD_REQUEST",
      NOT_NATIVE: "BAD_REQUEST",
      NO_OWNER: "BAD_REQUEST",
      UNAUTHORIZED_STAFF: "FORBIDDEN",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

export const staffCheckinRouter = router({
  myAuthorizedVenues: attendanceRedeemProcedure.query(async ({ ctx }) => {
    const access = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string, undefined, "attendance.manage");
    return access === "all" ? { all: true as const, venueIds: [] as number[] } : { all: false as const, venueIds: access };
  }),

  checkIn: attendanceRedeemProcedure
    .input(z.object({ token: z.string().min(16).max(256) }))
    .mutation(async ({ ctx, input }) => {
      const staffAuthorizedVenueIds = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string, undefined, "attendance.manage");
      try {
        const result = await checkInTicket({ token: input.token, staffUserId: ctx.user.id, staffAuthorizedVenueIds });
        // DTO acotado a lo necesario en puerta — nunca email/teléfono/notas (mismo criterio que benefits.ts staffRedeem).
        return {
          ticketId: result.ticket.id,
          status: result.ticket.status,
          eventName: result.event.name,
          studentName: result.studentName,
        };
      } catch (err) {
        mapCheckinError(err);
      }
    }),

  /** Búsqueda manual (spec §27) — "pantalla rota, QR no carga, usuario no encuentra su entrada". Solo localiza, nunca valida. */
  searchTickets: attendanceRedeemProcedure
    .input(z.object({ query: z.string().min(1).max(128) }))
    .query(async ({ ctx, input }) => {
      const staffAuthorizedVenueIds = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string, undefined, "attendance.manage");
      return searchTickets({ query: input.query, staffAuthorizedVenueIds });
    }),

  /** Check-in por ticketId (spec §27) — EXACTAMENTE el mismo backend de validación que `checkIn` (QR), nunca un bypass. Para cuando la búsqueda manual encontró el ticket correcto. */
  checkInById: attendanceRedeemProcedure
    .input(z.object({ ticketId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const staffAuthorizedVenueIds = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string, undefined, "attendance.manage");
      try {
        const result = await checkInTicketById({ ticketId: input.ticketId, staffUserId: ctx.user.id, staffAuthorizedVenueIds });
        return {
          ticketId: result.ticket.id,
          status: result.ticket.status,
          eventName: result.event.name,
          studentName: result.studentName,
        };
      } catch (err) {
        mapCheckinError(err);
      }
    }),
});
