/**
 * ticketPurchase.ts — checkout nativo + "My Tickets"/"My Orders" del
 * ESTUDIANTE (Fase 8, spec puntos 8, 10). Todo protectedProcedure (nunca
 * publicProcedure — comprar/ver tus propias entradas exige sesión) con
 * ownership real en cada query/mutation (ver ticketingDb.ts). DTOs propios:
 * el QR en claro (`qrToken`) SOLO se expone si `status === "issued"` —
 * nunca para cancelled/refunded/used (spec punto 10, "invalid" no es un
 * status real de event_tickets pero se trata igual: nunca mostrar el
 * código si no es válido para presentar en puerta).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { startCheckout, initiatePayment, CheckoutError } from "../segolife/ticketing/checkoutService";
import { cancelOrder } from "../segolife/ticketing/ticketCancellationService";
import { expireStaleHoldsForUser } from "../segolife/ticketing/inventoryHoldService";
import { listMyOrders, getMyOrderById, listMyTickets, getMyTicketById, type MyTicketWithEvent } from "../segolife/ticketing/ticketingDb";
import { getOrCreateMyIdentityToken, rotateMyIdentityToken } from "../segolife/commerce/studentIdentityService";
import { getEventById } from "../db/eventsDb";
import { getUserCommunitiesWithDetails } from "../db/communitiesDb";

function mapCheckoutError(err: unknown): never {
  if (err instanceof CheckoutError) {
    const httpCode = err.code === "NOT_FOUND" ? "NOT_FOUND" : err.code === "SOLD_OUT" || err.code === "TICKET_TYPE_UNAVAILABLE" ? "CONFLICT" : "BAD_REQUEST";
    throw new TRPCError({ code: httpCode, message: err.message, cause: err });
  }
  throw err;
}

function toTicketDto(row: MyTicketWithEvent) {
  const { ticket, event } = row;
  return {
    id: ticket.id,
    status: ticket.status,
    issuedAt: ticket.issuedAt,
    // Nunca se expone qr_token_hash — solo el token en claro, y solo si el ticket sigue "issued".
    qrToken: ticket.status === "issued" ? ticket.qrToken : null,
    event: event ? { id: event.id, name: event.name, slug: event.slug, startsAt: event.startsAt, imageUrl: event.imageUrl } : null,
  };
}

export const ticketPurchaseRouter = router({
  startCheckout: protectedProcedure
    .input(z.object({
      eventId: z.number().int().positive(),
      items: z.array(z.object({ ticketTypeId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1),
      idempotencyKey: z.string().min(8).max(191),
      // Fase 15 (spec §17) introdujo este check pero lo dejó opcional y
      // basado en el `communityId` que el CLIENTE afirmaba estar viendo
      // (derivado de la URL, nunca de su membresía real) — omitirlo, o
      // simplemente afirmar cualquier communityId del evento, lo saltaba
      // por completo. PRE-16 overnight hardening (auditoría real): ya no se
      // usa como filtro de autorización — solo la membresía REAL del
      // comprador (resuelta server-side abajo) decide. Se conserva en el
      // input únicamente por compatibilidad de firma con clientes
      // existentes; su valor nunca se lee más abajo.
      communityId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const detail = await getEventById(input.eventId);
      if (detail && detail.communities.length > 0) {
        const myCommunities = await getUserCommunitiesWithDetails(ctx.user.id);
        const myCommunityIds = new Set(myCommunities.map(c => c.id));
        if (!detail.communities.some(c => myCommunityIds.has(c.id))) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Este evento no está disponible en tu comunidad." });
        }
      }
      try {
        const result = await startCheckout({
          eventId: input.eventId,
          userId: ctx.user.id,
          items: input.items,
          buyerName: ctx.user.name ?? null,
          buyerEmail: ctx.user.email ?? null,
          idempotencyKey: input.idempotencyKey,
        });
        return result;
      } catch (err) {
        mapCheckoutError(err);
      }
    }),

  initiatePayment: protectedProcedure
    .input(z.object({
      orderId: z.number().int().positive(),
      // Pre-16.2 ("Online Event Checkout — SegoTokens + Money"): parcial o
      // total — el servidor siempre recalcula desde la política de canje
      // vigente y clama al máximo elegible, nunca confía en que el cliente
      // "sabe" cuánto cubre (ver checkoutService.ts::initiatePayment).
      tokensToApply: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const owned = await getMyOrderById(input.orderId, ctx.user.id);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido no encontrado" });
      try {
        return await initiatePayment(input.orderId, input.tokensToApply);
      } catch (err) {
        mapCheckoutError(err);
      }
    }),

  cancelMyOrder: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await getMyOrderById(input.orderId, ctx.user.id);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido no encontrado" });
      try {
        return await cancelOrder(input.orderId, ctx.user.id);
      } catch (err) {
        mapCheckoutError(err);
      }
    }),

  myOrders: protectedProcedure.query(async ({ ctx }) => {
    await expireStaleHoldsForUser(ctx.user.id);
    return listMyOrders(ctx.user.id);
  }),

  myOrderById: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const result = await getMyOrderById(input.orderId, ctx.user.id);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido no encontrado" });
      return result;
    }),

  myTickets: protectedProcedure.query(async ({ ctx }) => {
    const rows = await listMyTickets(ctx.user.id);
    return rows.map(toTicketDto);
  }),

  myTicketById: protectedProcedure
    .input(z.object({ ticketId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await getMyTicketById(input.ticketId, ctx.user.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Entrada no encontrada" });
      return toTicketDto(row);
    }),

  myIdentityToken: protectedProcedure.query(({ ctx }) => getOrCreateMyIdentityToken(ctx.user.id)),

  rotateMyIdentityToken: protectedProcedure.mutation(({ ctx }) => rotateMyIdentityToken(ctx.user.id)),
});
