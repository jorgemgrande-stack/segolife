/**
 * attendancePipeline.ts — ÚNICO punto de entrada para convertir una
 * asistencia normalizada (de cualquier proveedor, o de un futuro scanner
 * propio con provider='segolife') en `event_attendance` + loyalty (Fase 5,
 * puntos 11-12). Ningún adapter llama a earnTokens/evaluateBenefitsForOrigin
 * directamente — solo este pipeline, para que ningún adapter futuro pueda
 * "reinventar" loyalty (ver docs/integrations/ticketing-commerce-architecture.md).
 *
 * Idempotente: idempotency_key = `${provider}:${integrationType ?? "native"}:${integrationId ?? 0}:${externalAttendanceId}`.
 * Reintentar (polling repetido, reprocesar un unresolved_operations ya
 * vinculado) nunca duplica ni la fila de event_attendance ni el ledger.
 *
 * FASE 8: `resolvedUserId` (opcional) permite a un llamador que YA CONOCE
 * con certeza la identidad — un check-in nativo, donde `event_tickets.userId`
 * ES el comprador real de Segolife, sin ninguna heurística de email/teléfono
 * de por medio; o la vinculación manual de un `unresolved_operations` de
 * asistencia, donde un admin ya decidió el userId — saltarse por completo
 * `resolveIdentity()`/`persistIdentityMapping()`. Sin `resolvedUserId`, el
 * comportamiento es IDÉNTICO al de siempre (proveedores externos).
 *
 * HISTORICAL VALIDATION (Fourvenues Casanova Historical Validation, spec
 * §22/§26-27): `suppressLoyalty` (opcional) permite ingerir asistencia real
 * pasada — Student 360/analítica la necesitan — SIN conceder SegoTokens ni
 * Benefits por ella. Existe una regla real y ACTIVA de `origin="attendance"`
 * en producción (15 tokens, scope global) que dispararía en cuanto
 * `earnTokens` se llamara, así que este flag NUNCA es opcional a la ligera
 * para un import histórico. Cuando es `true`: se salta por completo
 * earnTokens/evaluateBenefitsForOrigin (ni se intentan, no solo se
 * descartan) — pero `event_attendance` se persiste exactamente igual que
 * siempre. Por defecto `false` — el comportamiento de un sync en vivo no
 * cambia ni un bit.
 */
import { eq, and, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eventAttendance, type EventAttendance } from "../../../drizzle/schema";
import { earnTokens } from "../tokens/tokenEngine";
import { evaluateBenefitsForOrigin } from "../benefits/benefitRuleEngine";
import { resolveIdentity, persistIdentityMapping, isConfirmedResolutionMethod } from "../integrations/identityResolver";
import { recordUnresolvedOperation } from "../integrations/unresolvedOperationsService";
import type { NormalizedAttendance } from "../integrations/externalTicketingProvider";
import { TokenEngineError } from "../tokens/tokenLedgerService";
import { resolveLoyaltyCutoff, isBeforeCutoff } from "../tokens/loyaltyCutoffService";
import { buildNextAttempt, shouldAttemptReward, type RewardAttempt, type DenialReasonCode } from "../tokens/rewardStateMachine";
import { observeShadow } from "../tokens/loyaltyShadowService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface IngestAttendanceInput {
  provider: string;
  integrationType?: "venue_integration" | "event_integration" | null;
  integrationId?: number | null;
  eventId: number;
  venueId?: number | null;
  communityId?: number | null;
  ticketId?: number | null;
  attendance: NormalizedAttendance;
  externalCustomerId?: string | null;
  /** Identidad ya resuelta con certeza — ver nota de Fase 8 arriba. */
  resolvedUserId?: number | null;
  /** Import histórico — ver nota arriba. Nunca concede tokens/Benefits; sí persiste event_attendance. */
  suppressLoyalty?: boolean;
  /**
   * LOYALTY SHADOW MODE — distinto de `suppressLoyalty` (spec §9: "Shadow
   * observa tráfico desde su activación... NO procesar 20.000+ tickets
   * históricos"). `suppressLoyalty` puede ser `true` simplemente porque el
   * venue tiene `loyalty_enabled=false` en un sync EN VIVO — Shadow SÍ debe
   * observar ese tráfico (es justo el punto de esta fase: ver qué pasaría
   * si loyalty estuviera activo). `isHistoricalImport=true` marca en cambio
   * una reconstrucción retroactiva de datos ya viejos (backfill, claim de
   * identidad histórica, vinculación manual de un unresolved_operations
   * antiguo) — Shadow NUNCA debe observar esos casos, aunque tengan un
   * userId resuelto. Por defecto `false` (tráfico en vivo).
   */
  isHistoricalImport?: boolean;
}

export type IngestAttendanceResult =
  | { status: "processed"; attendance: EventAttendance }
  | { status: "already_processed"; attendance: EventAttendance }
  | { status: "unresolved" };

function buildIdempotencyKey(input: IngestAttendanceInput): string {
  return `${input.provider}:${input.integrationType ?? "native"}:${input.integrationId ?? 0}:${input.attendance.externalAttendanceId}`;
}

function toDenialReason(code: string): DenialReasonCode | null {
  return code === "NO_RULE_FOUND" || code === "RULE_LIMIT_EXCEEDED" || code === "OUTSIDE_SCHEDULE" ? code : null;
}

/**
 * Evalúa (y, si procede, concede) el reward de asistencia — reutilizada
 * tanto en el alta nueva como en un reintento sobre una fila ya existente
 * (spec §5, Loyalty Production Hardening). Nunca lanza — cualquier fallo de
 * earnTokens se traduce a un `RewardAttempt` denegado, nunca revienta la
 * ingesta de la asistencia en sí.
 */
async function evaluateAttendanceReward(
  input: IngestAttendanceInput,
  userId: number,
  idempotencyKey: string,
  previousAttempt: RewardAttempt | null,
  conn: DbHandle
): Promise<RewardAttempt> {
  const at = input.attendance.occurredAt;

  const persistedCutoff = await resolveLoyaltyCutoff(input.integrationId ?? null, conn);
  if (isBeforeCutoff(at, persistedCutoff)) {
    return { status: "DENIED_PERMANENT", reason: "CUTOFF_BLOCKED", attempts: (previousAttempt?.attempts ?? 0) + 1, lastAttemptAt: at.toISOString(), ledgerId: null, generation: previousAttempt?.generation ?? 0, retryable: false };
  }

  // PROTECCIÓN MULTI-TICKET CASE B (spec Fourvenues Operational Sync §28-29):
  // un mismo `payment_id` de Fourvenues puede traer varios tickets con el
  // MISMO email/teléfono (el comprador no pidió el dato de cada asistente) —
  // eso resolvería a un único Student varias veces para el mismo evento. Los
  // tickets/event_attendance siguen siendo tantos como llegaron (nunca se
  // descartan), pero el REWARD de asistencia se concede como máximo una vez
  // por Student+Event: se comprueba si este Student ya tiene una fila de
  // event_attendance de este mismo evento con tokens ya concedidos ANTES de
  // llamar a earnTokens. No se toca earnTokens/tokenEngine.ts ni el formato
  // de idempotencyKey existente — la protección vive aquí, a nivel de
  // orquestación, igual que el resto de reglas de este pipeline.
  const [priorRewarded] = await conn.select({ id: eventAttendance.id }).from(eventAttendance)
    .where(and(eq(eventAttendance.eventId, input.eventId), eq(eventAttendance.userId, userId), isNotNull(eventAttendance.tokensLedgerId)))
    .limit(1);
  if (priorRewarded) {
    // Hecho estructural permanente para ESTA fila (otra fila hermana ya cobró) — nunca reintentable, independiente de MAX_RETRY_ATTEMPTS.
    return { status: "DENIED_PERMANENT", reason: null, attempts: (previousAttempt?.attempts ?? 0) + 1, lastAttemptAt: at.toISOString(), ledgerId: null, generation: previousAttempt?.generation ?? 0, retryable: false };
  }

  let outcome: { ledgerId: number | null; reason: DenialReasonCode | null };
  try {
    const tokenResult = await earnTokens({
      userId,
      communityId: input.communityId ?? null,
      venueId: input.venueId ?? null,
      eventId: input.eventId,
      origin: "attendance",
      idempotencyKey: `event_attendance:${idempotencyKey}`,
      at,
    }, conn);
    outcome = { ledgerId: tokenResult.ledger.id, reason: null };
  } catch (err) {
    // earnTokens puede rechazar por horario/regla — la asistencia se registra igual (ver nota abajo), el motivo queda en la Reward State Machine para poder explicar/reintentar.
    outcome = { ledgerId: null, reason: err instanceof TokenEngineError ? toDenialReason(err.code) : null };
  }
  return buildNextAttempt(outcome, previousAttempt, at);
}

export async function ingestAttendance(input: IngestAttendanceInput, db?: DbHandle): Promise<IngestAttendanceResult> {
  const conn = db ?? (await getDb());
  const idempotencyKey = buildIdempotencyKey(input);

  const [existing] = await conn.select().from(eventAttendance).where(eq(eventAttendance.idempotencyKey, idempotencyKey)).limit(1);
  if (existing) {
    // Retry (spec §5) — la asistencia YA está procesada (nunca se reprocesa
    // ni duplica); solo se reintenta la recompensa si quedó denegada
    // temporalmente y sigue siendo elegible.
    if (!input.suppressLoyalty && existing.tokensLedgerId == null) {
      const existingAttempt = (existing.metadata as { rewardAttempt?: RewardAttempt } | null)?.rewardAttempt ?? null;
      if (shouldAttemptReward(existingAttempt)) {
        const attempt = await evaluateAttendanceReward(input, existing.userId, idempotencyKey, existingAttempt, conn);
        await conn.update(eventAttendance).set({
          tokensLedgerId: attempt.ledgerId,
          metadata: { ...(existing.metadata ?? {}), rewardAttempt: attempt },
        }).where(eq(eventAttendance.id, existing.id));
        const [refreshed] = await conn.select().from(eventAttendance).where(eq(eventAttendance.id, existing.id)).limit(1);
        return { status: "already_processed", attendance: refreshed ?? existing };
      }
    }
    return { status: "already_processed", attendance: existing };
  }

  let userId: number;
  if (input.resolvedUserId != null) {
    userId = input.resolvedUserId;
  } else {
    const identity = await resolveIdentity({
      provider: input.provider,
      externalCustomerId: input.externalCustomerId,
      participant: input.attendance.participant,
      buyer: null,
    }, conn);

    if (!identity.userId) {
      await recordUnresolvedOperation({
        operationType: "attendance",
        provider: input.provider,
        integrationType: input.integrationType ?? null,
        integrationId: input.integrationId ?? null,
        externalReferenceId: input.attendance.externalAttendanceId,
        eventId: input.eventId,
        venueId: input.venueId ?? null,
        occurredAt: input.attendance.occurredAt,
        identityHintEmail: input.attendance.participant.email ?? null,
        identityHintPhone: input.attendance.participant.phone ?? null,
        identityHintName: input.attendance.participant.name ?? null,
        amountCents: null,
      }, conn);
      // Shadow (spec §2/§33) — identidad histórica sin Student resuelto,
      // observada como NO_STUDENT, nunca como si perteneciera a alguien.
      if (!input.isHistoricalImport) {
        await observeShadow({
          provider: input.provider, externalOperationId: input.attendance.externalAttendanceId, trigger: "EVENT_ATTENDANCE",
          operationState: "unresolved", userId: null, venueId: input.venueId ?? null, eventId: input.eventId,
          communityId: input.communityId ?? null, origin: "attendance", occurredAt: input.attendance.occurredAt,
          integrationId: input.integrationId ?? null,
        }, conn);
      }
      return { status: "unresolved" };
    }

    if (isConfirmedResolutionMethod(identity.method) && identity.method !== "previous_mapping") {
      await persistIdentityMapping({
        provider: input.provider,
        externalCustomerId: input.externalCustomerId,
        participant: input.attendance.participant,
        buyer: null,
        userId: identity.userId,
        method: identity.method,
      }, conn);
    }
    userId = identity.userId;
  }

  // suppressLoyalty=true (import histórico): earnTokens NUNCA se llama — ni
  // siquiera se intenta y falla, se omite por completo (spec §26-27), y no
  // se registra ningún RewardAttempt (permanece NOT_EVALUATED).
  const attempt = input.suppressLoyalty
    ? null
    : await evaluateAttendanceReward(input, userId, idempotencyKey, null, conn);

  const [insertResult] = await conn.insert(eventAttendance).ignore().values({
    eventId: input.eventId,
    ticketId: input.ticketId ?? null,
    userId,
    venueId: input.venueId ?? null,
    provider: input.provider,
    integrationType: input.integrationType ?? null,
    integrationId: input.integrationId ?? null,
    externalAttendanceId: input.attendance.externalAttendanceId,
    occurredAt: input.attendance.occurredAt,
    idempotencyKey,
    tokensLedgerId: attempt?.ledgerId ?? null,
    metadata: attempt ? { rewardAttempt: attempt } : {},
  });
  const insertId = (insertResult as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(eventAttendance).where(eq(eventAttendance.id, insertId)).limit(1);

  // Shadow (spec §6/§9) — se evalúa incluso con suppressLoyalty=true (los 3
  // venues reales hoy tienen loyalty_enabled=0, Shadow existe para observar
  // qué habría pasado a pesar de eso) — pero NUNCA si es un import histórico
  // (backfill/claim/vinculación retroactiva, ver isHistoricalImport arriba).
  if (!input.isHistoricalImport) {
    await observeShadow({
      provider: input.provider, externalOperationId: input.attendance.externalAttendanceId, trigger: "EVENT_ATTENDANCE",
      operationState: "processed", userId, venueId: input.venueId ?? null, eventId: input.eventId,
      communityId: input.communityId ?? null, origin: "attendance", occurredAt: input.attendance.occurredAt,
      integrationId: input.integrationId ?? null,
    }, conn);
  }

  // evaluateBenefitsForOrigin se llama SIEMPRE que NO sea import histórico
  // (incluso si earnTokens no concedió tokens por límite/horario — un
  // Benefit puede tener sus propias condiciones independientes de las de
  // SegoTokens, mismo criterio que consumptionQrService.ts en Fase 3/4).
  // suppressLoyalty=true: nunca se intenta, por el mismo motivo que earnTokens arriba.
  if (!input.suppressLoyalty) {
    await evaluateBenefitsForOrigin({
      type: "event_attendance",
      userId,
      venueId: input.venueId ?? null,
      eventId: input.eventId,
      communityId: input.communityId ?? null,
      sourceId: row.id,
      ledgerId: attempt?.ledgerId ?? null,
      occurredAt: input.attendance.occurredAt,
    }, conn).catch(() => []); // un fallo en Benefits nunca debe revertir la asistencia ya registrada.
  }

  return { status: "processed", attendance: row };
}
