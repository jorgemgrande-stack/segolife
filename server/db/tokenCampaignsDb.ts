import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, desc } from "drizzle-orm";
import {
  tokenCampaigns,
  campaignCommunities,
  campaignVenues,
  campaignEvents,
  type TokenCampaign,
  type InsertTokenCampaign,
} from "../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface CampaignScope {
  communityIds: number[];
  venueIds: number[];
  eventIds: number[];
}

async function getCampaignScope(campaignId: number, conn: DbHandle): Promise<CampaignScope> {
  const [communityRows, venueRows, eventRows] = await Promise.all([
    conn.select({ id: campaignCommunities.communityId }).from(campaignCommunities).where(eq(campaignCommunities.campaignId, campaignId)),
    conn.select({ id: campaignVenues.venueId }).from(campaignVenues).where(eq(campaignVenues.campaignId, campaignId)),
    conn.select({ id: campaignEvents.eventId }).from(campaignEvents).where(eq(campaignEvents.campaignId, campaignId)),
  ]);
  return {
    communityIds: communityRows.map(c => c.id),
    venueIds: venueRows.map(v => v.id),
    eventIds: eventRows.map(e => e.id),
  };
}

export interface TokenCampaignWithScope extends TokenCampaign {
  scope: CampaignScope;
}

export async function listTokenCampaigns(db?: DbHandle): Promise<TokenCampaignWithScope[]> {
  const conn = db ?? (await getDb());
  const rows = await conn.select().from(tokenCampaigns).orderBy(desc(tokenCampaigns.priority), desc(tokenCampaigns.createdAt));
  return Promise.all(rows.map(async r => ({ ...r, scope: await getCampaignScope(r.id, conn) })));
}

export async function getTokenCampaignById(id: number, db?: DbHandle): Promise<TokenCampaignWithScope | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(tokenCampaigns).where(eq(tokenCampaigns.id, id)).limit(1);
  if (!row) return null;
  return { ...row, scope: await getCampaignScope(id, conn) };
}

export async function createTokenCampaign(input: InsertTokenCampaign, db?: DbHandle): Promise<TokenCampaign> {
  const conn = db ?? (await getDb());
  const insertResult = await conn.insert(tokenCampaigns).values(input);
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [created] = await conn.select().from(tokenCampaigns).where(eq(tokenCampaigns.id, insertId)).limit(1);
  return created;
}

export async function updateTokenCampaign(
  id: number,
  fields: Partial<InsertTokenCampaign>,
  db?: DbHandle
): Promise<TokenCampaign | null> {
  const conn = db ?? (await getDb());
  await conn.update(tokenCampaigns).set(fields).where(eq(tokenCampaigns.id, id));
  const [updated] = await conn.select().from(tokenCampaigns).where(eq(tokenCampaigns.id, id)).limit(1);
  return updated ?? null;
}

export async function setTokenCampaignActive(id: number, active: boolean, db?: DbHandle): Promise<TokenCampaign | null> {
  const conn = db ?? (await getDb());
  await conn.update(tokenCampaigns).set({ active }).where(eq(tokenCampaigns.id, id));
  const [updated] = await conn.select().from(tokenCampaigns).where(eq(tokenCampaigns.id, id)).limit(1);
  return updated ?? null;
}

/** Reemplaza el alcance completo (M2M) de la campaña — mismo patrón idempotente que venuesDb.setVenueCommunities. */
export async function setCampaignScope(id: number, scope: CampaignScope, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.delete(campaignCommunities).where(eq(campaignCommunities.campaignId, id));
  await conn.delete(campaignVenues).where(eq(campaignVenues.campaignId, id));
  await conn.delete(campaignEvents).where(eq(campaignEvents.campaignId, id));
  for (const communityId of scope.communityIds) {
    await conn.insert(campaignCommunities).values({ campaignId: id, communityId });
  }
  for (const venueId of scope.venueIds) {
    await conn.insert(campaignVenues).values({ campaignId: id, venueId });
  }
  for (const eventId of scope.eventIds) {
    await conn.insert(campaignEvents).values({ campaignId: id, eventId });
  }
}
