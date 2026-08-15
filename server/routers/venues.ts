import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, permissionProcedure } from "../_core/trpc";
import { getCommunityAccess, resolveCommunityFilter, type CommunityAccess } from "../_core/communityAccess";
import { getVenueStaffAccess, requireVenueAccess } from "../segolife/benefits/venueStaffAccess";
import {
  listVenues,
  getVenueById,
  getVenueBySlug,
  createVenue,
  updateVenue,
  setVenueActive,
  setVenueFeatured,
  setVenueCommunities,
  listVenueCategories,
  createVenueCategory,
  listActiveVenues,
  listFeaturedVenues,
  reorderFeaturedVenues,
} from "../db/venuesDb";

// Lectura: ver el listado/fichas de venues.
const venuesViewProcedure = permissionProcedure("venues.view", ["admin"]);
// Escritura administrativa: crear, editar, activar/desactivar, categorías, comunidades.
const venuesManageProcedure = permissionProcedure("venues.manage", ["admin"]);

const communityFilterInput = z.union([z.number().int().positive(), z.literal("all")]).optional();

/** Lanza FORBIDDEN si el alcance del admin no cubre ninguna comunidad del venue. */
function assertVenueAccessible(access: CommunityAccess, venueCommunityIds: number[]) {
  if (access === "all") return;
  const hasOverlap = venueCommunityIds.some(id => access.includes(id));
  if (!hasOverlap) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este venue" });
  }
}

/** Lanza FORBIDDEN si alguna comunidad solicitada queda fuera del alcance del admin. */
function assertCommunityIdsWithinAccess(access: CommunityAccess, communityIds: number[]) {
  if (access === "all") return;
  const outOfScope = communityIds.some(id => !access.includes(id));
  if (outOfScope) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No puedes vincular datos a una comunidad fuera de tu alcance" });
  }
}

const venueInputSchema = z.object({
  name: z.string().min(1).max(256),
  slug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  tagline: z.string().max(256).nullish(),
  description: z.string().max(4000).nullish(),
  categoryId: z.number().int().positive().nullish(),
  address: z.string().max(256).nullish(),
  city: z.string().max(128).optional(),
  phone: z.string().max(32).nullish(),
  email: z.string().email().max(256).nullish(),
  website: z.string().max(256).nullish(),
  instagramUrl: z.string().max(256).nullish(),
  imageUrl: z.string().max(512).nullish(),
  coverImageUrl: z.string().max(512).nullish(),
});

export const venuesRouter = router({
  // ─── ADMIN — lectura ────────────────────────────────────────────────────────

  list: venuesViewProcedure
    .input(
      z.object({
        communityId: communityFilterInput,
        search: z.string().max(256).optional(),
        categoryId: z.number().int().positive().optional(),
        status: z.enum(["active", "inactive"]).optional(),
        isFeatured: z.boolean().optional(),
        orderBy: z.enum(["createdAt", "homeSortOrder"]).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      const communityIds = resolveCommunityFilter(access, input.communityId);
      return listVenues({ ...input, communityIds });
    }),

  getById: venuesViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const detail = await getVenueById(input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Venue no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertVenueAccessible(access, detail.communities.map(c => c.id));
      return detail;
    }),

  listCategories: venuesViewProcedure.query(async () => listVenueCategories()),

  /**
   * SEGOLIFE — RBAC CONSOLIDATION (spec §5/§17/§19): "ver mi(s) local(es)"
   * para un Administrador de Local. Deliberadamente NO usa venuesViewProcedure
   * (esa es la vista GLOBAL de catálogo, permiso venues.view que un Venue
   * Admin nunca tiene) — este es un endpoint de propiedad, como
   * benefits.myAuthorizedVenues: cada uno ve exactamente sus venue_staff
   * activos, nunca "todos" por defecto. Un admin global también recibe algo
   * coherente (permissionKey inexistente para él como venue_admin real, pero
   * checkRbacOrLegacy ya lo resuelve como global vía el fallback ["admin"]).
   */
  myAssignedVenues: protectedProcedure.query(async ({ ctx }) => {
    const access = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string, undefined, "venues.manage");
    if (access === "all") return [];
    const details = await Promise.all(access.map(id => getVenueById(id)));
    return details.filter((v): v is NonNullable<typeof v> => v != null);
  }),

  /** SEGOLIFE — VENUE & PARTNER APP (spec §21): detalle de UN venue, operativo (no de catálogo). Mismo patrón que getMyVenueStats — requireVenueAccess explícito, nunca venuesViewProcedure (esa es la gestión global). */
  getMyVenueById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireVenueAccess(ctx.user.id, ctx.user.role as string, input.id, "venues.manage");
      const detail = await getVenueById(input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Venue no encontrado" });
      return detail;
    }),

  // ─── ADMIN — escritura ──────────────────────────────────────────────────────

  create: venuesManageProcedure
    .input(venueInputSchema.extend({ communityIds: z.array(z.number().int().positive()).default([]) }))
    .mutation(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertCommunityIdsWithinAccess(access, input.communityIds);
      const { communityIds, ...fields } = input;
      const venue = await createVenue(fields, communityIds);
      return { success: true, venue };
    }),

  update: venuesManageProcedure
    .input(z.object({ id: z.number().int().positive() }).merge(venueInputSchema.partial()))
    .mutation(async ({ input, ctx }) => {
      const detail = await getVenueById(input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Venue no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertVenueAccessible(access, detail.communities.map(c => c.id));
      const { id, ...fields } = input;
      const updated = await updateVenue(id, fields);
      return { success: true, venue: updated };
    }),

  setActive: venuesManageProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getVenueById(input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Venue no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertVenueAccessible(access, detail.communities.map(c => c.id));
      const updated = await setVenueActive(input.id, input.active);
      return { success: true, venue: updated };
    }),

  setFeatured: venuesManageProcedure
    .input(z.object({ id: z.number().int().positive(), featured: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getVenueById(input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Venue no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertVenueAccessible(access, detail.communities.map(c => c.id));
      const updated = await setVenueFeatured(input.id, input.featured);
      return { success: true, venue: updated };
    }),

  setCommunities: venuesManageProcedure
    .input(z.object({ id: z.number().int().positive(), communityIds: z.array(z.number().int().positive()) }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getVenueById(input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Venue no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertVenueAccessible(access, detail.communities.map(c => c.id));
      assertCommunityIdsWithinAccess(access, input.communityIds);
      await setVenueCommunities(input.id, input.communityIds);
      return { success: true };
    }),

  /** Orden de aparición de los venues destacados en la Home — /admin/cms/inicio. */
  reorderFeatured: venuesManageProcedure
    .input(z.object({ orderedIds: z.array(z.number().int().positive()) }))
    .mutation(async ({ input }) => {
      await reorderFeaturedVenues(input.orderedIds);
      return { success: true };
    }),

  createCategory: venuesManageProcedure
    .input(z.object({ name: z.string().min(1).max(64), slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/) }))
    .mutation(async ({ input }) => {
      const category = await createVenueCategory(input.name, input.slug);
      return { success: true, category };
    }),

  // ─── PÚBLICO ────────────────────────────────────────────────────────────────
  // Sin autenticación. Solo venues activos — nunca expone venues inactivos ni
  // el listado admin completo.

  publicActive: publicProcedure
    .input(z.object({ communityId: z.number().int().positive().optional() }))
    .query(async ({ input }) => listActiveVenues(input.communityId)),

  publicFeatured: publicProcedure
    .input(z.object({ communityId: z.number().int().positive().optional() }))
    .query(async ({ input }) => listFeaturedVenues(input.communityId)),

  publicGetBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const detail = await getVenueBySlug(input.slug);
      if (!detail || detail.venue.status !== "active") return null;
      return detail;
    }),
});
