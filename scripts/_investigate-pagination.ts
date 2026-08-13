/**
 * _investigate-pagination.ts — investigación READ-ONLY del contrato real de
 * paginación de Fourvenues Integrations API (spec §7-12, §25-26). Temporal
 * — se borra tras el diagnóstico.
 *
 * HALLAZGO YA CONFIRMADO en /tickets/: offset/limit funcionan, page size
 * máximo real = 500 (limit=1000 → 400), termina cuando data.length < limit
 * (o vacío), sin metadata de total en el body. "PRE OPENING X HOUSEMAF"
 * tiene 600 tickets reales, no 500 — CONFIRMA truncation en la versión
 * anterior del adapter. Esta pasada confirma /events/ y /tickets-rates/.
 */
import { getVenueIntegrationRaw } from "../server/segolife/integrations/integrationsDb";
import { decryptCredentials } from "../server/segolife/integrations/integrationCredentialCrypto";
import { FOURVENUES_INTEGRATIONS_BASE_URL } from "../server/segolife/integrations/fourvenuesIntegrationsAdapter";

async function main() {
  const integration = await getVenueIntegrationRaw(1);
  if (!integration) { console.error("Integración no encontrada"); process.exit(1); }
  const credentials = decryptCredentials(integration.credentialsEncrypted!);
  if (!credentials) { console.error("Sin credenciales"); process.exit(1); }
  const baseUrl = FOURVENUES_INTEGRATIONS_BASE_URL[integration.environment];
  const apiKey = credentials.apiKey ?? "";

  console.log("=== /events/ — ventana amplia (400 días) ===");
  const now = new Date();
  const start = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const end = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const evUrl = `${baseUrl}/events/?start=${start}&end=${end}`;
  const evRes = await fetch(evUrl, { headers: { "X-Api-Key": apiKey } });
  const evBody = await evRes.json() as { data?: unknown[] };
  console.log("status:", evRes.status, "| data.length:", (evBody.data ?? []).length, "(sabemos por exploración previa que el total real es 88 — si data.length < 88, hay truncation)");

  console.log("\n=== /events/ con offset explícito (¿acepta el mismo mecanismo?) ===");
  const evRes2 = await fetch(`${evUrl}&offset=50&limit=500`, { headers: { "X-Api-Key": apiKey } });
  const evBody2 = await evRes2.json() as { data?: unknown[] };
  console.log("status:", evRes2.status, "| data.length:", (evBody2.data ?? []).length);

  // Evento real con más tarifas conocidas (Casanova, cualquiera de la ventana histórica).
  const target = (evBody.data as Array<{ _id: string; name: string }> ?? [])[0];
  if (target) {
    console.log("\n=== /tickets-rates/ para un evento real (" + target.name + ") ===");
    const rUrl = `${baseUrl}/tickets-rates/?event_id=${target._id}`;
    const rRes = await fetch(rUrl, { headers: { "X-Api-Key": apiKey } });
    const rBody = await rRes.json() as { data?: unknown[] };
    console.log("status:", rRes.status, "| data.length:", (rBody.data ?? []).length);
    const rRes2 = await fetch(`${rUrl}&offset=5&limit=500`, { headers: { "X-Api-Key": apiKey } });
    const rBody2 = await rRes2.json() as { data?: unknown[] };
    console.log("¿acepta offset/limit?", rRes2.status, "| data.length con offset=5:", (rBody2.data ?? []).length);
  }
}

main().catch(err => { console.error("Investigación falló:", err instanceof Error ? err.message : err); process.exit(1); });
