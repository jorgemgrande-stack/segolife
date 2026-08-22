/**
 * economyGovernanceService.ts — SEGOLIFE FASE 10.5 (spec "AUDIT →
 * NORMALIZE → ORCHESTRATE → EXPOSE"). Capa de GOBIERNO sobre los motores
 * económicos YA EXISTENTES — token_rules/token_campaigns/
 * token_redemption_policies/referral_campaigns siguen siendo la ÚNICA
 * fuente de verdad. Este archivo NUNCA reimplementa una fórmula de earning
 * (reutiliza findApplicableRule/calculateBaseTokens de tokenRuleEngine.ts
 * sin cambios) — solo agrega visibilidad, detección de conflictos y un
 * punto de escritura auditado para los campos económicos concretos que
 * gobierna el Control Center.
 *
 * "PREVIEW DE REGLA POR ALCANCE" (spec §25/§26) es DISTINTO de
 * tokens.previewReward (evaluateReward SIMULATION, que YA existe y exige un
 * Student real para calcular topes/recurrencia reales) — aquí se responde
 * "¿qué regla ganaría para este venue/evento/comunidad EN GENERAL, y por
 * qué no las demás?" sin necesitar un Student, útil para que el admin
 * entienda la PRECEDENCIA antes de tocar nada.
 */
import { eq, and, desc, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  tokenRules, tokenCampaigns, tokenRedemptionPolicies, referralCampaigns,
  benefitDefinitions, economyConfigChanges, events, venueProducts,
  type TokenRule, type EconomyConfigChange,
} from "../../../drizzle/schema";
import { findApplicableRule, compareRulesByPrecedence, type RuleMatchScope } from "./tokenRuleEngine";
import { listTokenRules, updateTokenRule } from "../../db/tokenRulesDb";
import { listTokenRedemptionPolicies, createTokenRedemptionPolicy, updateTokenRedemptionPolicy } from "../../db/tokenRedemptionPoliciesDb";
import { createReferralCampaign, updateReferralCampaign, activateReferralCampaign, listReferralCampaigns } from "../referrals/referralService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class EconomyGovernanceError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "EconomyGovernanceError";
  }
}

// ─── Registro de auditoría (spec §56) ───────────────────────────────────────

export interface RecordConfigChangeInput {
  entityType: "token_rule" | "redemption_policy" | "campaign" | "referral_campaign";
  entityId: number;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  reason?: string | null;
  actorUserId: number;
}

export async function recordEconomyConfigChange(input: RecordConfigChangeInput, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.insert(economyConfigChanges).values({
    entityType: input.entityType, entityId: input.entityId, fieldName: input.fieldName,
    oldValue: input.oldValue, newValue: input.newValue, reason: input.reason ?? null, actorUserId: input.actorUserId,
  });
}

export async function listEconomyConfigChanges(limit = 100, db?: DbHandle): Promise<EconomyConfigChange[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(economyConfigChanges).orderBy(desc(economyConfigChanges.createdAt)).limit(limit);
}

// ─── Cambios seguros y auditados sobre configuración YA EXISTENTE ───────────
// Nunca crea una tabla/motor paralelo — delega en las funciones canónicas ya
// probadas (updateTokenRule/createTokenRedemptionPolicy/
// createReferralCampaign) y solo añade el registro de auditoría alrededor.

export async function applyTokenRuleValueChange(
  ruleId: number,
  fields: { fixedAmount?: number | null; rate?: string | null },
  actorUserId: number,
  reason: string,
  db?: DbHandle
): Promise<TokenRule> {
  const conn = db ?? (await getDb());
  const before = await conn.select().from(tokenRules).where(eq(tokenRules.id, ruleId)).limit(1);
  const existing = before[0];
  if (!existing) throw new EconomyGovernanceError("NOT_FOUND", "Regla no encontrada");

  const updated = await updateTokenRule(ruleId, fields, conn);
  if (!updated) throw new EconomyGovernanceError("NOT_FOUND", "Regla no encontrada");

  if (fields.fixedAmount !== undefined && fields.fixedAmount !== existing.fixedAmount) {
    await recordEconomyConfigChange({ entityType: "token_rule", entityId: ruleId, fieldName: "fixedAmount", oldValue: String(existing.fixedAmount), newValue: String(fields.fixedAmount), reason, actorUserId }, conn);
  }
  if (fields.rate !== undefined && fields.rate !== existing.rate) {
    await recordEconomyConfigChange({ entityType: "token_rule", entityId: ruleId, fieldName: "rate", oldValue: existing.rate, newValue: fields.rate, reason, actorUserId }, conn);
  }
  return updated;
}

export interface SetGlobalRedemptionConversionInput {
  tokensPerUnit: number;
  valueCentsPerUnit: number;
  maxPercentage?: number;
  allowFullTokenPayment?: boolean;
  actorUserId: number;
  reason: string;
}

/** Crea (si no existe ninguna) o actualiza la política GLOBAL (community/venue/event null) — spec §10/§13. */
export async function setGlobalRedemptionConversion(input: SetGlobalRedemptionConversionInput, db?: DbHandle) {
  const conn = db ?? (await getDb());
  const all = await listTokenRedemptionPolicies(conn);
  const global = all.find(p => p.communityId == null && p.venueId == null && p.eventId == null);

  if (global) {
    const updated = await updateTokenRedemptionPolicy(global.id, {
      tokensPerUnit: input.tokensPerUnit, valueCentsPerUnit: input.valueCentsPerUnit,
      maxPercentage: input.maxPercentage, allowFullTokenPayment: input.allowFullTokenPayment,
    }, conn);
    if (input.valueCentsPerUnit !== global.valueCentsPerUnit || input.tokensPerUnit !== global.tokensPerUnit) {
      await recordEconomyConfigChange({
        entityType: "redemption_policy", entityId: global.id, fieldName: "conversion",
        oldValue: `${global.tokensPerUnit} ST = ${global.valueCentsPerUnit}c`, newValue: `${input.tokensPerUnit} ST = ${input.valueCentsPerUnit}c`,
        reason: input.reason, actorUserId: input.actorUserId,
      }, conn);
    }
    return updated!;
  }

  const created = await createTokenRedemptionPolicy({
    communityId: null, venueId: null, eventId: null,
    tokensPerUnit: input.tokensPerUnit, valueCentsPerUnit: input.valueCentsPerUnit,
    minTokenSpend: null, maxTokenSpend: null,
    maxPercentage: input.maxPercentage ?? 100, allowFullTokenPayment: input.allowFullTokenPayment ?? true,
    active: true, priority: 0, createdByUserId: input.actorUserId,
  } as never, conn);
  await recordEconomyConfigChange({
    entityType: "redemption_policy", entityId: created.id, fieldName: "conversion",
    oldValue: null, newValue: `${input.tokensPerUnit} ST = ${input.valueCentsPerUnit}c`,
    reason: input.reason, actorUserId: input.actorUserId,
  }, conn);
  return created;
}

export interface SetGlobalReferralEconomicsInput {
  inviterRewardTokens: number;
  inviteeRewardTokens: number;
  // "verified_student" excluido a propósito — auditoría Fase 8 (referral)
  // confirmó que no existe ningún hecho real de verificación en el repo, el
  // propio admin builder (ReferralsAdmin.tsx) ya lo excluye de su selector.
  conversionCondition: "account_created" | "profile_completed" | "first_venue_visit" | "first_event_attendance";
  actorUserId: number;
  reason: string;
}

/** Crea (si no existe ninguna campaña global activa) o actualiza la ECONOMÍA de la campaña global de referidos — Referral Engine (Fase 8) sigue siendo el propietario canónico, spec §6. */
export async function setGlobalReferralEconomics(input: SetGlobalReferralEconomicsInput, db?: DbHandle) {
  const conn = db ?? (await getDb());
  const campaigns = await listReferralCampaigns(conn);
  const globalActive = campaigns.find(c => c.communityId == null && c.status === "active");

  if (globalActive) {
    const updated = await updateReferralCampaign(globalActive.id, {
      inviterRewardTokens: input.inviterRewardTokens, inviteeRewardTokens: input.inviteeRewardTokens,
    }, conn);
    if (globalActive.inviterRewardTokens !== input.inviterRewardTokens || globalActive.inviteeRewardTokens !== input.inviteeRewardTokens) {
      await recordEconomyConfigChange({
        entityType: "referral_campaign", entityId: globalActive.id, fieldName: "rewards",
        oldValue: `inviter=${globalActive.inviterRewardTokens},invitee=${globalActive.inviteeRewardTokens}`,
        newValue: `inviter=${input.inviterRewardTokens},invitee=${input.inviteeRewardTokens}`,
        reason: input.reason, actorUserId: input.actorUserId,
      }, conn);
    }
    return updated;
  }

  const created = await createReferralCampaign({
    name: "SEGOLIFE Economy V1 — Invitaciones",
    communityId: null,
    inviterRewardTokens: input.inviterRewardTokens,
    inviteeRewardTokens: input.inviteeRewardTokens,
    conversionCondition: input.conversionCondition,
    attributionWindowDays: 30,
    maxRewardsPerInviter: null,
    maxTotalConversions: null,
    budgetTokens: null,
    priority: 0,
    startsAt: null,
    endsAt: null,
    createdByUserId: input.actorUserId,
  }, conn);
  const activated = await activateReferralCampaign(created.id, input.actorUserId, conn);
  await recordEconomyConfigChange({
    entityType: "referral_campaign", entityId: created.id, fieldName: "rewards",
    oldValue: null, newValue: `inviter=${input.inviterRewardTokens},invitee=${input.inviteeRewardTokens}`,
    reason: input.reason, actorUserId: input.actorUserId,
  }, conn);
  return activated;
}

// ─── Detección de conflictos (spec §22/§24) ─────────────────────────────────

export interface EconomyConflict {
  severity: "warning" | "conflict" | "not_connected";
  code: string;
  message: string;
}

function scopeKey(r: Pick<TokenRule, "scope" | "scopeVenueId" | "scopeEventId" | "scopeCommunityId" | "scopeProductId" | "scopeTicketTypeId">): string {
  return [r.scope, r.scopeVenueId, r.scopeEventId, r.scopeCommunityId, r.scopeProductId, r.scopeTicketTypeId].join(":");
}

/** F61 — ¿los rangos [startsAt,endsAt] de dos reglas se solapan en algún instante? null = sin límite en ese extremo. */
function windowsOverlap(a: Pick<TokenRule, "startsAt" | "endsAt">, b: Pick<TokenRule, "startsAt" | "endsAt">): boolean {
  const aStart = a.startsAt ?? new Date(-8_640_000_000_000_000);
  const aEnd = a.endsAt ?? new Date(8_640_000_000_000_000);
  const bStart = b.startsAt ?? new Date(-8_640_000_000_000_000);
  const bEnd = b.endsAt ?? new Date(8_640_000_000_000_000);
  return aStart <= bEnd && bStart <= aEnd;
}

/** ¿Existe al menos un PAR dentro del grupo cuyas ventanas de fecha se solapen? (evita falsos positivos: dos reglas del mismo alcance pero vigentes en periodos disjuntos — p.ej. una de enero-junio y otra de julio-diciembre — nunca compiten de verdad). */
function hasOverlappingPair(group: TokenRule[]): boolean {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      if (windowsOverlap(group[i], group[j])) return true;
    }
  }
  return false;
}

function ruleLabel(r: TokenRule): string {
  return `"${r.name}" (id=${r.id}, priority=${r.priority}, scope=${r.scope})`;
}

export async function detectEconomyConflicts(db?: DbHandle): Promise<EconomyConflict[]> {
  const conn = db ?? (await getDb());
  const conflicts: EconomyConflict[] = [];

  const rules = await listTokenRules(conn);
  const activeEarn = rules.filter(r => r.active && r.direction === "earn");
  const byOrigin = new Map<string, TokenRule[]>();
  for (const r of activeEarn) {
    const arr = byOrigin.get(r.origin) ?? [];
    arr.push(r);
    byOrigin.set(r.origin, arr);
  }

  // Alcance EXACTAMENTE idéntico (misma reglas de siempre) — ahora solo se
  // marca si además hay al menos un par cuya ventana de fechas realmente se
  // solapa (spec F61 "ventanas temporales solapadas"); dos reglas del mismo
  // alcance vigentes en periodos disjuntos no son un conflicto real.
  byOrigin.forEach((group, origin) => {
    const byScope = new Map<string, TokenRule[]>();
    for (const r of group) {
      const key = scopeKey(r);
      const arr = byScope.get(key) ?? [];
      arr.push(r);
      byScope.set(key, arr);
    }
    byScope.forEach((sameScope, key) => {
      if (sameScope.length > 1 && hasOverlappingPair(sameScope)) {
        conflicts.push({
          severity: "conflict",
          code: "OVERLAPPING_RULES",
          message: `${sameScope.length} reglas activas de "${origin}" comparten exactamente el mismo alcance (${key}) y sus ventanas de fecha se solapan — el desempate por priority puede ser accidental. Reglas: ${sameScope.map(ruleLabel).join(", ")}.`,
        });
      }
    });
  });

  // F61 — cruces REALES entre alcances distintos que el detector anterior
  // nunca veía (p.ej. una regla general de un venue vs. una específica de un
  // evento de ESE MISMO venue): el motor real (findApplicableRule) SÍ las
  // hace competir entre sí, así que el detector debe verlo también. Se
  // resuelven las relaciones físicas reales (evento→venue, producto→venue)
  // en vez de asumirlas — nunca se avisa de un cruce que no puede ocurrir.
  const eventIds = Array.from(new Set(activeEarn.map(r => r.scopeEventId).filter((id): id is number => id != null)));
  const productIds = Array.from(new Set(activeEarn.map(r => r.scopeProductId).filter((id): id is number => id != null)));
  const [eventRows, productRows] = await Promise.all([
    eventIds.length ? conn.select({ id: events.id, venueId: events.venueId }).from(events).where(inArray(events.id, eventIds)) : Promise.resolve([]),
    productIds.length ? conn.select({ id: venueProducts.id, venueId: venueProducts.venueId }).from(venueProducts).where(inArray(venueProducts.id, productIds)) : Promise.resolve([]),
  ]);
  const eventVenueById = new Map(eventRows.map(e => [e.id, e.venueId]));
  const productVenueById = new Map(productRows.map(p => [p.id, p.venueId]));

  function scopesCanOverlap(a: TokenRule, b: TokenRule): boolean {
    if (a.scope === "global" || b.scope === "global") return true; // global siempre compite con cualquier otra
    if (a.scope === "venue" && b.scope === "event") return eventVenueById.get(b.scopeEventId!) === a.scopeVenueId;
    if (a.scope === "event" && b.scope === "venue") return eventVenueById.get(a.scopeEventId!) === b.scopeVenueId;
    if (a.scope === "venue" && b.scope === "product") return productVenueById.get(b.scopeProductId!) === a.scopeVenueId;
    if (a.scope === "product" && b.scope === "venue") return productVenueById.get(a.scopeProductId!) === b.scopeVenueId;
    return false; // community/ticket_type cruzados con otro alcance: relación real no resuelta todavía, no se adivina.
  }

  byOrigin.forEach((group, origin) => {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (a.scope === b.scope) continue; // ya cubierto arriba (mismo alcance exacto)
        if (!scopesCanOverlap(a, b) || !windowsOverlap(a, b)) continue;
        const samePriority = a.priority === b.priority;
        conflicts.push({
          severity: samePriority ? "conflict" : "warning",
          code: "CROSS_SCOPE_OVERLAP",
          message: samePriority
            ? `Dos reglas activas de "${origin}" con alcances distintos pueden aplicar a la misma acción real y tienen LA MISMA prioridad — el desempate no es evidente. ${ruleLabel(a)} vs. ${ruleLabel(b)}.`
            : `Dos reglas activas de "${origin}" con alcances distintos pueden aplicar a la misma acción real; hoy gana siempre la de mayor prioridad. ${ruleLabel(a.priority >= b.priority ? a : b)} prevalece sobre ${ruleLabel(a.priority >= b.priority ? b : a)}.`,
        });
      }
    }
  });

  const policies = await listTokenRedemptionPolicies(conn);
  if (!policies.some(p => p.active)) {
    conflicts.push({ severity: "warning", code: "NO_REDEMPTION_POLICY", message: "No hay ninguna política de canje de SegoTokens activa — Universal Spend no puede aplicarse a ninguna compra todavía." });
  }

  const referrals = await listReferralCampaigns(conn);
  if (!referrals.some(c => c.status === "active")) {
    conflicts.push({ severity: "warning", code: "NO_REFERRAL_CAMPAIGN", message: "No hay ninguna campaña de referidos activa — las invitaciones no conceden recompensa todavía." });
  }

  // Community — spec §7/§8: idea_submitted nunca tiene productor real (auditado), se informa siempre como NOT_CONNECTED.
  conflicts.push({ severity: "not_connected", code: "COMMUNITY_IDEA_SUBMITTED_NOT_CONNECTED", message: "\"Idea propuesta\" no tiene ningún productor real todavía — enviar una idea en COMUNITY nunca concede SegoTokens (spec §7)." });

  return conflicts;
}

// ─── Preview de regla por ALCANCE, sin Student (spec §25/§26) ──────────────

export interface RuleScopePreviewResult {
  effectiveRule: TokenRule | null;
  candidates: Array<Pick<TokenRule, "id" | "name" | "priority" | "scope">>;
}

export async function previewRuleForScope(scope: RuleMatchScope, db?: DbHandle): Promise<RuleScopePreviewResult> {
  const conn = db ?? (await getDb());
  const effectiveRule = await findApplicableRule(scope, new Date(), conn);
  const all = await conn.select().from(tokenRules).where(and(eq(tokenRules.direction, scope.direction), eq(tokenRules.origin, scope.origin), eq(tokenRules.active, true)));
  // F61 — ordenadas por la MISMA precedencia real (prioridad → especificidad
  // → id) que decide `effectiveRule`, nunca el orden crudo de lectura de BD:
  // el admin debe poder leer esta lista de arriba a abajo como "quién gana,
  // luego quién sería el siguiente", no una lista sin relación con el ganador.
  return {
    effectiveRule,
    candidates: all
      .slice()
      .sort(compareRulesByPrecedence)
      .map(r => ({ id: r.id, name: r.name, priority: r.priority, scope: r.scope })),
  };
}

// ─── Overview consolidado (spec §17/§18/§70) ────────────────────────────────

export interface EconomyOriginSummary {
  origin: string;
  label: string;
  rule: TokenRule | null;
  connected: boolean;
  effectiveReturnPercent: number | null;
}

function effectiveReturnPercent(rule: TokenRule | null, globalPolicy: { tokensPerUnit: number; valueCentsPerUnit: number } | null): number | null {
  if (!rule || !globalPolicy || rule.calcMethod !== "per_euro" || rule.rate == null) return null;
  const centsPerToken = globalPolicy.valueCentsPerUnit / globalPolicy.tokensPerUnit;
  return Number(rule.rate) * centsPerToken; // spec §19 — fórmula documentada: 100 ST=100c → centsPerToken=1 → 5 ST/€ × 1 = 5%
}

export interface EconomyGovernanceOverview {
  redemptionConversion: { tokensPerUnit: number; valueCentsPerUnit: number; active: boolean } | null;
  earn: EconomyOriginSummary[];
  campaignsActiveCount: number;
  referralCampaigns: Array<{ id: number; name: string; status: string; inviterRewardTokens: number; inviteeRewardTokens: number; communityId: number | null }>;
  marketplace: { benefitCount: number; minTokenCost: number | null; maxTokenCost: number | null };
  conflicts: EconomyConflict[];
}

const ORIGIN_LABELS: Record<string, string> = {
  attendance: "Asistencia",
  consumption: "Consumiciones",
  ticket: "Entradas",
  recurrence: "Recurrencia / cross-venue",
  community_response: "Participación en COMUNITY",
  community_proposal_approved: "Propuesta aprobada en COMUNITY",
};

export async function getEconomyGovernanceOverview(db?: DbHandle): Promise<EconomyGovernanceOverview> {
  const conn = db ?? (await getDb());
  const [rules, policies, campaigns, referrals, benefits, conflicts] = await Promise.all([
    listTokenRules(conn),
    listTokenRedemptionPolicies(conn),
    conn.select().from(tokenCampaigns).where(eq(tokenCampaigns.active, true)),
    listReferralCampaigns(conn),
    conn.select().from(benefitDefinitions).where(eq(benefitDefinitions.isMarketplaceEnabled, true)),
    detectEconomyConflicts(conn),
  ]);

  const globalPolicy = policies.find(p => p.communityId == null && p.venueId == null && p.eventId == null && p.active) ?? null;

  const earnOrigins = ["ticket", "consumption", "attendance", "recurrence", "community_response", "community_proposal_approved"];
  const earn: EconomyOriginSummary[] = earnOrigins.map(origin => {
    const candidates = rules.filter(r => r.active && r.direction === "earn" && r.origin === origin && r.scope === "global");
    candidates.sort((a, b) => b.priority - a.priority);
    const rule = candidates[0] ?? null;
    return {
      // Todos los origins de esta lista tienen productor real confirmado por
      // auditoría (incluye community_response/community_proposal_approved).
      // "Idea propuesta" (idea_submitted) NO tiene productor y deliberadamente
      // no aparece aquí — se informa aparte en detectEconomyConflicts().
      origin, label: ORIGIN_LABELS[origin] ?? origin, rule, connected: true,
      effectiveReturnPercent: globalPolicy ? effectiveReturnPercent(rule, globalPolicy) : null,
    };
  });

  const tokenCosts = benefits.map(b => b.tokenCost).filter((v): v is number => v != null);

  return {
    redemptionConversion: globalPolicy ? { tokensPerUnit: globalPolicy.tokensPerUnit, valueCentsPerUnit: globalPolicy.valueCentsPerUnit, active: globalPolicy.active } : null,
    earn,
    campaignsActiveCount: campaigns.length,
    referralCampaigns: referrals.map(r => ({ id: r.id, name: r.name, status: r.status, inviterRewardTokens: r.inviterRewardTokens, inviteeRewardTokens: r.inviteeRewardTokens, communityId: r.communityId })),
    marketplace: { benefitCount: benefits.length, minTokenCost: tokenCosts.length ? Math.min(...tokenCosts) : null, maxTokenCost: tokenCosts.length ? Math.max(...tokenCosts) : null },
    conflicts,
  };
}
