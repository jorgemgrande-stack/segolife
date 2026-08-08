/**
 * benefitGrantedListener.test.ts — primera automatización real del
 * Engagement Core (spec puntos 4, 27). Se mockea `drizzle-orm/mysql2` +
 * `mysql2/promise` para poder inyectar un `_db` controlable (este listener,
 * a diferencia de los *Service.ts, no acepta un `db` explícito porque solo
 * lo invoca `benefitEvents` — nunca un router ni un test de integración
 * directa) y `./notificationService` para aislar SOLO la lógica propia del
 * listener (idempotencyKey, deep link, resolución de nombre EN/ES, early
 * return si la definición ya no existe). El flujo real end-to-end
 * (evento → BD real → inbox del estudiante) ya se verificó manualmente
 * contra MySQL en desarrollo — ver informe de cierre de Fase 7.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateNotification, tableRows, callState } = vi.hoisted(() => ({
  mockCreateNotification: vi.fn(),
  tableRows: { definitions: [] as any[], communities: [] as any[] },
  callState: { fromCallCount: 0 },
}));

vi.mock("./notificationService", () => ({ createNotification: mockCreateNotification }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({}) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  // handleBenefitGrantedForEngagement siempre consulta benefit_definitions
  // PRIMERO y, solo si hay communityId, communities DESPUÉS — nunca al
  // revés ni en paralelo — así que un contador de llamadas a .from() basta
  // para distinguir ambas consultas sin depender de internals de Drizzle.
  // El contador vive en `callState` (fuera de esta factory, que Drizzle solo
  // invoca UNA VEZ al cargar el módulo) para poder resetearlo en beforeEach.
  drizzle: () => {
    const b: any = {};
    b.select = () => b;
    b.from = () => { callState.fromCallCount++; return b; };
    b.where = () => b;
    b.limit = () => Promise.resolve(callState.fromCallCount === 1 ? tableRows.definitions : tableRows.communities);
    return b;
  },
}));

import { handleBenefitGrantedForEngagement } from "./benefitGrantedListener";
import type { BenefitGrantedPayload } from "../benefits/benefitEvents";

function payload(overrides: Partial<BenefitGrantedPayload> = {}): BenefitGrantedPayload {
  return {
    userId: 42, userBenefitId: 100, benefitDefinitionId: 1, communityId: 1,
    sourceType: "manual", sourceId: null, sourceVenueId: null, destinationVenueId: null, destinationEventId: null,
    grantedAt: new Date(), validFrom: new Date(), validUntil: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockCreateNotification.mockReset();
  callState.fromCallCount = 0;
  tableRows.definitions = [{ id: 1, name: "Free Entry Tomorrow", nameEn: "Free Entry Tomorrow", nameEs: "Entrada gratis mañana" }];
  tableRows.communities = [{ id: 1, slug: "ie" }];
});

describe("benefitGrantedListener — handleBenefitGrantedForEngagement", () => {
  it("crea una notificación transactional con idempotencyKey benefit_granted:<userBenefitId>", async () => {
    await handleBenefitGrantedForEngagement(payload());
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const input = mockCreateNotification.mock.calls[0][0];
    expect(input.idempotencyKey).toBe("benefit_granted:100");
    expect(input.audienceType).toBe("transactional");
    expect(input.category).toBe("benefits");
    expect(input.type).toBe("benefit_granted");
  });

  it("construye el deep link con el slug real de la comunidad", async () => {
    await handleBenefitGrantedForEngagement(payload({ communityId: 1 }));
    const input = mockCreateNotification.mock.calls[0][0];
    expect(input.rendered.deepLink).toBe("/ie/benefits/100");
  });

  it("usa el nombre EN/ES real del beneficio en el cuerpo del mensaje", async () => {
    await handleBenefitGrantedForEngagement(payload());
    const input = mockCreateNotification.mock.calls[0][0];
    expect(input.rendered.titleEn).toBe("You unlocked a benefit");
    expect(input.rendered.bodyEn).toBe("Free Entry Tomorrow");
    expect(input.rendered.bodyEs).toBe("Entrada gratis mañana");
  });

  it("sin comunidad (communityId null) no genera deep link", async () => {
    await handleBenefitGrantedForEngagement(payload({ communityId: null }));
    const input = mockCreateNotification.mock.calls[0][0];
    expect(input.rendered.deepLink).toBeNull();
  });

  it("si la definición del beneficio ya no existe, no crea ninguna notificación (caso extremo, no lanza)", async () => {
    tableRows.definitions = [];
    await expect(handleBenefitGrantedForEngagement(payload())).resolves.toBeUndefined();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});
