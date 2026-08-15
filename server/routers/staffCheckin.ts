/**
 * staffCheckin.ts — check-in nativo de STAFF en puerta (Fase 8, spec puntos
 * 11-14; búsqueda manual añadida en SEGOLIFE — Native Ticket Sales, spec
 * §27). Gate de RBAC: `attendance.redeem` (nuevo, mirroring
 * `benefits.redeem` de Fase 4). El alcance por venue se resuelve con
 * `getVenueStaffAccess(..., "attendance.manage")` — un admin global de
 * asistencia (attendance.manage) valida cualquier venue; sin ese permiso,
 * solo los venues con fila en venue_staff.
 *
 * SEGOLIFE — STUDENT IDENTITY, UNIVERSAL QR & UNIFIED CHECK-IN: `checkIn`
 * ahora resuelve el TIPO de credential antes de decidir el flujo (spec §17)
 * — un ticket nativo sigue el camino de siempre sin ningún cambio de
 * comportamiento; un QR permanente de identidad del Student (sin entrada
 * previa) sigue el flujo nuevo, resolviendo el evento vigente del venue
 * cuando es inequívoco (spec §10) y delegando el hecho canónico a
 * ingestAttendance() vía unifiedCheckinService.ts — nunca un motor paralelo.
 * `venueId` es opcional en el input: solo hace falta para el credential de
 * identidad cuando el staff tiene más de un venue asignado (para el ticket,
 * el venue se sigue derivando del propio evento, como siempre).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import { checkInTicket, checkInTicketById, searchTickets, CheckinError } from "../segolife/ticketing/nativeCheckinService";
import {
  resolveScannedCredential, checkInStudentIdentity, linkTicketToIdentityAndCheckIn, UnifiedCheckinError,
} from "../segolife/ticketing/unifiedCheckinService";
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
      ALREADY_LINKED: "CONFLICT",
      UNAUTHORIZED_STAFF: "FORBIDDEN",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  if (err instanceof UnifiedCheckinError) {
    const codeMap: Record<string, "NOT_FOUND" | "BAD_REQUEST" | "FORBIDDEN"> = {
      NOT_FOUND: "NOT_FOUND",
      WRONG_VENUE: "BAD_REQUEST",
      NO_CURRENT_EVENT: "BAD_REQUEST",
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

  /**
   * Escaneo unificado (spec §18/§19) — un solo endpoint para lo que la
   * puerta escanea, sea lo que sea. `venueId` solo es obligatorio cuando el
   * credential resulta ser de identidad Y el staff tiene más de un venue
   * asignado (con un ticket, el venue se deriva del evento, como siempre;
   * con un único venue asignado, se usa automáticamente).
   */
  checkIn: attendanceRedeemProcedure
    .input(z.object({
      token: z.string().min(16).max(256),
      venueId: z.number().int().positive().optional(),
      eventId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const staffAuthorizedVenueIds = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string, undefined, "attendance.manage");
      const resolution = await resolveScannedCredential(input.token);

      if (resolution.type === "native_ticket") {
        try {
          const result = await checkInTicket({ token: input.token, staffUserId: ctx.user.id, staffAuthorizedVenueIds });
          return {
            kind: "ticket_checked_in" as const,
            ticketId: result.ticket.id,
            status: result.ticket.status,
            eventName: result.event.name,
            studentName: result.studentName,
          };
        } catch (err) {
          if (err instanceof CheckinError && err.code === "NO_OWNER") {
            return { kind: "student_resolution_required" as const, ticketId: err.data?.ticketId ?? null };
          }
          mapCheckinError(err);
        }
      }

      if (resolution.type === "student_identity") {
        let venueId = input.venueId;
        if (venueId == null) {
          if (staffAuthorizedVenueIds === "all" || staffAuthorizedVenueIds.length !== 1) {
            return { kind: "venue_selection_required" as const, studentName: resolution.student.name };
          }
          venueId = staffAuthorizedVenueIds[0];
        }
        try {
          const result = await checkInStudentIdentity({ token: input.token, venueId, eventId: input.eventId, staffAuthorizedVenueIds });
          if (result.status === "event_resolution_required") {
            return {
              kind: "event_resolution_required" as const,
              studentName: result.studentName,
              venueId,
              candidates: result.candidates.map(e => ({ id: e.id, name: e.name, startsAt: e.startsAt })),
            };
          }
          return {
            kind: result.status === "already_checked_in" ? "identity_already_checked_in" as const : "identity_checked_in" as const,
            studentName: result.studentName,
            eventName: result.event?.name ?? null,
          };
        } catch (err) {
          mapCheckinError(err);
        }
      }

      return { kind: "unknown_credential" as const };
    }),

  /**
   * Fallback de dos escaneos (spec §9) — segundo escaneo (QR permanente del
   * Student) tras un `student_resolution_required`. Vincula y valida en la
   * misma llamada, mismo backend que el check-in normal.
   */
  linkTicketIdentity: attendanceRedeemProcedure
    .input(z.object({ ticketId: z.number().int().positive(), identityToken: z.string().min(16).max(256) }))
    .mutation(async ({ ctx, input }) => {
      const staffAuthorizedVenueIds = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string, undefined, "attendance.manage");
      try {
        const result = await linkTicketToIdentityAndCheckIn({
          ticketId: input.ticketId, identityToken: input.identityToken, staffUserId: ctx.user.id, staffAuthorizedVenueIds,
        });
        return {
          kind: "ticket_checked_in" as const,
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
