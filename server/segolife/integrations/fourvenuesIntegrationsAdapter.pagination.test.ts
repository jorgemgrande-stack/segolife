/**
 * fourvenuesIntegrationsAdapter.pagination.test.ts — Fourvenues Pagination
 * Hardening. Confirmado empíricamente 2026-08-13 contra la API real: sin
 * parámetros, GET /tickets/ trunca a 500 registros — offset/limit SÍ
 * funcionan (limit máximo real = 500, limit=1000 → 400), sin metadata de
 * total en el body — la única señal de última página es que devuelva MENOS
 * elementos que el límite pedido (o vacía). Ver fourvenuesIntegrationsAdapter.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFourvenuesIntegrationsAdapter, FourvenuesPaginationIncompleteError } from "./fourvenuesIntegrationsAdapter";
import { HttpTransportError } from "./httpTransport";
import type { IntegrationTransport } from "./externalTicketingProvider";

function fakeTicket(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: id,
    code: id,
    event_id: "fvi_evt_001",
    rate_id: "fvi_rate_001",
    status: "activated",
    name: `Fixture ${id}`,
    email: `${id}@example.invalid`,
    phone: "+34600000000",
    total_paid: 10,
    total_fees: 0,
    refunded: 0,
    payment_id: `pay_${id}`,
    enter: 0,
    created_at: "2026-06-01T10:00:00.000Z",
    updated_at: "2026-06-01T10:00:00.000Z",
    ...overrides,
  };
}

function page(ids: string[], overridesByIndex: Record<number, Partial<Record<string, unknown>>> = {}) {
  return { success: true, data: ids.map((id, i) => fakeTicket(id, overridesByIndex[i] ?? {})) };
}

/** Transport paginado real: sirve `pagesByOffset[offset]` según el offset pedido — simula fielmente el contrato confirmado (offset/limit, sin total). */
function createPaginatedTicketsTransport(pagesByOffset: Record<number, unknown>, opts: { failOnceAtOffset?: number; failStatus?: number } = {}): { transport: IntegrationTransport; requestLog: number[] } {
  const requestLog: number[] = [];
  let failedOnce = false;
  const transport: IntegrationTransport = {
    request: async (reqOpts) => {
      if (reqOpts.path === "/events/") return { success: true, data: [] } as never;
      if (reqOpts.path === "/tickets-rates/") return { success: true, data: [] } as never;
      const offset = Number(reqOpts.query?.offset ?? 0);
      requestLog.push(offset);
      if (opts.failOnceAtOffset === offset && !failedOnce) {
        failedOnce = true;
        throw new HttpTransportError(opts.failStatus ?? 429, "GET", "/tickets/");
      }
      const found = pagesByOffset[offset];
      if (found === undefined) return { success: true, data: [] } as never;
      return found as never;
    },
  };
  return { transport, requestLog };
}

describe("Pagination — casos básicos (spec §27)", () => {
  it("single page (menos de 500) — 1 sola llamada, todos los tickets", async () => {
    const { transport, requestLog } = createPaginatedTicketsTransport({ 0: page(["t1", "t2", "t3"]) });
    const adapter = createFourvenuesIntegrationsAdapter(transport);
    const tickets = await adapter.listTickets({ apiKey: "k" }, "fvi_evt_001");
    expect(tickets).toHaveLength(3);
    expect(requestLog).toEqual([0]);
  });

  it("exactamente 500 (límite de página) — 1 sola página real, sin pedir una segunda vacía de más", async () => {
    const ids = Array.from({ length: 500 }, (_, i) => `t${i}`);
    const { transport, requestLog } = createPaginatedTicketsTransport({
      0: page(ids),
      500: page([]), // Fourvenues confirmado: offset tras el final devuelve data:[] vacío, no error
    });
    const adapter = createFourvenuesIntegrationsAdapter(transport);
    const tickets = await adapter.listTickets({ apiKey: "k" }, "fvi_evt_001");
    expect(tickets).toHaveLength(500);
    expect(requestLog).toEqual([0, 500]); // 500 exactos SIEMPRE debe comprobar la siguiente página — no se puede asumir que sea la última solo por el número redondo
  });

  it("2 páginas — 501 (spec §28, CRÍTICO: nunca debe quedarse en 500)", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => `t${i}`);
    const { transport } = createPaginatedTicketsTransport({
      0: page(page1),
      500: page(["t500"]),
    });
    const adapter = createFourvenuesIntegrationsAdapter(transport);
    const tickets = await adapter.listTickets({ apiKey: "k" }, "fvi_evt_001");
    expect(tickets).toHaveLength(501);
  });

  it("3 páginas — 1001 (spec §29)", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => `a${i}`);
    const page2 = Array.from({ length: 500 }, (_, i) => `b${i}`);
    const { transport } = createPaginatedTicketsTransport({
      0: page(page1),
      500: page(page2),
      1000: page(["c0"]),
    });
    const adapter = createFourvenuesIntegrationsAdapter(transport);
    const tickets = await adapter.listTickets({ apiKey: "k" }, "fvi_evt_001");
    expect(tickets).toHaveLength(1001);
  });

  it("página final vacía (0 registros) termina limpiamente", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => `t${i}`);
    const { transport, requestLog } = createPaginatedTicketsTransport({ 0: page(page1), 500: page([]) });
    const adapter = createFourvenuesIntegrationsAdapter(transport);
    const tickets = await adapter.listTickets({ apiKey: "k" }, "fvi_evt_001");
    expect(tickets).toHaveLength(500);
    expect(requestLog).toEqual([0, 500]);
  });
});

describe("Pagination — duplicados entre páginas (spec §18)", () => {
  it("un ID duplicado entre página 1 y página 2 NUNCA se inserta dos veces, y queda logueado (nunca oculto)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const page1 = Array.from({ length: 500 }, (_, i) => `t${i}`);
    const { transport } = createPaginatedTicketsTransport({
      0: page(page1),
      500: page(["t499", "t500"]), // "t499" ya vino en la página 1 — simula un bug real del proveedor
    });
    const adapter = createFourvenuesIntegrationsAdapter(transport);
    const tickets = await adapter.listTickets({ apiKey: "k" }, "fvi_evt_001");

    expect(tickets).toHaveLength(501); // 500 + 1 nuevo, el duplicado NO cuenta dos veces
    expect(tickets.filter(t => t.externalId === "t499")).toHaveLength(1);
    expect(logSpy.mock.calls.some(call => String(call[0]).includes("duplicatesAcrossPages=1"))).toBe(true);
    logSpy.mockRestore();
  });
});

describe("Pagination — protección contra loop infinito (spec §16-17)", () => {
  it("si el proveedor nunca converge (siempre devuelve 500), aborta con error explícito — NUNCA success con dataset parcial", async () => {
    const transport: IntegrationTransport = {
      request: async (reqOpts) => {
        if (reqOpts.path !== "/tickets/") return { success: true, data: [] } as never;
        const offset = Number(reqOpts.query?.offset ?? 0);
        // Siempre 500 tickets, con IDs distintos cada vez — simula un bug real del proveedor que nunca termina.
        return page(Array.from({ length: 500 }, (_, i) => `off${offset}_${i}`)) as never;
      },
    };
    const adapter = createFourvenuesIntegrationsAdapter(transport);
    await expect(adapter.listTickets({ apiKey: "k" }, "fvi_evt_001")).rejects.toThrow(FourvenuesPaginationIncompleteError);
  });
});

describe("Pagination — retries transitorios (spec §21)", () => {
  it("429 entre páginas se reintenta SOLO esa página (no reinicia desde offset=0)", async () => {
    vi.useFakeTimers();
    const page1 = Array.from({ length: 500 }, (_, i) => `t${i}`);
    const { transport, requestLog } = createPaginatedTicketsTransport(
      { 0: page(page1), 500: page(["t500"]) },
      { failOnceAtOffset: 500, failStatus: 429 }
    );
    const adapter = createFourvenuesIntegrationsAdapter(transport);
    const promise = adapter.listTickets({ apiKey: "k" }, "fvi_evt_001");
    await vi.runAllTimersAsync();
    const tickets = await promise;

    expect(tickets).toHaveLength(501);
    // offset=500 se pidió DOS veces (falló + reintento) — offset=0 solo una vez, nunca se reinició el dataset completo.
    expect(requestLog.filter(o => o === 0)).toHaveLength(1);
    expect(requestLog.filter(o => o === 500)).toHaveLength(2);
    vi.useRealTimers();
  });

  it("5xx transitorio entre páginas también se reintenta (no solo 429)", async () => {
    vi.useFakeTimers();
    const page1 = Array.from({ length: 500 }, (_, i) => `t${i}`);
    const { transport } = createPaginatedTicketsTransport(
      { 0: page(page1), 500: page(["t500"]) },
      { failOnceAtOffset: 500, failStatus: 503 }
    );
    const adapter = createFourvenuesIntegrationsAdapter(transport);
    const promise = adapter.listTickets({ apiKey: "k" }, "fvi_evt_001");
    await vi.runAllTimersAsync();
    const tickets = await promise;
    expect(tickets).toHaveLength(501);
    vi.useRealTimers();
  });

  it("un error NO transitorio (400/401/404) NUNCA se reintenta — se propaga de inmediato", async () => {
    const transport: IntegrationTransport = {
      request: async (reqOpts) => {
        if (reqOpts.path !== "/tickets/") return { success: true, data: [] } as never;
        throw new HttpTransportError(401, "GET", "/tickets/");
      },
    };
    const adapter = createFourvenuesIntegrationsAdapter(transport);
    await expect(adapter.listTickets({ apiKey: "k" }, "fvi_evt_001")).rejects.toThrow(/HTTP 401/);
  });
});

describe("Pagination — grouping cross-page (spec §31, §51-52)", () => {
  it("un payment_id cuyos tickets aparecen en páginas DISTINTAS produce 1 solo order con todos sus tickets", async () => {
    const page1 = Array.from({ length: 499 }, (_, i) => `filler${i}`);
    const { transport } = createPaginatedTicketsTransport({
      0: page([...page1, "cross1"], { 499: { payment_id: "pay_cross" } }),
      500: page(["cross2"], { 0: { payment_id: "pay_cross" } }), // mismo payment_id, en la página siguiente
    });
    const adapter = createFourvenuesIntegrationsAdapter(transport);
    const orders = await adapter.listOrders({ apiKey: "k" }, "fvi_evt_001");
    const crossOrder = orders.find(o => o.externalId === "pay_cross");
    expect(crossOrder).toBeDefined();
    const tickets = await adapter.listTickets({ apiKey: "k" }, "fvi_evt_001");
    expect(tickets.filter(t => t.externalOrderId === "pay_cross")).toHaveLength(2);
  });

  it("attendance derivado de una página posterior (offset=500) SÍ se incluye correctamente", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => `t${i}`);
    const { transport } = createPaginatedTicketsTransport({
      0: page(page1),
      500: page(["late_attendee"], { 0: { enter: 1, entry_date: 1799694000 } }),
    });
    const adapter = createFourvenuesIntegrationsAdapter(transport);
    const attendance = await adapter.listAttendance({ apiKey: "k" }, "fvi_evt_001");
    expect(attendance.some(a => a.externalTicketId === "late_attendee")).toBe(true);
  });
});

describe("Pagination — idempotencia de la caché por instancia (spec §14, §59)", () => {
  it("listOrders/listTickets/listAttendance del MISMO evento con pedido paginado comparten las llamadas de red — nunca 3× las páginas", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => `t${i}`);
    const { transport, requestLog } = createPaginatedTicketsTransport({ 0: page(page1), 500: page(["t500"]) });
    const adapter = createFourvenuesIntegrationsAdapter(transport);
    await adapter.listOrders({ apiKey: "k" }, "fvi_evt_001");
    await adapter.listTickets({ apiKey: "k" }, "fvi_evt_001");
    await adapter.listAttendance({ apiKey: "k" }, "fvi_evt_001");
    // 2 páginas reales (offset 0 y 500) — nunca 6 (2 páginas × 3 llamadas normalizadas).
    expect(requestLog).toHaveLength(2);
  });
});
