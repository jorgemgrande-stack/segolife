/**
 * benefitGrantService.ts — núcleo atómico de concesión de Benefits (Fase 4).
 * `grantBenefit` es el ÚNICO punto de escritura de `user_benefits` — mismo
 * criterio que `postLedgerMovement` en tokenLedgerService.ts (Fase 2).
 *
 * IDEMPOTENCIA: si se proporciona `idempotencyKey` y ya existe una fila con
 * esa clave, se devuelve la existente sin repetir el efecto — incluso ante
 * una carrera real (el UNIQUE de MySQL sobre `idempotency_key` corta la
 * carrera, el ER_DUP_ENTRY se captura para reconsultar en vez de fallar).
 *
 * ATOMICIDAD (política explícita, ver informe de fase): `grantBenefit` acepta
 * `db?: AnyDbHandle` exactamente igual que earnTokens/postLedgerMovement —
 * cuando el origen es un canje de QR de consumición (Fase 3), el router
 * abre UNA transacción que envuelve QR→earnTokens→grantBenefit; si
 * grantBenefit falla, TODA la transacción se revierte (incluida la marca
 * `redeemed` del QR y el ledger de tokens ya insertado) — nunca queda un QR
 * canjeado con tokens acreditados pero un Benefit a medio conceder. Para
 * orígenes NO transaccionales por naturaleza (p.ej. un futuro evento externo
 * async), grantBenefit funciona igual de bien sin `db` explícito, abriendo su
 * propia transacción — no se ha construido una mega-transacción obligatoria
 * que acople módulos que no lo necesitan.
 *
 * TOKEN QR — ver drizzle/schema.ts, comentario de user_benefits, para la
 * decisión de guardar el token en claro (a diferencia del QR de consumición
 * de Fase 3) y por qué es la elección correcta aquí.
 */
import crypto from "crypto";
import { eq, and, gte, ne } from "drizzle-orm";
import { userBenefits, type UserBenefit } from "../../../drizzle/schema";
import { type AnyDbHandle } from "../tokens/tokenLedgerService";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type BenefitErrorCode =
  | "NOT_FOUND"
  | "ALREADY_USED"
  | "EXPIRED"
  | "NOT_ACTIVE_YET"
  | "CANCELLED"
  | "WRONG_VENUE"
  | "WRONG_EVENT"
  | "UNAUTHORIZED_STAFF"
  | "INVALID_TOKEN"
  | "CANNOT_CANCEL"
  | "REASON_REQUIRED"
  | "LIMIT_EXCEEDED";

export class BenefitError extends Error {
  code: BenefitErrorCode;
  constructor(code: BenefitErrorCode, message: string) {
    super(message);
    this.name = "BenefitError";
    this.code = code;
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return !!err && typeof err === "object" && "errno" in err && (err as { errno?: number }).errno === 1062;
}

function generatePublicToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface GrantBenefitInput {
  userId: number;
  benefitDefinitionId: number;
  benefitRuleId?: number | null;
  sourceType: string;
  sourceId?: number | null;
  sourceVenueId?: number | null;
  sourceEventId?: number | null;
  sourceLedgerId?: number | null;
  communityId?: number | null;
  validFrom: Date;
  validUntil?: Date | null;
  idempotencyKey?: string | null;
  grantedByUserId?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface GrantedBenefit {
  benefit: UserBenefit;
  /** Token en claro — disponible siempre (también en una repetición idempotente, a diferencia del QR de consumición de Fase 3), ver comentario de schema. */
  qrToken: string;
  /** false si ya existía por idempotencia y se devolvió sin conceder de nuevo. */
  created: boolean;
}

export async function grantBenefit(input: GrantBenefitInput, db?: AnyDbHandle): Promise<GrantedBenefit> {
  const conn = db ?? (await getDb());
  const qrToken = generatePublicToken();
  const qrTokenHash = hashToken(qrToken);

  // Comprobación previa de idempotencia (camino feliz, sin carrera) — evita
  // generar y descartar un token en el caso común de un reintento exacto.
  if (input.idempotencyKey) {
    const [existing] = await conn.select().from(userBenefits)
      .where(eq(userBenefits.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) return { benefit: existing, qrToken: existing.qrToken ?? "", created: false };
  }

  try {
    const insertResult = await conn.insert(userBenefits).values({
      userId: input.userId,
      benefitDefinitionId: input.benefitDefinitionId,
      benefitRuleId: input.benefitRuleId ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      sourceVenueId: input.sourceVenueId ?? null,
      sourceEventId: input.sourceEventId ?? null,
      sourceLedgerId: input.sourceLedgerId ?? null,
      communityId: input.communityId ?? null,
      validFrom: input.validFrom,
      validUntil: input.validUntil ?? null,
      qrToken,
      qrTokenHash,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: input.metadata ?? null,
      grantedByUserId: input.grantedByUserId ?? null,
    });
    const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
    const [benefit] = await conn.select().from(userBenefits).where(eq(userBenefits.id, insertId)).limit(1);
    return { benefit, qrToken, created: true };
  } catch (err) {
    if (isDuplicateKeyError(err) && input.idempotencyKey) {
      const [existing] = await conn.select().from(userBenefits)
        .where(eq(userBenefits.idempotencyKey, input.idempotencyKey)).limit(1);
      if (existing) return { benefit: existing, qrToken: existing.qrToken ?? "", created: false };
    }
    throw err;
  }
}

// ─── LÍMITES — lecturas usadas por benefitRuleEngine.ts antes de conceder ──
// Igual que Fase 2 (ver tokenLedgerService.countRecentEarnEvents): se cuenta
// en caliente sobre user_benefits, sin tabla de contadores separada.

export async function countGrantsByRuleForUser(userId: number, ruleId: number, db?: AnyDbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({ id: userBenefits.id }).from(userBenefits)
    .where(and(eq(userBenefits.userId, userId), eq(userBenefits.benefitRuleId, ruleId), ne(userBenefits.status, "cancelled")));
  return rows.length;
}

export async function countGrantsByRuleForUserSince(userId: number, ruleId: number, since: Date, db?: AnyDbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({ id: userBenefits.id }).from(userBenefits)
    .where(and(
      eq(userBenefits.userId, userId),
      eq(userBenefits.benefitRuleId, ruleId),
      ne(userBenefits.status, "cancelled"),
      gte(userBenefits.grantedAt, since)
    ));
  return rows.length;
}

export async function countGrantsByRuleTotal(ruleId: number, db?: AnyDbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({ id: userBenefits.id }).from(userBenefits)
    .where(and(eq(userBenefits.benefitRuleId, ruleId), ne(userBenefits.status, "cancelled")));
  return rows.length;
}

/** oncePerOrigin: ¿ya existe una concesión de ESTA regla para este mismo (sourceType, sourceId) exacto? */
export async function hasGrantForOrigin(benefitRuleId: number, sourceType: string, sourceId: number, db?: AnyDbHandle): Promise<boolean> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select({ id: userBenefits.id }).from(userBenefits)
    .where(and(
      eq(userBenefits.benefitRuleId, benefitRuleId),
      eq(userBenefits.sourceType, sourceType),
      eq(userBenefits.sourceId, sourceId)
    )).limit(1);
  return !!row;
}

// ─── EXPIRACIÓN PEREZOSA (sin cron, ver informe de fase) ───────────────────

/** Si el beneficio está `active` pero ya pasó su valid_until, lo marca `expired` en este toque — mismo criterio que consumptionQrService.ts (Fase 3). */
export async function expireBenefitIfNeeded(benefit: UserBenefit, db?: AnyDbHandle): Promise<UserBenefit> {
  if (benefit.status !== "active" || !benefit.validUntil || benefit.validUntil.getTime() >= Date.now()) return benefit;
  const conn = db ?? (await getDb());
  await conn.update(userBenefits).set({ status: "expired" })
    .where(and(eq(userBenefits.id, benefit.id), eq(userBenefits.status, "active")));
  return { ...benefit, status: "expired" };
}

// ─── CANCELACIÓN ────────────────────────────────────────────────────────────

export interface CancelBenefitInput {
  userBenefitId: number;
  reason: string;
  cancelledByUserId: number;
}

/**
 * Solo cancela un beneficio en estado `active` — uno `used` nunca se cancela
 * directamente (spec: "una corrección posterior es un registro
 * administrativo, no una reactivación automática"; no existe un
 * "reverseBenefit" porque, a diferencia de un movimiento de ledger, un
 * Benefit usado no tiene un efecto monetario que revertir por sí mismo — la
 * corrección real, si la hay, se hace sobre el ledger de SegoTokens
 * asociado vía reverseTransaction de Fase 2, no aquí). UPDATE condicional —
 * mismo patrón atómico que cancelConsumptionQr (Fase 3).
 */
export async function cancelBenefit(input: CancelBenefitInput, db?: AnyDbHandle): Promise<UserBenefit> {
  if (!input.reason || !input.reason.trim()) {
    throw new BenefitError("REASON_REQUIRED", "La cancelación requiere un motivo");
  }
  const conn = db ?? (await getDb());
  const [result] = await conn.update(userBenefits)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelledByUserId: input.cancelledByUserId, cancellationReason: input.reason })
    .where(and(eq(userBenefits.id, input.userBenefitId), eq(userBenefits.status, "active")));

  if ((result as unknown as { affectedRows: number }).affectedRows === 0) {
    const [benefit] = await conn.select().from(userBenefits).where(eq(userBenefits.id, input.userBenefitId)).limit(1);
    if (!benefit) throw new BenefitError("NOT_FOUND", "Beneficio no encontrado");
    throw new BenefitError("CANNOT_CANCEL", `No se puede cancelar un beneficio en estado '${benefit.status}'`);
  }

  const [updated] = await conn.select().from(userBenefits).where(eq(userBenefits.id, input.userBenefitId)).limit(1);
  return updated;
}

export async function getUserBenefitById(id: number, db?: AnyDbHandle): Promise<UserBenefit | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(userBenefits).where(eq(userBenefits.id, id)).limit(1);
  return row ?? null;
}
