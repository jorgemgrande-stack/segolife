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
}

export type IngestAttendanceResult =
  | { status: "processed"; attendance: EventAttendance }
  | { status: "already_processed"; attendance: EventAttendance }
  | { status: "unresolved" };

function buildIdempotencyKey(input: IngestAttendanceInput): string {
  return `${input.provider}:${input.integrationType ?? "native"}:${input.integrationId ?? 0}:${input.attendance.externalAttendanceId}`;
}

export async function ingestAttendance(input: IngestAttendanceInput, db?: DbHandle): Promise<IngestAttendanceResult> {
  const conn = db ?? (await getDb());
  const idempotencyKey = buildIdempotencyKey(input);

  const [existing] = await conn.select().from(eventAttendance).where(eq(eventAttendance.idempotencyKey, idempotencyKey)).limit(1);
  if (existing) return { status: "already_processed", attendance: existing };

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
  let tokenResult: Awaited<ReturnType<typeof earnTokens>> | null = null;
  if (!input.suppressLoyalty) {
    const [priorRewarded] = await conn.select({ id: eventAttendance.id }).from(eventAttendance)
      .where(and(eq(eventAttendance.eventId, input.eventId), eq(eventAttendance.userId, userId), isNotNull(eventAttendance.tokensLedgerId)))
      .limit(1);

    tokenResult = priorRewarded
      ? null
      : await earnTokens({
          userId,
          communityId: input.communityId ?? null,
          venueId: input.venueId ?? null,
          eventId: input.eventId,
          origin: "attendance",
          idempotencyKey: `event_attendance:${idempotencyKey}`,
          at: input.attendance.occurredAt,
        }, conn).catch(() => null); // earnTokens puede rechazar por horario/regla — la asistencia se registra igual (ver nota abajo).
  }
  // suppressLoyalty=true (import histórico): earnTokens NUNCA se llama — ni siquiera se intenta y falla, se omite por completo (spec §26-27).

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
    tokensLedgerId: tokenResult?.ledger.id ?? null,
    metadata: {},
  });
  const insertId = (insertResult as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(eventAttendance).where(eq(eventAttendance.id, insertId)).limit(1);

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
      ledgerId: tokenResult?.ledger.id ?? null,
      occurredAt: input.attendance.occurredAt,
    }, conn).catch(() => []); // un fallo en Benefits nunca debe revertir la asistencia ya registrada.
  }

  return { status: "processed", attendance: row };
}
