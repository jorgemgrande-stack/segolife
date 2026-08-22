/**
 * benefitPurchaseConcurrency.test.ts — F62 (SegoTokens: canje y Marketplace)
 * GATE de concurrencia real sobre STOCK, el hueco que ningún test existente
 * cubría: benefitPurchaseService.test.ts prueba OUT_OF_STOCK/procede-si-
 * queda-stock con una única llamada (nunca dos compitiendo por la última
 * unidad); crossModuleSpendConcurrency.test.ts ya demuestra la MISMA
 * garantía para el SALDO del wallet, pero no para el stock de un Benefit.
 *
 * Mismo criterio real (spec §21 de benefitPurchaseService.ts): la fila de
 * `benefit_definitions` se bloquea con SELECT...FOR UPDATE dentro de la
 * transacción — dos compras simultáneas de la ÚLTIMA unidad quedan
 * serializadas por ese lock real de MySQL, nunca por lógica de aplicación.
 * `postLedgerMovementInTx`/`grantBenefit` se mockean aquí (ya tienen su
 * propia cobertura de atomicidad en sus propios *.test.ts — no se duplica) —
 * lo que este archivo prueba SIN mockear es la lógica propia bajo test:
 * countActivePurchases() recontando en caliente DENTRO del lock, nunca un
 * contador mutable que pudiera desincronizarse.
 *
 * Misma técnica que crossModuleSpendConcurrency.test.ts: encadenar cada
 * `.transaction()` tras el anterior, de forma que la 2ª llamada solo
 * empieza a leer una vez la 1ª ya ha terminado de escribir — la misma
 * garantía que un lock de fila real da en producción.
 *
 * LÍMITE HONESTO (igual que crossModuleSpendConcurrency.test.ts): esto
 * prueba que dos llamadas a purchaseBenefitWithTokens() por la última
 * unidad de stock nunca completan ambas — pero sigue siendo un mock de un
 * único proceso Node de un solo hilo, no dos conexiones MySQL reales en
 * paralelo. Replicar eso exigiría infraestructura de test nueva (un
 * contenedor MySQL real), explícitamente fuera de alcance de este gate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPostLedgerMovementInTx, mockGrantBenefit } = vi.hoisted(() => ({
  mockPostLedgerMovementInTx: vi.fn(),
  mockGrantBenefit: vi.fn(),
}));
vi.mock("../tokens/tokenLedgerService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tokens/tokenLedgerService")>();
  return { ...actual, postLedgerMovementInTx: mockPostLedgerMovementInTx };
});
vi.mock("./benefitGrantService", () => ({ grantBenefit: mockGrantBenefit }));

import { purchaseBenefitWithTokens, BenefitPurchaseError } from "./benefitPurchaseService";
import { benefitDefinitions, userBenefits, benefitCommunities, tokenWallets } from "../../../drizzle/schema";

function blankDefinition(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "Última unidad", active: true, isMarketplaceEnabled: true, tokenCost: 50,
    marketplaceInventoryTotal: 1, perStudentPurchaseLimit: null,
    purchaseWindowStart: null, purchaseWindowEnd: null, redemptionValidityDays: null,
    ...overrides,
  };
}

/**
 * Mock con SERIALIZACIÓN REAL de `.transaction()` (encadenada, misma técnica
 * que crossModuleSpendConcurrency.test.ts) + estado COMPARTIDO y MUTABLE de
 * `user_benefits` entre llamadas — necesario porque `countActivePurchases`
 * (código real, sin mockear) debe ver, en la 2ª transacción, la fila que la
 * 1ª transacción ya concedió.
 */
function makeConcurrentPurchaseMockDb(definitionOverrides: Partial<Record<string, unknown>> = {}) {
  const definitionRow = blankDefinition(definitionOverrides);
  const userBenefitsRows: Array<Record<string, unknown>> = [];
  let lockChain: Promise<unknown> = Promise.resolve();

  function makeTxBuilder() {
    let currentTable: unknown = null;
    let limitN: number | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx: any = {};
    tx.select = () => { limitN = null; return tx; };
    tx.from = (t: unknown) => { currentTable = t; return tx; };
    tx.where = () => tx;
    tx.limit = (n: number) => { limitN = n; return tx; };
    tx.for = () => Promise.resolve([definitionRow]); // SELECT...FOR UPDATE real de benefit_definitions
    tx.then = (resolve: (v: unknown) => void) => {
      if (currentTable === userBenefits) {
        // limit(1) = precheck de idempotencia (sin reintentos en este escenario, siempre vacío).
        // sin limit = countActivePurchases, recontando en caliente el estado COMPARTIDO real.
        return resolve(limitN != null ? [] : userBenefitsRows.slice());
      }
      if (currentTable === benefitCommunities) return resolve([]);
      if (currentTable === tokenWallets) return resolve([{ balance: 1000 }]);
      return resolve([]);
    };
    return tx;
  }

  const root: Record<string, unknown> = {
    transaction: (cb: (tx: unknown) => Promise<unknown>) => {
      const run = lockChain.then(() => cb(makeTxBuilder()));
      lockChain = run.catch(() => {}); // una carrera perdedora (throw) no debe bloquear a la siguiente
      return run;
    },
  };

  return {
    db: root as unknown as Parameters<typeof purchaseBenefitWithTokens>[1],
    userBenefitsRows,
    pushGrantedRow: (row: Record<string, unknown>) => userBenefitsRows.push(row),
  };
}

describe("purchaseBenefitWithTokens — concurrencia REAL sobre stock (F62 gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostLedgerMovementInTx.mockResolvedValue({ ledger: { id: 999 }, wallet: { balance: 950 } });
  });

  it("dos compras simultáneas de la ÚLTIMA unidad (marketplaceInventoryTotal=1): solo UNA concede el Benefit, la otra recibe OUT_OF_STOCK — el stock nunca queda negativo", async () => {
    const { db, userBenefitsRows, pushGrantedRow } = makeConcurrentPurchaseMockDb({ marketplaceInventoryTotal: 1 });
    let nextId = 1;
    mockGrantBenefit.mockImplementation(async (input: { userId: number; benefitDefinitionId: number }) => {
      const row = { id: nextId++, userId: input.userId, benefitDefinitionId: input.benefitDefinitionId, status: "active", sourceType: "token_purchase" };
      pushGrantedRow(row);
      return { benefit: row, qrToken: `qr-${row.id}`, created: true };
    });

    const [r1, r2] = await Promise.allSettled([
      purchaseBenefitWithTokens({ userId: 1, benefitDefinitionId: 1, communityId: null, idempotencyKey: "buyer-1" }, db),
      purchaseBenefitWithTokens({ userId: 2, benefitDefinitionId: 1, communityId: null, idempotencyKey: "buyer-2" }, db),
    ]);

    const fulfilled = [r1, r2].filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof purchaseBenefitWithTokens>>> => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(fulfilled).toHaveLength(1); // NUNCA las dos a la vez — ese es el gate real
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BenefitPurchaseError);
    expect((rejected[0].reason as BenefitPurchaseError).code).toBe("OUT_OF_STOCK");

    // El stock nunca queda negativo: exactamente 1 fila concedida, nunca 2.
    expect(userBenefitsRows).toHaveLength(1);
    expect(mockGrantBenefit).toHaveBeenCalledTimes(1);
    expect(mockPostLedgerMovementInTx).toHaveBeenCalledTimes(1); // la perdedora NUNCA llega a debitar el wallet
  });

  it("con 2 unidades de stock y 2 compradores simultáneos: las DOS se conceden, sin sobre-venta ni sub-venta", async () => {
    const { db, userBenefitsRows, pushGrantedRow } = makeConcurrentPurchaseMockDb({ marketplaceInventoryTotal: 2 });
    let nextId = 1;
    mockGrantBenefit.mockImplementation(async (input: { userId: number; benefitDefinitionId: number }) => {
      const row = { id: nextId++, userId: input.userId, benefitDefinitionId: input.benefitDefinitionId, status: "active", sourceType: "token_purchase" };
      pushGrantedRow(row);
      return { benefit: row, qrToken: `qr-${row.id}`, created: true };
    });

    const results = await Promise.allSettled([
      purchaseBenefitWithTokens({ userId: 1, benefitDefinitionId: 1, communityId: null, idempotencyKey: "buyer-a" }, db),
      purchaseBenefitWithTokens({ userId: 2, benefitDefinitionId: 1, communityId: null, idempotencyKey: "buyer-b" }, db),
    ]);

    expect(results.every(r => r.status === "fulfilled")).toBe(true);
    expect(userBenefitsRows).toHaveLength(2);
  });
});
