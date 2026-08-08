/**
 * studentNotifications.ts — inbox del estudiante (Fase 7, spec punto 65).
 * NOMBRE DELIBERADAMENTE DISTINTO de "notifications" — ese router key ya lo
 * usa server/routers/notifications.ts (campana admin legacy de 6 fuentes de
 * negocio heredadas de Náyade), sin relación alguna con esto.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { listMyNotifications, getUnreadCount, markRead, markAllRead, markClicked, NotificationOwnershipError } from "../segolife/engagement/notificationsDb";
import { listMyPreferences, updatePreference } from "../segolife/engagement/notificationPreferencesService";
import { getProvider } from "../segolife/engagement/providers/providerRegistry";

function mapOwnershipError(err: unknown): never {
  if (err instanceof NotificationOwnershipError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message, cause: err });
  }
  throw err;
}

export const studentNotificationsRouter = router({
  myNotifications: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(({ ctx, input }) => listMyNotifications(ctx.user.id, input?.limit ?? 50)),

  unreadCount: protectedProcedure.query(({ ctx }) => getUnreadCount(ctx.user.id)),

  markRead: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await markRead(input.id, ctx.user.id);
        return { success: true };
      } catch (err) {
        mapOwnershipError(err);
      }
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await markAllRead(ctx.user.id);
    return { success: true };
  }),

  markClicked: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await markClicked(input.id, ctx.user.id);
        return { success: true };
      } catch (err) {
        mapOwnershipError(err);
      }
    }),

  preferences: protectedProcedure.query(({ ctx }) => listMyPreferences(ctx.user.id)),

  // Qué canales están realmente configurados — el frontend nunca debe mostrar
  // push/whatsapp como si funcionaran cuando el provider está sin configurar (spec punto 33).
  channelAvailability: protectedProcedure.query(() => ({
    email: getProvider("email").capabilities.configured,
    push: getProvider("push").capabilities.configured,
    whatsapp: getProvider("whatsapp").capabilities.configured,
  })),

  updatePreferences: protectedProcedure
    .input(z.object({
      category: z.enum(["events", "rewards", "benefits", "promotions", "account"]),
      channel: z.enum(["email", "push", "whatsapp"]), // in_app nunca se expone aquí — no es desactivable (spec punto 61)
      enabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      await updatePreference({ userId: ctx.user.id, ...input }, undefined);
      return { success: true };
    }),
});
