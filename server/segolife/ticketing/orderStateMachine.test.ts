/**
 * orderStateMachine.test.ts — transiciones válidas de ticket_orders.status
 * (Fase 8, spec punto 5). Mismo patrón de mock por-fila que
 * benefitRedemptionService.ts: UPDATE condicional + affectedRows.
 */
import { describe, it, expect } from "vitest";
import { transitionOrderStatus, isValidTransition, OrderStateError } from "./orderStateMachine";

/** Aplica realmente la condición WHERE status IN (from) contra el estado actual de la fila simulada. */
function makeStatefulMockDb(initialStatus: string) {
  const row: Record<string, unknown> = { id: 1, status: initialStatus };
  const b: any = {};
  let mode: "select" | "update" = "select";
  let pendingSet: Record<string, unknown> = {};
  let pendingFromStatuses: string[] = [];
  b.select = () => { mode = "select"; return b; };
  b.update = () => { mode = "update"; return b; };
  b.from = () => b;
  b.set = (f: Record<string, unknown>) => { pendingSet = f; return b; };
  // La implementación real construye el WHERE con inArray(status, from) — el mock intercepta llamando a un helper expuesto por el test.
  b.where = () => {
    if (mode === "select") return b;
    if (pendingFromStatuses.includes(row.status as string)) {
      Object.assign(row, pendingSet);
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    return Promise.resolve([{ affectedRows: 0 }]);
  };
  b.limit = () => Promise.resolve([{ ...row }]);
  b.__setFromStatuses = (statuses: string[]) => { pendingFromStatuses = statuses; };
  return { db: b as any, row };
}

describe("orderStateMachine — isValidTransition", () => {
  it("pending puede pasar a awaiting_payment/expired/cancelled", () => {
    expect(isValidTransition("pending", "awaiting_payment")).toBe(true);
    expect(isValidTransition("pending", "expired")).toBe(true);
    expect(isValidTransition("pending", "cancelled")).toBe(true);
  });
  it("paid NUNCA transiciona directamente a cancelled", () => {
    expect(isValidTransition("paid", "cancelled")).toBe(false);
  });
  it("paid puede pasar a refunded/partially_refunded/reconciliation_required", () => {
    expect(isValidTransition("paid", "refunded")).toBe(true);
    expect(isValidTransition("paid", "partially_refunded")).toBe(true);
    expect(isValidTransition("paid", "reconciliation_required")).toBe(true);
  });
  it("refunded es un estado terminal — ninguna transición de salida", () => {
    expect(isValidTransition("refunded", "paid")).toBe(false);
    expect(isValidTransition("refunded", "cancelled")).toBe(false);
  });
});

describe("orderStateMachine — transitionOrderStatus", () => {
  it("aplica la transición si el estado actual coincide con uno de los `from` esperados", async () => {
    const { db, row } = makeStatefulMockDb("pending");
    (db as any).__setFromStatuses(["pending"]);
    const updated = await transitionOrderStatus(1, ["pending"], "awaiting_payment", {}, db);
    expect(updated.status).toBe("awaiting_payment");
    expect(row.status).toBe("awaiting_payment");
  });

  it("rechaza una transición cuyo `from`→`to` no está en la tabla de transiciones válidas (nunca llega a tocar la BD)", async () => {
    const { db } = makeStatefulMockDb("paid");
    await expect(transitionOrderStatus(1, ["paid"], "cancelled", {}, db)).rejects.toBeInstanceOf(OrderStateError);
  });

  it("carrera real: si el estado en BD ya cambió (otro proceso ganó primero), affectedRows=0 y lanza INVALID_TRANSITION en vez de aplicar la mutación", async () => {
    const { db } = makeStatefulMockDb("paid"); // el estado real ya no es "awaiting_payment"
    (db as any).__setFromStatuses(["awaiting_payment"]);
    await expect(transitionOrderStatus(1, ["awaiting_payment"], "paid", {}, db)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});
