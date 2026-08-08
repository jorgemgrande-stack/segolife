/**
 * ticketIssuanceService.test.ts — emisión idempotente de event_tickets al
 * confirmar el pago (Fase 8, spec puntos 9, 34, 35). Reutiliza el UNIQUE
 * (provider, external_ticket_id) de Fase 5 — nunca una tabla nueva. La
 * secuencia real de issueTicketsForOrder() es determinista para un mismo
 * order/items: 1) leer ticket_order_items, y por cada unidad → 2) comprobar
 * si ya existe por (provider, externalTicketId), 3) si no, insertar,
 * 4) releer la fila insertada — el mock usa un contador de pasos en vez de
 * introspeccionar el WHERE real de Drizzle (mismo criterio que el resto de
 * mocks de Fase 8).
 */
import { describe, it, expect } from "vitest";
import { issueTicketsForOrder } from "./ticketIssuanceService";

function makeMockDb(orderItems: Array<{ id: number; ticketTypeId: number; quantity: number }>, preExisting: Record<string, unknown> | null = null) {
  const tickets: Record<string, unknown>[] = preExisting ? [preExisting] : [];
  let nextId = 500;
  let itemsRead = false;

  const b: any = {};
  let mode: "select" | "insert" = "select";
  b.select = () => { mode = "select"; return b; };
  b.insert = () => { mode = "insert"; return b; };
  b.ignore = () => b;
  b.from = () => b;
  b.where = () => b;
  // La primera lectura (order_items) termina en .where() sin .limit() → thenable.
  b.then = (resolve: (v: unknown) => void) => {
    if (!itemsRead) { itemsRead = true; resolve(orderItems); return; }
    resolve([]);
  };
  b.limit = () => {
    // Cualquier select-con-limit tras leer los items es o bien "existing" o "refetch tras insert" — en ambos casos basta con devolver la ÚLTIMA fila conocida que coincida, porque cada test controla que solo haya como máximo una candidata relevante en juego a la vez.
    return Promise.resolve(tickets.length ? [tickets[tickets.length - 1]] : []);
  };
  b.values = (v: Record<string, unknown>) => {
    const dup = tickets.find(t => t.provider === v.provider && t.externalTicketId === v.externalTicketId);
    if (dup) return Promise.resolve([{ insertId: 0 }]);
    const row = { id: nextId++, ...v };
    tickets.push(row);
    return Promise.resolve([{ insertId: row.id }]);
  };
  return { db: b as any, tickets };
}

describe("ticketIssuanceService — issueTicketsForOrder", () => {
  it("emite un ticket con QR propio para un item de quantity=1", async () => {
    const { db, tickets } = makeMockDb([{ id: 1, ticketTypeId: 10, quantity: 1 }]);
    const order = { id: 1, eventId: 5, userId: 42 } as any;

    const issued = await issueTicketsForOrder(order, db);

    expect(issued).toHaveLength(1);
    expect(issued[0].qrToken).toBeTruthy();
    expect(issued[0].qrTokenHash).toBeTruthy();
    expect(issued[0].externalTicketId).toBe("native:1:1:1");
    expect(tickets).toHaveLength(1); // una sola fila insertada
  });

  it("idempotente — reemitir para un ticket YA emitido devuelve la fila existente, sin insertar de nuevo", async () => {
    const existing = { id: 900, provider: "segolife_native", externalTicketId: "native:1:1:1", status: "issued", qrToken: "already-issued" };
    const { db, tickets } = makeMockDb([{ id: 1, ticketTypeId: 10, quantity: 1 }], existing);
    const order = { id: 1, eventId: 5, userId: 42 } as any;

    const issued = await issueTicketsForOrder(order, db);

    expect(issued).toHaveLength(1);
    expect(issued[0].id).toBe(900);
    expect(issued[0].qrToken).toBe("already-issued"); // nunca genera un segundo token para la misma unidad
    expect(tickets).toHaveLength(1); // no se añadió ninguna fila nueva
  });
});
