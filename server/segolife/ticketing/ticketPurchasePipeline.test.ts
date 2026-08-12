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
} = vi.hoisted(() => ({
  mockResolveIdentity: vi.fn(),
  mockPersistIdentityMapping: vi.fn(),
  mockRecordUnresolvedOperation: vi.fn(),
  mockEarnTokens: vi.fn(),
  mockEvaluateBenefitsForOrigin: vi.fn(),
  mockEmitEngagementEvent: vi.fn(),
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
vi.mock("../engagement/engagementEvents", () => ({ emitEngagementEvent: mockEmitEngagementEvent }));

import { ingestTicketPurchase } from "./ticketPurchasePipeline";

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
});

describe("ingestTicketPurchase — pedido ya existente (spec §58, §79)", () => {
  it("mismo estado → 'unchanged', refleja igualmente el estado de cada ticket individual", async () => {
    const existing = { id: 501, status: "paid", userId: 10, totalCents: 835, metadata: {} };
    const { db, updates } = fakeDb([[existing]]);

    const result = await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder(), tickets: [normalizedTicket()],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(result.status).toBe("unchanged");
    expect(updates.some(u => u.values.status === "issued")).toBe(true); // syncTicketStatuses sigue reflejando el estado del ticket
    expect(mockEarnTokens).not.toHaveBeenCalled(); // nunca se re-concede loyalty al actualizar
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
    expect(mockEmitEngagementEvent).toHaveBeenCalledWith("order_refunded", expect.objectContaining({ userId: 10, orderId: 501, partial: false }));
  });

  it("paid → refunded, CON loyalty de compra ya concedida → marca loyaltyReconciliationRequired=true, NUNCA retira tokens silenciosamente", async () => {
    const existing = { id: 501, status: "paid", userId: 10, totalCents: 835, refundedAt: null, metadata: { purchaseLoyaltyLedgerId: 9001 } };
    const { db } = fakeDb([
      [existing],
      [{ ...existing, status: "refunded" }],
    ]);

    const result = await ingestTicketPurchase({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
      eventId: 77, order: normalizedOrder({ status: "refunded" }), tickets: [normalizedTicket({ status: "refunded" })],
      resolveTicketTypeId: () => 55,
    }, db);

    expect(result.status).toBe("updated");
    if (result.status === "updated") expect(result.reconciliationRequired).toBe(true);
  });
});
