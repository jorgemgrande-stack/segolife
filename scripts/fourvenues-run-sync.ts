/**
 * fourvenues-run-sync.ts — ejecuta el SYNC REAL de escritura para una
 * integración concreta (spec §85: "First write sync"). Antes de sincronizar,
 * activa `enabled`/`syncEnabled` en esa fila si no lo estaban ya — mismo
 * efecto que pulsar "Enabled" en /admin/integrations. NO activa el kill
 * switch global (`EXTERNAL_INTEGRATIONS_ENABLED`) — eso se gestiona aparte.
 *
 * Uso (Railway Console, servicio segolife):
 *   npx tsx scripts/fourvenues-run-sync.ts <venueIntegrationId>
 */
import { setVenueIntegrationEnabled, getVenueIntegrationRaw } from "../server/segolife/integrations/integrationsDb";
import { syncVenueIntegration } from "../server/segolife/integrations/integrationSyncService";

async function main() {
  const id = Number(process.argv[2]);
  if (!id) {
    console.error("Uso: npx tsx scripts/fourvenues-run-sync.ts <venueIntegrationId>");
    process.exit(1);
  }

  const before = await getVenueIntegrationRaw(id);
  if (!before) { console.error("Integración no encontrada:", id); process.exit(1); }
  if (!before.enabled || !before.syncEnabled) {
    console.log(`Activando enabled+syncEnabled para integración #${id}...`);
    await setVenueIntegrationEnabled(id, true);
  }

  console.log(`Ejecutando syncVenueIntegration(${id})...`);
  const result = await syncVenueIntegration(id, { historyFromDays: 30, futureUntilDays: 90 });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch(err => { console.error("Sync falló:", err instanceof Error ? err.message : err); process.exit(1); });
