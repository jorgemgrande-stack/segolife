import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import { listCommerceTransactionsByVenue, listCommerceTransactionItems, getCommerceTransactionVenueId } from "../segolife/commerce/commerceDb";
import { listPosProducts, recordNativeSale, resolveCartTotalCents, PosError } from "../segolife/commerce/nativeCommerceService";
import { refundCommerceTransaction, CommerceError } from "../segolife/commerce/commercePipeline";
import { lookupStudentByIdentityToken } from "../segolife/commerce/studentIdentityService";
import { getVenueStaffAccess } from "../segolife/benefits/venueStaffAccess";
import { quoteTokenSpend, TokenSpendError } from "../segolife/tokens/tokenSpendService";

const commerceViewProcedure = permissionProcedure("commerce.view", ["admin"]);
// Fase 8 — POS nativo de staff (mirroring benefits.redeem/attendance.redeem).
const commerceRecordProcedure = permissionProcedure("commerce.record", ["admin"]);
// SEGOLIFE — Venue Commerce, Consumption QR & SegoTokens: reembolso es acción admin, nunca de staff/POS (spec §46/§58 "Admin puede ver/cancelar").
const commerceManageProcedure = permissionProcedure("commerce.manage", ["admin"]);

function mapPosError(err: unknown): never {
  if (err instanceof PosError) {
    throw new TRPCError({ code: err.code === "PRODUCT_UNAVAILABLE" ? "CONFLICT" : "BAD_REQUEST", message: err.message, cause: err });
  }
  if (err instanceof TokenSpendError) {
    const codeMap: Record<string, "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST"> = {
      NOT_FOUND: "NOT_FOUND", ALREADY_CAPTURED: "CONFLICT", ALREADY_RELEASED: "CONFLICT",
      ALREADY_REVERSED: "CONFLICT", RESERVATION_EXPIRED: "CONFLICT",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

function mapCommerceError(err: unknown): never {
  if (err instanceof CommerceError) {
    const codeMap: Record<string, "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT"> = { NOT_FOUND: "NOT_FOUND", INVALID_STATE: "CONFLICT", REASON_REQUIRED: "BAD_REQUEST" };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

async function assertVenueAuthorized(userId: number, role: string, venueId: number): Promise<void> {
  const access = await getVenueStaffAccess(userId, role, undefined, "commerce.manage");
  if (access !== "all" && !access.includes(venueId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tienes autorización de POS para este venue" });
  }
}

export const commerceRouter = router({
  // SEGOLIFE — VENUE & PARTNER APP (spec §31, IDOR real encontrado en
  // auditoría): commerce.view lo tiene también venue_admin (Fase RBAC), pero
  // permissionProcedure es un check de permiso GLOBAL puro, sin idea de
  // "cuál venue" — sin este assertVenueAuthorized, cualquier Venue Admin
  // podía pedir listByVenue de OTRO venue con solo cambiar el venueId.
  listByVenue: commerceViewProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      return listCommerceTransactionsByVenue(input.venueId);
    }),

  listItems: commerceViewProcedure
    .input(z.object({ transactionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const venueId = await getCommerceTransactionVenueId(input.transactionId);
      if (venueId == null) throw new TRPCError({ code: "NOT_FOUND", message: "Transacción no encontrada" });
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, venueId);
      return listCommerceTransactionItems(input.transactionId);
    }),

  refundTransaction: commerceManageProcedure
    .input(z.object({ transactionId: z.number().int().positive(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await refundCommerceTransaction({ transactionId: input.transactionId, reason: input.reason, refundedByUserId: ctx.user.id });
      } catch (err) {
        mapCommerceError(err);
      }
    }),

  // ─── POS nativo (staff) — Fase 8 ─────────────────────────────────────────────
  myAuthorizedVenuesForPos: commerceRecordProcedure.query(async ({ ctx }) => {
    const access = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string, undefined, "commerce.manage");
    return access === "all" ? { all: true as const, venueIds: [] as number[] } : { all: false as const, venueIds: access };
  }),

  posProducts: commerceRecordProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      const products = await listPosProducts(input.venueId);
      return products.filter(p => p.isActive);
    }),

  posIdentifyStudent: commerceRecordProcedure
    .input(z.object({ token: z.string().min(16).max(256) }))
    .query(async ({ input }) => {
      const student = await lookupStudentByIdentityToken(input.token);
      if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Código no reconocido" });
      return student;
    }),

  /**
   * SEGOLIFE — SEGOTOKENS UNIVERSAL SPEND (Fase 7, spec §36 "checkout UX
   * contract"): previsualización de solo lectura antes de confirmar la
   * venta — recalcula el carrito desde el catálogo real (nunca confía en
   * un importe del cliente) y devuelve el mismo quote que posRecordSale
   * aplicaría, sin comprometer ningún token todavía.
   */
  posQuoteTokenSpend: commerceRecordProcedure
    .input(z.object({
      venueId: z.number().int().positive(),
      items: z.array(z.object({ venueProductId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1),
      identifiedUserId: z.number().int().positive(),
      requestedTokens: z.number().int().min(0),
    }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      const { totalCents } = await resolveCartTotalCents(input.venueId, input.items).catch(err => { mapPosError(err); });
      return quoteTokenSpend({
        userId: input.identifiedUserId, venueId: input.venueId,
        grossAmountCents: totalCents, requestedTokens: input.requestedTokens,
      });
    }),

  posRecordSale: commerceRecordProcedure
    .input(z.object({
      venueId: z.number().int().positive(),
      items: z.array(z.object({ venueProductId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1),
      identifiedUserId: z.number().int().positive().nullish(),
      idempotencyKey: z.string().min(8).max(191),
      /** SegoTokens Universal Spend (Fase 7) — ambos opcionales, pero si se aplica alguno, ambos son obligatorios (validado abajo). */
      tokensToApply: z.number().int().positive().optional(),
      /**
       * Mismo QR de identidad ya escaneado para posIdentifyStudent — se
       * vuelve a verificar AQUÍ, en el momento de gastar SegoTokens (spec
       * §33/§34: "identidad no autoriza gasto ilimitado por sí sola"). El
       * staff no puede aplicar tokens de un Student solo porque conoce su
       * userId — tiene que haber un escaneo fresco de SU QR en esta misma
       * operación, y ese escaneo debe resolver EXACTAMENTE al mismo
       * Student ya identificado para el resto de la venta.
       */
      identityToken: z.string().min(16).max(256).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);

      let spendAuthorizedUserId: number | null = null;
      if (input.tokensToApply != null && input.tokensToApply > 0) {
        if (!input.identityToken) throw new TRPCError({ code: "BAD_REQUEST", message: "Escanea el QR del Student para aplicar SegoTokens" });
        const student = await lookupStudentByIdentityToken(input.identityToken);
        if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Código no reconocido" });
        if (input.identifiedUserId != null && student.userId !== input.identifiedUserId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "El QR escaneado no corresponde al Student identificado para esta venta" });
        }
        spendAuthorizedUserId = student.userId;
      }

      try {
        return await recordNativeSale({
          venueId: input.venueId,
          items: input.items,
          identifiedUserId: spendAuthorizedUserId ?? input.identifiedUserId ?? null,
          staffUserId: ctx.user.id,
          idempotencyKey: input.idempotencyKey,
          tokensToApply: input.tokensToApply ?? null,
        });
      } catch (err) {
        mapPosError(err);
      }
    }),
});
