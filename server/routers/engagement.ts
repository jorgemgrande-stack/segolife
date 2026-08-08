/**
 * engagement.ts — administración del Engagement Core (Fase 7, spec punto
 * 65). Separado del router `notifications` (estudiante = studentNotifications,
 * campana admin legacy = notifications — ver nota de colisión en
 * docs/engagement/architecture.md).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import {
  createCampaign, getCampaign, getCampaignMessages, scheduleCampaign, cancelCampaign, sendCampaignNow, CampaignError,
} from "../segolife/engagement/campaignService";
import { previewAudienceCount, type AudienceDefinition } from "../segolife/engagement/audienceEngine";
import { listDeliveries, listFailedDeliveries, retryDelivery, cancelDelivery, listAllNotifications } from "../segolife/engagement/notificationsDb";
import { ENGAGEMENT_TEMPLATES } from "../segolife/engagement/templates";
import { getProvider } from "../segolife/engagement/providers/providerRegistry";
import { createNotification } from "../segolife/engagement/notificationService";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { engagementCampaigns } from "../../drizzle/schema";
import { desc } from "drizzle-orm";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

const engagementViewProcedure = permissionProcedure("engagement.view", ["admin"]);
const engagementManageProcedure = permissionProcedure("engagement.manage", ["admin"]);
const engagementSendProcedure = permissionProcedure("engagement.send", ["admin"]);
const engagementTemplatesProcedure = permissionProcedure("engagement.templates.manage", ["admin"]);

function mapCampaignError(err: unknown): never {
  if (err instanceof CampaignError) {
    throw new TRPCError({ code: err.code === "NOT_FOUND" ? "NOT_FOUND" : "CONFLICT", message: err.message, cause: err });
  }
  throw err;
}

const audienceDefinitionSchema = z.object({
  communityIds: z.array(z.number().int().positive()).optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
  venueActivity: z.object({ venueId: z.number().int().positive(), kind: z.enum(["visited", "benefit_granted", "benefit_redeemed"]) }).optional(),
  eventAttended: z.object({ eventId: z.number().int().positive() }).optional(),
  tokensBalanceMin: z.number().int().optional(),
  tokensBalanceMax: z.number().int().optional(),
  benefitOwnership: z.object({ benefitDefinitionId: z.number().int().positive().optional(), status: z.enum(["active", "used", "expired", "cancelled"]).optional() }).optional(),
  academicYear: z.string().optional(),
  profileComplete: z.boolean().optional(),
  createdAfter: z.string().optional(),
  createdBefore: z.string().optional(),
});

export const engagementRouter = router({
  // ── Campaigns ─────────────────────────────────────────────────────────────
  listCampaigns: engagementViewProcedure.query(() =>
    _db.select().from(engagementCampaigns).orderBy(desc(engagementCampaigns.createdAt)).limit(100)
  ),

  getCampaign: engagementViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const campaign = await getCampaign(input.id);
      if (!campaign) throw new TRPCError({ code: "NOT_FOUND" });
      const messages = await getCampaignMessages(input.id);
      return { campaign, messages };
    }),

  createCampaign: engagementManageProcedure
    .input(z.object({
      name: z.string().min(1).max(256),
      type: z.enum(["manual", "scheduled", "triggered"]),
      communityId: z.number().int().positive().nullish(),
      audienceDefinition: audienceDefinitionSchema,
      scheduledAt: z.date().nullish(),
      messages: z.array(z.object({
        channel: z.enum(["in_app", "email", "push", "whatsapp"]),
        category: z.enum(["events", "rewards", "benefits", "promotions", "account"]),
        titleEn: z.string().min(1).max(256),
        titleEs: z.string().min(1).max(256),
        bodyEn: z.string().min(1),
        bodyEs: z.string().min(1),
        deepLink: z.string().nullish(),
        imageUrl: z.string().url().nullish(),
      })).min(1),
    }))
    .mutation(({ ctx, input }) => createCampaign({ ...input, communityId: input.communityId ?? null, createdByUserId: ctx.user.id })),

  scheduleCampaign: engagementManageProcedure
    .input(z.object({ id: z.number().int().positive(), scheduledAt: z.date() }))
    .mutation(async ({ input }) => {
      try {
        return await scheduleCampaign(input.id, input.scheduledAt);
      } catch (err) {
        mapCampaignError(err);
      }
    }),

  cancelCampaign: engagementManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await cancelCampaign(input.id, ctx.user.id);
      } catch (err) {
        mapCampaignError(err);
      }
    }),

  sendCampaignNow: engagementSendProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        return await sendCampaignNow(input.id);
      } catch (err) {
        mapCampaignError(err);
      }
    }),

  // ── Audience preview (spec punto 69 — solo conteo, nunca lista masiva) ────
  resolveAudiencePreview: engagementViewProcedure
    .input(audienceDefinitionSchema)
    .query(async ({ input }) => {
      const count = await previewAudienceCount(input as AudienceDefinition);
      return { count };
    }),

  // ── Templates (solo lectura — gestión real vive en código, spec punto 78) ─
  listTemplates: engagementTemplatesProcedure.query(() => Object.values(ENGAGEMENT_TEMPLATES)),

  // ── Notificaciones creadas (solo lectura, spec punto 33) ───────────────────
  listNotifications: engagementViewProcedure.query(() => listAllNotifications(100)),

  // ── Deliveries / failures (spec puntos 51-52) ──────────────────────────────
  listDeliveries: engagementViewProcedure
    .input(z.object({ status: z.enum(["pending", "sent", "delivered", "failed", "skipped", "cancelled"]).optional(), channel: z.enum(["in_app", "email", "push", "whatsapp"]).optional() }))
    .query(({ input }) => listDeliveries(input, 100)),

  listFailedDeliveries: engagementViewProcedure.query(() => listFailedDeliveries(100)),

  retryDelivery: engagementManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => { await retryDelivery(input.id); return { success: true }; }),

  cancelDelivery: engagementManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => { await cancelDelivery(input.id); return { success: true }; }),

  // ── Test send (spec punto 35) — SOLO a uno mismo (admin), nunca a estudiantes reales ──
  testSend: engagementSendProcedure
    .input(z.object({ channel: z.enum(["in_app", "email"]), title: z.string().min(1).max(256), body: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const provider = getProvider(input.channel);
      if (input.channel !== "in_app" && !provider.capabilities.configured) {
        return { ok: false, message: `${input.channel} provider not configured — test send only works for in_app until a real provider is configured` };
      }
      const result = await createNotification({
        userId: ctx.user.id,
        communityId: null,
        type: "manual_announcement",
        category: "account",
        audienceType: "transactional", // un test send siempre se entrega, independientemente de preferencias
        rendered: { titleEn: input.title, titleEs: input.title, bodyEn: input.body, bodyEs: input.body, deepLink: null },
        idempotencyKey: `test_send:${ctx.user.id}:${Date.now()}`,
        additionalChannels: input.channel === "in_app" ? [] : [input.channel],
        recipient: ctx.user.email ? { email: ctx.user.email } : undefined,
      });
      return { ok: true, notificationId: result.notification.id };
    }),
});
