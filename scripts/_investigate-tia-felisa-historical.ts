/**
 * _investigate-tia-felisa-historical.ts — SOLO LECTURA (Tía Felisa rollout,
 * spec §14-28). Reconciliación completa del histórico real de Tía Felisa
 * contra Fourvenues: with-order vs paymentless, identidad (agregada, sin
 * PII), repeated buyers, y resolución real contra usuarios Segolife vía
 * resolveIdentity() (sin persistir nada — mismo criterio que dryRunVenueIntegration).
 *
 * NUNCA escribe en Segolife. NUNCA imprime PII (solo agregados y ejemplos enmascarados).
 *
 * Uso (Railway Console, servicio segolife):
 *   npx tsx scripts/_investigate-tia-felisa-historical.ts <venueIntegrationId> [historyFromDays] [futureUntilDays]
 */
import { getVenueIntegrationRaw, getProviderById } from "../server/segolife/integrations/integrationsDb";
import { decryptCredentials } from "../server/segolife/integrations/integrationCredentialCrypto";
import { createFourvenuesIntegrationsAdapter, FOURVENUES_INTEGRATIONS_BASE_URL } from "../server/segolife/integrations/fourvenuesIntegrationsAdapter";
import { createHttpTransport } from "../server/segolife/integrations/httpTransport";
import { resolveIdentity } from "../server/segolife/integrations/identityResolver";
import type { NormalizedTicket } from "../server/segolife/integrations/externalTicketingProvider";

function maskEmail(e: string | null | undefined): string {
  if (!e) return "(sin email)";
  const [user, domain] = e.split("@");
  if (!domain) return "***";
  return `${user[0] ?? "*"}***@${domain}`;
}

async function main() {
  const id = Number(process.argv[2]);
  const historyFromDays = Number(process.argv[3] ?? 400);
  const futureUntilDays = Number(process.argv[4] ?? 5);
  if (!id) {
    console.error("Uso: npx tsx scripts/_investigate-tia-felisa-historical.ts <venueIntegrationId> [historyFromDays] [futureUntilDays]");
    process.exit(1);
  }

  const integration = await getVenueIntegrationRaw(id);
  if (!integration) { console.error("Integración no encontrada"); process.exit(1); }
  const provider = await getProviderById(integration.providerId);
  if (provider?.key !== "fourvenues_integrations") { console.error("Provider no soportado:", provider?.key); process.exit(1); }
  const credentials = decryptCredentials(integration.credentialsEncrypted!);
  if (!credentials) { console.error("No se pudieron descifrar las credenciales"); process.exit(1); }

  console.log(`Reconciliación histórica venue_integration #${id} — ventana: ${historyFromDays}d atrás / ${futureUntilDays}d adelante\n`);

  const adapter = createFourvenuesIntegrationsAdapter(
    createHttpTransport(FOURVENUES_INTEGRATIONS_BASE_URL[integration.environment]),
    undefined,
    { historyFromDays, futureUntilDays }
  );

  const events = await adapter.listEvents(credentials);
  console.log(`Eventos en la ventana: ${events.length}\n`);

  let rawTickets = 0;
  let withOrderTotal = 0;
  let paymentlessTotal = 0;
  let largestEventTickets = 0;
  let largestEventName = "";
  let largestEventPages = 0;

  const paymentless: Array<NormalizedTicket & { attended: boolean; eventName: string }> = [];
  const withOrderByStatus: Record<string, number> = {};
  let ordersTotal = 0;
  let revenueCentsTotal = 0;
  let attendedTotal = 0;

  // Identidad global — acumulado por identidad normalizada, a través de TODOS los eventos.
  const identityKey = (t: NormalizedTicket): string | null => {
    const email = t.participant.email?.trim().toLowerCase();
    const phone = t.participant.phone?.trim();
    if (email) return `email:${email}`;
    if (phone) return `phone:${phone}`;
    return null;
  };
  const identityOperationCounts = new Map<string, number>();
  const identityHasEmail = new Set<string>();
  const identityHasPhone = new Set<string>();

  for (const ev of events) {
    let tickets: NormalizedTicket[] = [];
    let orders: Awaited<ReturnType<typeof adapter.listOrders>> = [];
    let attendance: Awaited<ReturnType<typeof adapter.listAttendance>> = [];
    try {
      [tickets, orders, attendance] = await Promise.all([
        adapter.listTickets(credentials, ev.externalId),
        adapter.listOrders(credentials, ev.externalId),
        adapter.listAttendance(credentials, ev.externalId),
      ]);
    } catch (err) {
      console.log(`  [ERROR] ${ev.name}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (tickets.length === 0) continue;

    rawTickets += tickets.length;
    ordersTotal += orders.length;
    revenueCentsTotal += orders.reduce((sum, o) => sum + o.totalCents, 0);
    attendedTotal += attendance.length;

    if (tickets.length > largestEventTickets) {
      largestEventTickets = tickets.length;
      largestEventName = ev.name;
      largestEventPages = Math.ceil(tickets.length / 500);
    }

    const attendedIds = new Set(attendance.map(a => a.externalTicketId).filter(Boolean));

    for (const t of tickets) {
      if (t.externalOrderId) {
        withOrderTotal++;
        withOrderByStatus[t.status] = (withOrderByStatus[t.status] ?? 0) + 1;
      } else {
        paymentlessTotal++;
        paymentless.push({ ...t, attended: attendedIds.has(t.externalId), eventName: ev.name });
      }

      const key = identityKey(t);
      if (key) {
        identityOperationCounts.set(key, (identityOperationCounts.get(key) ?? 0) + 1);
        if (t.participant.email) identityHasEmail.add(key);
        if (t.participant.phone) identityHasPhone.add(key);
      }
    }
  }

  console.log(`=== TOTALES RAW ===`);
  console.log(`rawTickets=${rawTickets} withOrder=${withOrderTotal} paymentless=${paymentlessTotal}`);
  console.log(`Suma verificación: ${withOrderTotal + paymentlessTotal} (debe = ${rawTickets})`);
  console.log(`orders=${ordersTotal} attendanceRaw=${attendedTotal} revenue(orders)=${(revenueCentsTotal / 100).toFixed(2)}€`);
  console.log(`Evento más grande: "${largestEventName}" — ${largestEventTickets} tickets (${largestEventPages} página(s) de paginación)`);

  console.log(`\n=== withOrder — por status ===`);
  console.log(JSON.stringify(withOrderByStatus, null, 2));

  console.log(`\n=== paymentless (${paymentlessTotal}) — clasificación ===`);
  const byStatus: Record<string, number> = {};
  let priceZero = 0, pricePositive = 0, attended = 0, notAttended = 0;
  let hasEmail = 0, hasPhone = 0, hasName = 0, hasAnyIdentity = 0;
  let sumAmountCents = 0;
  const priceHistogram: Record<string, number> = {};
  const byEvent: Record<string, number> = {};
  for (const t of paymentless) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const amount = t.amountPaidCents ?? 0;
    if (amount === 0) priceZero++; else pricePositive++;
    sumAmountCents += amount;
    const priceKey = (amount / 100).toFixed(2) + "€";
    priceHistogram[priceKey] = (priceHistogram[priceKey] ?? 0) + 1;
    if (t.attended) attended++; else notAttended++;
    if (t.participant.email) hasEmail++;
    if (t.participant.phone) hasPhone++;
    if (t.participant.name) hasName++;
    if (t.participant.email || t.participant.phone || t.participant.name) hasAnyIdentity++;
    byEvent[t.eventName] = (byEvent[t.eventName] ?? 0) + 1;
  }
  console.log(`por status: ${JSON.stringify(byStatus)}`);
  console.log(`price=0: ${priceZero} | price>0: ${pricePositive} | suma evidencia económica: ${(sumAmountCents / 100).toFixed(2)}€`);
  console.log(`price histogram: ${JSON.stringify(priceHistogram)}`);
  console.log(`attended: ${attended} | not attended: ${notAttended}`);
  console.log(`identity — email: ${hasEmail}/${paymentlessTotal} | phone: ${hasPhone}/${paymentlessTotal} | name: ${hasName}/${paymentlessTotal} | any: ${hasAnyIdentity}/${paymentlessTotal}`);
  console.log(`por evento (top 15): ${JSON.stringify(Object.fromEntries(Object.entries(byEvent).sort((a, b) => b[1] - a[1]).slice(0, 15)))}`);

  console.log(`\n=== paymentless — 5 ejemplos saneados ===`);
  for (const t of paymentless.slice(0, 5)) {
    console.log(JSON.stringify({ eventName: t.eventName, status: t.status, amountPaidCents: t.amountPaidCents, attended: t.attended, email: maskEmail(t.participant.email), hasPhone: Boolean(t.participant.phone), hasName: Boolean(t.participant.name) }));
  }

  console.log(`\n=== IDENTIDAD GLOBAL (agregado, sin PII) ===`);
  const uniqueIdentities = identityOperationCounts.size;
  const withEmail = identityHasEmail.size;
  const withPhone = identityHasPhone.size;
  const withBoth = [...identityHasEmail].filter(k => identityHasPhone.has(k)).length;
  const ticketsWithoutIdentity = rawTickets - [...identityOperationCounts.values()].reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({
    uniqueIdentities, withEmail, withPhone, withBoth,
    ticketsWithNoContactIdentity: ticketsWithoutIdentity,
  }, null, 2));

  console.log(`\n=== REPEATED BUYERS (agregado, sin PII) ===`);
  const buckets = { "1": 0, "2+": 0, "3+": 0, "5+": 0, "10+": 0 };
  let sumOps = 0;
  for (const count of identityOperationCounts.values()) {
    sumOps += count;
    if (count === 1) buckets["1"]++;
    if (count >= 2) buckets["2+"]++;
    if (count >= 3) buckets["3+"]++;
    if (count >= 5) buckets["5+"]++;
    if (count >= 10) buckets["10+"]++;
  }
  console.log(JSON.stringify(buckets, null, 2));
  console.log(`avg operaciones/identidad: ${(sumOps / uniqueIdentities).toFixed(2)}`);

  console.log(`\n=== IDENTITY RESOLVER REAL (resolveIdentity(), sin persistir — muestra sobre paymentless + withOrder) ===`);
  let resolved = 0, unresolved = 0, ambiguous = 0;
  let sampleCount = 0;
  const SAMPLE_MAX = 2000; // límite razonable para no hacer 3121 queries de resolución en un script de investigación
  for (const ev of events) {
    if (sampleCount >= SAMPLE_MAX) break;
    let tickets: NormalizedTicket[] = [];
    try { tickets = await adapter.listTickets(credentials, ev.externalId); } catch { continue; }
    for (const t of tickets) {
      if (sampleCount >= SAMPLE_MAX) break;
      const identity = await resolveIdentity({ provider: "fourvenues_integrations", participant: t.participant, buyer: null });
      sampleCount++;
      if (identity.userId) resolved++;
      else if (identity.method === "ambiguous_email" || identity.method === "ambiguous_phone") ambiguous++;
      else unresolved++;
    }
  }
  console.log(JSON.stringify({ sampleSize: sampleCount, resolved, unresolved, ambiguous }, null, 2));

  console.log("\n=== EVENTOS (ordenados por nº de tickets, todos) ===");
  process.exit(0);
}

main().catch(err => { console.error("Investigación falló:", err instanceof Error ? err.message : err); process.exit(1); });
