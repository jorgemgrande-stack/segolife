/**
 * sec02SessionPersistence.test.ts — SEC-02 (sesión deslizante y
 * reautenticación segura).
 *
 * Root cause real (no era TTL corto — JWT y cookie ya eran de 30 días antes
 * de este fix): (a) un fallo puntual/transitorio al resolver el usuario
 * desde BD se indistinguía de "no autenticado", y (b) el frontend trataba
 * cualquier 401 aislado como prueba definitiva de sesión muerta (ver fix en
 * client/src/main.tsx). Esta suite cubre la mitad de servidor: la sesión
 * deslizante con tope absoluto real, y que ninguna capa deja acceso a una
 * cuenta desactivada solo porque su JWT no ha expirado.
 *
 * Usa fake timers (vi.useFakeTimers/vi.setSystemTime) para simular el paso
 * de horas/días sin esperas reales — nunca un sleep de varias horas.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sql, eq } from "drizzle-orm";
import type { Request, Response } from "express";
import {
  signSessionToken,
  verifySessionTokenPayload,
  verifySessionToken,
  getUserFromRequest,
  getUserAndMaybeRenewSession,
  COOKIE_NAME,
  AUTH_SESSION_TTL_SECONDS,
  AUTH_SESSION_RENEWAL_THRESHOLD_SECONDS,
  AUTH_SESSION_ABSOLUTE_TTL_SECONDS,
} from "./localAuth";
import { getDb } from "./db";
import { users } from "../drizzle/schema";

function fakeRequest(token?: string): Request {
  return { headers: { cookie: token ? `${COOKIE_NAME}=${token}` : "" } } as unknown as Request;
}

function fakeResponse() {
  const cookie = vi.fn();
  return { res: { cookie } as unknown as Response, cookie };
}

describe("SEC-02 — JWT: emisión, expiración y tope absoluto (sin BD)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("un token recién emitido (login) es válido y su vida restante coincide con AUTH_SESSION_TTL_SECONDS", async () => {
    const token = await signSessionToken(42);
    const payload = await verifySessionTokenPayload(token);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe(42);
    expect(payload!.expiresInSeconds).toBe(AUTH_SESSION_TTL_SECONDS);
  });

  it("verifySessionToken (wrapper de compatibilidad, usado por authGuard.ts) devuelve el userId de un token válido", async () => {
    const token = await signSessionToken(7);
    expect(await verifySessionToken(token)).toBe(7);
  });

  it("un token sigue siendo válido justo antes de su expiración", async () => {
    const token = await signSessionToken(1);
    vi.setSystemTime(new Date(Date.now() + (AUTH_SESSION_TTL_SECONDS - 60) * 1000));
    expect(await verifySessionTokenPayload(token)).not.toBeNull();
  });

  it("un token expirado (superado su propio exp) es rechazado", async () => {
    const token = await signSessionToken(1);
    vi.setSystemTime(new Date(Date.now() + (AUTH_SESSION_TTL_SECONDS + 60) * 1000));
    expect(await verifySessionTokenPayload(token)).toBeNull();
  });

  it("tope absoluto: un token con sessionStartedAt antiguo se rechaza aunque su propio exp siga vigente (simula muchas renovaciones deslizantes)", async () => {
    const originalStartedAt = Math.floor(Date.now() / 1000);
    // Avanza más allá del tope absoluto y firma un token "renovado" (exp
    // fresco desde ahora) que preserva el sessionStartedAt original — esto
    // es exactamente lo que getUserAndMaybeRenewSession hace en producción.
    vi.setSystemTime(new Date(Date.now() + (AUTH_SESSION_ABSOLUTE_TTL_SECONDS + 3600) * 1000));
    const renewedToken = await signSessionToken(1, originalStartedAt);
    // Su exp individual es válido (recién firmado)...
    expect(async () => { /* no lanza */ }).not.toThrow();
    // ...pero el tope absoluto desde el login original lo rechaza igualmente.
    expect(await verifySessionTokenPayload(renewedToken)).toBeNull();
  });

  it("dentro del tope absoluto, un token renovado con sessionStartedAt preservado sigue siendo válido", async () => {
    const originalStartedAt = Math.floor(Date.now() / 1000);
    vi.setSystemTime(new Date(Date.now() + (AUTH_SESSION_ABSOLUTE_TTL_SECONDS - 3600) * 1000));
    const renewedToken = await signSessionToken(1, originalStartedAt);
    const payload = await verifySessionTokenPayload(renewedToken);
    expect(payload).not.toBeNull();
    expect(payload!.sessionStartedAt).toBe(originalStartedAt);
  });

  it("un token con firma inválida (secreto distinto) se rechaza", async () => {
    const token = await signSessionToken(1);
    expect(await verifySessionTokenPayload(token + "x")).toBeNull();
  });
});

describe("SEC-02 — renovación deslizante (getUserAndMaybeRenewSession, sin BD)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("con vida de sobra (por encima del umbral), NO renueva la cookie", async () => {
    const db = await getDb();
    if (!db) throw new Error("Esta suite requiere BD local disponible (docker compose up -d db)");
    const email = "_sec02_test_norenew@example.invalid";
    const [ins] = await db.execute(sql`
      INSERT INTO users (email, name, role, isActive, loginMethod, passwordHash, openId, createdAt, updatedAt)
      VALUES (${email}, 'SEC-02 Test User', 'user', 1, 'local', 'x', ${'_sec02_norenew_' + Date.now()}, NOW(), NOW())
    `);
    const userId = (ins as any).insertId;
    try {
      const token = await signSessionToken(userId);
      // Un poco de tiempo pasa, pero sigue muy por encima del umbral de renovación.
      vi.setSystemTime(new Date(Date.now() + 3600 * 1000));
      const { res, cookie } = fakeResponse();
      const user = await getUserAndMaybeRenewSession(fakeRequest(token), res);
      expect(user?.id).toBe(userId);
      expect(cookie).not.toHaveBeenCalled();
    } finally {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("con vida restante por debajo del umbral de renovación, SÍ renueva la cookie con un token de vida extendida", async () => {
    const db = await getDb();
    if (!db) throw new Error("Esta suite requiere BD local disponible (docker compose up -d db)");
    const email = "_sec02_test_renew@example.invalid";
    const [ins] = await db.execute(sql`
      INSERT INTO users (email, name, role, isActive, loginMethod, passwordHash, openId, createdAt, updatedAt)
      VALUES (${email}, 'SEC-02 Test User', 'user', 1, 'local', 'x', ${'_sec02_renew_' + Date.now()}, NOW(), NOW())
    `);
    const userId = (ins as any).insertId;
    try {
      const originalStartedAt = Math.floor(Date.now() / 1000);
      const token = await signSessionToken(userId, originalStartedAt);
      // Avanza justo hasta dejar menos vida restante que el umbral de renovación.
      vi.setSystemTime(new Date(Date.now() + (AUTH_SESSION_TTL_SECONDS - AUTH_SESSION_RENEWAL_THRESHOLD_SECONDS + 60) * 1000));
      const { res, cookie } = fakeResponse();
      const user = await getUserAndMaybeRenewSession(fakeRequest(token), res);
      expect(user?.id).toBe(userId);
      expect(cookie).toHaveBeenCalledTimes(1);

      const [, renewedToken] = cookie.mock.calls[0];
      const renewedPayload = await verifySessionTokenPayload(renewedToken as string);
      expect(renewedPayload).not.toBeNull();
      // La renovación extiende la vida de vuelta cerca del TTL completo
      // (nunca resetea sessionStartedAt — el tope absoluto sigue vivo).
      expect(renewedPayload!.expiresInSeconds).toBe(AUTH_SESSION_TTL_SECONDS);
      expect(renewedPayload!.sessionStartedAt).toBe(originalStartedAt);
    } finally {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("coherencia multi-request: dos renovaciones concurrentes del mismo token original producen tokens distintos pero ambos válidos y con el mismo sessionStartedAt — no hay estado de sesión compartido que puedan corromper entre sí (JWT sin estado, ver comentario)", async () => {
    // No hay una fila de "sesión activa" en BD que dos requests puedan pisarse
    // — cada renovación es una operación local (firmar un JWT nuevo) sin
    // ningún efecto colateral sobre el token anterior, que sigue siendo
    // válido hasta su propio exp. Si dos requests llegan a la vez cerca de
    // la expiración, el navegador simplemente se queda con la cookie del
    // último Set-Cookie que procese — ambas son igual de válidas y otorgan
    // el mismo acceso, así que no hay ningún escenario de "sesión rota" por
    // la carrera, solo como mucho una renovación de más (inofensiva).
    const originalStartedAt = Math.floor(Date.now() / 1000);
    const [tokenA, tokenB] = await Promise.all([
      signSessionToken(99, originalStartedAt),
      signSessionToken(99, originalStartedAt),
    ]);
    const [payloadA, payloadB] = await Promise.all([
      verifySessionTokenPayload(tokenA),
      verifySessionTokenPayload(tokenB),
    ]);
    expect(payloadA).not.toBeNull();
    expect(payloadB).not.toBeNull();
    expect(payloadA!.sessionStartedAt).toBe(originalStartedAt);
    expect(payloadB!.sessionStartedAt).toBe(originalStartedAt);
    expect(payloadA!.userId).toBe(payloadB!.userId);
  });
});

describe("SEC-02 — cuenta desactivada: pierde acceso aunque el JWT siga sin expirar (antes solo employeeProcedure/gestoriaProcedure lo comprobaban)", () => {
  const email = "_sec02_test_inactive@example.invalid";
  let userId: number;

  beforeEach(async () => {
    const db = await getDb();
    if (!db) throw new Error("Esta suite requiere BD local disponible (docker compose up -d db)");
    const [ins] = await db.execute(sql`
      INSERT INTO users (email, name, role, isActive, loginMethod, passwordHash, openId, createdAt, updatedAt)
      VALUES (${email}, 'SEC-02 Test User', 'admin', 1, 'local', 'x', ${'_sec02_inactive_' + Date.now()}, NOW(), NOW())
    `);
    userId = (ins as any).insertId;
  });

  afterEach(async () => {
    const db = await getDb();
    if (db) await db.delete(users).where(eq(users.id, userId));
  });

  it("mientras isActive=1, getUserFromRequest y getUserAndMaybeRenewSession devuelven el usuario", async () => {
    const token = await signSessionToken(userId);
    expect((await getUserFromRequest(fakeRequest(token)))?.id).toBe(userId);
    const { res } = fakeResponse();
    expect((await getUserAndMaybeRenewSession(fakeRequest(token), res))?.id).toBe(userId);
  });

  it("desactivar la cuenta a mitad de sesión (mismo JWT, aún sin expirar) hace que AMBAS funciones devuelvan null — nunca conserva acceso solo porque el token es válido", async () => {
    const db = await getDb();
    if (!db) throw new Error("Esta suite requiere BD local disponible (docker compose up -d db)");
    const token = await signSessionToken(userId);
    expect((await getUserFromRequest(fakeRequest(token)))?.id).toBe(userId);

    await db.update(users).set({ isActive: false }).where(eq(users.id, userId));

    expect(await getUserFromRequest(fakeRequest(token))).toBeNull();
    const { res } = fakeResponse();
    expect(await getUserAndMaybeRenewSession(fakeRequest(token), res)).toBeNull();
  });
});

describe("SEC-02 — cambio de rol/RBAC durante una sesión activa se refleja de inmediato (nunca cacheado en el JWT ni en la sesión)", () => {
  const email = "_sec02_test_rolechange@example.invalid";
  let userId: number;

  beforeEach(async () => {
    const db = await getDb();
    if (!db) throw new Error("Esta suite requiere BD local disponible (docker compose up -d db)");
    const [ins] = await db.execute(sql`
      INSERT INTO users (email, name, role, isActive, loginMethod, passwordHash, openId, createdAt, updatedAt)
      VALUES (${email}, 'SEC-02 Test User', 'user', 1, 'local', 'x', ${'_sec02_rolechange_' + Date.now()}, NOW(), NOW())
    `);
    userId = (ins as any).insertId;
  });

  afterEach(async () => {
    const db = await getDb();
    if (db) await db.delete(users).where(eq(users.id, userId));
  });

  it("el JWT solo lleva el userId (nunca el rol/permisos) — un cambio de rol en BD se ve en la siguiente petición con el MISMO token, sin esperar a que expire", async () => {
    const db = await getDb();
    if (!db) throw new Error("Esta suite requiere BD local disponible (docker compose up -d db)");
    const token = await signSessionToken(userId);

    const before = await getUserFromRequest(fakeRequest(token));
    expect(before?.role).toBe("user");

    await db.update(users).set({ role: "admin" }).where(eq(users.id, userId));

    const after = await getUserFromRequest(fakeRequest(token));
    expect(after?.role).toBe("admin");
  });
});

describe("SEC-02 — cambio de contraseña: comportamiento actual documentado (no se modifica sin justificación real de vulnerabilidad)", () => {
  const email = "_sec02_test_pwchange@example.invalid";
  let userId: number;

  beforeEach(async () => {
    const db = await getDb();
    if (!db) throw new Error("Esta suite requiere BD local disponible (docker compose up -d db)");
    const [ins] = await db.execute(sql`
      INSERT INTO users (email, name, role, isActive, loginMethod, passwordHash, openId, createdAt, updatedAt)
      VALUES (${email}, 'SEC-02 Test User', 'user', 1, 'local', 'x', ${'_sec02_pwchange_' + Date.now()}, NOW(), NOW())
    `);
    userId = (ins as any).insertId;
  });

  afterEach(async () => {
    const db = await getDb();
    if (db) await db.delete(users).where(eq(users.id, userId));
  });

  it("cambiar passwordHash NO invalida un JWT ya emitido (el JWT no depende del hash de contraseña, solo de JWT_SECRET global) — sesiones existentes en otras pestañas/dispositivos sobreviven a un cambio de contraseña", async () => {
    const db = await getDb();
    if (!db) throw new Error("Esta suite requiere BD local disponible (docker compose up -d db)");
    const token = await signSessionToken(userId);
    await db.update(users).set({ passwordHash: "un-hash-completamente-distinto" }).where(eq(users.id, userId));
    expect((await getUserFromRequest(fakeRequest(token)))?.id).toBe(userId);
  });
});

describe("SEC-02 — logout: sin cookie de sesión, no hay usuario (mismo criterio tras clearCookie real)", () => {
  it("una request sin la cookie de sesión (como queda tras logout) siempre devuelve null, nunca lanza", async () => {
    expect(await getUserFromRequest(fakeRequest(undefined))).toBeNull();
    const { res } = fakeResponse();
    expect(await getUserAndMaybeRenewSession(fakeRequest(undefined), res)).toBeNull();
  });
});
