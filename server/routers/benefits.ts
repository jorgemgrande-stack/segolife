import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, permissionProcedure } from "../_core/trpc";
import { getCommunityAccess } from "../_core/communityAccess";
import { getVenueStaffAccess, requireVenueAccess } from "../segolife/benefits/venueStaffAccess";
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
  getBenefitRuleStats,
  listMarketplaceBenefits,
  getMarketplaceBenefitById,
} from "../db/benefitsDb";
import { grantBenefit, cancelBenefit, expireBenefitIfNeeded, BenefitError } from "../segolife/benefits/benefitGrantService";
import { redeemBenefit } from "../segolife/benefits/benefitRedemptionService";
import { emitBenefitGranted, buildBenefitGrantedPayload } from "../segolife/benefits/benefitEvents";
import { purchaseBenefitWithTokens, BenefitPurchaseError } from "../segolife/benefits/benefitPurchaseService";
import { ensureWallet } from "../segolife/tokens/tokenLedgerService";

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
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
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
  // SEGOLIFE — Benefits Marketplace & SegoTokens Redemption (spec §6/§9).
  tokenCost: z.number().int().positive().nullish(),
  isMarketplaceEnabled: z.boolean().default(false),
  marketplaceInventoryTotal: z.number().int().positive().nullish(),
  perStudentPurchaseLimit: z.number().int().positive().nullish(),
  purchaseWindowStart: z.coerce.date().nullish(),
  purchaseWindowEnd: z.coerce.date().nullish(),
  redemptionValidityDays: z.number().int().positive().nullish(),
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
  // SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6, spec §7/§22).
  aggregateMetric: z.enum(["attendance_count", "venue_visit_count", "distinct_venues", "commerce_count", "commerce_quantity", "spend_cents"]).nullish(),
  aggregateThreshold: z.number().int().positive().nullish(),
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

/**
 * SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6, spec §22): validación
 * server-side de combinaciones que Zod por sí solo no puede expresar (Zod
 * ya cubre negativos/cero vía .positive() en cada campo numérico). No usa
 * `.refine()` sobre ruleInputSchema a propósito — eso rompería
 * ruleInputSchema.partial() (ZodEffects no tiene .partial()), que
 * updateRule necesita para aceptar actualizaciones parciales.
 */
function assertValidRuleInput(input: { aggregateMetric?: string | null; aggregateThreshold?: number | null; startsAt?: Date | null; endsAt?: Date | null }) {
  if (input.aggregateMetric != null && input.aggregateThreshold == null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Una métrica de agregado requiere un umbral" });
  }
  if (input.aggregateThreshold != null && input.aggregateMetric == null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Un umbral de agregado requiere seleccionar una métrica" });
  }
  if (input.startsAt && input.endsAt && input.startsAt >= input.endsAt) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "La fecha de fin debe ser posterior a la de inicio" });
  }
}

/** Resuelve la comunidad real del Student (primera por antigüedad, mismo criterio que ticketPurchasedListener.ts/notifyProposalPublished) — nunca inferida por venue/email. */
async function resolveMyCommunityId(userId: number): Promise<number | null> {
  const { getDb } = await import("../db");
  const { userCommunities } = await import("../../drizzle/schema");
  const db = await getDb();
  if (!db) return null;
  const [membership] = await db.select({ communityId: userCommunities.communityId })
    .from(userCommunities).where(eq(userCommunities.userId, userId)).orderBy(asc(userCommunities.joinedAt)).limit(1);
  return membership?.communityId ?? null;
}

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
    .mutation(async ({ input }) => {
      assertValidRuleInput(input);
      return { success: true, rule: await createBenefitRule(input) };
    }),
  updateRule: benefitsManageProcedure
    .input(z.object({ id: z.number().int().positive() }).merge(ruleInputSchema.partial()))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      assertValidRuleInput(fields);
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

  /** SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6, spec §27/§28): resultados de una regla — concedidos/canjeados/conversión/cross-venue. Solo lectura, mismo permiso que ver el resto del módulo de reglas. */
  getRuleStats: benefitsViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const stats = await getBenefitRuleStats(input.id);
      if (!stats) throw new TRPCError({ code: "NOT_FOUND", message: "Regla no encontrada" });
      return stats;
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
      // Emisión del evento de dominio DESPUÉS de que la concesión ya esté
      // confirmada (grantBenefit no abre transacción propia aquí — sin
      // db explícito, cada INSERT hace autocommit) — ver benefitEvents.ts.
      if (granted.created) {
        emitBenefitGranted(buildBenefitGrantedPayload(granted.benefit, definition));
      }
      // Respuesta sin qrToken/qrTokenHash — la concesión manual no es un
      // endpoint de "mostrar mi QR" gated por ownership (ver informe de
      // revisión, punto 2: solo getMyBenefit revela el token en claro).
      const { qrToken: _qrToken, qrTokenHash: _qrTokenHash, ...safeBenefit } = granted.benefit;
      return { success: true, benefit: safeBenefit };
    }),

  cancelGrant: benefitsCancelProcedure
    .input(z.object({ userBenefitId: z.number().int().positive(), reason: z.string().min(1).max(256) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const cancelled = await cancelBenefit({ userBenefitId: input.userBenefitId, reason: input.reason, cancelledByUserId: ctx.user.id });
        const { qrToken: _qrToken, qrTokenHash: _qrTokenHash, ...benefit } = cancelled;
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

  /**
   * SEGOLIFE — RBAC CONSOLIDATION (spec §6/§21: "ver métricas Casanova").
   * Deliberadamente NO reutiliza benefitsViewProcedure (permiso benefits.view
   * — daría acceso también a listDefinitions/listRules/listGrants globales,
   * más de lo que un Venue Admin debe ver, spec §22 mínimo privilegio).
   * En vez de eso: cualquier usuario autenticado puede llamarlo, pero
   * requireVenueAccess exige una fila real en venue_staff para ESE venueId
   * (o permiso global) — el mismo IDOR que getVenueStats no comprueba queda
   * cerrado aquí explícitamente.
   */
  getMyVenueStats: protectedProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await requireVenueAccess(ctx.user.id, ctx.user.role as string, input.venueId, "benefits.manage");
      return getVenueBenefitStats(input.venueId);
    }),

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

  // NUNCA incluye qrToken/qrTokenHash — es un LISTADO (ver informe de
  // revisión de seguridad, punto 2): listUserBenefits ya los omite a nivel
  // de BD (server/db/benefitsDb.ts), y aquí NO se reintroducen. El token en
  // claro solo se revela desde getMyBenefit, de UN beneficio propio y
  // únicamente cuando está realmente vigente ahora mismo.
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
   *
   * OWNERSHIP: `benefit.userId !== ctx.user.id` rechaza con NOT_FOUND (no
   * FORBIDDEN, para no confirmar a un usuario ajeno que el id existe) —
   * este es el ÚNICO endpoint de todo el módulo que puede devolver el
   * token en claro, y solo al dueño real del beneficio.
   *
   * Construcción EXPLÍCITA (sin spread de `benefit` completo + override
   * posterior) a propósito — evita que un futuro campo nuevo en
   * getUserBenefitWithDefinition() se filtre aquí sin pasar por esta
   * decisión consciente.
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
      const { qrToken: _qrToken, qrTokenHash: _qrTokenHash, ...safeBenefit } = benefit;
      return {
        ...safeBenefit,
        status: resolved.status,
        qrToken: isCurrentlyValid ? benefit.qrToken : null,
      };
    }),

  // ─── ESTUDIANTE — Marketplace (SEGOLIFE Benefits Marketplace & SegoTokens Redemption) ──

  /** Catálogo — solo lo que ES marketplace, activo y elegible para la comunidad real del Student (spec §13, decisión siempre server-side). Incluye el saldo actual para que el frontend pueda mostrar "te faltan XX ST" sin ocultar el Benefit (spec §14). */
  marketplaceList: protectedProcedure.query(async ({ ctx }) => {
    const communityId = await resolveMyCommunityId(ctx.user.id);
    const [items, wallet] = await Promise.all([
      listMarketplaceBenefits({ userId: ctx.user.id, communityId }),
      ensureWallet(ctx.user.id),
    ]);
    return { items, walletBalance: wallet.balance };
  }),

  marketplaceGetById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const communityId = await resolveMyCommunityId(ctx.user.id);
      const [item, wallet] = await Promise.all([
        getMarketplaceBenefitById(input.id, { userId: ctx.user.id, communityId }),
        ensureWallet(ctx.user.id),
      ]);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Beneficio no encontrado" });
      return { item, walletBalance: wallet.balance };
    }),

  /**
   * Canje real (spec §15/§16) — transacción única: valida + debita SegoTokens
   * + concede el Benefit, o nada. `idempotencyKey` la genera el cliente por
   * cada pulsación de "Canjear" (spec §19) — un doble-click/retry de red
   * reenvía la MISMA clave y nunca vuelve a cobrar.
   */
  purchase: protectedProcedure
    .input(z.object({ benefitDefinitionId: z.number().int().positive(), idempotencyKey: z.string().min(8).max(191) }))
    .mutation(async ({ input, ctx }) => {
      const communityId = await resolveMyCommunityId(ctx.user.id);
      try {
        const result = await purchaseBenefitWithTokens({
          userId: ctx.user.id,
          benefitDefinitionId: input.benefitDefinitionId,
          communityId,
          idempotencyKey: input.idempotencyKey,
        });
        if (result.created) {
          const definition = await getBenefitDefinitionById(input.benefitDefinitionId);
          if (definition) emitBenefitGranted(buildBenefitGrantedPayload(result.userBenefit, definition));
        }
        return {
          success: true,
          userBenefitId: result.userBenefit.id,
          walletBalance: result.walletBalance,
        };
      } catch (err) {
        if (err instanceof BenefitPurchaseError) {
          const codeMap: Record<string, "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN"> = {
            NOT_FOUND: "NOT_FOUND",
            NOT_MARKETPLACE_ENABLED: "BAD_REQUEST",
            INACTIVE: "BAD_REQUEST",
            NOT_YET_AVAILABLE: "BAD_REQUEST",
            PURCHASE_WINDOW_ENDED: "BAD_REQUEST",
            NOT_ELIGIBLE_COMMUNITY: "FORBIDDEN",
            LIMIT_EXCEEDED: "CONFLICT",
            OUT_OF_STOCK: "CONFLICT",
            INSUFFICIENT_BALANCE: "BAD_REQUEST",
          };
          throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
        }
        throw err;
      }
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
