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
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eventAttendance, type EventAttendance } from "../../../drizzle/schema";
import { earnTokens } from "../tokens/tokenEngine";
import { evaluateBenefitsForOrigin } from "../benefits/benefitRuleEngine";
import { resolveIdentity, persistIdentityMapping } from "../integrations/identityResolver";
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

  if (identity.method && identity.method !== "previous_mapping") {
    await persistIdentityMapping({
      provider: input.provider,
      externalCustomerId: input.externalCustomerId,
      participant: input.attendance.participant,
      buyer: null,
      userId: identity.userId,
      method: identity.method,
    }, conn);
  }

  const tokenResult = await earnTokens({
    userId: identity.userId,
    communityId: input.communityId ?? null,
    venueId: input.venueId ?? null,
    eventId: input.eventId,
    origin: "attendance",
    idempotencyKey: `event_attendance:${idempotencyKey}`,
    at: input.attendance.occurredAt,
  }, conn).catch(() => null); // earnTokens puede rechazar por horario/regla — la asistencia se registra igual (ver nota abajo).

  const [insertResult] = await conn.insert(eventAttendance).ignore().values({
    eventId: input.eventId,
    ticketId: input.ticketId ?? null,
    userId: identity.userId,
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

  // evaluateBenefitsForOrigin se llama SIEMPRE (incluso si earnTokens no
  // concedió tokens por límite/horario) — un Benefit puede tener sus propias
  // condiciones independientes de las de SegoTokens (mismo criterio que
  // consumptionQrService.ts en Fase 3/4).
  await evaluateBenefitsForOrigin({
    type: "event_attendance",
    userId: identity.userId,
    venueId: input.venueId ?? null,
    eventId: input.eventId,
    communityId: input.communityId ?? null,
    sourceId: row.id,
    ledgerId: tokenResult?.ledger.id ?? null,
    occurredAt: input.attendance.occurredAt,
  }, conn).catch(() => []); // un fallo en Benefits nunca debe revertir la asistencia ya registrada.

  return { status: "processed", attendance: row };
}
