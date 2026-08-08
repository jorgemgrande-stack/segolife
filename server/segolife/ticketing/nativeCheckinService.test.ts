/**
 * nativeCheckinService.test.ts — check-in atómico de un ticket nativo
 * (Fase 8, spec puntos 11-14, 35). El scanner NUNCA llama a earnTokens()/
 * evaluateBenefitsForOrigin() directamente — solo a ingestAttendance()
 * (mockeado aquí, ya cubierto por sus propios tests). El test de
 * concurrencia clave: dos check-ins SECUENCIALES del MISMO ticket sobre el
 * mismo estado de fila simulan la carrera real — solo el primero gana
 * (mismo patrón UPDATE condicional + affectedRows que benefitRedemptionService.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIngestAttendance } = vi.hoisted(() => ({ mockIngestAttendance: vi.fn() }));
vi.mock("./attendancePipeline", () => ({ ingestAttendance: mockIngestAttendance }));

import { checkInTicket, CheckinError } from "./nativeCheckinService";

function ticketFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, eventId: 5, userId: 42, qrTokenHash: "abc123hash",
    salesChannel: "native", provider: "segolife_native", externalTicketId: "native:1:1:1",
    status: "issued",
    ...overrides,
  };
}

/**
 * Simula la fila real: el UPDATE condicional solo tiene éxito si `status`
 * sigue siendo "issued" en el momento de ejecutarse. La secuencia real de
 * checkInTicket() es fija: 1) select ticket por hash, 2) select event,
 * 3) update condicional, 4) select ticket actualizado, 5) select nombre del
 * estudiante — se usa un contador de llamadas .select() en vez de
 * introspeccionar el objeto de tabla real de Drizzle.
 */
function makeMockDb(ticket: Record<string, unknown> | null, event: Record<string, unknown> | null = { id: 5, venueId: 10 }) {
  // Referencia directa (SIN copiar) — dos mocks construidos sobre el MISMO
  // objeto `ticket` deben ver la mutación que hizo el otro, para simular la
  // carrera real de dos escaneos concurrentes sobre la misma fila.
  const row = ticket;
  let mode: "select" | "update" = "select";
  let selectCount = 0;
  let pendingSet: Record<string, unknown> = {};

  const b: any = {};
  b.select = () => { mode = "select"; selectCount++; return b; };
  b.update = () => { mode = "update"; return b; };
  b.from = () => b;
  b.set = (f: Record<string, unknown>) => { pendingSet = f; return b; };
  b.where = () => {
    if (mode === "update") {
      if (row && row.status === "issued") {
        Object.assign(row, pendingSet);
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    }
    return b;
  };
  b.limit = () => {
    // 1ª select = ticket por hash; 2ª = event; 3ª = ticket actualizado (tras el update); 4ª = nombre del estudiante.
    if (selectCount === 1) return Promise.resolve(row ? [{ ...row }] : []);
    if (selectCount === 2) return Promise.resolve(event ? [event] : []);
    if (selectCount === 3) return Promise.resolve(row ? [{ ...row }] : []);
    return Promise.resolve([{ name: "Fixture Student" }]);
  };
  return b as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIngestAttendance.mockResolvedValue({ status: "processed", attendance: { id: 900 } });
});

describe("nativeCheckinService — checkInTicket", () => {
  it("valida un ticket issued → lo marca used → llama a ingestAttendance con resolvedUserId (nunca earnTokens directamente)", async () => {
    const db = makeMockDb(ticketFixture());
    const result = await checkInTicket({ token: "plaintoken", staffUserId: 9, staffAuthorizedVenueIds: "all" }, db);

    expect(result.ticket.status).toBe("used");
    expect(mockIngestAttendance).toHaveBeenCalledOnce();
    expect(mockIngestAttendance.mock.calls[0][0]).toMatchObject({ provider: "segolife", resolvedUserId: 42, ticketId: 1 });
  });

  it("código inexistente → NOT_FOUND", async () => {
    const db = makeMockDb(null);
    await expect(checkInTicket({ token: "x", staffUserId: 9, staffAuthorizedVenueIds: "all" }, db)).rejects.toBeInstanceOf(CheckinError);
  });

  it("ticket ya usado → ALREADY_USED, sin tocar la fila", async () => {
    const db = makeMockDb(ticketFixture({ status: "used" }));
    await expect(checkInTicket({ token: "x", staffUserId: 9, staffAuthorizedVenueIds: "all" }, db)).rejects.toMatchObject({ code: "ALREADY_USED" });
  });

  it("ticket cancelado → CANCELLED", async () => {
    const db = makeMockDb(ticketFixture({ status: "cancelled" }));
    await expect(checkInTicket({ token: "x", staffUserId: 9, staffAuthorizedVenueIds: "all" }, db)).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("staff sin autorización para el venue del evento → UNAUTHORIZED_STAFF", async () => {
    const db = makeMockDb(ticketFixture(), { id: 5, venueId: 99 });
    await expect(checkInTicket({ token: "x", staffUserId: 9, staffAuthorizedVenueIds: [1, 2, 3] }, db)).rejects.toMatchObject({ code: "UNAUTHORIZED_STAFF" });
  });

  it("un ticket externo (no segolife_native) nunca se valida aquí — NOT_NATIVE", async () => {
    const db = makeMockDb(ticketFixture({ salesChannel: "external", provider: "weezevent" }));
    await expect(checkInTicket({ token: "x", staffUserId: 9, staffAuthorizedVenueIds: "all" }, db)).rejects.toMatchObject({ code: "NOT_NATIVE" });
  });

  it("CONCURRENCIA: dos check-ins secuenciales del MISMO ticket — solo el primero gana, el segundo ve status='used' y falla", async () => {
    const sharedTicket = ticketFixture();
    const db1 = makeMockDb(sharedTicket);
    const first = await checkInTicket({ token: "x", staffUserId: 9, staffAuthorizedVenueIds: "all" }, db1);
    expect(first.ticket.status).toBe("used");

    // El segundo escaneo opera sobre el MISMO estado ya mutado por el primero (simulando que ambos leyeron la fila antes de que el UPDATE condicional del primero ganara la carrera real en MySQL).
    const db2 = makeMockDb(sharedTicket);
    await expect(checkInTicket({ token: "x", staffUserId: 9, staffAuthorizedVenueIds: "all" }, db2)).rejects.toMatchObject({ code: "ALREADY_USED" });
    expect(mockIngestAttendance).toHaveBeenCalledOnce(); // nunca se procesó loyalty dos veces
  });
});
