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
  deleteSalesChannelSafe, updateTicketType, deleteTicketTypeSafe, duplicateTicketType,
  updateSalesChannel as updateSalesChannelDb, getSalesChannelById,
} from "../segolife/ticketing/ticketingDb";
import { cancelOrder, refundOrder } from "../segolife/ticketing/ticketCancellationService";
import { CheckoutError } from "../segolife/ticketing/inventoryHoldService";
import { setPrimarySalesChannel, configureSalesMode, SalesModeError } from "../segolife/ticketing/salesModeService";

const eventTicketingViewProcedure = permissionProcedure("event_ticketing.view", ["admin"]);
const eventTicketingManageProcedure = permissionProcedure("event_ticketing.manage", ["admin"]);
const attendanceViewProcedure = permissionProcedure("attendance.view", ["admin"]);

function mapAdminCheckoutError(err: unknown): never {
  if (err instanceof CheckoutError) {
    throw new TRPCError({ code: err.code === "NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

function mapSalesModeError(err: unknown): never {
  if (err instanceof SalesModeError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

/** Vacío o solo espacios se trata como "sin URL todavía" (config incompleta), no como error. */
const externalUrlInput = z.union([z.string().trim().url().max(1024), z.literal("")]).nullish();

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

  /**
   * Traduce la modalidad elegida por el admin (Venta en SEGOLIFE / Venta en
   * otra plataforma / Solo información + "combinar") a operaciones
   * atómicas sobre sales_channels — ver salesModeService.ts. Es la mutation
   * que dispara el selector visual de modalidad del rediseño de Ticketing/
   * Sales; nunca crea orders/payments/tickets.
   */
  configureSalesMode: eventTicketingManageProcedure
    .input(z.object({
      eventId: z.number().int().positive(),
      mode: z.enum(["native", "external", "none"]),
      hybridEnabled: z.boolean().default(false),
      external: z.object({
        channelType: z.enum(["fourvenues", "weezevent", "manual", "partner"]),
        externalUrl: externalUrlInput,
        buttonText: z.string().trim().max(64).nullish(),
        openInNewTab: z.boolean().default(true),
      }).nullish(),
    }))
    .mutation(async ({ input }) => {
      try {
        await configureSalesMode(input.eventId, {
          mode: input.mode,
          hybridEnabled: input.hybridEnabled,
          external: input.external
            ? { ...input.external, externalUrl: input.external.externalUrl || null, buttonText: input.external.buttonText ?? null }
            : undefined,
        });
        return { success: true };
      } catch (err) {
        mapSalesModeError(err);
      }
    }),

  /** "Hacer principal" (spec punto 12) — invariante: como mucho 1 primary activo por evento, garantizado en la misma transacción. */
  setPrimarySalesChannel: eventTicketingManageProcedure
    .input(z.object({ channelId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        await setPrimarySalesChannel(input.channelId);
        return { success: true };
      } catch (err) {
        mapSalesModeError(err);
      }
    }),

  /** Editar un canal existente (URL, texto de botón, nueva pestaña) sin recrearlo. */
  updateSalesChannel: eventTicketingManageProcedure
    .input(z.object({
      id: z.number().int().positive(),
      externalUrl: externalUrlInput,
      buttonText: z.string().trim().max(64).nullish(),
      openInNewTab: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const current = await getSalesChannelById(input.id);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Canal de venta no encontrado" });
      const metadata = {
        ...(current.metadata as Record<string, unknown> | null ?? {}),
        ...(input.buttonText !== undefined ? { buttonText: input.buttonText || null } : {}),
        ...(input.openInNewTab !== undefined ? { openInNewTab: input.openInNewTab } : {}),
      };
      await updateSalesChannelDb(input.id, {
        ...(input.externalUrl !== undefined ? { externalUrl: input.externalUrl || null } : {}),
        metadata,
      });
      return { success: true };
    }),

  /** Borrado seguro (spec punto 22) — si hay pedidos asociados, se rechaza y se pide desactivar en su lugar. */
  deleteSalesChannel: eventTicketingManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => deleteSalesChannelSafe(input.id)),

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

  updateTicketType: eventTicketingManageProcedure
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().min(1).max(256).optional(),
      description: z.string().max(2000).nullish(),
      priceCents: z.number().int().nonnegative().optional(),
      currency: z.string().length(3).optional(),
      capacity: z.number().int().positive().nullish(),
      salesStart: z.date().nullish(),
      salesEnd: z.date().nullish(),
      status: z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...fields } = input;
      return updateTicketType(id, fields);
    }),

  duplicateTicketType: eventTicketingManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const created = await duplicateTicketType(input.id);
      if (!created) throw new TRPCError({ code: "NOT_FOUND", message: "Tipo de entrada no encontrado" });
      return created;
    }),

  /** Borrado seguro (spec punto 10/22) — si hay pedidos/entradas emitidas de este tipo, se rechaza y se pide desactivar. */
  deleteTicketType: eventTicketingManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => deleteTicketTypeSafe(input.id)),

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
