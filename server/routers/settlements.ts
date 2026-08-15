/**
 * settlements.ts — SEGOLIFE FASE 10 (spec §55-69). Acuerdos comerciales y
 * liquidaciones — GLOBAL_ADMIN exclusivo (spec §69, "Venue Admin may later
 * receive read-only view if desired" — no implementado en esta fase, fuera
 * de alcance de venue_admin por completo, ver venueAdminPolicy.ts).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import { upsertAgreement, resolveAgreement, listAgreements, CommercialAgreementError } from "../segolife/settlements/commercialAgreementService";
import {
  calculateSettlement, approveSettlement, markSettlementPaid,
  listSettlements, getSettlementDetail, SettlementError,
} from "../segolife/settlements/settlementService";

const settlementsViewProcedure = permissionProcedure("settlements.view", ["admin"]);
const settlementsManageProcedure = permissionProcedure("settlements.manage", ["admin"]);

function mapSettlementError(err: unknown): never {
  if (err instanceof CommercialAgreementError || err instanceof SettlementError) {
    const codeMap: Record<string, "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT"> = {
      NOT_FOUND: "NOT_FOUND", INVALID_INPUT: "BAD_REQUEST", INVALID_PERIOD: "BAD_REQUEST",
      ALREADY_FINALIZED: "CONFLICT", INVALID_STATE: "CONFLICT",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

// Nombre "venueSettlementsRouter" (no "settlementsRouter"): ese identificador
// ya existe como export legacy Náyade (server/routers/suppliers.ts,
// liquidaciones de proveedores turísticos) — colisión real de identificador
// Y de namespace tRPC ("settlements" ya está montado en server/routers.ts).
export const venueSettlementsRouter = router({
  listAgreements: settlementsViewProcedure
    .input(z.object({ venueId: z.number().int().positive().optional() }))
    .query(({ input }) => listAgreements(input.venueId)),

  resolveAgreement: settlementsViewProcedure
    .input(z.object({ venueId: z.number().int().positive(), eventId: z.number().int().positive().optional().nullable() }))
    .query(({ input }) => resolveAgreement(input.venueId, input.eventId)),

  upsertAgreement: settlementsManageProcedure
    .input(z.object({
      id: z.number().int().positive().optional(),
      venueId: z.number().int().positive(),
      eventId: z.number().int().positive().optional().nullable(),
      commissionModel: z.enum(["platform_commission_percent", "fixed_fee", "venue_net", "no_commission"]),
      commissionBasisPoints: z.number().int().min(0).max(10000).optional(),
      fixedFeeCents: z.number().int().min(0).optional(),
      tokenFundingModel: z.enum(["venue_funded", "platform_funded", "shared", "no_settlement_value"]).optional(),
      benefitFundingModel: z.enum(["venue_funded", "platform_funded", "shared", "no_settlement_value"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try { return await upsertAgreement({ ...input, createdByUserId: ctx.user.id }); } catch (err) { mapSettlementError(err); }
    }),

  calculate: settlementsManageProcedure
    .input(z.object({ venueId: z.number().int().positive(), eventId: z.number().int().positive().optional().nullable(), periodStart: z.date(), periodEnd: z.date() }))
    .mutation(async ({ ctx, input }) => {
      try { return await calculateSettlement({ ...input, createdByUserId: ctx.user.id }); } catch (err) { mapSettlementError(err); }
    }),

  approve: settlementsManageProcedure
    .input(z.object({ settlementId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try { return await approveSettlement(input.settlementId, ctx.user.id); } catch (err) { mapSettlementError(err); }
    }),

  markPaid: settlementsManageProcedure
    .input(z.object({ settlementId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try { return await markSettlementPaid(input.settlementId, ctx.user.id); } catch (err) { mapSettlementError(err); }
    }),

  list: settlementsViewProcedure
    .input(z.object({ venueId: z.number().int().positive().optional() }))
    .query(({ input }) => listSettlements(input.venueId)),

  detail: settlementsViewProcedure
    .input(z.object({ settlementId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const detail = await getSettlementDetail(input.settlementId);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Liquidación no encontrada" });
      return detail;
    }),
});
