/**
 * ticketPurchasePipeline.test.ts — orquestación de ingestTicketPurchase.
 * Mismo patrón que attendancePipeline.test.ts/commercePipeline.test.ts: se
 * mockean los límites del módulo (identidad, engines de tokens/benefits,
 * cola de no-resueltos, domain events) y se usa un fake `db` mínimo que
 * responde en el ORDEN EXACTO en que ticketPurchasePipeline.ts emite sus
 * queries — se prueba la orquestación, no la semántica de drizzle-orm.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockResolveIdentity, mockPersistIdentityMapping, mockRecordUnresolvedOperation,
  mockEarnTokens, mockEvaluateBenefitsForOrigin, mockEmitEngagementEvent,
  mockResolveLoyaltyCutoff, mockReverseTransaction, mockIsLedgerEntryReversed,
  MockTokenEngineError,
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
    mockEmitEngagementEvent: vi.fn(),
    mockResolveLoyaltyCutoff: vi.fn(),
    mockReverseTransaction: vi.fn(),
    mockIsLedgerEntryReversed: vi.fn(),
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
vi.mock("../engagement/engagementEvents", () => ({ emitEngagementEvent: mockEmitEngagementEvent }));
vi.mock("../tokens/loyaltyCutoffService", () => ({
  resolveLoyaltyCutoff: mockResolveLoyaltyCutoff,
  isBeforeCutoff: (at: Date, cutoff: Date | null) => cutoff != null && at < cutoff,
}));
vi.mock("../tokens/tokenLedgerService", () => ({
  TokenEngineError: MockTokenEngineError,
  reverseTransaction: mockReverseTransaction,
  isLedgerEntryReversed: mockIsLedgerEntryReversed,
}));

import { ingestTicketPurchase, ingestPaymentlessTicket } from "./ticketPurchasePipeline";

function fakeDb(selectQueue: unknown[][], insertIds: number[] = []) {
  let selectIdx = 0;
  let insertIdx = 0;
  const inserts: Array<{ values: Record<string, unknown>; ignored: boolean }> = [];
  const updates: Array<{ values: Record<string, unknown> }> = [];

  const conn: Record<string, unknown> = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => selectQueue[selectIdx++] ?? [] }) }) }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => { inserts.push({ values, ignored: false }); return [{ insertId: insertIds[insertIdx++] ?? 1 }]; },
      ignore: () => ({ values: async (values: Record<string, unknown>) => { inserts.push({ values, ignored: true }); return [{ insertId: insertIds[insertIdx++] ?? 1 }]; } }),
    }),
    update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => { updates.push({ values }); return [{ affectedRows: 1 }]; } }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(conn),
  };
  return { db: conn as never, inserts, updates };
}

function normalizedOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    externalId: "fvi_pay_001",
    externalEventId: "fvi_evt_001",
    externalPaymentId: "fvi_pay_001",
    status: "paid" as const,
    subtotalCents: 800,
    feesCents: 35,
    totalCents: 835,
    currency: "EUR",
    buyer: { email: "comprador@example.invalid", phone: "+34600000001", name: "Comprador Fixture" },
    purchasedAt: new Date("2026-09-01T10:00:00.000Z"),
    ...overrides,
  };
}

function normalizedTicket(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    externalId: "fvi_tkt_001",
    externalEventId: "fvi_evt_001",
    externalTicketTypeId: "fvi_rate_001",
    externalOrderId: "fvi_pay_001",
    participant: { email: "participante@example.invalid", phone: "+34600000002", name: "Participante Fixture" },
    status: "issued" as const,
    amountPaidCents: 835,
    feesCents: 35,
    purchasedAt: new Date("2026-09-01T10:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEarnTokens.mockResolvedValue({ ledger: { id: 9001 }, wallet: {}, breakdown: {} });
  mockEvaluateBenefitsForOrigin.mockResolvedValue([]);
  mockResolveLoyaltyCutoff.mockResolvedValue(null); // estado neutro real de producción — sin corte configurado
  mockIsLedgerEntryReversed.mockResolvedValue(false);
  mockReverseTransaction.mockResolvedValue({ wallet: {}, ledger: { id: 9002 } });
});

describe("ingestTicketPurchase — pedido nuevo", () => {
  it("resuelve comprador Y participante por separado, crea order+item+ticket, concede reward de compra (origin=ticket) y emite ticket_purchased", async () => {
    mockResolveIdentity
      .mockResolvedValueOnce({ userId: 10, method: "buyer_email" }) // comprador
      .mockResolvedValueOnce({ userId: 20, method: "participant_email" }); // participante del ticket

    const { db, inserts, updates } = fakeDb([
      [], // existingOrder lookup → no existe
      [{ id: 701, externalTicketId: "fvi_tkt_001" }], // select-back del ticket recién insertado
      [{ id: 501, status: "paid", userId: 10, totalCents: 835, purchasedAt: new Date("2026-09-01T10:00:00.000Z"), metadata: {} }], // read-back tras la transacción
      [{ id: 501, status: "paid", userId: 10, metadata: { purchaseLoyaltyLedgerId: 9001 } }], // read-back final
    ], [501, 601, 701]);

    const result = await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, venueId: 10, communityId: 3,
      order: normalizedOrder(), tickets: [normalizedTicket()],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(result.status).toBe("created");
    expect(mockResolveIdentity).toHaveBeenCalledTimes(2);
    expect(mockResolveIdentity.mock.calls[0][0]).toMatchObject({ participant: null, buyer: normalizedOrder().buyer });
    expect(mockResolveIdentity.mock.calls[1][0]).toMatchObject({ participant: normalizedTicket().participant });

    const orderInsert = inserts.find(i => "externalOrderId" in i.values);
    expect(orderInsert?.values).toMatchObject({ userId: 10, provider: "fourvenues_integrations", externalOrderId: "fvi_pay_001", status: "paid" });

    // ticketOrderItems se inserta como array de un objeto por grupo de ticketTypeId — agrupa el único ticket (ticketTypeId=55) en 1 item con la cantidad/importe reales.
    const itemsInsert = inserts.find(i => Array.isArray(i.values)) as { values: Array<Record<string, unknown>> } | undefined;
    expect(itemsInsert?.values).toEqual([{ orderId: 501, ticketTypeId: 55, quantity: 1, unitPriceCents: 835, totalPriceCents: 835 }]);

    const ticketInsert = inserts.find(i => "externalTicketId" in i.values);
    expect(ticketInsert?.values).toMatchObject({ userId: 20, ticketTypeId: 55, provider: "fourvenues_integrations", externalTicketId: "fvi_tkt_001" });

    expect(mockEarnTokens).toHaveBeenCalledOnce();
    expect(mockEarnTokens.mock.calls[0][0]).toMatchObject({ userId: 10, origin: "ticket", eventId: 77 });
    expect(mockEvaluateBenefitsForOrigin).toHaveBeenCalledOnce();
    expect(mockEvaluateBenefitsForOrigin.mock.calls[0][0]).toMatchObject({ type: "ticket", userId: 10 });
    expect(updates.some(u => (u.values.metadata as Record<string, unknown>)?.purchaseLoyaltyLedgerId === 9001)).toBe(true);
    expect(mockEmitEngagementEvent).toHaveBeenCalledWith("ticket_purchased", expect.objectContaining({ userId: 10, eventId: 77 }));
  });

  it("participante sin identidad resuelta → crea el ticket con userId=null y registra unresolved_operations con operationType='order'", async () => {
    mockResolveIdentity
      .mockResolvedValueOnce({ userId: 10, method: "buyer_email" })
      .mockResolvedValueOnce({ userId: null, method: null }); // participante NO resuelto

    const { db, inserts } = fakeDb([
      [],
      [{ id: 701, externalTicketId: "fvi_tkt_001" }],
      [{ id: 501, status: "paid", userId: 10, totalCents: 835, purchasedAt: new Date("2026-09-01T10:00:00.000Z"), metadata: {} }],
      [{ id: 501, status: "paid", userId: 10, metadata: {} }],
    ], [501, 601, 701]);

    await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder(), tickets: [normalizedTicket()],
      resolveTicketTypeId: () => 55,
    }, db);

    const ticketInsert = inserts.find(i => "externalTicketId" in i.values);
    expect(ticketInsert?.values).toMatchObject({ userId: null });
    expect(mockRecordUnresolvedOperation).toHaveBeenCalledOnce();
    expect(mockRecordUnresolvedOperation.mock.calls[0][0]).toMatchObject({
      operationType: "order",
      referenceType: "event_ticket",
      referenceId: 701,
      externalReferenceId: "fvi_tkt_001",
    });
  });

  it("import histórico (purchasedAt < loyaltyEffectiveFrom) → NO concede tokens/Benefits NI emite ticket_purchased, pero SÍ persiste el pedido", async () => {
    mockResolveIdentity
      .mockResolvedValueOnce({ userId: 10, method: "buyer_email" })
      .mockResolvedValueOnce({ userId: 20, method: "participant_email" });

    const { db } = fakeDb([
      [],
      [{ id: 701, externalTicketId: "fvi_tkt_001" }],
      [{ id: 501, status: "paid", userId: 10, totalCents: 835, purchasedAt: new Date("2020-01-01T10:00:00.000Z"), metadata: {} }],
      [{ id: 501, status: "paid", userId: 10, metadata: {} }],
    ], [501, 601, 701]);

    const result = await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder({ purchasedAt: new Date("2020-01-01T10:00:00.000Z") }), tickets: [normalizedTicket()],
      resolveTicketTypeId: () => 55,
      loyaltyEffectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    }, db);

    expect(result.status).toBe("created");
    expect(mockEarnTokens).not.toHaveBeenCalled();
    expect(mockEvaluateBenefitsForOrigin).not.toHaveBeenCalled();
    expect(mockEmitEngagementEvent).not.toHaveBeenCalled();
  });

  it("suppressLoyalty=true (Casanova Historical Validation §22/§27) — override explícito, independiente de la fecha: NUNCA concede tokens/Benefits ni emite ticket_purchased, aunque purchasedAt sea reciente", async () => {
    mockResolveIdentity
      .mockResolvedValueOnce({ userId: 10, method: "buyer_email" })
      .mockResolvedValueOnce({ userId: 20, method: "participant_email" });

    const { db } = fakeDb([
      [],
      [{ id: 701, externalTicketId: "fvi_tkt_001" }],
      // purchasedAt de HOY (no histórico por fecha) — solo suppressLoyalty debe bloquear el reward.
      [{ id: 501, status: "paid", userId: 10, totalCents: 835, purchasedAt: new Date("2026-09-01T10:00:00.000Z"), metadata: {} }],
      [{ id: 501, status: "paid", userId: 10, metadata: {} }],
    ], [501, 601, 701]);

    const result = await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder(), tickets: [normalizedTicket()],
      resolveTicketTypeId: () => 55,
      suppressLoyalty: true, // sin loyaltyEffectiveFrom — el override explícito basta por sí solo
    }, db);

    expect(result.status).toBe("created");
    expect(mockEarnTokens).not.toHaveBeenCalled();
    expect(mockEvaluateBenefitsForOrigin).not.toHaveBeenCalled();
    expect(mockEmitEngagementEvent).not.toHaveBeenCalled();
  });
});

describe("ingestTicketPurchase — pedido ya existente (spec §58, §79)", () => {
  it("mismo estado, recompensa YA concedida → 'unchanged', nunca se re-concede loyalty", async () => {
    const grantedAttempt = { status: "GRANTED", reason: null, attempts: 1, lastAttemptAt: "2026-01-01T00:00:00.000Z", ledgerId: 9001, generation: 0, retryable: false };
    const existing = { id: 501, status: "paid", userId: 10, totalCents: 835, metadata: { rewardAttempt: grantedAttempt, purchaseLoyaltyLedgerId: 9001 } };
    const { db, updates } = fakeDb([[existing]]);

    const result = await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder(), tickets: [normalizedTicket()],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(result.status).toBe("unchanged");
    expect(updates.some(u => u.values.status === "issued")).toBe(true); // syncTicketStatuses sigue reflejando el estado del ticket
    expect(mockEarnTokens).not.toHaveBeenCalled(); // ya GRANTED — shouldAttemptReward lo filtra, nunca se re-concede
  });

  it("paid → paid (repetido), SIN ningún intento previo (self-heal) → SÍ intenta la recompensa una vez (spec §3: nunca depende solo de ser un pedido nuevo)", async () => {
    const existing = { id: 501, status: "paid", userId: 10, totalCents: 835, metadata: {} };
    const { db, updates } = fakeDb([
      [existing], // existingOrder lookup
      [existing], // select-back tras el UPDATE de metadata (camino !statusChanged con retry)
    ]);

    const result = await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder(), tickets: [normalizedTicket()],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(result.status).toBe("unchanged");
    expect(mockEarnTokens).toHaveBeenCalledOnce();
    expect(updates.some(u => (u.values.metadata as Record<string, unknown>)?.purchaseLoyaltyLedgerId === 9001)).toBe(true);
  });

  it("pending → paid (spec §3, gap crítico) → SÍ intenta la recompensa de compra, aunque el pedido no sea nuevo", async () => {
    const existing = { id: 501, status: "pending", userId: 10, totalCents: 835, refundedAt: null, metadata: {} };
    const { db } = fakeDb([
      [existing],
      [{ ...existing, status: "paid" }], // select-back dentro de transitionOrderStatus
    ]);

    const result = await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder({ status: "paid" }), tickets: [normalizedTicket()],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(result.status).toBe("updated");
    expect(mockEarnTokens).toHaveBeenCalledOnce();
    expect(mockEarnTokens.mock.calls[0][0]).toMatchObject({ userId: 10, origin: "ticket", eventId: 77 });
    expect(mockEmitEngagementEvent).toHaveBeenCalledWith("ticket_purchased", expect.objectContaining({ userId: 10, orderId: 501 }));
  });

  it("pending → pending (sin cambio real) → 'unchanged', nunca intenta la recompensa (no está 'paid')", async () => {
    const existing = { id: 501, status: "pending", userId: 10, totalCents: 835, metadata: {} };
    const { db } = fakeDb([[existing]]);

    const result = await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder({ status: "pending" }), tickets: [normalizedTicket({ status: "issued" })],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(result.status).toBe("unchanged");
    expect(mockEarnTokens).not.toHaveBeenCalled();
  });

  it("paid → refunded, SIN loyalty previa concedida → transiciona a refunded, sin reconciliación, emite order_refunded", async () => {
    const existing = { id: 501, status: "paid", userId: 10, totalCents: 835, refundedAt: null, metadata: {} };
    const { db } = fakeDb([
      [existing], // existingOrder lookup
      [existing], // dentro de transitionOrderStatus tras el UPDATE, select-back (mismo shape, se ignora el detalle)
    ]);

    const result = await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder({ status: "refunded" }), tickets: [normalizedTicket({ status: "refunded" })],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(result.status).toBe("updated");
    if (result.status === "updated") expect(result.reconciliationRequired).toBe(false);
    expect(mockReverseTransaction).not.toHaveBeenCalled(); // nada que revertir
    expect(mockEmitEngagementEvent).toHaveBeenCalledWith("order_refunded", expect.objectContaining({ userId: 10, orderId: 501, partial: false }));
  });

  it("paid → refunded, CON loyalty ya concedida (spec §6) → reversión AUTOMÁTICA real vía reverseTransaction, sin reconciliación manual", async () => {
    const grantedAttempt = { status: "GRANTED", reason: null, attempts: 1, lastAttemptAt: "2026-01-01T00:00:00.000Z", ledgerId: 9001, generation: 0, retryable: false };
    const existing = { id: 501, status: "paid", userId: 10, totalCents: 835, refundedAt: null, metadata: { purchaseLoyaltyLedgerId: 9001, rewardAttempt: grantedAttempt } };
    const { db } = fakeDb([
      [existing],
      [{ ...existing, status: "refunded" }],
    ]);

    const result = await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder({ status: "refunded" }), tickets: [normalizedTicket({ status: "refunded" })],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(mockReverseTransaction).toHaveBeenCalledOnce();
    expect(mockReverseTransaction.mock.calls[0][0]).toMatchObject({ ledgerId: 9001, adminUserId: null });
    expect(result.status).toBe("updated");
    if (result.status === "updated") expect(result.reconciliationRequired).toBe(false); // la reversión automática tuvo éxito
  });

  it("paid → refunded, CON loyalty concedida pero YA revertida (dos syncs del mismo refund) → NUNCA una segunda reversión (spec §6: idempotente)", async () => {
    mockIsLedgerEntryReversed.mockResolvedValue(true); // ya revertida por un sync anterior
    const grantedAttempt = { status: "GRANTED", reason: null, attempts: 1, lastAttemptAt: "x", ledgerId: 9001, generation: 0, retryable: false };
    const existing = { id: 501, status: "paid", userId: 10, totalCents: 835, refundedAt: null, metadata: { purchaseLoyaltyLedgerId: 9001, rewardAttempt: grantedAttempt } };
    const { db } = fakeDb([[existing], [{ ...existing, status: "refunded" }]]);

    await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder({ status: "refunded" }), tickets: [normalizedTicket({ status: "refunded" })],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(mockReverseTransaction).not.toHaveBeenCalled();
  });

  it("la reversión automática FALLA → preserva loyaltyReconciliationRequired=true (fallback a resolución manual, spec §6)", async () => {
    mockReverseTransaction.mockRejectedValue(new Error("DB timeout"));
    const grantedAttempt = { status: "GRANTED", reason: null, attempts: 1, lastAttemptAt: "x", ledgerId: 9001, generation: 0, retryable: false };
    const existing = { id: 501, status: "paid", userId: 10, totalCents: 835, refundedAt: null, metadata: { purchaseLoyaltyLedgerId: 9001, rewardAttempt: grantedAttempt } };
    const { db } = fakeDb([[existing], [{ ...existing, status: "refunded" }]]);

    const result = await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder({ status: "refunded" }), tickets: [normalizedTicket({ status: "refunded" })],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(result.status).toBe("updated");
    if (result.status === "updated") expect(result.reconciliationRequired).toBe(true);
  });

  it("refunded → paid (spec §3, regeneración tras reversión confirmada) → reintenta con una NUEVA generación de idempotencia", async () => {
    const revertedAttempt = { status: "GRANTED", reason: null, attempts: 1, lastAttemptAt: "x", ledgerId: 9001, generation: 0, retryable: false };
    mockIsLedgerEntryReversed.mockResolvedValue(true); // el ledgerId original YA fue revertido
    const existing = { id: 501, status: "refunded", userId: 10, totalCents: 835, refundedAt: new Date("2026-01-01"), metadata: { purchaseLoyaltyLedgerId: 9001, rewardAttempt: revertedAttempt } };
    const { db } = fakeDb([
      [existing],
      [{ ...existing, status: "paid" }],
    ]);

    await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder({ status: "paid" }), tickets: [normalizedTicket()],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(mockEarnTokens).toHaveBeenCalledOnce();
    expect(mockEarnTokens.mock.calls[0][0]).toMatchObject({ idempotencyKey: expect.stringContaining(":gen1") });
  });

  it("denegación TEMPORAL previa (tope agotado) en un pedido que sigue 'paid' → SÍ reintenta en el siguiente sync", async () => {
    const deniedTemp = { status: "DENIED_TEMPORARY", reason: "RULE_LIMIT_EXCEEDED", attempts: 1, lastAttemptAt: "x", ledgerId: null, generation: 0, retryable: true };
    const existing = { id: 501, status: "paid", userId: 10, totalCents: 835, metadata: { rewardAttempt: deniedTemp } };
    const { db } = fakeDb([[existing], [existing]]);

    await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder(), tickets: [normalizedTicket()],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(mockEarnTokens).toHaveBeenCalledOnce();
  });

  it("denegación PERMANENTE previa (cutoff) → NUNCA reintenta, ni siquiera en un pedido 'paid'", async () => {
    const deniedPermanent = { status: "DENIED_PERMANENT", reason: "CUTOFF_BLOCKED", attempts: 1, lastAttemptAt: "x", ledgerId: null, generation: 0, retryable: false };
    const existing = { id: 501, status: "paid", userId: 10, totalCents: 835, metadata: { rewardAttempt: deniedPermanent } };
    const { db } = fakeDb([[existing]]);

    const result = await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder(), tickets: [normalizedTicket()],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(result.status).toBe("unchanged");
    expect(mockEarnTokens).not.toHaveBeenCalled();
  });
});

describe("ingestTicketPurchase — loyalty cutoff persistente (spec §8)", () => {
  it("una compra anterior al corte persistido (venue override o global) nunca concede tokens, aunque no haya loyaltyEffectiveFrom explícito", async () => {
    mockResolveLoyaltyCutoff.mockResolvedValue(new Date("2026-10-01T00:00:00.000Z"));
    mockResolveIdentity
      .mockResolvedValueOnce({ userId: 10, method: "buyer_email" })
      .mockResolvedValueOnce({ userId: 20, method: "participant_email" });

    const { db } = fakeDb([
      [],
      [{ id: 701, externalTicketId: "fvi_tkt_001" }],
      [{ id: 501, status: "paid", userId: 10, totalCents: 835, purchasedAt: new Date("2026-09-01T10:00:00.000Z"), metadata: {} }],
      [{ id: 501, status: "paid", userId: 10, metadata: {} }],
    ], [501, 601, 701]);

    await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder(), tickets: [normalizedTicket()],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(mockEarnTokens).not.toHaveBeenCalled();
  });

  it("una compra posterior al corte persistido evalúa con normalidad", async () => {
    mockResolveLoyaltyCutoff.mockResolvedValue(new Date("2026-01-01T00:00:00.000Z"));
    mockResolveIdentity
      .mockResolvedValueOnce({ userId: 10, method: "buyer_email" })
      .mockResolvedValueOnce({ userId: 20, method: "participant_email" });

    const { db } = fakeDb([
      [],
      [{ id: 701, externalTicketId: "fvi_tkt_001" }],
      [{ id: 501, status: "paid", userId: 10, totalCents: 835, purchasedAt: new Date("2026-09-01T10:00:00.000Z"), metadata: {} }],
      [{ id: 501, status: "paid", userId: 10, metadata: {} }],
    ], [501, 601, 701]);

    await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder(), tickets: [normalizedTicket()],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(mockEarnTokens).toHaveBeenCalledOnce();
  });
});

// ─── ingestPaymentlessTicket — Paymentless Tickets & Admissions Hardening ───
// Perfil real confirmado sobre la ventana de junio 2026 de Casanova (188/929
// tickets crudos): externalOrderId=null, status="used" (asistieron),
// amountPaidCents>0 (SÍ pagaron), sin email/teléfono/nombre — venta/
// validación en puerta sin checkout online, nunca invitación (eso sería
// price=0) ni pedido fantasma inventado.
function normalizedPaymentlessTicket(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    externalId: "fvi_tkt_door_001",
    externalEventId: "fvi_evt_001",
    externalTicketTypeId: "fvi_rate_001",
    externalOrderId: null,
    participant: { email: null, phone: null, name: null },
    status: "used" as const,
    amountPaidCents: 900,
    feesCents: 0,
    purchasedAt: new Date("2026-06-11T22:14:26.000Z"),
    ...overrides,
  };
}

describe("ingestPaymentlessTicket — ticket real sin order (payment_id ausente)", () => {
  it("identidad resuelta → created, userId set, persiste identity mapping, NUNCA toca loyalty", async () => {
    mockResolveIdentity.mockResolvedValueOnce({ userId: 30, method: "participant_email" });
    const { db, inserts } = fakeDb([[{ id: 801, externalTicketId: "fvi_tkt_door_001", userId: 30, status: "used" }]], [801]);

    const result = await ingestPaymentlessTicket({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, venueId: 10,
      ticket: normalizedPaymentlessTicket(),
      resolveTicketTypeId: () => 55,
    }, db);

    expect(result.status).toBe("created");
    if (result.status === "created") expect(result.identityResolved).toBe(true);

    const ticketInsert = inserts.find(i => "externalTicketId" in i.values);
    expect(ticketInsert?.values).toMatchObject({
      orderId: null, userId: 30, ticketTypeId: 55, provider: "fourvenues_integrations", externalTicketId: "fvi_tkt_door_001", status: "used",
    });
    expect((ticketInsert?.values.metadata as Record<string, unknown>)).toMatchObject({ paymentless: true, amountPaidCents: 900 });

    expect(mockPersistIdentityMapping).toHaveBeenCalledOnce();
    expect(mockRecordUnresolvedOperation).not.toHaveBeenCalled();
    expect(mockEarnTokens).not.toHaveBeenCalled();
    expect(mockEvaluateBenefitsForOrigin).not.toHaveBeenCalled();
    expect(mockEmitEngagementEvent).not.toHaveBeenCalled();
  });

  it("identidad NO resuelta (perfil real: sin email/teléfono/nombre) → conserva el ticket con userId=null y registra unresolved_operations (operationType='order') con el importe real", async () => {
    mockResolveIdentity.mockResolvedValueOnce({ userId: null, method: null });
    const { db, inserts } = fakeDb([[{ id: 802, externalTicketId: "fvi_tkt_door_001", userId: null, status: "used" }]], [802]);

    const result = await ingestPaymentlessTicket({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, venueId: 10,
      ticket: normalizedPaymentlessTicket(),
      resolveTicketTypeId: () => 55,
    }, db);

    expect(result.status).toBe("created");
    if (result.status === "created") expect(result.identityResolved).toBe(false);

    const ticketInsert = inserts.find(i => "externalTicketId" in i.values);
    expect(ticketInsert?.values).toMatchObject({ userId: null });

    expect(mockRecordUnresolvedOperation).toHaveBeenCalledOnce();
    expect(mockRecordUnresolvedOperation.mock.calls[0][0]).toMatchObject({
      operationType: "order",
      referenceType: "event_ticket",
      referenceId: 802,
      externalReferenceId: "fvi_tkt_door_001",
      amountCents: 900, // evidencia económica real preservada aunque no haya order
    });
    expect(mockPersistIdentityMapping).not.toHaveBeenCalled();
  });

  it("price=0 (cortesía/invitación) → metadata.amountPaidCents=0, se persiste igual que cualquier otro ticket", async () => {
    mockResolveIdentity.mockResolvedValueOnce({ userId: null, method: null });
    const { db, inserts } = fakeDb([[{ id: 803 }]], [803]);

    await ingestPaymentlessTicket({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, ticket: normalizedPaymentlessTicket({ amountPaidCents: 0 }),
      resolveTicketTypeId: () => 55,
    }, db);

    const ticketInsert = inserts.find(i => "externalTicketId" in i.values);
    expect((ticketInsert?.values.metadata as Record<string, unknown>)).toMatchObject({ amountPaidCents: 0 });
  });

  it("price>0 (perfil real de puerta, 9€) → metadata.amountPaidCents=900, NUNCA se suma al revenue de ticket_orders", async () => {
    mockResolveIdentity.mockResolvedValueOnce({ userId: null, method: null });
    const { db, inserts } = fakeDb([[{ id: 804 }]], [804]);

    await ingestPaymentlessTicket({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, ticket: normalizedPaymentlessTicket({ amountPaidCents: 900 }),
      resolveTicketTypeId: () => 55,
    }, db);

    const ticketInsert = inserts.find(i => "externalTicketId" in i.values);
    expect((ticketInsert?.values.metadata as Record<string, unknown>)).toMatchObject({ amountPaidCents: 900 });
    expect(inserts.some(i => "externalOrderId" in i.values)).toBe(false); // nunca crea un ticket_orders fantasma
  });

  it("status=cancelled → se persiste tal cual, sin tratamiento especial", async () => {
    mockResolveIdentity.mockResolvedValueOnce({ userId: null, method: null });
    const { db, inserts } = fakeDb([[{ id: 805 }]], [805]);

    await ingestPaymentlessTicket({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, ticket: normalizedPaymentlessTicket({ status: "cancelled" }),
      resolveTicketTypeId: () => 55,
    }, db);

    expect(inserts.find(i => "externalTicketId" in i.values)?.values).toMatchObject({ status: "cancelled" });
  });

  it("status=refunded → se persiste tal cual, sin tratamiento especial", async () => {
    mockResolveIdentity.mockResolvedValueOnce({ userId: null, method: null });
    const { db, inserts } = fakeDb([[{ id: 806 }]], [806]);

    await ingestPaymentlessTicket({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, ticket: normalizedPaymentlessTicket({ status: "refunded" }),
      resolveTicketTypeId: () => 55,
    }, db);

    expect(inserts.find(i => "externalTicketId" in i.values)?.values).toMatchObject({ status: "refunded" });
  });

  it("ticket sin rate mapeable (resolveTicketTypeId → null) → ticketTypeId=null, no lanza excepción", async () => {
    mockResolveIdentity.mockResolvedValueOnce({ userId: null, method: null });
    const { db, inserts } = fakeDb([[{ id: 807 }]], [807]);

    const result = await ingestPaymentlessTicket({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, ticket: normalizedPaymentlessTicket(),
      resolveTicketTypeId: () => null,
    }, db);

    expect(result.status).toBe("created");
    expect(inserts.find(i => "externalTicketId" in i.values)?.values).toMatchObject({ ticketTypeId: null });
  });

  it("duplicado / idempotencia de re-sync — 2ª llamada con el mismo externalTicketId devuelve 'already_exists', NO reintenta unresolved_operations ni reinserta", async () => {
    mockResolveIdentity.mockResolvedValueOnce({ userId: null, method: null });
    // insertId=0 (falsy) simula el `.ignore()` real de MySQL ante una fila ya existente por el UNIQUE (provider, external_ticket_id).
    const { db, inserts } = fakeDb([[{ id: 802, externalTicketId: "fvi_tkt_door_001", userId: null }]], [0]);

    const result = await ingestPaymentlessTicket({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, ticket: normalizedPaymentlessTicket(),
      resolveTicketTypeId: () => 55,
    }, db);

    expect(result.status).toBe("already_exists");
    expect(result.ticket).toMatchObject({ id: 802 });
    expect(mockRecordUnresolvedOperation).not.toHaveBeenCalled();
    expect(mockPersistIdentityMapping).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(1); // el intento de insert SÍ ocurre (con .ignore()), pero nunca una segunda fila real
  });
});
