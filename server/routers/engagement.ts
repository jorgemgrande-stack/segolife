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
import { ENGAGEMENT_TEMPLATES, renderTemplate } from "../segolife/engagement/templates";
import { getProvider } from "../segolife/engagement/providers/providerRegistry";
import { createNotification } from "../segolife/engagement/notificationService";
import { resolveWhatsappPolicy } from "../segolife/engagement/communicationChannelMatrix";
import { SENDER_IDENTITIES, type SenderKey } from "../segolife/engagement/senderRouting";
import { PREVIEW_VARIABLES_EN, PREVIEW_VARIABLES_ES } from "../segolife/engagement/templatePreviewData";
import { listSuppressions, removeSuppression } from "../segolife/engagement/emailSuppressionService";
import { getEngagementOverview } from "../segolife/engagement/engagementOverviewService";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { engagementCampaigns, users } from "../../drizzle/schema";
import { desc, eq } from "drizzle-orm";

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
  // ── Overview (spec §13) ──────────────────────────────────────────────────
  getOverview: engagementViewProcedure.query(() => getEngagementOverview()),

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
  // Nunca devolver buildEmailBody (función, no serializable por tRPC) — solo
  // los campos de datos del catálogo.
  listTemplates: engagementTemplatesProcedure.query(() =>
    Object.values(ENGAGEMENT_TEMPLATES).map(({ buildEmailBody: _fn, ...rest }) => ({
      ...rest,
      whatsappPolicy: resolveWhatsappPolicy(rest.key),
    }))
  ),

  /** Preview con datos ficticios (spec punto 34) — nunca toca BD, nunca usa un estudiante real. */
  previewTemplate: engagementTemplatesProcedure
    .input(z.object({ templateKey: z.string() }))
    .query(({ input }) => {
      const template = ENGAGEMENT_TEMPLATES[input.templateKey];
      if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Plantilla no encontrada" });
      return renderTemplate(input.templateKey, PREVIEW_VARIABLES_EN, "/ie/example", PREVIEW_VARIABLES_ES, "/ie/profile/preferences");
    }),

  /** Estado de providers (spec punto 63) — nunca falsas luces verdes. */
  getProviderStatus: engagementTemplatesProcedure.query(() => ({
    email: { configured: getProvider("email").capabilities.configured, label: getProvider("email").capabilities.configured ? "Configured" : "Not configured" },
    inApp: { configured: true, label: "Active" },
    whatsapp: { configured: false, label: "Coming soon (GHL)" },
    push: { configured: getProvider("push").capabilities.configured, label: getProvider("push").capabilities.configured ? "Configured" : "Not configured" },
  })),

  /** Enviar prueba de UNA plantilla concreta a un email explícito (spec punto 35) — nunca a estudiantes reales, requiere provider real configurado. */
  sendTestForTemplate: engagementSendProcedure
    .input(z.object({ templateKey: z.string(), testEmail: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const template = ENGAGEMENT_TEMPLATES[input.templateKey];
      if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Plantilla no encontrada" });
      if (!template.channels.includes("email")) return { ok: false, message: "Esta plantilla no soporta el canal email" };
      const emailProvider = getProvider("email");
      if (!emailProvider.capabilities.configured) return { ok: false, message: "Email provider not configured (SEGOLIFE_ENGAGEMENT_EMAIL_FROM)" };

      const rendered = renderTemplate(input.templateKey, PREVIEW_VARIABLES_EN, "/ie/example", PREVIEW_VARIABLES_ES, "/ie/profile/preferences");
      const result = await createNotification({
        userId: ctx.user.id,
        communityId: null,
        type: `test_${template.key}`,
        category: template.category,
        audienceType: "transactional",
        rendered,
        templateKey: template.key,
        templateVersion: template.version,
        idempotencyKey: `test_send:${template.key}:${ctx.user.id}:${Date.now()}`,
        additionalChannels: ["email"],
        sendImmediately: true,
        recipient: { email: input.testEmail },
      });
      return { ok: true, notificationId: result.notification.id };
    }),

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
        sendImmediately: true,
        recipient: ctx.user.email ? { email: ctx.user.email } : undefined,
      });
      return { ok: true, notificationId: result.notification.id };
    }),

  // ── CRM / Student 360 — envío manual a UN Student (spec §25) ───────────────
  // Reutiliza createNotification() directamente — nunca un segundo "mail
  // composer" ni un sendEmail directo. Contenido libre (no plantilla del
  // catálogo): el admin escribe una vez, se usa igual para en/es — es un
  // mensaje ad-hoc dirigido a una persona concreta, no contenido bilingüe
  // versionado.
  sendManualMessage: engagementSendProcedure
    .input(z.object({
      studentUserId: z.number().int().positive(),
      subject: z.string().min(1).max(256),
      body: z.string().min(1).max(8000),
      senderKey: z.enum(["system", "human", "support", "community", "tickets", "partners"]).default("human"),
      category: z.enum(["events", "rewards", "benefits", "promotions", "account"]).default("account"),
    }))
    .mutation(async ({ ctx, input }) => {
      const [student] = await _db.select({ email: users.email }).from(users).where(eq(users.id, input.studentUserId)).limit(1);
      if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Student no encontrado" });

      const result = await createNotification({
        userId: input.studentUserId,
        communityId: null,
        type: "crm_manual_message",
        category: input.category,
        audienceType: "transactional", // mensaje dirigido admin→Student concreto, no marketing masivo — siempre se entrega
        rendered: {
          titleEn: input.subject, titleEs: input.subject,
          bodyEn: input.body, bodyEs: input.body,
          deepLink: null,
          subjectEn: input.subject, subjectEs: input.subject,
        },
        sourceType: "crm_manual",
        sourceId: ctx.user.id,
        idempotencyKey: `crm_manual:${input.studentUserId}:${ctx.user.id}:${Date.now()}`,
        additionalChannels: ["email"],
        sendImmediately: true,
        recipient: { email: student.email ?? null },
        senderOverride: input.senderKey as SenderKey,
      });
      return { ok: true, notificationId: result.notification.id, hadEmail: !!student.email };
    }),

  listSenderIdentities: engagementViewProcedure.query(() => Object.values(SENDER_IDENTITIES)),

  // ── Suppression técnica (spec §21) ──────────────────────────────────────────
  listSuppressions: engagementViewProcedure.query(() => listSuppressions(200)),
  removeSuppression: engagementManageProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => { await removeSuppression(input.email); return { success: true }; }),
});
