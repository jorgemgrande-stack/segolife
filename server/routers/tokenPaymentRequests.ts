/**
 * tokenPaymentRequests.ts — SEGOLIFE PRE-16.1: PRESENTIAL SEGOTOKENS
 * PAYMENTS. Lado del STUDENT — ver server/routers/commerce.ts para el lado
 * del operador (posRequestTokenPayment/doorRequestTokenPayment/
 * getTokenPaymentRequestStatus/cancelTokenPaymentRequest).
 *
 * Ningún procedimiento aquí toca el ledger directamente — todo pasa por
 * tokenPaymentRequestService.ts, que a su vez reutiliza tokenSpendService.ts.
 * `confirm`/`reject` solo aceptan un requestId — la propiedad (¿esta
 * solicitud es de ESTE Student?) se comprueba SIEMPRE server-side contra
 * `reservation.userId`, nunca contra un campo que el cliente pudiera enviar.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  listMyOpenTokenPaymentRequests, confirmTokenPaymentRequest, rejectTokenPaymentRequest,
  getTokenPaymentRequestView, TokenPaymentRequestError,
} from "../segolife/tokens/tokenPaymentRequestService";

function mapError(err: unknown): never {
  if (err instanceof TokenPaymentRequestError) {
    const codeMap: Record<string, "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST" | "FORBIDDEN"> = {
      NOT_FOUND: "NOT_FOUND", INVALID_STATE: "CONFLICT", EXPIRED: "CONFLICT",
      NOT_OWNER: "FORBIDDEN", CONTEXT_MISMATCH: "BAD_REQUEST", NO_POLICY: "BAD_REQUEST", INVALID_AMOUNT: "BAD_REQUEST",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

export const tokenPaymentRequestsRouter = router({
  /** Solicitudes pendientes de ESTE Student — puede haber más de una a la vez (spec §11). Banner/tarjeta del Student App las lee de aquí (polling ligero, nunca websocket — spec Fase 7 punto 17, mismo criterio que la campana de notificaciones). */
  myPending: protectedProcedure.query(async ({ ctx }) => {
    return listMyOpenTokenPaymentRequests(ctx.user.id);
  }),

  /** Detalle de una solicitud concreta — para la pantalla de confirmación si el Student llega vía deep-link. Verifica propiedad server-side. */
  getById: protectedProcedure
    .input(z.object({ requestId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const view = await getTokenPaymentRequestView(input.requestId).catch(err => mapError(err));
      if (view.reservation.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Esta solicitud no pertenece a este Student" });
      return view;
    }),

  confirm: protectedProcedure
    .input(z.object({ requestId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await confirmTokenPaymentRequest(input.requestId, ctx.user.id);
      } catch (err) {
        mapError(err);
      }
    }),

  reject: protectedProcedure
    .input(z.object({ requestId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await rejectTokenPaymentRequest(input.requestId, ctx.user.id);
      } catch (err) {
        mapError(err);
      }
    }),
});
