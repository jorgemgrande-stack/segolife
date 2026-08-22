import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, inArray, desc, type SQL } from "drizzle-orm";
import {
  consumptionQrCodes,
  qrBatches,
  qrRedemptionAttempts,
  communityVenues,
  venues,
  venueProducts,
  users,
  type ConsumptionQrCode,
  type QrBatch,
  type QrRedemptionAttempt,
} from "../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

/** venueIds vinculados a alguna de las comunidades dadas — mismo patrón que venuesDb.ts/eventsDb.ts. */
async function getVenueIdsInCommunities(communityIds: number[], conn: DbHandle): Promise<number[]> {
  if (communityIds.length === 0) return [];
  const rows = await conn.select({ venueId: communityVenues.venueId }).from(communityVenues)
    .where(inArray(communityVenues.communityId, communityIds));
  return Array.from(new Set(rows.map(r => r.venueId)));
}

export interface ConsumptionQrListItem extends ConsumptionQrCode {
  venueName: string;
  productName: string | null;
  redeemedByName: string | null;
}

export interface ConsumptionQrListFilters {
  /** "all" = sin restricción de comunidad (ya resuelto por communityAccess.ts). */
  communityIds: number[] | "all";
  venueId?: number;
  productId?: number;
  status?: "issued" | "redeemed" | "expired" | "cancelled";
  redeemedByUserId?: number;
  limit?: number;
  offset?: number;
}

export async function listConsumptionQrCodes(
  filters: ConsumptionQrListFilters,
  db?: DbHandle
): Promise<{ items: ConsumptionQrListItem[]; total: number }> {
  const conn = db ?? (await getDb());

  let restrictToVenueIds: number[] | null = null;
  if (filters.communityIds !== "all") {
    restrictToVenueIds = await getVenueIdsInCommunities(filters.communityIds, conn);
    if (restrictToVenueIds.length === 0) return { items: [], total: 0 };
  }

  const conditions: SQL[] = [];
  if (restrictToVenueIds) conditions.push(inArray(consumptionQrCodes.venueId, restrictToVenueIds));
  if (filters.venueId) conditions.push(eq(consumptionQrCodes.venueId, filters.venueId));
  if (filters.productId) conditions.push(eq(consumptionQrCodes.productId, filters.productId));
  if (filters.status) conditions.push(eq(consumptionQrCodes.status, filters.status));
  if (filters.redeemedByUserId) conditions.push(eq(consumptionQrCodes.redeemedByUserId, filters.redeemedByUserId));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const baseQuery = conn
    .select({ qr: consumptionQrCodes, venue: venues, product: venueProducts, redeemedBy: users })
    .from(consumptionQrCodes)
    .innerJoin(venues, eq(consumptionQrCodes.venueId, venues.id))
    .leftJoin(venueProducts, eq(consumptionQrCodes.productId, venueProducts.id))
    .leftJoin(users, eq(consumptionQrCodes.redeemedByUserId, users.id));

  const rows = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .orderBy(desc(consumptionQrCodes.issuedAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  const countQuery = conn.select({ qr: consumptionQrCodes }).from(consumptionQrCodes);
  const countRows = await (whereClause ? countQuery.where(whereClause) : countQuery);
  const total = countRows.length;

  const items: ConsumptionQrListItem[] = rows.map(r => ({
    ...r.qr,
    venueName: r.venue.name,
    productName: r.product?.name ?? null,
    redeemedByName: r.redeemedBy?.name ?? null,
  }));

  return { items, total };
}

export async function getConsumptionQrById(id: number, db?: DbHandle): Promise<ConsumptionQrListItem | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn
    .select({ qr: consumptionQrCodes, venue: venues, product: venueProducts, redeemedBy: users })
    .from(consumptionQrCodes)
    .innerJoin(venues, eq(consumptionQrCodes.venueId, venues.id))
    .leftJoin(venueProducts, eq(consumptionQrCodes.productId, venueProducts.id))
    .leftJoin(users, eq(consumptionQrCodes.redeemedByUserId, users.id))
    .where(eq(consumptionQrCodes.id, id))
    .limit(1);
  if (!row) return null;
  return { ...row.qr, venueName: row.venue.name, productName: row.product?.name ?? null, redeemedByName: row.redeemedBy?.name ?? null };
}

export async function listQrCodesByBatch(batchId: number, db?: DbHandle): Promise<ConsumptionQrCode[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(consumptionQrCodes).where(eq(consumptionQrCodes.batchId, batchId)).orderBy(consumptionQrCodes.id);
}

export interface QrBatchListFilters {
  communityIds: number[] | "all";
  venueId?: number;
  limit?: number;
  offset?: number;
}

export interface QrBatchListItem extends QrBatch {
  venueName: string;
}

export async function listQrBatches(filters: QrBatchListFilters, db?: DbHandle): Promise<QrBatchListItem[]> {
  const conn = db ?? (await getDb());

  let restrictToVenueIds: number[] | null = null;
  if (filters.communityIds !== "all") {
    restrictToVenueIds = await getVenueIdsInCommunities(filters.communityIds, conn);
    if (restrictToVenueIds.length === 0) return [];
  }

  const conditions: SQL[] = [];
  if (restrictToVenueIds) conditions.push(inArray(qrBatches.venueId, restrictToVenueIds));
  if (filters.venueId) conditions.push(eq(qrBatches.venueId, filters.venueId));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const baseQuery = conn.select({ batch: qrBatches, venue: venues }).from(qrBatches)
    .innerJoin(venues, eq(qrBatches.venueId, venues.id));
  const rows = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .orderBy(desc(qrBatches.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  return rows.map(r => ({ ...r.batch, venueName: r.venue.name }));
}

export async function getQrBatchById(id: number, db?: DbHandle): Promise<QrBatch | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(qrBatches).where(eq(qrBatches.id, id)).limit(1);
  return row ?? null;
}

export interface QrBatchSummary {
  total: number;
  /** issued, sin asignar todavía y sin caducar — listo para escanear o asignar. */
  pending: number;
  /** issued y ya asignado a un estudiante concreto (expiryMode='from_assignment') — reservado, aún no canjeado. */
  assigned: number;
  redeemed: number;
  /** status='expired' + issued cuyo expiresAt ya pasó (misma reclasificación perezosa de lectura que redeemConsumptionQr — no muta filas, solo cuenta). */
  expired: number;
  cancelled: number;
}

/** F63 — resumen de un lote para la pantalla de gestión (spec "GESTIÓN DE LOTES"). Solo lectura: nunca fuerza la transición 'issued'→'expired' que sí hace redeemConsumptionQr. */
export async function getQrBatchSummary(batchId: number, db?: DbHandle): Promise<QrBatchSummary> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({
    status: consumptionQrCodes.status,
    expiresAt: consumptionQrCodes.expiresAt,
    assignedUserId: consumptionQrCodes.assignedUserId,
  }).from(consumptionQrCodes).where(eq(consumptionQrCodes.batchId, batchId));

  const summary: QrBatchSummary = { total: rows.length, pending: 0, assigned: 0, redeemed: 0, expired: 0, cancelled: 0 };
  const now = Date.now();
  for (const r of rows) {
    if (r.status === "redeemed") { summary.redeemed++; continue; }
    if (r.status === "cancelled") { summary.cancelled++; continue; }
    const isEffectivelyExpired = r.status === "expired" || (r.expiresAt != null && r.expiresAt.getTime() < now);
    if (isEffectivelyExpired) { summary.expired++; continue; }
    if (r.assignedUserId != null) { summary.assigned++; } else { summary.pending++; }
  }
  return summary;
}

export async function listRedemptionAttempts(
  filters: { qrId?: number; venueId?: number; result?: string; limit?: number; offset?: number },
  db?: DbHandle
): Promise<QrRedemptionAttempt[]> {
  const conn = db ?? (await getDb());
  const conditions: SQL[] = [];
  if (filters.qrId) conditions.push(eq(qrRedemptionAttempts.qrId, filters.qrId));
  if (filters.result) conditions.push(eq(qrRedemptionAttempts.result, filters.result as QrRedemptionAttempt["result"]));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const baseQuery = conn.select().from(qrRedemptionAttempts);
  return (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .orderBy(desc(qrRedemptionAttempts.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);
}

export async function listQrRedemptionsByUser(userId: number, limit = 20, db?: DbHandle): Promise<ConsumptionQrListItem[]> {
  const conn = db ?? (await getDb());
  const rows = await conn
    .select({ qr: consumptionQrCodes, venue: venues, product: venueProducts, redeemedBy: users })
    .from(consumptionQrCodes)
    .innerJoin(venues, eq(consumptionQrCodes.venueId, venues.id))
    .leftJoin(venueProducts, eq(consumptionQrCodes.productId, venueProducts.id))
    .leftJoin(users, eq(consumptionQrCodes.redeemedByUserId, users.id))
    .where(and(eq(consumptionQrCodes.redeemedByUserId, userId), eq(consumptionQrCodes.status, "redeemed")))
    .orderBy(desc(consumptionQrCodes.redeemedAt))
    .limit(limit);
  return rows.map(r => ({ ...r.qr, venueName: r.venue.name, productName: r.product?.name ?? null, redeemedByName: r.redeemedBy?.name ?? null }));
}
