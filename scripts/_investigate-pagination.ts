/**
 * _investigate-pagination.ts — investigación READ-ONLY del contrato real de
 * paginación de Fourvenues Integrations API (spec §7-12). Hace fetch RAW
 * (sin pasar por el adapter, que solo tipa `.data`) para ver TODOS los
 * campos de la respuesta real, y prueba varios parámetros de paginación
 * candidatos (page/offset/skip) para ver si el endpoint los acepta.
 * Temporal — se borra tras el diagnóstico.
 */
import { getVenueIntegrationRaw } from "../server/segolife/integrations/integrationsDb";
import { decryptCredentials } from "../server/segolife/integrations/integrationCredentialCrypto";
import { FOURVENUES_INTEGRATIONS_BASE_URL } from "../server/segolife/integrations/fourvenuesIntegrationsAdapter";

function maskEmail(e: string | null | undefined): string | null {
  if (!e) return null;
  const [u, d] = e.split("@");
  return d ? `${u[0] ?? "*"}***@${d}` : "***";
}

async function main() {
  const integration = await getVenueIntegrationRaw(1);
  if (!integration) { console.error("Integración no encontrada"); process.exit(1); }
  const credentials = decryptCredentials(integration.credentialsEncrypted!);
  if (!credentials) { console.error("Sin credenciales"); process.exit(1); }
  const baseUrl = FOURVENUES_INTEGRATIONS_BASE_URL[integration.environment];
  const apiKey = credentials.apiKey ?? "";

  // Buscamos un evento real que en la exploración anterior devolvió exactamente 500 tickets (2025-09-04, "PRE OPENING X HOUSEMAF").
  const evRes = await fetch(`${baseUrl}/events/?start=2025-09-01&end=2025-09-05`, { headers: { "X-Api-Key": apiKey } });
  const evBody = await evRes.json() as { data?: Array<{ _id: string; name: string }> };
  console.log("EVENTS response top-level keys:", Object.keys(evBody));
  const target = (evBody.data ?? []).find(e => /HOUSEMAF/i.test(e.name));
  if (!target) {
    console.log("No encontrado en esa ventana exacta. Eventos vistos:", JSON.stringify((evBody.data ?? []).map(e => ({ name: e.name, _id: e._id }))));
    process.exit(1);
  }
  console.log("Evento objetivo:", target.name, target._id);

  const url1 = `${baseUrl}/tickets/?event_id=${target._id}`;
  const res1 = await fetch(url1, { headers: { "X-Api-Key": apiKey } });
  console.log("\n--- PRIMERA LLAMADA (sin params de paginación) ---");
  console.log("HTTP status:", res1.status);
  const headerEntries = Array.from(res1.headers.entries()).filter(([k]) => /page|limit|total|count|link|next|cursor/i.test(k));
  console.log("Headers relevantes:", JSON.stringify(Object.fromEntries(headerEntries)));
  const body1 = await res1.json() as Record<string, unknown>;
  console.log("Body top-level keys:", Object.keys(body1));
  const data1 = (body1.data as unknown[]) ?? [];
  console.log("data.length:", data1.length);
  const { data: _omit, ...metaFields } = body1;
  console.log("Campos fuera de 'data' (posible metadata de paginación):", JSON.stringify(metaFields));
  const typedData1 = data1 as Array<{ _id: string; email?: string; created_at?: string }>;
  if (typedData1.length) {
    console.log("Primer ticket (saneado):", JSON.stringify({ _id: typedData1[0]._id, email: maskEmail(typedData1[0].email), created_at: typedData1[0].created_at }));
    console.log("Último ticket de esta página (saneado):", JSON.stringify({ _id: typedData1[typedData1.length - 1]._id, created_at: typedData1[typedData1.length - 1].created_at }));
  }

  console.log("\n--- SEGUNDA LLAMADA (probando page=2) ---");
  const res2 = await fetch(`${url1}&page=2`, { headers: { "X-Api-Key": apiKey } });
  const body2 = await res2.json() as { data?: Array<{ _id: string }> };
  console.log("HTTP status:", res2.status, "| data.length:", (body2.data ?? []).length);
  if (body2.data?.length && typedData1.length) {
    console.log("¿Primer ticket de page=2 distinto del primero de page=1?", body2.data[0]._id !== typedData1[0]._id);
  }

  console.log("\n--- TERCERA LLAMADA (probando offset=500) ---");
  const res3 = await fetch(`${url1}&offset=500`, { headers: { "X-Api-Key": apiKey } });
  const body3 = await res3.json() as { data?: unknown[] };
  console.log("HTTP status:", res3.status, "| data.length:", (body3.data ?? []).length);

  console.log("\n--- CUARTA LLAMADA (probando skip=500) ---");
  const res4 = await fetch(`${url1}&skip=500`, { headers: { "X-Api-Key": apiKey } });
  const body4 = await res4.json() as { data?: unknown[] };
  console.log("HTTP status:", res4.status, "| data.length:", (body4.data ?? []).length);
}

main().catch(err => { console.error("Investigación falló:", err instanceof Error ? err.message : err); process.exit(1); });
