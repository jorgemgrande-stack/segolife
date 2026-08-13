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
 * realmente llama. Sensible al ESTADO real (¿ya se comprobó idempotencia?,
 * ¿ya se insertó?) en vez de contar posiciones ciegamente — el corte de
 * loyalty (Loyalty Production Hardening) puede saltarse la comprobación de
 * Case B por completo (retorno anticipado), así que una cola puramente
 * posicional se desalinearía; este mock resuelve cada select según lo que
 * REALMENTE ha ocurrido hasta ese momento, igual que el resto de fakeDb más
 * robustos de este mismo módulo (ver tokenEngine.test.ts).
 */
function fakeDb({ existingAttendance = null as unknown, priorRewarded = null as unknown, insertId = 501 } = {}) {
  const inserted: Record<string, unknown>[] = [];
  let idempotencyChecked = false;
  let hasInserted = false;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (!idempotencyChecked) { idempotencyChecked = true; return existingAttendance ? [existingAttendance] : []; }
            if (!hasInserted) return priorRewarded ? [priorRewarded] : [];
            return [{ id: insertId, ...inserted[0] }];
          },
        }),
      }),
    }),
    insert: () => ({
      ignore: () => ({
        values: async (values: Record<string, unknown>) => {
          inserted.push(values);
          hasInserted = true;
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
  mockResolveLoyaltyCutoff.mockResolvedValue(null); // estado neutro real de producción — sin corte configurado
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

  it("Paymentless Tickets Hardening — cuando el llamador conoce el event_ticket real (con o sin order), ticketId se persiste en event_attendance", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: 42, method: "participant_email" });
    const inserted: Record<string, unknown>[] = [];
    let selectCallCount = 0;
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => {
        selectCallCount++;
        if (selectCallCount === 1) return []; // sin idempotencia previa
        if (selectCallCount === 2) return []; // Case B — sin reward previo
        return [{ id: 501, ...inserted[0] }]; // lectura post-insert
      } }) }) }),
      insert: () => ({ ignore: () => ({ values: async (values: Record<string, unknown>) => { inserted.push(values); return [{ insertId: 501 }]; } }) }),
    } as never;

    await ingestAttendance({
      provider: "fourvenues_integrations", eventId: 5, venueId: 10,
      ticketId: 802, // resuelto por integrationSyncService.ts vía Map externalTicketId→event_tickets.id
      attendance: attendanceFixture(),
    }, db);

    expect(inserted[0]).toMatchObject({ ticketId: 802 });
  });

  it("no persiste el mapping de nuevo si la identidad ya venía de un mapping previo (previous_mapping)", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: 42, method: "previous_mapping" });
    const db = fakeDb();

    await ingestAttendance({ provider: "weezevent", eventId: 5, attendance: attendanceFixture() }, db);

    expect(mockPersistIdentityMapping).not.toHaveBeenCalled();
  });

  it("polling repetido con el mismo external_attendance_id es idempotente — no vuelve a llamar a earnTokens", async () => {
    mockResolveIdentity.mockResolvedValue({ userId: 42, method: "participant_email" });
    const db = fakeDb({ existingAttendance: { id: 501, userId: 42, tokensLedgerId: 9001, idempotencyKey: "weezevent:native:0:wz_participant_700002" } });

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
    const db = fakeDb({ existingAttendance: { id: 900, userId: 77, tokensLedgerId: 9001, idempotencyKey: "segolife:native:0:native_checkin:900" } });

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

  // ─── Import histórico — suppressLoyalty (Casanova Historical Validation, spec §22/§26-27) ──
  describe("suppressLoyalty — import histórico nunca concede tokens/Benefits, pero SÍ persiste la asistencia", () => {
    it("suppressLoyalty=true + identidad resuelta → event_attendance se persiste, earnTokens NUNCA se llama, evaluateBenefitsForOrigin NUNCA se llama", async () => {
      mockResolveIdentity.mockResolvedValue({ userId: 42, method: "participant_email" });
      // Sin suppressLoyalty, la 2ª select sería la comprobación Case B (priorRewarded);
      // con suppressLoyalty=true esa consulta NUNCA se emite — la 2ª select real es
      // el read-back tras el insert. Se reutiliza el slot `priorRewarded` del fake para
      // representar ESE read-back (misma forma: una fila con `id`).
      const db = fakeDb({ priorRewarded: { id: 501, provider: "fourvenues_integrations" }, insertId: 501 });

      const result = await ingestAttendance({
        provider: "fourvenues_integrations",
        integrationType: "venue_integration",
        integrationId: 1,
        eventId: 5,
        suppressLoyalty: true,
        attendance: attendanceFixture({ externalAttendanceId: "fvi_historical_tkt_001" }),
      }, db);

      expect(result.status).toBe("processed");
      expect(mockEarnTokens).not.toHaveBeenCalled();
      expect(mockEvaluateBenefitsForOrigin).not.toHaveBeenCalled();
    });

    it("suppressLoyalty=true — el sync EN VIVO (sin el flag) del mismo escenario SÍ concede tokens, confirmando que el flag es lo único que cambia el comportamiento", async () => {
      mockResolveIdentity.mockResolvedValue({ userId: 42, method: "participant_email" });
      const db = fakeDb({ priorRewarded: null });

      await ingestAttendance({
        provider: "fourvenues_integrations",
        eventId: 5,
        attendance: attendanceFixture({ externalAttendanceId: "fvi_live_tkt_001" }),
      }, db); // suppressLoyalty omitido → false por defecto

      expect(mockEarnTokens).toHaveBeenCalledOnce();
      expect(mockEvaluateBenefitsForOrigin).toHaveBeenCalledOnce();
    });
  });

  // ─── Loyalty Production Hardening — cutoff persistente + retry semantics ───
  describe("loyalty cutoff persistente (spec §8)", () => {
    it("una asistencia anterior al corte de loyalty persistido NUNCA concede tokens, aunque no haya suppressLoyalty explícito", async () => {
      mockResolveLoyaltyCutoff.mockResolvedValue(new Date("2026-11-01T00:00:00.000Z")); // corte futuro respecto al fixture (2026-10-03)
      mockResolveIdentity.mockResolvedValue({ userId: 42, method: "participant_email" });
      const db = fakeDb();

      const result = await ingestAttendance({ provider: "weezevent", eventId: 5, attendance: attendanceFixture() }, db);

      expect(result.status).toBe("processed"); // la asistencia SÍ se persiste
      expect(mockEarnTokens).not.toHaveBeenCalled();
    });

    it("una asistencia posterior al corte persistido evalúa con normalidad", async () => {
      mockResolveLoyaltyCutoff.mockResolvedValue(new Date("2026-01-01T00:00:00.000Z")); // corte pasado respecto al fixture
      mockResolveIdentity.mockResolvedValue({ userId: 42, method: "participant_email" });
      const db = fakeDb();

      await ingestAttendance({ provider: "weezevent", eventId: 5, attendance: attendanceFixture() }, db);

      expect(mockEarnTokens).toHaveBeenCalledOnce();
    });
  });

  describe("retry semantics (spec §5) — sobre una asistencia ya procesada sin token concedido", () => {
    function fakeDbWithUpdate({ existingAttendance, priorRewarded = null as unknown, refreshedRow = null as Record<string, unknown> | null } = { existingAttendance: null as unknown }) {
      let selectCallCount = 0;
      const updates: Record<string, unknown>[] = [];
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                selectCallCount++;
                if (selectCallCount === 1) return existingAttendance ? [existingAttendance] : [];
                if (selectCallCount === 2) return priorRewarded ? [priorRewarded] : [];
                return refreshedRow ? [refreshedRow] : (existingAttendance ? [existingAttendance] : []);
              },
            }),
          }),
        }),
        update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => { updates.push(values); return [{ affectedRows: 1 }]; } }) }),
      };
      return { db: db as never, updates };
    }

    it("una denegación TEMPORAL previa (tope agotado) SÍ se reintenta en un re-sync y actualiza tokensLedgerId", async () => {
      const deniedTemp = { status: "DENIED_TEMPORARY", reason: "RULE_LIMIT_EXCEEDED", attempts: 1, lastAttemptAt: "x", ledgerId: null, generation: 0, retryable: true };
      const existing = { id: 501, userId: 42, tokensLedgerId: null, metadata: { rewardAttempt: deniedTemp }, idempotencyKey: "weezevent:native:0:wz_participant_700002" };
      const { db, updates } = fakeDbWithUpdate({ existingAttendance: existing, refreshedRow: { ...existing, tokensLedgerId: 9001 } });

      const result = await ingestAttendance({ provider: "weezevent", eventId: 5, attendance: attendanceFixture() }, db);

      expect(result.status).toBe("already_processed");
      expect(mockEarnTokens).toHaveBeenCalledOnce();
      expect(updates[0]).toMatchObject({ tokensLedgerId: 9001 });
      expect(mockResolveIdentity).not.toHaveBeenCalled(); // reintento usa existing.userId directamente, nunca re-resuelve identidad
    });

    it("una denegación PERMANENTE previa (p.ej. cutoff) NUNCA se reintenta", async () => {
      const deniedPermanent = { status: "DENIED_PERMANENT", reason: "CUTOFF_BLOCKED", attempts: 1, lastAttemptAt: "x", ledgerId: null, generation: 0, retryable: false };
      const existing = { id: 501, userId: 42, tokensLedgerId: null, metadata: { rewardAttempt: deniedPermanent } };
      const db = fakeDb({ existingAttendance: existing });

      const result = await ingestAttendance({ provider: "weezevent", eventId: 5, attendance: attendanceFixture() }, db);

      expect(result.status).toBe("already_processed");
      expect(mockEarnTokens).not.toHaveBeenCalled();
    });

    it("una fila YA con tokensLedgerId (GRANTED real) nunca reintenta, aunque el metadata no tenga rewardAttempt (retrocompatibilidad con filas anteriores a esta fase)", async () => {
      const existing = { id: 501, userId: 42, tokensLedgerId: 8000, metadata: {} };
      const db = fakeDb({ existingAttendance: existing });

      const result = await ingestAttendance({ provider: "weezevent", eventId: 5, attendance: attendanceFixture() }, db);

      expect(result.status).toBe("already_processed");
      expect(mockEarnTokens).not.toHaveBeenCalled();
    });
  });
});
