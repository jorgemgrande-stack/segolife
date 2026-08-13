/**
 * _investigate-limoncello-cross-venue.ts — SOLO LECTURA (Limoncello rollout,
 * spec §9-20, §55-56). Dos partes:
 *
 * 1) Reconciliación completa del histórico real de Limoncello contra
 *    Fourvenues: with-order vs paymentless, identidad (agregada, sin PII),
 *    repeated buyers, y resolución real contra usuarios Segolife vía
 *    resolveIdentity() (sin persistir nada).
 *
 * 2) Cross-venue identity: recalcula el mismo identityKey para Casanova y
 *    Tía Felisa (re-fetch de solo lectura, misma ventana) y compara contra
 *    Limoncello para reportar solapamiento — nunca crea Students ni
 *    mappings, solo agregados en memoria de este proceso.
 *
 * NUNCA escribe en Segolife. NUNCA imprime PII (solo agregados y ejemplos
 * enmascarados).
 *
 * Uso (Railway Console, servicio segolife):
 *   npx tsx scripts/_investigate-limoncello-cross-venue.ts [historyFromDays] [futureUntilDays]
 */
import { getVenueIntegrationRaw, getProviderById } from "../server/segolife/integrations/integrationsDb";
import { decryptCredentials } from "../server/segolife/integrations/integrationCredentialCrypto";
import { createFourvenuesIntegrationsAdapter, FOURVENUES_INTEGRATIONS_BASE_URL } from "../server/segolife/integrations/fourvenuesIntegrationsAdapter";
import { createHttpTransport } from "../server/segolife/integrations/httpTransport";
import { resolveIdentity } from "../server/segolife/integrations/identityResolver";
import type { NormalizedTicket } from "../server/segolife/integrations/externalTicketingProvider";

const VENUES: Record<number, string> = { 1: "Casanova", 2: "Limoncello", 3: "Tía Felisa" };

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

async function loadAdapter(id: number, historyFromDays: number, futureUntilDays: number) {
  const integration = await getVenueIntegrationRaw(id);
  if (!integration) throw new Error(`venue_integration #${id} no encontrada`);
  const provider = await getProviderById(integration.providerId);
  if (provider?.key !== "fourvenues_integrations") throw new Error(`provider no soportado en #${id}: ${provider?.key}`);
  const credentials = decryptCredentials(integration.credentialsEncrypted!);
  if (!credentials) throw new Error(`no se pudieron descifrar credenciales de #${id}`);
  const adapter = createFourvenuesIntegrationsAdapter(
    createHttpTransport(FOURVENUES_INTEGRATIONS_BASE_URL[integration.environment]),
    undefined,
    { historyFromDays, futureUntilDays }
  );
  return { adapter, credentials };
}

interface VenueIdentitySet {
  identities: Set<string>;
  ticketCountByIdentity: Map<string, number>;
  eventSetByIdentity: Map<string, Set<string>>;
  attendedCountByIdentity: Map<string, number>;
}

async function collectIdentitiesForVenue(id: number, historyFromDays: number, futureUntilDays: number): Promise<VenueIdentitySet> {
  const { adapter, credentials } = await loadAdapter(id, historyFromDays, futureUntilDays);
  const events = await adapter.listEvents(credentials);
  const identities = new Set<string>();
  const ticketCountByIdentity = new Map<string, number>();
  const eventSetByIdentity = new Map<string, Set<string>>();
  const attendedCountByIdentity = new Map<string, number>();

  for (const ev of events) {
    let tickets: NormalizedTicket[] = [];
    let attendance: Awaited<ReturnType<typeof adapter.listAttendance>> = [];
    try {
      [tickets, attendance] = await Promise.all([
        adapter.listTickets(credentials, ev.externalId),
        adapter.listAttendance(credentials, ev.externalId),
      ]);
    } catch (err) {
      console.log(`  [ERROR] venue#${id} ${ev.name}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (tickets.length === 0) continue;
    const attendedIds = new Set(attendance.map(a => a.externalTicketId).filter(Boolean));

    for (const t of tickets) {
      const key = identityKey(t);
      if (!key) continue;
      identities.add(key);
      ticketCountByIdentity.set(key, (ticketCountByIdentity.get(key) ?? 0) + 1);
      const evSet = eventSetByIdentity.get(key) ?? new Set<string>();
      evSet.add(ev.externalId);
      eventSetByIdentity.set(key, evSet);
      if (attendedIds.has(t.externalId)) {
        attendedCountByIdentity.set(key, (attendedCountByIdentity.get(key) ?? 0) + 1);
      }
    }
  }
  return { identities, ticketCountByIdentity, eventSetByIdentity, attendedCountByIdentity };
}

async function main() {
  const historyFromDays = Number(process.argv[2] ?? 400);
  const futureUntilDays = Number(process.argv[3] ?? 5);
  const skipCrossVenue = process.argv[4] === "skip-cross-venue";

  console.log(`=== PARTE 1 — RECONCILIACIÓN COMPLETA LIMONCELLO (venue_integration #2) — ventana ${historyFromDays}d/${futureUntilDays}d ===\n`);

  const { adapter, credentials } = await loadAdapter(2, historyFromDays, futureUntilDays);
  const events = await adapter.listEvents(credentials);
  console.log(`Eventos en la ventana: ${events.length}`);
  const eventsWithoutStartsAt = events.filter(e => e.startsAt === null);
  if (eventsWithoutStartsAt.length > 0) {
    console.log(`⚠ ${eventsWithoutStartsAt.length} evento(s) SIN startsAt: ${eventsWithoutStartsAt.map(e => `"${e.name}" (${e.externalId})`).join(", ")}`);
  } else {
    console.log(`Eventos sin startsAt: 0/${events.length}`);
  }

  let rawTickets = 0, withOrderTotal = 0, paymentlessTotal = 0;
  let largestEventTickets = 0, largestEventName = "", largestEventPages = 0;
  const paymentless: Array<NormalizedTicket & { attended: boolean; eventName: string }> = [];
  const withOrderByStatus: Record<string, number> = {};
  let ordersTotal = 0, revenueCentsTotal = 0, attendedTotal = 0;

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

  console.log(`\n=== TOTALES RAW ===`);
  console.log(`rawTickets=${rawTickets} withOrder=${withOrderTotal} paymentless=${paymentlessTotal}`);
  console.log(`Suma verificación: ${withOrderTotal + paymentlessTotal} (debe = ${rawTickets})`);
  console.log(`orders=${ordersTotal} attendanceRaw=${attendedTotal} revenue(orders)=${(revenueCentsTotal / 100).toFixed(2)}€`);
  console.log(`Evento más grande: "${largestEventName}" — ${largestEventTickets} tickets (${largestEventPages} página(s))`);

  console.log(`\n=== withOrder — por status ===`);
  console.log(JSON.stringify(withOrderByStatus, null, 2));

  console.log(`\n=== paymentless (${paymentlessTotal}) — clasificación (Limoncello, analizado por separado, NUNCA asumido) ===`);
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
  console.log(`identity — email: ${hasEmail}/${paymentlessTotal || 1} | phone: ${hasPhone}/${paymentlessTotal || 1} | name: ${hasName}/${paymentlessTotal || 1} | any: ${hasAnyIdentity}/${paymentlessTotal || 1}`);
  console.log(`por evento (top 15): ${JSON.stringify(Object.fromEntries(Object.entries(byEvent).sort((a, b) => b[1] - a[1]).slice(0, 15)))}`);

  console.log(`\n=== paymentless — hasta 5 ejemplos saneados ===`);
  for (const t of paymentless.slice(0, 5)) {
    console.log(JSON.stringify({ eventName: t.eventName, status: t.status, amountPaidCents: t.amountPaidCents, attended: t.attended, email: maskEmail(t.participant.email), hasPhone: Boolean(t.participant.phone), hasName: Boolean(t.participant.name) }));
  }

  console.log(`\n=== IDENTIDAD GLOBAL LIMONCELLO (agregado, sin PII) ===`);
  const uniqueIdentities = identityOperationCounts.size;
  const withEmail = identityHasEmail.size;
  const withPhone = identityHasPhone.size;
  const withBoth = [...identityHasEmail].filter(k => identityHasPhone.has(k)).length;
  const ticketsWithoutIdentity = rawTickets - [...identityOperationCounts.values()].reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ uniqueIdentities, withEmail, withPhone, withBoth, ticketsWithNoContactIdentity: ticketsWithoutIdentity }, null, 2));

  console.log(`\n=== REPEATED BUYERS LIMONCELLO (agregado, sin PII) ===`);
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
  if (uniqueIdentities > 0) console.log(`avg operaciones/identidad: ${(sumOps / uniqueIdentities).toFixed(2)}`);

  console.log(`\n=== IDENTITY RESOLVER REAL (resolveIdentity(), sin persistir) ===`);
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

  if (skipCrossVenue) {
    console.log("\n(Parte 2 — cross-venue — omitida en esta ejecución)");
    process.exit(0);
  }

  // ── PARTE 2 — CROSS-VENUE IDENTITY (spec §17-18, §55-56) ──────────────
  console.log(`\n\n=== PARTE 2 — CROSS-VENUE IDENTITY (Casanova + Tía Felisa + Limoncello, agregado, SIN PII) ===`);
  console.log(`Re-fetch de solo lectura de Casanova y Tía Felisa en la misma ventana, para comparar contra Limoncello.\n`);

  const limoncelloSet: VenueIdentitySet = { identities: identityOperationCounts.size ? new Set(identityOperationCounts.keys()) : new Set(), ticketCountByIdentity: identityOperationCounts, eventSetByIdentity: new Map(), attendedCountByIdentity: new Map() };

  console.log(`Recolectando identidades de Casanova (venue_integration #1)...`);
  const casanovaSet = await collectIdentitiesForVenue(1, historyFromDays, futureUntilDays);
  console.log(`Casanova: ${casanovaSet.identities.size} identidades únicas`);

  console.log(`Recolectando identidades de Tía Felisa (venue_integration #3)...`);
  const tiaFelisaSet = await collectIdentitiesForVenue(3, historyFromDays, futureUntilDays);
  console.log(`Tía Felisa: ${tiaFelisaSet.identities.size} identidades únicas`);

  console.log(`Limoncello: ${limoncelloSet.identities.size} identidades únicas`);

  const inC = casanovaSet.identities;
  const inT = tiaFelisaSet.identities;
  const inL = limoncelloSet.identities;
  const allKeys = new Set<string>([...inC, ...inT, ...inL]);

  let onlyC = 0, onlyT = 0, onlyL = 0, cAndT = 0, cAndL = 0, tAndL = 0, all3 = 0;
  for (const k of allKeys) {
    const c = inC.has(k), t = inT.has(k), l = inL.has(k);
    const count = (c ? 1 : 0) + (t ? 1 : 0) + (l ? 1 : 0);
    if (count === 1) {
      if (c) onlyC++; else if (t) onlyT++; else onlyL++;
    } else if (count === 2) {
      if (c && t) cAndT++;
      else if (c && l) cAndL++;
      else if (t && l) tAndL++;
    } else if (count === 3) {
      all3++;
    }
  }

  console.log(`\n=== CROSS-VENUE IDENTITY REPORT (sin PII) ===`);
  console.log(JSON.stringify({
    uniqueIdentitiesCasanova: inC.size,
    uniqueIdentitiesTiaFelisa: inT.size,
    uniqueIdentitiesLimoncello: inL.size,
    uniqueCombinedIdentities: allKeys.size,
    onlyCasanova: onlyC,
    onlyTiaFelisa: onlyT,
    onlyLimoncello: onlyL,
    casanovaAndTiaFelisa: cAndT,
    casanovaAndLimoncello: cAndL,
    tiaFelisaAndLimoncello: tAndL,
    allThreeVenues: all3,
  }, null, 2));

  console.log(`\n=== CROSS-VENUE ACTIVITY AGGREGATE (población histórica en >1 venue, sin PII) ===`);
  const multiVenueKeys = [...allKeys].filter(k => {
    const c = inC.has(k) ? 1 : 0, t = inT.has(k) ? 1 : 0, l = inL.has(k) ? 1 : 0;
    return (c + t + l) > 1;
  });
  let sumVenuesForMultiVenue = 0, sumTicketsForMultiVenue = 0;
  for (const k of multiVenueKeys) {
    const c = inC.has(k) ? 1 : 0, t = inT.has(k) ? 1 : 0, l = inL.has(k) ? 1 : 0;
    sumVenuesForMultiVenue += (c + t + l);
    sumTicketsForMultiVenue += (casanovaSet.ticketCountByIdentity.get(k) ?? 0) + (tiaFelisaSet.ticketCountByIdentity.get(k) ?? 0) + (limoncelloSet.ticketCountByIdentity.get(k) ?? 0);
  }
  console.log(JSON.stringify({
    peopleSeenInMoreThan1Venue: multiVenueKeys.length,
    avgVenuesPerMultiVenuePerson: multiVenueKeys.length ? (sumVenuesForMultiVenue / multiVenueKeys.length).toFixed(2) : "n/a",
    avgTicketsPerMultiVenuePerson: multiVenueKeys.length ? (sumTicketsForMultiVenue / multiVenueKeys.length).toFixed(2) : "n/a",
  }, null, 2));

  console.log("\n=== FIN ===");
  process.exit(0);
}

main().catch(err => { console.error("Investigación falló:", err instanceof Error ? err.message : err); process.exit(1); });
