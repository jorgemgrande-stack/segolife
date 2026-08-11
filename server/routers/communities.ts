import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import {
  listCommunities,
  getCommunityBySlug,
  listUniversities,
  getUserCommunitiesWithDetails,
  getCommunityUniversities,
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

  /**
   * Universidades que sirve una comunidad concreta — usado por /register
   * (spec: pedir la universidad del estudiante para ubicarlo en el sistema).
   * Público: se consulta antes de tener sesión, durante el registro.
   */
  getCommunityUniversities: publicProcedure
    .input(z.object({ communityId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getCommunityUniversities(input.communityId);
    }),

  /**
   * Comunidades a las que pertenece el usuario autenticado actual, con datos
   * reales (slug/name/status) — usado por /login y /register para saber a
   * qué comunidad redirigir a un estudiante ya autenticado (bug real: antes
   * un estudiante que revisitaba /register o iniciaba sesión en /login
   * acababa en "/" o "/admin" en vez de en su propia comunidad).
   */
  myMemberships: protectedProcedure.query(async ({ ctx }) => {
    return getUserCommunitiesWithDetails(ctx.user.id);
  }),
});
