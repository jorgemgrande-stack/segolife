/**
 * _investigate-pagination.ts — investigación READ-ONLY del contrato real de
 * paginación de Fourvenues Integrations API (spec §7-12). Hace fetch RAW
 * (sin pasar por el adapter, que solo tipa `.data`) para ver TODOS los
 * campos de la respuesta real, y prueba varios parámetros de paginación
 * candidatos. Temporal — se borra tras el diagnóstico.
 *
 * HALLAZGO YA CONFIRMADO en la 1ª pasada: sin params → exactamente 500
 * (`{success,data}`, sin metadata de paginación en body ni headers);
 * `page=2` → 400 (no reconocido); `offset=500` → 200 con 100 registros
 * MÁS (nunca vistos en la primera página) → CONFIRMA offset-based
 * pagination con page size fijo de 500. Esta pasada confirma dónde termina
 * y si `limit` es controlable explícitamente.
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

  const evRes = await fetch(`${baseUrl}/events/?start=2025-09-01&end=2025-09-05`, { headers: { "X-Api-Key": apiKey } });
  const evBody = await evRes.json() as { data?: Array<{ _id: string; name: string }> };
  const target = (evBody.data ?? []).find(e => /HOUSEMAF/i.test(e.name));
  if (!target) { console.error("Evento objetivo no encontrado"); process.exit(1); }
  console.log("Evento objetivo:", target.name, target._id);

  const base = `${baseUrl}/tickets/?event_id=${target._id}`;

  console.log("\n--- offset=600 (¿termina en 600 o hay más?) ---");
  const r600 = await fetch(`${base}&offset=600`, { headers: { "X-Api-Key": apiKey } });
  const b600 = await r600.json() as { data?: unknown[] };
  console.log("status:", r600.status, "| data.length:", (b600.data ?? []).length);

  console.log("\n--- offset=700 ---");
  const r700 = await fetch(`${base}&offset=700`, { headers: { "X-Api-Key": apiKey } });
  const b700 = await r700.json() as { data?: unknown[] };
  console.log("status:", r700.status, "| data.length:", (b700.data ?? []).length);

  console.log("\n--- limit=50 explícito (¿controla el tamaño de página?) ---");
  const rLimit = await fetch(`${base}&limit=50`, { headers: { "X-Api-Key": apiKey } });
  const bLimit = await rLimit.json() as { data?: unknown[] };
  console.log("status:", rLimit.status, "| data.length:", (bLimit.data ?? []).length);

  console.log("\n--- limit=1000 explícito (¿permite pedir más de 500 de golpe?) ---");
  const rLimit2 = await fetch(`${base}&limit=1000`, { headers: { "X-Api-Key": apiKey } });
  const bLimit2 = await rLimit2.json() as { data?: unknown[] };
  console.log("status:", rLimit2.status, "| data.length:", (bLimit2.data ?? []).length);

  console.log("\n--- offset=500&limit=500 explícito (segunda página con limit fijado) ---");
  const rComb = await fetch(`${base}&offset=500&limit=500`, { headers: { "X-Api-Key": apiKey } });
  const bComb = await rComb.json() as { data?: unknown[] };
  console.log("status:", rComb.status, "| data.length:", (bComb.data ?? []).length);

  // Verificación cruzada: contar IDs únicos entre page1(0-500) + page2(500-600) para confirmar 0 solapes/duplicados.
  const r1 = await fetch(base, { headers: { "X-Api-Key": apiKey } });
  const b1 = await r1.json() as { data?: Array<{ _id: string }> };
  const r2 = await fetch(`${base}&offset=500`, { headers: { "X-Api-Key": apiKey } });
  const b2 = await r2.json() as { data?: Array<{ _id: string }> };
  const ids1 = new Set((b1.data ?? []).map(t => t._id));
  const ids2 = (b2.data ?? []).map(t => t._id);
  const overlap = ids2.filter(id => ids1.has(id));
  console.log("\n--- Verificación de solape entre página 1 (0-500) y página 2 (offset=500) ---");
  console.log("IDs únicos página 1:", ids1.size, "| IDs página 2:", ids2.length, "| solapados:", overlap.length);
  console.log("TOTAL REAL (sin duplicados):", ids1.size + ids2.length - overlap.length);
}

main().catch(err => { console.error("Investigación falló:", err instanceof Error ? err.message : err); process.exit(1); });
