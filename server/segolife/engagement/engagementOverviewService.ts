/**
 * engagementOverviewService.ts — Communication Center, agregados para
 * /admin/engagement/overview (spec §13). Reutiliza notifications/
 * notification_deliveries — ninguna tabla nueva, ningún dato inventado
 * (spec §36: "cuando un dato no esté disponible, N/A, nunca 0 ficticio" —
 * aquí todos los datos SÍ están disponibles, así que siempre son reales).
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[]])[0] ?? [];
}

export interface EngagementOverview {
  sentToday: number;
  sent7d: number;
  sent30d: number;
  byStatus: { status: string; count: number }[];
  byChannel: { channel: string; count: number }[];
  openedCount: number;
  clickedCount: number;
  topTemplates: { templateKey: string | null; count: number }[];
  topCampaigns: { campaignId: number; campaignName: string; notified: number }[];
  lastErrors: { id: number; channel: string; lastError: string | null; createdAt: Date }[];
}

export async function getEngagementOverview(): Promise<EngagementOverview> {
  const [todayResult, d7Result, d30Result, statusResult, channelResult, engagementResult, templatesResult, campaignsResult, errorsResult] = await Promise.all([
    _db.execute(sql`SELECT COUNT(*) AS n FROM notification_deliveries WHERE created_at >= CURDATE()`),
    _db.execute(sql`SELECT COUNT(*) AS n FROM notification_deliveries WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`),
    _db.execute(sql`SELECT COUNT(*) AS n FROM notification_deliveries WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`),
    _db.execute(sql`SELECT status, COUNT(*) AS n FROM notification_deliveries WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY status`),
    _db.execute(sql`SELECT channel, COUNT(*) AS n FROM notification_deliveries WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY channel`),
    _db.execute(sql`SELECT
      SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
      SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked
      FROM notification_deliveries WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`),
    _db.execute(sql`SELECT n.template_key AS templateKey, COUNT(*) AS n FROM notifications n
      WHERE n.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND n.template_key IS NOT NULL
      GROUP BY n.template_key ORDER BY n DESC LIMIT 5`),
    _db.execute(sql`SELECT c.id AS campaignId, c.name AS campaignName, COUNT(DISTINCT n.user_id) AS notified
      FROM engagement_campaigns c JOIN notifications n ON n.campaign_id = c.id
      GROUP BY c.id, c.name ORDER BY notified DESC LIMIT 5`),
    _db.execute(sql`SELECT id, channel, last_error AS lastError, created_at AS createdAt FROM notification_deliveries
      WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10`),
  ]);

  const engagementRow = rowsOf<{ opened: number | string | null; clicked: number | string | null }>(engagementResult)[0];

  return {
    sentToday: Number(rowsOf<{ n: number | string }>(todayResult)[0]?.n ?? 0),
    sent7d: Number(rowsOf<{ n: number | string }>(d7Result)[0]?.n ?? 0),
    sent30d: Number(rowsOf<{ n: number | string }>(d30Result)[0]?.n ?? 0),
    byStatus: rowsOf<{ status: string; n: number | string }>(statusResult).map(r => ({ status: r.status, count: Number(r.n) })),
    byChannel: rowsOf<{ channel: string; n: number | string }>(channelResult).map(r => ({ channel: r.channel, count: Number(r.n) })),
    openedCount: Number(engagementRow?.opened ?? 0),
    clickedCount: Number(engagementRow?.clicked ?? 0),
    topTemplates: rowsOf<{ templateKey: string | null; n: number | string }>(templatesResult).map(r => ({ templateKey: r.templateKey, count: Number(r.n) })),
    topCampaigns: rowsOf<{ campaignId: number; campaignName: string; notified: number | string }>(campaignsResult).map(r => ({ ...r, notified: Number(r.notified) })),
    lastErrors: rowsOf<{ id: number; channel: string; lastError: string | null; createdAt: Date }>(errorsResult),
  };
}
