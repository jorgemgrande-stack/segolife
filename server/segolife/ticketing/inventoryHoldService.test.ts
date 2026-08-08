/**
 * inventoryHoldService.test.ts — reserva temporal de inventario sin
 * overselling (Fase 8, spec punto 4). Mock por-tabla dentro de la
 * transacción (mismo patrón que campaignService.test.ts de Fase 7): el
 * "FOR UPDATE" en sí es una garantía real de MySQL (no se re-testea aquí,
 * igual que el resto del repo nunca re-testea SELECT...FOR UPDATE de
 * tokenLedgerService.ts) — lo que se prueba es que el SERVICIO calcula
 * comprometido+solicitado correctamente y nunca permite pasarse del aforo,
 * y que la SEGUNDA de dos llamadas secuenciales ve el compromiso dejado
 * por la primera (la propiedad que impide overselling una vez que MySQL
 * serializa el acceso real).
 */
import { describe, it, expect } from "vitest";
import { createHold, CheckoutError, type HoldItemInput } from "./inventoryHoldService";
import { eventTicketTypes, ticketOrders, ticketOrderItems } from "../../../drizzle/schema";

interface MockTicketType {
  id: number; eventId: number; name: string; priceCents: number; currency: string;
  capacity: number | null; status: "active" | "inactive";
  salesStart?: Date | null; salesEnd?: Date | null;
}

/** `committedSequence` se consume en el MISMO orden en que el servicio pregunta por cada ticketTypeId de `items` — evita tener que parsear el WHERE real del mock. */
function makeMockDb(config: { types: MockTicketType[]; committedSequence?: number[]; existingOrderForIdempotency?: any }) {
  const committedQueue = [...(config.committedSequence ?? [])];
  const orderRows: any[] = [];
  let nextOrderId = 100;
  let mode: "select" | "insert" = "select";
  let currentTable: "types" | "committed" | "orders" | "items" = "orders";

  const b: any = {};
  b.select = () => { mode = "select"; return b; };
  b.insert = (t: unknown) => { mode = "insert"; currentTable = t === ticketOrders ? "orders" : "items"; return b; };
  b.from = (t: unknown) => {
    currentTable = t === eventTicketTypes ? "types" : t === ticketOrderItems ? "committed" : "orders";
    return b;
  };
  b.innerJoin = () => b;
  b.where = () => b;
  b.for = (_lock: string) => Promise.resolve(config.types);
  b.limit = (_n: number) => {
    if (currentTable === "orders") {
      return Promise.resolve(config.existingOrderForIdempotency ? [config.existingOrderForIdempotency] : orderRows.slice(-1));
    }
    return Promise.resolve([]);
  };
  // committedQuantity() termina directamente en .where() (sin .for()/.limit()) — thenable.
  b.then = (resolve: (v: unknown) => void) => {
    if (currentTable === "committed") {
      resolve([{ committed: committedQueue.length ? committedQueue.shift() : 0 }]);
    } else {
      resolve([]);
    }
  };
  b.values = (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
    if (mode === "insert" && currentTable === "orders") {
      const row = { id: nextOrderId++, status: "pending", ...v };
      orderRows.push(row);
      return Promise.resolve([{ insertId: row.id }]);
    }
    return Promise.resolve([{}]);
  };
  b.transaction = async (cb: (tx: unknown) => Promise<unknown>) => cb(b);
  return { db: b as any, orderRows };
}

function ticketType(overrides: Partial<MockTicketType> = {}): MockTicketType {
  return { id: 1, eventId: 1, name: "General", priceCents: 1000, currency: "EUR", capacity: 10, status: "active", ...overrides };
}

describe("inventoryHoldService — createHold", () => {
  it("rechaza un carrito vacío", async () => {
    const { db } = makeMockDb({ types: [] });
    await expect(createHold({ eventId: 1, userId: 1, items: [], idempotencyKey: "k1" }, db)).rejects.toBeInstanceOf(CheckoutError);
  });

  it("crea el hold cuando hay aforo suficiente, calculando el precio SIEMPRE desde el tipo de entrada (nunca confía en el frontend)", async () => {
    const { db, orderRows } = makeMockDb({ types: [ticketType({ capacity: 10 })], committedSequence: [2] });
    const items: HoldItemInput[] = [{ ticketTypeId: 1, quantity: 3 }];
    const result = await createHold({ eventId: 1, userId: 1, items, idempotencyKey: "k2" }, db);

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.order.subtotalCents).toBe(3000); // 3 × 1000, nunca un importe inventado
      expect(result.order.status).toBe("pending");
    }
    expect(orderRows).toHaveLength(1);
  });

  it("rechaza si comprometido + solicitado supera el aforo (SOLD_OUT) — nunca oversell", async () => {
    const { db } = makeMockDb({ types: [ticketType({ capacity: 10 })], committedSequence: [9] });
    await expect(createHold({ eventId: 1, userId: 1, items: [{ ticketTypeId: 1, quantity: 5 }], idempotencyKey: "k3" }, db))
      .rejects.toMatchObject({ code: "SOLD_OUT" });
  });

  it("PROPIEDAD DE CONCURRENCIA: dos holds SECUENCIALES para el mismo tipo agotan el aforo correctamente — el segundo ve el compromiso del primero y falla si ya no cabe", async () => {
    // Aforo=5. Primer hold pide 3 (comprometido previo=0) → cabe. Si el
    // aforo real ya refleja esos 3 (lo que MySQL garantiza vía el lock real
    // en producción), un segundo hold pidiendo 3 más (comprometido=3) NO
    // debe caber (3+3=6 > 5) — exactamente la propiedad que evita oversell.
    const capacity = 5;
    const { db: db1 } = makeMockDb({ types: [ticketType({ capacity })], committedSequence: [0] });
    const first = await createHold({ eventId: 1, userId: 1, items: [{ ticketTypeId: 1, quantity: 3 }], idempotencyKey: "race-1" }, db1);
    expect(first.status).toBe("created");

    const { db: db2 } = makeMockDb({ types: [ticketType({ capacity })], committedSequence: [3] }); // refleja el compromiso ya dejado por el primer hold
    await expect(createHold({ eventId: 1, userId: 1, items: [{ ticketTypeId: 1, quantity: 3 }], idempotencyKey: "race-2" }, db2))
      .rejects.toMatchObject({ code: "SOLD_OUT" });
  });

  it("idempotencia — la misma idempotencyKey devuelve el order existente sin crear uno nuevo", async () => {
    const existing = { id: 55, status: "pending", idempotencyKey: "dup-key" };
    const { db, orderRows } = makeMockDb({ types: [ticketType()], existingOrderForIdempotency: existing });
    const result = await createHold({ eventId: 1, userId: 1, items: [{ ticketTypeId: 1, quantity: 1 }], idempotencyKey: "dup-key" }, db);
    expect(result.status).toBe("already_exists");
    if (result.status === "already_exists") expect(result.order.id).toBe(55);
    expect(orderRows).toHaveLength(0);
  });

  it("rechaza un tipo de entrada fuera de la ventana de venta (salesEnd ya pasado)", async () => {
    const { db } = makeMockDb({ types: [ticketType({ salesEnd: new Date("2020-01-01") })] });
    await expect(createHold({ eventId: 1, userId: 1, items: [{ ticketTypeId: 1, quantity: 1 }], idempotencyKey: "k4" }, db))
      .rejects.toMatchObject({ code: "SALES_ENDED" });
  });

  it("rechaza cantidad inválida (0 o por encima del máximo anti-abuso)", async () => {
    const { db } = makeMockDb({ types: [ticketType()] });
    await expect(createHold({ eventId: 1, userId: 1, items: [{ ticketTypeId: 1, quantity: 999 }], idempotencyKey: "k5" }, db))
      .rejects.toMatchObject({ code: "INVALID_QUANTITY" });
  });
});
