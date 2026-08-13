/**
 * loyaltyCutoffService.ts — SEGOLIFE LOYALTY PRODUCTION HARDENING (spec §8).
 * Corte de loyalty PERSISTENTE — precedencia: override de venue > corte
 * global > sin corte. Reutiliza infraestructura ya existente (REUSE FIRST):
 *
 *  - Global: `system_settings` (key="loyalty_global_cutoff_at") — tabla
 *    genérica ya real, con CRUD admin (`configRouter.ts`,
 *    `settingsManageProc`) y audit log (`config_change_logs`) YA
 *    construidos. Ninguna tabla nueva para el corte global.
 *  - Override por venue: `venue_integrations.loyalty_cutoff_override_at`
 *    (columna nueva, ver drizzle/schema.ts) — coherente con
 *    `loyalty_enabled`, que ya vive en esa misma fila por-integración.
 *
 * Ambos quedan NULL tras esta fase (spec: "NO configures todavía ninguna
 * fecha real") — `resolveLoyaltyCutoff` devuelve `null` (sin corte) hasta
 * que un admin configure alguno explícitamente.
 */
import { eq } from "drizzle-orm";
import { systemSettings, venueIntegrations } from "../../../drizzle/schema";
import type { AnyDbHandle } from "./tokenLedgerService";

export const LOYALTY_GLOBAL_CUTOFF_SETTING_KEY = "loyalty_global_cutoff_at";

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value || !value.trim()) return null;
  const parsed = new Date(value.trim());
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Resuelve el corte efectivo para una integración concreta (identificada
 * por `venue_integrations.id`, no por `venueId` — una misma venue podría
 * tener más de una fila de integración por proveedor, y el llamador ya
 * conoce el id exacto de la suya vía `input.integrationId`, evitando
 * cualquier ambigüedad). `integrationId=null` (p.ej. origin="consumption"
 * del POS nativo, sin integración externa) resuelve directamente al corte
 * global.
 */
export async function resolveLoyaltyCutoff(integrationId: number | null | undefined, db: AnyDbHandle): Promise<Date | null> {
  if (integrationId != null) {
    const [row] = await db.select({ loyaltyCutoffOverrideAt: venueIntegrations.loyaltyCutoffOverrideAt })
      .from(venueIntegrations).where(eq(venueIntegrations.id, integrationId)).limit(1);
    if (row?.loyaltyCutoffOverrideAt) return row.loyaltyCutoffOverrideAt;
  }
  const [setting] = await db.select({ value: systemSettings.value }).from(systemSettings)
    .where(eq(systemSettings.key, LOYALTY_GLOBAL_CUTOFF_SETTING_KEY)).limit(1);
  return parseIsoDate(setting?.value);
}

export function isBeforeCutoff(at: Date, cutoff: Date | null): boolean {
  return cutoff != null && at < cutoff;
}
