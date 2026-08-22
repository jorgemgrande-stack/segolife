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
 *
 * INTEGRACIÓN CON FASE 4 (Benefits): tras earnTokens(), se llama a
 * `evaluateBenefitsForOrigin` DENTRO de la MISMA transacción — si el canje
 * de QR también desbloquea uno o varios Benefits, se conceden atómicamente
 * junto con el ledger y la marca `redeemed` del QR (ver informe de Fase 4,
 * política de atomicidad: "para beneficios disparados directamente por un
 * QR de consumición, se prioriza la consistencia"). Si evaluateBenefitsForOrigin
 * lanza, TODA la transacción se revierte — nunca queda un QR canjeado con
 * tokens acreditados pero un Benefit a medio conceder, ni viceversa. Un
 * canje que NO desbloquea ningún Benefit sigue funcionando exactamente
 * igual que en Fase 3 (`benefitsUnlocked: []`) — este import es la ÚNICA
 * dependencia de Fase 4 en este archivo; el motor de Benefits en sí nunca
 * importa nada de este servicio (ver benefitRuleEngine.ts, cabecera).
 *
 * EVENTO `BenefitGranted` (ver benefitEvents.ts): se emite DESPUÉS de que
 * `conn.transaction(...)` haya confirmado con éxito, nunca dentro — evita
 * notificar una concesión que la propia transacción podría todavía
 * revertir. `grantedForEvents` se rellena dentro del callback pero solo se
 * recorre tras el `await` de la transacción; si esta lanza, el `catch` de
 * más abajo intercepta el control de flujo antes de llegar al bucle de
 * emisión — es intencional, no un olvido.
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
  events,
  type ConsumptionQrCode,
  type QrBatch,
} from "../../../drizzle/schema";
import { earnTokens, type TokenBreakdown } from "../tokens/tokenEngine";
import { TokenEngineError, reverseTransaction, isLedgerEntryReversed } from "../tokens/tokenLedgerService";
import { evaluateBenefitsForOrigin } from "../benefits/benefitRuleEngine";
import { buildBenefitUnlockedSummaries, type BenefitUnlockedSummary } from "../benefits/benefitSummary";
import { emitBenefitGranted, buildBenefitGrantedPayload } from "../benefits/benefitEvents";

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
  | "CANNOT_CANCEL"
  | "NOT_REDEEMED"
  // F63 (QR de consumición 2.0)
  | "EVENT_NOT_FOUND"
  | "EVENT_MISSING_START"
  | "NOT_YOUR_QR"
  | "ALREADY_ASSIGNED"
  | "INVALID_EXPIRY_MODE";

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

export type QrExpiryMode = "from_issue" | "from_event" | "from_assignment" | "custom" | "none";

export interface IssueQrInput {
  venueId: number;
  productId?: number | null;
  amountCents?: number | null;
  quantity?: number;
  /** Compatibilidad total (spec F63: "no romper QR ya generados"): si no se indica `expiryMode`, comportamiento IDÉNTICO al de siempre — este valor se usa tal cual, sin ningún cálculo. */
  expiresAt?: Date | null;
  /** F63 — por defecto 'from_issue' (comportamiento histórico). Ver comentario de drizzle/schema.ts para el significado de cada modo. */
  expiryMode?: QrExpiryMode;
  /** Requerido si expiryMode='from_event'. */
  eventId?: number | null;
  /** Minutos desde el momento de anclaje (emisión/inicio del evento/asignación) — null en 'from_issue'/'from_event' = usa `expiresAt` tal cual (compatibilidad); null en 'from_assignment' = sin caducidad una vez asignado. */
  expiryDurationMinutes?: number | null;
  /** F63 — si se indica, el QR nace ya asignado a este estudiante (solo tiene sentido con expiryMode='from_assignment'); si se omite, queda anónimo hasta una asignación posterior explícita (assignConsumptionQrToStudent). */
  assignedUserId?: number | null;
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

/**
 * Resuelve `expiresAt`/`assignedAt` en el momento de EMISIÓN según el modo
 * (spec F63). Nunca decide nada en el canje — para cuando `redeemConsumptionQr`
 * lee el QR, `expiresAt` ya es un timestamp absoluto (o NULL) fijado aquí, y
 * la comparación de caducidad sigue siendo la misma de siempre.
 */
async function resolveIssueExpiry(
  conn: AnyDbHandle,
  input: Pick<IssueQrInput, "expiryMode" | "expiresAt" | "eventId" | "expiryDurationMinutes" | "assignedUserId">
): Promise<{ expiresAt: Date | null; assignedAt: Date | null }> {
  const mode = input.expiryMode ?? "from_issue";
  const durationMs = input.expiryDurationMinutes != null ? input.expiryDurationMinutes * 60_000 : null;

  switch (mode) {
    case "from_issue": {
      // Compatibilidad total: si ya viene un expiresAt explícito (uso histórico), se respeta tal cual.
      // Si en su lugar se indica una duración (uso nuevo), se calcula desde AHORA.
      if (input.expiresAt !== undefined) return { expiresAt: input.expiresAt ?? null, assignedAt: null };
      return { expiresAt: durationMs != null ? new Date(Date.now() + durationMs) : null, assignedAt: null };
    }
    case "from_event": {
      if (!input.eventId) throw new QrError("INVALID_EXPIRY_MODE", "expiryMode='from_event' requiere indicar un evento");
      const [event] = await conn.select({ startsAt: events.startsAt }).from(events).where(eq(events.id, input.eventId)).limit(1);
      if (!event) throw new QrError("EVENT_NOT_FOUND", "El evento indicado no existe");
      if (!event.startsAt) throw new QrError("EVENT_MISSING_START", "El evento indicado no tiene fecha/hora de inicio configurada");
      return { expiresAt: durationMs != null ? new Date(event.startsAt.getTime() + durationMs) : event.startsAt, assignedAt: null };
    }
    case "from_assignment": {
      // Sin asignar todavía: sin caducidad hasta que alguien lo asigne (assignConsumptionQrToStudent) — nunca caduca "solo" mientras espera.
      if (!input.assignedUserId) return { expiresAt: null, assignedAt: null };
      const now = new Date();
      return { expiresAt: durationMs != null ? new Date(now.getTime() + durationMs) : null, assignedAt: now };
    }
    case "custom":
      return { expiresAt: input.expiresAt ?? null, assignedAt: null };
    case "none":
      return { expiresAt: null, assignedAt: null };
  }
}

export async function issueConsumptionQr(input: IssueQrInput, db?: AnyDbHandle): Promise<IssuedQr> {
  const conn = db ?? (await getDb());
  const publicToken = generatePublicToken();
  const codeHash = hashToken(publicToken);
  const mode = input.expiryMode ?? "from_issue";
  const { expiresAt, assignedAt } = await resolveIssueExpiry(conn, input);
  const insertResult = await conn.insert(consumptionQrCodes).values({
    codeHash,
    venueId: input.venueId,
    productId: input.productId ?? null,
    amountCents: input.amountCents ?? null,
    quantity: input.quantity ?? 1,
    batchId: input.batchId ?? null,
    expiresAt,
    expiryMode: mode,
    eventId: input.eventId ?? null,
    expiryDurationMinutes: input.expiryDurationMinutes ?? null,
    assignedUserId: mode === "from_assignment" ? (input.assignedUserId ?? null) : null,
    assignedAt,
    sourceType: input.sourceType ?? "manual",
    sourceReference: input.sourceReference ?? null,
    issuedByUserId: input.issuedByUserId ?? null,
  });
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [qr] = await conn.select().from(consumptionQrCodes).where(eq(consumptionQrCodes.id, insertId)).limit(1);
  return { qr, publicToken };
}

/**
 * Asigna un QR ya emitido (expiryMode='from_assignment', todavía sin
 * asignar) a un estudiante concreto — el momento de ESTA llamada ancla la
 * caducidad (spec F63 "entrega/asignación al estudiante"). A partir de aquí
 * SOLO ese estudiante puede canjearlo (ver redeemConsumptionQr, NOT_YOUR_QR).
 * Reasignar el MISMO estudiante es idempotente (no reinicia el reloj); a
 * OTRO estudiante distinto se rechaza — una asignación es una reserva real,
 * no una etiqueta que se pueda pisar sin más.
 */
export async function assignConsumptionQrToStudent(qrId: number, userId: number, db?: AnyDbHandle): Promise<ConsumptionQrCode> {
  const conn = db ?? (await getDb());
  const [qr] = await conn.select().from(consumptionQrCodes).where(eq(consumptionQrCodes.id, qrId)).limit(1);
  if (!qr) throw new QrError("NOT_FOUND", "QR no encontrado");
  if (qr.expiryMode !== "from_assignment") {
    throw new QrError("INVALID_EXPIRY_MODE", "Solo un QR con modo de caducidad 'desde la asignación' puede asignarse a un estudiante");
  }
  if (qr.status !== "issued") {
    throw new QrError("CANNOT_CANCEL", `No se puede asignar un QR en estado '${qr.status}'`);
  }
  if (qr.assignedUserId === userId) return qr; // idempotente
  if (qr.assignedUserId != null) {
    throw new QrError("ALREADY_ASSIGNED", "Este QR ya está asignado a otro estudiante");
  }
  const now = new Date();
  const expiresAt = qr.expiryDurationMinutes != null ? new Date(now.getTime() + qr.expiryDurationMinutes * 60_000) : null;
  await conn.update(consumptionQrCodes).set({ assignedUserId: userId, assignedAt: now, expiresAt }).where(eq(consumptionQrCodes.id, qrId));
  const [updated] = await conn.select().from(consumptionQrCodes).where(eq(consumptionQrCodes.id, qrId)).limit(1);
  return updated;
}

// ─── EMISIÓN EN LOTE ─────────────────────────────────────────────────────────

export interface IssueBatchInput {
  venueId: number;
  productId?: number | null;
  amountCents?: number | null;
  quantity: number;
  expiresAt?: Date | null;
  // F63 — mismos modos que un QR individual; 'from_assignment' se admite
  // aquí (cada QR del lote nace sin asignar y se asigna uno a uno después,
  // nunca se reparte un mismo assignedUserId entre varios QR del lote).
  expiryMode?: QrExpiryMode;
  eventId?: number | null;
  expiryDurationMinutes?: number | null;
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
    expiryMode: input.expiryMode ?? "from_issue",
    eventId: input.eventId ?? null,
    expiryDurationMinutes: input.expiryDurationMinutes ?? null,
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
      expiryMode: input.expiryMode,
      eventId: input.eventId,
      expiryDurationMinutes: input.expiryDurationMinutes,
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
  /** Fase 4 — [] si este canje no desbloqueó ningún Benefit (caso normal). Nunca mezclado con `breakdown` (ver informe de Fase 4, "tokenResult y benefitsUnlocked siempre separados"). */
  benefitsUnlocked: BenefitUnlockedSummary[];
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

  // F63 — un QR asignado explícitamente (expiryMode='from_assignment') solo
  // puede canjearlo el estudiante al que se asignó; uno sin asignar (o con un
  // modo de caducidad distinto, que nunca se asigna) sigue siendo canjeable
  // por el primero que lo escanee, exactamente como siempre.
  if (qr.assignedUserId != null && qr.assignedUserId !== input.userId) {
    await logAttempt(conn, { qrId: qr.id, tokenFingerprint: codeHash, userId: input.userId, result: "not_your_qr", ipAddress: input.ipAddress, userAgent: input.userAgent });
    throw new QrError("NOT_YOUR_QR", "Este QR está asignado a otro estudiante");
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

  // Se rellena DENTRO de la transacción pero solo se usa para emitir
  // BenefitGranted DESPUÉS de que `conn.transaction(...)` resuelva con
  // éxito (ver más abajo) — si la transacción lanza, este array queda
  // asignado pero nunca se recorre, así que nunca se emite un evento sobre
  // una concesión que en realidad se revirtió. Ver benefitEvents.ts.
  let grantedForEvents: Awaited<ReturnType<typeof evaluateBenefitsForOrigin>> = [];

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
        sourceId: qr.id,
        idempotencyKey: `consumption_qr:${qr.id}`,
        createdByUserId: input.userId,
      }, tx);

      await tx.update(consumptionQrCodes).set({ ledgerId: result.ledger.id }).where(eq(consumptionQrCodes.id, qr.id));

      const unlocked = await evaluateBenefitsForOrigin({
        type: "consumption",
        userId: input.userId,
        venueId: qr.venueId,
        productId: qr.productId,
        amountCents: qr.amountCents ?? undefined,
        communityId: input.communityId,
        sourceId: qr.id,
        ledgerId: result.ledger.id,
        occurredAt: result.ledger.createdAt,
      }, tx);
      grantedForEvents = unlocked;
      const benefitsUnlocked = await buildBenefitUnlockedSummaries(unlocked, tx);

      return { ...result, benefitsUnlocked };
    });

    // La transacción confirmó con éxito — ahora sí es seguro notificar. Si
    // `conn.transaction(...)` hubiera lanzado, este bloque nunca se
    // alcanza (el catch de más abajo captura el error antes) y
    // `grantedForEvents` nunca se recorre, aunque ya estuviera asignado.
    for (const g of grantedForEvents) {
      emitBenefitGranted(buildBenefitGrantedPayload(g.userBenefit, g.definition));
    }

    await logAttempt(conn, { qrId: qr.id, tokenFingerprint: codeHash, userId: input.userId, result: "success", ipAddress: input.ipAddress, userAgent: input.userAgent });

    const [updatedQr] = await conn.select().from(consumptionQrCodes).where(eq(consumptionQrCodes.id, qr.id)).limit(1);

    return {
      qr: updatedQr,
      breakdown: engineResult.breakdown,
      balanceBefore: engineResult.wallet.balance - engineResult.breakdown.final,
      balanceAfter: engineResult.wallet.balance,
      venueName: venue.name,
      productName: product?.name ?? null,
      benefitsUnlocked: engineResult.benefitsUnlocked,
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

// ─── REVERSIÓN DE RECOMPENSA (SEGOLIFE — Venue Commerce, Consumption QR & SegoTokens, spec §31-33/§72/§96) ──

export interface ReverseQrRewardInput {
  qrId: number;
  reason: string;
  reversedByUserId: number;
}

export interface ReverseQrRewardResult {
  qr: ConsumptionQrCode;
  /** false si ya se había revertido antes (reintento idempotente) o si el canje nunca llegó a conceder tokens. */
  tokensReversed: boolean;
}

/**
 * Revierte los SegoTokens de un QR YA CANJEADO. El consumo físico sucedió de
 * verdad — a diferencia de `cancelConsumptionQr` (solo aplicable a
 * `issued`), este QR permanece `redeemed` para siempre, nunca se
 * reinterpreta como si no hubiera pasado (spec §31: "no convertir
 * simplemente a cancelled si hubo reward"). Solo se retira la recompensa vía
 * `reverseTransaction()` sobre `qr.ledgerId` — el mismo movimiento exacto
 * que generó `redeemConsumptionQr`, nunca recalculado. Idempotente: un
 * segundo intento sobre el mismo QR ya revertido devuelve
 * `tokensReversed:false` en vez de fallar (mismo criterio que
 * `ticketCancellationService.ts::reverseNativePurchaseReward`).
 */
export async function reverseConsumptionQrReward(input: ReverseQrRewardInput, db?: DbHandle): Promise<ReverseQrRewardResult> {
  if (!input.reason || !input.reason.trim()) {
    throw new QrError("REASON_REQUIRED", "La reversión requiere un motivo");
  }
  const conn = db ?? (await getDb());
  const [qr] = await conn.select().from(consumptionQrCodes).where(eq(consumptionQrCodes.id, input.qrId)).limit(1);
  if (!qr) throw new QrError("NOT_FOUND", "QR no encontrado");
  if (qr.status !== "redeemed") {
    throw new QrError("NOT_REDEEMED", `Solo se puede revertir un QR canjeado (estado actual: ${qr.status})`);
  }

  let tokensReversed = false;
  if (qr.ledgerId != null && !(await isLedgerEntryReversed(qr.ledgerId, conn))) {
    await reverseTransaction({
      ledgerId: qr.ledgerId,
      reason: `Reversión de canje QR #${qr.id}: ${input.reason}`,
      adminUserId: input.reversedByUserId,
    }, conn);
    tokensReversed = true;
  }

  return { qr, tokensReversed };
}
