/**
 * benefitRuleEngine.ts — motor de reglas y punto de entrada genérico del
 * módulo de Benefits (Fase 4). `evaluateBenefitsForOrigin` es la ÚNICA
 * función que otros módulos deben llamar para preguntar "¿esta acción
 * desbloquea algún Benefit?" — DELIBERADAMENTE genérica y desacoplada de
 * consumptionQrService.ts (Fase 3): el canje de QR de consumición hoy es el
 * único llamador real, pero Fourvenues (Fase 5 futura) podrá enviar
 * `type: "event_attendance"` sin que este motor cambie una línea (ver
 * informe de fase, punto de integración).
 *
 * SELECCIÓN DE REGLAS — DECISIÓN DE DISEÑO MANTENIDA EXPLÍCITAMENTE (revisada
 * y confirmada en el cierre de Fase 4, no cambiar a "gana la de mayor
 * prioridad" sin una instrucción explícita nueva): a diferencia de
 * tokenRuleEngine.findApplicableRule (donde solo UNA regla gana por
 * prioridad), aquí TODAS las reglas activas que encajan se evalúan y pueden
 * conceder, cada una de forma independiente — un Benefit es un desbloqueo
 * ADITIVO, no un cálculo competitivo como el importe de SegoTokens. Una
 * misma consumición puede producir tokens + Benefit A + Benefit B a la vez,
 * cada uno protegido por sus propios límites/idempotencia (ver
 * benefitGrantService.ts). `priority` es ORDEN de evaluación, NUNCA
 * exclusividad: determina qué regla reclama primero un hueco de `max_total`
 * casi agotado, no cuál "gana" frente a las demás — dos reglas de prioridad
 * distinta que ambas encajan y tienen hueco disponible CONCEDEN LAS DOS.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and } from "drizzle-orm";
import {
  benefitRules,
  benefitDefinitions,
  benefitCommunities,
  type BenefitRule,
  type BenefitDefinition,
  type UserBenefit,
} from "../../../drizzle/schema";
import { type AnyDbHandle, countRecentEarnEvents } from "../tokens/tokenLedgerService";
import { isWithinTimeRange, resolveMadridMoment } from "../tokens/tokenScheduleService";
import { computeValidityWindow } from "./benefitValidityEngine";
import { evaluateAggregateMetric, aggregateWindowStart } from "./benefitAggregateMetrics";
import {
  grantBenefit,
  countGrantsByRuleForUser,
  countGrantsByRuleForUserSince,
  countGrantsByRuleTotal,
  hasGrantForOrigin,
} from "./benefitGrantService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface BenefitOrigin {
  type: BenefitRule["sourceType"];
  userId: number;
  venueId?: number | null;
  eventId?: number | null;
  productId?: number | null;
  amountCents?: number | null;
  communityId?: number | null;
  /** Id "natural" del registro origen en su propio módulo (p.ej. consumption_qr_codes.id) — usado para trazabilidad (user_benefits.source_id) e idempotencia. Independiente de sourceLedgerId. */
  sourceId?: number | null;
  /** Id del movimiento de token_ledger si esta acción también generó SegoTokens (Fase 2) — null si esta acción no pasó por el motor de tokens. */
  ledgerId?: number | null;
  occurredAt: Date;
}

export interface UnlockedBenefit {
  userBenefit: UserBenefit;
  definition: BenefitDefinition;
  rule: BenefitRule;
  /** Token en claro del QR de este Benefit — ver benefitGrantService.grantBenefit. */
  qrToken: string;
}

function isWithinDateWindow(rule: { startsAt: Date | null; endsAt: Date | null }, at: Date): boolean {
  if (rule.startsAt && rule.startsAt > at) return false;
  if (rule.endsAt && rule.endsAt < at) return false;
  return true;
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

function ruleMatchesOrigin(rule: BenefitRule, origin: BenefitOrigin, moment: { dayOfWeek: number; time: string }): boolean {
  // SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6, spec §17/§18,
  // "NO HISTORICAL REWARD BLAST"): un hecho real cuyo occurredAt es ANTERIOR
  // a la creación de la regla nunca puede desencadenarla — sin este guard,
  // una sincronización tardía de Fourvenues que ingiera HOY una asistencia
  // de hace 3 semanas (idempotencyKey nueva porque nunca se había visto)
  // calificaría retroactivamente para una regla creada esta mañana, aunque
  // el evento ya hubiera pasado antes de que la regla existiera. No depende
  // de rule.startsAt (eso es la ventana de campaña que el admin configura a
  // propósito) — este corte es SIEMPRE implícito, usando una columna que ya
  // existe (created_at), sin migración adicional.
  if (origin.occurredAt < rule.createdAt) return false;
  if (rule.sourceVenueId != null && rule.sourceVenueId !== origin.venueId) return false;
  if (rule.sourceEventId != null && rule.sourceEventId !== origin.eventId) return false;
  if (rule.sourceProductId != null && rule.sourceProductId !== origin.productId) return false;
  if (rule.communityId != null && rule.communityId !== origin.communityId) return false;
  if (rule.minAmountCents != null && (origin.amountCents ?? 0) < rule.minAmountCents) return false;
  if (!isWithinDateWindow(rule, origin.occurredAt)) return false;
  if (rule.conditionDaysOfWeek && rule.conditionDaysOfWeek.length > 0 && !rule.conditionDaysOfWeek.includes(moment.dayOfWeek)) return false;
  if (rule.conditionStartTime && rule.conditionEndTime && !isWithinTimeRange(moment.time, rule.conditionStartTime, rule.conditionEndTime)) return false;
  return true;
}

async function findApplicableBenefitRules(origin: BenefitOrigin, conn: AnyDbHandle): Promise<BenefitRule[]> {
  const rows = await conn.select().from(benefitRules).where(and(
    eq(benefitRules.sourceType, origin.type),
    eq(benefitRules.active, true)
  ));
  const moment = resolveMadridMoment(origin.occurredAt);
  return rows.filter(r => ruleMatchesOrigin(r, origin, moment)).sort((a, b) => b.priority - a.priority);
}

async function isDefinitionAllowedForCommunity(benefitDefinitionId: number, communityId: number, conn: AnyDbHandle): Promise<boolean> {
  const rows = await conn.select({ communityId: benefitCommunities.communityId }).from(benefitCommunities)
    .where(eq(benefitCommunities.benefitDefinitionId, benefitDefinitionId));
  if (rows.length === 0) return true; // sin filas = sin restricción de comunidad
  return rows.some(r => r.communityId === communityId);
}

/**
 * Únicamente para uso interno del motor — comprueba la condición de
 * recurrencia/agregado de la regla, si la define.
 *
 * SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6): `aggregate_metric`
 * (nuevo, spec §6/§7) tiene PRIORIDAD sobre `min_visits`/`recurrence_window`
 * (legacy, Fase 4) cuando ambos están presentes — cuenta sobre la tabla de
 * hechos real correspondiente (ver benefitAggregateMetrics.ts), nunca sobre
 * token_ledger. El hecho que dispara esta evaluación YA está commiteado en
 * su propia tabla en este punto (a diferencia del ledger legacy, que se
 * escribe en un paso posterior) — por eso aquí NO se suma +1, el conteo ya
 * incluye el hecho actual.
 */
async function passesRecurrenceCondition(rule: BenefitRule, origin: BenefitOrigin, conn: AnyDbHandle): Promise<boolean> {
  if (rule.aggregateMetric != null && rule.aggregateThreshold != null) {
    const window = rule.recurrenceWindow ?? "day";
    return evaluateAggregateMetric(rule.aggregateMetric, window, rule.aggregateThreshold, origin.userId, origin.venueId, origin.occurredAt, conn);
  }
  if (rule.minVisits == null || rule.recurrenceWindow == null) return true;
  const since = windowStart(rule.recurrenceWindow, origin.occurredAt);
  const visits = await countRecentEarnEvents(origin.userId, since, origin.venueId ?? undefined, conn);
  // +1: la visita que dispara esta evaluación aún no está reflejada en el ledger consultado.
  return visits + 1 >= rule.minVisits;
}

async function passesLimits(rule: BenefitRule, origin: BenefitOrigin, conn: AnyDbHandle): Promise<boolean> {
  if (rule.oncePerOrigin && origin.sourceId != null) {
    if (await hasGrantForOrigin(rule.id, origin.type, origin.sourceId, conn)) return false;
  }
  if (rule.oncePerRule || rule.maxPerUser != null) {
    const grantedToUser = await countGrantsByRuleForUser(origin.userId, rule.id, conn);
    if (rule.oncePerRule && grantedToUser > 0) return false;
    if (rule.maxPerUser != null && grantedToUser >= rule.maxPerUser) return false;
  }
  if (rule.maxPerDay != null) {
    const dayStart = windowStart("day", origin.occurredAt);
    const grantedToday = await countGrantsByRuleForUserSince(origin.userId, rule.id, dayStart, conn);
    if (grantedToday >= rule.maxPerDay) return false;
  }
  if (rule.maxTotal != null) {
    const grantedTotal = await countGrantsByRuleTotal(rule.id, conn);
    if (grantedTotal >= rule.maxTotal) return false;
  }
  return true;
}

/**
 * Idempotencia legible — ver drizzle/schema.ts (comentario de user_benefits)
 * y el informe de fase para el razonamiento de por qué se usa
 * origin.type/origin.sourceId en vez del literal "consumption_qr" sugerido
 * en el enunciado (el motor es deliberadamente agnóstico del módulo origen
 * concreto).
 *
 * SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6, spec §13/§14,
 * "THRESHOLD CROSSING — CRITICAL"): cuando `rule.once_per_rule` es true, la
 * clave YA NO incluye `origin.sourceId` — con reglas de agregado (p.ej. "5
 * consumiciones"), dos hechos DISTINTOS (transacción #5 y #6, o dos
 * evaluaciones concurrentes de la misma) podrían cruzar el umbral casi a la
 * vez; con una clave por-hecho, `passesLimits()` (check-then-act sobre
 * countGrantsByRuleForUser) tiene una ventana de carrera real donde ambas
 * lecturas ven "0 concedidos todavía" antes de que cualquiera confirme. Con
 * una clave FIJA por (regla, usuario) — sin sourceId — cualquier intento
 * concurrente de conceder colisiona en el MISMO unique constraint que
 * grantBenefit() ya resuelve de forma segura (captura errno 1062 y
 * re-consulta, ver benefitGrantService.ts) — la base de datos, no una
 * condición de carrera en memoria, es quien decide cuál gana.
 */
function buildIdempotencyKey(rule: BenefitRule, origin: BenefitOrigin, index: number): string | null {
  if (rule.oncePerRule) {
    const base = `benefit_rule:${rule.id}:once:user:${origin.userId}`;
    return rule.quantity > 1 ? `${base}:${index}` : base;
  }
  // PRE-16.15 (auditoría overnight, bug real): passesRecurrenceCondition
  // evalúa "¿el conteo DENTRO de esta ventana ya alcanzó el umbral?" — una
  // vez cruzado, el conteo solo puede crecer, así que la condición sigue
  // siendo true para CUALQUIER hecho posterior dentro de la MISMA ventana.
  // Sin esto, cada hecho adicional generaba una clave distinta (por
  // sourceId) y volvía a conceder sin límite mientras el umbral siguiera
  // superado — nunca se "re-otorgaba conscientemente", solo no paraba.
  // Clave fija por (regla, usuario, inicio de ventana): concede una única
  // vez por ventana y SÍ vuelve a conceder en la ventana siguiente — la
  // recurrencia entre ventanas es intencional (spec §7), no se rompe aquí.
  if (rule.aggregateMetric != null && rule.aggregateThreshold != null) {
    const window = rule.recurrenceWindow ?? "day";
    const since = aggregateWindowStart(window, origin.occurredAt);
    const base = `benefit_rule:${rule.id}:aggregate:${since.getTime()}:user:${origin.userId}`;
    return rule.quantity > 1 ? `${base}:${index}` : base;
  }
  if (origin.sourceId == null) return null;
  const base = `benefit_rule:${rule.id}:${origin.type}:${origin.sourceId}:user:${origin.userId}`;
  return rule.quantity > 1 ? `${base}:${index}` : base;
}

/**
 * Concede (o no) UNA regla ya pre-filtrada (recurrencia/definición/comunidad
 * ya comprobadas por el llamador) — separada de `evaluateBenefitsForOrigin`
 * para poder envolverla, cuando la regla tiene un tope numérico, en su
 * propia transacción con lock de fila (ver más abajo, PRE-16.15 BUG:
 * concurrencia de topes de concesión).
 */
async function checkLimitsAndGrant(
  rule: BenefitRule, origin: BenefitOrigin, definition: BenefitDefinition, conn: AnyDbHandle,
): Promise<UnlockedBenefit[]> {
  if (!(await passesLimits(rule, origin, conn))) return [];

  const window = computeValidityWindow(rule, origin.occurredAt);
  const quantity = Math.max(1, rule.quantity);
  const results: UnlockedBenefit[] = [];
  for (let i = 0; i < quantity; i++) {
    const granted = await grantBenefit({
      userId: origin.userId,
      benefitDefinitionId: rule.benefitDefinitionId,
      benefitRuleId: rule.id,
      sourceType: origin.type,
      sourceId: origin.sourceId ?? null,
      sourceVenueId: origin.venueId ?? null,
      sourceEventId: origin.eventId ?? null,
      sourceLedgerId: origin.ledgerId ?? null,
      communityId: origin.communityId ?? null,
      validFrom: window.validFrom,
      validUntil: window.validUntil,
      idempotencyKey: buildIdempotencyKey(rule, origin, i),
    }, conn);
    if (granted.created) {
      results.push({ userBenefit: granted.benefit, definition, rule, qrToken: granted.qrToken });
    }
  }
  return results;
}

export async function evaluateBenefitsForOrigin(origin: BenefitOrigin, db?: AnyDbHandle): Promise<UnlockedBenefit[]> {
  const conn = db ?? (await getDb());
  const candidateRules = await findApplicableBenefitRules(origin, conn);
  const unlocked: UnlockedBenefit[] = [];

  for (const rule of candidateRules) {
    if (!(await passesRecurrenceCondition(rule, origin, conn))) continue;

    const [definition] = await conn.select().from(benefitDefinitions)
      .where(and(eq(benefitDefinitions.id, rule.benefitDefinitionId), eq(benefitDefinitions.active, true))).limit(1);
    if (!definition) continue;

    if (origin.communityId != null && !(await isDefinitionAllowedForCommunity(rule.benefitDefinitionId, origin.communityId, conn))) continue;

    // PRE-16.15 (auditoría overnight, bug real): maxPerUser/maxPerDay/
    // maxTotal eran "leer contador -> decidir -> insertar" sin ningún lock
    // — dos hechos DISTINTOS que cualifican casi a la vez (dos transacciones
    // de comercio, dos asistencias) podían leer ambos "todavía no llego al
    // tope" antes de que cualquiera confirmara, y las dos conceder,
    // superando el tope real (a diferencia de oncePerRule, que ya estaba
    // protegido por una idempotencyKey fija — ver comentario de
    // buildIdempotencyKey). Reutiliza el MISMO patrón ya probado en
    // tokenLedgerService.ts/tokenSpendService.ts: `SELECT...FOR UPDATE`
    // sobre una fila real (aquí, la propia regla) dentro de una transacción
    // — nunca una tabla de contadores nueva. Solo se paga el coste de la
    // transacción/lock cuando la regla REALMENTE tiene un tope numérico
    // configurado; oncePerRule/oncePerOrigin sin tope adicional siguen su
    // camino rápido de siempre.
    const hasNumericCap = rule.maxPerUser != null || rule.maxPerDay != null || rule.maxTotal != null;
    if (hasNumericCap) {
      const results = await conn.transaction(async (tx) => {
        await tx.select({ id: benefitRules.id }).from(benefitRules).where(eq(benefitRules.id, rule.id)).limit(1).for("update");
        return checkLimitsAndGrant(rule, origin, definition, tx);
      });
      unlocked.push(...results);
      continue;
    }

    unlocked.push(...(await checkLimitsAndGrant(rule, origin, definition, conn)));
  }

  return unlocked;
}
