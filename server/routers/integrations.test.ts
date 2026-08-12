/**
 * integrations.test.ts — router-level, mismo patrón que
 * server/routers/benefits.test.ts (createCaller + vi.mock sobre las
 * dependencias). Cubre EXCLUSIVAMENTE la rama nueva de Fase 8 en
 * `linkUnresolved`: el bloqueador de Fase 5 (vincular manualmente una
 * asistencia no resuelta nunca reprocesaba event_attendance) queda cerrado
 * aquí a nivel de router, no solo a nivel de ingestAttendance() en
 * aislamiento (attendancePipeline.test.ts ya cubre la idempotencia interna
 * de ingestAttendance) — lo que falta probar es que integrations.ts
 * reconstruye el input correctamente desde la fila de unresolved_operations
 * y pasa `resolvedUserId`, hasta loyalty (tokens/Benefits), no solo hasta
 * event_attendance.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockLinkUnresolvedOperation, mockIngestAttendance, mockDbUpdateSet, mockDbUpdateWhere } = vi.hoisted(() => ({
  mockLinkUnresolvedOperation: vi.fn(),
  mockIngestAttendance: vi.fn(),
  mockDbUpdateSet: vi.fn(),
  mockDbUpdateWhere: vi.fn(async () => [{ affectedRows: 1 }]),
}));

vi.mock("../segolife/integrations/unresolvedOperationsService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/integrations/unresolvedOperationsService")>();
  return { ...actual, linkUnresolvedOperation: mockLinkUnresolvedOperation };
});
vi.mock("../segolife/ticketing/attendancePipeline", () => ({ ingestAttendance: mockIngestAttendance }));
// El router usa su propio `_db` (drizzle(mysql.createPool(...))) inline, sin
// exportarlo — se mockea `drizzle-orm/mysql2` para poder aserción sobre el
// UPDATE de la rama "order" (spec §47) sin una conexión MySQL real. select()
// se deja como no-op vacío: solo la rama commerce lo usa, y esos tests
// siguen evitándolo con referenceId=null (mismo criterio que ya tenía este archivo).
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: (values: Record<string, unknown>) => { mockDbUpdateSet(values); return { where: async (...args: unknown[]) => { mockDbUpdateWhere(...args); return [{ affectedRows: 1 }]; } }; } }),
  }),
}));

import { integrationsRouter } from "./integrations";

function callerAsAdmin() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return integrationsRouter.createCaller({ user: { id: 1, role: "admin" } } as any);
}

function unresolvedFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    operationType: "attendance",
    provider: "weezevent",
    integrationType: "event_integration",
    integrationId: 3,
    referenceType: null,
    referenceId: null,
    externalReferenceId: "wz_participant_700002",
    eventId: 5,
    venueId: 10,
    occurredAt: new Date("2026-10-03T22:15:00.000Z"),
    identityHintEmail: "fixture@example.invalid",
    identityHintPhone: null,
    identityHintName: "Fixture Attendee",
    amountCents: null,
    status: "linked",
    linkedUserId: 77,
    linkedByUserId: 1,
    linkedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIngestAttendance.mockResolvedValue({ status: "processed", attendance: { id: 900 } });
});

describe("integrationsRouter.linkUnresolved — bloqueador de Fase 5 (attendance)", () => {
  it("attendance con eventId → reconstruye el input desde la fila y llama a ingestAttendance con resolvedUserId (hasta loyalty, no solo event_attendance)", async () => {
    mockLinkUnresolvedOperation.mockResolvedValue(unresolvedFixture());
    const caller = callerAsAdmin();

    const result = await caller.linkUnresolved({ id: 10, userId: 77 });

    expect(mockLinkUnresolvedOperation).toHaveBeenCalledWith(10, 77, 1);
    expect(mockIngestAttendance).toHaveBeenCalledOnce();
    expect(mockIngestAttendance.mock.calls[0][0]).toMatchObject({
      provider: "weezevent",
      integrationType: "event_integration",
      integrationId: 3,
      eventId: 5,
      venueId: 10,
      resolvedUserId: 77,
      attendance: expect.objectContaining({
        externalAttendanceId: "wz_participant_700002",
        participant: { email: "fixture@example.invalid", phone: null, name: "Fixture Attendee" },
      }),
    });
    expect(result).toMatchObject({ id: 10 });
  });

  it("vincular DOS VECES la misma operación — ingestAttendance se llama de nuevo, pero su propia idempotencia (ya probada en attendancePipeline.test.ts) es lo que impide duplicar tokens/Benefits, nunca el router", async () => {
    mockLinkUnresolvedOperation.mockResolvedValue(unresolvedFixture());
    mockIngestAttendance.mockResolvedValue({ status: "already_processed", attendance: { id: 900 } });
    const caller = callerAsAdmin();

    await caller.linkUnresolved({ id: 10, userId: 77 });

    expect(mockIngestAttendance).toHaveBeenCalledOnce();
    // El router siempre delega en ingestAttendance — la garantía de no-duplicación vive en el pipeline, no aquí.
  });

  it("operationType='commerce' → NUNCA llama a ingestAttendance (rama distinta, ver processCommerceLoyalty)", async () => {
    // referenceId=null a propósito: así la rama commerce del router tampoco
    // toca la conexión real a MySQL (su `if (... && linked.referenceId)`
    // nunca se cumple) — este test aísla estrictamente la rama attendance.
    mockLinkUnresolvedOperation.mockResolvedValue(unresolvedFixture({ operationType: "commerce", eventId: null, referenceId: null }));
    const caller = callerAsAdmin();

    await caller.linkUnresolved({ id: 11, userId: 77 });

    expect(mockIngestAttendance).not.toHaveBeenCalled();
  });

  it("attendance SIN eventId (fila incompleta) → nunca llama a ingestAttendance (nunca inventa un eventId)", async () => {
    mockLinkUnresolvedOperation.mockResolvedValue(unresolvedFixture({ eventId: null }));
    const caller = callerAsAdmin();

    await caller.linkUnresolved({ id: 12, userId: 77 });

    expect(mockIngestAttendance).not.toHaveBeenCalled();
  });
});

describe("integrationsRouter.linkUnresolved — operationType='order' (Fourvenues Operational Sync §46-47)", () => {
  it("order con referenceType='event_ticket' → asocia el Student directamente al ticket ya existente (UPDATE event_tickets.user_id), sin reprocesar pedidos ni volver a llamar a Fourvenues", async () => {
    mockLinkUnresolvedOperation.mockResolvedValue(unresolvedFixture({
      operationType: "order", referenceType: "event_ticket", referenceId: 701, eventId: 77,
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: 1,
    }));
    const caller = callerAsAdmin();

    const result = await caller.linkUnresolved({ id: 20, userId: 88 });

    expect(mockDbUpdateSet).toHaveBeenCalledWith({ userId: 88 });
    expect(mockDbUpdateWhere).toHaveBeenCalledOnce();
    expect(mockIngestAttendance).not.toHaveBeenCalled(); // "order" nunca reprocesa asistencia — son colas independientes
    expect(result).toMatchObject({ id: 10 });
  });

  it("order SIN referenceId (fila incompleta) → nunca actualiza event_tickets (nunca actualiza a ciegas)", async () => {
    mockLinkUnresolvedOperation.mockResolvedValue(unresolvedFixture({ operationType: "order", referenceType: "event_ticket", referenceId: null }));
    const caller = callerAsAdmin();

    await caller.linkUnresolved({ id: 21, userId: 88 });

    expect(mockDbUpdateSet).not.toHaveBeenCalled();
  });
});
