/**
 * commercePipeline.test.ts — orquestación de ingestCommerceTransaction
 * (Fase 5). Mismo patrón que attendancePipeline.test.ts. La diferencia
 * clave a probar: una CommerceTransaction SIEMPRE se crea aunque la
 * identidad no se resuelva (a diferencia de attendance) — el loyalty queda
 * pendiente (`loyalty_processed_at = null`) hasta vincular manualmente.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockResolveIdentity, mockPersistIdentityMapping, mockRecordUnresolvedOperation, mockEarnTokens, mockEvaluateBenefitsForOrigin } = vi.hoisted(() => ({
  mockResolveIdentity: vi.fn(),
  mockPersistIdentityMapping: vi.fn(),
  mockRecordUnresolvedOperation: vi.fn(),
  mockEarnTokens: vi.fn(),
  mockEvaluateBenefitsForOrigin: vi.fn(),
}));

vi.mock("../integrations/identityResolver", () => ({
  resolveIdentity: mockResolveIdentity,
  persistIdentityMapping: mockPersistIdentityMapping,
}));
vi.mock("../integrations/unresolvedOperationsService", () => ({
  recordUnresolvedOperation: mockRecordUnresolvedOperation,
}));
vi.mock("../tokens/tokenEngine", () => ({ earnTokens: mockEarnTokens }));
vi.mock("../benefits/benefitRuleEngine", () => ({ evaluateBenefitsForOrigin: mockEvaluateBenefitsForOrigin }));

import { ingestCommerceTransaction } from "./commercePipeline";

function transactionFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    externalTransactionId: "fv_pay_001",
    status: "confirmed" as const,
    subtotalCents: 1400,
    feesCents: 100,
    totalCents: 1500,
    currency: "EUR",
    paymentMethod: null,
    buyer: { email: "fixture.student@example.invalid", phone: null, name: "Estudiante de Prueba" },
    occurredAt: new Date("2026-09-05T10:00:00.000Z"),
    items: [],
    ...overrides,
  };
}

function fakeDb({ existingTransaction = null as unknown, insertId = 701 } = {}) {
  let selectCallCount = 0;
  const row = { id: insertId, idempotencyKey: "fourvenues:native:0:fv_pay_001", venueId: 10, eventId: null, userId: 42, totalCents: 1500, occurredAt: new Date("2026-09-05T10:00:00.000Z"), status: "confirmed", loyaltyProcessedAt: null };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCallCount++;
            if (selectCallCount === 1) return existingTransaction ? [existingTransaction] : [];
            return [row];
          },
        }),
      }),
    }),
    insert: () => ({
      ignore: () => ({ values: async () => [{ insertId }] }),
      values: async () => [{ insertId }],
    }),
    update: () => ({ set: () => ({ where: async () => [{}] }) }),
  };
  return db as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEarnTokens.mockResolvedValue({ ledger: { id: 9002, createdAt: new Date("2026-09-05T10:00:00.000Z") }, wallet: {}, breakdown: {} });
  mockEvaluateBenefitsForOrigin.mockResolvedValue([]);
});

describe("ingestCommerceTransaction", () => {
  it("identidad no resuelta → SIEMPRE crea commerce_transactions (user_id null), registra unresolved, NO llama a earnTokens", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: null, method: null });
    const db = fakeDb();

    const result = await ingestCommerceTransaction({
      provider: "fourvenues",
      venueId: 10,
      transaction: transactionFixture(),
    }, db);

    expect(result.status).toBe("processed_unresolved");
    expect(mockRecordUnresolvedOperation).toHaveBeenCalledOnce();
    expect(mockRecordUnresolvedOperation.mock.calls[0][0]).toMatchObject({ operationType: "commerce", amountCents: 1500 });
    expect(mockEarnTokens).not.toHaveBeenCalled();
  });

  it("identidad resuelta → procesa loyalty con amountSpent en EUROS (totalCents/100), origin='consumption'", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: 42, method: "buyer_email" });
    const db = fakeDb();

    const result = await ingestCommerceTransaction({
      provider: "fourvenues",
      venueId: 10,
      transaction: transactionFixture(),
    }, db);

    expect(result.status).toBe("processed_with_loyalty");
    expect(mockEarnTokens).toHaveBeenCalledOnce();
    expect(mockEarnTokens.mock.calls[0][0]).toMatchObject({ userId: 42, venueId: 10, amountSpent: 15, origin: "consumption" });
    expect(mockEvaluateBenefitsForOrigin.mock.calls[0][0]).toMatchObject({ type: "consumption", userId: 42, amountCents: 1500 });
  });

  it("transacción externa duplicada (mismo provider+external_transaction_id) es idempotente", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: 42, method: "buyer_email" });
    const db = fakeDb({ existingTransaction: { id: 701, idempotencyKey: "fourvenues:native:0:fv_pay_001" } });

    const result = await ingestCommerceTransaction({ provider: "fourvenues", venueId: 10, transaction: transactionFixture() }, db);

    expect(result.status).toBe("already_exists");
    expect(mockEarnTokens).not.toHaveBeenCalled();
  });
});
