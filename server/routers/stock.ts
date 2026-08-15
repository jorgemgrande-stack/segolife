/**
 * stock.ts — SEGOLIFE FASE 10 (spec §27-43). Stock físico de venue_products.
 * stock.view/stock.adjust son operativa de venue (venue_admin/staff, alcance
 * por venue_staff vía getVenueStaffAccess) — stock.manage (qué producto
 * lleva stock, política de negativo) es GLOBAL_ADMIN exclusivo.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import { getVenueStaffAccess } from "../segolife/benefits/venueStaffAccess";
import {
  listStockProducts, listLowStock, listMovements, getBalance,
  recordWaste, recordAdjustment, recordOpening, setStockConfig, StockError,
} from "../segolife/stock/stockService";

const stockViewProcedure = permissionProcedure("stock.view", ["admin"]);
const stockAdjustProcedure = permissionProcedure("stock.adjust", ["admin"]);
const stockManageProcedure = permissionProcedure("stock.manage", ["admin"]);

function mapStockError(err: unknown): never {
  if (err instanceof StockError) {
    const codeMap: Record<string, "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN"> = {
      PRODUCT_NOT_FOUND: "NOT_FOUND", WRONG_VENUE: "FORBIDDEN", NOT_STOCK_TRACKED: "BAD_REQUEST",
      INSUFFICIENT_STOCK: "CONFLICT", REASON_REQUIRED: "BAD_REQUEST", INVALID_QUANTITY: "BAD_REQUEST",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

// Mismo patrón exacto que commerce.ts::assertVenueAuthorized — permissionKey
// "stock.manage" es el check de "¿es admin global?" (getVenueStaffAccess),
// nunca el propio verbo venue-scoped que se está autorizando.
async function assertVenueAuthorized(userId: number, role: string, venueId: number): Promise<void> {
  const access = await getVenueStaffAccess(userId, role, undefined, "stock.manage");
  if (access !== "all" && !access.includes(venueId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tienes autorización de stock para este venue" });
  }
}

export const stockRouter = router({
  listProducts: stockViewProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      return listStockProducts(input.venueId);
    }),

  lowStock: stockViewProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      return listLowStock(input.venueId);
    }),

  movements: stockViewProcedure
    .input(z.object({ venueId: z.number().int().positive(), venueProductId: z.number().int().positive(), limit: z.number().int().min(1).max(500).optional() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      return listMovements(input.venueProductId, input.limit);
    }),

  balance: stockViewProcedure
    .input(z.object({ venueId: z.number().int().positive(), venueProductId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      return getBalance(input.venueProductId);
    }),

  recordWaste: stockAdjustProcedure
    .input(z.object({ venueId: z.number().int().positive(), venueProductId: z.number().int().positive(), quantity: z.number().int().positive(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      try { return await recordWaste({ ...input, actorUserId: ctx.user.id }); } catch (err) { mapStockError(err); }
    }),

  recordAdjustment: stockAdjustProcedure
    .input(z.object({ venueId: z.number().int().positive(), venueProductId: z.number().int().positive(), delta: z.number().int().refine(v => v !== 0, "El ajuste no puede ser 0"), reason: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      try { return await recordAdjustment({ ...input, actorUserId: ctx.user.id }); } catch (err) { mapStockError(err); }
    }),

  recordOpening: stockAdjustProcedure
    .input(z.object({ venueId: z.number().int().positive(), venueProductId: z.number().int().positive(), quantity: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      try { return await recordOpening({ ...input, actorUserId: ctx.user.id }); } catch (err) { mapStockError(err); }
    }),

  setConfig: stockManageProcedure
    .input(z.object({
      venueProductId: z.number().int().positive(),
      stockTracked: z.boolean().optional(),
      lowStockThreshold: z.number().int().min(0).optional().nullable(),
      allowNegativeStock: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const { venueProductId, ...config } = input;
      return setStockConfig(venueProductId, config);
    }),
});
