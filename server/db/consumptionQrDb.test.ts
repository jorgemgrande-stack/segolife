/**
 * consumptionQrDb.test.ts — F63 (QR de consumición 2.0), "GESTIÓN DE LOTES":
 * cubre únicamente getQrBatchSummary(), la única función de este archivo con
 * lógica de clasificación real (el resto son listados/joins directos ya
 * ejercitados indirectamente por consumptionQrService.test.ts y los routers).
 * La reclasificación perezosa 'issued'+expiresAt pasado→'expired' replica a
 * propósito la misma lectura que hace redeemConsumptionQr, pero aquí NUNCA
 * escribe — es un resumen de solo lectura para la pantalla de gestión.
 */
import { describe, it, expect } from "vitest";
import { getQrBatchSummary } from "./consumptionQrDb";

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return { status: "issued", expiresAt: null, assignedUserId: null, ...overrides };
}

function makeDb(rows: Array<Record<string, unknown>>) {
  const db: Record<string, unknown> = {
    select: () => db,
    from: () => db,
    where: () => Promise.resolve(rows),
  };
  return db as unknown as Parameters<typeof getQrBatchSummary>[1];
}

describe("consumptionQrDb — getQrBatchSummary (F63)", () => {
  it("clasifica cada estado real sin solaparse", async () => {
    const summary = await getQrBatchSummary(1, makeDb([
      row({ status: "redeemed" }),
      row({ status: "cancelled" }),
      row({ status: "expired" }),
      row({ status: "issued" }), // pendiente, sin asignar, sin caducar
    ]));
    expect(summary).toEqual({ total: 4, pending: 1, assigned: 0, redeemed: 1, expired: 1, cancelled: 1 });
  });

  it("un 'issued' con expiresAt ya pasado cuenta como expired aunque la fila no se haya reescrito todavía", async () => {
    const summary = await getQrBatchSummary(1, makeDb([
      row({ status: "issued", expiresAt: new Date("2020-01-01") }),
    ]));
    expect(summary.expired).toBe(1);
    expect(summary.pending).toBe(0);
  });

  it("un 'issued' asignado a un estudiante y todavía sin caducar cuenta como assigned, no pending", async () => {
    const summary = await getQrBatchSummary(1, makeDb([
      row({ status: "issued", assignedUserId: 42 }),
    ]));
    expect(summary.assigned).toBe(1);
    expect(summary.pending).toBe(0);
  });

  it("un 'issued' asignado PERO ya caducado cuenta como expired, no como assigned (la caducidad manda)", async () => {
    const summary = await getQrBatchSummary(1, makeDb([
      row({ status: "issued", assignedUserId: 42, expiresAt: new Date("2020-01-01") }),
    ]));
    expect(summary.expired).toBe(1);
    expect(summary.assigned).toBe(0);
  });

  it("lote vacío devuelve todos los contadores en 0", async () => {
    const summary = await getQrBatchSummary(1, makeDb([]));
    expect(summary).toEqual({ total: 0, pending: 0, assigned: 0, redeemed: 0, expired: 0, cancelled: 0 });
  });
});
