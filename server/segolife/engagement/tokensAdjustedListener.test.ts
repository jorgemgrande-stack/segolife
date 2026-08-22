/**
 * tokensAdjustedListener.test.ts — F66 (Communication Center). Mismo patrón
 * que studentRegisteredListener.test.ts/benefitGrantedListener.test.ts:
 * `drizzle-orm/mysql2` mockeado enrutando por IDENTIDAD del objeto tabla
 * (robusto ante reordenar queries) + createNotification/renderTemplate
 * mockeados para aislar solo la orquestación propia de este listener.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateNotification, mockRenderTemplate, tableRows } = vi.hoisted(() => ({
  mockCreateNotification: vi.fn().mockResolvedValue({ status: "created", notification: { id: 1 } }),
  mockRenderTemplate: vi.fn(),
  tableRows: { tokenLedger: [] as any[], userCommunities: [] as any[], users: [] as any[] },
}));

vi.mock("./notificationService", () => ({ createNotification: mockCreateNotification }));
vi.mock("./templates", () => ({ renderTemplate: mockRenderTemplate }));
vi.mock("./communicationChannelMatrix", () => ({ resolveAdditionalChannels: () => ["email"] }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({}) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => {
    const b: any = {};
    let baseTable: unknown = null;
    b.select = () => b;
    b.from = (table: unknown) => { baseTable = table; return b; };
    b.innerJoin = () => b;
    b.where = () => b;
    b.limit = async () => {
      const schema = await import("../../../drizzle/schema");
      if (baseTable === schema.tokenLedger) return tableRows.tokenLedger;
      if (baseTable === schema.userCommunities) return tableRows.userCommunities;
      if (baseTable === schema.users) return tableRows.users;
      return [];
    };
    return b;
  },
}));

import { handleTokensAdjustedForEngagement } from "./tokensAdjustedListener";

beforeEach(() => {
  vi.clearAllMocks();
  mockRenderTemplate.mockReturnValue({ titleEn: "t", titleEs: "t-es", bodyEn: "b", bodyEs: "b-es", deepLink: null });
  mockCreateNotification.mockResolvedValue({ status: "created", notification: { id: 1 } });
  tableRows.tokenLedger = [];
  tableRows.userCommunities = [];
  tableRows.users = [];
});

describe("handleTokensAdjustedForEngagement", () => {
  it("un crédito renderiza amountLabel positivo con el reason/balanceAfter REALES del ledger (nunca solo lo que trae el payload)", async () => {
    tableRows.tokenLedger = [{ reason: "Bienvenida", balanceAfter: 25 }];
    tableRows.userCommunities = [{ slug: "ie" }];
    tableRows.users = [{ email: "student@example.invalid" }];

    await handleTokensAdjustedForEngagement({ userId: 42, direction: "credit", amount: 25, ledgerId: 900 });

    expect(mockRenderTemplate).toHaveBeenCalledWith(
      "tokens_adjusted_admin",
      { amountLabel: "+25 SegoTokens", reason: "Bienvenida", balanceLabel: "25 SegoTokens" },
      "/ie/tokens",
    );
    expect(mockCreateNotification).toHaveBeenCalledOnce();
    const call = mockCreateNotification.mock.calls[0][0];
    expect(call).toMatchObject({
      userId: 42, communityId: null, type: "tokens_adjusted_admin", audienceType: "transactional",
      sendImmediately: true, idempotencyKey: "tokens_adjusted_admin:900", recipient: { email: "student@example.invalid" },
    });
  });

  it("un débito renderiza amountLabel negativo", async () => {
    tableRows.tokenLedger = [{ reason: "Corrección", balanceAfter: 10 }];
    await handleTokensAdjustedForEngagement({ userId: 42, direction: "debit", amount: 15, ledgerId: 901 });
    expect(mockRenderTemplate.mock.calls[0][1]).toMatchObject({ amountLabel: "-15 SegoTokens" });
  });

  it("sin ninguna comunidad real (cuenta rara/staff), sigue notificando pero sin deep-link", async () => {
    tableRows.tokenLedger = [{ reason: "x", balanceAfter: 0 }];
    tableRows.userCommunities = [];
    tableRows.users = [{ email: "x@example.invalid" }];

    await handleTokensAdjustedForEngagement({ userId: 42, direction: "credit", amount: 5, ledgerId: 902 });

    expect(mockRenderTemplate.mock.calls[0][2]).toBeNull();
    expect(mockCreateNotification).toHaveBeenCalledOnce();
  });

  it("el ledgerId del evento no resuelve a ninguna fila (borrada/corrupta) → no notifica, no lanza", async () => {
    tableRows.tokenLedger = [];
    await expect(handleTokensAdjustedForEngagement({ userId: 42, direction: "credit", amount: 5, ledgerId: 999 })).resolves.toBeUndefined();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});
