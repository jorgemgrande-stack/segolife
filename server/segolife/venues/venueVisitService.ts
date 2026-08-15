/**
 * venueVisitService.ts — SEGOLIFE VENUE & PARTNER APP (spec §10/§11).
 * Hecho canónico "Student estuvo en VENUE" para cuando NO hay ningún evento
 * vigente que resolver (unifiedCheckinService.ts::checkInStudentIdentity
 * llama aquí solo en ese caso — nunca junto a un event_attendance para el
 * mismo escaneo). Ver drizzle/schema.ts, comentario de venue_visits, para
 * el razonamiento completo de por qué es una tabla nueva y no una
 * reutilización forzada de event_attendance.
 */
import { eq, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { venueVisits, userCommunities, type VenueVisit } from "../../../drizzle/schema";
import { resolveOperationalDate } from "../tokens/tokenScheduleService";
import { evaluateBenefitsForOrigin } from "../benefits/benefitRuleEngine";
import { emitBenefitGranted, buildBenefitGrantedPayload } from "../benefits/benefitEvents";
import { evaluateReferralConversionBestEffort } from "../referrals/referralService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

// resolveOperationalDate ahora vive en tokenScheduleService.ts (ver su
// comentario) — se re-exporta aquí para no romper ningún import existente
// (unifiedCheckinService.ts, venueAppService.ts, venueVisitService.test.ts).
export { resolveOperationalDate };

export interface RecordVenueVisitInput {
  userId: number;
  venueId: number;
  occurredAt: Date;
  source: string;
  operatorUserId?: number | null;
  eventAttendanceId?: number | null;
}

export type RecordVenueVisitResult =
  | { status: "recorded"; visit: VenueVisit }
  | { status: "already_recorded"; visit: VenueVisit };

/** Primera comunidad por antigüedad de alta — mismo criterio que resolveMyCommunityId en server/routers/benefits.ts, nunca inferida por venue/email. */
async function resolveVisitorCommunityId(userId: number, conn: DbHandle): Promise<number | null> {
  const [membership] = await conn.select({ communityId: userCommunities.communityId })
    .from(userCommunities).where(eq(userCommunities.userId, userId)).orderBy(asc(userCommunities.joinedAt)).limit(1);
  return membership?.communityId ?? null;
}

/**
 * Idempotente vía UNIQUE(idempotency_key) + insert().ignore() — dos
 * escaneos concurrentes del mismo Student en el mismo venue dentro del
 * mismo día operativo nunca crean dos filas (mismo patrón que
 * ingestAttendance/attendancePipeline.ts, nunca un motor paralelo de
 * asistencia — este es su hermano venue-only, no un sustituto).
 *
 * SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6, spec §5/§16): cierra
 * la laguna de Fase 5 — hasta ahora `venue_visit` era un sourceType
 * seleccionable en el admin pero sin ningún productor real, así que una
 * regla configurada con él nunca disparaba. Solo se evalúa para una visita
 * REALMENTE NUEVA (nunca en el camino already_recorded — un reescaneo
 * duplicado del mismo día operativo no debe re-evaluar ni re-notificar). Un
 * fallo en la evaluación de Benefits NUNCA revierte la visita ya
 * commiteada (mismo patrón .catch(() => []) que ingestAttendance).
 */
export async function recordVenueVisit(input: RecordVenueVisitInput, db?: DbHandle): Promise<RecordVenueVisitResult> {
  const conn = db ?? (await getDb());
  const operationalDate = resolveOperationalDate(input.occurredAt);
  const idempotencyKey = `venue_visit:${input.venueId}:${input.userId}:${operationalDate}`;

  const [existing] = await conn.select().from(venueVisits).where(eq(venueVisits.idempotencyKey, idempotencyKey)).limit(1);
  if (existing) return { status: "already_recorded", visit: existing };

  const [insertResult] = await conn.insert(venueVisits).ignore().values({
    userId: input.userId,
    venueId: input.venueId,
    eventAttendanceId: input.eventAttendanceId ?? null,
    occurredAt: input.occurredAt,
    operationalDate,
    source: input.source,
    operatorUserId: input.operatorUserId ?? null,
    idempotencyKey,
  });
  const insertId = (insertResult as unknown as { insertId: number }).insertId;
  if (!insertId) {
    // Carrera real (dos escaneos concurrentes) — el otro ya la insertó, devolver esa fila.
    const [row] = await conn.select().from(venueVisits).where(eq(venueVisits.idempotencyKey, idempotencyKey)).limit(1);
    return { status: "already_recorded", visit: row };
  }
  const [row] = await conn.select().from(venueVisits).where(eq(venueVisits.id, insertId)).limit(1);

  try {
    const communityId = await resolveVisitorCommunityId(input.userId, conn);
    const unlocked = await evaluateBenefitsForOrigin({
      type: "venue_visit",
      userId: input.userId,
      venueId: input.venueId,
      communityId,
      sourceId: row.id,
      occurredAt: input.occurredAt,
    }, conn);
    for (const u of unlocked) emitBenefitGranted(buildBenefitGrantedPayload(u.userBenefit, u.definition));
  } catch {
    // Un fallo en Benefits nunca debe revertir la visita ya registrada.
  }

  // REFERRAL & INVITE REWARDS ENGINE (Fase 8, spec §10/§83): SOLO en el
  // camino "recorded" (nunca en already_recorded — un reescaneo del mismo
  // día operativo no es una "primera visita" nueva). evaluateReferralConversion
  // ya comprueba occurredAt >= referral.registeredAt, así que una visita real
  // anterior al alta (identidad histórica Fourvenues, spec §58) nunca
  // califica retroactivamente.
  await evaluateReferralConversionBestEffort(input.userId, "first_venue_visit", input.occurredAt);

  return { status: "recorded", visit: row };
}
