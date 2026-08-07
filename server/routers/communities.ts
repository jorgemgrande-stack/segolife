import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import {
  listCommunities,
  getCommunityBySlug,
  listUniversities,
  getUserCommunities,
} from "../db/communitiesDb";

export const communitiesRouter = router({
  /** Lista todas las comunidades — usado por el selector admin (Todas/IE/UVA/...). */
  list: publicProcedure.query(async () => {
    return listCommunities();
  }),

  /**
   * Resuelve una comunidad por slug. Usado por CommunityContext para /ie, /uva
   * y cualquier futuro campus — el slug llega desde la ruta, nunca hardcodeado
   * aquí. Devuelve null si no existe (no lanza error): una URL con un slug
   * desconocido simplemente no resuelve comunidad.
   */
  getBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      return getCommunityBySlug(input.slug);
    }),

  /** Catálogo de universidades (referencia). */
  listUniversities: publicProcedure.query(async () => {
    return listUniversities();
  }),

  /** Comunidades a las que pertenece el usuario autenticado actual. */
  myMemberships: protectedProcedure.query(async ({ ctx }) => {
    return getUserCommunities(ctx.user.id);
  }),
});
