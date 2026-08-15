/**
 * venueApp.ts — SEGOLIFE VENUE & PARTNER APP (spec §4/§5/§8/§30). Router
 * dedicado a la operación diaria de UN venue — deliberadamente separado de
 * venues.ts/events.ts (catálogo global) para no mezclar lectura operativa
 * con gestión administrativa en el mismo namespace.
 *
 * `studentCard` NUNCA acepta un userId en crudo desde el cliente — recibe
 * el MISMO token QR escaneado y lo re-resuelve server-side vía
 * lookupStudentByIdentityToken, igual que cualquier otra validación de
 * puerta. Aceptar un userId directo abriría una forma de "búsqueda libre de
 * Students por id" para cualquier Venue Admin, justo lo que spec §30
 * prohíbe explícitamente ("never allow broad Student database browsing").
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getVenueStaffAccess, requireVenueAccess } from "../segolife/benefits/venueStaffAccess";
import { lookupStudentByIdentityToken } from "../segolife/commerce/studentIdentityService";
import { getVenueTodaySnapshot, getVenueStudentCard } from "../segolife/venues/venueAppService";

// permissionKey "events.manage": mismo criterio ya usado en events.ts
// myVenueEvents/myVenueEventLiveStats — Venue Admin nunca tiene esta llave
// global (VENUE_ADMIN_PERMISSION_BUNDLE no la incluye), así que aquí solo
// decide "¿es este caller un admin global?", nunca una capacidad nueva.
const TODAY_PERMISSION_KEY = "events.manage";

export const venueAppRouter = router({
  /** Venues donde este usuario puede operar la Venue App (spec §2) — mismo shape {all,venueIds} que staffCheckin/benefits/commerce.myAuthorizedVenues, nunca un formato nuevo. Un solo venue → el frontend entra directo, sin selector. */
  myAuthorizedVenues: protectedProcedure.query(async ({ ctx }) => {
    const access = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string, undefined, TODAY_PERMISSION_KEY);
    return access === "all" ? { all: true as const, venueIds: [] as number[] } : { all: false as const, venueIds: access };
  }),

  /** Resumen operativo "hoy" (spec §4/§5) — un único punto de composición para Today + actividad reciente. */
  today: protectedProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireVenueAccess(ctx.user.id, ctx.user.role as string, input.venueId, TODAY_PERMISSION_KEY);
      return getVenueTodaySnapshot(input.venueId);
    }),

  /** Ficha operativa mínima de un Student en este venue (spec §8/§32) — solo alcanzable re-escaneando su QR, nunca por id. */
  studentCard: protectedProcedure
    .input(z.object({ venueId: z.number().int().positive(), token: z.string().min(16).max(256) }))
    .query(async ({ ctx, input }) => {
      await requireVenueAccess(ctx.user.id, ctx.user.role as string, input.venueId, TODAY_PERMISSION_KEY);
      const student = await lookupStudentByIdentityToken(input.token);
      if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Código no reconocido" });
      return getVenueStudentCard(student.userId, input.venueId);
    }),
});
