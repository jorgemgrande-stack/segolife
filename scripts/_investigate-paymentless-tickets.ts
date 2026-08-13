/**
 * _investigate-paymentless-tickets.ts — SOLO LECTURA (spec Fase 1, Paymentless
 * Tickets & Admissions Hardening). Reproduce el gap 929 raw / 741 persistidos
 * en la ventana oficial de Casanova (junio 2026) y clasifica el subconjunto
 * SIN externalOrderId (payment_id ausente en el DTO real) por: status,
 * price=0/>0, asistencia real (vía listAttendance), y disponibilidad de
 * identidad (solo presencia de campo, nunca valores en claro).
 *
 * PII: nunca imprime email/teléfono/nombre completos — solo enmascarados o
 * como booleano de presencia.
 *
 * Uso (Railway Console, servicio segolife):
 *   npx tsx scripts/_investigate-paymentless-tickets.ts <venueIntegrationId> [historyFromDays] [futureUntilDays]
 */
import { getVenueIntegrationRaw, getProviderById } from "../server/segolife/integrations/integrationsDb";
import { decryptCredentials } from "../server/segolife/integrations/integrationCredentialCrypto";
import { createFourvenuesIntegrationsAdapter, FOURVENUES_INTEGRATIONS_BASE_URL } from "../server/segolife/integrations/fourvenuesIntegrationsAdapter";
import { createHttpTransport } from "../server/segolife/integrations/httpTransport";
import type { NormalizedTicket } from "../server/segolife/integrations/externalTicketingProvider";

function maskEmail(e: string | null | undefined): string {
  if (!e) return "(sin email)";
  const [user, domain] = e.split("@");
  if (!domain) return "***";
  return `${user[0] ?? "*"}***@${domain}`;
}
function maskPhone(p: string | null | undefined): string {
  if (!p) return "(sin teléfono)";
  return `***${p.slice(-4)}`;
}

async function main() {
  const id = Number(process.argv[2]);
  const historyFromDays = Number(process.argv[3] ?? 65);
  const futureUntilDays = Number(process.argv[4] ?? 5);
  if (!id) {
    console.error("Uso: npx tsx scripts/_investigate-paymentless-tickets.ts <venueIntegrationId> [historyFromDays] [futureUntilDays]");
    process.exit(1);
  }

  const integration = await getVenueIntegrationRaw(id);
  if (!integration) { console.error("Integración no encontrada"); process.exit(1); }
  const provider = await getProviderById(integration.providerId);
  if (provider?.key !== "fourvenues_integrations") { console.error("Provider no soportado:", provider?.key); process.exit(1); }
  const credentials = decryptCredentials(integration.credentialsEncrypted!);
  if (!credentials) { console.error("No se pudieron descifrar las credenciales"); process.exit(1); }

  console.log(`Investigando gap de tickets sin order — venue_integration #${id} — ventana: ${historyFromDays}d atrás / ${futureUntilDays}d adelante\n`);

  const adapter = createFourvenuesIntegrationsAdapter(
    createHttpTransport(FOURVENUES_INTEGRATIONS_BASE_URL[integration.environment]),
    undefined,
    { historyFromDays, futureUntilDays }
  );

  const events = await adapter.listEvents(credentials);
  console.log(`Eventos encontrados en la ventana: ${events.length}\n`);

  let rawTotal = 0;
  let withOrderTotal = 0;
  let withoutOrderTotal = 0;
  const withoutOrder: Array<NormalizedTicket & { attended: boolean; eventName: string }> = [];
  const withOrderByStatus: Record<string, number> = {};

  for (const ev of events) {
    const [tickets, attendance] = await Promise.all([
      adapter.listTickets(credentials, ev.externalId),
      adapter.listAttendance(credentials, ev.externalId),
    ]);
    if (tickets.length === 0) continue;

    const attendedIds = new Set(attendance.map(a => a.externalTicketId).filter(Boolean));

    rawTotal += tickets.length;
    for (const t of tickets) {
      if (t.externalOrderId) {
        withOrderTotal++;
        withOrderByStatus[t.status] = (withOrderByStatus[t.status] ?? 0) + 1;
      } else {
        withoutOrderTotal++;
        withoutOrder.push({ ...t, attended: attendedIds.has(t.externalId), eventName: ev.name });
      }
    }
    console.log(`--- ${ev.name.slice(0, 60)} (${ev.startsAt.toISOString().slice(0, 10)}) --- tickets=${tickets.length}`);
  }

  console.log(`\n=== TOTALES RAW ===`);
  console.log(`rawTickets=${rawTotal} withOrder=${withOrderTotal} withoutOrder=${withoutOrderTotal}`);
  console.log(`Suma verificación: ${withOrderTotal + withoutOrderTotal} (debe = ${rawTotal})`);

  console.log(`\n=== withOrder — por status ===`);
  console.log(JSON.stringify(withOrderByStatus, null, 2));

  console.log(`\n=== withoutOrder (${withoutOrderTotal}) — clasificación ===`);
  const byStatus: Record<string, number> = {};
  let priceZero = 0, pricePositive = 0;
  let attended = 0, notAttended = 0;
  let hasEmail = 0, hasPhone = 0, hasName = 0, hasAnyIdentity = 0;
  const priceHistogram: Record<string, number> = {};
  let sumAmountCents = 0;
  for (const t of withoutOrder) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const amount = t.amountPaidCents ?? 0;
    if (amount === 0) priceZero++; else pricePositive++;
    sumAmountCents += amount;
    const key = (amount / 100).toFixed(2) + "€";
    priceHistogram[key] = (priceHistogram[key] ?? 0) + 1;
    if (t.attended) attended++; else notAttended++;
    if (t.participant.email) hasEmail++;
    if (t.participant.phone) hasPhone++;
    if (t.participant.name) hasName++;
    if (t.participant.email || t.participant.phone || t.participant.name) hasAnyIdentity++;
  }
  console.log(`por status: ${JSON.stringify(byStatus)}`);
  console.log(`price histogram: ${JSON.stringify(priceHistogram)}`);
  console.log(`sum amountPaidCents: ${sumAmountCents} (${(sumAmountCents / 100).toFixed(2)}€)`);
  console.log(`price=0: ${priceZero} | price>0: ${pricePositive}`);
  console.log(`attended: ${attended} | not attended: ${notAttended}`);
  console.log(`identity — email: ${hasEmail}/${withoutOrderTotal} | phone: ${hasPhone}/${withoutOrderTotal} | name: ${hasName}/${withoutOrderTotal} | any: ${hasAnyIdentity}/${withoutOrderTotal}`);

  console.log(`\n=== withoutOrder — por evento ===`);
  const byEvent: Record<string, number> = {};
  for (const t of withoutOrder) byEvent[t.eventName] = (byEvent[t.eventName] ?? 0) + 1;
  console.log(JSON.stringify(byEvent, null, 2));

  console.log(`\n=== withoutOrder — 5 ejemplos saneados ===`);
  for (const t of withoutOrder.slice(0, 5)) {
    console.log(JSON.stringify({
      eventName: t.eventName,
      status: t.status,
      amountPaidCents: t.amountPaidCents,
      feesCents: t.feesCents,
      attended: t.attended,
      email: maskEmail(t.participant.email),
      phone: maskPhone(t.participant.phone),
      hasName: Boolean(t.participant.name),
      purchasedAt: t.purchasedAt,
    }));
  }

  process.exit(0);
}

main().catch(err => { console.error("Investigación falló:", err instanceof Error ? err.message : err); process.exit(1); });
