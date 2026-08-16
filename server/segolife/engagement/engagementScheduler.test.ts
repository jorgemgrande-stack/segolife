/**
 * engagementScheduler.test.ts — PRE-16 overnight hardening (bug real
 * encontrado en auditoría): processPendingDelivery() no reclamaba
 * atómicamente una fila `pending` antes de enviarla — dos ticks solapados
 * (mismo proceso si un tick tarda >60s bajo latencia real de Brevo, o 2+
 * instancias si el servicio escala horizontalmente) podían leer la MISMA
 * fila `pending` y enviarla dos veces de verdad. Este archivo prueba
 * exclusivamente la reclamación atómica (reutiliza `attempt_count` como
 * token de reclamación, sin añadir ningún estado/columna nueva) — no
 * reimplementa las pruebas de idioma/plantilla ya cubiertas en otros
 * archivos (communicationLocale.test.ts, etc).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetProvider, mockResolveCommunicationLocale, mockResolveSenderIdentity } = vi.hoisted(() => ({
  mockGetProvider: vi.fn(),
  mockResolveCommunicationLocale: vi.fn(),
  mockResolveSenderIdentity: vi.fn(),
}));
vi.mock("./providers/providerRegistry", () => ({ getProvider: mockGetProvider }));
vi.mock("./communicationLocale", () => ({
  resolveCommunicationLocale: mockResolveCommunicationLocale,
  pickByLocale: (_locale: unknown, en: unknown) => en,
}));
vi.mock("./notificationService", () => ({ resolveSenderIdentity: mockResolveSenderIdentity }));
vi.mock("./campaignService", () => ({ sendCampaignNow: vi.fn() }));

import { processPendingDelivery } from "./engagementScheduler";
import { notificationDeliveries, notifications, users } from "../../../drizzle/schema";

function deliveryFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, notificationId: 10, channel: "email", status: "pending", attemptCount: 0, maxAttempts: 3, scheduledAt: new Date(), sentAt: null, ...overrides };
}
function notificationFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 10, userId: 42, communityId: 1, titleEn: "Hi", titleEs: "Hola", bodyEn: "Body", bodyEs: "Cuerpo", metadata: {}, deepLink: null, imageUrl: null, ...overrides };
}

/**
 * Misma técnica de simulación de concurrencia ya establecida en
 * tokenLedgerService.test.ts: encadena cada `.update()` "de reclamación"
 * tras el anterior — la 2ª llamada solo aplica su condición WHERE una vez
 * la 1ª ya ha actualizado la fila, exactamente lo que un UPDATE real de
 * MySQL (serializado por fila) garantiza.
 */
function makeSchedulerDb(config: { delivery: Record<string, unknown>; sendResult?: { status: string; error?: string; externalMessageId?: string } }) {
  let delivery = { ...config.delivery };
  let lockChain: Promise<unknown> = Promise.resolve();
  const sendCalls: unknown[] = [];

  function makeBuilder() {
    let mode: "select" | "update" = "select";
    let table: unknown = null;
    let updateValues: Record<string, unknown> | null = null;
    const b: any = {};
    b.select = () => { mode = "select"; return b; };
    b.from = (t: unknown) => { table = t; return b; };
    b.update = (t: unknown) => { mode = "update"; table = t; return b; };
    b.set = (v: Record<string, unknown>) => { updateValues = v; return b; };
    b.limit = () => b;
    b.where = () => {
      if (mode === "update" && table === notificationDeliveries) {
        // Simula `WHERE id=? AND status='pending' AND attempt_count=?`: solo
        // "gana" si el attemptCount actual de la fila coincide con el que
        // esta llamada esperaba capturar en el momento de leer `delivery`.
        const isClaim = updateValues && typeof updateValues.attemptCount === "number" && !("status" in updateValues);
        if (isClaim) {
          // El código real siempre hace `set({ attemptCount: delivery.attemptCount + 1 })`
          // — de ahí se deduce qué attemptCount creía tener esta llamada ANTES
          // de reclamar, y se compara contra el estado REAL simulado en `delivery`
          // (lo mismo que `WHERE attempt_count = ?` haría en MySQL real).
          const callerBelievedCurrentAttemptCount = (updateValues.attemptCount as number) - 1;
          if (delivery.status === "pending" && delivery.attemptCount === callerBelievedCurrentAttemptCount) {
            delivery = { ...delivery, ...updateValues };
            return Promise.resolve([{ affectedRows: 1 }]);
          }
          return Promise.resolve([{ affectedRows: 0 }]);
        }
        delivery = { ...delivery, ...updateValues };
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return b;
    };
    b.then = (resolve: (v: unknown) => void) => {
      if (table === notifications) return resolve([notificationFixture()]);
      if (table === users) return resolve([{ email: "student@example.invalid", phone: null }]);
      return resolve([]);
    };
    return b;
  }

  const db: any = {
    select: (...args: unknown[]) => makeBuilder().select(...(args as [])),
    update: (t: unknown) => {
      // La reclamación en sí (el primer UPDATE de cada llamada) debe
      // serializarse entre llamadas concurrentes — el resto de selects/updates
      // de una misma llamada no necesitan pasar por la cola.
      const b = makeBuilder();
      const originalWhere = b.where;
      let claimed: Promise<unknown> | null = null;
      b.where = (...args: unknown[]) => {
        if (claimed) return claimed;
        const run = lockChain.then(() => originalWhere(...(args as [])));
        lockChain = run.catch(() => {});
        claimed = run;
        return run;
      };
      return b.update(t);
    },
  };
  return { db: db as any, getDelivery: () => delivery, sendCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveCommunicationLocale.mockResolvedValue("es");
  mockResolveSenderIdentity.mockReturnValue({ name: "SEGOLIFE" });
});

describe("processPendingDelivery — reclamación atómica (Pre-16 gate de fiabilidad)", () => {
  it("reclama con éxito una entrega genuinamente 'pending' y envía UNA vez", async () => {
    const send = vi.fn().mockResolvedValue({ status: "sent" });
    mockGetProvider.mockReturnValue({ capabilities: { configured: true }, send });
    const { db } = makeSchedulerDb({ delivery: deliveryFixture() });

    await processPendingDelivery(deliveryFixture() as never, db);

    expect(send).toHaveBeenCalledOnce();
  });

  it("si otra reclamación ya avanzó attempt_count (otro tick/instancia ya se lo llevó), NO reenvía", async () => {
    const send = vi.fn().mockResolvedValue({ status: "sent" });
    mockGetProvider.mockReturnValue({ capabilities: { configured: true }, send });
    // La fila real en BD ya tiene attemptCount=1 (otro proceso ya la reclamó
    // y la está procesando/procesó) — esta llamada trae una copia STALE con
    // attemptCount=0, exactamente el escenario de una fila leída por un tick
    // que tardó más que el siguiente.
    const { db } = makeSchedulerDb({ delivery: deliveryFixture({ attemptCount: 1 }) });

    await processPendingDelivery(deliveryFixture({ attemptCount: 0 }) as never, db);

    expect(send).not.toHaveBeenCalled();
  });

  it("dos llamadas CONCURRENTES para la MISMA entrega (dos ticks solapados/dos instancias): la reclamación atómica serializa — exactamente UN envío real, nunca dos", async () => {
    const send = vi.fn().mockResolvedValue({ status: "sent" });
    mockGetProvider.mockReturnValue({ capabilities: { configured: true }, send });
    const { db } = makeSchedulerDb({ delivery: deliveryFixture() });

    await Promise.allSettled([
      processPendingDelivery(deliveryFixture() as never, db),
      processPendingDelivery(deliveryFixture() as never, db),
    ]);

    expect(send).toHaveBeenCalledOnce();
  });

  it("max_attempts ya alcanzado: nunca reclama, nunca envía, marca 'failed' directamente", async () => {
    const send = vi.fn();
    mockGetProvider.mockReturnValue({ capabilities: { configured: true }, send });
    const { db, getDelivery } = makeSchedulerDb({ delivery: deliveryFixture({ attemptCount: 3, maxAttempts: 3 }) });

    await processPendingDelivery(deliveryFixture({ attemptCount: 3, maxAttempts: 3 }) as never, db);

    expect(send).not.toHaveBeenCalled();
    expect(getDelivery().status).toBe("failed");
  });
});
