/**
 * benefitPurchaseService.test.ts — orquestación de purchaseBenefitWithTokens
 * (SEGOLIFE — Benefits Marketplace & SegoTokens Redemption). Mismo patrón
 * vi.mock que checkoutService.test.ts: se mockean las dependencias que ya
 * tienen su propia cobertura (postLedgerMovementInTx en
 * tokenLedgerService.test.ts, grantBenefit en benefitGrantService.test.ts —
 * su idempotencia por ER_DUP_ENTRY y su rechazo de saldo negativo NO se
 * duplican aquí) y se prueba SOLO la lógica propia de este servicio:
 * elegibilidad, orden de comprobaciones (idempotencia ANTES de stock/límite,
 * spec §19), mapeo de errores y qué argumentos exactos recibe cada
 * dependencia.
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

import { purchaseBenefitWithTokens, TOKEN_PURCHASE_SOURCE_TYPE } from "./benefitPurchaseService";
import { TokenEngineError } from "../tokens/tokenLedgerService";
import { benefitDefinitions, benefitCommunities, userBenefits, tokenWallets } from "../../../drizzle/schema";

function blankDefinition(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "Copa gratis Casanova", slug: "copa-gratis-casanova", active: true,
    isMarketplaceEnabled: true, tokenCost: 80,
    marketplaceInventoryTotal: null, perStudentPurchaseLimit: null,
    purchaseWindowStart: null, purchaseWindowEnd: null, redemptionValidityDays: null,
    ...overrides,
  };
}

/** Mock multi-tabla: cada `.from(TABLA)` fija el destino de la siguiente resolución. La comprobación de idempotencia (SIEMPRE `.limit(1)` sobre user_benefits) y el conteo de comprometido (countActivePurchases, SIEMPRE sin `.limit()` sobre user_benefits) son distinguibles por esa única diferencia real en el código bajo test — no por el contenido del `.where()`, que aquí no se interpreta (mismo criterio documentado en benefitGrantService.test.ts: el mock representa filas ya filtradas por el WHERE real). */
function makeMockDb(config: {
  definition?: Record<string, unknown> | null;
  communityRows?: Array<{ communityId: number }>;
  idempotencyRows?: Array<Record<string, unknown>>;
  purchaseCountRows?: Array<Record<string, unknown>>;
  walletBalance?: number;
} = {}) {
  const {
    definition = blankDefinition(), communityRows = [], idempotencyRows = [], purchaseCountRows = [], walletBalance = 500,
  } = config;

  let currentTable: "userBenefits" | "benefitDefinitions" | "benefitCommunities" | "tokenWallets" | null = null;
  let limitN: number | null = null;

  const b: any = {};
  b.select = () => { limitN = null; return b; };
  b.from = (t: unknown) => {
    currentTable = t === userBenefits ? "userBenefits"
      : t === benefitDefinitions ? "benefitDefinitions"
      : t === benefitCommunities ? "benefitCommunities"
      : t === tokenWallets ? "tokenWallets" : currentTable;
    return b;
  };
  b.where = () => b;
  b.limit = (n: number) => { limitN = n; return b; };
  b.for = () => Promise.resolve(definition ? [definition] : []);
  const resolveRows = (): Array<Record<string, unknown>> => {
    if (currentTable === "userBenefits") return limitN != null ? idempotencyRows : purchaseCountRows;
    if (currentTable === "benefitCommunities") return communityRows as Array<Record<string, unknown>>;
    if (currentTable === "tokenWallets") return [{ balance: walletBalance }];
    return [];
  };
  b.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    let rows = resolveRows();
    if (limitN != null) rows = rows.slice(0, limitN);
    return Promise.resolve(rows).then(resolve, reject);
  };
  b.transaction = (cb: (tx: unknown) => Promise<unknown>) => cb(b);

  return b;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPostLedgerMovementInTx.mockResolvedValue({
    ledger: { id: 999 }, wallet: { balance: 420 },
  });
  mockGrantBenefit.mockResolvedValue({
    benefit: { id: 55, userId: 42, benefitDefinitionId: 1, status: "active" },
    qrToken: "qr-plaintext-token", created: true,
  });
});

describe("purchaseBenefitWithTokens — camino feliz", () => {
  it("debita el wallet, concede el Benefit y devuelve el resultado — sourceType inequívocamente token_purchase", async () => {
    const db = makeMockDb();
    const result = await purchaseBenefitWithTokens(
      { userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "benefit_redemption:1:key-a" }, db as any
    );

    expect(mockPostLedgerMovementInTx).toHaveBeenCalledOnce();
    expect(mockPostLedgerMovementInTx.mock.calls[0][1]).toMatchObject({
      userId: 42, direction: "debit", amount: 80, sourceType: TOKEN_PURCHASE_SOURCE_TYPE,
      sourceId: 1, idempotencyKey: "benefit_redemption:1:key-a",
    });

    expect(mockGrantBenefit).toHaveBeenCalledOnce();
    expect(mockGrantBenefit.mock.calls[0][0]).toMatchObject({
      userId: 42, benefitDefinitionId: 1, benefitRuleId: null, sourceType: TOKEN_PURCHASE_SOURCE_TYPE,
      sourceLedgerId: 999, validUntil: null,
    });

    expect(result.created).toBe(true);
    expect(result.qrToken).toBe("qr-plaintext-token");
    expect(result.ledgerId).toBe(999);
    expect(result.walletBalance).toBe(420);
  });

  it("con redemptionValidityDays configurado, calcula validUntil = ahora + N días", async () => {
    const db = makeMockDb({ definition: blankDefinition({ redemptionValidityDays: 30 }) });
    await purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any);

    const call = mockGrantBenefit.mock.calls[0][0];
    const validFrom = call.validFrom as Date;
    const validUntil = call.validUntil as Date;
    const diffDays = (validUntil.getTime() - validFrom.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(30, 5);
  });
});

describe("purchaseBenefitWithTokens — idempotencia (spec §19)", () => {
  it("una idempotencyKey ya existente devuelve la compra ya confirmada, SIN volver a debitar ni conceder", async () => {
    const existing = { id: 77, userId: 42, benefitDefinitionId: 1, qrToken: "already-issued", sourceLedgerId: 111, idempotencyKey: "k" };
    const db = makeMockDb({ idempotencyRows: [existing], walletBalance: 340 });

    const result = await purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any);

    expect(result.created).toBe(false);
    expect(result.userBenefit).toBe(existing);
    expect(result.qrToken).toBe("already-issued");
    expect(result.walletBalance).toBe(340);
    expect(mockPostLedgerMovementInTx).not.toHaveBeenCalled();
    expect(mockGrantBenefit).not.toHaveBeenCalled();
  });

  it("la comprobación de idempotencia ocurre ANTES que stock/límite — un reintento nunca falla por OUT_OF_STOCK aunque el beneficio ya esté agotado", async () => {
    const existing = { id: 77, userId: 42, benefitDefinitionId: 1, qrToken: "already-issued", sourceLedgerId: 111, idempotencyKey: "k" };
    const definition = blankDefinition({ marketplaceInventoryTotal: 1 });
    // purchaseCountRows con 1 fila ya "comprometida" simularía OUT_OF_STOCK
    // si el conteo se evaluase — pero la idempotencia debe cortar antes.
    const db = makeMockDb({ definition, idempotencyRows: [existing], purchaseCountRows: [{ id: 1 }] });

    const result = await purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any);
    expect(result.created).toBe(false);
    expect(mockPostLedgerMovementInTx).not.toHaveBeenCalled();
  });
});

describe("purchaseBenefitWithTokens — elegibilidad", () => {
  it("NOT_FOUND si la definición no existe", async () => {
    const db = makeMockDb({ definition: null });
    await expect(purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 999, communityId: null, idempotencyKey: "k" }, db as any))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPostLedgerMovementInTx).not.toHaveBeenCalled();
  });

  it("INACTIVE si active=false", async () => {
    const db = makeMockDb({ definition: blankDefinition({ active: false }) });
    await expect(purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any))
      .rejects.toMatchObject({ code: "INACTIVE" });
  });

  it("NOT_MARKETPLACE_ENABLED si isMarketplaceEnabled=false (aunque tenga tokenCost)", async () => {
    const db = makeMockDb({ definition: blankDefinition({ isMarketplaceEnabled: false, tokenCost: 80 }) });
    await expect(purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any))
      .rejects.toMatchObject({ code: "NOT_MARKETPLACE_ENABLED" });
  });

  it("NOT_MARKETPLACE_ENABLED si tokenCost es null aunque isMarketplaceEnabled=true (protección anti-footgun, spec §67)", async () => {
    const db = makeMockDb({ definition: blankDefinition({ isMarketplaceEnabled: true, tokenCost: null }) });
    await expect(purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any))
      .rejects.toMatchObject({ code: "NOT_MARKETPLACE_ENABLED" });
  });

  it("NOT_YET_AVAILABLE si purchaseWindowStart es futuro", async () => {
    const db = makeMockDb({ definition: blankDefinition({ purchaseWindowStart: new Date(Date.now() + 86400000) }) });
    await expect(purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any))
      .rejects.toMatchObject({ code: "NOT_YET_AVAILABLE" });
  });

  it("PURCHASE_WINDOW_ENDED si purchaseWindowEnd ya pasó", async () => {
    const db = makeMockDb({ definition: blankDefinition({ purchaseWindowEnd: new Date(Date.now() - 86400000) }) });
    await expect(purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any))
      .rejects.toMatchObject({ code: "PURCHASE_WINDOW_ENDED" });
  });

  it("NOT_ELIGIBLE_COMMUNITY si el beneficio está escopado a comunidades y el Student no pertenece a ninguna", async () => {
    const db = makeMockDb({ communityRows: [{ communityId: 5 }, { communityId: 6 }] });
    await expect(purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: 7, idempotencyKey: "k" }, db as any))
      .rejects.toMatchObject({ code: "NOT_ELIGIBLE_COMMUNITY" });
  });

  it("NOT_ELIGIBLE_COMMUNITY si el Student no tiene comunidad resuelta y el beneficio está escopado", async () => {
    const db = makeMockDb({ communityRows: [{ communityId: 5 }] });
    await expect(purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any))
      .rejects.toMatchObject({ code: "NOT_ELIGIBLE_COMMUNITY" });
  });

  it("elegible cuando la comunidad del Student está entre las escopadas", async () => {
    const db = makeMockDb({ communityRows: [{ communityId: 5 }, { communityId: 7 }] });
    const result = await purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: 7, idempotencyKey: "k" }, db as any);
    expect(result.created).toBe(true);
  });

  it("sin filas de comunidad = beneficio global, elegible para cualquier Student (incluso sin comunidad resuelta)", async () => {
    const db = makeMockDb({ communityRows: [] });
    const result = await purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any);
    expect(result.created).toBe(true);
  });
});

describe("purchaseBenefitWithTokens — límite por Student y stock (spec §36/§38)", () => {
  it("LIMIT_EXCEEDED si el Student ya alcanzó su límite de canjes", async () => {
    const definition = blankDefinition({ perStudentPurchaseLimit: 1 });
    const db = makeMockDb({ definition, purchaseCountRows: [{ id: 1 }] });
    await expect(purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any))
      .rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(mockPostLedgerMovementInTx).not.toHaveBeenCalled();
  });

  it("procede si el Student todavía no alcanzó el límite", async () => {
    const definition = blankDefinition({ perStudentPurchaseLimit: 2 });
    const db = makeMockDb({ definition, purchaseCountRows: [{ id: 1 }] });
    const result = await purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any);
    expect(result.created).toBe(true);
  });

  it("OUT_OF_STOCK si el stock total ya está comprometido", async () => {
    const definition = blankDefinition({ marketplaceInventoryTotal: 3 });
    const db = makeMockDb({ definition, purchaseCountRows: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    await expect(purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any))
      .rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    expect(mockPostLedgerMovementInTx).not.toHaveBeenCalled();
  });

  it("procede si todavía queda stock", async () => {
    const definition = blankDefinition({ marketplaceInventoryTotal: 3 });
    const db = makeMockDb({ definition, purchaseCountRows: [{ id: 1 }] });
    const result = await purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any);
    expect(result.created).toBe(true);
  });
});

describe("purchaseBenefitWithTokens — saldo insuficiente (spec §14/§20)", () => {
  it("INSUFFICIENT_BALANCE cuando postLedgerMovementInTx rechaza por saldo negativo — nunca concede el Benefit", async () => {
    mockPostLedgerMovementInTx.mockRejectedValueOnce(new TokenEngineError("INSUFFICIENT_BALANCE", "Saldo insuficiente"));
    const db = makeMockDb();
    await expect(purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any))
      .rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(mockGrantBenefit).not.toHaveBeenCalled();
  });

  it("otros errores del motor de ledger NO se reinterpretan como INSUFFICIENT_BALANCE — se propagan tal cual", async () => {
    mockPostLedgerMovementInTx.mockRejectedValueOnce(new TokenEngineError("INVALID_AMOUNT", "Importe inválido"));
    const db = makeMockDb();
    await expect(purchaseBenefitWithTokens({ userId: 42, benefitDefinitionId: 1, communityId: null, idempotencyKey: "k" }, db as any))
      .rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });
});
