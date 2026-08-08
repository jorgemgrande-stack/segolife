import { router, protectedProcedure } from "../_core/trpc";
import { getUserCommunities } from "../db/communitiesDb";
import { getHomeSummary } from "../segolife/home/homeSummaryService";

export const homeRouter = router({
  /** Agregado de solo lectura para la Home del estudiante (Fase 6) — ver homeSummaryService.ts. */
  getSummary: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await getUserCommunities(ctx.user.id);
    const communityId = memberships.length > 0 ? memberships[0].communityId : undefined;
    return getHomeSummary(ctx.user.id, communityId);
  }),
});
