/**
 * campaignService.ts — ciclo de vida de engagement_campaigns (Fase 7,
 * puntos 23-25, 70-71). Audiencia y contenido separados a propósito (punto
 * 24): crear campaña → definir mensaje(s) por canal → resolver/snapshot
 * audiencia → programar o enviar ya.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  engagementCampaigns, engagementCampaignAudiences, engagementCampaignMessages,
  type EngagementCampaign, type InsertEngagementCampaign, type EngagementCampaignMessage,
} from "../../../drizzle/schema";
import { resolveAudience, type AudienceDefinition } from "./audienceEngine";
import { createNotification } from "./notificationService";
import { sanitizeDeepLink } from "./deepLinkPolicy";
import type { NotificationChannel } from "./notificationPreferencesService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class CampaignError extends Error {
  constructor(public code: "NOT_FOUND" | "INVALID_STATE", message: string) {
    super(message);
    this.name = "CampaignError";
  }
}

export interface CreateCampaignInput {
  name: string;
  type: "manual" | "scheduled" | "triggered";
  communityId: number | null;
  audienceDefinition: AudienceDefinition;
  scheduledAt?: Date | null;
  createdByUserId: number;
  messages: Array<{ channel: NotificationChannel; category: "events" | "rewards" | "benefits" | "promotions" | "account"; titleEn: string; titleEs: string; bodyEn: string; bodyEs: string; deepLink?: string | null; imageUrl?: string | null }>;
}

export async function createCampaign(input: CreateCampaignInput, db?: DbHandle): Promise<EngagementCampaign> {
  const conn = db ?? (await getDb());
  const values: InsertEngagementCampaign = {
    name: input.name,
    type: input.type,
    status: "draft",
    communityId: input.communityId,
    audienceDefinition: input.audienceDefinition as Record<string, unknown>,
    scheduledAt: input.scheduledAt ?? null,
    createdByUserId: input.createdByUserId,
  };
  const [result] = await conn.insert(engagementCampaigns).values(values);
  const insertId = (result as unknown as { insertId: number }).insertId;

  if (input.messages.length) {
    await conn.insert(engagementCampaignMessages).values(
      input.messages.map(m => ({
        campaignId: insertId,
        channel: m.channel,
        category: m.category,
        titleEn: m.titleEn,
        titleEs: m.titleEs,
        bodyEn: m.bodyEn,
        bodyEs: m.bodyEs,
        deepLink: sanitizeDeepLink(m.deepLink),
        imageUrl: m.imageUrl ?? null,
      }))
    );
  }

  const [campaign] = await conn.select().from(engagementCampaigns).where(eq(engagementCampaigns.id, insertId)).limit(1);
  return campaign;
}

export async function getCampaign(id: number, db?: DbHandle): Promise<EngagementCampaign | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(engagementCampaigns).where(eq(engagementCampaigns.id, id)).limit(1);
  return row ?? null;
}

export async function getCampaignMessages(campaignId: number, db?: DbHandle): Promise<EngagementCampaignMessage[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(engagementCampaignMessages).where(eq(engagementCampaignMessages.campaignId, campaignId));
}

/** Resuelve y persiste el snapshot de audiencia — spec punto 70: al PROGRAMAR (o enviar ya, para manual) se fija, no se re-resuelve después. */
async function snapshotAudience(campaignId: number, definition: AudienceDefinition, conn: DbHandle): Promise<number> {
  const userIds = await resolveAudience(definition, conn);
  if (userIds.length) {
    await conn.insert(engagementCampaignAudiences).ignore().values(
      userIds.map(userId => ({ campaignId, userId }))
    );
  }
  await conn.update(engagementCampaigns).set({ audienceSnapshotAt: new Date() }).where(eq(engagementCampaigns.id, campaignId));
  return userIds.length;
}

export async function scheduleCampaign(id: number, scheduledAt: Date, db?: DbHandle): Promise<EngagementCampaign> {
  const conn = db ?? (await getDb());
  const campaign = await getCampaign(id, conn);
  if (!campaign) throw new CampaignError("NOT_FOUND", "Campaign not found");
  if (campaign.status !== "draft") throw new CampaignError("INVALID_STATE", "Only draft campaigns can be scheduled");

  await snapshotAudience(id, campaign.audienceDefinition as AudienceDefinition, conn);
  await conn.update(engagementCampaigns).set({ status: "scheduled", scheduledAt }).where(eq(engagementCampaigns.id, id));
  return (await getCampaign(id, conn))!;
}

export async function cancelCampaign(id: number, cancelledByUserId: number, db?: DbHandle): Promise<EngagementCampaign> {
  const conn = db ?? (await getDb());
  const campaign = await getCampaign(id, conn);
  if (!campaign) throw new CampaignError("NOT_FOUND", "Campaign not found");
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    throw new CampaignError("INVALID_STATE", "Only draft/scheduled campaigns can be cancelled — sent deliveries are historical and are never deleted");
  }
  await conn.update(engagementCampaigns).set({ status: "cancelled", cancelledAt: new Date(), cancelledByUserId }).where(eq(engagementCampaigns.id, id));
  return (await getCampaign(id, conn))!;
}

/** Envía una campaña `manual` (o procesa una `scheduled` cuyo momento llegó) — crea 1 notification por (usuario × canal del mensaje). Idempotente: cada notification usa `campaign:<id>:<userId>:<channel>` como idempotency key. */
export async function sendCampaignNow(id: number, db?: DbHandle): Promise<{ notified: number }> {
  const conn = db ?? (await getDb());
  const campaign = await getCampaign(id, conn);
  if (!campaign) throw new CampaignError("NOT_FOUND", "Campaign not found");
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    throw new CampaignError("INVALID_STATE", "Campaign already running/completed/cancelled");
  }

  let userIds: number[];
  if (campaign.audienceSnapshotAt) {
    const rows = await conn.select().from(engagementCampaignAudiences).where(eq(engagementCampaignAudiences.campaignId, id));
    userIds = rows.map(r => r.userId);
  } else {
    userIds = await resolveAudience(campaign.audienceDefinition as AudienceDefinition, conn);
    if (userIds.length) {
      await conn.insert(engagementCampaignAudiences).ignore().values(userIds.map(userId => ({ campaignId: id, userId })));
    }
  }

  await conn.update(engagementCampaigns).set({ status: "running", startedAt: new Date() }).where(eq(engagementCampaigns.id, id));

  const messages = await getCampaignMessages(id, conn);
  let notified = 0;
  for (const userId of userIds) {
    for (const message of messages) {
      const additionalChannels = message.channel === "in_app" ? [] : [message.channel];
      await createNotification({
        userId,
        communityId: campaign.communityId,
        type: "manual_announcement",
        category: message.category,
        audienceType: "marketing",
        rendered: { titleEn: message.titleEn, titleEs: message.titleEs, bodyEn: message.bodyEn, bodyEs: message.bodyEs, deepLink: message.deepLink },
        imageUrl: message.imageUrl,
        campaignId: id,
        idempotencyKey: `campaign:${id}:${userId}:${message.channel}`,
        additionalChannels,
      }, conn);
    }
    notified++;
  }

  await conn.update(engagementCampaigns).set({ status: "completed", completedAt: new Date() }).where(eq(engagementCampaigns.id, id));
  return { notified };
}
