import { getVenueIntegrationRaw, getProviderById } from "../server/segolife/integrations/integrationsDb";
import { decryptCredentials } from "../server/segolife/integrations/integrationCredentialCrypto";
import { createFourvenuesIntegrationsAdapter, FOURVENUES_INTEGRATIONS_BASE_URL } from "../server/segolife/integrations/fourvenuesIntegrationsAdapter";
import { createHttpTransport } from "../server/segolife/integrations/httpTransport";

async function main() {
  const id = Number(process.argv[2]);
  const historyFromDays = Number(process.argv[3] ?? 65);
  const futureUntilDays = Number(process.argv[4] ?? 5);
  const integration = await getVenueIntegrationRaw(id);
  if (!integration) { console.error("no encontrada"); process.exit(1); }
  const provider = await getProviderById(integration.providerId);
  if (provider?.key !== "fourvenues_integrations") { console.error("provider no soportado"); process.exit(1); }
  const credentials = decryptCredentials(integration.credentialsEncrypted!);
  if (!credentials) { console.error("sin credenciales"); process.exit(1); }

  const adapter = createFourvenuesIntegrationsAdapter(
    createHttpTransport(FOURVENUES_INTEGRATIONS_BASE_URL[integration.environment]),
    undefined,
    { historyFromDays, futureUntilDays }
  );
  const events = await adapter.listEvents(credentials);

  let totalTickets = 0, withPaymentId = 0, withoutPaymentId = 0;
  const statusOfMissing: Record<string, number> = {};
  for (const ev of events) {
    const tickets = await adapter.listTickets(credentials, ev.externalId);
    for (const t of tickets) {
      totalTickets++;
      if (t.externalOrderId) withPaymentId++;
      else {
        withoutPaymentId++;
        statusOfMissing[t.status] = (statusOfMissing[t.status] ?? 0) + 1;
      }
    }
  }
  console.log(JSON.stringify({ totalTickets, withPaymentId, withoutPaymentId, statusOfMissing }, null, 2));
}

main().catch(err => { console.error("falló:", err instanceof Error ? err.message : err); process.exit(1); });
