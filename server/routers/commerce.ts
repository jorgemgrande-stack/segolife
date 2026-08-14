import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import { listCommerceTransactionsByVenue, listCommerceTransactionItems } from "../segolife/commerce/commerceDb";
import { listPosProducts, recordNativeSale, PosError } from "../segolife/commerce/nativeCommerceService";
import { refundCommerceTransaction, CommerceError } from "../segolife/commerce/commercePipeline";
import { lookupStudentByIdentityToken } from "../segolife/commerce/studentIdentityService";
import { getVenueStaffAccess } from "../segolife/benefits/venueStaffAccess";

const commerceViewProcedure = permissionProcedure("commerce.view", ["admin"]);
// Fase 8 — POS nativo de staff (mirroring benefits.redeem/attendance.redeem).
const commerceRecordProcedure = permissionProcedure("commerce.record", ["admin"]);
// SEGOLIFE — Venue Commerce, Consumption QR & SegoTokens: reembolso es acción admin, nunca de staff/POS (spec §46/§58 "Admin puede ver/cancelar").
const commerceManageProcedure = permissionProcedure("commerce.manage", ["admin"]);

function mapPosError(err: unknown): never {
  if (err instanceof PosError) {
    throw new TRPCError({ code: err.code === "PRODUCT_UNAVAILABLE" ? "CONFLICT" : "BAD_REQUEST", message: err.message, cause: err });
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
  listByVenue: commerceViewProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(({ input }) => listCommerceTransactionsByVenue(input.venueId)),

  listItems: commerceViewProcedure
    .input(z.object({ transactionId: z.number().int().positive() }))
    .query(({ input }) => listCommerceTransactionItems(input.transactionId)),

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

  posRecordSale: commerceRecordProcedure
    .input(z.object({
      venueId: z.number().int().positive(),
      items: z.array(z.object({ venueProductId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1),
      identifiedUserId: z.number().int().positive().nullish(),
      idempotencyKey: z.string().min(8).max(191),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      try {
        return await recordNativeSale({
          venueId: input.venueId,
          items: input.items,
          identifiedUserId: input.identifiedUserId ?? null,
          staffUserId: ctx.user.id,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (err) {
        mapPosError(err);
      }
    }),
});
