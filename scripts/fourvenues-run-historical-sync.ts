/**
 * fourvenues-run-historical-sync.ts — SYNC REAL de escritura de una ventana
 * HISTÓRICA (spec §21-22): igual que fourvenues-run-sync.ts pero con
 * `historicalImport: true` — persiste events/rates/orders/tickets/
 * attendance/mappings/unresolved con normalidad, pero SUPRIME
 * incondicionalmente earnTokens/evaluateBenefitsForOrigin en cada
 * ingestTicketPurchase/ingestAttendance de este run (ver
 * integrationSyncService.ts, VenueSyncOptions.historicalImport).
 *
 * Uso (Railway Console, servicio segolife):
 *   npx tsx scripts/fourvenues-run-historical-sync.ts <venueIntegrationId> [historyFromDays] [futureUntilDays]
 */
import { setVenueIntegrationEnabled, getVenueIntegrationRaw } from "../server/segolife/integrations/integrationsDb";
import { syncVenueIntegration } from "../server/segolife/integrations/integrationSyncService";

async function main() {
  const id = Number(process.argv[2]);
  const historyFromDays = Number(process.argv[3] ?? 400);
  const futureUntilDays = Number(process.argv[4] ?? 5);
  if (!id) {
    console.error("Uso: npx tsx scripts/fourvenues-run-historical-sync.ts <venueIntegrationId> [historyFromDays] [futureUntilDays]");
    process.exit(1);
  }

  const before = await getVenueIntegrationRaw(id);
  if (!before) { console.error("Integración no encontrada:", id); process.exit(1); }
  if (!before.enabled || !before.syncEnabled) {
    console.log(`Activando enabled+syncEnabled para integración #${id}...`);
    await setVenueIntegrationEnabled(id, true);
  }

  console.log(`Ejecutando syncVenueIntegration(${id}) HISTÓRICO — ventana ${historyFromDays}/${futureUntilDays} días, historicalImport=true (loyalty suprimido incondicionalmente)...`);
  const result = await syncVenueIntegration(id, { historyFromDays, futureUntilDays, historicalImport: true });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch(err => { console.error("Sync histórico falló:", err instanceof Error ? err.message : err); process.exit(1); });
