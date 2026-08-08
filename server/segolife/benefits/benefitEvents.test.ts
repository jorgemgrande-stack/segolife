/**
 * benefitEvents.test.ts — mecánica del emisor `BenefitGranted` (revisión de
 * seguridad de cierre de Fase 4): aislamiento de listeners que fallan, y
 * pureza del payload construido por `buildBenefitGrantedPayload` (nunca
 * incluye qrToken/qrTokenHash aunque se le pase una fila que sí los tiene).
 */
import { describe, it, expect, vi } from "vitest";
import { benefitEvents, emitBenefitGranted, buildBenefitGrantedPayload, type BenefitGrantedPayload } from "./benefitEvents";

function fullBenefitRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, userId: 42, benefitDefinitionId: 7, communityId: 2,
    sourceType: "consumption", sourceId: 99, sourceVenueId: 10,
    grantedAt: new Date("2026-06-12T22:00:00Z"),
    validFrom: new Date("2026-06-13T00:00:00Z"), validUntil: new Date("2026-06-13T01:00:00Z"),
    // Campos sensibles que NUNCA deben acabar en el payload del evento:
    qrToken: "super-secret-plaintext-token",
    qrTokenHash: "sha256-hash-of-token",
    ...overrides,
  };
}

describe("buildBenefitGrantedPayload — pureza del payload", () => {
  it("nunca incluye qrToken ni qrTokenHash aunque la fila origen los tenga", () => {
    const payload = buildBenefitGrantedPayload(fullBenefitRow(), { destinationVenueId: 20, destinationEventId: null });
    expect(payload).not.toHaveProperty("qrToken");
    expect(payload).not.toHaveProperty("qrTokenHash");
    expect(JSON.stringify(payload)).not.toContain("super-secret-plaintext-token");
    expect(JSON.stringify(payload)).not.toContain("sha256-hash-of-token");
  });

  it("incluye exactamente los campos mínimos pedidos", () => {
    const payload = buildBenefitGrantedPayload(fullBenefitRow(), { destinationVenueId: 20, destinationEventId: 5 });
    const expectedKeys: Array<keyof BenefitGrantedPayload> = [
      "userId", "userBenefitId", "benefitDefinitionId", "communityId", "sourceType", "sourceId",
      "sourceVenueId", "destinationVenueId", "destinationEventId", "grantedAt", "validFrom", "validUntil",
    ];
    expect(Object.keys(payload).sort()).toEqual([...expectedKeys].sort());
    expect(payload.userBenefitId).toBe(1);
    expect(payload.destinationVenueId).toBe(20);
    expect(payload.destinationEventId).toBe(5);
  });
});

describe("benefitEvents — emisión best-effort, aislada por listener", () => {
  it("un listener registrado recibe exactamente el payload emitido, una vez por emisión", async () => {
    const received: BenefitGrantedPayload[] = [];
    const listener = (p: BenefitGrantedPayload) => { received.push(p); };
    benefitEvents.onTyped("BenefitGranted", listener);

    const payload = buildBenefitGrantedPayload(fullBenefitRow({ id: 555 }), { destinationVenueId: null, destinationEventId: null });
    emitBenefitGranted(payload);
    await new Promise(resolve => setImmediate(resolve)); // el listener corre en su propio microtask

    expect(received).toHaveLength(1);
    expect(received[0].userBenefitId).toBe(555);

    benefitEvents.removeListener("BenefitGranted", listener);
  });

  it("emitBenefitGranted NUNCA lanza ni siquiera si el listener falla de forma síncrona", async () => {
    const throwingListener = () => { throw new Error("listener roto"); };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    benefitEvents.onTyped("BenefitGranted", throwingListener);

    expect(() => emitBenefitGranted(buildBenefitGrantedPayload(fullBenefitRow(), { destinationVenueId: null, destinationEventId: null })))
      .not.toThrow();
    await new Promise(resolve => setImmediate(resolve));

    benefitEvents.removeListener("BenefitGranted", throwingListener);
    errorSpy.mockRestore();
  });

  it("emitBenefitGranted NUNCA lanza si el listener devuelve una promesa rechazada", async () => {
    const rejectingListener = async () => { throw new Error("listener async roto"); };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    benefitEvents.onTyped("BenefitGranted", rejectingListener);

    expect(() => emitBenefitGranted(buildBenefitGrantedPayload(fullBenefitRow(), { destinationVenueId: null, destinationEventId: null })))
      .not.toThrow();
    await new Promise(resolve => setImmediate(resolve));

    expect(errorSpy).toHaveBeenCalled(); // el fallo se registra en consola, no se silencia del todo
    benefitEvents.removeListener("BenefitGranted", rejectingListener);
    errorSpy.mockRestore();
  });

  it("un listener que falla NO impide que otros listeners reciban el mismo evento", async () => {
    const received: string[] = [];
    const brokenListener = () => { throw new Error("roto"); };
    const healthyListener = () => { received.push("ok"); };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    benefitEvents.onTyped("BenefitGranted", brokenListener);
    benefitEvents.onTyped("BenefitGranted", healthyListener);
    emitBenefitGranted(buildBenefitGrantedPayload(fullBenefitRow(), { destinationVenueId: null, destinationEventId: null }));
    await new Promise(resolve => setImmediate(resolve));

    expect(received).toEqual(["ok"]);
    benefitEvents.removeListener("BenefitGranted", brokenListener);
    benefitEvents.removeListener("BenefitGranted", healthyListener);
    errorSpy.mockRestore();
  });
});
