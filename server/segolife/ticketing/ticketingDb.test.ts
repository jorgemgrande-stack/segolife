/**
 * ticketingDb.test.ts — borrado seguro de sales_channels/event_ticket_types
 * (rediseño operativo de Admin Ticketing/Sales, spec puntos 10/22): nunca
 * destruir orders/payments/tickets al borrar una configuración de venta —
 * si hay dependencias, se rechaza y el admin debe desactivar en su lugar.
 */
import { describe, it, expect } from "vitest";
import { deleteSalesChannelSafe, deleteTicketTypeSafe, updateTicketType, duplicateTicketType } from "./ticketingDb";

function makeMockDb({ hasDependency = false, singleRow }: { hasDependency?: boolean; singleRow?: Record<string, unknown> } = {}) {
  const deletedTables: string[] = [];
  const db: any = {
    select: () => db,
    from: () => db,
    where: () => db,
    limit: () => Promise.resolve(hasDependency ? [{ id: 999 }] : singleRow ? [singleRow] : []),
    delete: () => ({ where: () => { deletedTables.push("deleted"); return Promise.resolve(); } }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    insert: () => ({ values: () => Promise.resolve([{ insertId: 42 }]) }),
  };
  return { db, deletedTables };
}

describe("deleteSalesChannelSafe", () => {
  it("sin pedidos asociados → borra el canal", async () => {
    const { db, deletedTables } = makeMockDb({ hasDependency: false });
    const result = await deleteSalesChannelSafe(1, db);
    expect(result).toEqual({ deleted: true });
    expect(deletedTables).toEqual(["deleted"]);
  });

  it("con un pedido asociado → rechaza el borrado, nunca destruye datos", async () => {
    const { db, deletedTables } = makeMockDb({ hasDependency: true });
    const result = await deleteSalesChannelSafe(1, db);
    expect(result.deleted).toBe(false);
    expect(result.reason).toMatch(/desactív/i);
    expect(deletedTables).toEqual([]);
  });
});

describe("deleteTicketTypeSafe", () => {
  it("sin ticket_order_items ni event_tickets → borra el tipo de entrada", async () => {
    const { db, deletedTables } = makeMockDb({ hasDependency: false });
    const result = await deleteTicketTypeSafe(1, db);
    expect(result).toEqual({ deleted: true });
    expect(deletedTables).toEqual(["deleted"]);
  });

  it("con pedidos o entradas emitidas → rechaza el borrado", async () => {
    const { db, deletedTables } = makeMockDb({ hasDependency: true });
    const result = await deleteTicketTypeSafe(1, db);
    expect(result.deleted).toBe(false);
    expect(result.reason).toMatch(/desactív/i);
    expect(deletedTables).toEqual([]);
  });
});

describe("updateTicketType", () => {
  it("actualiza los campos y devuelve la fila resultante", async () => {
    const row = { id: 1, eventId: 10, name: "General", priceCents: 1500, status: "inactive" };
    const { db } = makeMockDb({ singleRow: row });
    const result = await updateTicketType(1, { status: "inactive" }, db);
    expect(result).toEqual(row);
  });
});

describe("duplicateTicketType", () => {
  it("clona un tipo de entrada existente con '(copia)' en el nombre", async () => {
    const original = {
      id: 1, eventId: 10, name: "General", description: "desc", priceCents: 1500, currency: "EUR",
      capacity: 100, salesStart: null, salesEnd: null, status: "active", metadata: null,
    };
    const created = { ...original, id: 42, name: "General (copia)" };
    let selectCallCount = 0;
    const db: any = {
      select: () => db,
      from: () => db,
      where: () => db,
      limit: () => { selectCallCount++; return Promise.resolve(selectCallCount === 1 ? [original] : [created]); },
      insert: () => ({ values: () => Promise.resolve([{ insertId: 42 }]) }),
    };
    const result = await duplicateTicketType(1, db);
    expect(result?.name).toBe("General (copia)");
  });

  it("tipo de entrada inexistente → null, sin crear nada", async () => {
    const db: any = { select: () => db, from: () => db, where: () => db, limit: () => Promise.resolve([]) };
    const result = await duplicateTicketType(999, db);
    expect(result).toBeNull();
  });
});
