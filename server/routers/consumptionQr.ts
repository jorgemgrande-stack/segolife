import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, permissionProcedure } from "../_core/trpc";
import { getCommunityAccess } from "../_core/communityAccess";
import { getUserCommunities } from "../db/communitiesDb";
import {
  issueConsumptionQr,
  issueQrBatch,
  redeemConsumptionQr,
  cancelConsumptionQr,
  getConsumptionQrStatus,
  reverseConsumptionQrReward,
  QrError,
} from "../segolife/qr/consumptionQrService";
import {
  listConsumptionQrCodes,
  getConsumptionQrById,
  listQrBatches,
  getQrBatchById,
  listQrCodesByBatch,
  listRedemptionAttempts,
  listQrRedemptionsByUser,
} from "../db/consumptionQrDb";
import { TokenEngineError } from "../segolife/tokens/tokenLedgerService";

const qrViewProcedure = permissionProcedure("qr.view", ["admin"]);
const qrIssueProcedure = permissionProcedure("qr.issue", ["admin"]);
const qrManageProcedure = permissionProcedure("qr.manage", ["admin"]);
const qrCancelProcedure = permissionProcedure("qr.cancel", ["admin"]);

const communityFilterInput = z.union([z.number().int().positive(), z.literal("all")]).optional();

function mapQrOrEngineError(err: unknown): never {
  if (err instanceof QrError) {
    const codeMap: Record<string, "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN"> = {
      NOT_FOUND: "NOT_FOUND",
      ALREADY_REDEEMED: "CONFLICT",
      EXPIRED: "BAD_REQUEST",
      CANCELLED: "BAD_REQUEST",
      VENUE_INACTIVE: "BAD_REQUEST",
      PRODUCT_INACTIVE: "BAD_REQUEST",
      COMMUNITY_NOT_AUTHORIZED: "FORBIDDEN",
      REASON_REQUIRED: "BAD_REQUEST",
      CANNOT_CANCEL: "CONFLICT",
      NOT_REDEEMED: "CONFLICT",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  if (err instanceof TokenEngineError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

export const consumptionQrRouter = router({
  // ─── ADMIN — emisión ────────────────────────────────────────────────────────

  issue: qrIssueProcedure
    .input(z.object({
      venueId: z.number().int().positive(),
      productId: z.number().int().positive().nullish(),
      amountCents: z.number().int().positive().nullish(),
      expiresAt: z.coerce.date().nullish(),
      sourceReference: z.string().max(128).nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      const issued = await issueConsumptionQr({ ...input, issuedByUserId: ctx.user.id });
      return { success: true, qr: issued.qr, publicToken: issued.publicToken };
    }),

  issueBatch: qrIssueProcedure
    .input(z.object({
      venueId: z.number().int().positive(),
      productId: z.number().int().positive().nullish(),
      amountCents: z.number().int().positive().nullish(),
      quantity: z.number().int().min(1).max(500),
      expiresAt: z.coerce.date().nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await issueQrBatch({ ...input, createdByUserId: ctx.user.id });
      return { success: true, batch: result.batch, qrs: result.qrs };
    }),

  // ─── ADMIN — listados ───────────────────────────────────────────────────────

  list: qrViewProcedure
    .input(z.object({
      communityId: communityFilterInput,
      venueId: z.number().int().positive().optional(),
      productId: z.number().int().positive().optional(),
      status: z.enum(["issued", "redeemed", "expired", "cancelled"]).optional(),
      redeemedByUserId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      const communityIds = access === "all"
        ? (input.communityId && input.communityId !== "all" ? [input.communityId] : "all" as const)
        : access;
      return listConsumptionQrCodes({ ...input, communityIds });
    }),

  getById: qrViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const qr = await getConsumptionQrById(input.id);
      if (!qr) throw new TRPCError({ code: "NOT_FOUND", message: "QR no encontrado" });
      return qr;
    }),

  listBatches: qrViewProcedure
    .input(z.object({ communityId: communityFilterInput, venueId: z.number().int().positive().optional() }))
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      const communityIds = access === "all"
        ? (input.communityId && input.communityId !== "all" ? [input.communityId] : "all" as const)
        : access;
      return listQrBatches({ communityIds, venueId: input.venueId });
    }),

  getBatchDetail: qrViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const batch = await getQrBatchById(input.id);
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Batch no encontrado" });
      const qrs = await listQrCodesByBatch(input.id);
      return { batch, qrs };
    }),

  listAttempts: qrViewProcedure
    .input(z.object({
      qrId: z.number().int().positive().optional(),
      result: z.string().max(64).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => listRedemptionAttempts(input)),

  // ─── ADMIN — cancelación ────────────────────────────────────────────────────

  cancel: qrCancelProcedure
    .input(z.object({ qrId: z.number().int().positive(), reason: z.string().min(1).max(256) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const qr = await cancelConsumptionQr({ qrId: input.qrId, reason: input.reason, cancelledByUserId: ctx.user.id });
        return { success: true, qr };
      } catch (err) {
        mapQrOrEngineError(err);
      }
    }),

  getStatus: qrManageProcedure
    .input(z.object({ qrId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const qr = await getConsumptionQrStatus(input.qrId);
      if (!qr) throw new TRPCError({ code: "NOT_FOUND", message: "QR no encontrado" });
      return qr;
    }),

  reverseReward: qrManageProcedure
    .input(z.object({ qrId: z.number().int().positive(), reason: z.string().min(1).max(256) }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await reverseConsumptionQrReward({ qrId: input.qrId, reason: input.reason, reversedByUserId: ctx.user.id });
      } catch (err) {
        mapQrOrEngineError(err);
      }
    }),

  // ─── ESTUDIANTE — canje ─────────────────────────────────────────────────────
  // El único dato de negocio que confía en el cliente es el TOKEN escaneado —
  // todo lo demás (venue, producto, importe, comunidad, horario, reglas) lo
  // resuelve el backend. communityId se deriva de la membresía REAL del
  // estudiante (getUserCommunities), nunca de un valor enviado por el cliente.

  redeem: protectedProcedure
    .input(z.object({ token: z.string().min(16).max(256) }))
    .mutation(async ({ input, ctx }) => {
      const memberships = await getUserCommunities(ctx.user.id);
      const communityId = memberships.length > 0 ? memberships[0].communityId : undefined;
      const ipAddress = ctx.req?.ip ?? null;
      const userAgent = (ctx.req?.headers?.["user-agent"] as string | undefined) ?? null;

      try {
        const result = await redeemConsumptionQr({
          token: input.token,
          userId: ctx.user.id,
          communityId,
          ipAddress,
          userAgent,
        });
        return { success: true, ...result };
      } catch (err) {
        mapQrOrEngineError(err);
      }
    }),

  myRedemptions: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input, ctx }) => listQrRedemptionsByUser(ctx.user.id, input.limit)),
});
