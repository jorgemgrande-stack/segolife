/**
 * integrationScheduler.ts — Fourvenues Production Scheduler (2026-08-13).
 * Mismo criterio que engagementScheduler.ts: tick de node-cron cada minuto
 * (barato, solo lee due-state de BD), NUNCA arranca solo — requiere el
 * feature flag `fourvenues_scheduler_enabled` (DB-backed, vía
 * conditionallyStartJob en server/_core/index.ts, default false — spec
 * "NO default-on"). Genérico por si un futuro provider lo reutiliza, pero
 * hoy solo actúa sobre filas cuyo provider real es "fourvenues_integrations"
 * (spec §93 — activar el switch global nunca debe arrancar Weezevent u
 * otro provider por accidente).
 *
 * DOS CADENCIAS (spec §15-23):
 *  - INCREMENTAL: frecuente, ventana estrecha (pasado reciente + futuro
 *    cercano) — captura operaciones nuevas/recientes sin recorrer el
 *    histórico. Debida según `venue_integrations.sync_interval_minutes`
 *    (columna ya existente, antes sin usar) medido desde `lastSuccessAt`.
 *  - RECONCILIATION: menos frecuente, ventana más amplia hacia atrás —
 *    corrige attendance/refunds que llegaron tarde. Debida según su propio
 *    intervalo, medido desde el último run EXITOSO con metadata.mode=
 *    "reconciliation" (integration_sync_runs.metadata — nunca se reutiliza
 *    lastSuccessAt para esto, o el reloj de reconciliation se resetearía
 *    en cada incremental y nunca llegaría a dispararse).
 *
 * "ONE SYNC PATH" (spec §39): este scheduler NUNCA reimplementa la
 * ingestión — llama a syncVenueIntegration(), el MISMO punto de entrada que
 * usa el botón manual "Sync Now" (routers/integrations.ts) — incluido el
 * lock (tryAcquireSyncLock) y la supresión de loyalty (resolveSuppressLoyalty).
 */
import cron, { type ScheduledTask } from "node-cron";
import { listProviders, listVenueIntegrations, getVenueIntegrationRaw, isDueForScheduledSync, getLastSuccessfulModeRunAt } from "./integrationsDb";
import { isExternalIntegrationsGloballyEnabled, canSync, syncVenueIntegration } from "./integrationSyncService";

// Propuesta de cadencia productiva (spec §99/§114) — ver informe final para
// la justificación completa con evidencia real. Solo se usan como FALLBACK
// cuando `venue_integrations.sync_interval_minutes` es null — el valor por
// fila siempre gana (spec §13, nunca hardcodear la cadencia real en código).
export const DEFAULT_INCREMENTAL_INTERVAL_MINUTES = 10;
export const RECONCILIATION_INTERVAL_MINUTES = 360; // 6h
export const INCREMENTAL_PAST_DAYS = 2;
export const INCREMENTAL_FUTURE_DAYS = 14;
export const RECONCILIATION_PAST_DAYS = 7;
export const RECONCILIATION_FUTURE_DAYS = 14;

async function runScheduled(venueIntegrationId: number, mode: "incremental" | "reconciliation", pastDays: number, futureDays: number): Promise<void> {
  try {
    const result = await syncVenueIntegration(venueIntegrationId, {
      historyFromDays: pastDays, futureUntilDays: futureDays,
      trigger: "scheduler", mode,
    });
    console.log(
      `[FourvenuesScheduler] mode=${mode} venueIntegrationId=${venueIntegrationId} status=${result.status} ` +
      `events=${result.eventsFound} orders=+${result.ordersCreated}/${result.ordersUpdated} ` +
      `tickets=${result.ticketsWithOrder}w/${result.ticketsWithoutOrder}wo paymentless=+${result.paymentlessCreated} ` +
      `attendance=${result.attendanceProcessed}/${result.attendanceUnresolved} failed=${result.failedCount}`
    );
  } catch (err) {
    console.error(`[FourvenuesScheduler] mode=${mode} venueIntegrationId=${venueIntegrationId} falló:`, err instanceof Error ? err.message : err);
  }
}

/** Exportado solo para tests (spec §54-57) — nunca se llama directamente fuera de este módulo/startFourvenuesScheduler. */
export async function tick(): Promise<void> {
  // Kill switch global — spec §55: 0 llamadas si no está en "true". Se
  // comprueba aquí TAMBIÉN (no solo dentro de syncVenueIntegration/canSync)
  // para no hacer ni siquiera las queries de listado en una BD nueva/con el
  // switch apagado.
  if (!isExternalIntegrationsGloballyEnabled()) return;

  const providers = await listProviders();
  const fourvenuesProviderId = providers.find(p => p.key === "fourvenues_integrations")?.id;
  if (fourvenuesProviderId == null) return;

  const integrations = await listVenueIntegrations();
  for (const safe of integrations) {
    // Fourvenues only (spec §93) — activar el switch global nunca debe
    // arrancar Weezevent u otro provider por accidente; este scheduler
    // ignora en silencio cualquier fila que no sea de este provider.
    if (safe.providerId !== fourvenuesProviderId) continue;

    const raw = await getVenueIntegrationRaw(safe.id);
    // canSync() cubre las 4 condiciones ya existentes — Tía Felisa/
    // Limoncello (enabled=0/syncEnabled=0) nunca pasan de aquí, sin
    // necesidad de un caso especial por nombre de venue (spec §11/§54).
    if (!raw || !canSync(raw)) continue;

    const now = new Date();
    if (isDueForScheduledSync(raw, now, DEFAULT_INCREMENTAL_INTERVAL_MINUTES)) {
      await runScheduled(raw.id, "incremental", INCREMENTAL_PAST_DAYS, INCREMENTAL_FUTURE_DAYS);
    }

    const lastReconciliation = await getLastSuccessfulModeRunAt("venue_integration", raw.id, "reconciliation");
    const reconciliationDue = !lastReconciliation || (now.getTime() - lastReconciliation.getTime()) >= RECONCILIATION_INTERVAL_MINUTES * 60_000;
    if (reconciliationDue) {
      await runScheduled(raw.id, "reconciliation", RECONCILIATION_PAST_DAYS, RECONCILIATION_FUTURE_DAYS);
    }
  }
}

let task: ScheduledTask | null = null;

export function isFourvenuesSchedulerRunning(): boolean {
  return task !== null;
}

/** Se llama SOLO desde server/_core/index.ts vía conditionallyStartJob("fourvenues_scheduler_enabled", ...) — nunca directamente. */
export function startFourvenuesScheduler(): void {
  if (task) return;
  task = cron.schedule("* * * * *", () => {
    tick().catch(err => console.error("[FourvenuesScheduler] tick falló:", err));
  });
  console.log("[FourvenuesScheduler] Iniciado (tick cada minuto, due-check por integración) — fourvenues_scheduler_enabled=true");
}

export function stopFourvenuesScheduler(): void {
  task?.stop();
  task = null;
}
