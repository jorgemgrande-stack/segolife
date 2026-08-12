/**
 * fourvenues-historical-explore.ts — EXPLORATORY, SOLO LECTURA (spec §6-8).
 * Escanea una ventana histórica amplia de Casanova contra la API REAL de
 * Fourvenues y reporta, evento por evento, cuánta actividad comercial real
 * hay (pedidos/tickets/asistencia/reembolsos) — para elegir con evidencia
 * la ventana a sincronizar de verdad. NUNCA persiste nada en Segolife.
 *
 * PII: nunca imprime email/teléfono/nombre completos — solo enmascarados
 * (c***@dominio.com, ***1234) y agregados.
 *
 * Uso (Railway Console, servicio segolife):
 *   npx tsx scripts/fourvenues-historical-explore.ts <venueIntegrationId> [historyFromDays] [futureUntilDays]
 */
import { getVenueIntegrationRaw, getProviderById } from "../server/segolife/integrations/integrationsDb";
import { decryptCredentials } from "../server/segolife/integrations/integrationCredentialCrypto";
import { createFourvenuesIntegrationsAdapter, FOURVENUES_INTEGRATIONS_BASE_URL } from "../server/segolife/integrations/fourvenuesIntegrationsAdapter";
import { createHttpTransport } from "../server/segolife/integrations/httpTransport";
import type { NormalizedOrder, NormalizedTicket } from "../server/segolife/integrations/externalTicketingProvider";

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

interface EventStats {
  externalId: string;
  name: string;
  startsAt: string;
  ticketsTotal: number;
  paymentsTotal: number;
  paymentsMultiTicket: number;
  ticketsWithEmail: number;
  ticketsWithPhone: number;
  ticketsWithName: number;
  attended: number;
  refunded: number;
  revenueCents: number;
  caseAExamples: number; // pagos multi-ticket con identidades distintas
  caseBExamples: number; // pagos multi-ticket con la MISMA identidad repetida
}

async function main() {
  const id = Number(process.argv[2]);
  const historyFromDays = Number(process.argv[3] ?? 400);
  const futureUntilDays = Number(process.argv[4] ?? 5);
  if (!id) {
    console.error("Uso: npx tsx scripts/fourvenues-historical-explore.ts <venueIntegrationId> [historyFromDays] [futureUntilDays]");
    process.exit(1);
  }

  const integration = await getVenueIntegrationRaw(id);
  if (!integration) { console.error("Integración no encontrada"); process.exit(1); }
  const provider = await getProviderById(integration.providerId);
  if (provider?.key !== "fourvenues_integrations") { console.error("Provider no soportado:", provider?.key); process.exit(1); }
  const credentials = decryptCredentials(integration.credentialsEncrypted!);
  if (!credentials) { console.error("No se pudieron descifrar las credenciales"); process.exit(1); }

  console.log(`Explorando venue_integration #${id} — ventana: ${historyFromDays} días atrás / ${futureUntilDays} días adelante\n`);

  const adapter = createFourvenuesIntegrationsAdapter(
    createHttpTransport(FOURVENUES_INTEGRATIONS_BASE_URL[integration.environment]),
    undefined,
    { historyFromDays, futureUntilDays }
  );

  const events = await adapter.listEvents(credentials);
  console.log(`Eventos encontrados en la ventana: ${events.length}\n`);

  const allStats: EventStats[] = [];

  for (const ev of events) {
    let orders: NormalizedOrder[] = [];
    let tickets: NormalizedTicket[] = [];
    let attendance: Array<{ occurredAt: Date }> = [];
    try {
      [orders, tickets, attendance] = await Promise.all([
        adapter.listOrders(credentials, ev.externalId),
        adapter.listTickets(credentials, ev.externalId),
        adapter.listAttendance(credentials, ev.externalId),
      ]);
    } catch (err) {
      console.log(`  [ERROR] ${ev.name}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    if (tickets.length === 0) continue; // sin actividad — no interesa para la ventana histórica

    const byPayment = new Map<string, NormalizedTicket[]>();
    for (const t of tickets) {
      if (!t.externalOrderId) continue;
      const list = byPayment.get(t.externalOrderId) ?? [];
      list.push(t);
      byPayment.set(t.externalOrderId, list);
    }
    let multiTicketPayments = 0, caseA = 0, caseB = 0;
    for (const group of byPayment.values()) {
      if (group.length <= 1) continue;
      multiTicketPayments++;
      const identities = new Set(group.map(t => `${(t.participant.email ?? "").toLowerCase()}|${t.participant.phone ?? ""}`));
      if (identities.size === group.length) caseA++;
      else if (identities.size === 1) caseB++;
    }

    const stats: EventStats = {
      externalId: ev.externalId,
      name: ev.name,
      startsAt: ev.startsAt.toISOString(),
      ticketsTotal: tickets.length,
      paymentsTotal: byPayment.size,
      paymentsMultiTicket: multiTicketPayments,
      ticketsWithEmail: tickets.filter(t => t.participant.email).length,
      ticketsWithPhone: tickets.filter(t => t.participant.phone).length,
      ticketsWithName: tickets.filter(t => t.participant.name).length,
      attended: attendance.length,
      refunded: tickets.filter(t => t.status === "refunded").length,
      revenueCents: orders.reduce((sum, o) => sum + o.totalCents, 0),
      caseAExamples: caseA,
      caseBExamples: caseB,
    };
    allStats.push(stats);

    console.log(`--- ${ev.name.slice(0, 60)} (${ev.startsAt.toISOString().slice(0, 10)}) ---`);
    console.log(`  tickets: ${stats.ticketsTotal} | pagos: ${stats.paymentsTotal} (multi-ticket: ${stats.paymentsMultiTicket}, CaseA: ${caseA}, CaseB: ${caseB})`);
    console.log(`  email: ${stats.ticketsWithEmail}/${stats.ticketsTotal} | phone: ${stats.ticketsWithPhone}/${stats.ticketsTotal} | name: ${stats.ticketsWithName}/${stats.ticketsTotal}`);
    console.log(`  asistieron: ${stats.attended} | reembolsados: ${stats.refunded} | revenue: ${(stats.revenueCents / 100).toFixed(2)}€`);
    // Muestra 1 ticket saneado como ejemplo de forma real (nunca PII completa).
    const sample = tickets[0];
    if (sample) {
      console.log(`  ejemplo saneado: email=${maskEmail(sample.participant.email)} phone=${maskPhone(sample.participant.phone)} status=${sample.status}`);
    }
    console.log("");
  }

  console.log("\n=== RESUMEN GLOBAL DE LA VENTANA ===");
  const totals = allStats.reduce((acc, s) => ({
    tickets: acc.tickets + s.ticketsTotal,
    payments: acc.payments + s.paymentsTotal,
    multiTicket: acc.multiTicket + s.paymentsMultiTicket,
    caseA: acc.caseA + s.caseAExamples,
    caseB: acc.caseB + s.caseBExamples,
    attended: acc.attended + s.attended,
    refunded: acc.refunded + s.refunded,
    revenueCents: acc.revenueCents + s.revenueCents,
  }), { tickets: 0, payments: 0, multiTicket: 0, caseA: 0, caseB: 0, attended: 0, refunded: 0, revenueCents: 0 });
  console.log(`Eventos con actividad: ${allStats.length} / ${events.length}`);
  console.log(JSON.stringify(totals, null, 2));
  console.log(`Revenue total muestreado: ${(totals.revenueCents / 100).toFixed(2)}€`);

  console.log("\n=== EVENTOS CANDIDATOS (ordenados por nº de tickets) ===");
  const ranked = [...allStats].sort((a, b) => b.ticketsTotal - a.ticketsTotal).slice(0, 10);
  for (const s of ranked) {
    console.log(`${s.startsAt.slice(0, 10)} | ${s.name.slice(0, 50)} | tickets=${s.ticketsTotal} pagos=${s.paymentsTotal} multi=${s.paymentsMultiTicket} asist=${s.attended} reemb=${s.refunded}`);
  }
}

main().catch(err => { console.error("Exploración falló:", err instanceof Error ? err.message : err); process.exit(1); });
