/**
 * fourvenues-run-dry-run.ts — ejecuta dryRunVenueIntegration() contra una
 * integración real (spec §83: "First live read"). Llama a Fourvenues en modo
 * SOLO LECTURA, sin persistir ningún dato de negocio. Imprime únicamente
 * counts — nunca nombres/emails/teléfonos reales.
 *
 * Uso (Railway Console, servicio segolife):
 *   npx tsx scripts/fourvenues-run-dry-run.ts <venueIntegrationId> [historyFromDays] [futureUntilDays]
 */
import { dryRunVenueIntegration } from "../server/segolife/integrations/integrationSyncService";

async function main() {
  const id = Number(process.argv[2]);
  const historyFromDays = Number(process.argv[3] ?? 30);
  const futureUntilDays = Number(process.argv[4] ?? 90);
  if (!id) {
    console.error("Uso: npx tsx scripts/fourvenues-run-dry-run.ts <venueIntegrationId> [historyFromDays] [futureUntilDays]");
    process.exit(1);
  }
  const result = await dryRunVenueIntegration(id, { historyFromDays, futureUntilDays });
  console.log(JSON.stringify({
    status: result.status,
    message: result.message,
    venueId: result.venueId,
    eventsFound: result.eventsFound,
    mappedEvents: result.mappedEvents,
    newEvents: result.newEvents,
    ratesFound: result.ratesFound,
    ordersFound: result.ordersFound,
    ticketsFound: result.ticketsFound,
    attendanceFound: result.attendanceFound,
    identitiesResolvable: result.identitiesResolvable,
    identitiesUnresolved: result.identitiesUnresolved,
    events: result.events.map(e => ({ name: e.name.slice(0, 60), alreadyMapped: e.alreadyMapped })), // nombre de evento (marketing público), nunca datos de asistentes
  }, null, 2));
  process.exit(0);
}

main().catch(err => { console.error("Dry run falló:", err instanceof Error ? err.message : err); process.exit(1); });
