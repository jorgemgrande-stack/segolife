/**
 * historicalRewardSimulator.ts — SEGOLIFE LIVE LOYALTY DESIGN, Historical
 * Simulation. Simula 5 modelos de política HIPOTÉTICOS (A-E, ver
 * POLICY_MODELS) sobre identidades históricas Fourvenues YA PERSISTIDAS —
 * cálculo puro en memoria, SIN NINGUNA escritura, SIN llamar al motor real
 * de producción (`tokenEngine.ts`/`tokenRuleEngine.ts`) ni a `token_rules`.
 *
 * Los valores de cada modelo son HIPÓTESIS DE COMPARACIÓN documentadas, no
 * configuración real — la única fuente de tokens reales sigue siendo
 * `token_rules` (2 filas hoy, ver auditoría de fase). Este módulo nunca
 * escribe en `token_ledger`/`token_wallets`/`user_benefits`.
 *
 * ENTRADA: `SimulationIdentity[]` — mismo shape que ya produce
 * `historicalIdentityService.loadHistoricalSimulationInput()`, reutilizando
 * la agregación canónica de `unresolved_operations` en vez de duplicarla
 * (spec "REUSE FIRST"). Este archivo es deliberadamente PURO (sin I/O) para
 * poder testear los 5 modelos con fixtures sintéticos sin tocar BD — el
 * script de orquestación (`scripts/_historical-loyalty-simulation.ts`) es
 * quien conecta esta capa con los datos reales de producción.
 *
 * SEMÁNTICA DE LOS TRIGGERS (idempotentes por construcción, spec §33):
 *  - purchase/attendance: como mucho UNA vez por identidad+evento — mismo
 *    criterio que `buildPurchaseIdempotencyKey`/Case B de
 *    ticketPurchasePipeline.ts/attendancePipeline.ts (Student+Event, no
 *    Student+Ticket).
 *  - first_action: como mucho UNA vez por identidad, en su primera fila
 *    cronológica (order o attendance).
 *  - cross_venue: como mucho UNA vez por identidad, en el momento en que
 *    aparece su 2º venue distinto.
 *  - milestone: dispara solo al CRUZAR el umbral (5º, 10º, 15º... evento
 *    distinto) — nunca se repite dentro del mismo umbral ya cruzado.
 */

export interface SimulationRow {
  operationType: "order" | "attendance";
  occurredAt: Date;
  eventId: number | null;
  venueId: number | null;
  amountCents: number | null;
}

export interface SimulationIdentity {
  identityKey: string;
  isKnownStudent: boolean;
  rows: SimulationRow[];
}

export type PolicyModelKey = "A" | "B" | "C" | "D" | "E";

export interface PolicyModel {
  key: PolicyModelKey;
  name: string;
  description: string;
  /** Tokens por PEDIDO/COMPRA (origin="ticket"), como mucho 1 vez por identidad+evento. 0 = modelo sin recompensa de compra. */
  purchaseTokens: number;
  /** Tokens por ASISTENCIA (origin="attendance"), como mucho 1 vez por identidad+evento. */
  attendanceTokens: number;
  /** Bono único, en la primera acción (compra o asistencia) de la identidad. */
  firstActionBonus: number;
  /** Umbral de eventos distintos para el bono de recurrencia/hito (null = sin hito). */
  milestoneEvery: number | null;
  milestoneBonus: number;
  /** Bono único al alcanzar el 2º venue distinto (descubrimiento cross-venue). */
  crossVenueBonus: number;
}

export const POLICY_MODELS: PolicyModel[] = [
  {
    key: "A",
    name: "Conservador — solo asistencia",
    description: "Premia únicamente la asistencia real verificada (nunca la compra en sí). Hipótesis: 10 tokens por asistencia, sin bonos adicionales. Coste más bajo y más difícil de \"gamear\" (una compra sin asistencia real nunca genera coste).",
    purchaseTokens: 0, attendanceTokens: 10, firstActionBonus: 0, milestoneEvery: null, milestoneBonus: 0, crossVenueBonus: 0,
  },
  {
    key: "B",
    name: "Basado en compra",
    description: "Premia la compra en el momento del pedido, sin esperar a la asistencia. Hipótesis: 10 tokens por compra. Refuerzo inmediato (mejor conversión percibida) pero expuesto a coste por compras que luego no asisten/se cancelan.",
    purchaseTokens: 10, attendanceTokens: 0, firstActionBonus: 0, milestoneEvery: null, milestoneBonus: 0, crossVenueBonus: 0,
  },
  {
    key: "C",
    name: "Híbrido — compra + bono de asistencia",
    description: "Compra y asistencia se premian por separado y se pueden sumar en el mismo evento (spec modo C: purchase+attendance-bonus). Hipótesis: 10 tokens por compra + 5 adicionales si además asiste + 10 de bienvenida en la primera acción.",
    purchaseTokens: 10, attendanceTokens: 5, firstActionBonus: 10, milestoneEvery: null, milestoneBonus: 0, crossVenueBonus: 0,
  },
  {
    key: "D",
    name: "Engagement — recurrencia y cross-venue",
    description: "Prioriza mover estudiantes entre venues y mantenerlos activos en el tiempo, no solo el primer gasto. Hipótesis: 5 por compra, 10 por asistencia, 10 de bienvenida, +50 cada 5 eventos distintos, +20 al descubrir un 2º venue.",
    purchaseTokens: 5, attendanceTokens: 10, firstActionBonus: 10, milestoneEvery: 5, milestoneBonus: 50, crossVenueBonus: 20,
  },
  {
    key: "E",
    name: "Generoso / agresivo",
    description: "Maximiza el incentivo en todos los triggers a la vez — techo superior de coste para comparar el otro extremo del espectro. Hipótesis: 20 por compra, 20 por asistencia, 25 de bienvenida, +40 cada 3 eventos distintos, +30 cross-venue.",
    purchaseTokens: 20, attendanceTokens: 20, firstActionBonus: 25, milestoneEvery: 3, milestoneBonus: 40, crossVenueBonus: 30,
  },
];

export type RewardTriggerType = "purchase" | "attendance" | "first_action" | "milestone" | "cross_venue";

export interface RewardEvent {
  identityKey: string;
  isKnownStudent: boolean;
  occurredAt: Date;
  venueId: number | null;
  eventId: number | null;
  triggerType: RewardTriggerType;
  tokens: number;
}

/** Simula UN modelo sobre TODAS las identidades — pura, sin I/O, determinista. */
export function simulatePolicyModel(model: PolicyModel, identities: SimulationIdentity[]): RewardEvent[] {
  const events: RewardEvent[] = [];

  for (const identity of identities) {
    const sortedRows = [...identity.rows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const rewardedPurchaseEvents = new Set<number>();
    const rewardedAttendanceEvents = new Set<number>();
    const distinctVenuesSoFar = new Set<number>();
    const distinctEventsSoFar = new Set<number>();
    let firstActionGranted = false;
    let crossVenueGranted = false;
    let lastMilestoneCount = 0;

    for (const row of sortedRows) {
      if (row.venueId != null) distinctVenuesSoFar.add(row.venueId);
      if (row.eventId != null) distinctEventsSoFar.add(row.eventId);

      if (row.operationType === "order" && model.purchaseTokens > 0 && row.eventId != null && !rewardedPurchaseEvents.has(row.eventId)) {
        rewardedPurchaseEvents.add(row.eventId);
        events.push({ identityKey: identity.identityKey, isKnownStudent: identity.isKnownStudent, occurredAt: row.occurredAt, venueId: row.venueId, eventId: row.eventId, triggerType: "purchase", tokens: model.purchaseTokens });
      }
      if (row.operationType === "attendance" && model.attendanceTokens > 0 && row.eventId != null && !rewardedAttendanceEvents.has(row.eventId)) {
        rewardedAttendanceEvents.add(row.eventId);
        events.push({ identityKey: identity.identityKey, isKnownStudent: identity.isKnownStudent, occurredAt: row.occurredAt, venueId: row.venueId, eventId: row.eventId, triggerType: "attendance", tokens: model.attendanceTokens });
      }
      if (!firstActionGranted && model.firstActionBonus > 0) {
        firstActionGranted = true;
        events.push({ identityKey: identity.identityKey, isKnownStudent: identity.isKnownStudent, occurredAt: row.occurredAt, venueId: row.venueId, eventId: row.eventId, triggerType: "first_action", tokens: model.firstActionBonus });
      }
      if (!crossVenueGranted && model.crossVenueBonus > 0 && distinctVenuesSoFar.size >= 2) {
        crossVenueGranted = true;
        events.push({ identityKey: identity.identityKey, isKnownStudent: identity.isKnownStudent, occurredAt: row.occurredAt, venueId: row.venueId, eventId: row.eventId, triggerType: "cross_venue", tokens: model.crossVenueBonus });
      }
      if (model.milestoneEvery && model.milestoneBonus > 0) {
        const count = distinctEventsSoFar.size;
        if (count > lastMilestoneCount && count % model.milestoneEvery === 0) {
          lastMilestoneCount = count;
          events.push({ identityKey: identity.identityKey, isKnownStudent: identity.isKnownStudent, occurredAt: row.occurredAt, venueId: row.venueId, eventId: row.eventId, triggerType: "milestone", tokens: model.milestoneBonus });
        }
      }
    }
  }

  return events;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

export interface AnonymizedTopEntry {
  rank: number;
  tokens: number;
  isKnownStudent: boolean;
  distinctVenues: number;
  distinctEvents: number;
}

export interface ModelStats {
  modelKey: PolicyModelKey;
  identitiesConsidered: number;
  peopleRewarded: number;
  rewardsCount: number;
  totalTokensIssued: number;
  avgTokensPerRewardedPerson: number;
  medianTokensPerRewardedPerson: number;
  p90TokensPerRewardedPerson: number;
  p95TokensPerRewardedPerson: number;
  p99TokensPerRewardedPerson: number;
  maxTokensPerRewardedPerson: number;
  tokensByVenue: Record<string, number>;
  tokensByTrigger: Record<string, number>;
  tokensByMonth: Record<string, number>;
  knownStudents: { count: number; totalTokens: number };
  /** Identidades históricas NO vinculadas a un Student real — "qué habrían ganado SI lo hubieran sido" (análisis puro, spec Historical Simulation). */
  historicalIdentities: { count: number; totalTokens: number };
  /** Solo métricas agregadas — NUNCA identityKey/email/nombre (spec: "sin PII"). */
  top10ByTokens: AnonymizedTopEntry[];
  /** Fracción del total de tokens que concentra el top 1% de identidades premiadas. */
  top1PercentShare: number;
}

export function computeModelStats(model: PolicyModel, events: RewardEvent[], identitiesConsidered: number): ModelStats {
  const perIdentity = new Map<string, { tokens: number; isKnownStudent: boolean; venues: Set<number>; events: Set<number> }>();
  const tokensByVenue = new Map<string, number>();
  const tokensByTrigger = new Map<string, number>();
  const tokensByMonth = new Map<string, number>();

  for (const ev of events) {
    let acc = perIdentity.get(ev.identityKey);
    if (!acc) {
      acc = { tokens: 0, isKnownStudent: ev.isKnownStudent, venues: new Set(), events: new Set() };
      perIdentity.set(ev.identityKey, acc);
    }
    acc.tokens += ev.tokens;
    if (ev.venueId != null) acc.venues.add(ev.venueId);
    if (ev.eventId != null) acc.events.add(ev.eventId);

    const venueKey = ev.venueId != null ? String(ev.venueId) : "unknown";
    tokensByVenue.set(venueKey, (tokensByVenue.get(venueKey) ?? 0) + ev.tokens);
    tokensByTrigger.set(ev.triggerType, (tokensByTrigger.get(ev.triggerType) ?? 0) + ev.tokens);
    const monthKey = ev.occurredAt.toISOString().slice(0, 7);
    tokensByMonth.set(monthKey, (tokensByMonth.get(monthKey) ?? 0) + ev.tokens);
  }

  const perIdentityList = Array.from(perIdentity.values());
  const sortedTokensAsc = perIdentityList.map(a => a.tokens).sort((a, b) => a - b);
  const totalTokensIssued = sortedTokensAsc.reduce((s, v) => s + v, 0);

  const knownStudents = perIdentityList.filter(a => a.isKnownStudent);
  const historicalIdentities = perIdentityList.filter(a => !a.isKnownStudent);

  const ranked = Array.from(perIdentity.values())
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10)
    .map((a, i) => ({ rank: i + 1, tokens: a.tokens, isKnownStudent: a.isKnownStudent, distinctVenues: a.venues.size, distinctEvents: a.events.size }));

  const top1PercentCount = perIdentityList.length > 0 ? Math.max(1, Math.ceil(perIdentityList.length * 0.01)) : 0;
  const top1PercentTokens = perIdentityList.map(a => a.tokens).sort((a, b) => b - a).slice(0, top1PercentCount).reduce((s, v) => s + v, 0);

  return {
    modelKey: model.key,
    identitiesConsidered,
    peopleRewarded: perIdentityList.length,
    rewardsCount: events.length,
    totalTokensIssued,
    avgTokensPerRewardedPerson: perIdentityList.length ? totalTokensIssued / perIdentityList.length : 0,
    medianTokensPerRewardedPerson: percentile(sortedTokensAsc, 50),
    p90TokensPerRewardedPerson: percentile(sortedTokensAsc, 90),
    p95TokensPerRewardedPerson: percentile(sortedTokensAsc, 95),
    p99TokensPerRewardedPerson: percentile(sortedTokensAsc, 99),
    maxTokensPerRewardedPerson: sortedTokensAsc.length ? sortedTokensAsc[sortedTokensAsc.length - 1] : 0,
    tokensByVenue: Object.fromEntries(tokensByVenue),
    tokensByTrigger: Object.fromEntries(tokensByTrigger),
    tokensByMonth: Object.fromEntries(tokensByMonth),
    knownStudents: { count: knownStudents.length, totalTokens: knownStudents.reduce((s, a) => s + a.tokens, 0) },
    historicalIdentities: { count: historicalIdentities.length, totalTokens: historicalIdentities.reduce((s, a) => s + a.tokens, 0) },
    top10ByTokens: ranked,
    top1PercentShare: totalTokensIssued > 0 ? top1PercentTokens / totalTokensIssued : 0,
  };
}

export interface EconomicImpact {
  tokenValueEurCents: number;
  totalLiabilityEurCents: number;
  totalRevenueCents: number;
  rewardRateOverRevenue: number;
}

/** Capa económica — parametriza el valor de 1 token en céntimos de euro (spec: €0.01/€0.02/€0.05...). */
export function computeEconomicImpact(stats: ModelStats, totalRevenueCents: number, tokenValueEurCents: number): EconomicImpact {
  const totalLiabilityEurCents = stats.totalTokensIssued * tokenValueEurCents;
  return {
    tokenValueEurCents,
    totalLiabilityEurCents,
    totalRevenueCents,
    rewardRateOverRevenue: totalRevenueCents > 0 ? totalLiabilityEurCents / totalRevenueCents : 0,
  };
}
