/**
 * eventTicketing.ts — Ticketing Core de Fase 5 (venta de entradas de
 * eventos). NOMBRE DELIBERADAMENTE DISTINTO de "ticketing" — ese nombre ya
 * lo usa server/routers/ticketing.ts, el pipeline LEGACY de cupones/
 * plataformas (Groupon/Smartbox) de Náyade, sin relación alguna con esto.
 * Ver server/_core/rbacSeed.ts para la misma nota sobre el permiso
 * "event_ticketing.*" (nunca "ticketing.*" a secas).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import {
  listSalesChannels, createSalesChannel, setSalesChannelStatus, isEventHybrid,
  listTicketTypes, createTicketType, getTicketTypeInventory,
  listOrders, listEventTickets, listEventAttendance,
} from "../segolife/ticketing/ticketingDb";
import { cancelOrder, refundOrder } from "../segolife/ticketing/ticketCancellationService";
import { CheckoutError } from "../segolife/ticketing/inventoryHoldService";

const eventTicketingViewProcedure = permissionProcedure("event_ticketing.view", ["admin"]);
const eventTicketingManageProcedure = permissionProcedure("event_ticketing.manage", ["admin"]);
const attendanceViewProcedure = permissionProcedure("attendance.view", ["admin"]);

function mapAdminCheckoutError(err: unknown): never {
  if (err instanceof CheckoutError) {
    throw new TRPCError({ code: err.code === "NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

export const eventTicketingRouter = router({
  getEventTicketingSummary: eventTicketingViewProcedure
    .input(z.object({ eventId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [channels, ticketTypes, inventory, orders, tickets, hybrid] = await Promise.all([
        listSalesChannels(input.eventId),
        listTicketTypes(input.eventId),
        getTicketTypeInventory(input.eventId),
        listOrders(input.eventId),
        listEventTickets(input.eventId),
        isEventHybrid(input.eventId),
      ]);
      return { channels, ticketTypes, inventory, orders, tickets, hybrid };
    }),

  createSalesChannel: eventTicketingManageProcedure
    .input(z.object({
      eventId: z.number().int().positive(),
      channelType: z.enum(["fourvenues", "weezevent", "segolife_native", "manual", "partner"]),
      salesMode: z.enum(["external_redirect", "external_checkout", "native"]),
      externalUrl: z.string().url().max(1024).nullish(),
      isPrimary: z.boolean().default(false),
    }))
    .mutation(({ input }) => createSalesChannel(input)),

  setSalesChannelStatus: eventTicketingManageProcedure
    .input(z.object({ id: z.number().int().positive(), status: z.enum(["active", "inactive"]) }))
    .mutation(({ input }) => setSalesChannelStatus(input.id, input.status)),

  createTicketType: eventTicketingManageProcedure
    .input(z.object({
      eventId: z.number().int().positive(),
      name: z.string().min(1).max(256),
      description: z.string().max(2000).nullish(),
      priceCents: z.number().int().nonnegative(),
      currency: z.string().length(3).default("EUR"),
      capacity: z.number().int().positive().nullish(),
      salesStart: z.date().nullish(),
      salesEnd: z.date().nullish(),
    }))
    .mutation(({ input }) => createTicketType(input)),

  listEventAttendance: attendanceViewProcedure
    .input(z.object({ eventId: z.number().int().positive() }))
    .query(({ input }) => listEventAttendance(input.eventId)),

  // ─── Cancelaciones / reembolsos (Fase 8, spec punto 18) ──────────────────────
  cancelOrder: eventTicketingManageProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await cancelOrder(input.orderId, ctx.user.id);
      } catch (err) {
        mapAdminCheckoutError(err);
      }
    }),

  refundOrder: eventTicketingManageProcedure
    .input(z.object({ orderId: z.number().int().positive(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await refundOrder(input.orderId, ctx.user.id, input.reason);
      } catch (err) {
        mapAdminCheckoutError(err);
      }
    }),
});
