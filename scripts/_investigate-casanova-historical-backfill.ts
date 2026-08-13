/**
 * _investigate-casanova-historical-backfill.ts — SOLO LECTURA (Casanova
 * Full Historical Backfill, spec §5-6, §16). Reconciliación completa del
 * histórico real de Casanova contra Fourvenues (400d/5d): compara A
 * (Fourvenues descubierto) vs B (ya persistido en Segolife) vs C
 * (faltante), clasifica raw tickets, identidad agregada (sin PII) y
 * repeated buyers — mismo patrón ya usado en Tía Felisa/Limoncello.
 *
 * NUNCA escribe en Segolife. NUNCA imprime PII (solo agregados y ejemplos
 * enmascarados).
 *
 * Uso (Railway Console, servicio segolife):
 *   npx tsx scripts/_investigate-casanova-historical-backfill.ts [historyFromDays] [futureUntilDays]
 */
import { getVenueIntegrationRaw, getProviderById } from "../server/segolife/integrations/integrationsDb";
import { decryptCredentials } from "../server/segolife/integrations/integrationCredentialCrypto";
import { createFourvenuesIntegrationsAdapter, FOURVENUES_INTEGRATIONS_BASE_URL } from "../server/segolife/integrations/fourvenuesIntegrationsAdapter";
import { createHttpTransport } from "../server/segolife/integrations/httpTransport";
import { resolveIdentity } from "../server/segolife/integrations/identityResolver";
import type { NormalizedTicket } from "../server/segolife/integrations/externalTicketingProvider";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql as drizzleSql } from "drizzle-orm";

const VENUE_INTEGRATION_ID = 1;

function maskEmail(e: string | null | undefined): string {
  if (!e) return "(sin email)";
  const [user, domain] = e.split("@");
  if (!domain) return "***";
  return `${user[0] ?? "*"}***@${domain}`;
}
function identityKey(t: NormalizedTicket): string | null {
  const email = t.participant.email?.trim().toLowerCase();
  const phone = t.participant.phone?.trim();
  if (email) return `email:${email}`;
  if (phone) return `phone:${phone}`;
  return null;
}

async function main() {
  const historyFromDays = Number(process.argv[2] ?? 400);
  const futureUntilDays = Number(process.argv[3] ?? 5);

  const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
  const db = drizzle(pool);

  const integration = await getVenueIntegrationRaw(VENUE_INTEGRATION_ID);
  if (!integration) { console.error("Integración no encontrada"); process.exit(1); }
  const provider = await getProviderById(integration.providerId);
  if (provider?.key !== "fourvenues_integrations") { console.error("Provider no soportado:", provider?.key); process.exit(1); }
  const credentials = decryptCredentials(integration.credentialsEncrypted!);
  if (!credentials) { console.error("No se pudieron descifrar las credenciales"); process.exit(1); }

  console.log(`=== A vs B vs C — Casanova (venue_integration #${VENUE_INTEGRATION_ID}) — ventana ${historyFromDays}d/${futureUntilDays}d ===\n`);

  const adapter = createFourvenuesIntegrationsAdapter(
    createHttpTransport(FOURVENUES_INTEGRATIONS_BASE_URL[integration.environment]),
    undefined,
    { historyFromDays, futureUntilDays }
  );

  const events = await adapter.listEvents(credentials);
  const A = events.length;
  console.log(`A (Fourvenues descubierto): ${A} eventos`);

  const [mappedRows] = await db.execute(drizzleSql`
    SELECT external_id FROM external_entity_mappings
    WHERE integration_type='venue_integration' AND integration_id=${VENUE_INTEGRATION_ID} AND external_type='event'
  `);
  const mappedExternalIds = new Set((mappedRows as unknown as Array<{ external_id: string }>).map(r => r.external_id));
  const B = mappedExternalIds.size;
  console.log(`B (ya persistido en Segolife, external_entity_mappings): ${B} eventos`);

  const newEvents = events.filter(e => !mappedExternalIds.has(e.externalId));
  const C = newEvents.length;
  console.log(`C (faltante): ${C} eventos`);
  console.log(`Verificación: B + C = ${B + C} (debe = A = ${A})\n`);

  const eventsWithoutStartsAt = events.filter(e => e.startsAt === null);
  console.log(`Eventos sin startsAt: ${eventsWithoutStartsAt.length}/${A}`);

  let rawTickets = 0, withOrderTotal = 0, paymentlessTotal = 0;
  let largestEventTickets = 0, largestEventName = "", largestEventPages = 0;
  const paymentless: Array<NormalizedTicket & { attended: boolean; eventName: string }> = [];
  const withOrderByStatus: Record<string, number> = {};
  let ordersTotal = 0, revenueCentsTotal = 0, attendedTotal = 0;
  let newEventsProcessed = 0, alreadyMappedEventsProcessed = 0;

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
    if (mappedExternalIds.has(ev.externalId)) alreadyMappedEventsProcessed++; else newEventsProcessed++;
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

  console.log(`\nEventos ya mapeados procesados: ${alreadyMappedEventsProcessed} | Eventos nuevos procesados: ${newEventsProcessed}`);

  console.log(`\n=== TOTALES RAW ===`);
  console.log(`rawTickets=${rawTickets} withOrder=${withOrderTotal} paymentless=${paymentlessTotal}`);
  console.log(`Suma verificación: ${withOrderTotal + paymentlessTotal} (debe = ${rawTickets})`);
  console.log(`orders=${ordersTotal} attendanceRaw=${attendedTotal} revenue(orders)=${(revenueCentsTotal / 100).toFixed(2)}€`);
  console.log(`Evento más grande: "${largestEventName}" — ${largestEventTickets} tickets (${largestEventPages} página(s))`);

  console.log(`\n=== withOrder — por status ===`);
  console.log(JSON.stringify(withOrderByStatus, null, 2));

  console.log(`\n=== paymentless (${paymentlessTotal}) — clasificación Casanova (analizado por separado) ===`);
  const byStatus: Record<string, number> = {};
  let priceZero = 0, pricePositive = 0, attended = 0, notAttended = 0;
  let hasEmail = 0, hasPhone = 0, hasName = 0;
  let sumAmountCents = 0;
  for (const t of paymentless) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const amount = t.amountPaidCents ?? 0;
    if (amount === 0) priceZero++; else pricePositive++;
    sumAmountCents += amount;
    if (t.attended) attended++; else notAttended++;
    if (t.participant.email) hasEmail++;
    if (t.participant.phone) hasPhone++;
    if (t.participant.name) hasName++;
  }
  console.log(`por status: ${JSON.stringify(byStatus)}`);
  console.log(`price=0: ${priceZero} | price>0: ${pricePositive} | suma evidencia económica: ${(sumAmountCents / 100).toFixed(2)}€`);
  console.log(`attended: ${attended} | not attended: ${notAttended}`);
  console.log(`identity — email: ${hasEmail}/${paymentlessTotal || 1} | phone: ${hasPhone}/${paymentlessTotal || 1} | name: ${hasName}/${paymentlessTotal || 1}`);
  for (const t of paymentless.slice(0, 5)) {
    console.log(JSON.stringify({ eventName: t.eventName, status: t.status, amountPaidCents: t.amountPaidCents, attended: t.attended, email: maskEmail(t.participant.email) }));
  }

  console.log(`\n=== IDENTIDAD GLOBAL CASANOVA (agregado, sin PII) ===`);
  const uniqueIdentities = identityOperationCounts.size;
  const withEmail = identityHasEmail.size;
  const withPhone = identityHasPhone.size;
  const withBoth = [...identityHasEmail].filter(k => identityHasPhone.has(k)).length;
  const ticketsWithoutIdentity = rawTickets - [...identityOperationCounts.values()].reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ uniqueIdentities, withEmail, withPhone, withBoth, ticketsWithNoContactIdentity: ticketsWithoutIdentity }, null, 2));

  console.log(`\n=== REPEATED BUYERS CASANOVA (agregado, sin PII) ===`);
  const buckets = { "1": 0, "2+": 0, "3+": 0, "5+": 0, "10+": 0, "20+": 0, "50+": 0 };
  let sumOps = 0;
  for (const count of identityOperationCounts.values()) {
    sumOps += count;
    if (count === 1) buckets["1"]++;
    if (count >= 2) buckets["2+"]++;
    if (count >= 3) buckets["3+"]++;
    if (count >= 5) buckets["5+"]++;
    if (count >= 10) buckets["10+"]++;
    if (count >= 20) buckets["20+"]++;
    if (count >= 50) buckets["50+"]++;
  }
  console.log(JSON.stringify(buckets, null, 2));
  if (uniqueIdentities > 0) console.log(`avg operaciones/identidad: ${(sumOps / uniqueIdentities).toFixed(2)}`);

  console.log(`\n=== IDENTITY RESOLVER REAL (resolveIdentity(), sin persistir, muestra capada) ===`);
  let resolved = 0, unresolved = 0, ambiguous = 0, sampleCount = 0;
  const SAMPLE_MAX = 2000;
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

  await pool.end();
  process.exit(0);
}

main().catch(err => { console.error("Investigación falló:", err instanceof Error ? err.message : err); process.exit(1); });
