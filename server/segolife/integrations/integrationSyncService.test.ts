/**
 * integrationSyncService.test.ts — kill switch (Fase 5, punto 36). Es LA
 * comprobación de seguridad más importante de todo el Integration Hub: en
 * una BD nueva, o con cualquiera de las 4 condiciones sin cumplir, ningún
 * sync debe poder ejecutarse — nunca repetir el problema de jobs legacy
 * arrancando solos (ver CLAUDE.md).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isExternalIntegrationsGloballyEnabled, canSync, classifyTicketsByOrder } from "./integrationSyncService";
import type { NormalizedTicket } from "./externalTicketingProvider";

const ORIGINAL_ENV = process.env.EXTERNAL_INTEGRATIONS_ENABLED;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.EXTERNAL_INTEGRATIONS_ENABLED;
  else process.env.EXTERNAL_INTEGRATIONS_ENABLED = ORIGINAL_ENV;
});

function baseIntegration(overrides: Partial<{ enabled: boolean; credentialsEncrypted: string | null; syncEnabled: boolean }> = {}) {
  return { enabled: true, credentialsEncrypted: "encrypted-blob", syncEnabled: true, ...overrides };
}

describe("kill switch — EXTERNAL_INTEGRATIONS_ENABLED", () => {
  it("sin la variable de entorno definida, está deshabilitado por defecto", () => {
    delete process.env.EXTERNAL_INTEGRATIONS_ENABLED;
    expect(isExternalIntegrationsGloballyEnabled()).toBe(false);
  });

  it("con la variable en cualquier valor distinto de 'true' literal, sigue deshabilitado", () => {
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "1";
    expect(isExternalIntegrationsGloballyEnabled()).toBe(false);
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "TRUE";
    expect(isExternalIntegrationsGloballyEnabled()).toBe(false);
  });

  it("solo con 'true' exacto se habilita globalmente", () => {
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "true";
    expect(isExternalIntegrationsGloballyEnabled()).toBe(true);
  });
});

describe("canSync — las 4 condiciones deben cumplirse TODAS", () => {
  beforeEach(() => {
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "true";
  });

  it("BD nueva (integración por defecto: enabled=false, sin credenciales, syncEnabled=false) → nunca sincroniza", () => {
    expect(canSync({ enabled: false, credentialsEncrypted: null, syncEnabled: false })).toBe(false);
  });

  it("global ON pero integration.enabled=false → no sincroniza", () => {
    expect(canSync(baseIntegration({ enabled: false }))).toBe(false);
  });

  it("global ON, enabled=true, pero sin credenciales → no sincroniza", () => {
    expect(canSync(baseIntegration({ credentialsEncrypted: null }))).toBe(false);
  });

  it("global ON, enabled=true, con credenciales, pero syncEnabled=false → no sincroniza", () => {
    expect(canSync(baseIntegration({ syncEnabled: false }))).toBe(false);
  });

  it("global OFF (aunque la fila cumpla las otras 3) → no sincroniza", () => {
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "false";
    expect(canSync(baseIntegration())).toBe(false);
  });

  it("las 4 condiciones cumplidas a la vez → sincroniza", () => {
    expect(canSync(baseIntegration())).toBe(true);
  });
});

function ticket(overrides: Partial<NormalizedTicket> = {}): NormalizedTicket {
  return {
    externalId: `tkt_${Math.random()}`,
    externalEventId: "evt_1",
    externalTicketTypeId: "rate_1",
    externalOrderId: "pay_1",
    participant: { email: null, phone: null, name: null },
    status: "issued",
    amountPaidCents: 1000,
    feesCents: 0,
    purchasedAt: null,
    ...overrides,
  };
}

describe("classifyTicketsByOrder — Paymentless Tickets & Admissions Hardening (spec 'ZERO SILENT DROP')", () => {
  it("caso mixto (pedido + paymentless): agrupa por payment_id y separa los tickets sin order, sin perder ninguno", () => {
    const tickets = [
      ticket({ externalId: "a", externalOrderId: "pay_1" }),
      ticket({ externalId: "b", externalOrderId: "pay_1" }), // mismo pedido que "a" — multi-ticket
      ticket({ externalId: "c", externalOrderId: "pay_2" }),
      ticket({ externalId: "d", externalOrderId: null }), // real: sin payment_id, perfil de puerta
      ticket({ externalId: "e", externalOrderId: null }),
    ];

    const { ticketsByOrder, paymentlessTickets } = classifyTicketsByOrder(tickets);

    expect(ticketsByOrder.size).toBe(2);
    expect(ticketsByOrder.get("pay_1")?.map(t => t.externalId)).toEqual(["a", "b"]);
    expect(ticketsByOrder.get("pay_2")?.map(t => t.externalId)).toEqual(["c"]);
    expect(paymentlessTickets.map(t => t.externalId)).toEqual(["d", "e"]);

    // Invariante central del hardening: ningún ticket se pierde, cada uno cae en EXACTAMENTE una categoría.
    const totalClassified = [...ticketsByOrder.values()].flat().length + paymentlessTickets.length;
    expect(totalClassified).toBe(tickets.length);
  });

  it("solo tickets con order (caso Fase D, todos los eventos de junio 2026 salvo el gap) → paymentlessTickets vacío", () => {
    const tickets = [ticket({ externalId: "a" }), ticket({ externalId: "b", externalOrderId: "pay_2" })];
    const { ticketsByOrder, paymentlessTickets } = classifyTicketsByOrder(tickets);
    expect(paymentlessTickets).toHaveLength(0);
    expect(ticketsByOrder.size).toBe(2);
  });

  it("solo tickets paymentless (caso extremo hipotético) → ticketsByOrder vacío, ninguno se descarta", () => {
    const tickets = [ticket({ externalId: "a", externalOrderId: null }), ticket({ externalId: "b", externalOrderId: null })];
    const { ticketsByOrder, paymentlessTickets } = classifyTicketsByOrder(tickets);
    expect(ticketsByOrder.size).toBe(0);
    expect(paymentlessTickets).toHaveLength(2);
  });

  it("lista vacía → ambas colecciones vacías, sin lanzar", () => {
    const { ticketsByOrder, paymentlessTickets } = classifyTicketsByOrder([]);
    expect(ticketsByOrder.size).toBe(0);
    expect(paymentlessTickets).toHaveLength(0);
  });
});
