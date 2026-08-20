/**
 * localAuth.ts — Autenticación local email+contraseña que reemplaza Manus OAuth.
 *
 * Flujo:
 *  POST /api/auth/login    → valida credenciales, emite cookie JWT
 *  POST /api/auth/register → alta de estudiante (registrationService.ts), emite cookie JWT
 *  POST /api/auth/logout   → borra la cookie
 *  GET  /api/auth/me       → devuelve el usuario de la sesión (usado por tRPC context)
 *
 * Compatible con el contexto tRPC existente: lee la misma cookie SESSION_COOKIE_NAME
 * y produce el mismo tipo { User } que el flujo OAuth anterior.
 */

import bcrypt from "bcryptjs";
import express, { type Request, type Response, type Router } from "express";
import { SignJWT, jwtVerify } from "jose";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { registerStudent, RegistrationError, type RegistrationErrorCode } from "./segolife/students/registrationService";
import { recordStudentLogin } from "./segolife/students/studentLoginEventsDb";

// ─── Configuración ────────────────────────────────────────────────────────────
// Exportado (Fase 16, auditoría) — authGuard.ts duplicaba este literal de
// forma independiente; nada garantizaba que se mantuvieran sincronizados si
// alguno cambiaba. Fuente única de verdad ahora.
export const COOKIE_NAME = "nayade_session";
// Nunca en producción: si JWT_SECRET faltara ahí, este literal (visible en
// el código fuente) permitiría a cualquiera forjar un token de sesión válido
// para cualquier usuario, incluido admin — falla alto en vez de firmar
// sesiones reales con un secreto público. Fuera de producción (dev/test) sí
// se permite, por conveniencia de desarrollo local sin .env configurado.
const JWT_SECRET_RAW = process.env.JWT_SECRET ?? (() => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("[localAuth] JWT_SECRET no está configurada en producción — no se pueden firmar sesiones de forma segura.");
  }
  return "local-dev-secret-change-me";
})();
const JWT_ALGO = "HS256" as const;

// ─── SEC-02 — Session persistence & safe reauthentication ────────────────────
// Antes: JWT y cookie fijos a 30 días, sin renovación ni tope absoluto —
// una sesión ya iniciada duraba mucho, pero NINGÚN mecanismo la refrescaba,
// así que una pestaña abierta más allá del TTL (o cualquier fallo puntual de
// verificación) caía a "no autenticado" sin aviso. El problema real reportado
// ("pierdo la sesión en mitad de una operación") no era un TTL corto — era la
// combinación de (a) sin renovación deslizante y (b) el frontend tratando
// CUALQUIER 401 aislado como prueba definitiva de sesión muerta (ver fix en
// client/src/main.tsx). Aquí se resuelve (a): sesión deslizante con tope
// absoluto real, config centralizada, y AUTH_SESSION_TTL_SECONDS reducible
// SOLO vía env var en entorno de test (nunca toca el valor de producción).
//
// sessionStartedAt (claim JWT propio, nunca se resetea al renovar) es lo que
// permite distinguir "sesión renovada muchas veces pero joven" de "sesión que
// lleva más del tope absoluto activa" — sin él, una renovación deslizante sin
// límite se convertiría en una sesión eterna (prohibido explícitamente).
function readTtlEnv(name: string, defaultSeconds: number): number {
  const raw = process.env[name];
  if (!raw) return defaultSeconds;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultSeconds;
}
/** Vida de cada token individual — se renueva de forma deslizante mientras haya actividad. */
export const AUTH_SESSION_TTL_SECONDS = readTtlEnv("AUTH_SESSION_TTL_SECONDS", 60 * 60 * 24); // 24h
/** Cuando la vida restante del token cae por debajo de este umbral, se emite uno nuevo (mismo sessionStartedAt). */
export const AUTH_SESSION_RENEWAL_THRESHOLD_SECONDS = readTtlEnv("AUTH_SESSION_RENEWAL_THRESHOLD_SECONDS", 60 * 60 * 2); // 2h
/** Tope absoluto desde el login original — ninguna renovación deslizante puede superarlo. */
export const AUTH_SESSION_ABSOLUTE_TTL_SECONDS = readTtlEnv("AUTH_SESSION_ABSOLUTE_TTL_SECONDS", 60 * 60 * 24 * 7); // 7d
// Fase 15 (spec §34, "auth/cookie safety"): auditoría confirmó que la cookie
// nunca declaraba `domain`, así que el navegador la trataba como host-only —
// una sesión iniciada en www.segolife.es no se enviaba en peticiones a
// segolife.es (ni al revés), y sin ningún redirect canónico entre ambos
// (ver server/_core/index.ts), un Student podía parecer desconectado solo
// por rebotar entre los dos hosts. `.segolife.es` (con el punto inicial)
// cubre el apex y cualquier subdominio futuro (ie.segolife.es, etc.) sin
// tener que tocar esta constante otra vez. En desarrollo local (localhost)
// se deja sin `domain` — Chrome/Firefox rechazan o tratan de forma rara un
// dominio de cookie que no coincide con un sufijo público real. Ver
// sessionCookieOptions()/clearSessionCookieOptions() más abajo.

function getSecret(): Uint8Array {
  return new TextEncoder().encode(JWT_SECRET_RAW);
}

// Incidente real (post-Fase 16): el admin real y una Student no podían
// iniciar sesión desde https://segolife-production.up.railway.app (el
// dominio público de Railway, sin pasar por www.segolife.es) — la fila
// canonicalRedirectTarget lo deja pasar a propósito (no rompe el propio
// healthcheck), pero sessionCookieOptions ponía domain=".segolife.es"
// SIEMPRE en producción, sin mirar el host real de la petición. Un
// navegador rechaza en silencio un Set-Cookie cuyo Domain no es el host
// actual ni un sufijo del mismo — segolife-production.up.railway.app no
// tiene ninguna relación con segolife.es, así que el login "funcionaba"
// en el servidor (JWT válido, 200 OK) pero la cookie nunca se guardaba en
// el navegador, y el usuario volvía a ver el login inmediatamente.
/** true si `hostname` es segolife.es o cualquier subdominio suyo (www., ie., etc.) — nunca coincide con Railway/localhost/preview. */
function isSegolifeHost(hostname: string | undefined): boolean {
  if (!hostname) return false;
  return hostname === "segolife.es" || hostname.endsWith(".segolife.es");
}

/** Extraído para poder testear la lógica de domain/secure sin levantar el router completo. */
export function sessionCookieOptions(nodeEnv: string | undefined = process.env.NODE_ENV, hostname?: string): {
  httpOnly: true; secure: boolean; sameSite: "lax"; maxAge: number; path: "/"; domain?: string;
} {
  const isProd = nodeEnv === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    // Máx-Age de la cookie siempre igual al TTL del token que se acaba de
    // firmar/renovar (nunca desincronizados) — la renovación deslizante
    // (ver getUserAndMaybeRenewSession) reemite ambos juntos mientras haya
    // actividad, así que en la práctica una sesión activa nunca llega a
    // este límite; el tope real de "sesión inactiva demasiado tiempo" es
    // este mismo valor, y el tope absoluto duro vive en sessionStartedAt.
    maxAge: AUTH_SESSION_TTL_SECONDS * 1000,
    path: "/",
    ...(isProd && isSegolifeHost(hostname) ? { domain: ".segolife.es" } : {}),
  };
}

/** Mismas domain/path que sessionCookieOptions — clearCookie exige coincidencia exacta para borrar de verdad. */
export function clearSessionCookieOptions(nodeEnv: string | undefined = process.env.NODE_ENV, hostname?: string): { path: "/"; domain?: string } {
  return { path: "/", ...(nodeEnv === "production" && isSegolifeHost(hostname) ? { domain: ".segolife.es" } : {}) };
}

// ─── Helpers JWT ──────────────────────────────────────────────────────────────
/**
 * `sessionStartedAt` (segundos, epoch) — SIEMPRE el instante del login/registro
 * ORIGINAL. Al renovar (mismo usuario, nueva llamada a signSessionToken desde
 * getUserAndMaybeRenewSession) se pasa explícitamente el valor ya existente,
 * nunca Date.now() de nuevo — si se reseteara en cada renovación, el tope
 * absoluto (AUTH_SESSION_ABSOLUTE_TTL_SECONDS) nunca se alcanzaría mientras
 * hubiera actividad, es decir: una sesión deslizante sin fin. Solo un login o
 * registro nuevo (sin `sessionStartedAt` explícito) arranca el reloj.
 */
export async function signSessionToken(userId: number, sessionStartedAt?: number): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const startedAt = sessionStartedAt ?? nowSeconds;
  return new SignJWT({ sub: String(userId), sessionStartedAt: startedAt })
    .setProtectedHeader({ alg: JWT_ALGO })
    .setIssuedAt()
    .setExpirationTime(nowSeconds + AUTH_SESSION_TTL_SECONDS)
    .sign(getSecret());
}

export interface SessionTokenPayload {
  userId: number;
  sessionStartedAt: number;
  /** segundos restantes hasta que expire ESTE token concreto (no el tope absoluto) */
  expiresInSeconds: number;
}

/**
 * Verifica firma + exp (automático vía jwtVerify) + el tope absoluto real
 * (sessionStartedAt) — un token puede tener `exp` vigente (recién renovado)
 * y aun así superar el tope absoluto si sessionStartedAt es muy antiguo;
 * ambas comprobaciones son necesarias, ninguna sustituye a la otra.
 */
export async function verifySessionTokenPayload(token: string): Promise<SessionTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [JWT_ALGO] });
    const id = parseInt(String(payload.sub ?? ""), 10);
    if (isNaN(id)) return null;
    const sessionStartedAt = typeof payload.sessionStartedAt === "number" ? payload.sessionStartedAt : null;
    const nowSeconds = Math.floor(Date.now() / 1000);
    // Tokens firmados ANTES de SEC-02 no llevan sessionStartedAt — se tratan
    // como "empezada ahora" (nunca se rechazan de golpe por un campo que no
    // existía cuando se emitieron; expiran solos por su `exp` normal, un
    // máximo de AUTH_SESSION_TTL_SECONDS más tarde).
    const effectiveStartedAt = sessionStartedAt ?? nowSeconds;
    if (nowSeconds - effectiveStartedAt > AUTH_SESSION_ABSOLUTE_TTL_SECONDS) return null;
    const expiresInSeconds = typeof payload.exp === "number" ? payload.exp - nowSeconds : 0;
    return { userId: id, sessionStartedAt: effectiveStartedAt, expiresInSeconds };
  } catch {
    return null;
  }
}

/** Compatibilidad — la mayoría de callers (authGuard.ts, etc.) solo necesitan saber si hay un userId válido. */
export async function verifySessionToken(token: string): Promise<number | null> {
  const payload = await verifySessionTokenPayload(token);
  return payload?.userId ?? null;
}

function getSessionCookieToken(req: Request): string | undefined {
  const raw = req.headers.cookie ?? "";
  const cookies = Object.fromEntries(
    raw.split(";").map(c => c.trim().split("=").map(decodeURIComponent))
  );
  return cookies[COOKIE_NAME];
}

/**
 * Busca al usuario por id con UN reintento inmediato ante fallo (SEC-02):
 * un pool de conexiones MySQL puede tener un fallo puntual y transitorio
 * (reconexión tras idle, un blip breve durante un redeploy/blue-green) sin
 * que el JWT/cookie tengan nada que ver — antes, ESE fallo transitorio se
 * indistinguía de "no autenticado" (getDb()/la query fallaban -> se
 * devolvía null -> 401 -> el frontend interpretaba sesión muerta). Un solo
 * reintento inmediato absorbe el caso típico sin enmascarar un fallo real
 * de BD (que seguiría fallando en el reintento y devolviendo null, como
 * antes).
 */
async function findUserByIdWithRetry(userId: number) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const db = await getDb();
      if (!db) throw new Error("DB no disponible");
      const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (attempt === 1) {
        console.error("[localAuth] findUserByIdWithRetry: fallo tras reintento:", err instanceof Error ? err.message : err);
        return null;
      }
    }
  }
  return null;
}

/**
 * Extrae el usuario de la cookie de sesión (para REST endpoints que no
 * necesitan renovación deslizante — uploads, webhooks, exports puntuales).
 * SEC-02: ahora rechaza de forma centralizada (devuelve null) una cuenta
 * desactivada (isActive=false) — antes cada procedure tenía que comprobarlo
 * por su cuenta y la mayoría no lo hacía (ver server/_core/trpc.ts, el
 * fix de PRE-16.16B solo cubría employeeProcedure/gestoriaProcedure). Una
 * cuenta desactivada ahora se trata exactamente igual que "sin sesión" en
 * TODAS partes — nunca conserva acceso solo porque su JWT no ha expirado.
 */
export async function getUserFromRequest(req: Request) {
  const token = getSessionCookieToken(req);
  if (!token) return null;

  const payload = await verifySessionTokenPayload(token);
  if (!payload) {
    // Sin userId aún (el token no verificó) — nunca se loguea el token en
    // sí. Es una señal de observabilidad puntual (sesión expirada/tope
    // absoluto superado/firma inválida), nunca por request normal — la
    // inmensa mayoría de requests autenticadas tienen un token válido y no
    // pasan por aquí.
    console.log("[auth] session rejected: expired");
    return null;
  }

  const user = await findUserByIdWithRetry(payload.userId);
  if (!user || !user.isActive) {
    if (user) console.log("[auth] session rejected: inactive");
    return null;
  }
  return user;
}

/**
 * Igual que getUserFromRequest, PERO además renueva la sesión de forma
 * deslizante cuando procede (SEC-02) — usado exclusivamente por el contexto
 * tRPC (context.local.ts) y por GET /api/auth/me, los dos puntos de entrada
 * que representan "el usuario sigue usando la app activamente" de verdad.
 * Nunca escribe en BD ni hace nada costoso: renovar solo emite un nuevo JWT
 * firmado (operación local, sin I/O) y una cabecera Set-Cookie — no hay
 * "escritura" real que evitar aparte de no hacerlo en cada request (spec
 * SEC-02 §7), que es exactamente lo que el umbral controla.
 */
export async function getUserAndMaybeRenewSession(req: Request, res: Response) {
  const token = getSessionCookieToken(req);
  if (!token) return null;

  const payload = await verifySessionTokenPayload(token);
  if (!payload) {
    console.log("[auth] session rejected: expired");
    return null;
  }

  const user = await findUserByIdWithRetry(payload.userId);
  if (!user || !user.isActive) {
    if (user) console.log("[auth] session rejected: inactive");
    return null;
  }

  if (payload.expiresInSeconds < AUTH_SESSION_RENEWAL_THRESHOLD_SECONDS) {
    try {
      const renewed = await signSessionToken(user.id, payload.sessionStartedAt);
      res.cookie(COOKIE_NAME, renewed, sessionCookieOptions(undefined, req.hostname));
      // Evento puntual (solo ocurre cerca del umbral de renovación, nunca
      // por request normal) — sin token ni PII, solo la señal en sí.
      console.log("[auth] session renewal success");
    } catch (err) {
      // Nunca bloquea la request actual por un fallo al renovar — el token
      // vigente sigue siendo válido para ESTA petición; simplemente no se
      // habrá renovado, y se reintentará en la siguiente request próxima a
      // expirar.
      console.error("[localAuth] No se pudo renovar la sesión de forma deslizante:", err instanceof Error ? err.message : err);
    }
  }

  return user;
}

// ─── Router Express ───────────────────────────────────────────────────────────
export function createLocalAuthRouter(): Router {
  const router = express.Router();

  /** POST /api/auth/login */
  router.post("/api/auth/login", async (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      res.status(400).json({ error: "Email y contraseña son obligatorios." });
      return;
    }

    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "Base de datos no disponible." });
      return;
    }

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, String(email).toLowerCase().trim()))
      .limit(1);

    const user = rows[0];
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Credenciales incorrectas." });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ error: "Cuenta desactivada. Contacta con el administrador." });
      return;
    }

    const valid = await bcrypt.compare(String(password), user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Credenciales incorrectas." });
      return;
    }

    // Actualizar lastSignedIn
    await db
      .update(users)
      .set({ lastSignedIn: new Date() })
      .where(eq(users.id, user.id));

    // Histórico de login (Student 360) — best-effort, nunca bloquea el login
    // si falla (mismo criterio que el resto de efectos secundarios no
    // críticos del repo, p.ej. earnTokens en attendancePipeline.ts).
    recordStudentLogin(user.id, "password").catch((err) => {
      console.error("[login] No se pudo registrar student_login_events:", err);
    });

    const token = await signSessionToken(user.id);

    res.cookie(COOKIE_NAME, token, sessionCookieOptions(undefined, req.hostname));

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
    });
  });

  /**
   * POST /api/auth/register — alta de estudiante (SEGOLIFE — STUDENT
   * REGISTRATION & ONBOARDING). Público por definición (no requiere sesión
   * previa) — mismo router REST que login/logout/me, ver CLAUDE.md ("la
   * única excepción [a usar tRPC] son los endpoints de autenticación local").
   * Al igual que login, abre sesión automáticamente al terminar (spec punto
   * 19: no forzar un login aparte tras registrarse) reutilizando exactamente
   * el mismo signSessionToken/cookie que el login real.
   */
  router.post("/api/auth/register", async (req: Request, res: Response) => {
    const { firstName, lastName, email, phone, password, communitySlug, universityId, academicYear, marketingConsent, website, referralCode, referralClickedAt } = req.body ?? {};

    // Honeypot anti-bot (spec punto 30): campo oculto que un humano nunca
    // rellena. Presencia de valor → responder OK sin crear nada (no delatar
    // al bot con un error distinto).
    if (typeof website === "string" && website.trim() !== "") {
      res.status(201).json({ id: 0, name: "", email: "", role: "user" });
      return;
    }

    if (!firstName || !lastName || !email || !phone || !password || !communitySlug || !universityId) {
      res.status(400).json({ error: "Faltan campos obligatorios.", code: "INVALID_INPUT" });
      return;
    }

    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "Base de datos no disponible." });
      return;
    }

    try {
      const result = await registerStudent({
        firstName: String(firstName),
        lastName: String(lastName),
        email: String(email),
        phone: String(phone),
        password: String(password),
        communitySlug: String(communitySlug),
        universityId: Number(universityId),
        academicYear: academicYear ? String(academicYear) : undefined,
        marketingConsent: marketingConsent === true,
        // REFERRAL & INVITE REWARDS ENGINE (Fase 8) — código opcional
        // capturado por el cliente (localStorage) al abrir un enlace de
        // invitación; el timestamp se parsea de forma defensiva (nunca
        // confiar en que el cliente mande una fecha válida ni futura — la
        // validación real del rango ocurre en referralService.ts).
        referralCode: typeof referralCode === "string" && referralCode.trim() ? referralCode.trim() : null,
        referralClickedAt: (() => {
          if (typeof referralClickedAt !== "string" && typeof referralClickedAt !== "number") return null;
          const parsed = new Date(referralClickedAt);
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        })(),
      });

      const token = await signSessionToken(result.userId);
      res.cookie(COOKIE_NAME, token, sessionCookieOptions(undefined, req.hostname));

      res.status(201).json({
        id: result.userId,
        name: result.name,
        email: result.email,
        role: result.role,
        communitySlug: result.communitySlug,
      });
    } catch (err) {
      if (err instanceof RegistrationError) {
        const status: Record<RegistrationErrorCode, number> = {
          INVALID_EMAIL: 400,
          WEAK_PASSWORD: 400,
          INVALID_PHONE: 400,
          EMAIL_EXISTS: 409,
          COMMUNITY_NOT_FOUND: 400,
          UNIVERSITY_NOT_FOUND: 400,
        };
        res.status(status[err.code]).json({ error: err.message, code: err.code });
        return;
      }
      console.error("[register] Error inesperado:", err);
      res.status(500).json({ error: "No se ha podido completar el registro. Inténtalo de nuevo." });
    }
  });

  /** POST /api/auth/logout */
  router.post("/api/auth/logout", (req: Request, res: Response) => {
    // El navegador solo borra una cookie si domain/path coinciden EXACTAMENTE
    // con los que se usaron al fijarla — mismas opciones que sessionCookieOptions(),
    // si no el logout dejaría la cookie con domain=".segolife.es" viva.
    res.clearCookie(COOKIE_NAME, clearSessionCookieOptions(undefined, req.hostname));
    res.json({ ok: true });
  });

  /**
   * GET /api/auth/me — útil para el cliente si quiere verificar sesión vía
   * REST. SEC-02: useAuth.ts (frontend) llama a este endpoint en cada carga
   * de la app — es la señal más directa de "usuario activo ahora mismo", así
   * que también debe poder renovar la sesión de forma deslizante (mismo
   * criterio que el contexto tRPC, ver context.local.ts).
   */
  router.get("/api/auth/me", async (req: Request, res: Response) => {
    const user = await getUserAndMaybeRenewSession(req, res);
    if (!user) {
      res.status(401).json({ error: "No autenticado." });
      return;
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
    });
  });

  return router;
}
