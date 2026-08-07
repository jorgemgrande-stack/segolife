/**
 * consumptionQrService.ts — QR de consumición (Fase 3): emisión, canje,
 * cancelación. Único punto de escritura de `consumption_qr_codes` — los
 * routers delegan aquí, nunca construyen el flujo a mano.
 *
 * SEGURIDAD DEL TOKEN: `issueConsumptionQr` genera un token aleatorio de 256
 * bits (`crypto.randomBytes(32)`, base64url) y devuelve el token en CLARO
 * una única vez (para imprimir/codificar el QR) — solo se persiste su
 * SHA-256 (`code_hash`). El canje nunca recibe ni compara nada más que ese
 * hash. Una fuga de la tabla `consumption_qr_codes` no expone ningún QR
 * válido reutilizable.
 *
 * CANJE DE UN SOLO USO: `redeemConsumptionQr` resuelve la exclusión mutua
 * con un UPDATE condicional (`WHERE status='issued'`, comprobando
 * affectedRows=1) dentro de la MISMA transacción que llama a
 * tokenEngine.earnTokens() — verificado contra MySQL 9.4 real (ver informe
 * de fase): de dos peticiones simultáneas para el mismo QR, la segunda
 * siempre ve affectedRows=0 y nunca llega a acreditar tokens. Si
 * earnTokens() falla por cualquier motivo (horario, regla, límite), toda la
 * transacción — incluida la marca `redeemed` del QR — se revierte: nunca
 * queda un QR "redeemed" sin su ledger correspondiente, ni viceversa.
 *
 * idempotencyKey = `consumption_qr:<qrId>` se pasa a earnTokens() como
 * segunda capa de protección (además del UPDATE condicional) — impide doble
 * acreditación incluso si alguna capa superior reintenta la operación.
 */
import crypto from "crypto";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and } from "drizzle-orm";
import {
  consumptionQrCodes,
  qrBatches,
  qrRedemptionAttempts,
  venues,
  venueProducts,
  communityVenues,
  type ConsumptionQrCode,
  type QrBatch,
} from "../../../drizzle/schema";
import { earnTokens, type TokenBreakdown } from "../tokens/tokenEngine";
import { TokenEngineError } from "../tokens/tokenLedgerService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 5 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type QrErrorCode =
  | "NOT_FOUND"
  | "ALREADY_REDEEMED"
  | "EXPIRED"
  | "CANCELLED"
  | "VENUE_INACTIVE"
  | "PRODUCT_INACTIVE"
  | "COMMUNITY_NOT_AUTHORIZED"
  | "REASON_REQUIRED"
  | "CANNOT_CANCEL";

export class QrError extends Error {
  code: QrErrorCode;
  constructor(code: QrErrorCode, message: string) {
    super(message);
    this.name = "QrError";
    this.code = code;
  }
}

function generatePublicToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ─── EMISIÓN ─────────────────────────────────────────────────────────────────

export interface IssueQrInput {
  venueId: number;
  productId?: number | null;
  amountCents?: number | null;
  quantity?: number;
  expiresAt?: Date | null;
  sourceType?: string;
  sourceReference?: string | null;
  issuedByUserId?: number | null;
  batchId?: number | null;
}

export interface IssuedQr {
  qr: ConsumptionQrCode;
  /** Token en claro — solo disponible en el momento de emitir, nunca se puede recuperar después. */
  publicToken: string;
}

export async function issueConsumptionQr(input: IssueQrInput, db?: AnyDbHandle): Promise<IssuedQr> {
  const conn = db ?? (await getDb());
  const publicToken = generatePublicToken();
  const codeHash = hashToken(publicToken);
  const insertResult = await conn.insert(consumptionQrCodes).values({
    codeHash,
    venueId: input.venueId,
    productId: input.productId ?? null,
    amountCents: input.amountCents ?? null,
    quantity: input.quantity ?? 1,
    batchId: input.batchId ?? null,
    expiresAt: input.expiresAt ?? null,
    sourceType: input.sourceType ?? "manual",
    sourceReference: input.sourceReference ?? null,
    issuedByUserId: input.issuedByUserId ?? null,
  });
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [qr] = await conn.select().from(consumptionQrCodes).where(eq(consumptionQrCodes.id, insertId)).limit(1);
  return { qr, publicToken };
}

// ─── EMISIÓN EN LOTE ─────────────────────────────────────────────────────────

export interface IssueBatchInput {
  venueId: number;
  productId?: number | null;
  amountCents?: number | null;
  quantity: number;
  expiresAt?: Date | null;
  createdByUserId?: number | null;
}

export interface IssuedBatch {
  batch: QrBatch;
  qrs: IssuedQr[];
}

/** Cada QR del lote sigue siendo único e independiente — el batch solo organiza para imprimir/descargar. */
export async function issueQrBatch(input: IssueBatchInput, db?: DbHandle): Promise<IssuedBatch> {
  const conn = db ?? (await getDb());
  const insertResult = await conn.insert(qrBatches).values({
    venueId: input.venueId,
    productId: input.productId ?? null,
    amountCents: input.amountCents ?? null,
    quantity: input.quantity,
    expiresAt: input.expiresAt ?? null,
    createdByUserId: input.createdByUserId ?? null,
  });
  const batchId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [batch] = await conn.select().from(qrBatches).where(eq(qrBatches.id, batchId)).limit(1);

  const qrs: IssuedQr[] = [];
  for (let i = 0; i < input.quantity; i++) {
    const issued = await issueConsumptionQr({
      venueId: input.venueId,
      productId: input.productId,
      amountCents: input.amountCents,
      expiresAt: input.expiresAt,
      sourceType: "batch",
      sourceReference: String(batchId),
      issuedByUserId: input.createdByUserId,
      batchId,
    }, conn);
    qrs.push(issued);
  }
  return { batch, qrs };
}

// ─── CANJE ───────────────────────────────────────────────────────────────────

export interface RedeemQrInput {
  token: string;
  userId: number;
  communityId?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface RedeemQrResult {
  qr: ConsumptionQrCode;
  breakdown: TokenBreakdown;
  balanceBefore: number;
  balanceAfter: number;
  venueName: string;
  productName: string | null;
}

async function logAttempt(
  conn: AnyDbHandle,
  data: {
    qrId: number | null;
    tokenFingerprint: string;
    userId: number | null;
    result: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<void> {
  await conn.insert(qrRedemptionAttempts).values({
    qrId: data.qrId,
    tokenFingerprint: data.tokenFingerprint,
    userId: data.userId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result: data.result as any,
    ipAddress: data.ipAddress ?? null,
    userAgent: data.userAgent ?? null,
  });
}

function mapErrorToAttemptResult(err: unknown): string {
  if (err instanceof QrError) return err.code.toLowerCase();
  if (err instanceof TokenEngineError) {
    if (err.code === "OUTSIDE_SCHEDULE") return "outside_schedule";
    if (err.code === "NO_RULE_FOUND") return "no_rule";
    return "error";
  }
  return "error";
}

/**
 * Resuelve token→QR, valida estado/venue/producto (pre-check, ver nota más
 * abajo), y ejecuta el canje atómico. Registra SIEMPRE un intento en
 * qr_redemption_attempts, tanto en éxito como en cualquier fallo.
 *
 * Los checks de venue/producto activo se hacen ANTES de abrir la
 * transacción (optimización — evita abrir transacción para un QR ya
 * descartable). La única garantía que DEBE vivir dentro de la transacción es
 * el single-use (UPDATE condicional) — eso es lo que de verdad impide doble
 * canje ante una carrera real; un venue desactivándose en el microsegundo
 * exacto de un canje concurrente es un caso extremo sin impacto de
 * seguridad/financiero real, y no justifica la complejidad de repetir estos
 * checks dentro de la transacción.
 */
export async function redeemConsumptionQr(input: RedeemQrInput, db?: DbHandle): Promise<RedeemQrResult> {
  const conn = db ?? (await getDb());
  const codeHash = hashToken(input.token);

  const [qr] = await conn.select().from(consumptionQrCodes).where(eq(consumptionQrCodes.codeHash, codeHash)).limit(1);
  if (!qr) {
    await logAttempt(conn, { qrId: null, tokenFingerprint: codeHash, userId: input.userId, result: "not_found", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new QrError("NOT_FOUND", "Código QR no válido");
  }

  if (qr.status === "cancelled") {
    await logAttempt(conn, { qrId: qr.id, tokenFingerprint: codeHash, userId: input.userId, result: "cancelled", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new QrError("CANCELLED", "Este QR ha sido cancelado");
  }
  if (qr.status === "redeemed") {
    await logAttempt(conn, { qrId: qr.id, tokenFingerprint: codeHash, userId: input.userId, result: "already_redeemed", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new QrError("ALREADY_REDEEMED", "Este QR ya ha sido canjeado");
  }
  const isExpired = qr.status === "expired" || (qr.expiresAt != null && qr.expiresAt.getTime() < Date.now());
  if (isExpired) {
    // Barrido perezoso: sin job en background, se refleja el estado real en
    // cuanto alguien lo toca (ver drizzle/schema.ts, comentario de status).
    if (qr.status === "issued") {
      await conn.update(consumptionQrCodes).set({ status: "expired" }).where(eq(consumptionQrCodes.id, qr.id));
    }
    await logAttempt(conn, { qrId: qr.id, tokenFingerprint: codeHash, userId: input.userId, result: "expired", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new QrError("EXPIRED", "Este QR ha caducado");
  }

  const [venue] = await conn.select().from(venues).where(eq(venues.id, qr.venueId)).limit(1);
  if (!venue || venue.status !== "active") {
    await logAttempt(conn, { qrId: qr.id, tokenFingerprint: codeHash, userId: input.userId, result: "venue_inactive", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new QrError("VENUE_INACTIVE", "Este venue no está activo");
  }

  // Autorización de comunidad: si el venue está vinculado a alguna(s)
  // comunidad(es), el estudiante debe pertenecer a una de ellas. Un venue
  // SIN ningún vínculo de comunidad (dato incompleto/no configurado, no
  // "global" a propósito) no bloquea el canje — un fallo de configuración
  // del admin no debe convertirse en un QR válido pero infranjeable para el
  // estudiante. `input.communityId` la resuelve el router a partir de la
  // membresía real del estudiante (nunca un valor enviado directamente por
  // el cliente sin verificar) — ver server/routers/consumptionQr.ts.
  if (input.communityId != null) {
    const venueCommunityRows = await conn.select({ communityId: communityVenues.communityId })
      .from(communityVenues).where(eq(communityVenues.venueId, qr.venueId));
    const hasScopeRestriction = venueCommunityRows.length > 0;
    const isAuthorized = !hasScopeRestriction || venueCommunityRows.some(r => r.communityId === input.communityId);
    if (!isAuthorized) {
      await logAttempt(conn, { qrId: qr.id, tokenFingerprint: codeHash, userId: input.userId, result: "community_not_authorized", ipAddress: input.ipAddress, userAgent: input.userAgent });
      throw new QrError("COMMUNITY_NOT_AUTHORIZED", "Este venue no pertenece a tu comunidad");
    }
  }

  let product: typeof venueProducts.$inferSelect | null = null;
  if (qr.productId) {
    const [row] = await conn.select().from(venueProducts).where(eq(venueProducts.id, qr.productId)).limit(1);
    if (!row || !row.isActive) {
      await logAttempt(conn, { qrId: qr.id, tokenFingerprint: codeHash, userId: input.userId, result: "product_inactive", ipAddress: input.ipAddress, userAgent: input.userAgent });
      throw new QrError("PRODUCT_INACTIVE", "Este producto no está activo");
    }
    product = row;
  }

  try {
    const engineResult = await conn.transaction(async (tx) => {
      const [updateResult] = await tx.update(consumptionQrCodes)
        .set({ status: "redeemed", redeemedAt: new Date(), redeemedByUserId: input.userId })
        .where(and(eq(consumptionQrCodes.id, qr.id), eq(consumptionQrCodes.status, "issued")));
      if ((updateResult as unknown as { affectedRows: number }).affectedRows === 0) {
        throw new QrError("ALREADY_REDEEMED", "Este QR ya ha sido canjeado");
      }

      const result = await earnTokens({
        userId: input.userId,
        communityId: input.communityId,
        venueId: qr.venueId,
        productId: qr.productId,
        amountSpent: qr.amountCents != null ? qr.amountCents / 100 : undefined,
        origin: "consumption",
        idempotencyKey: `consumption_qr:${qr.id}`,
        createdByUserId: input.userId,
      }, tx);

      await tx.update(consumptionQrCodes).set({ ledgerId: result.ledger.id }).where(eq(consumptionQrCodes.id, qr.id));

      return result;
    });

    await logAttempt(conn, { qrId: qr.id, tokenFingerprint: codeHash, userId: input.userId, result: "success", ipAddress: input.ipAddress, userAgent: input.userAgent });

    const [updatedQr] = await conn.select().from(consumptionQrCodes).where(eq(consumptionQrCodes.id, qr.id)).limit(1);

    return {
      qr: updatedQr,
      breakdown: engineResult.breakdown,
      balanceBefore: engineResult.wallet.balance - engineResult.breakdown.final,
      balanceAfter: engineResult.wallet.balance,
      venueName: venue.name,
      productName: product?.name ?? null,
    };
  } catch (err) {
    await logAttempt(conn, {
      qrId: qr.id, tokenFingerprint: codeHash, userId: input.userId,
      result: mapErrorToAttemptResult(err), ipAddress: input.ipAddress, userAgent: input.userAgent,
    });
    throw err;
  }
}

// ─── CANCELACIÓN ─────────────────────────────────────────────────────────────

export interface CancelQrInput {
  qrId: number;
  reason: string;
  cancelledByUserId: number;
}

/**
 * Solo cancela un QR en estado `issued` — un QR `redeemed` nunca se cancela
 * directamente (usar reverseTransaction de Fase 2 sobre su ledger_id). El
 * UPDATE condicional (`WHERE status='issued'`) es igual de atómico que el
 * del canje — dos cancelaciones simultáneas del mismo QR también quedan
 * serializadas correctamente.
 */
export async function cancelConsumptionQr(input: CancelQrInput, db?: DbHandle): Promise<ConsumptionQrCode> {
  if (!input.reason || !input.reason.trim()) {
    throw new QrError("REASON_REQUIRED", "La cancelación requiere un motivo");
  }
  const conn = db ?? (await getDb());
  const [result] = await conn.update(consumptionQrCodes)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelledByUserId: input.cancelledByUserId, cancelReason: input.reason })
    .where(and(eq(consumptionQrCodes.id, input.qrId), eq(consumptionQrCodes.status, "issued")));

  if ((result as unknown as { affectedRows: number }).affectedRows === 0) {
    const [qr] = await conn.select().from(consumptionQrCodes).where(eq(consumptionQrCodes.id, input.qrId)).limit(1);
    if (!qr) throw new QrError("NOT_FOUND", "QR no encontrado");
    throw new QrError("CANNOT_CANCEL", `No se puede cancelar un QR en estado '${qr.status}'`);
  }

  const [updated] = await conn.select().from(consumptionQrCodes).where(eq(consumptionQrCodes.id, input.qrId)).limit(1);
  return updated;
}

export async function getConsumptionQrStatus(qrId: number, db?: DbHandle): Promise<ConsumptionQrCode | null> {
  const conn = db ?? (await getDb());
  const [qr] = await conn.select().from(consumptionQrCodes).where(eq(consumptionQrCodes.id, qrId)).limit(1);
  return qr ?? null;
}
