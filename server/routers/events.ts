import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, permissionProcedure } from "../_core/trpc";
import { getCommunityAccess, resolveCommunityFilter, type CommunityAccess } from "../_core/communityAccess";
import {
  listEvents,
  getEventById,
  getEventBySlug,
  createEvent,
  updateEvent,
  setEventActive,
  setEventFeatured,
  setEventCommunities,
  listActiveEvents,
  listFeaturedEvents,
  listEventsByVenue,
  reorderFeaturedEvents,
} from "../db/eventsDb";
import { computePurchaseAction } from "../segolife/ticketing/purchaseAction";
import { requireVenueAccess } from "../segolife/benefits/venueStaffAccess";
import { getVenueEventsView, getEventLiveStats } from "../segolife/venues/venueAppService";

// Lectura: ver el listado/fichas de eventos.
const eventsViewProcedure = permissionProcedure("events.view", ["admin"]);
// Escritura administrativa: crear, editar, activar/desactivar, destacar, comunidades.
const eventsManageProcedure = permissionProcedure("events.manage", ["admin"]);

const communityFilterInput = z.union([z.number().int().positive(), z.literal("all")]).optional();

/** Lanza FORBIDDEN si el alcance del admin no cubre ninguna comunidad del evento. */
function assertEventAccessible(access: CommunityAccess, eventCommunityIds: number[]) {
  if (access === "all") return;
  const hasOverlap = eventCommunityIds.some(id => access.includes(id));
  if (!hasOverlap) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este evento" });
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

const eventInputSchema = z.object({
  name: z.string().min(1).max(256),
  slug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  description: z.string().max(4000).nullish(),
  venueId: z.number().int().positive().nullish(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullish(),
  capacity: z.number().int().positive().nullish(),
  imageUrl: z.string().max(512).nullish(),
});

export const eventsRouter = router({
  // ─── ADMIN — lectura ────────────────────────────────────────────────────────

  list: eventsViewProcedure
    .input(
      z.object({
        communityId: communityFilterInput,
        search: z.string().max(256).optional(),
        venueId: z.number().int().positive().optional(),
        status: z.enum(["active", "inactive"]).optional(),
        isFeatured: z.boolean().optional(),
        orderBy: z.enum(["startsAt", "homeSortOrder"]).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      const communityIds = resolveCommunityFilter(access, input.communityId);
      return listEvents({ ...input, communityIds });
    }),

  getById: eventsViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const detail = await getEventById(input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Evento no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertEventAccessible(access, detail.communities.map(c => c.id));
      return detail;
    }),

  // ─── ADMIN — escritura ──────────────────────────────────────────────────────

  create: eventsManageProcedure
    .input(eventInputSchema.extend({ communityIds: z.array(z.number().int().positive()).default([]) }))
    .mutation(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertCommunityIdsWithinAccess(access, input.communityIds);
      const { communityIds, ...fields } = input;
      const event = await createEvent(fields, communityIds);
      return { success: true, event };
    }),

  update: eventsManageProcedure
    .input(z.object({ id: z.number().int().positive() }).merge(eventInputSchema.partial()))
    .mutation(async ({ input, ctx }) => {
      const detail = await getEventById(input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Evento no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertEventAccessible(access, detail.communities.map(c => c.id));
      const { id, ...fields } = input;
      const updated = await updateEvent(id, fields);
      return { success: true, event: updated };
    }),

  setActive: eventsManageProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getEventById(input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Evento no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertEventAccessible(access, detail.communities.map(c => c.id));
      const updated = await setEventActive(input.id, input.active);
      return { success: true, event: updated };
    }),

  setFeatured: eventsManageProcedure
    .input(z.object({ id: z.number().int().positive(), featured: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getEventById(input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Evento no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertEventAccessible(access, detail.communities.map(c => c.id));
      const updated = await setEventFeatured(input.id, input.featured);
      return { success: true, event: updated };
    }),

  setCommunities: eventsManageProcedure
    .input(z.object({ id: z.number().int().positive(), communityIds: z.array(z.number().int().positive()) }))
    .mutation(async ({ input, ctx }) => {
      const detail = await getEventById(input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Evento no encontrado" });
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      assertEventAccessible(access, detail.communities.map(c => c.id));
      assertCommunityIdsWithinAccess(access, input.communityIds);
      await setEventCommunities(input.id, input.communityIds);
      return { success: true };
    }),

  /** Orden de aparición de los eventos destacados en la Home — /admin/cms/inicio. */
  reorderFeatured: eventsManageProcedure
    .input(z.object({ orderedIds: z.array(z.number().int().positive()) }))
    .mutation(async ({ input }) => {
      await reorderFeaturedEvents(input.orderedIds);
      return { success: true };
    }),

  // ─── VENUE APP — operativo, NUNCA events.view/events.manage (spec §22) ──────

  /** Eventos de MI venue, agrupados operativamente (current/upcoming/recentlyCompleted) — nunca el catálogo global. */
  myVenueEvents: protectedProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireVenueAccess(ctx.user.id, ctx.user.role as string, input.venueId, "events.manage");
      return getVenueEventsView(input.venueId);
    }),

  /** Pantalla en vivo de UN evento (spec §14) — autoriza por el venueId REAL del evento, nunca confía en un venueId aparte enviado por el cliente. */
  myVenueEventLiveStats: protectedProcedure
    .input(z.object({ eventId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const stats = await getEventLiveStats(input.eventId);
      if (!stats || stats.event.venueId == null) throw new TRPCError({ code: "NOT_FOUND", message: "Evento no encontrado" });
      await requireVenueAccess(ctx.user.id, ctx.user.role as string, stats.event.venueId, "events.manage");
      return stats;
    }),

  // ─── PÚBLICO ────────────────────────────────────────────────────────────────
  // Sin autenticación. Solo eventos activos — nunca expone eventos inactivos
  // ni el listado admin completo.

  publicActive: publicProcedure
    .input(z.object({ communityId: z.number().int().positive().optional() }))
    .query(async ({ input }) => listActiveEvents(input.communityId)),

  publicFeatured: publicProcedure
    .input(z.object({ communityId: z.number().int().positive().optional() }))
    .query(async ({ input }) => listFeaturedEvents(input.communityId)),

  publicByVenue: publicProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ input }) => listEventsByVenue(input.venueId)),

  /**
   * `purchaseAction` (Fase 5, puntos 59-60) se calcula aquí en vez de exigir
   * al frontend público un segundo endpoint o preguntar por proveedor — el
   * frontend solo recibe { type: "external_url" | "native_checkout" |
   * "unavailable" }, nunca conoce Fourvenues/Weezevent.
   */
  publicGetBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const detail = await getEventBySlug(input.slug);
      if (!detail || detail.event.status !== "active") return null;
      const purchaseAction = await computePurchaseAction(detail.event.id, detail.event);
      return { ...detail, purchaseAction };
    }),
});
