/**
 * benefitPurchaseService.ts — SEGOLIFE Benefits Marketplace & SegoTokens
 * Redemption. Único punto de escritura para "un Student gasta SegoTokens
 * para adquirir un Benefit" — origen `sourceType="token_purchase"`,
 * inequívocamente distinto de un Benefit automático (`benefitRuleId`
 * poblado, `sourceType` del origen real: consumption/ticket/event_attendance/
 * manual — nunca "token_purchase").
 *
 * NO reutiliza `spendTokens()` (spec §17, comprobado explícitamente): su
 * modelo de coste está anclado a una fila de `token_rules` con scope
 * venue+product, pensado para "este producto de este venue cuesta N tokens
 * según la regla configurada" — no para "esta benefit_definition concreta
 * cuesta N tokens", que es el modelo real del marketplace. En su lugar se
 * llama a `postLedgerMovementInTx` directamente (el mismo motor de
 * ledger/wallet que spendTokens usa por debajo), evitando forzar una fila de
 * token_rules artificial por cada Benefit. `spendTokens()` sigue existiendo
 * sin cambios para su caso de uso real (gasto por regla de venue/producto).
 *
 * ATOMICIDAD (spec §16/§20/§21): UNA transacción — lock de la fila de
 * benefit_definitions (spec §21, mismo patrón que
 * inventoryHoldService.createHold: SELECT...FOR UPDATE serializa dos
 * compras concurrentes del último stock), validar elegibilidad, contar
 * comprometido (stock + límite por Student, SIEMPRE en caliente sobre
 * user_benefits — nunca un contador mutable, mismo criterio que
 * community_supports/inventoryHoldService), débito de wallet
 * (postLedgerMovementInTx — su propio lock de fila + rechazo de saldo
 * negativo, spec §20), y grantBenefit (mismo tx). Si cualquier paso falla,
 * TODO se revierte — nunca wallet descontada sin Benefit, nunca Benefit sin
 * tokens descontados.
 */
import { eq, and, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { benefitDefinitions, benefitCommunities, userBenefits, tokenWallets, type UserBenefit } from "../../../drizzle/schema";
import { postLedgerMovementInTx, type AnyDbHandle, TokenEngineError } from "../tokens/tokenLedgerService";
import { grantBenefit } from "./benefitGrantService";
import { TOKEN_PURCHASE_SOURCE_TYPE } from "../../db/benefitsDb";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];

async function getDb(): Promise<DbHandle> {
  return _db;
}

export { TOKEN_PURCHASE_SOURCE_TYPE };

export type BenefitPurchaseErrorCode =
  | "NOT_FOUND"
  | "NOT_MARKETPLACE_ENABLED"
  | "INACTIVE"
  | "NOT_YET_AVAILABLE"
  | "PURCHASE_WINDOW_ENDED"
  | "NOT_ELIGIBLE_COMMUNITY"
  | "LIMIT_EXCEEDED"
  | "OUT_OF_STOCK"
  | "INSUFFICIENT_BALANCE";

export class BenefitPurchaseError extends Error {
  code: BenefitPurchaseErrorCode;
  constructor(code: BenefitPurchaseErrorCode, message: string) {
    super(message);
    this.name = "BenefitPurchaseError";
    this.code = code;
  }
}

export interface PurchaseBenefitInput {
  userId: number;
  benefitDefinitionId: number;
  /** Comunidad real del Student (resuelta por el caller vía user_communities) — nunca inferida aquí. */
  communityId: number | null;
  /** Generada por el cliente por cada intento de compra (spec §19) — un doble-click/retry reenvía la MISMA clave, nunca gasta dos veces. */
  idempotencyKey: string;
}

export interface PurchaseBenefitResult {
  userBenefit: UserBenefit;
  qrToken: string;
  ledgerId: number;
  walletBalance: number;
  /** false si la compra ya existía por idempotencia (reintento) — no se volvió a cobrar ni conceder. */
  created: boolean;
}

/** Comprometido = concesiones NO canceladas de este origen — mismo criterio "en caliente" que countGrantsByRuleForUser (benefitGrantService.ts), aplicado al origen token_purchase en vez de benefitRuleId. */
async function countActivePurchases(tx: TxHandle, benefitDefinitionId: number, userId?: number): Promise<number> {
  const conditions = [
    eq(userBenefits.benefitDefinitionId, benefitDefinitionId),
    eq(userBenefits.sourceType, TOKEN_PURCHASE_SOURCE_TYPE),
    ne(userBenefits.status, "cancelled"),
  ];
  if (userId != null) conditions.push(eq(userBenefits.userId, userId));
  const rows = await tx.select({ id: userBenefits.id }).from(userBenefits).where(and(...conditions));
  return rows.length;
}

async function isEligibleForCommunity(tx: TxHandle, benefitDefinitionId: number, communityId: number | null): Promise<boolean> {
  const scopeRows = await tx.select({ communityId: benefitCommunities.communityId }).from(benefitCommunities)
    .where(eq(benefitCommunities.benefitDefinitionId, benefitDefinitionId));
  if (scopeRows.length === 0) return true; // sin filas = global, mismo criterio que benefit_rules/campaigns
  if (communityId == null) return false;
  return scopeRows.some(r => r.communityId === communityId);
}

export async function purchaseBenefitWithTokens(input: PurchaseBenefitInput, db?: AnyDbHandle): Promise<PurchaseBenefitResult> {
  const conn = (db ?? (await getDb())) as DbHandle;

  return conn.transaction(async (tx) => {
    // Idempotencia PRIMERO (spec §19) — ANTES de tocar stock/límites. Un
    // reintento con la MISMA clave nunca debe volver a contar comprometido
    // (la compra original ya cuenta, re-evaluar límites la penalizaría) ni
    // volver a debitar — se devuelve el resultado ya confirmado tal cual.
    const [existing] = await tx.select().from(userBenefits)
      .where(eq(userBenefits.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) {
      const [wallet] = await tx.select({ balance: tokenWallets.balance }).from(tokenWallets)
        .where(eq(tokenWallets.userId, input.userId)).limit(1);
      return {
        userBenefit: existing,
        qrToken: existing.qrToken ?? "",
        ledgerId: existing.sourceLedgerId ?? 0,
        walletBalance: wallet?.balance ?? 0,
        created: false,
      };
    }

    const [definition] = await tx.select().from(benefitDefinitions)
      .where(eq(benefitDefinitions.id, input.benefitDefinitionId)).limit(1).for("update");
    if (!definition) throw new BenefitPurchaseError("NOT_FOUND", "Beneficio no encontrado");
    if (!definition.active) throw new BenefitPurchaseError("INACTIVE", "Este beneficio no está activo");
    if (!definition.isMarketplaceEnabled || !definition.tokenCost || definition.tokenCost <= 0) {
      throw new BenefitPurchaseError("NOT_MARKETPLACE_ENABLED", "Este beneficio no está disponible para canjear con SegoTokens");
    }

    const now = new Date();
    if (definition.purchaseWindowStart && definition.purchaseWindowStart > now) {
      throw new BenefitPurchaseError("NOT_YET_AVAILABLE", "Este beneficio todavía no está disponible");
    }
    if (definition.purchaseWindowEnd && definition.purchaseWindowEnd < now) {
      throw new BenefitPurchaseError("PURCHASE_WINDOW_ENDED", "Este beneficio ya no está disponible para canjear");
    }

    if (!(await isEligibleForCommunity(tx, definition.id, input.communityId))) {
      throw new BenefitPurchaseError("NOT_ELIGIBLE_COMMUNITY", "Este beneficio no está disponible para tu comunidad");
    }

    if (definition.perStudentPurchaseLimit != null) {
      const mine = await countActivePurchases(tx, definition.id, input.userId);
      if (mine >= definition.perStudentPurchaseLimit) {
        throw new BenefitPurchaseError("LIMIT_EXCEEDED", "Ya has alcanzado el límite de canjes para este beneficio");
      }
    }

    if (definition.marketplaceInventoryTotal != null) {
      const total = await countActivePurchases(tx, definition.id);
      if (total >= definition.marketplaceInventoryTotal) {
        throw new BenefitPurchaseError("OUT_OF_STOCK", "Este beneficio se ha agotado");
      }
    }

    let ledgerId: number;
    let walletBalance: number;
    try {
      const { ledger, wallet } = await postLedgerMovementInTx(tx, {
        userId: input.userId,
        direction: "debit",
        amount: definition.tokenCost,
        reason: `Canje: ${definition.name}`,
        sourceType: TOKEN_PURCHASE_SOURCE_TYPE,
        sourceId: definition.id,
        idempotencyKey: input.idempotencyKey,
      });
      ledgerId = ledger.id;
      walletBalance = wallet.balance;
    } catch (err) {
      if (err instanceof TokenEngineError && err.code === "INSUFFICIENT_BALANCE") {
        throw new BenefitPurchaseError("INSUFFICIENT_BALANCE", "No tienes suficientes SegoTokens para este beneficio");
      }
      throw err;
    }

    const validUntil = definition.redemptionValidityDays != null
      ? new Date(now.getTime() + definition.redemptionValidityDays * 24 * 60 * 60 * 1000)
      : null;

    const granted = await grantBenefit({
      userId: input.userId,
      benefitDefinitionId: definition.id,
      benefitRuleId: null,
      sourceType: TOKEN_PURCHASE_SOURCE_TYPE,
      sourceLedgerId: ledgerId,
      communityId: input.communityId,
      validFrom: now,
      validUntil,
      idempotencyKey: input.idempotencyKey,
    }, tx);

    return {
      userBenefit: granted.benefit,
      qrToken: granted.qrToken,
      ledgerId,
      walletBalance,
      created: granted.created,
    };
  });
}
