/**
 * loyaltyShadow.ts — SEGOLIFE LOYALTY SHADOW MODE, admin observability.
 * Reutiliza el permiso existente `tokens.view` (spec §41: "usar permiso
 * existente... o crear uno específico solo si es realmente necesario") —
 * esta es una sub-vista de SegoTokens, no un módulo nuevo con su propio
 * permiso. Nunca accesible por Students (protectedProcedure no es
 * suficiente aquí — Shadow Admin exige permissionProcedure).
 */
import { z } from "zod";
import { router, permissionProcedure } from "../_core/trpc";
import {
  isShadowEnabled, getShadowKpis, getShadowFeed, getShadowAggregates, getShadowHealth,
} from "../segolife/tokens/loyaltyShadowService";

const shadowViewProcedure = permissionProcedure("tokens.view", ["admin"]);

const filtersSchema = z.object({
  communityIds: z.union([z.literal("all"), z.array(z.number().int().positive())]).default("all"),
  venueId: z.number().int().positive().optional(),
  from: z.string(),
  to: z.string(),
});

function parseFilters(input: z.infer<typeof filtersSchema>) {
  return { communityIds: input.communityIds, venueId: input.venueId, from: new Date(input.from), to: new Date(input.to) };
}

export const loyaltyShadowRouter = router({
  getStatus: shadowViewProcedure.query(async () => ({ enabled: await isShadowEnabled() })),

  getKpis: shadowViewProcedure.input(filtersSchema).query(({ input }) => getShadowKpis(parseFilters(input))),

  getFeed: shadowViewProcedure
    .input(filtersSchema.extend({ limit: z.number().int().min(1).max(100).default(30), offset: z.number().int().min(0).default(0) }))
    .query(({ input }) => getShadowFeed(parseFilters(input), input.limit, input.offset)),

  getAggregates: shadowViewProcedure.input(filtersSchema).query(({ input }) => getShadowAggregates(parseFilters(input))),

  getHealth: shadowViewProcedure.query(() => getShadowHealth()),
});
