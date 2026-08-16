import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getUserCommunities } from "../db/communitiesDb";
import { getHomeSummary } from "../segolife/home/homeSummaryService";

export const homeRouter = router({
  /**
   * Agregado de solo lectura para la Home del estudiante (Fase 6) — ver
   * homeSummaryService.ts.
   *
   * Fase 15 (spec §11/§13, "community attribution must survive the funnel",
   * "define deterministic behavior for... multiple communities"): auditoría
   * de esta fase confirmó que esto SIEMPRE resolvía la comunidad como
   * `memberships[0]` (sin ORDER BY, orden arbitrario de MySQL) — para un
   * Student con IE+UVA, la Home mostraba una comunidad distinta a la que
   * el resto de la página (venues, eventos) ya filtraba por la URL. Ahora
   * `communityId` es opcional: si el llamador lo manda Y el usuario es
   * REALMENTE miembro de esa comunidad (nunca se confía a ciegas en un
   * valor del cliente), se usa esa; si no, cae al comportamiento previo
   * (primera membresía) — nunca rompe a un llamador sin contexto de URL.
   */
  getSummary: protectedProcedure
    .input(z.object({ communityId: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const memberships = await getUserCommunities(ctx.user.id);
      const requested = input?.communityId;
      const isRealMembership = requested != null && memberships.some(m => m.communityId === requested);
      const communityId = isRealMembership ? requested : (memberships.length > 0 ? memberships[0].communityId : undefined);
      return getHomeSummary(ctx.user.id, communityId);
    }),
});
