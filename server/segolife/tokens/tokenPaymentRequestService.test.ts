/**
 * tokenPaymentRequestService.test.ts — SEGOLIFE PRE-16.1: PRESENTIAL
 * SEGOTOKENS PAYMENTS. reserveTokenSpend/captureTokenSpend/releaseTokenSpend
 * ya están probados en tokenSpendService.test.ts (Fase 7) — aquí se mockean
 * y se prueba SOLO la orquestación propia de este archivo: el ciclo de vida
 * de autorización del Student (pending→confirmed→settled,
 * pending→rejected, pending|confirmed→cancelled/expired), propiedad,
 * idempotencia y expiración perezosa.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReserveTokenSpend, mockCaptureTokenSpend, mockReleaseTokenSpend } = vi.hoisted(() => ({
  mockReserveTokenSpend: vi.fn(),
  mockCaptureTokenSpend: vi.fn(),
  mockReleaseTokenSpend: vi.fn(),
}));
vi.mock("./tokenSpendService", () => ({
  reserveTokenSpend: mockReserveTokenSpend,
  captureTokenSpend: mockCaptureTokenSpend,
  releaseTokenSpend: mockReleaseTokenSpend,
}));

import {
  requestTokenPayment, getTokenPaymentRequestView, listMyOpenTokenPaymentRequests,
  confirmTokenPaymentRequest, rejectTokenPaymentRequest, cancelTokenPaymentRequest,
  settleTokenPaymentRequest, TokenPaymentRequestError,
} from "./tokenPaymentRequestService";
import { tokenPaymentRequests, tokenSpendReservations } from "../../../drizzle/schema";

const FUTURE = () => new Date(Date.now() + 15 * 60 * 1000);
const PAST = () => new Date(Date.now() - 1000);

function reservationFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 501, userId: 42, walletId: 1, venueId: 10, eventId: null, communityId: null,
    referenceType: "token_payment_request", referenceId: null,
    grossAmountCents: 1000, tokensReserved: 100, promotionalValueCents: 100, moneyDueCents: 900,
    status: "reserved", idempotencyKey: "k1", ledgerId: null, reversalLedgerId: null,
    expiresAt: FUTURE(), createdByUserId: 9, createdAt: new Date(), capturedAt: null, releasedAt: null, reversedAt: null,
    ...overrides,
  };
}

function requestFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, tokenReservationId: 501, status: "pending", idempotencyKey: "req-k1",
    orderContextType: "pos", settledOrderId: null, createdAt: new Date(),
    respondedAt: null, settledAt: null, cancelledAt: null,
    ...overrides,
  };
}

/** In-memory de las dos tablas propias del dominio — reserva y request comparten identidad de OBJETO con lo que devuelven los mocks de tokenSpendService, así que mutarla en un mock (p.ej. captura) es visible en la siguiente lectura, igual que en una transacción real. */
function makeMockDb(config: { request?: Record<string, unknown> | null; reservation?: Record<string, unknown> | null } = {}) {
  let requests = config.request ? [config.request] : [];
  let reservations = config.reservation ? [config.reservation] : [];
  let nextId = 1000;

  function builder() {
    const b: any = {};
    let mode: "select" | "update" | "insert" = "select";
    let table: unknown = null;
    let setValues: Record<string, unknown> | null = null;
    let insertValues: Record<string, unknown> | null = null;
    const conditions: Array<{ col: string; val: unknown }> = [];

    b.select = () => { mode = "select"; return b; };
    b.update = (t: unknown) => { mode = "update"; table = t; return b; };
    b.insert = (t: unknown) => { mode = "insert"; table = t; return b; };
    b.values = (v: Record<string, unknown>) => { insertValues = v; return b; };
    b.from = (t: unknown) => { table = t; return b; };
    b.set = (v: Record<string, unknown>) => { setValues = v; return b; };
    // eq(col, val) en drizzle-orm produce un objeto opaco — aquí solo nos
    // interesa capturar la intención vía un espía simple sobre `where`, así
    // que en vez de parsear el AST real, cada test filtra por id/clave a
    // través de closures del propio array (ver findRow más abajo). `where`
    // se limita a marcar que hay condición, la resolución real ocurre en
    // `then` con el último id/idempotencyKey usado por el propio servicio.
    b.where = (..._args: unknown[]) => { void _args; return b; };
    b.limit = () => b;
    b.for = () => b;
    b.orderBy = () => b;
    b.then = (resolve: (v: unknown) => void) => {
      const arr = table === tokenPaymentRequests ? requests : reservations;
      if (mode === "insert") {
        const row = { ...insertValues, id: nextId };
        if (table === tokenPaymentRequests) requests.push(row);
        nextId += 1;
        return resolve([{ insertId: row.id }]);
      }
      if (mode === "update") {
        // Aplica a TODAS las filas del array — en los tests de este archivo
        // cada array tiene como mucho 1 fila relevante por caso, así que
        // esto es equivalente a filtrar por id sin reimplementar el AST de
        // `where`.
        for (const row of arr) Object.assign(row, setValues);
        return resolve([{ affectedRows: arr.length }]);
      }
      return resolve(arr);
    };
    return b;
  }

  const outer: any = builder();
  outer.transaction = (cb: (tx: unknown) => Promise<unknown>) => cb(builder());
  return {
    db: outer,
    getRequests: () => requests,
    getReservations: () => reservations,
    seedReservation: (r: Record<string, unknown>) => { reservations = [r]; },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requestTokenPayment — solicitar (spec §3/§4)", () => {
  it("reserva y crea la solicitud en estado 'pending'", async () => {
    const reservation = reservationFixture();
    mockReserveTokenSpend.mockResolvedValue({ status: "reserved", reservation });
    const { db, getRequests } = makeMockDb();

    const result = await requestTokenPayment({
      userId: 42, venueId: 10, grossAmountCents: 1000, requestedTokens: 100,
      orderContextType: "pos", idempotencyKey: "req-a", operatorUserId: 9,
    }, db);

    expect(result.request.status).toBe("pending");
    expect(result.reservation).toBe(reservation);
    expect(getRequests()).toHaveLength(1);
    expect(mockReserveTokenSpend).toHaveBeenCalledOnce();
    expect(mockReserveTokenSpend.mock.calls[0][0]).toMatchObject({ userId: 42, requestedTokens: 100, createdByUserId: 9 });
  });

  it("no_policy: propaga NO_POLICY, nunca crea la fila de solicitud", async () => {
    mockReserveTokenSpend.mockResolvedValue({ status: "no_policy" });
    const { db, getRequests } = makeMockDb();
    await expect(requestTokenPayment({ userId: 42, venueId: 10, grossAmountCents: 1000, requestedTokens: 100, orderContextType: "pos", idempotencyKey: "req-b", operatorUserId: 9 }, db))
      .rejects.toMatchObject({ code: "NO_POLICY" });
    expect(getRequests()).toHaveLength(0);
  });

  it("reintento con la MISMA idempotencyKey: devuelve la solicitud ya existente, nunca reserva dos veces", async () => {
    const existingRequest = requestFixture({ idempotencyKey: "req-c" });
    const reservation = reservationFixture();
    const { db } = makeMockDb({ request: existingRequest, reservation });
    const result = await requestTokenPayment({ userId: 42, venueId: 10, grossAmountCents: 1000, requestedTokens: 100, orderContextType: "pos", idempotencyKey: "req-c", operatorUserId: 9 }, db);
    expect(result.request).toBe(existingRequest);
    expect(mockReserveTokenSpend).not.toHaveBeenCalled();
  });
});

describe("confirmTokenPaymentRequest — el Student aprueba (spec §5, nunca captura el ledger todavía)", () => {
  it("pending + propietario correcto → confirmed, NUNCA llama a captureTokenSpend", async () => {
    const reservation = reservationFixture();
    const request = requestFixture();
    const { db } = makeMockDb({ request, reservation });
    const result = await confirmTokenPaymentRequest(1, 42, db);
    expect(result.request.status).toBe("confirmed");
    expect(mockCaptureTokenSpend).not.toHaveBeenCalled();
  });

  it("NOT_OWNER: un Student distinto del dueño de la reserva no puede confirmar", async () => {
    const { db } = makeMockDb({ request: requestFixture(), reservation: reservationFixture({ userId: 42 }) });
    await expect(confirmTokenPaymentRequest(1, 999, db)).rejects.toMatchObject({ code: "NOT_OWNER" });
  });

  it("ya confirmada (doble confirmación, spec §12 test K): rechaza — nunca dos confirmaciones sobre la misma solicitud", async () => {
    const { db } = makeMockDb({ request: requestFixture({ status: "confirmed" }), reservation: reservationFixture() });
    await expect(confirmTokenPaymentRequest(1, 42, db)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("expirada (reserva con expiresAt en el pasado): rechaza con EXPIRED y libera la reserva (expiración perezosa, spec §13)", async () => {
    const { db } = makeMockDb({ request: requestFixture(), reservation: reservationFixture({ expiresAt: PAST() }) });
    mockReleaseTokenSpend.mockResolvedValue(reservationFixture({ status: "released" }));
    await expect(confirmTokenPaymentRequest(1, 42, db)).rejects.toMatchObject({ code: "EXPIRED" });
    expect(mockReleaseTokenSpend).toHaveBeenCalledOnce();
  });
});

describe("rejectTokenPaymentRequest — el Student rechaza (spec §15, libera de inmediato)", () => {
  it("pending → rejected, libera la reserva inmediatamente", async () => {
    const reservation = reservationFixture();
    const { db } = makeMockDb({ request: requestFixture(), reservation });
    mockReleaseTokenSpend.mockResolvedValue({ ...reservation, status: "released" });
    const result = await rejectTokenPaymentRequest(1, 42, db);
    expect(result.request.status).toBe("rejected");
    expect(mockReleaseTokenSpend).toHaveBeenCalledWith(501, "student_rejected", expect.anything());
  });

  it("NOT_OWNER: un Student distinto no puede rechazar la solicitud de otro", async () => {
    const { db } = makeMockDb({ request: requestFixture(), reservation: reservationFixture({ userId: 42 }) });
    await expect(rejectTokenPaymentRequest(1, 999, db)).rejects.toMatchObject({ code: "NOT_OWNER" });
    expect(mockReleaseTokenSpend).not.toHaveBeenCalled();
  });

  it("ya liquidada (settled): rechaza — nunca se puede rechazar algo que ya se cobró", async () => {
    const { db } = makeMockDb({ request: requestFixture({ status: "settled" }), reservation: reservationFixture({ status: "captured" }) });
    await expect(rejectTokenPaymentRequest(1, 42, db)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("cancelTokenPaymentRequest — el operador cancela (spec §14/§16: antes O después de que el Student confirme)", () => {
  it("desde 'pending': cancela y libera", async () => {
    const { db } = makeMockDb({ request: requestFixture(), reservation: reservationFixture() });
    mockReleaseTokenSpend.mockResolvedValue(reservationFixture({ status: "released" }));
    const result = await cancelTokenPaymentRequest(1, 9, db);
    expect(result.request.status).toBe("cancelled");
    expect(mockReleaseTokenSpend).toHaveBeenCalledOnce();
  });

  it("desde 'confirmed' (spec §16 — el cobro del dinero restante falló): también cancela y libera", async () => {
    const { db } = makeMockDb({ request: requestFixture({ status: "confirmed" }), reservation: reservationFixture() });
    mockReleaseTokenSpend.mockResolvedValue(reservationFixture({ status: "released" }));
    const result = await cancelTokenPaymentRequest(1, 9, db);
    expect(result.request.status).toBe("cancelled");
  });

  it("ya liquidada (settled): rechaza — nunca se cancela algo que ya se cobró de verdad", async () => {
    const { db } = makeMockDb({ request: requestFixture({ status: "settled" }), reservation: reservationFixture({ status: "captured" }) });
    await expect(cancelTokenPaymentRequest(1, 9, db)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(mockReleaseTokenSpend).not.toHaveBeenCalled();
  });
});

describe("settleTokenPaymentRequest — el operador liquida (spec §16 patrón A: captura solo aquí, la única vez)", () => {
  it("confirmed + contexto correcto → captura y marca 'settled'", async () => {
    const reservation = reservationFixture();
    const { db } = makeMockDb({ request: requestFixture({ status: "confirmed" }), reservation });
    mockCaptureTokenSpend.mockResolvedValue({ reservation: { ...reservation, status: "captured" }, alreadyCaptured: false });
    const result = await settleTokenPaymentRequest(1, "pos", db);
    expect(result.request.status).toBe("settled");
    expect(mockCaptureTokenSpend).toHaveBeenCalledWith(501, expect.anything());
  });

  it("estado 'pending' (el Student aún no confirmó): rechaza, NUNCA captura", async () => {
    const { db } = makeMockDb({ request: requestFixture({ status: "pending" }), reservation: reservationFixture() });
    await expect(settleTokenPaymentRequest(1, "pos", db)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(mockCaptureTokenSpend).not.toHaveBeenCalled();
  });

  it("CONTEXT_MISMATCH: una solicitud creada para 'door' no se puede liquidar como 'pos'", async () => {
    const { db } = makeMockDb({ request: requestFixture({ status: "confirmed", orderContextType: "door" }), reservation: reservationFixture() });
    await expect(settleTokenPaymentRequest(1, "pos", db)).rejects.toMatchObject({ code: "CONTEXT_MISMATCH" });
    expect(mockCaptureTokenSpend).not.toHaveBeenCalled();
  });

  it("expirada entre la confirmación y la liquidación: rechaza con EXPIRED, nunca captura", async () => {
    const { db } = makeMockDb({ request: requestFixture({ status: "confirmed" }), reservation: reservationFixture({ expiresAt: PAST() }) });
    await expect(settleTokenPaymentRequest(1, "pos", db)).rejects.toMatchObject({ code: "EXPIRED" });
    expect(mockCaptureTokenSpend).not.toHaveBeenCalled();
  });

  it("reintento sobre una solicitud YA liquidada (spec §12 'network retry'): idempotente, nunca vuelve a capturar", async () => {
    const reservation = reservationFixture({ status: "captured" });
    const { db } = makeMockDb({ request: requestFixture({ status: "settled" }), reservation });
    const result = await settleTokenPaymentRequest(1, "pos", db);
    expect(result.request.status).toBe("settled");
    expect(mockCaptureTokenSpend).not.toHaveBeenCalled();
  });
});

describe("getTokenPaymentRequestView / listMyOpenTokenPaymentRequests — lectura y expiración perezosa (spec §13)", () => {
  it("una solicitud pending cuya reserva ya expiró se reporta como 'expired' y se libera en el mismo poll", async () => {
    const { db } = makeMockDb({ request: requestFixture(), reservation: reservationFixture({ expiresAt: PAST() }) });
    mockReleaseTokenSpend.mockResolvedValue(reservationFixture({ status: "released" }));
    const view = await getTokenPaymentRequestView(1, db);
    expect(view.effectiveStatus).toBe("expired");
    expect(mockReleaseTokenSpend).toHaveBeenCalledOnce();
  });

  it("una solicitud pending vigente se reporta tal cual, sin tocar la reserva", async () => {
    const { db } = makeMockDb({ request: requestFixture(), reservation: reservationFixture() });
    const view = await getTokenPaymentRequestView(1, db);
    expect(view.effectiveStatus).toBe("pending");
    expect(mockReleaseTokenSpend).not.toHaveBeenCalled();
  });

  it("listMyOpenTokenPaymentRequests solo devuelve pendientes vigentes — spec §11: dos venues compitiendo por el mismo saldo es un caso real, no un bug (la lista puede tener más de una fila)", async () => {
    const reservation = reservationFixture();
    const { db } = makeMockDb({ request: requestFixture(), reservation });
    // Simula el join manual: listMyOpenTokenPaymentRequests hace su propio
    // select con innerJoin — el builder de este archivo no modela joins
    // reales, así que se prueba a través del propio db (mismo array) y se
    // confía en el filtro `effectiveStatus==='pending'` de la función.
    db.select = () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve([{ request: requestFixture(), reservation }]),
        }),
      }),
    });
    const rows = await listMyOpenTokenPaymentRequests(42, db);
    expect(rows).toHaveLength(1);
    expect(rows[0].effectiveStatus).toBe("pending");
  });
});
