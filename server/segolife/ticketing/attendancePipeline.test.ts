/**
 * attendancePipeline.test.ts — orquestación de ingestAttendance (Fase 5).
 * Mismo patrón que server/routers/benefits.test.ts: vi.mock sobre los
 * módulos de dependencia (identidad, engines de tokens/benefits, cola de
 * no-resueltos) en vez de un simulador completo de MySQL — lo que se
 * prueba aquí es la ORQUESTACIÓN (idempotencia, ruta unresolved vs
 * procesada, que loyalty se invoque con los datos correctos), no la
 * semántica interna de earnTokens/evaluateBenefitsForOrigin (ya cubiertos
 * por sus propios tests de Fase 2/4).
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

import { ingestAttendance } from "./attendancePipeline";

function attendanceFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    externalAttendanceId: "wz_participant_700002",
    participant: { email: "fixture.attendee@example.invalid", phone: null, name: "Fixture Attendee" },
    occurredAt: new Date("2026-10-03T22:15:00.000Z"),
    ...overrides,
  };
}

/**
 * Fake db mínimo — solo los métodos encadenados que attendancePipeline.ts
 * realmente llama. Secuencia real de `select()` cuando NO hay idempotencia
 * previa: 1ª = comprobación de idempotencia (existingAttendance), 2ª =
 * comprobación de Case B (priorRewarded — ¿este Student ya cobró por este
 * Event?), 3ª = leer la fila recién insertada.
 */
function fakeDb({ existingAttendance = null as unknown, priorRewarded = null as unknown, insertId = 501 } = {}) {
  const inserted: Record<string, unknown>[] = [];
  let selectCallCount = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCallCount++;
            if (selectCallCount === 1) return existingAttendance ? [existingAttendance] : [];
            if (selectCallCount === 2) return priorRewarded ? [priorRewarded] : [];
            return [{ id: insertId, ...inserted[0] }];
          },
        }),
      }),
    }),
    insert: () => ({
      ignore: () => ({
        values: async (values: Record<string, unknown>) => {
          inserted.push(values);
          return [{ insertId }];
        },
      }),
    }),
  };
  return db as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEarnTokens.mockResolvedValue({ ledger: { id: 9001, createdAt: new Date("2026-10-03T22:15:00.000Z") }, wallet: {}, breakdown: {} });
  mockEvaluateBenefitsForOrigin.mockResolvedValue([]);
});

describe("ingestAttendance", () => {
  it("identidad no resuelta → registra unresolved_operations, NO crea event_attendance, NO llama a earnTokens", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: null, method: null });
    const db = fakeDb();

    const result = await ingestAttendance({
      provider: "weezevent",
      eventId: 5,
      venueId: null,
      attendance: attendanceFixture(),
    }, db);

    expect(result.status).toBe("unresolved");
    expect(mockRecordUnresolvedOperation).toHaveBeenCalledOnce();
    expect(mockRecordUnresolvedOperation.mock.calls[0][0]).toMatchObject({
      operationType: "attendance",
      provider: "weezevent",
      externalReferenceId: "wz_participant_700002",
      identityHintEmail: "fixture.attendee@example.invalid",
    });
    expect(mockEarnTokens).not.toHaveBeenCalled();
  });

  it("identidad resuelta → crea event_attendance, llama earnTokens con origin='attendance' y evaluateBenefitsForOrigin con type='event_attendance'", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: 42, method: "participant_email" });
    const db = fakeDb();

    const result = await ingestAttendance({
      provider: "weezevent",
      eventId: 5,
      venueId: 10,
      communityId: 1,
      attendance: attendanceFixture(),
    }, db);

    expect(result.status).toBe("processed");
    expect(mockEarnTokens).toHaveBeenCalledOnce();
    expect(mockEarnTokens.mock.calls[0][0]).toMatchObject({ userId: 42, eventId: 5, venueId: 10, origin: "attendance" });
    expect(mockEvaluateBenefitsForOrigin).toHaveBeenCalledOnce();
    expect(mockEvaluateBenefitsForOrigin.mock.calls[0][0]).toMatchObject({ type: "event_attendance", userId: 42, eventId: 5 });
    expect(mockPersistIdentityMapping).toHaveBeenCalledOnce();
  });

  it("no persiste el mapping de nuevo si la identidad ya venía de un mapping previo (previous_mapping)", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: 42, method: "previous_mapping" });
    const db = fakeDb();

    await ingestAttendance({ provider: "weezevent", eventId: 5, attendance: attendanceFixture() }, db);

    expect(mockPersistIdentityMapping).not.toHaveBeenCalled();
  });

  it("polling repetido con el mismo external_attendance_id es idempotente — no vuelve a llamar a earnTokens", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: 42, method: "participant_email" });
    const db = fakeDb({ existingAttendance: { id: 501, idempotencyKey: "weezevent:native:0:wz_participant_700002" } });

    const result = await ingestAttendance({ provider: "weezevent", eventId: 5, attendance: attendanceFixture() }, db);

    expect(result.status).toBe("already_processed");
    expect(mockEarnTokens).not.toHaveBeenCalled();
    expect(mockEvaluateBenefitsForOrigin).not.toHaveBeenCalled();
  });

  // ─── Multi-ticket Case B (Fourvenues Operational Sync §28-29) ──────────────
  it("Case B — si este Student YA tiene un reward de asistencia para este Event, NO concede un segundo reward (pero SÍ crea la fila event_attendance de este ticket)", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: 42, method: "participant_email" });
    const db = fakeDb({ priorRewarded: { id: 900 } });

    const result = await ingestAttendance({
      provider: "fourvenues_integrations",
      integrationType: "venue_integration",
      integrationId: 1,
      eventId: 5,
      attendance: attendanceFixture({ externalAttendanceId: "fvi_tkt_002" }),
    }, db);

    expect(result.status).toBe("processed");
    expect(mockEarnTokens).not.toHaveBeenCalled();
    // Benefits SÍ se sigue evaluando — es un desbloqueo aditivo independiente de tokens (ver benefitRuleEngine.ts).
    expect(mockEvaluateBenefitsForOrigin).toHaveBeenCalledOnce();
  });

  it("Case A — Students DISTINTOS para el mismo Event SÍ cobran cada uno su propio reward (Case B no afecta a personas realmente distintas)", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: 43, method: "participant_email" });
    const db = fakeDb({ priorRewarded: null }); // sin reward previo para el Student 43 en este evento

    const result = await ingestAttendance({
      provider: "fourvenues_integrations",
      eventId: 5,
      attendance: attendanceFixture({ externalAttendanceId: "fvi_tkt_003" }),
    }, db);

    expect(result.status).toBe("processed");
    expect(mockEarnTokens).toHaveBeenCalledOnce();
  });

  it("un fallo de evaluateBenefitsForOrigin NUNCA revierte la asistencia ya registrada", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: 42, method: "participant_email" });
    mockEvaluateBenefitsForOrigin.mockRejectedValue(new Error("boom"));
    const db = fakeDb();

    const result = await ingestAttendance({ provider: "weezevent", eventId: 5, attendance: attendanceFixture() }, db);

    expect(result.status).toBe("processed");
  });

  // ─── Fase 8 — resolvedUserId (check-in nativo / reproceso de unresolved) ────
  it("resolvedUserId salta resolveIdentity()/persistIdentityMapping() por completo y usa ese userId directamente", async () => {
    const db = fakeDb();

    const result = await ingestAttendance({
      provider: "segolife",
      eventId: 5,
      venueId: 10,
      resolvedUserId: 77,
      attendance: attendanceFixture({ externalAttendanceId: "native_checkin:900" }),
    }, db);

    expect(result.status).toBe("processed");
    expect(mockResolveIdentity).not.toHaveBeenCalled();
    expect(mockPersistIdentityMapping).not.toHaveBeenCalled();
    expect(mockEarnTokens).toHaveBeenCalledOnce();
    expect(mockEarnTokens.mock.calls[0][0]).toMatchObject({ userId: 77, origin: "attendance" });
    // Loyalty completo, no solo tokens: evaluateBenefitsForOrigin también se invoca para ese mismo userId resuelto.
    expect(mockEvaluateBenefitsForOrigin).toHaveBeenCalledOnce();
    expect(mockEvaluateBenefitsForOrigin.mock.calls[0][0]).toMatchObject({ type: "event_attendance", userId: 77 });
  });

  it("resolvedUserId sigue siendo idempotente por idempotency_key — reprocesar (p.ej. vincular dos veces un unresolved_operations) no duplica NI tokens NI Benefits (loyalty completo, no solo event_attendance)", async () => {
    const db = fakeDb({ existingAttendance: { id: 900, idempotencyKey: "segolife:native:0:native_checkin:900" } });

    const result = await ingestAttendance({
      provider: "segolife",
      eventId: 5,
      resolvedUserId: 77,
      attendance: attendanceFixture({ externalAttendanceId: "native_checkin:900" }),
    }, db);

    expect(result.status).toBe("already_processed");
    expect(mockEarnTokens).not.toHaveBeenCalled();
    expect(mockEvaluateBenefitsForOrigin).not.toHaveBeenCalled();
  });
});
