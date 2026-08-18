/**
 * tokenLedgerService.ts — núcleo atómico del motor de SegoTokens (Fase 2).
 *
 * `postLedgerMovement` es la ÚNICA función que escribe en token_wallets +
 * token_ledger — todo lo demás (tokenEngine.ts, adjustManualTokens,
 * reverseTransaction) pasa por aquí. Garantías:
 *
 *  - ATOMICIDAD: wallet + ledger se actualizan dentro de la misma transacción
 *    MySQL (db.transaction). Nunca se crea un ledger sin actualizar el
 *    wallet, ni viceversa.
 *  - CONCURRENCIA: el wallet se lee con `SELECT ... FOR UPDATE` dentro de la
 *    transacción — dos débitos simultáneos sobre el mismo wallet quedan
 *    serializados por el motor MySQL real, no por lógica de aplicación.
 *  - IDEMPOTENCIA: si se proporciona `idempotencyKey` y ya existe un
 *    movimiento con esa clave, se devuelve el movimiento existente sin
 *    repetir el efecto (ni siquiera si dos peticiones llegan a la vez — el
 *    UNIQUE de MySQL sobre idempotency_key corta la carrera y el ER_DUP_ENTRY
 *    se captura para reconsultar en vez de fallar).
 *  - INMUTABILIDAD: nunca se hace UPDATE/DELETE de una fila de token_ledger
 *    ya insertada. Una corrección es un movimiento nuevo de signo opuesto
 *    (ver reverseTransaction).
 *  - SALDO NUNCA NEGATIVO EN OPERACIONES ORDINARIAS: un `debit` que dejaría
 *    balance < 0 lanza TokenEngineError('INSUFFICIENT_BALANCE') y revierte
 *    la transacción. ÚNICA excepción (Loyalty Production Hardening,
 *    2026-08-14, spec §7): `allowNegativeBalance:true`, que SOLO
 *    `reverseTransaction()` puede activar — permite que revertir un earn ya
 *    gastado deje el wallet en negativo (deuda que las siguientes
 *    recompensas compensan primero) en vez de bloquear una reversión
 *    legítima. Ningún gasto/canje/ajuste ordinario puede pasar este flag.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, gte, desc, sql as drizzleSql, type SQL } from "drizzle-orm";
import {
  tokenWallets,
  tokenLedger,
  users,
  type TokenWallet,
  type TokenLedgerEntry,
} from "../../../drizzle/schema";

// Pool con más de 1 conexión (a diferencia de venuesDb.ts/studentsDb.ts) —
// aquí varias transacciones concurrentes SÍ deben poder abrirse a la vez
// (cada una sobre su propia conexión); es el SELECT...FOR UPDATE dentro de
// cada transacción, no el tamaño del pool, lo que serializa el acceso a un
// mismo wallet.
const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 5 });
const _db = drizzle(_pool);

export type DbHandle = typeof _db;
// El callback de `.transaction()` recibe un tipo distinto (MySqlTransaction),
// incompatible en TypeScript con MySql2Database aunque comparten la misma
// API de query builder en tiempo de ejecución — este alias cubre ambos.
// Exportado para que tokenScheduleService/tokenRuleEngine/tokenEngine (y
// consumptionQrService, Fase 3) puedan aceptar una transacción ya abierta
// (p.ej. la que abre el canje de QR) sin duplicar este workaround.
export type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
export type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type TokenEngineErrorCode =
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_BALANCE"
  | "NOT_FOUND"
  | "ALREADY_REVERSED"
  | "REASON_REQUIRED"
  | "OUTSIDE_SCHEDULE"
  | "NO_RULE_FOUND"
  | "RULE_LIMIT_EXCEEDED"
  // SegoTokens Live Activation (spec §19) — GLOBAL LIVE SWITCH real, ver tokenEngine.ts:LIVE_LOYALTY_ENABLED.
  | "GLOBAL_LIVE_DISABLED";

export class TokenEngineError extends Error {
  code: TokenEngineErrorCode;
  constructor(code: TokenEngineErrorCode, message: string) {
    super(message);
    this.name = "TokenEngineError";
    this.code = code;
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return !!err && typeof err === "object" && "errno" in err && (err as { errno?: number }).errno === 1062;
}

export interface PostLedgerMovementInput {
  userId: number;
  direction: "credit" | "debit";
  /** Siempre positivo — direction determina el signo real aplicado al balance. */
  amount: number;
  reason: string;
  sourceType: string;
  sourceId?: number | null;
  venueId?: number | null;
  eventId?: number | null;
  ruleId?: number | null;
  campaignId?: number | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
  createdByUserId?: number | null;
  reversedLedgerId?: number | null;
  /** SOLO `reverseTransaction()` — ver comentario de cabecera. Nunca pasar `true` desde spendTokens/QR/ajuste manual. */
  allowNegativeBalance?: boolean;
}

/**
 * Exportada (Loyalty Production Hardening, 2026-08-14) para que tokenEngine.ts
 * pueda anidar el lock de presupuesto de campaña (`SELECT...FOR UPDATE` sobre
 * `token_campaigns`) DENTRO de la MISMA transacción que el insert del ledger
 * — mismo criterio de atomicidad que ya protege token_wallets, sin duplicar
 * este núcleo. Nunca llamar fuera de una transacción ya abierta.
 */
export async function postLedgerMovementInTx(
  tx: AnyDbHandle,
  input: PostLedgerMovementInput
): Promise<{ wallet: TokenWallet; ledger: TokenLedgerEntry }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new TokenEngineError("INVALID_AMOUNT", "El importe debe ser un entero positivo");
  }

  // 1. Idempotencia — comprobación previa (camino feliz, sin carrera).
  if (input.idempotencyKey) {
    const [existing] = await tx.select().from(tokenLedger)
      .where(eq(tokenLedger.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) {
      const [wallet] = await tx.select().from(tokenWallets).where(eq(tokenWallets.id, existing.walletId)).limit(1);
      return { wallet, ledger: existing };
    }
  }

  // 2. Wallet con lock de fila — ensureWallet inline para no salir de la transacción.
  let [wallet] = await tx.select().from(tokenWallets)
    .where(eq(tokenWallets.userId, input.userId)).limit(1).for("update");
  if (!wallet) {
    await tx.insert(tokenWallets).values({ userId: input.userId });
    [wallet] = await tx.select().from(tokenWallets)
      .where(eq(tokenWallets.userId, input.userId)).limit(1).for("update");
  }

  // 3. Calcular nuevo saldo — nunca negativo, salvo reversión legítima explícita.
  const delta = input.direction === "credit" ? input.amount : -input.amount;
  const newBalance = wallet.balance + delta;
  if (newBalance < 0 && !input.allowNegativeBalance) {
    throw new TokenEngineError(
      "INSUFFICIENT_BALANCE",
      `Saldo insuficiente: ${wallet.balance} disponible(s), se intentó descontar ${input.amount}`
    );
  }

  // 4. Insertar ledger (capturando la carrera de idempotencia si dos
  //    peticiones con la misma clave llegan a la vez).
  let insertId: number;
  try {
    const insertResult = await tx.insert(tokenLedger).values({
      walletId: wallet.id,
      userId: input.userId,
      direction: input.direction,
      amount: input.amount,
      balanceAfter: newBalance,
      reason: input.reason,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      venueId: input.venueId ?? null,
      eventId: input.eventId ?? null,
      ruleId: input.ruleId ?? null,
      campaignId: input.campaignId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: input.metadata ?? null,
      createdByUserId: input.createdByUserId ?? null,
      reversedLedgerId: input.reversedLedgerId ?? null,
    });
    insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  } catch (err) {
    if (isDuplicateKeyError(err) && input.idempotencyKey) {
      const [existing] = await tx.select().from(tokenLedger)
        .where(eq(tokenLedger.idempotencyKey, input.idempotencyKey)).limit(1);
      if (existing) {
        const [existingWallet] = await tx.select().from(tokenWallets).where(eq(tokenWallets.id, existing.walletId)).limit(1);
        return { wallet: existingWallet, ledger: existing };
      }
    }
    throw err;
  }

  // 5. Actualizar wallet — misma transacción, nunca desde la UI directamente.
  //    lifetime_earned/lifetime_spent reflejan actividad GENUINA de
  //    ganar/gastar — una reversión (reversedLedgerId != null) corrige el
  //    contador que infló el movimiento original en vez de inflar también
  //    el contrario (Loyalty Production Hardening, 2026-08-14): revertir un
  //    earn de 100 resta 100 de lifetime_earned, NUNCA suma 100 a
  //    lifetime_spent (ese Student jamás "gastó" nada) — y viceversa para la
  //    reversión de un debit. Nunca por debajo de 0 (defensivo).
  const isReversal = input.reversedLedgerId != null;
  const lifetimeEarned = isReversal && input.direction === "debit"
    ? Math.max(0, wallet.lifetimeEarned - input.amount) // revierte un credit anterior
    : !isReversal && input.direction === "credit" ? wallet.lifetimeEarned + input.amount : wallet.lifetimeEarned;
  const lifetimeSpent = isReversal && input.direction === "credit"
    ? Math.max(0, wallet.lifetimeSpent - input.amount) // revierte un debit anterior
    : !isReversal && input.direction === "debit" ? wallet.lifetimeSpent + input.amount : wallet.lifetimeSpent;
  await tx.update(tokenWallets).set({
    balance: newBalance,
    lifetimeEarned,
    lifetimeSpent,
  }).where(eq(tokenWallets.id, wallet.id));

  const [updatedWallet] = await tx.select().from(tokenWallets).where(eq(tokenWallets.id, wallet.id)).limit(1);
  const [ledgerRow] = await tx.select().from(tokenLedger).where(eq(tokenLedger.id, insertId)).limit(1);
  return { wallet: updatedWallet, ledger: ledgerRow };
}

export async function postLedgerMovement(
  input: PostLedgerMovementInput,
  db?: AnyDbHandle
): Promise<{ wallet: TokenWallet; ledger: TokenLedgerEntry }> {
  const conn = db ?? (await getDb());
  return conn.transaction(tx => postLedgerMovementInTx(tx, input));
}

export interface ReverseTransactionInput {
  ledgerId: number;
  reason: string;
  /**
   * `null` = reversión disparada automáticamente por el sistema (p.ej. un
   * refund de Fourvenues detectado en `updateExistingOrder()`), sin ningún
   * admin humano de por medio — mismo criterio de nullable ya aceptado por
   * `postLedgerMovementInTx`/`createdByUserId`. Un admin real siempre pasa
   * su propio `ctx.user.id` (comportamiento sin cambios).
   */
  adminUserId: number | null;
}

/**
 * Reversión (administrativa o automática por refund) — nunca borra/edita el
 * movimiento original. Impide doble reversal comprobando (dentro de la
 * MISMA transacción que la inserción) que ninguna otra fila ya referencia
 * `reversedLedgerId = ledgerId`. `allowNegativeBalance:true` SIEMPRE — una
 * reversión legítima de un earn ya gastado no debe bloquearse por saldo
 * insuficiente (spec §7); el saldo negativo resultante se compensa con la
 * siguiente recompensa real de ese Student.
 */
export async function reverseTransaction(
  input: ReverseTransactionInput,
  db?: AnyDbHandle
): Promise<{ wallet: TokenWallet; ledger: TokenLedgerEntry }> {
  if (!input.reason || !input.reason.trim()) {
    throw new TokenEngineError("REASON_REQUIRED", "La reversión requiere un motivo");
  }
  const conn = db ?? (await getDb());
  return conn.transaction(async (tx) => {
    const [original] = await tx.select().from(tokenLedger).where(eq(tokenLedger.id, input.ledgerId)).limit(1);
    if (!original) throw new TokenEngineError("NOT_FOUND", "Movimiento no encontrado");

    const [alreadyReversed] = await tx.select({ id: tokenLedger.id }).from(tokenLedger)
      .where(eq(tokenLedger.reversedLedgerId, input.ledgerId)).limit(1);
    if (alreadyReversed) throw new TokenEngineError("ALREADY_REVERSED", "Este movimiento ya ha sido revertido");

    const oppositeDirection = original.direction === "credit" ? "debit" : "credit";
    return postLedgerMovementInTx(tx, {
      userId: original.userId,
      direction: oppositeDirection,
      amount: original.amount,
      reason: input.reason,
      sourceType: "reversal",
      sourceId: original.id,
      venueId: original.venueId,
      eventId: original.eventId,
      ruleId: original.ruleId,
      campaignId: original.campaignId,
      createdByUserId: input.adminUserId,
      reversedLedgerId: original.id,
      allowNegativeBalance: true,
    });
  });
}

/** Reutilizable por rewardStateMachine.ts — evita duplicar la consulta que ya hace reverseTransaction() internamente. */
export async function isLedgerEntryReversed(ledgerId: number, db?: AnyDbHandle): Promise<boolean> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select({ id: tokenLedger.id }).from(tokenLedger)
    .where(eq(tokenLedger.reversedLedgerId, ledgerId)).limit(1);
  return !!row;
}

/**
 * MG-02 — Confirmación de compra (spec §11): "¿este Student ya ganó ST de
 * verdad por este origen/sourceId concreto?" — de solo lectura, nunca
 * duplica el ledger en una tabla/columna aparte (spec §40: "es muy probable
 * que estés duplicando información que el motor ya conoce"). Un grant
 * revertido (p.ej. por un reembolso, ver ticketCancellationService.ts)
 * nunca se reporta como "ganado" — el Student ya no lo tiene de verdad.
 */
export async function findActiveGrantBySource(
  userId: number,
  sourceType: string,
  sourceId: number,
  db?: AnyDbHandle
): Promise<{ ledgerId: number; amount: number } | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(tokenLedger)
    .where(and(eq(tokenLedger.userId, userId), eq(tokenLedger.sourceType, sourceType), eq(tokenLedger.sourceId, sourceId), eq(tokenLedger.direction, "credit")))
    .limit(1);
  if (!row) return null;
  if (await isLedgerEntryReversed(row.id, conn)) return null;
  return { ledgerId: row.id, amount: row.amount };
}

export interface AdjustManualTokensInput {
  userId: number;
  direction: "credit" | "debit";
  amount: number;
  reason: string;
  adminUserId: number;
}

/** Ajuste manual de admin (+/-) — motivo obligatorio, pasa por el mismo núcleo atómico. Nunca edita balance directamente. */
export async function adjustManualTokens(
  input: AdjustManualTokensInput,
  db?: AnyDbHandle
): Promise<{ wallet: TokenWallet; ledger: TokenLedgerEntry }> {
  if (!input.reason || !input.reason.trim()) {
    throw new TokenEngineError("REASON_REQUIRED", "El ajuste manual requiere un motivo");
  }
  return postLedgerMovement({
    userId: input.userId,
    direction: input.direction,
    amount: input.amount,
    reason: input.reason,
    sourceType: "manual_adjustment",
    createdByUserId: input.adminUserId,
  }, db);
}

export async function ensureWallet(userId: number, db?: AnyDbHandle): Promise<TokenWallet> {
  const conn = db ?? (await getDb());
  const [existing] = await conn.select().from(tokenWallets).where(eq(tokenWallets.userId, userId)).limit(1);
  if (existing) return existing;
  try {
    await conn.insert(tokenWallets).values({ userId });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }
  const [created] = await conn.select().from(tokenWallets).where(eq(tokenWallets.userId, userId)).limit(1);
  return created;
}

export async function getWalletByUserId(userId: number, db?: AnyDbHandle): Promise<TokenWallet | null> {
  const conn = db ?? (await getDb());
  const [wallet] = await conn.select().from(tokenWallets).where(eq(tokenWallets.userId, userId)).limit(1);
  return wallet ?? null;
}

export interface LedgerListFilters {
  limit?: number;
  offset?: number;
}

export async function listLedgerByUserId(
  userId: number,
  filters: LedgerListFilters = {},
  db?: AnyDbHandle
): Promise<TokenLedgerEntry[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(tokenLedger).where(eq(tokenLedger.userId, userId))
    .orderBy(desc(tokenLedger.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);
}

export async function getLedgerById(id: number, db?: AnyDbHandle): Promise<TokenLedgerEntry | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(tokenLedger).where(eq(tokenLedger.id, id)).limit(1);
  return row ?? null;
}

// ─── Lecturas usadas por el motor de reglas (recurrencia + límites) ────────
// Se calculan en caliente contando token_ledger — deliberadamente NO existe
// una tabla de contadores separada (ver drizzle/schema.ts, comentario de
// token_rules) para no arriesgar un contador que se desincronice del ledger real.

export async function countRecentEarnEvents(
  userId: number,
  sinceDate: Date,
  venueId?: number,
  db?: AnyDbHandle
): Promise<number> {
  const conn = db ?? (await getDb());
  const conditions: SQL[] = [
    eq(tokenLedger.userId, userId),
    eq(tokenLedger.direction, "credit"),
    gte(tokenLedger.createdAt, sinceDate),
  ];
  if (venueId) conditions.push(eq(tokenLedger.venueId, venueId));
  const rows = await conn.select({ id: tokenLedger.id }).from(tokenLedger).where(and(...conditions));
  return rows.length;
}

export async function countDistinctVenuesVisited(
  userId: number,
  sinceDate: Date,
  db?: AnyDbHandle
): Promise<number> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({ venueId: tokenLedger.venueId }).from(tokenLedger)
    .where(and(eq(tokenLedger.userId, userId), eq(tokenLedger.direction, "credit"), gte(tokenLedger.createdAt, sinceDate)));
  const distinctVenues = new Set(rows.map(r => r.venueId).filter((v): v is number => v != null));
  return distinctVenues.size;
}

/**
 * Suma de tokens movidos por una regla concreta desde `sinceDate`, en una
 * dirección — usado por tokenEngine.ts para daily_limit/monthly_limit tanto
 * en earn (credit, se recorta el importe) como en spend (debit, se rechaza
 * la operación si ya se alcanzó el límite — descontar precio de un producto
 * no tiene sentido).
 */
export async function sumAmountByRuleInWindow(
  userId: number,
  ruleId: number,
  direction: "credit" | "debit",
  sinceDate: Date,
  db?: AnyDbHandle
): Promise<number> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({ amount: tokenLedger.amount }).from(tokenLedger)
    .where(and(
      eq(tokenLedger.userId, userId),
      eq(tokenLedger.ruleId, ruleId),
      eq(tokenLedger.direction, direction),
      gte(tokenLedger.createdAt, sinceDate)
    ));
  return rows.reduce((sum, r) => sum + r.amount, 0);
}

// ─── Agregados globales — dashboard admin (/admin/tokens) ──────────────────

export interface GlobalTokenStats {
  totalIssued: number;
  totalSpent: number;
  totalBalance: number;
}

/** Suma agregada real (no cacheada) — solo la consulta el dashboard admin, tráfico bajo. */
export async function getGlobalTokenStats(db?: AnyDbHandle): Promise<GlobalTokenStats> {
  const conn = db ?? (await getDb());
  const [[issuedRow], [spentRow], [balanceRow]] = await Promise.all([
    conn.select({ total: drizzleSql<string>`COALESCE(SUM(${tokenLedger.amount}), 0)` }).from(tokenLedger).where(eq(tokenLedger.direction, "credit")),
    conn.select({ total: drizzleSql<string>`COALESCE(SUM(${tokenLedger.amount}), 0)` }).from(tokenLedger).where(eq(tokenLedger.direction, "debit")),
    conn.select({ total: drizzleSql<string>`COALESCE(SUM(${tokenWallets.balance}), 0)` }).from(tokenWallets),
  ]);
  return {
    totalIssued: Number(issuedRow?.total ?? 0),
    totalSpent: Number(spentRow?.total ?? 0),
    totalBalance: Number(balanceRow?.total ?? 0),
  };
}

export interface RecentLedgerEntry extends TokenLedgerEntry {
  userName: string | null;
}

export async function listRecentLedgerGlobal(limit = 20, db?: AnyDbHandle): Promise<RecentLedgerEntry[]> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({ ledger: tokenLedger, userName: users.name }).from(tokenLedger)
    .leftJoin(users, eq(tokenLedger.userId, users.id))
    .orderBy(desc(tokenLedger.createdAt))
    .limit(limit);
  return rows.map(r => ({ ...r.ledger, userName: r.userName }));
}
