/**
 * benefitRedemptionService.ts — canje (validación en puerta) del QR de un
 * Benefit por parte del STAFF (Fase 4). Flujo inverso al de Fase 3: aquí el
 * ESTUDIANTE muestra el código y el STAFF lo escanea para CONSUMIR un
 * derecho ya concedido — nunca se reutiliza consumptionQrService.ts.
 *
 * SINGLE-USE real: igual que Fase 3, se resuelve con un UPDATE condicional
 * (`WHERE status='active'`, comprobando affectedRows=1) — dos escaneos
 * simultáneos del mismo Benefit nunca pueden ganar ambos.
 *
 * AUTORIZACIÓN DE STAFF: el router resuelve `staffAuthorizedVenueIds` (ver
 * server/segolife/benefits/venueStaffAccess.ts) ANTES de llamar aquí — este
 * servicio nunca consulta RBAC directamente, solo aplica el alcance ya
 * resuelto. Se comprueba y registra como intento (`unauthorized_staff`)
 * DENTRO del flujo normal (no como un 403 antes de tocar el servicio) para
 * que quede auditado en benefit_redemption_attempts, tal como pide la spec
 * de antifraude.
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import crypto from "crypto";
import {
  userBenefits,
  benefitDefinitions,
  benefitRedemptionAttempts,
  users,
  type UserBenefit,
  type BenefitDefinition,
} from "../../../drizzle/schema";
import { BenefitError } from "./benefitGrantService";
import { recordBenefitRedemptionStock } from "../stock/stockService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface RedeemBenefitInput {
  token: string;
  staffUserId: number;
  /** Venue donde el staff está validando físicamente — obligatorio, es la base de la comprobación de destino y de alcance. */
  venueId: number;
  eventId?: number | null;
  /** "all" = admin global; number[] = venues concretos donde este staff tiene fila en venue_staff (ver venueStaffAccess.ts). */
  staffAuthorizedVenueIds: number[] | "all";
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface RedeemBenefitResult {
  userBenefit: UserBenefit;
  definition: BenefitDefinition;
  studentName: string;
}

async function logAttempt(
  conn: AnyDbHandle,
  data: {
    userBenefitId: number | null;
    tokenFingerprint: string;
    staffUserId: number;
    venueId: number | null;
    result: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<void> {
  await conn.insert(benefitRedemptionAttempts).values({
    userBenefitId: data.userBenefitId,
    tokenFingerprint: data.tokenFingerprint,
    staffUserId: data.staffUserId,
    venueId: data.venueId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result: data.result as any,
    ipAddress: data.ipAddress ?? null,
    userAgent: data.userAgent ?? null,
  });
}

export async function redeemBenefit(input: RedeemBenefitInput, db?: DbHandle): Promise<RedeemBenefitResult> {
  const conn = db ?? (await getDb());
  const tokenHash = hashToken(input.token);

  const [benefit] = await conn.select().from(userBenefits).where(eq(userBenefits.qrTokenHash, tokenHash)).limit(1);
  if (!benefit) {
    await logAttempt(conn, { userBenefitId: null, tokenFingerprint: tokenHash, staffUserId: input.staffUserId, venueId: input.venueId, result: "not_found", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new BenefitError("NOT_FOUND", "Código no válido");
  }

  const [definition] = await conn.select().from(benefitDefinitions).where(eq(benefitDefinitions.id, benefit.benefitDefinitionId)).limit(1);
  if (!definition) {
    await logAttempt(conn, { userBenefitId: benefit.id, tokenFingerprint: tokenHash, staffUserId: input.staffUserId, venueId: input.venueId, result: "not_found", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new BenefitError("NOT_FOUND", "Beneficio no encontrado");
  }

  if (benefit.status === "cancelled") {
    await logAttempt(conn, { userBenefitId: benefit.id, tokenFingerprint: tokenHash, staffUserId: input.staffUserId, venueId: input.venueId, result: "cancelled", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new BenefitError("CANCELLED", "Este beneficio ha sido cancelado");
  }
  if (benefit.status === "used") {
    await logAttempt(conn, { userBenefitId: benefit.id, tokenFingerprint: tokenHash, staffUserId: input.staffUserId, venueId: input.venueId, result: "already_used", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new BenefitError("ALREADY_USED", "Este beneficio ya ha sido usado");
  }

  const now = Date.now();
  const isExpired = benefit.status === "expired" || (benefit.validUntil != null && benefit.validUntil.getTime() < now);
  if (isExpired) {
    if (benefit.status === "active") {
      await conn.update(userBenefits).set({ status: "expired" }).where(eq(userBenefits.id, benefit.id));
    }
    await logAttempt(conn, { userBenefitId: benefit.id, tokenFingerprint: tokenHash, staffUserId: input.staffUserId, venueId: input.venueId, result: "expired", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new BenefitError("EXPIRED", "Este beneficio ha caducado");
  }

  if (benefit.validFrom.getTime() > now) {
    await logAttempt(conn, { userBenefitId: benefit.id, tokenFingerprint: tokenHash, staffUserId: input.staffUserId, venueId: input.venueId, result: "not_active_yet", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new BenefitError("NOT_ACTIVE_YET", "Este beneficio todavía no es válido");
  }

  // Alcance del staff — antes que la comprobación de destino a propósito
  // (rechazar por falta de permiso general antes de revelar nada del
  // beneficio concreto).
  const staffAuthorized = input.staffAuthorizedVenueIds === "all" || input.staffAuthorizedVenueIds.includes(input.venueId);
  if (!staffAuthorized) {
    await logAttempt(conn, { userBenefitId: benefit.id, tokenFingerprint: tokenHash, staffUserId: input.staffUserId, venueId: input.venueId, result: "unauthorized_staff", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new BenefitError("UNAUTHORIZED_STAFF", "No tienes autorización para validar beneficios en este venue");
  }

  if (definition.destinationVenueId != null && definition.destinationVenueId !== input.venueId) {
    await logAttempt(conn, { userBenefitId: benefit.id, tokenFingerprint: tokenHash, staffUserId: input.staffUserId, venueId: input.venueId, result: "wrong_venue", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new BenefitError("WRONG_VENUE", "Este beneficio no es válido en este venue");
  }
  if (definition.destinationEventId != null && definition.destinationEventId !== input.eventId) {
    await logAttempt(conn, { userBenefitId: benefit.id, tokenFingerprint: tokenHash, staffUserId: input.staffUserId, venueId: input.venueId, result: "wrong_event", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new BenefitError("WRONG_EVENT", "Este beneficio no es válido para este evento");
  }

  const [updateResult] = await conn.update(userBenefits)
    .set({ status: "used", usedAt: new Date(), usedAtVenueId: input.venueId, usedAtEventId: input.eventId ?? null, usedByStaffUserId: input.staffUserId })
    .where(and(eq(userBenefits.id, benefit.id), eq(userBenefits.status, "active")));
  if ((updateResult as unknown as { affectedRows: number }).affectedRows === 0) {
    await logAttempt(conn, { userBenefitId: benefit.id, tokenFingerprint: tokenHash, staffUserId: input.staffUserId, venueId: input.venueId, result: "already_used", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new BenefitError("ALREADY_USED", "Este beneficio ya ha sido usado");
  }

  await logAttempt(conn, { userBenefitId: benefit.id, tokenFingerprint: tokenHash, staffUserId: input.staffUserId, venueId: input.venueId, result: "valid", ipAddress: input.ipAddress, userAgent: input.userAgent });

  // SEGOLIFE — FASE 10 (spec §34): un Benefit "free_product" gratuito sigue
  // consumiendo stock FÍSICO real si el producto destino lleva control de
  // stock — el precio pagado (€0) no cambia que el producto se entregó.
  // Best-effort (nunca bloquea un Benefit ya concedido/prometido al
  // Student, ni revierte el canje ya confirmado arriba) — si faltara stock
  // o el producto no llevara stockTracked, la fila de userBenefits queda
  // igualmente "used" (mismo comportamiento ya probado desde Fase 4).
  if (definition.benefitType === "free_product" && definition.productId != null) {
    // PRE-16.15 (auditoría overnight, H): el catch vacío no dejaba ningún
    // rastro de un fallo real de stock — nunca visible para un admin ni en
    // logs. La política de negocio (best-effort, nunca bloquea el canje ya
    // confirmado) no cambia; solo deja de ser 100% silencioso. Nunca se
    // expone el error interno de stock al Student — este log es
    // server-side, el canje ya devolvió éxito.
    await recordBenefitRedemptionStock(definition.productId, input.venueId, benefit.id, input.staffUserId, conn)
      .catch(err => console.error(`[benefitRedemptionService] No se pudo registrar el consumo de stock del Benefit (userBenefitId=${benefit.id}, productId=${definition.productId}):`, err));
  }

  const [updated] = await conn.select().from(userBenefits).where(eq(userBenefits.id, benefit.id)).limit(1);
  const [student] = await conn.select({ name: users.name }).from(users).where(eq(users.id, benefit.userId)).limit(1);

  return { userBenefit: updated, definition, studentName: student?.name ?? "—" };
}
