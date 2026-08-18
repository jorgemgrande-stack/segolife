/**
 * homeSummaryService.ts — agregado de solo lectura para la Home del
 * estudiante (Fase 6). Compone datos YA existentes de Fase 2 (wallet,
 * recurrencia, campañas) y Fase 1D/4 (eventos, beneficios) en una sola
 * llamada — evita que la Home dispare 6+ queries independientes en
 * cascada (spec Fase 6, punto 43: "análisis si la Home necesita demasiadas
 * queries — SOLO si aporta valor real, no crear mega-endpoint difícil de
 * mantener"). No introduce NINGÚN dato inventado: cada campo es `null`/
 * vacío si el motor correspondiente no tiene nada real que mostrar — nunca
 * se rellena con un valor de ejemplo.
 *
 * DELIBERADAMENTE NO incluye venues ni "upcoming events" (más allá de
 * tonight/featured) — esas listas ya son baratas de pedir por separado vía
 * venues.publicActive/events.publicActive (TanStack Query las cachea igual
 * de bien) y no aportan el mismo problema de latencia en cascada que
 * recurrencia/campaña (que si necesitan componerse en el servidor).
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, gte, desc } from "drizzle-orm";
import { tokenRules, tokenLedger, type TokenRule } from "../../../drizzle/schema";
import { getWalletByUserId, type AnyDbHandle } from "../tokens/tokenLedgerService";
import { countRecentEarnEvents, countDistinctVenuesVisited } from "../tokens/tokenLedgerService";
import { calculateBaseTokens, findApplicableCampaign } from "../tokens/tokenRuleEngine";
import { resolveMadridMoment, resolveOperationalDate } from "../tokens/tokenScheduleService";
import { listUserBenefits, listMarketplaceBenefits, type UserBenefitListItemWithDefinition, type MarketplaceBenefitItem } from "../../db/benefitsDb";
import { listActiveEvents, listFeaturedEvents, type EventListItem } from "../../db/eventsDb";
import { listMyTickets, type MyTicketWithEvent } from "../ticketing/ticketingDb";
import { getUnreadCount } from "../engagement/notificationsDb";
import { countActiveProposalsForUser } from "../community/communityDb";
import { ensureStudentProfile } from "../../db/studentsDb";
import { rankHomeFeed, type HomeFeedRanking } from "./homeFeedRanking";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

/** "lifetime" (Loyalty Production Hardening, 2026-08-14) — mismo criterio que tokenRuleEngine.windowStart: epoch cubre "desde siempre" sin lógica adicional. */
function windowStart(window: "day" | "week" | "month" | "lifetime", at: Date): Date {
  const d = new Date(at);
  if (window === "lifetime") return new Date(0);
  if (window === "day") { d.setHours(0, 0, 0, 0); return d; }
  if (window === "week") {
    const day = d.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diffToMonday);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface RecurrenceProgress {
  count: number;
  threshold: number;
  remaining: number;
  bonus: number;
  window: "day" | "week" | "month" | "lifetime";
}

export interface ActiveCampaignSummary {
  name: string;
  multiplier: number | null;
  bonusTokens: number | null;
}

export interface CrossVenueDiscovery {
  bonus: number;
  visited: number;
  threshold: number;
}

export interface HomeTicketEvent {
  id: number;
  name: string;
  slug: string;
  startsAt: Date;
  imageUrl: string | null;
}

export interface HomeTicket {
  id: number;
  qrToken: string | null;
  event: HomeTicketEvent | null;
}

export type HomeActivityType = "earned" | "spent" | "benefitUnlocked" | "benefitUsed";

export interface HomeActivityEntry {
  id: string;
  type: HomeActivityType;
  label: string;
  amount?: number;
  at: Date;
}

export interface MarketplaceRecommendation {
  id: number;
  name: string;
  nameEn: string | null;
  nameEs: string | null;
  tokenCost: number;
  imageUrl: string | null;
  destinationVenueId: number | null;
}

export interface ProfileCompleteness {
  percent: number;
  missingFieldKey: string | null;
}

export interface HomeSummary {
  walletBalance: number;
  earnedThisWeek: number;
  activeBenefit: UserBenefitListItemWithDefinition | null;
  recurrenceProgress: RecurrenceProgress | null;
  activeCampaign: ActiveCampaignSummary | null;
  tonightEvents: EventListItem[];
  featuredEvents: EventListItem[];
  /** STUDENT APP, PERSONALIZED HOME (nueva fase) — señales reales añadidas para componer Hero/For You sin waterfall nuevo, todas resueltas en el mismo Promise.all. */
  myTicketToday: HomeTicket | null;
  crossVenueDiscovery: CrossVenueDiscovery | null;
  recentActivity: HomeActivityEntry[];
  marketplaceRecommendation: MarketplaceRecommendation | null;
  unreadNotifications: number;
  activeCommunityCount: number;
  profileCompleteness: ProfileCompleteness;
  ranking: HomeFeedRanking;
}

/**
 * Eventos de "esta noche" — usa el día OPERATIVO de nightlife (límite a las
 * 06:00 Europe/Madrid, nunca medianoche de calendario), igual que
 * resolveOperationalDate ya usa venueVisitService/benefits (spec VENUE &
 * PARTNER APP §11). MG-01 (bug real encontrado durante la investigación):
 * antes se usaba resolveMadridMoment (medianoche de calendario) — un evento
 * que empieza, p.ej., a las 00:30 caía en el día de calendario SIGUIENTE, así
 * que un Student mirando la Home a las 22:00 dejaba de ver esa fiesta bajo
 * "Tonight" aunque fuera, en términos de nightlife, la misma noche. Con el
 * límite a las 06:00, tanto "ahora" (22:00) como el evento (00:30) resuelven
 * al mismo día operativo. Test de regresión: homeSummaryService.test.ts.
 */
export function filterTonight(events: EventListItem[], at: Date): EventListItem[] {
  const today = resolveOperationalDate(at);
  return events.filter(e => resolveOperationalDate(new Date(e.startsAt)) === today);
}

/**
 * Progreso de recurrencia SOLO informativo (nunca aplica ni acredita nada)
 * — misma selección de regla que tokenRuleEngine.applyRecurrenceBonus pero
 * de solo lectura, restringida a reglas global/comunidad (una regla
 * scope=venue no tiene sentido sin un venue concreto en contexto de Home).
 */
async function computeRecurrenceProgress(userId: number, communityId: number | undefined, at: Date, conn: AnyDbHandle): Promise<RecurrenceProgress | null> {
  const rows = await conn.select().from(tokenRules).where(and(
    eq(tokenRules.direction, "earn"),
    eq(tokenRules.origin, "recurrence"),
    eq(tokenRules.active, true)
  ));
  const candidates = rows.filter((r: TokenRule) =>
    (r.scope === "global" || (r.scope === "community" && r.scopeCommunityId === communityId)) &&
    r.recurrenceWindow != null && r.recurrenceThreshold != null &&
    (!r.startsAt || r.startsAt <= at) && (!r.endsAt || r.endsAt >= at)
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.priority - a.priority);
  const rule = candidates[0];

  const since = windowStart(rule.recurrenceWindow!, at);
  const count = rule.recurrenceMode === "distinct_venues"
    ? await countDistinctVenuesVisited(userId, since, conn)
    : await countRecentEarnEvents(userId, since, undefined, conn);

  return {
    count,
    threshold: rule.recurrenceThreshold!,
    remaining: Math.max(0, rule.recurrenceThreshold! - count),
    bonus: calculateBaseTokens(rule, {}),
    window: rule.recurrenceWindow!,
  };
}

async function sumEarnedSince(userId: number, since: Date, conn: AnyDbHandle): Promise<number> {
  const rows = await conn.select({ amount: tokenLedger.amount }).from(tokenLedger)
    .where(and(eq(tokenLedger.userId, userId), eq(tokenLedger.direction, "credit"), gte(tokenLedger.createdAt, since)));
  return rows.reduce((sum: number, r: { amount: number }) => sum + r.amount, 0);
}

/**
 * Oportunidad real de "descubre otro venue" (spec §16) — reutiliza la MISMA
 * regla de recurrencia distinct_venues ya activa en producción (hoy: +10 ST,
 * lifetime, umbral 2), nunca inventa un bono ni un umbral. Devuelve null si
 * no existe esa regla o si el Student ya la completó — la card solo debe
 * aparecer mientras sea una oportunidad real y accionable.
 */
async function computeCrossVenueDiscovery(userId: number, communityId: number | undefined, at: Date, conn: AnyDbHandle): Promise<CrossVenueDiscovery | null> {
  const rows = await conn.select().from(tokenRules).where(and(
    eq(tokenRules.direction, "earn"),
    eq(tokenRules.origin, "recurrence"),
    eq(tokenRules.recurrenceMode, "distinct_venues"),
    eq(tokenRules.active, true)
  ));
  const candidates = rows.filter((r: TokenRule) =>
    (r.scope === "global" || (r.scope === "community" && r.scopeCommunityId === communityId)) &&
    r.recurrenceThreshold != null &&
    (!r.startsAt || r.startsAt <= at) && (!r.endsAt || r.endsAt >= at)
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.priority - a.priority);
  const rule = candidates[0];

  const since = windowStart(rule.recurrenceWindow ?? "lifetime", at);
  const visited = await countDistinctVenuesVisited(userId, since, conn);
  if (visited >= rule.recurrenceThreshold!) return null;

  return { bonus: calculateBaseTokens(rule, {}), visited, threshold: rule.recurrenceThreshold! };
}

/** Ticket propio (nativo) para un evento de HOY (spec §12) — solo status="issued" expone qrToken, igual que ticketPurchase.myTickets. Nunca inventa un ticket si no hay ninguno real emitido. */
function pickTicketToday(tickets: MyTicketWithEvent[], at: Date): HomeTicket | null {
  const today = resolveMadridMoment(at).date;
  const match = tickets.find(t =>
    t.ticket.status === "issued" && t.event != null && resolveMadridMoment(new Date(t.event.startsAt)).date === today
  );
  if (!match || !match.event) return null;
  return {
    id: match.ticket.id,
    qrToken: match.ticket.qrToken,
    event: { id: match.event.id, name: match.event.name, slug: match.event.slug, startsAt: match.event.startsAt, imageUrl: match.event.imageUrl },
  };
}

/**
 * Traducción humana de los últimos movimientos (spec §17) — mismo criterio
 * de etiquetado que Activity.tsx (ledger.reason ya es texto legible, nunca
 * rule_id/ledger_id/idempotency_key), recortado a los `limit` más recientes
 * para la Home.
 */
async function computeRecentActivity(userId: number, userBenefits: UserBenefitListItemWithDefinition[], conn: AnyDbHandle, limit = 3): Promise<HomeActivityEntry[]> {
  const ledgerRows = await conn.select().from(tokenLedger)
    .where(eq(tokenLedger.userId, userId))
    .orderBy(desc(tokenLedger.createdAt))
    .limit(limit + 5);

  const entries: HomeActivityEntry[] = ledgerRows.map((r: typeof tokenLedger.$inferSelect) => ({
    id: `ledger-${r.id}`,
    type: r.direction === "credit" ? "earned" as const : "spent" as const,
    label: r.reason,
    amount: r.amount,
    at: r.createdAt,
  }));

  for (const b of userBenefits.slice(0, limit)) {
    entries.push({ id: `benefit-granted-${b.id}`, type: "benefitUnlocked", label: b.definition.name, at: b.grantedAt });
    if (b.usedAt) entries.push({ id: `benefit-used-${b.id}`, type: "benefitUsed", label: b.definition.name, at: b.usedAt });
  }

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** Recomendación de Marketplace (spec §14) — el Benefit disponible más barato que el Student YA puede permitirse con su saldo actual, para que el CTA sea siempre accionable de inmediato (nunca "casi te llega"). */
function pickMarketplaceRecommendation(items: MarketplaceBenefitItem[], walletBalance: number): MarketplaceRecommendation | null {
  const affordable = items
    .filter(i => i.marketplaceStatus === "available" && i.tokenCost != null && i.tokenCost <= walletBalance)
    .sort((a, b) => (a.tokenCost ?? 0) - (b.tokenCost ?? 0));
  const pick = affordable[0];
  if (!pick || pick.tokenCost == null) return null;
  return {
    id: pick.id,
    name: pick.name,
    nameEn: pick.nameEn ?? null,
    nameEs: pick.nameEs ?? null,
    tokenCost: pick.tokenCost,
    imageUrl: pick.imageUrl ?? null,
    destinationVenueId: pick.destinationVenueId ?? null,
  };
}

const COMPLETENESS_FIELDS: Array<{ key: string; check: (p: { firstName: string | null; lastName: string | null; universityId: number | null; academicYear: string | null; dateOfBirth: string | null; nationality: string | null; city: string | null }) => boolean }> = [
  { key: "firstName", check: p => !!p.firstName },
  { key: "lastName", check: p => !!p.lastName },
  { key: "universityId", check: p => p.universityId != null },
  { key: "academicYear", check: p => !!p.academicYear },
  { key: "dateOfBirth", check: p => !!p.dateOfBirth },
  { key: "nationality", check: p => !!p.nationality },
  { key: "city", check: p => !!p.city },
];

/** Cálculo ligero y determinista (spec §20) — no hay ningún porcentaje ya calculado en el sistema, solo el boolean `profileCompleted`, así que se deriva de los campos reales del perfil sin bloquear nada. */
function computeProfileCompleteness(profile: Parameters<typeof COMPLETENESS_FIELDS[number]["check"]>[0]): ProfileCompleteness {
  const missing = COMPLETENESS_FIELDS.filter(f => !f.check(profile));
  const percent = Math.round(((COMPLETENESS_FIELDS.length - missing.length) / COMPLETENESS_FIELDS.length) * 100);
  return { percent, missingFieldKey: missing[0]?.key ?? null };
}

export async function getHomeSummary(userId: number, communityId: number | undefined, db?: AnyDbHandle): Promise<HomeSummary> {
  const conn = db ?? (await getDb());
  const now = new Date();
  const weekStart = windowStart("week", now);

  const [
    wallet, earnedThisWeek, userBenefits, recurrenceProgress, activeCampaign, activeEvents, featuredEvents,
    crossVenueDiscovery, myTickets, unreadNotifications, activeCommunityCount, marketplace, profile,
  ] = await Promise.all([
    getWalletByUserId(userId, conn),
    sumEarnedSince(userId, weekStart, conn),
    listUserBenefits(userId, conn as never),
    computeRecurrenceProgress(userId, communityId, now, conn),
    findApplicableCampaign({ communityId, at: now }, conn),
    listActiveEvents(communityId, conn as never),
    listFeaturedEvents(communityId, conn as never),
    computeCrossVenueDiscovery(userId, communityId, now, conn),
    listMyTickets(userId, conn as never),
    getUnreadCount(userId, conn as never),
    countActiveProposalsForUser(userId, conn as never),
    listMarketplaceBenefits({ userId, communityId: communityId ?? null }, conn as never),
    ensureStudentProfile(userId, conn as never),
  ]);

  const activeBenefits = userBenefits
    .filter(b => b.status === "active")
    .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());

  const recentActivity = await computeRecentActivity(userId, userBenefits, conn);
  const walletBalance = wallet?.balance ?? 0;
  const tonightEvents = filterTonight(activeEvents, now);
  const myTicketToday = pickTicketToday(myTickets, now);
  const marketplaceRecommendation = pickMarketplaceRecommendation(marketplace, walletBalance);
  const profileCompleteness = computeProfileCompleteness(profile);
  const hasActiveBenefitToUse = activeBenefits.length > 0;

  const ranking = rankHomeFeed({
    hasTicketToday: myTicketToday != null,
    activeCommunityCount,
    hasActiveBenefitToUse,
    hasAffordableMarketplaceItem: marketplaceRecommendation != null,
    crossVenueAvailable: crossVenueDiscovery != null,
    profileCompletenessPercent: profileCompleteness.percent,
    hasTonightEvent: tonightEvents.length > 0,
  });

  return {
    walletBalance,
    earnedThisWeek,
    activeBenefit: activeBenefits[0] ?? null,
    recurrenceProgress,
    activeCampaign: activeCampaign ? {
      name: activeCampaign.name,
      multiplier: activeCampaign.multiplier != null ? Number(activeCampaign.multiplier) : null,
      bonusTokens: activeCampaign.bonusTokens,
    } : null,
    tonightEvents,
    featuredEvents,
    myTicketToday,
    crossVenueDiscovery,
    recentActivity,
    marketplaceRecommendation,
    unreadNotifications,
    activeCommunityCount,
    profileCompleteness,
    ranking,
  };
}
