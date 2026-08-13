/**
 * activationReadinessService.ts — SEGOLIFE LOYALTY PRODUCTION HARDENING
 * (spec §19). Diagnóstico administrativo MÍNIMO — nunca un botón "Activate
 * Loyalty" (spec §19 explícito). Agrega el estado REAL de la infraestructura
 * (nunca hardcodeado) para que un admin pueda ver de un vistazo si loyalty
 * está técnicamente lista para producción — la decisión de activarla sigue
 * siendo 100% manual (flip directo de `loyalty_enabled` en cada integración,
 * fuera de esta pantalla).
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { venueIntegrations, venues, tokenRules, tokenCampaigns } from "../../../drizzle/schema";
import { getSystemSetting } from "../../config";
import { LOYALTY_GLOBAL_CUTOFF_SETTING_KEY } from "./loyaltyCutoffService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface VenueLoyaltyReadiness {
  venueId: number;
  venueName: string;
  syncEnabled: boolean;
  loyaltyEnabled: boolean;
  cutoffOverrideConfigured: boolean;
}

export interface ActivationReadinessSnapshot {
  /** Constante estructural — NUNCA leída de BD, refleja rewardEngine.ts LIVE_MODE_ENABLED (bloqueado en código, no en configuración). */
  liveModeLocked: true;
  globalCutoffConfigured: boolean;
  venues: VenueLoyaltyReadiness[];
  anyVenueLoyaltyEnabled: boolean;
  capsSupported: { daily: true; weekly: true; monthly: true; lifetime: true };
  campaignBudgetSupported: true;
  activeRewardRulesCount: number;
  activeCampaignsCount: number;
}

export async function getActivationReadinessSnapshot(db?: DbHandle): Promise<ActivationReadinessSnapshot> {
  const conn = db ?? (await getDb());

  const rows = await conn.select({
    venueId: venueIntegrations.venueId,
    venueName: venues.name,
    syncEnabled: venueIntegrations.syncEnabled,
    loyaltyEnabled: venueIntegrations.loyaltyEnabled,
    loyaltyCutoffOverrideAt: venueIntegrations.loyaltyCutoffOverrideAt,
  }).from(venueIntegrations).innerJoin(venues, eq(venues.id, venueIntegrations.venueId));

  const globalCutoffValue = await getSystemSetting(LOYALTY_GLOBAL_CUTOFF_SETTING_KEY, "");

  const [[rulesCount], [campaignsCount]] = await Promise.all([
    conn.select({ id: tokenRules.id }).from(tokenRules).where(eq(tokenRules.active, true)),
    conn.select({ id: tokenCampaigns.id }).from(tokenCampaigns).where(eq(tokenCampaigns.active, true)),
  ]).then(([r, c]) => [[r.length], [c.length]] as [[number], [number]]);

  const venuesReadiness: VenueLoyaltyReadiness[] = rows.map(r => ({
    venueId: r.venueId,
    venueName: r.venueName,
    syncEnabled: r.syncEnabled,
    loyaltyEnabled: r.loyaltyEnabled,
    cutoffOverrideConfigured: !!r.loyaltyCutoffOverrideAt,
  }));

  return {
    liveModeLocked: true,
    globalCutoffConfigured: !!globalCutoffValue.trim(),
    venues: venuesReadiness,
    anyVenueLoyaltyEnabled: venuesReadiness.some(v => v.loyaltyEnabled),
    capsSupported: { daily: true, weekly: true, monthly: true, lifetime: true },
    campaignBudgetSupported: true,
    activeRewardRulesCount: rulesCount,
    activeCampaignsCount: campaignsCount,
  };
}
