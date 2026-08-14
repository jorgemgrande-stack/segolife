/**
 * benefitsDb.test.ts — solo la parte MARKETPLACE (SEGOLIFE — Benefits
 * Marketplace & SegoTokens Redemption): listMarketplaceBenefits/
 * getMarketplaceBenefitById. El resto del archivo (CRUD admin de
 * definitions/rules/user_benefits, ya en producción desde Fase 4) no se
 * cubre aquí — no tiene lógica propia más allá de select/insert/update
 * directos, mismo criterio de otros *Db.ts del proyecto.
 *
 * El mock representa las filas YA filtradas por el WHERE real de cada query
 * (mismo criterio documentado en benefitGrantService.test.ts) — estos tests
 * verifican la lógica de elegibilidad/estado que se construye ENCIMA de esas
 * filas, no la construcción del SQL en sí.
 */
import { describe, it, expect } from "vitest";
import { listMarketplaceBenefits, getMarketplaceBenefitById, TOKEN_PURCHASE_SOURCE_TYPE } from "./benefitsDb";
import { benefitDefinitions, benefitCommunities, userBenefits } from "../../drizzle/schema";

function blankDefinition(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "Copa gratis Casanova", active: true, isMarketplaceEnabled: true, tokenCost: 80,
    marketplaceInventoryTotal: null, perStudentPurchaseLimit: null,
    purchaseWindowStart: null, purchaseWindowEnd: null, redemptionValidityDays: null,
    createdAt: new Date("2026-06-01"),
    ...overrides,
  };
}

function makeMockDb(config: {
  definitions?: Array<Record<string, unknown>>;
  scopedRows?: Array<{ benefitDefinitionId: number; communityId: number }>;
  purchaseRows?: Array<{ benefitDefinitionId: number; userId: number }>;
} = {}) {
  const { definitions = [], scopedRows = [], purchaseRows = [] } = config;
  let currentTable: "definitions" | "communities" | "userBenefits" | null = null;
  const b: any = {};
  b.select = () => b;
  b.from = (t: unknown) => {
    currentTable = t === benefitDefinitions ? "definitions" : t === benefitCommunities ? "communities" : t === userBenefits ? "userBenefits" : currentTable;
    return b;
  };
  b.where = () => b;
  b.orderBy = () => b;
  b.then = (resolve: (v: unknown) => void) => {
    if (currentTable === "definitions") return resolve(definitions);
    if (currentTable === "communities") return resolve(scopedRows);
    if (currentTable === "userBenefits") return resolve(purchaseRows);
    return resolve([]);
  };
  return b;
}

describe("listMarketplaceBenefits — elegibilidad por comunidad (spec §11-13)", () => {
  it("sin catálogo, devuelve lista vacía (estado válido, spec §69 — nunca datos fabricados)", async () => {
    const db = makeMockDb({ definitions: [] });
    const items = await listMarketplaceBenefits({ userId: 42, communityId: 3 }, db as any);
    expect(items).toEqual([]);
  });

  it("un beneficio SIN filas de comunidad es global — elegible para cualquier Student, incluso sin comunidad resuelta", async () => {
    const db = makeMockDb({ definitions: [blankDefinition()], scopedRows: [] });
    const items = await listMarketplaceBenefits({ userId: 42, communityId: null }, db as any);
    expect(items).toHaveLength(1);
  });

  it("un beneficio escopado a comunidades excluye a un Student de otra comunidad", async () => {
    const db = makeMockDb({ definitions: [blankDefinition()], scopedRows: [{ benefitDefinitionId: 1, communityId: 5 }] });
    const items = await listMarketplaceBenefits({ userId: 42, communityId: 9 }, db as any);
    expect(items).toHaveLength(0);
  });

  it("un beneficio escopado a comunidades excluye a un Student sin comunidad resuelta", async () => {
    const db = makeMockDb({ definitions: [blankDefinition()], scopedRows: [{ benefitDefinitionId: 1, communityId: 5 }] });
    const items = await listMarketplaceBenefits({ userId: 42, communityId: null }, db as any);
    expect(items).toHaveLength(0);
  });

  it("un beneficio escopado incluye al Student cuya comunidad está en el scope", async () => {
    const db = makeMockDb({ definitions: [blankDefinition()], scopedRows: [{ benefitDefinitionId: 1, communityId: 5 }] });
    const items = await listMarketplaceBenefits({ userId: 42, communityId: 5 }, db as any);
    expect(items).toHaveLength(1);
  });
});

describe("listMarketplaceBenefits — stock y ownedCount (spec §36-38)", () => {
  it("marketplaceInventoryTotal=null → available=null (stock ilimitado)", async () => {
    const db = makeMockDb({ definitions: [blankDefinition({ marketplaceInventoryTotal: null })] });
    const [item] = await listMarketplaceBenefits({ userId: 42, communityId: null }, db as any);
    expect(item.available).toBeNull();
    expect(item.marketplaceStatus).toBe("available");
  });

  it("available = total - comprometido (de CUALQUIER Student), nunca negativo", async () => {
    const db = makeMockDb({
      definitions: [blankDefinition({ marketplaceInventoryTotal: 5 })],
      purchaseRows: [{ benefitDefinitionId: 1, userId: 1 }, { benefitDefinitionId: 1, userId: 2 }, { benefitDefinitionId: 1, userId: 3 }],
    });
    const [item] = await listMarketplaceBenefits({ userId: 42, communityId: null }, db as any);
    expect(item.available).toBe(2);
    expect(item.marketplaceStatus).toBe("available");
  });

  it("stock agotado → marketplaceStatus=sold_out", async () => {
    const db = makeMockDb({
      definitions: [blankDefinition({ marketplaceInventoryTotal: 2 })],
      purchaseRows: [{ benefitDefinitionId: 1, userId: 1 }, { benefitDefinitionId: 1, userId: 2 }],
    });
    const [item] = await listMarketplaceBenefits({ userId: 42, communityId: null }, db as any);
    expect(item.available).toBe(0);
    expect(item.marketplaceStatus).toBe("sold_out");
  });

  it("ownedCount cuenta SOLO las compras de este Student, no las de otros", async () => {
    const db = makeMockDb({
      definitions: [blankDefinition()],
      purchaseRows: [{ benefitDefinitionId: 1, userId: 42 }, { benefitDefinitionId: 1, userId: 99 }, { benefitDefinitionId: 1, userId: 99 }],
    });
    const [item] = await listMarketplaceBenefits({ userId: 42, communityId: null }, db as any);
    expect(item.ownedCount).toBe(1);
  });

  it("límite por Student alcanzado → marketplaceStatus=limit_reached aunque todavía haya stock global", async () => {
    const db = makeMockDb({
      definitions: [blankDefinition({ perStudentPurchaseLimit: 1, marketplaceInventoryTotal: 50 })],
      purchaseRows: [{ benefitDefinitionId: 1, userId: 42 }],
    });
    const [item] = await listMarketplaceBenefits({ userId: 42, communityId: null }, db as any);
    expect(item.marketplaceStatus).toBe("limit_reached");
  });
});

describe("listMarketplaceBenefits — ventanas de disponibilidad (spec §10)", () => {
  it("purchaseWindowStart futuro → marketplaceStatus=not_yet_available", async () => {
    const db = makeMockDb({ definitions: [blankDefinition({ purchaseWindowStart: new Date(Date.now() + 86400000) })] });
    const [item] = await listMarketplaceBenefits({ userId: 42, communityId: null }, db as any);
    expect(item.marketplaceStatus).toBe("not_yet_available");
  });

  it("purchaseWindowEnd pasado → marketplaceStatus=ended", async () => {
    const db = makeMockDb({ definitions: [blankDefinition({ purchaseWindowEnd: new Date(Date.now() - 86400000) })] });
    const [item] = await listMarketplaceBenefits({ userId: 42, communityId: null }, db as any);
    expect(item.marketplaceStatus).toBe("ended");
  });
});

describe("getMarketplaceBenefitById — mismo 404-no-403 que getMyBenefit", () => {
  it("devuelve null si el id no existe en el catálogo elegible (nunca revela un beneficio de otra comunidad)", async () => {
    const db = makeMockDb({ definitions: [blankDefinition({ id: 1 })], scopedRows: [{ benefitDefinitionId: 1, communityId: 5 }] });
    const item = await getMarketplaceBenefitById(1, { userId: 42, communityId: 9 }, db as any);
    expect(item).toBeNull();
  });

  it("devuelve el item cuando es elegible", async () => {
    const db = makeMockDb({ definitions: [blankDefinition({ id: 1 })] });
    const item = await getMarketplaceBenefitById(1, { userId: 42, communityId: null }, db as any);
    expect(item?.id).toBe(1);
  });
});

describe("TOKEN_PURCHASE_SOURCE_TYPE", () => {
  it("es el discriminador estable usado por benefitPurchaseService.ts — no debe cambiar sin coordinar ambos archivos", () => {
    expect(TOKEN_PURCHASE_SOURCE_TYPE).toBe("token_purchase");
  });
});
