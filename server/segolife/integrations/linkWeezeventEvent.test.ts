/**
 * linkWeezeventEvent.test.ts — refactor de conexión Weezevent (cierre F71,
 * 2026-08-23). Cubre SOLO la lógica de negocio real de vincular un evento
 * (duplicados, conexión inexistente) — el resto de integrationsDb.ts
 * (CRUD simple de weezevent_connections) sigue el mismo criterio ya
 * establecido en este archivo de no testear setters de una línea
 * directamente (ver integrationsDb.test.ts: solo se prueba lock/cálculo
 * puro, nunca CRUD trivial).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSelectResults } = vi.hoisted(() => ({ mockSelectResults: { current: [] as unknown[][] } }));

function fakeDb() {
  let call = 0;
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(mockSelectResults.current[call++] ?? []),
  };
  return {
    select: () => chain,
    insert: () => ({
      values: () => Promise.resolve([{ insertId: 42 }]),
    }),
  } as never;
}

vi.mock("./integrationCredentialCrypto", () => ({
  encryptCredentials: (c: unknown) => JSON.stringify(c),
  decryptCredentials: (s: string | null) => (s ? JSON.parse(s) : null),
  last4: (v: string | undefined | null) => (v ? v.slice(-4) : null),
}));

import { linkWeezeventEvent, WeezeventLinkError } from "./integrationsDb";

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectResults.current = [];
});

describe("linkWeezeventEvent — restricciones de vinculación (cierre F71, punto 10)", () => {
  it("conexión inexistente → WeezeventLinkError CONNECTION_NOT_FOUND, nunca llega a comprobar duplicados", async () => {
    // getWeezeventConnectionRaw hace 1 select — vacío = conexión no encontrada.
    mockSelectResults.current = [[]];
    await expect(linkWeezeventEvent({ connectionId: 5, eventId: 10, providerId: 9, externalEventId: "wz_1" }, fakeDb()))
      .rejects.toThrow(WeezeventLinkError);
    await expect(linkWeezeventEvent({ connectionId: 5, eventId: 10, providerId: 9, externalEventId: "wz_1" }, fakeDb()))
      .rejects.toMatchObject({ code: "CONNECTION_NOT_FOUND" });
  });

  it("el mismo evento externo de Weezevent ya vinculado a OTRO evento Segolife → EXTERNAL_ALREADY_LINKED", async () => {
    mockSelectResults.current = [
      [{ id: 5, credentialsEncrypted: "blob" }], // getWeezeventConnectionRaw — conexión existe
      [{ id: 99 }], // dupExternal — YA hay una fila con este providerId+externalEventId
    ];
    await expect(linkWeezeventEvent({ connectionId: 5, eventId: 10, providerId: 9, externalEventId: "wz_1" }, fakeDb()))
      .rejects.toMatchObject({ code: "EXTERNAL_ALREADY_LINKED" });
  });

  it("el evento Segolife ya tiene una integración weezevent (aunque el externo sea distinto) → SEGOLIFE_EVENT_ALREADY_LINKED", async () => {
    mockSelectResults.current = [
      [{ id: 5, credentialsEncrypted: "blob" }], // conexión existe
      [], // sin duplicado externo
      [{ id: 77 }], // dupSegolife — ya existe vínculo para este eventId+providerId
    ];
    await expect(linkWeezeventEvent({ connectionId: 5, eventId: 10, providerId: 9, externalEventId: "wz_2" }, fakeDb()))
      .rejects.toMatchObject({ code: "SEGOLIFE_EVENT_ALREADY_LINKED" });
  });

  it("sin conflictos → crea el vínculo SIN credenciales propias (connectionId apunta a la conexión compartida)", async () => {
    mockSelectResults.current = [
      [{ id: 5, credentialsEncrypted: "blob" }], // conexión existe
      [], // sin duplicado externo
      [], // sin duplicado segolife
      [{ id: 42, eventId: 10, providerId: 9, connectionId: 5, externalEventId: "wz_3", externalEventName: "Fiesta", enabled: false, status: "configured", syncEnabled: false, loyaltyEnabled: false, lastSyncAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null }], // getEventIntegrationRaw tras insert
      [{ id: 9, key: "weezevent" }], // provider lookup
    ];
    const result = await linkWeezeventEvent({ connectionId: 5, eventId: 10, providerId: 9, externalEventId: "wz_3", externalEventName: "Fiesta" }, fakeDb());
    expect(result.connectionId).toBe(5);
    expect(result.externalEventId).toBe("wz_3");
    expect(result.externalEventName).toBe("Fiesta");
    expect(result.connectionCredentialsConfigured).toBe(true);
  });
});
