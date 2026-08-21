/**
 * studentMessages.ts — COM-01, Bidirectional Student Communication Center.
 * Mismo criterio que community.ts: un único namespace `studentMessages` con
 * procedures Student (protectedProcedure, self-scoped por ctx.user.id) y
 * Admin (permissionProcedure "student_messages.view"/"student_messages.manage",
 * fallback legacy ["admin"] — nunca venue_admin, ver venueAdminPolicy.ts).
 *
 * IDOR (spec §19): toda comprobación de propiedad vive en
 * studentMessagesDb.ts (StudentMessagesError "NOT_FOUND" para conversación
 * ajena/inexistente — nunca FORBIDDEN, para no confirmar la existencia de
 * una conversación de otro Student).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, permissionProcedure } from "../_core/trpc";
import {
  createConversation, replyAsStudent, replyAsAdmin,
  getConversationForStudent, getConversationForAdmin,
  listConversationsForStudent, listConversationsForAdmin,
  countAwaitingAdmin, closeConversation, reopenConversation,
  markReadByStudent, markReadByAdmin,
  StudentMessagesError, MESSAGE_BODY_MAX_LENGTH, SUBJECT_MAX_LENGTH,
} from "../segolife/messaging/studentMessagesDb";
import { getStudentByUserId } from "../db/studentsDb";
import { getUserCommunitiesWithDetails } from "../db/communitiesDb";
import { createNotification } from "../segolife/engagement/notificationService";

const studentMessagesViewProcedure = permissionProcedure("student_messages.view", ["admin"]);
const studentMessagesManageProcedure = permissionProcedure("student_messages.manage", ["admin"]);

function mapError(e: unknown): never {
  if (e instanceof StudentMessagesError) {
    const code = e.code === "NOT_FOUND" ? "NOT_FOUND" : e.code === "CONVERSATION_CLOSED" ? "BAD_REQUEST" : "BAD_REQUEST";
    throw new TRPCError({ code, message: e.message });
  }
  throw e;
}

/**
 * Aviso in-app de un mensaje nuevo — NUNCA el cuerpo completo (spec §8),
 * best-effort (spec §29: un fallo aquí nunca deshace el mensaje ya
 * persistido, que es la escritura core). Sin comunidad real del Student
 * (caso límite, no debería ocurrir en la práctica) se omite el deep link en
 * vez de fallar la notificación entera.
 */
async function notifyStudentNewMessage(studentUserId: number, conversationId: number, subject: string): Promise<void> {
  try {
    const memberships = await getUserCommunitiesWithDetails(studentUserId);
    const primary = memberships[0];
    const deepLink = primary ? `/${primary.slug}/messages/${conversationId}` : null;
    await createNotification({
      userId: studentUserId,
      communityId: primary?.id ?? null,
      type: "student_message_received",
      category: "messages",
      audienceType: "transactional",
      rendered: {
        titleEn: `New message: ${subject}`,
        titleEs: `Nuevo mensaje: ${subject}`,
        bodyEn: "Tap to view your conversation with Segolife.",
        bodyEs: "Toca para ver tu conversación con Segolife.",
        deepLink,
      },
      sourceType: "conversation",
      sourceId: conversationId,
      idempotencyKey: `conversation_message:${conversationId}:${Date.now()}`,
    });
  } catch {
    // Best-effort — el mensaje ya persistido nunca desaparece por esto (spec §29).
  }
}

const bodyInput = z.string().min(1).max(MESSAGE_BODY_MAX_LENGTH);
const conversationIdInput = z.object({ conversationId: z.number().int().positive() });

export const studentMessagesRouter = router({
  // ── Student ────────────────────────────────────────────────────────────────
  myConversations: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).optional(), offset: z.number().int().min(0).optional() }).optional())
    .query(async ({ input, ctx }) => listConversationsForStudent(ctx.user.id, input ?? {})),

  getConversation: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      try {
        return await getConversationForStudent(input.id, ctx.user.id);
      } catch (e) { mapError(e); }
    }),

  reply: protectedProcedure
    .input(z.object({ conversationId: z.number().int().positive(), body: bodyInput }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await replyAsStudent({ conversationId: input.conversationId, studentUserId: ctx.user.id, body: input.body });
      } catch (e) { mapError(e); }
    }),

  markRead: protectedProcedure
    .input(conversationIdInput)
    .mutation(async ({ input, ctx }) => {
      try {
        await markReadByStudent(input.conversationId, ctx.user.id);
        return { success: true };
      } catch (e) { mapError(e); }
    }),

  // ── Admin ──────────────────────────────────────────────────────────────────
  adminList: studentMessagesViewProcedure
    .input(z.object({
      status: z.enum(["open", "closed"]).optional(),
      waitingFor: z.enum(["student", "admin", "none"]).optional(),
      search: z.string().max(256).optional(),
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }))
    .query(async ({ input }) => listConversationsForAdmin(input)),

  adminPendingCount: studentMessagesViewProcedure.query(async () => countAwaitingAdmin()),

  adminGetConversation: studentMessagesViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        return await getConversationForAdmin(input.id);
      } catch (e) { mapError(e); }
    }),

  adminCreateConversation: studentMessagesManageProcedure
    .input(z.object({
      studentUserId: z.number().int().positive(),
      subject: z.string().min(1).max(SUBJECT_MAX_LENGTH),
      body: bodyInput,
    }))
    .mutation(async ({ input, ctx }) => {
      const student = await getStudentByUserId(input.studentUserId);
      if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Estudiante no encontrado" });

      let result;
      try {
        result = await createConversation({
          studentUserId: input.studentUserId,
          createdByUserId: ctx.user.id,
          subject: input.subject,
          body: input.body,
        });
      } catch (e) { mapError(e); }

      await notifyStudentNewMessage(input.studentUserId, result.conversation.id, result.conversation.subject);
      return result;
    }),

  adminReply: studentMessagesManageProcedure
    .input(z.object({
      conversationId: z.number().int().positive(),
      body: bodyInput,
      visibility: z.enum(["public", "internal"]).default("public"),
    }))
    .mutation(async ({ input, ctx }) => {
      let result;
      try {
        result = await replyAsAdmin({
          conversationId: input.conversationId,
          adminUserId: ctx.user.id,
          body: input.body,
          visibility: input.visibility,
        });
      } catch (e) { mapError(e); }

      // Una nota interna nunca genera un aviso al Student — nunca debe verla.
      if (input.visibility === "public") {
        await notifyStudentNewMessage(result.conversation.studentUserId, result.conversation.id, result.conversation.subject);
      }
      return result;
    }),

  adminClose: studentMessagesManageProcedure
    .input(conversationIdInput)
    .mutation(async ({ input, ctx }) => {
      try {
        return await closeConversation(input.conversationId, ctx.user.id);
      } catch (e) { mapError(e); }
    }),

  adminReopen: studentMessagesManageProcedure
    .input(conversationIdInput)
    .mutation(async ({ input }) => {
      try {
        return await reopenConversation(input.conversationId);
      } catch (e) { mapError(e); }
    }),

  adminMarkRead: studentMessagesManageProcedure
    .input(conversationIdInput)
    .mutation(async ({ input }) => {
      try {
        await markReadByAdmin(input.conversationId);
        return { success: true };
      } catch (e) { mapError(e); }
    }),
});
