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
  mockResolveLoyaltyCutoff, MockTokenEngineError, mockReverseTransaction, mockIsLedgerEntryReversed, mockReverseTokenSpend,
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
    mockReverseTransaction: vi.fn(),
    mockIsLedgerEntryReversed: vi.fn(),
    mockReverseTokenSpend: vi.fn(),
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
vi.mock("../tokens/tokenLedgerService", () => ({
  TokenEngineError: MockTokenEngineError,
  reverseTransaction: mockReverseTransaction,
  isLedgerEntryReversed: mockIsLedgerEntryReversed,
}));
vi.mock("../tokens/tokenSpendService", () => ({ reverseTokenSpend: mockReverseTokenSpend }));

import { ingestCommerceTransaction, processCommerceLoyalty, refundCommerceTransaction, CommerceError } from "./commercePipeline";
import { benefitEvents, type BenefitGrantedPayload } from "../benefits/benefitEvents";

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

function fakeDb({ existingTransaction = null as unknown, insertId = 701, duplicateKeyOnInsert = false } = {}) {
  let selectCallCount = 0;
  const row = { id: insertId, idempotencyKey: "fourvenues:native:0:fv_pay_001", venueId: 10, eventId: null, userId: 42, totalCents: 1500, occurredAt: new Date("2026-09-05T10:00:00.000Z"), status: "confirmed", loyaltyProcessedAt: null };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCallCount++;
            // 1ª select: precheck por idempotencyKey (vacío salvo existingTransaction).
            // Con duplicateKeyOnInsert=true, la ÚNICA select adicional es la
            // reconsulta tras el ER_DUP_ENTRY (spec: nunca por insertId, que
            // en la perdedora de la carrera nunca fue real) — devuelve la
            // fila GANADORA ya confirmada por la otra llamada concurrente.
            if (selectCallCount === 1) return existingTransaction ? [existingTransaction] : [];
            if (duplicateKeyOnInsert) return [row];
            return [row];
          },
        }),
      }),
    }),
    insert: () => ({
      ignore: () => ({ values: async () => [{ insertId }] }),
      values: async () => {
        if (duplicateKeyOnInsert) {
          const err: any = new Error("Duplicate entry for key 'idempotency_key'");
          err.code = "ER_DUP_ENTRY";
          throw err;
        }
        return [{ insertId }];
      },
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
  mockIsLedgerEntryReversed.mockResolvedValue(false);
  mockReverseTransaction.mockResolvedValue({ wallet: {}, ledger: { id: 9003 } });
  mockReverseTokenSpend.mockResolvedValue({ id: 1, status: "reversed" });
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

  // PRE-16 overnight hardening (bug real encontrado en auditoría): dos
  // llamadas con la MISMA idempotencyKey genuinamente en paralelo (retry de
  // red) antes producían insertId=0 en la perdedora (INSERT IGNORE
  // silenciado) → SELECT WHERE id=0 → TypeError → el try/catch de
  // recordNativeSale lo trataba como "venta fallida" y revertía
  // SegoTokens/stock que en realidad pertenecían a la GANADORA, ya
  // confirmada de verdad. Ahora se captura el ER_DUP_ENTRY real y se
  // reconsulta por idempotencyKey — nunca por insertId.
  it("colisión real de idempotencyKey (dos llamadas concurrentes, ER_DUP_ENTRY en el INSERT): devuelve la transacción YA confirmada por la otra, nunca lanza ni reprocesa loyalty", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: 42, method: "buyer_email" });
    const db = fakeDb({ duplicateKeyOnInsert: true });

    const result = await ingestCommerceTransaction({
      provider: "fourvenues",
      venueId: 10,
      transaction: transactionFixture(),
    }, db);

    expect(result.status).toBe("already_exists");
    expect(result.transaction).toMatchObject({ id: 701, status: "confirmed" });
    expect(mockEarnTokens).not.toHaveBeenCalled();
    expect(mockRecordUnresolvedOperation).not.toHaveBeenCalled();
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

  // SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6, spec §29): mismo
  // gap que attendancePipeline.ts — un Benefit desbloqueado por consumo
  // nunca notificaba al Student. Listener real, mismo patrón establecido.
  it("un Benefit desbloqueado por evaluateBenefitsForOrigin emite BenefitGranted (Communication Center) — spec §29", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: 42, method: "buyer_email" });
    mockEvaluateBenefitsForOrigin.mockResolvedValue([
      { userBenefit: { id: 901 }, definition: { id: 2, name: "Copa gratis mañana" } },
    ]);
    const received: BenefitGrantedPayload[] = [];
    const listener = (p: BenefitGrantedPayload) => { received.push(p); };
    benefitEvents.onTyped("BenefitGranted", listener);

    await ingestCommerceTransaction({ provider: "fourvenues", venueId: 10, transaction: transactionFixture() }, fakeDb());
    await new Promise(resolve => setImmediate(resolve));

    expect(received).toHaveLength(1);
    benefitEvents.removeListener("BenefitGranted", listener);
    mockEvaluateBenefitsForOrigin.mockReset();
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

// ─── refundCommerceTransaction (SEGOLIFE — Venue Commerce, Consumption QR &
// SegoTokens, spec §31-33/§72/§96) ────────────────────────────────────────

describe("refundCommerceTransaction", () => {
  function fakeRefundDb(transaction: Record<string, unknown>) {
    let current = { ...transaction };
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [current] }) }) }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            if (current.status !== "confirmed") return [{ affectedRows: 0 }];
            current = { ...current, ...values };
            return [{ affectedRows: 1 }];
          },
        }),
      }),
    };
    return { db: db as never, getCurrent: () => current };
  }

  it("transacción confirmed con recompensa concedida → transiciona a refunded y revierte el ledgerId exacto", async () => {
    const { db } = fakeRefundDb({ id: 701, status: "confirmed", loyaltyLedgerId: 9002, metadata: {} });

    const result = await refundCommerceTransaction({ transactionId: 701, reason: "Cliente insatisfecho", refundedByUserId: 5 }, db);

    expect(result.tokensReversed).toBe(true);
    expect(result.transaction.status).toBe("refunded");
    expect(mockReverseTransaction).toHaveBeenCalledOnce();
    expect(mockReverseTransaction.mock.calls[0][0]).toMatchObject({ ledgerId: 9002, adminUserId: 5 });
  });

  it("transacción confirmed SIN recompensa concedida (loyaltyLedgerId null) → reembolsa el estado, nada que revertir", async () => {
    const { db } = fakeRefundDb({ id: 701, status: "confirmed", loyaltyLedgerId: null, metadata: {} });

    const result = await refundCommerceTransaction({ transactionId: 701, reason: "x", refundedByUserId: 5 }, db);

    expect(result.tokensReversed).toBe(false);
    expect(result.transaction.status).toBe("refunded");
    expect(mockReverseTransaction).not.toHaveBeenCalled();
  });

  it("un ledger ya revertido por otra vía (isLedgerEntryReversed=true) no se revierte dos veces", async () => {
    mockIsLedgerEntryReversed.mockResolvedValue(true);
    const { db } = fakeRefundDb({ id: 701, status: "confirmed", loyaltyLedgerId: 9002, metadata: {} });

    const result = await refundCommerceTransaction({ transactionId: 701, reason: "x", refundedByUserId: 5 }, db);

    expect(result.tokensReversed).toBe(false);
    expect(mockReverseTransaction).not.toHaveBeenCalled();
  });

  // SEGOLIFE — SEGOTOKENS UNIVERSAL SPEND (Fase 7, spec §27): un reembolso
  // debe devolver el valor promocional aplicado exactamente igual que
  // revierte el ledgerId de loyalty — de lo contrario el Student pierde el
  // producto Y los SegoTokens que aplicó a la vez.
  it("transacción con SegoTokens aplicados (tokenReservationId) → revierte también la reserva, no solo el ledger de loyalty", async () => {
    const { db } = fakeRefundDb({ id: 701, status: "confirmed", loyaltyLedgerId: null, tokenReservationId: 501, metadata: {} });

    const result = await refundCommerceTransaction({ transactionId: 701, reason: "Cliente insatisfecho", refundedByUserId: 5 }, db);

    expect(result.spendReversed).toBe(true);
    expect(mockReverseTokenSpend).toHaveBeenCalledOnce();
    expect(mockReverseTokenSpend.mock.calls[0][0]).toMatchObject({ reservationId: 501, adminUserId: 5 });
  });

  it("transacción SIN SegoTokens aplicados (tokenReservationId null) → spendReversed=false, nunca llama a reverseTokenSpend", async () => {
    const { db } = fakeRefundDb({ id: 701, status: "confirmed", loyaltyLedgerId: null, tokenReservationId: null, metadata: {} });

    const result = await refundCommerceTransaction({ transactionId: 701, reason: "x", refundedByUserId: 5 }, db);

    expect(result.spendReversed).toBe(false);
    expect(mockReverseTokenSpend).not.toHaveBeenCalled();
  });

  it("reembolso con AMBOS (loyalty + SegoTokens aplicados) revierte ambos independientemente", async () => {
    const { db } = fakeRefundDb({ id: 701, status: "confirmed", loyaltyLedgerId: 9002, tokenReservationId: 501, metadata: {} });

    const result = await refundCommerceTransaction({ transactionId: 701, reason: "x", refundedByUserId: 5 }, db);

    expect(result.tokensReversed).toBe(true);
    expect(result.spendReversed).toBe(true);
    expect(mockReverseTransaction).toHaveBeenCalledOnce();
    expect(mockReverseTokenSpend).toHaveBeenCalledOnce();
  });

  it("una transacción NO confirmed (pending/cancelled/ya refunded) es INVALID_STATE — nunca se reinterpreta silenciosamente", async () => {
    const { db } = fakeRefundDb({ id: 701, status: "pending", loyaltyLedgerId: null, metadata: {} });

    await expect(refundCommerceTransaction({ transactionId: 701, reason: "x", refundedByUserId: 5 }, db))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(mockReverseTransaction).not.toHaveBeenCalled();
  });

  it("transacción inexistente → NOT_FOUND", async () => {
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) };

    await expect(refundCommerceTransaction({ transactionId: 999, reason: "x", refundedByUserId: 5 }, db as never))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("motivo vacío → REASON_REQUIRED, sin tocar la base de datos", async () => {
    const dbSelect = vi.fn();
    const db = { select: dbSelect };

    await expect(refundCommerceTransaction({ transactionId: 701, reason: "   ", refundedByUserId: 5 }, db as never))
      .rejects.toBeInstanceOf(CommerceError);
    expect(dbSelect).not.toHaveBeenCalled();
  });
});
