import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, permissionProcedure } from "../_core/trpc";
import { getCommunityAccess } from "../_core/communityAccess";
import { getVenueStaffAccess } from "../segolife/benefits/venueStaffAccess";
import {
  listBenefitDefinitions,
  getBenefitDefinitionById,
  createBenefitDefinition,
  updateBenefitDefinition,
  setBenefitDefinitionActive,
  getBenefitDefinitionCommunities,
  setBenefitDefinitionCommunities,
  listBenefitRules,
  getBenefitRuleById,
  createBenefitRule,
  updateBenefitRule,
  setBenefitRuleActive,
  listGrantedBenefits,
  listUserBenefits,
  getUserBenefitWithDefinition,
  listBenefitRedemptionAttempts,
  listVenueStaff,
  addVenueStaff,
  removeVenueStaff,
  getVenueBenefitStats,
} from "../db/benefitsDb";
import { grantBenefit, cancelBenefit, expireBenefitIfNeeded, BenefitError } from "../segolife/benefits/benefitGrantService";
import { redeemBenefit } from "../segolife/benefits/benefitRedemptionService";

const benefitsViewProcedure = permissionProcedure("benefits.view", ["admin"]);
const benefitsManageProcedure = permissionProcedure("benefits.manage", ["admin"]);
const benefitsGrantProcedure = permissionProcedure("benefits.grant", ["admin"]);
const benefitsCancelProcedure = permissionProcedure("benefits.cancel", ["admin"]);
const benefitsRedeemProcedure = permissionProcedure("benefits.redeem", ["admin"]);

const communityFilterInput = z.union([z.number().int().positive(), z.literal("all")]).optional();

function mapBenefitError(err: unknown): never {
  if (err instanceof BenefitError) {
    const codeMap: Record<string, "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN"> = {
      NOT_FOUND: "NOT_FOUND",
      ALREADY_USED: "CONFLICT",
      EXPIRED: "BAD_REQUEST",
      NOT_ACTIVE_YET: "BAD_REQUEST",
      CANCELLED: "BAD_REQUEST",
      WRONG_VENUE: "BAD_REQUEST",
      WRONG_EVENT: "BAD_REQUEST",
      UNAUTHORIZED_STAFF: "FORBIDDEN",
      INVALID_TOKEN: "BAD_REQUEST",
      CANNOT_CANCEL: "CONFLICT",
      REASON_REQUIRED: "BAD_REQUEST",
      LIMIT_EXCEEDED: "BAD_REQUEST",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message });
  }
  throw err;
}

const definitionInputSchema = z.object({
  name: z.string().min(1).max(256),
  slug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  description: z.string().max(4000).nullish(),
  benefitType: z.enum(["free_entry", "free_product", "discount_percentage", "discount_fixed", "vip_access", "priority_access", "upgrade", "custom"]),
  destinationVenueId: z.number().int().positive().nullish(),
  destinationEventId: z.number().int().positive().nullish(),
  productId: z.number().int().positive().nullish(),
  discountType: z.enum(["percentage", "fixed"]).nullish(),
  discountValue: z.number().int().nullish(),
  valueMetadata: z.record(z.string(), z.unknown()).nullish(),
  imageUrl: z.string().max(512).nullish(),
  nameEn: z.string().max(256).nullish(),
  nameEs: z.string().max(256).nullish(),
  descriptionEn: z.string().max(4000).nullish(),
  descriptionEs: z.string().max(4000).nullish(),
  termsEn: z.string().max(8000).nullish(),
  termsEs: z.string().max(8000).nullish(),
});

const ruleInputSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(4000).nullish(),
  sourceType: z.enum(["consumption", "consumption_product", "venue_visit", "event_attendance", "token_earning", "recurrence", "campaign", "manual", "ticket", "future_external"]),
  sourceVenueId: z.number().int().positive().nullish(),
  sourceEventId: z.number().int().positive().nullish(),
  sourceProductId: z.number().int().positive().nullish(),
  communityId: z.number().int().positive().nullish(),
  minAmountCents: z.number().int().positive().nullish(),
  minVisits: z.number().int().positive().nullish(),
  recurrenceWindow: z.enum(["day", "week", "month"]).nullish(),
  conditionDaysOfWeek: z.array(z.number().int().min(0).max(6)).nullish(),
  conditionStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  conditionEndTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  priority: z.number().int().default(0),
  benefitDefinitionId: z.number().int().positive(),
  quantity: z.number().int().min(1).default(1),
  validityType: z.enum(["immediate", "offset", "day_anchored"]).default("immediate"),
  validityOffsetMinutes: z.number().int().nullish(),
  validityDurationMinutes: z.number().int().positive().nullish(),
  validityStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  validityEndTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  validityDaysOffset: z.number().int().min(0).nullish(),
  maxPerUser: z.number().int().positive().nullish(),
  maxPerDay: z.number().int().positive().nullish(),
  maxTotal: z.number().int().positive().nullish(),
  oncePerOrigin: z.boolean().default(false),
  oncePerRule: z.boolean().default(false),
});

export const benefitsRouter = router({
  // ─── ADMIN — definiciones ───────────────────────────────────────────────────

  listDefinitions: benefitsViewProcedure.query(async () => listBenefitDefinitions()),
  getDefinitionById: benefitsViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const def = await getBenefitDefinitionById(input.id);
      if (!def) throw new TRPCError({ code: "NOT_FOUND", message: "Definición no encontrada" });
      const communityIds = await getBenefitDefinitionCommunities(input.id);
      return { ...def, communityIds };
    }),
  createDefinition: benefitsManageProcedure
    .input(definitionInputSchema)
    .mutation(async ({ input }) => ({ success: true, definition: await createBenefitDefinition(input) })),
  updateDefinition: benefitsManageProcedure
    .input(z.object({ id: z.number().int().positive() }).merge(definitionInputSchema.partial()))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      const definition = await updateBenefitDefinition(id, fields);
      if (!definition) throw new TRPCError({ code: "NOT_FOUND", message: "Definición no encontrada" });
      return { success: true, definition };
    }),
  setDefinitionActive: benefitsManageProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      const definition = await setBenefitDefinitionActive(input.id, input.active);
      if (!definition) throw new TRPCError({ code: "NOT_FOUND", message: "Definición no encontrada" });
      return { success: true, definition };
    }),
  setDefinitionCommunities: benefitsManageProcedure
    .input(z.object({ id: z.number().int().positive(), communityIds: z.array(z.number().int().positive()).default([]) }))
    .mutation(async ({ input }) => {
      await setBenefitDefinitionCommunities(input.id, input.communityIds);
      return { success: true };
    }),

  // ─── ADMIN — reglas ─────────────────────────────────────────────────────────

  listRules: benefitsViewProcedure.query(async () => listBenefitRules()),
  getRuleById: benefitsViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rule = await getBenefitRuleById(input.id);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Regla no encontrada" });
      return rule;
    }),
  createRule: benefitsManageProcedure
    .input(ruleInputSchema)
    .mutation(async ({ input }) => ({ success: true, rule: await createBenefitRule(input) })),
  updateRule: benefitsManageProcedure
    .input(z.object({ id: z.number().int().positive() }).merge(ruleInputSchema.partial()))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      const rule = await updateBenefitRule(id, fields);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Regla no encontrada" });
      return { success: true, rule };
    }),
  setRuleActive: benefitsManageProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      const rule = await setBenefitRuleActive(input.id, input.active);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Regla no encontrada" });
      return { success: true, rule };
    }),

  // ─── ADMIN — concedidos ─────────────────────────────────────────────────────

  listGrants: benefitsViewProcedure
    .input(z.object({
      communityId: communityFilterInput,
      userId: z.number().int().positive().optional(),
      status: z.enum(["active", "used", "expired", "cancelled"]).optional(),
      benefitDefinitionId: z.number().int().positive().optional(),
      sourceVenueId: z.number().int().positive().optional(),
      destinationVenueId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      const access = await getCommunityAccess(ctx.user.id, ctx.user.role as string);
      const communityIds = access === "all"
        ? (input.communityId && input.communityId !== "all" ? [input.communityId] : "all" as const)
        : access;
      return listGrantedBenefits({ ...input, communityIds });
    }),

  manualGrant: benefitsGrantProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      benefitDefinitionId: z.number().int().positive(),
      validFrom: z.coerce.date(),
      validUntil: z.coerce.date().nullish(),
      communityId: z.number().int().positive().nullish(),
      reason: z.string().min(1).max(512),
    }))
    .mutation(async ({ input, ctx }) => {
      const definition = await getBenefitDefinitionById(input.benefitDefinitionId);
      if (!definition || !definition.active) throw new TRPCError({ code: "NOT_FOUND", message: "Definición no encontrada o inactiva" });
      const granted = await grantBenefit({
        userId: input.userId,
        benefitDefinitionId: input.benefitDefinitionId,
        sourceType: "manual",
        communityId: input.communityId ?? null,
        validFrom: input.validFrom,
        validUntil: input.validUntil ?? null,
        grantedByUserId: ctx.user.id,
        metadata: { reason: input.reason },
      });
      return { success: true, benefit: granted.benefit, qrToken: granted.qrToken };
    }),

  cancelGrant: benefitsCancelProcedure
    .input(z.object({ userBenefitId: z.number().int().positive(), reason: z.string().min(1).max(256) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const benefit = await cancelBenefit({ userBenefitId: input.userBenefitId, reason: input.reason, cancelledByUserId: ctx.user.id });
        return { success: true, benefit };
      } catch (err) {
        mapBenefitError(err);
      }
    }),

  // Estadísticas de un venue: GENERADOS (source_venue_id=este venue, origen)
  // vs CANJEADOS (used_at_venue_id=este venue, destino) — separación
  // explícita origen≠destino, ver drizzle/schema.ts comentario de benefit_rules.
  getVenueStats: benefitsViewProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ input }) => getVenueBenefitStats(input.venueId)),

  listRedemptionAttempts: benefitsViewProcedure
    .input(z.object({
      userBenefitId: z.number().int().positive().optional(),
      venueId: z.number().int().positive().optional(),
      result: z.string().max(64).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => listBenefitRedemptionAttempts(input)),

  // ─── ADMIN — asignación de staff a venue ────────────────────────────────────

  listVenueStaff: benefitsManageProcedure
    .input(z.object({ venueId: z.number().int().positive().optional() }))
    .query(async ({ input }) => listVenueStaff(input.venueId)),
  addVenueStaff: benefitsManageProcedure
    .input(z.object({ userId: z.number().int().positive(), venueId: z.number().int().positive() }))
    .mutation(async ({ input }) => ({ success: true, staff: await addVenueStaff(input.userId, input.venueId) })),
  removeVenueStaff: benefitsManageProcedure
    .input(z.object({ userId: z.number().int().positive(), venueId: z.number().int().positive() }))
    .mutation(async ({ input }) => { await removeVenueStaff(input.userId, input.venueId); return { success: true }; }),

  // ─── ESTUDIANTE — "Mis Beneficios" ──────────────────────────────────────────

  myBenefits: protectedProcedure.query(async ({ ctx }) => {
    const items = await listUserBenefits(ctx.user.id);
    return Promise.all(items.map(async (b) => {
      const resolved = await expireBenefitIfNeeded(b);
      return { ...b, status: resolved.status };
    }));
  }),

  /**
   * El token de QR en claro SOLO se incluye si el beneficio está realmente
   * mostrable ahora mismo (status=active y dentro de [valid_from, valid_until])
   * — ver spec Fase 4, punto 26. Fuera de esa ventana, el frontend debe
   * mostrar "Disponible mañana"/fecha en vez de un código.
   */
  getMyBenefit: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const benefit = await getUserBenefitWithDefinition(input.id);
      if (!benefit || benefit.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Beneficio no encontrado" });
      const resolved = await expireBenefitIfNeeded(benefit);
      const now = Date.now();
      const isCurrentlyValid = resolved.status === "active"
        && resolved.validFrom.getTime() <= now
        && (resolved.validUntil == null || resolved.validUntil.getTime() >= now);
      return {
        ...benefit,
        status: resolved.status,
        qrToken: isCurrentlyValid ? benefit.qrToken : null,
      };
    }),

  /** Venues donde este usuario puede validar Benefits — "all" = admin global (el frontend usa venues.publicActive como selector completo). */
  myAuthorizedVenues: protectedProcedure.query(async ({ ctx }) => {
    const access = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string);
    return access === "all" ? { all: true as const, venueIds: [] as number[] } : { all: false as const, venueIds: access };
  }),

  // ─── STAFF — validación en puerta/caja ──────────────────────────────────────
  // Privacidad: la respuesta expone ÚNICAMENTE lo necesario en puerta (nombre,
  // tipo de beneficio, estado, vigencia) — nunca email/teléfono/notas/saldo,
  // ver spec Fase 4 punto 21.

  staffRedeem: benefitsRedeemProcedure
    .input(z.object({
      token: z.string().min(16).max(256),
      venueId: z.number().int().positive(),
      eventId: z.number().int().positive().nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      const staffAuthorizedVenueIds = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string);
      const ipAddress = ctx.req?.ip ?? null;
      const userAgent = (ctx.req?.headers?.["user-agent"] as string | undefined) ?? null;
      try {
        const result = await redeemBenefit({
          token: input.token,
          staffUserId: ctx.user.id,
          venueId: input.venueId,
          eventId: input.eventId,
          staffAuthorizedVenueIds,
          ipAddress,
          userAgent,
        });
        return {
          success: true,
          studentName: result.studentName,
          benefitName: result.definition.name,
          benefitType: result.definition.benefitType,
          status: result.userBenefit.status,
          validFrom: result.userBenefit.validFrom,
          validUntil: result.userBenefit.validUntil,
          usedAt: result.userBenefit.usedAt,
        };
      } catch (err) {
        mapBenefitError(err);
      }
    }),
});
