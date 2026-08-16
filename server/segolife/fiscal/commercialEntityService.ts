/**
 * commercialEntityService.ts — SEGOLIFE FASE 10 (spec §1/§2/§5).
 *
 * CRÍTICO (spec "WHO IS THE SELLER?"): nunca se asume SEGOLIFE=vendedor ni
 * se deriva el vendedor del nombre del venue. `resolveSellerForVenue` es la
 * ÚNICA función que cualquier flujo de fiscalidad/liquidaciones debe llamar
 * para saber quién vende/cobra — nunca se hardcodea ni se adivina.
 *
 * GLOBAL_ADMIN exclusivamente (spec §5: "keep sensitive fiscal configuration
 * GLOBAL_ADMIN") — RBAC lo aplica en server/routers/fiscal.ts vía fiscal.manage.
 */
import { eq, and, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  commercialEntities, venueSellerConfig, venues,
  type CommercialEntity, type VenueSellerConfig,
} from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class CommercialEntityError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "CommercialEntityError";
  }
}

export interface UpsertCommercialEntityInput {
  id?: number;
  legalName: string;
  tradeName?: string | null;
  taxId: string;
  country?: string;
  fiscalAddress?: string | null;
  email?: string | null;
  currency?: string;
  active?: boolean;
}

export async function listCommercialEntities(db?: DbHandle): Promise<CommercialEntity[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(commercialEntities).orderBy(commercialEntities.legalName);
}

export async function upsertCommercialEntity(input: UpsertCommercialEntityInput, db?: DbHandle): Promise<CommercialEntity> {
  const conn = db ?? (await getDb());
  if (!input.legalName.trim()) throw new CommercialEntityError("INVALID_INPUT", "legalName es obligatorio");
  if (!input.taxId.trim()) throw new CommercialEntityError("INVALID_INPUT", "taxId es obligatorio");

  if (input.id) {
    await conn.update(commercialEntities).set({
      legalName: input.legalName,
      tradeName: input.tradeName ?? null,
      taxId: input.taxId,
      country: input.country ?? "ES",
      fiscalAddress: input.fiscalAddress ?? null,
      email: input.email ?? null,
      currency: input.currency ?? "EUR",
      active: input.active ?? true,
    }).where(eq(commercialEntities.id, input.id));
    const [row] = await conn.select().from(commercialEntities).where(eq(commercialEntities.id, input.id)).limit(1);
    if (!row) throw new CommercialEntityError("NOT_FOUND", "Entidad no encontrada");
    return row;
  }

  const [result] = await conn.insert(commercialEntities).values({
    legalName: input.legalName,
    tradeName: input.tradeName ?? null,
    taxId: input.taxId,
    country: input.country ?? "ES",
    fiscalAddress: input.fiscalAddress ?? null,
    email: input.email ?? null,
    currency: input.currency ?? "EUR",
    active: input.active ?? true,
  });
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(commercialEntities).where(eq(commercialEntities.id, insertId)).limit(1);
  if (!row) throw new CommercialEntityError("NOT_FOUND", "Entidad no encontrada tras crearla");
  return row;
}

export interface SetVenueSellerInput {
  venueId: number;
  sellerEntityId: number;
  collectorEntityId?: number | null;
  updatedByUserId?: number | null;
}

/** Configura (crea o actualiza) el vendedor/cobrador de un venue — spec §2, nunca inferido. */
export async function setVenueSellerConfig(input: SetVenueSellerInput, db?: DbHandle): Promise<VenueSellerConfig> {
  const conn = db ?? (await getDb());
  const [seller] = await conn.select().from(commercialEntities).where(eq(commercialEntities.id, input.sellerEntityId)).limit(1);
  if (!seller) throw new CommercialEntityError("SELLER_NOT_FOUND", "La entidad vendedora indicada no existe");

  const [existing] = await conn.select().from(venueSellerConfig).where(eq(venueSellerConfig.venueId, input.venueId)).limit(1);
  if (existing) {
    await conn.update(venueSellerConfig).set({
      sellerEntityId: input.sellerEntityId,
      collectorEntityId: input.collectorEntityId ?? null,
      active: true,
      updatedByUserId: input.updatedByUserId ?? null,
    }).where(eq(venueSellerConfig.id, existing.id));
    const [row] = await conn.select().from(venueSellerConfig).where(eq(venueSellerConfig.id, existing.id)).limit(1);
    return row!;
  }

  const [result] = await conn.insert(venueSellerConfig).values({
    venueId: input.venueId,
    sellerEntityId: input.sellerEntityId,
    collectorEntityId: input.collectorEntityId ?? null,
    active: true,
    updatedByUserId: input.updatedByUserId ?? null,
  });
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(venueSellerConfig).where(eq(venueSellerConfig.id, insertId)).limit(1);
  return row!;
}

export interface ResolvedSeller {
  configured: boolean;
  sellerEntity: CommercialEntity | null;
  collectorEntity: CommercialEntity | null;
}

/**
 * ÚNICA función que resuelve "¿quién vende y quién cobra este venue?" (spec
 * "CRITICAL PRINCIPLE"). `configured=false` cuando el venue no tiene
 * vendedor asignado todavía — nunca se inventa uno (spec §106).
 * collectorEntity=null cuando el propio vendedor cobra (spec §2, caso simple).
 */
export async function resolveSellerForVenue(venueId: number, db?: DbHandle): Promise<ResolvedSeller> {
  const conn = db ?? (await getDb());
  const [config] = await conn.select().from(venueSellerConfig).where(eq(venueSellerConfig.venueId, venueId)).limit(1);
  if (!config || !config.active) return { configured: false, sellerEntity: null, collectorEntity: null };

  const [sellerEntity] = await conn.select().from(commercialEntities).where(eq(commercialEntities.id, config.sellerEntityId)).limit(1);
  if (!sellerEntity) return { configured: false, sellerEntity: null, collectorEntity: null };

  let collectorEntity: CommercialEntity | null = null;
  if (config.collectorEntityId) {
    const [row] = await conn.select().from(commercialEntities).where(eq(commercialEntities.id, config.collectorEntityId)).limit(1);
    collectorEntity = row ?? null;
  }
  return { configured: true, sellerEntity, collectorEntity };
}

export interface VenueMissingSellerRow {
  venueId: number;
  venueName: string;
}

/**
 * SEGOLIFE ADMIN AI/BI/COMMAND CENTER (Fase 12, spec §33): venues SIN
 * vendedor fiscal activo configurado — nunca se inventa un vendedor por
 * defecto (mismo criterio que resolveSellerForVenue: `configured=false` es
 * un estado real, no un error a ocultar). Solo venues activos — uno recién
 * dado de baja no necesita alertar.
 */
export async function listVenuesMissingSellerConfig(db?: DbHandle): Promise<VenueMissingSellerRow[]> {
  const conn = db ?? (await getDb());
  const configuredRows = await conn.select({ venueId: venueSellerConfig.venueId }).from(venueSellerConfig).where(eq(venueSellerConfig.active, true));
  const configuredVenueIds = configuredRows.map(r => r.venueId);

  const rows = configuredVenueIds.length > 0
    ? await conn.select({ id: venues.id, name: venues.name }).from(venues).where(and(eq(venues.status, "active"), notInArray(venues.id, configuredVenueIds)))
    : await conn.select({ id: venues.id, name: venues.name }).from(venues).where(eq(venues.status, "active"));

  return rows.map(r => ({ venueId: r.id, venueName: r.name }));
}

export async function getVenueSellerConfig(venueId: number, db?: DbHandle): Promise<VenueSellerConfig | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(venueSellerConfig).where(eq(venueSellerConfig.venueId, venueId)).limit(1);
  return row ?? null;
}
