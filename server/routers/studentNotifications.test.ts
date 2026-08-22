/**
 * studentNotifications.test.ts — F67 (Push + WhatsApp). Cubre solo los 4
 * procedures nuevos de suscripción push (el resto del router — inbox,
 * preferencias — no tenía test dedicado antes de esta fase; no se hace
 * backfill aquí, fuera de alcance de F67). Autoservicio puro: el endpoint
 * SIEMPRE se ata a ctx.user.id, nunca a un userId del body.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSaveSubscription, mockRevokeSubscriptionForUser, mockHasActivePushSubscription } = vi.hoisted(() => ({
  mockSaveSubscription: vi.fn(),
  mockRevokeSubscriptionForUser: vi.fn(),
  mockHasActivePushSubscription: vi.fn(),
}));

vi.mock("../segolife/engagement/pushSubscriptionService", () => ({
  saveSubscription: mockSaveSubscription,
  revokeSubscriptionForUser: mockRevokeSubscriptionForUser,
  hasActivePushSubscription: mockHasActivePushSubscription,
}));

import { studentNotificationsRouter } from "./studentNotifications";

function callerAs(userId: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return studentNotificationsRouter.createCaller({ user: { id: userId, role: "user" } } as any);
}
function callerWithoutSession() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return studentNotificationsRouter.createCaller({ user: null } as any);
}

beforeEach(() => {
  mockSaveSubscription.mockReset().mockResolvedValue({ id: 1 });
  mockRevokeSubscriptionForUser.mockReset().mockResolvedValue(undefined);
  mockHasActivePushSubscription.mockReset().mockResolvedValue(false);
});

describe("studentNotifications router — suscripción push (F67)", () => {
  it("subscribePush/unsubscribePush/hasActivePushSubscription/pushPublicKey rechazan sin sesión", async () => {
    await expect(callerWithoutSession().subscribePush({ endpoint: "https://push.example/a", keys: {} })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().unsubscribePush({ endpoint: "https://push.example/a" })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().hasActivePushSubscription()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().pushPublicKey()).rejects.toThrow(/please login/i);
  });

  it("subscribePush SIEMPRE usa ctx.user.id, nunca un userId del body (el input no acepta ninguno)", async () => {
    await callerAs(42).subscribePush({ endpoint: "https://push.example/a", keys: { p256dh: "p", auth: "a" } });
    expect(mockSaveSubscription).toHaveBeenCalledWith({ userId: 42, endpoint: "https://push.example/a", keysP256dh: "p", keysAuth: "a" });
  });

  it("unsubscribePush revoca sobre ctx.user.id + el endpoint dado", async () => {
    await callerAs(42).unsubscribePush({ endpoint: "https://push.example/a" });
    expect(mockRevokeSubscriptionForUser).toHaveBeenCalledWith(42, "https://push.example/a");
  });

  it("hasActivePushSubscription delega en el servicio con el propio userId", async () => {
    mockHasActivePushSubscription.mockResolvedValue(true);
    const result = await callerAs(42).hasActivePushSubscription();
    expect(result).toBe(true);
    expect(mockHasActivePushSubscription).toHaveBeenCalledWith(42);
  });

  it("un endpoint que no es una URL válida se rechaza en el propio esquema Zod", async () => {
    await expect(callerAs(42).subscribePush({ endpoint: "not-a-url", keys: {} })).rejects.toThrow();
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });
});
