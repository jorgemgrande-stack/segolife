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
import { eq, and, gte } from "drizzle-orm";
import { tokenRules, tokenLedger, type TokenRule } from "../../../drizzle/schema";
import { getWalletByUserId, type AnyDbHandle } from "../tokens/tokenLedgerService";
import { countRecentEarnEvents, countDistinctVenuesVisited } from "../tokens/tokenLedgerService";
import { calculateBaseTokens, findApplicableCampaign } from "../tokens/tokenRuleEngine";
import { resolveMadridMoment } from "../tokens/tokenScheduleService";
import { listUserBenefits, type UserBenefitListItemWithDefinition } from "../../db/benefitsDb";
import { listActiveEvents, listFeaturedEvents, type EventListItem } from "../../db/eventsDb";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

function windowStart(window: "day" | "week" | "month", at: Date): Date {
  const d = new Date(at);
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
  window: "day" | "week" | "month";
}

export interface ActiveCampaignSummary {
  name: string;
  multiplier: number | null;
  bonusTokens: number | null;
}

export interface HomeSummary {
  walletBalance: number;
  earnedThisWeek: number;
  activeBenefit: UserBenefitListItemWithDefinition | null;
  recurrenceProgress: RecurrenceProgress | null;
  activeCampaign: ActiveCampaignSummary | null;
  tonightEvents: EventListItem[];
  featuredEvents: EventListItem[];
}

/** Eventos cuyo starts_at cae en el día calendario de HOY en Europe/Madrid. */
function filterTonight(events: EventListItem[], at: Date): EventListItem[] {
  const today = resolveMadridMoment(at).date;
  return events.filter(e => resolveMadridMoment(new Date(e.startsAt)).date === today);
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

export async function getHomeSummary(userId: number, communityId: number | undefined, db?: AnyDbHandle): Promise<HomeSummary> {
  const conn = db ?? (await getDb());
  const now = new Date();
  const weekStart = windowStart("week", now);

  const [wallet, earnedThisWeek, userBenefits, recurrenceProgress, activeCampaign, activeEvents, featuredEvents] = await Promise.all([
    getWalletByUserId(userId, conn),
    sumEarnedSince(userId, weekStart, conn),
    listUserBenefits(userId, conn as never),
    computeRecurrenceProgress(userId, communityId, now, conn),
    findApplicableCampaign({ communityId, at: now }, conn),
    listActiveEvents(communityId, conn as never),
    listFeaturedEvents(communityId, conn as never),
  ]);

  const activeBenefits = userBenefits
    .filter(b => b.status === "active")
    .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());

  return {
    walletBalance: wallet?.balance ?? 0,
    earnedThisWeek,
    activeBenefit: activeBenefits[0] ?? null,
    recurrenceProgress,
    activeCampaign: activeCampaign ? {
      name: activeCampaign.name,
      multiplier: activeCampaign.multiplier != null ? Number(activeCampaign.multiplier) : null,
      bonusTokens: activeCampaign.bonusTokens,
    } : null,
    tonightEvents: filterTonight(activeEvents, now),
    featuredEvents,
  };
}
