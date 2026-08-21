/**
 * lostFound.ts — LNF-01, Lost & Found / Objetos perdidos.
 *
 * Creación del caso vive en lostFoundReportRoutes.ts (REST, multipart —
 * fields + foto opcional en una sola petición). Este router cubre:
 * lectura propia del Student, listado/detalle/transición de estado del
 * Admin, y una comunicación admin↔Student ESPECÍFICA de Lost & Found —
 * necesaria porque `student_messages.manage` (COM-01/STU-02) es
 * exclusivamente de `admin` (venue_admin nunca la tiene, por diseño), pero
 * un venue_admin SÍ debe poder comunicarse sobre un caso DE SU VENUE. Estas
 * procedures son un envoltorio fino sobre las mismas funciones de COM-01
 * (getConversationForAdmin/replyAsAdmin/closeConversation/
 * reopenConversation/markReadByAdmin) — nunca una segunda implementación
 * de mensajería — solo cambia CÓMO se autoriza (alcance por venue vía
 * venue_staff, spec §14, en vez del permiso global de COM-01).
 *
 * IDOR (spec §25): toda operación admin revalida el venueId REAL del caso
 * (getLostFoundReportVenueId, barato) contra el alcance del actor antes de
 * tocar/leer nada más — un venue_admin nunca ve/gestiona un caso de otro
 * venue por manipular el id.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, permissionProcedure } from "../_core/trpc";
import {
  getLostFoundReportForStudent, listLostFoundReportsForStudent,
  getLostFoundReportForAdmin, listLostFoundReportsForAdmin,
  getLostFoundReportVenueId, markFound, markClosedNotFound, reopenReport,
  listCaseActions, countPendingForAdmin, LostFoundError, RESOLUTION_NOTE_MAX_LENGTH,
} from "../segolife/lostFound/lostFoundDb";
import {
  getConversationForAdmin, replyAsAdmin, closeConversation, reopenConversation, markReadByAdmin,
  MESSAGE_BODY_MAX_LENGTH,
} from "../segolife/messaging/studentMessagesDb";
import { notifyStudentNewMessage } from "./studentMessages";
import { getVenueStaffAccess, requireVenueAccess } from "../segolife/benefits/venueStaffAccess";

const lostFoundViewProcedure = permissionProcedure("lost_found.view", ["admin"]);
const lostFoundProcessProcedure = permissionProcedure("lost_found.process", ["admin"]);

function mapError(e: unknown): never {
  if (e instanceof LostFoundError) {
    const code = e.code === "NOT_FOUND" ? "NOT_FOUND" : e.code === "INVALID_TRANSITION" ? "CONFLICT" : "BAD_REQUEST";
    throw new TRPCError({ code, message: e.message });
  }
  throw e;
}

async function assertVenueAuthorizedForReport(userId: number, role: string, reportId: number): Promise<void> {
  const venueId = await getLostFoundReportVenueId(reportId);
  if (venueId === null) throw new TRPCError({ code: "NOT_FOUND", message: "Objeto perdido no encontrado" });
  await requireVenueAccess(userId, role, venueId, "lost_found.manage");
}

/** Best-effort (spec §29, mismo criterio que COM-01): un fallo al enviar el mensaje de resolución NUNCA deshace la transición de estado ya confirmada. */
async function sendResolutionMessageBestEffort(conversationId: number | null, adminUserId: number, body: string): Promise<void> {
  if (!conversationId) return;
  try {
    const result = await replyAsAdmin({ conversationId, adminUserId, body, visibility: "public" });
    await notifyStudentNewMessage(result.conversation.studentUserId, result.conversation.id, result.conversation.subject);
  } catch (err) {
    console.error("[LostFound] No se pudo enviar el mensaje de resolución:", err instanceof Error ? err.message : err);
  }
}

const reportIdInput = z.object({ reportId: z.number().int().positive() });

export const lostFoundRouter = router({
  // ── Student ────────────────────────────────────────────────────────────────
  myReports: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).optional(), offset: z.number().int().min(0).optional() }).optional())
    .query(async ({ input, ctx }) => listLostFoundReportsForStudent(ctx.user.id, input ?? {})),

  myReport: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      try {
        return await getLostFoundReportForStudent(input.id, ctx.user.id);
      } catch (e) { mapError(e); }
    }),

  // ── Admin / venue_admin (alcance por venue) ─────────────────────────────────
  adminPendingCount: lostFoundViewProcedure
    .query(async ({ ctx }) => {
      const access = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string, undefined, "lost_found.manage");
      return countPendingForAdmin(access);
    }),

  adminList: lostFoundViewProcedure
    .input(z.object({
      venueId: z.number().int().positive().optional(),
      communityId: z.number().int().positive().optional(),
      status: z.enum(["open", "found", "closed_not_found"]).optional(),
      search: z.string().max(256).optional(),
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const access = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string, undefined, "lost_found.manage");
      // Un venueId explícito de input SIEMPRE se cruza con el alcance real —
      // nunca se confía en el filtro del cliente por sí solo (IDOR, spec §25).
      const venueIds = access === "all"
        ? (input.venueId ? [input.venueId] : "all" as const)
        : (input.venueId ? access.filter(v => v === input.venueId) : access);
      return listLostFoundReportsForAdmin({ ...input, venueIds });
    }),

  adminGet: lostFoundViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await assertVenueAuthorizedForReport(ctx.user.id, ctx.user.role as string, input.id);
      try {
        const detail = await getLostFoundReportForAdmin(input.id);
        const actions = await listCaseActions(input.id);
        return { ...detail, actions };
      } catch (e) { mapError(e); }
    }),

  adminMarkFound: lostFoundProcessProcedure
    .input(z.object({ reportId: z.number().int().positive(), resolutionNote: z.string().min(1).max(RESOLUTION_NOTE_MAX_LENGTH) }))
    .mutation(async ({ input, ctx }) => {
      await assertVenueAuthorizedForReport(ctx.user.id, ctx.user.role as string, input.reportId);
      let report;
      try {
        report = await markFound(input.reportId, ctx.user.id, input.resolutionNote);
      } catch (e) { mapError(e); }
      await sendResolutionMessageBestEffort(report.conversationId, ctx.user.id, input.resolutionNote);
      return report;
    }),

  adminMarkClosedNotFound: lostFoundProcessProcedure
    .input(z.object({ reportId: z.number().int().positive(), resolutionNote: z.string().min(1).max(RESOLUTION_NOTE_MAX_LENGTH) }))
    .mutation(async ({ input, ctx }) => {
      await assertVenueAuthorizedForReport(ctx.user.id, ctx.user.role as string, input.reportId);
      let report;
      try {
        report = await markClosedNotFound(input.reportId, ctx.user.id, input.resolutionNote);
      } catch (e) { mapError(e); }
      await sendResolutionMessageBestEffort(report.conversationId, ctx.user.id, input.resolutionNote);
      return report;
    }),

  adminReopen: lostFoundProcessProcedure
    .input(z.object({ reportId: z.number().int().positive(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ input, ctx }) => {
      await assertVenueAuthorizedForReport(ctx.user.id, ctx.user.role as string, input.reportId);
      try {
        return await reopenReport(input.reportId, ctx.user.id, input.reason);
      } catch (e) { mapError(e); }
    }),

  // ── Comunicación del caso (envoltorio fino sobre COM-01, spec §10/§14) ──────
  adminGetConversation: lostFoundViewProcedure
    .input(reportIdInput)
    .query(async ({ input, ctx }) => {
      await assertVenueAuthorizedForReport(ctx.user.id, ctx.user.role as string, input.reportId);
      const detail = await getLostFoundReportForAdmin(input.reportId).catch(() => null);
      if (!detail?.report.conversationId) throw new TRPCError({ code: "NOT_FOUND", message: "Este caso todavía no tiene conversación" });
      try {
        return await getConversationForAdmin(detail.report.conversationId);
      } catch (e) { mapError(e); }
    }),

  adminReplyToConversation: lostFoundProcessProcedure
    .input(z.object({ reportId: z.number().int().positive(), body: z.string().min(1).max(MESSAGE_BODY_MAX_LENGTH) }))
    .mutation(async ({ input, ctx }) => {
      await assertVenueAuthorizedForReport(ctx.user.id, ctx.user.role as string, input.reportId);
      const detail = await getLostFoundReportForAdmin(input.reportId).catch(() => null);
      if (!detail?.report.conversationId) throw new TRPCError({ code: "NOT_FOUND", message: "Este caso todavía no tiene conversación" });
      let result;
      try {
        result = await replyAsAdmin({ conversationId: detail.report.conversationId, adminUserId: ctx.user.id, body: input.body, visibility: "public" });
      } catch (e) { mapError(e); }
      await notifyStudentNewMessage(result.conversation.studentUserId, result.conversation.id, result.conversation.subject);
      return result;
    }),

  adminCloseConversation: lostFoundProcessProcedure
    .input(reportIdInput)
    .mutation(async ({ input, ctx }) => {
      await assertVenueAuthorizedForReport(ctx.user.id, ctx.user.role as string, input.reportId);
      const detail = await getLostFoundReportForAdmin(input.reportId).catch(() => null);
      if (!detail?.report.conversationId) throw new TRPCError({ code: "NOT_FOUND", message: "Este caso todavía no tiene conversación" });
      try {
        return await closeConversation(detail.report.conversationId, ctx.user.id);
      } catch (e) { mapError(e); }
    }),

  adminReopenConversation: lostFoundProcessProcedure
    .input(reportIdInput)
    .mutation(async ({ input, ctx }) => {
      await assertVenueAuthorizedForReport(ctx.user.id, ctx.user.role as string, input.reportId);
      const detail = await getLostFoundReportForAdmin(input.reportId).catch(() => null);
      if (!detail?.report.conversationId) throw new TRPCError({ code: "NOT_FOUND", message: "Este caso todavía no tiene conversación" });
      try {
        return await reopenConversation(detail.report.conversationId);
      } catch (e) { mapError(e); }
    }),

  adminMarkConversationRead: lostFoundProcessProcedure
    .input(reportIdInput)
    .mutation(async ({ input, ctx }) => {
      await assertVenueAuthorizedForReport(ctx.user.id, ctx.user.role as string, input.reportId);
      const detail = await getLostFoundReportForAdmin(input.reportId).catch(() => null);
      if (!detail?.report.conversationId) return { success: true };
      await markReadByAdmin(detail.report.conversationId);
      return { success: true };
    }),
});
