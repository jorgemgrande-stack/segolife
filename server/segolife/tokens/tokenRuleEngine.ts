/**
 * tokenRuleEngine.ts — selección/cálculo de reglas, recurrencia y campañas
 * (Fase 2). Nunca hardcodea ratios: todo se lee de token_rules/token_campaigns.
 *
 * SELECCIÓN DE REGLA: entre las reglas activas cuyo scope encaja EXACTAMENTE
 * con lo pedido (direction+origin obligatorios; scope=venue exige que
 * scope_venue_id coincida, etc.), gana la de mayor `priority` — el admin
 * decide explícitamente qué regla es "más específica" ajustando ese número,
 * el motor no intenta adivinar jerarquías de scope.
 *
 * RECURRENCIA: se evalúa contando movimientos reales de token_ledger en la
 * ventana configurada (día/semana/mes) — nunca un contador aparte (ver
 * drizzle/schema.ts). El +1 en la comprobación de umbral es porque el
 * movimiento que está a punto de crearse todavía no existe en el ledger en
 * el momento de evaluar la regla.
 *
 * CAMPAÑAS: solo se aplica la de mayor prioridad que encaje (nunca se apilan
 * varias) — evita bonificaciones inexplicables. Una campaña sin ninguna fila
 * en campaign_communities/campaign_venues/campaign_events es global.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and } from "drizzle-orm";
import {
  tokenRules,
  tokenCampaigns,
  campaignCommunities,
  campaignVenues,
  campaignEvents,
  type TokenRule,
  type TokenCampaign,
} from "../../../drizzle/schema";
import { countRecentEarnEvents, countDistinctVenuesVisited, type AnyDbHandle } from "./tokenLedgerService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface RuleMatchScope {
  direction: "earn" | "spend";
  origin: TokenRule["origin"];
  communityId?: number | null;
  venueId?: number | null;
  eventId?: number | null;
  productId?: number | null;
  /** Loyalty Production Hardening (2026-08-14) — event_ticket_types.id real, resuelto por eventCatalogSync.ts vía external_entity_mappings. Nunca por nombre. */
  ticketTypeId?: number | null;
}

function isWithinDateWindow(rule: { startsAt: Date | null; endsAt: Date | null }, at: Date): boolean {
  if (rule.startsAt && rule.startsAt > at) return false;
  if (rule.endsAt && rule.endsAt < at) return false;
  return true;
}

/**
 * F61 (economía, prioridad y simulador) — desempate DETERMINISTA cuando dos
 * reglas activas coinciden en la misma acción: antes de esto, un empate
 * exacto de `priority` se resolvía por el orden crudo que devolviera MySQL
 * para un SELECT sin ORDER BY (no garantizado por el código, aunque en la
 * práctica coincidía con el orden de id) — mientras que el listado del
 * admin ordena por prioridad+fecha de creación descendente, lo que podía
 * sugerir "gana la más reciente" sin que eso fuera cierto en el motor real.
 * Nunca más ambiguo: 1) prioridad (mayor gana) → 2) especificidad del
 * alcance (evento > producto/tipo de entrada > venue > comunidad > global)
 * → 3) id más bajo (la regla configurada primero) como último desempate,
 * siempre determinista y estable ante cualquier orden de lectura de BD.
 */
const SCOPE_SPECIFICITY: Record<TokenRule["scope"], number> = {
  global: 0,
  community: 1,
  venue: 2,
  product: 3,
  ticket_type: 3,
  event: 4,
};

export function compareRulesByPrecedence(a: TokenRule, b: TokenRule): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const specA = SCOPE_SPECIFICITY[a.scope] ?? 0;
  const specB = SCOPE_SPECIFICITY[b.scope] ?? 0;
  if (specA !== specB) return specB - specA;
  return a.id - b.id;
}

function ruleMatchesScope(rule: TokenRule, scope: RuleMatchScope): boolean {
  switch (rule.scope) {
    case "global": return true;
    case "community": return rule.scopeCommunityId != null && rule.scopeCommunityId === scope.communityId;
    case "venue": return rule.scopeVenueId != null && rule.scopeVenueId === scope.venueId;
    case "event": return rule.scopeEventId != null && rule.scopeEventId === scope.eventId;
    case "product": return rule.scopeProductId != null && rule.scopeProductId === scope.productId;
    case "ticket_type": return rule.scopeTicketTypeId != null && rule.scopeTicketTypeId === scope.ticketTypeId;
    default: return false;
  }
}

export async function findApplicableRule(
  scope: RuleMatchScope,
  at: Date = new Date(),
  db?: AnyDbHandle
): Promise<TokenRule | null> {
  const conn = db ?? (await getDb());
  const rows = await conn.select().from(tokenRules).where(and(
    eq(tokenRules.direction, scope.direction),
    eq(tokenRules.origin, scope.origin),
    eq(tokenRules.active, true)
  ));
  const candidates = rows.filter(r => isWithinDateWindow(r, at) && ruleMatchesScope(r, scope));
  if (candidates.length === 0) return null;
  candidates.sort(compareRulesByPrecedence);
  return candidates[0];
}

/** Importe base según calc_method — sin aplicar aún recurrencia/campañas/límites. */
export function calculateBaseTokens(rule: TokenRule, params: { amountSpent?: number } = {}): number {
  const amountSpent = params.amountSpent ?? 0;
  if (rule.minSpend != null && amountSpent < Number(rule.minSpend)) return 0;

  let tokens = 0;
  switch (rule.calcMethod) {
    case "fixed":
      tokens = rule.fixedAmount ?? 0;
      break;
    case "per_euro":
      tokens = Math.floor((rule.rate != null ? Number(rule.rate) : 0) * amountSpent);
      break;
    case "percentage":
      tokens = Math.floor(amountSpent * ((rule.rate != null ? Number(rule.rate) : 0) / 100));
      break;
    case "multiplier":
      tokens = Math.floor(amountSpent * (rule.multiplier != null ? Number(rule.multiplier) : 0));
      break;
  }
  if (rule.maxTokens != null) tokens = Math.min(tokens, rule.maxTokens);
  return Math.max(0, tokens);
}

/**
 * "lifetime" (Loyalty Production Hardening, 2026-08-14) — devuelve epoch
 * (1970-01-01), que cubre "desde siempre" con la MISMA consulta
 * (`gte(createdAt, sinceDate)`) que ya usan day/week/month — ningún cambio
 * necesario en countRecentEarnEvents/countDistinctVenuesVisited. Habilita
 * hitos/first-action reales (spec §9: "5 visitas → +50, nunca se repite")
 * sin reiniciar el contador cada mes.
 */
function windowStart(window: "day" | "week" | "month" | "lifetime", at: Date): Date {
  const d = new Date(at);
  if (window === "lifetime") return new Date(0);
  if (window === "day") {
    d.setHours(0, 0, 0, 0);
    return d;
  }
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

export interface RecurrenceContext {
  userId: number;
  venueId?: number | null;
  communityId?: number | null;
  at?: Date;
}

export interface RecurrenceResult {
  bonus: number;
  rule: TokenRule | null;
}

/**
 * Evalúa reglas origin='recurrence' activas y devuelve el bonus de la
 * primera (mayor prioridad) cuyo umbral se cumple EXACTAMENTE con este
 * movimiento (p.ej. threshold=2 → dispara justo en la 2ª visita, no en la 3ª
 * ni siguientes, salvo que exista otra regla con threshold distinto).
 */
export async function applyRecurrenceBonus(ctx: RecurrenceContext, db?: AnyDbHandle): Promise<RecurrenceResult> {
  const conn = db ?? (await getDb());
  const at = ctx.at ?? new Date();
  const rows = await conn.select().from(tokenRules).where(and(
    eq(tokenRules.direction, "earn"),
    eq(tokenRules.origin, "recurrence"),
    eq(tokenRules.active, true)
  ));
  const candidates = rows.filter(r =>
    isWithinDateWindow(r, at) &&
    r.recurrenceWindow != null &&
    r.recurrenceThreshold != null &&
    ruleMatchesScope(r, { direction: "earn", origin: "recurrence", communityId: ctx.communityId, venueId: ctx.venueId })
  );
  if (candidates.length === 0) return { bonus: 0, rule: null };
  candidates.sort(compareRulesByPrecedence);

  for (const rule of candidates) {
    const since = windowStart(rule.recurrenceWindow!, at);
    const scopedVenueId = rule.scope === "venue" ? (ctx.venueId ?? undefined) : undefined;
    const count = rule.recurrenceMode === "distinct_venues"
      ? await countDistinctVenuesVisited(ctx.userId, since, conn)
      : await countRecentEarnEvents(ctx.userId, since, scopedVenueId, conn);
    // +1: el movimiento en curso todavía no está en el ledger al evaluar esto.
    if (count + 1 === rule.recurrenceThreshold) {
      return { bonus: calculateBaseTokens(rule, {}), rule };
    }
  }
  return { bonus: 0, rule: null };
}

export interface CampaignMatchScope {
  communityId?: number | null;
  venueId?: number | null;
  eventId?: number | null;
  at?: Date;
}

export async function findApplicableCampaign(scope: CampaignMatchScope, db?: AnyDbHandle): Promise<TokenCampaign | null> {
  const conn = db ?? (await getDb());
  const at = scope.at ?? new Date();
  const campaigns = await conn.select().from(tokenCampaigns).where(eq(tokenCampaigns.active, true));
  const withinWindow = campaigns.filter(c => isWithinDateWindow(c, at));
  if (withinWindow.length === 0) return null;

  const matches: TokenCampaign[] = [];
  for (const campaign of withinWindow) {
    const [communities, venues, events] = await Promise.all([
      conn.select({ communityId: campaignCommunities.communityId }).from(campaignCommunities)
        .where(eq(campaignCommunities.campaignId, campaign.id)),
      conn.select({ venueId: campaignVenues.venueId }).from(campaignVenues)
        .where(eq(campaignVenues.campaignId, campaign.id)),
      conn.select({ eventId: campaignEvents.eventId }).from(campaignEvents)
        .where(eq(campaignEvents.campaignId, campaign.id)),
    ]);
    const hasScopeRestriction = communities.length > 0 || venues.length > 0 || events.length > 0;
    if (!hasScopeRestriction) {
      matches.push(campaign);
      continue;
    }
    const matchesCommunity = communities.some(c => c.communityId === scope.communityId);
    const matchesVenue = venues.some(v => v.venueId === scope.venueId);
    const matchesEvent = events.some(e => e.eventId === scope.eventId);
    if (matchesCommunity || matchesVenue || matchesEvent) matches.push(campaign);
  }
  if (matches.length === 0) return null;
  // Las campañas no tienen un `scope` discriminado como las reglas (usan
  // tablas puente comunidad/venue/evento, cualquier coincidencia vale) — el
  // mismo desempate por especificidad no aplica aquí. Mismo criterio final
  // que las reglas: prioridad, y ante empate exacto, el id más bajo (la
  // campaña creada primero) — nunca el orden crudo de un SELECT sin ORDER BY.
  matches.sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : a.id - b.id));
  return matches[0];
}

/** Aplica multiplicador (redondeando hacia abajo) y luego bonus fijo — en ese orden. */
export function applyCampaignToAmount(campaign: TokenCampaign | null, amount: number): number {
  if (!campaign) return amount;
  let result = amount;
  if (campaign.multiplier != null) result = Math.floor(result * Number(campaign.multiplier));
  if (campaign.bonusTokens != null) result += campaign.bonusTokens;
  return result;
}
