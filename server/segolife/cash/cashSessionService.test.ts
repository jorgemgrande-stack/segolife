/**
 * cashSessionService.test.ts — SEGOLIFE FASE 10 (spec §44-53/§110) +
 * FASE 10.7 "Venue Bar POS & Live Commerce Terminal" (spec §16). Cash vs
 * card vs SegoTokens (§O respuesta): SegoTokens NUNCA aportan al efectivo
 * esperado — propiedad de seguridad económica central de este módulo.
 * Fase 10.7 añade la distinción "card"/"mixed_card" (POS nativo ahora
 * registra honestamente cómo se cobró el dinero, ver nativeCommerceService.ts)
 * — tarjeta TAMPOCO cuenta como efectivo, se reporta aparte (salesCardCents).
 */
import { describe, it, expect, vi } from "vitest";
import { drizzleConditionMockFactory, MockTable, createMockDb } from "../_testHelpers/drizzleTableMock";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, ...drizzleConditionMockFactory() };
});

import {
  venues, commerceTransactions, ticketOrders, events, commerceRefunds, tokenSpendReservations,
  venueCashSessions, venueCashMovements,
} from "../../../drizzle/schema";
import { openCashSession, closeCashSession, recordCashMovement, computeSessionSummary, getOpenSession, resolvePaymentBreakdown } from "./cashSessionService";

function makeDb(config: {
  venuesRows?: Array<Record<string, unknown>>;
  sessions?: Array<Record<string, unknown>>;
  movements?: Array<Record<string, unknown>>;
  commerceTx?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  eventsRows?: Array<Record<string, unknown>>;
  refunds?: Array<Record<string, unknown>>;
  reservations?: Array<Record<string, unknown>>;
} = {}) {
  const tables = new Map<unknown, MockTable<Record<string, unknown>>>([
    [venues, new MockTable(venues as unknown as Record<string, unknown>, config.venuesRows ?? [{ id: 10, name: "Casanova" }])],
    [venueCashSessions, new MockTable(venueCashSessions as unknown as Record<string, unknown>, config.sessions ?? [])],
    [venueCashMovements, new MockTable(venueCashMovements as unknown as Record<string, unknown>, config.movements ?? [])],
    [commerceTransactions, new MockTable(commerceTransactions as unknown as Record<string, unknown>, config.commerceTx ?? [])],
    [ticketOrders, new MockTable(ticketOrders as unknown as Record<string, unknown>, config.orders ?? [])],
    [events, new MockTable(events as unknown as Record<string, unknown>, config.eventsRows ?? [{ id: 5, venueId: 10 }])],
    [commerceRefunds, new MockTable(commerceRefunds as unknown as Record<string, unknown>, config.refunds ?? [])],
    [tokenSpendReservations, new MockTable(tokenSpendReservations as unknown as Record<string, unknown>, config.reservations ?? [])],
  ]);
  const db = createMockDb(tables);
  return { db, sessionsTable: tables.get(venueCashSessions)!, movementsTable: tables.get(venueCashMovements)! };
}

describe("openCashSession — spec §45/§46", () => {
  it("#1 abre una sesión con el fondo de apertura indicado", async () => {
    const { db } = makeDb();
    const session = await openCashSession(10, 1, 5000, db);
    expect(session.status).toBe("open");
    expect(session.openingCashCents).toBe(5000);
  });

  it("#2 rechaza abrir una segunda sesión si ya hay una abierta en el mismo venue (spec, solo una a la vez)", async () => {
    const { db } = makeDb({ sessions: [{ id: 1, venueId: 10, status: "open", openedAt: new Date(), openingCashCents: 0 }] });
    await expect(openCashSession(10, 1, 5000, db)).rejects.toMatchObject({ code: "ALREADY_OPEN" });
  });

  it("#3 dos venues distintos pueden tener sesiones abiertas simultáneamente", async () => {
    const { db } = makeDb({ venuesRows: [{ id: 10, name: "A" }, { id: 20, name: "B" }] });
    await openCashSession(10, 1, 0, db);
    const session2 = await openCashSession(20, 1, 0, db);
    expect(session2.venueId).toBe(20);
  });
});

describe("computeSessionSummary — separación CASH/SEGOTOKENS (spec §47/§O CRÍTICO)", () => {
  it("#4 una venta pagada 100% con SegoTokens NO aporta nada al efectivo esperado", async () => {
    const session = { id: 1, venueId: 10, openedAt: new Date("2026-08-01T20:00:00Z"), closedAt: null, openingCashCents: 0 };
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, status: "confirmed", totalCents: 1000, paymentMethod: "segotokens", tokenReservationId: 500, occurredAt: new Date("2026-08-01T21:00:00Z") }],
    });
    const summary = await computeSessionSummary(session as never, db);
    expect(summary.salesCashCents).toBe(0);
    expect(summary.expectedCashCents).toBe(0);
  });

  it("#5 una venta 100% en efectivo aporta el total completo", async () => {
    const session = { id: 1, venueId: 10, openedAt: new Date("2026-08-01T20:00:00Z"), closedAt: null, openingCashCents: 0 };
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, status: "confirmed", totalCents: 1000, paymentMethod: "cash", tokenReservationId: null, occurredAt: new Date("2026-08-01T21:00:00Z") }],
    });
    const summary = await computeSessionSummary(session as never, db);
    expect(summary.salesCashCents).toBe(1000);
  });

  it("#6 una venta MIXTA (parte ST + parte dinero) solo aporta la porción de dinero (moneyDueCents)", async () => {
    const session = { id: 1, venueId: 10, openedAt: new Date("2026-08-01T20:00:00Z"), closedAt: null, openingCashCents: 0 };
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, status: "confirmed", totalCents: 1000, paymentMethod: "mixed", tokenReservationId: 500, occurredAt: new Date("2026-08-01T21:00:00Z") }],
      reservations: [{ id: 500, promotionalValueCents: 400, moneyDueCents: 600 }],
    });
    const summary = await computeSessionSummary(session as never, db);
    expect(summary.salesCashCents).toBe(600);
  });

  it("#7 el efectivo esperado combina apertura + ventas − reembolsos + entradas − salidas", async () => {
    const session = { id: 1, venueId: 10, openedAt: new Date("2026-08-01T20:00:00Z"), closedAt: null, openingCashCents: 10000 };
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, status: "confirmed", totalCents: 2000, paymentMethod: "cash", tokenReservationId: null, occurredAt: new Date("2026-08-01T21:00:00Z") }],
      refunds: [{ id: 1, sourceType: "commerce_transaction", sourceId: 1, venueId: 10, amountCents: 500, moneyRefundStatus: "completed", createdAt: new Date("2026-08-01T22:00:00Z") }],
      movements: [
        { id: 1, cashSessionId: 1, type: "cash_in", amountCents: 1000, reason: "cambio" },
        { id: 2, cashSessionId: 1, type: "cash_out", amountCents: 300, reason: "propina" },
      ],
    });
    const summary = await computeSessionSummary(session as never, db);
    // 10000 + 2000 - 500 + 1000 - 300 = 12200
    expect(summary.expectedCashCents).toBe(12200);
  });

  it("#8 una venta de OTRO venue nunca contamina el arqueo (IDOR de caja)", async () => {
    const session = { id: 1, venueId: 10, openedAt: new Date("2026-08-01T20:00:00Z"), closedAt: null, openingCashCents: 0 };
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 99, status: "confirmed", totalCents: 1000, paymentMethod: "cash", tokenReservationId: null, occurredAt: new Date("2026-08-01T21:00:00Z") }],
    });
    const summary = await computeSessionSummary(session as never, db);
    expect(summary.salesCashCents).toBe(0);
  });
});

// SEGOLIFE — VENUE BAR POS & LIVE COMMERCE TERMINAL (Fase 10.7, spec §16):
// el POS nativo ahora persiste honestamente "card"/"mixed_card" — el arqueo
// debe seguir excluyéndolos del efectivo esperado, igual que ya hacía con
// SegoTokens, y reportarlos aparte (salesCardCents).
describe("computeSessionSummary — separación CASH/CARD (Fase 10.7 spec §16)", () => {
  it("#15 una venta pagada 100% con TARJETA no aporta nada al efectivo, se reporta en salesCardCents", async () => {
    const session = { id: 1, venueId: 10, openedAt: new Date("2026-08-01T20:00:00Z"), closedAt: null, openingCashCents: 0 };
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, status: "confirmed", totalCents: 1800, paymentMethod: "card", tokenReservationId: null, occurredAt: new Date("2026-08-01T21:00:00Z") }],
    });
    const summary = await computeSessionSummary(session as never, db);
    expect(summary.salesCashCents).toBe(0);
    expect(summary.salesCardCents).toBe(1800);
    expect(summary.expectedCashCents).toBe(0);
  });

  it("#16 venta mixed_card (ST + tarjeta): la porción de dinero va a salesCardCents, nunca a salesCashCents", async () => {
    const session = { id: 1, venueId: 10, openedAt: new Date("2026-08-01T20:00:00Z"), closedAt: null, openingCashCents: 0 };
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, status: "confirmed", totalCents: 2000, paymentMethod: "mixed_card", tokenReservationId: 501, occurredAt: new Date("2026-08-01T21:00:00Z") }],
      reservations: [{ id: 501, promotionalValueCents: 600, moneyDueCents: 1400 }],
    });
    const summary = await computeSessionSummary(session as never, db);
    expect(summary.salesCashCents).toBe(0);
    expect(summary.salesCardCents).toBe(1400);
    expect(summary.salesTokensValueCents).toBe(600);
  });

  it("#17 venta mixed_cash (ST + efectivo): la porción de dinero va a salesCashCents, nunca a salesCardCents", async () => {
    const session = { id: 1, venueId: 10, openedAt: new Date("2026-08-01T20:00:00Z"), closedAt: null, openingCashCents: 0 };
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, status: "confirmed", totalCents: 2000, paymentMethod: "mixed_cash", tokenReservationId: 502, occurredAt: new Date("2026-08-01T21:00:00Z") }],
      reservations: [{ id: 502, promotionalValueCents: 600, moneyDueCents: 1400 }],
    });
    const summary = await computeSessionSummary(session as never, db);
    expect(summary.salesCashCents).toBe(1400);
    expect(summary.salesCardCents).toBe(0);
  });

  it("#18 salesTokensValueCents acumula el valor promocional de SegoTokens aplicado en la sesión (spec §16, informativo)", async () => {
    const session = { id: 1, venueId: 10, openedAt: new Date("2026-08-01T20:00:00Z"), closedAt: null, openingCashCents: 0 };
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, status: "confirmed", totalCents: 1000, paymentMethod: "segotokens", tokenReservationId: 503, occurredAt: new Date("2026-08-01T21:00:00Z") }],
      reservations: [{ id: 503, promotionalValueCents: 1000, moneyDueCents: 0 }],
    });
    const summary = await computeSessionSummary(session as never, db);
    expect(summary.salesTokensValueCents).toBe(1000);
  });

  it("#19 una venta de puerta legacy 'mixed' (sin distinción de tarjeta) sigue contando como efectivo — retrocompatibilidad", async () => {
    const session = { id: 1, venueId: 10, openedAt: new Date("2026-08-01T20:00:00Z"), closedAt: null, openingCashCents: 0 };
    const { db } = makeDb({
      commerceTx: [{ id: 1, venueId: 10, status: "confirmed", totalCents: 1000, paymentMethod: "mixed", tokenReservationId: 504, occurredAt: new Date("2026-08-01T21:00:00Z") }],
      reservations: [{ id: 504, promotionalValueCents: 400, moneyDueCents: 600 }],
    });
    const summary = await computeSessionSummary(session as never, db);
    expect(summary.salesCashCents).toBe(600);
    expect(summary.salesCardCents).toBe(0);
  });
});

describe("closeCashSession — spec §50", () => {
  it("#9 calcula la diferencia = contado − esperado", async () => {
    const { db, sessionsTable } = makeDb({ sessions: [{ id: 1, venueId: 10, status: "open", openedAt: new Date("2026-08-01T20:00:00Z"), openingCashCents: 5000 }] });
    const result = await closeCashSession(1, 2, 5200, null, db);
    expect(result.session.status).toBe("closed");
    expect(result.session.differenceCents).toBe(200); // 5200 contado - 5000 esperado (sin ventas)
    expect(sessionsTable.rows[0].status).toBe("closed");
  });

  it("#10 cerrar una sesión ya cerrada lanza ALREADY_CLOSED — nunca se puede recerrar (inmutabilidad)", async () => {
    const { db } = makeDb({ sessions: [{ id: 1, venueId: 10, status: "closed", openedAt: new Date(), openingCashCents: 0, closedAt: new Date() }] });
    await expect(closeCashSession(1, 2, 100, null, db)).rejects.toMatchObject({ code: "ALREADY_CLOSED" });
  });

  it("#11 tras cerrar, getOpenSession ya no la devuelve", async () => {
    const { db } = makeDb({ sessions: [{ id: 1, venueId: 10, status: "open", openedAt: new Date(), openingCashCents: 0 }] });
    await closeCashSession(1, 2, 0, null, db);
    expect(await getOpenSession(10, db)).toBeNull();
  });
});

describe("recordCashMovement — spec §49", () => {
  it("#12 exige motivo", async () => {
    const { db } = makeDb({ sessions: [{ id: 1, venueId: 10, status: "open", openedAt: new Date(), openingCashCents: 0 }] });
    await expect(recordCashMovement({ cashSessionId: 1, type: "cash_in", amountCents: 100, reason: "", actorUserId: 9 }, db))
      .rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });

  it("#13 rechaza registrar movimientos en una sesión ya cerrada", async () => {
    const { db } = makeDb({ sessions: [{ id: 1, venueId: 10, status: "closed", openedAt: new Date(), openingCashCents: 0 }] });
    await expect(recordCashMovement({ cashSessionId: 1, type: "cash_in", amountCents: 100, reason: "x", actorUserId: 9 }, db))
      .rejects.toMatchObject({ code: "SESSION_CLOSED" });
  });

  it("#14 registra correctamente un movimiento de salida", async () => {
    const { db, movementsTable } = makeDb({ sessions: [{ id: 1, venueId: 10, status: "open", openedAt: new Date(), openingCashCents: 0 }] });
    await recordCashMovement({ cashSessionId: 1, type: "cash_out", amountCents: 250, reason: "compra hielo", actorUserId: 9 }, db);
    expect(movementsTable.rows[0]).toMatchObject({ type: "cash_out", amountCents: 250, reason: "compra hielo" });
  });
});

// Unidad aislada de la función pura extraída (Fase 10.7) — complementa las
// pruebas de integración de arriba con casos borde exactos de clasificación.
describe("resolvePaymentBreakdown — unidad aislada (Fase 10.7)", () => {
  function mockConn(reservationRow: { moneyDueCents: number; promotionalValueCents: number } | null) {
    return {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(reservationRow ? [reservationRow] : []),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("paymentMethod=null (fila histórica) cuenta como efectivo, mismo criterio que 'cash'", async () => {
    const result = await resolvePaymentBreakdown(1000, null, null, mockConn(null));
    expect(result).toEqual({ cashCents: 1000, cardCents: 0, tokensValueCents: 0 });
  });

  it("paymentMethod='segotokens' sin reserva resoluble (defensivo): usa totalCents como valor de tokens, nunca lo cuenta como efectivo", async () => {
    const result = await resolvePaymentBreakdown(2000, "segotokens", null, mockConn(null));
    expect(result).toEqual({ cashCents: 0, cardCents: 0, tokensValueCents: 2000 });
  });
});
