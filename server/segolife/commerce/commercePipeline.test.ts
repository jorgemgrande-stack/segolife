/**
 * commercePipeline.test.ts — orquestación de ingestCommerceTransaction
 * (Fase 5). Mismo patrón que attendancePipeline.test.ts. La diferencia
 * clave a probar: una CommerceTransaction SIEMPRE se crea aunque la
 * identidad no se resuelva (a diferencia de attendance) — el loyalty queda
 * pendiente (`loyalty_processed_at = null`) hasta vincular manualmente.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockResolveIdentity, mockPersistIdentityMapping, mockRecordUnresolvedOperation, mockEarnTokens, mockEvaluateBenefitsForOrigin,
  mockResolveLoyaltyCutoff, MockTokenEngineError,
} = vi.hoisted(() => {
  class MockTokenEngineError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; this.name = "TokenEngineError"; }
  }
  return {
    mockResolveIdentity: vi.fn(),
    mockPersistIdentityMapping: vi.fn(),
    mockRecordUnresolvedOperation: vi.fn(),
    mockEarnTokens: vi.fn(),
    mockEvaluateBenefitsForOrigin: vi.fn(),
    mockResolveLoyaltyCutoff: vi.fn(),
    MockTokenEngineError,
  };
});

vi.mock("../integrations/identityResolver", () => ({
  resolveIdentity: mockResolveIdentity,
  persistIdentityMapping: mockPersistIdentityMapping,
  isConfirmedResolutionMethod: (m: unknown) => m != null && m !== "ambiguous_email" && m !== "ambiguous_phone",
}));
vi.mock("../integrations/unresolvedOperationsService", () => ({
  recordUnresolvedOperation: mockRecordUnresolvedOperation,
}));
vi.mock("../tokens/tokenEngine", () => ({ earnTokens: mockEarnTokens }));
vi.mock("../benefits/benefitRuleEngine", () => ({ evaluateBenefitsForOrigin: mockEvaluateBenefitsForOrigin }));
vi.mock("../tokens/loyaltyCutoffService", () => ({
  resolveLoyaltyCutoff: mockResolveLoyaltyCutoff,
  isBeforeCutoff: (at: Date, cutoff: Date | null) => cutoff != null && at < cutoff,
}));
vi.mock("../tokens/tokenLedgerService", () => ({ TokenEngineError: MockTokenEngineError }));

import { ingestCommerceTransaction, processCommerceLoyalty } from "./commercePipeline";

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
  mockResolveLoyaltyCutoff.mockResolvedValue(null); // estado neutro real de producción — sin corte configurado
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

  it("una consumición anterior al corte de loyalty persistido NUNCA concede tokens (spec §8)", async () => {
    mockResolveLoyaltyCutoff.mockResolvedValue(new Date("2026-10-01T00:00:00.000Z")); // corte futuro respecto al fixture (2026-09-05)
    mockResolveIdentity.mockResolvedValue({ userId: 42, method: "buyer_email" });
    const db = fakeDb();

    const result = await ingestCommerceTransaction({ provider: "fourvenues", venueId: 10, transaction: transactionFixture() }, db);

    expect(result.status).toBe("processed_with_loyalty"); // la transacción SÍ se persiste
    expect(mockEarnTokens).not.toHaveBeenCalled();
  });
});

describe("processCommerceLoyalty — retry semantics (spec §5, ya no es fire-once)", () => {
  function txFixture(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 701, userId: 42, venueId: 10, eventId: null, totalCents: 1500,
      occurredAt: new Date("2026-09-05T10:00:00.000Z"),
      status: "confirmed" as const, idempotencyKey: "fourvenues:native:0:fv_pay_001",
      loyaltyProcessedAt: null, loyaltyLedgerId: null, integrationId: null, metadata: {},
      ...overrides,
    };
  }

  function updateTrackingDb() {
    const updates: Record<string, unknown>[] = [];
    const db = { update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => { updates.push(values); return [{}]; } }) }) };
    return { db: db as never, updates };
  }

  it("una denegación TEMPORAL previa (tope agotado) SÍ se reintenta al reprocesar la misma fila", async () => {
    const deniedTemp = { status: "DENIED_TEMPORARY", reason: "RULE_LIMIT_EXCEEDED", attempts: 1, lastAttemptAt: "x", ledgerId: null, generation: 0, retryable: true };
    const tx = txFixture({ metadata: { rewardAttempt: deniedTemp } });
    const { db, updates } = updateTrackingDb();

    await processCommerceLoyalty(tx as never, db);

    expect(mockEarnTokens).toHaveBeenCalledOnce();
    expect(updates[0]).toMatchObject({ loyaltyLedgerId: 9002 });
  });

  it("una denegación PERMANENTE previa NUNCA se reintenta", async () => {
    const deniedPermanent = { status: "DENIED_PERMANENT", reason: "CUTOFF_BLOCKED", attempts: 1, lastAttemptAt: "x", ledgerId: null, generation: 0, retryable: false };
    const tx = txFixture({ metadata: { rewardAttempt: deniedPermanent } });
    const { db, updates } = updateTrackingDb();

    await processCommerceLoyalty(tx as never, db);

    expect(mockEarnTokens).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("una recompensa YA concedida (GRANTED) nunca se reintenta, aunque loyaltyProcessedAt esté presente", async () => {
    const granted = { status: "GRANTED", reason: null, attempts: 1, lastAttemptAt: "x", ledgerId: 9002, generation: 0, retryable: false };
    const tx = txFixture({ loyaltyProcessedAt: new Date(), loyaltyLedgerId: 9002, metadata: { rewardAttempt: granted } });
    const { db, updates } = updateTrackingDb();

    await processCommerceLoyalty(tx as never, db);

    expect(mockEarnTokens).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});
