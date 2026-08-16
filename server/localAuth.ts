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
const JWT_SECRET_RAW = process.env.JWT_SECRET ?? "local-dev-secret-change-me";
const JWT_ALGO = "HS256" as const;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 días en segundos
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
    maxAge: COOKIE_MAX_AGE * 1000,
    path: "/",
    ...(isProd && isSegolifeHost(hostname) ? { domain: ".segolife.es" } : {}),
  };
}

/** Mismas domain/path que sessionCookieOptions — clearCookie exige coincidencia exacta para borrar de verdad. */
export function clearSessionCookieOptions(nodeEnv: string | undefined = process.env.NODE_ENV, hostname?: string): { path: "/"; domain?: string } {
  return { path: "/", ...(nodeEnv === "production" && isSegolifeHost(hostname) ? { domain: ".segolife.es" } : {}) };
}

// ─── Helpers JWT ──────────────────────────────────────────────────────────────
export async function signSessionToken(userId: number): Promise<string> {
  return new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: JWT_ALGO })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [JWT_ALGO] });
    const id = parseInt(String(payload.sub ?? ""), 10);
    return isNaN(id) ? null : id;
  } catch {
    return null;
  }
}

/** Extrae el usuario de la cookie de sesión (para usar en createContext). */
export async function getUserFromRequest(req: Request) {
  const raw = req.headers.cookie ?? "";
  const cookies = Object.fromEntries(
    raw.split(";").map(c => c.trim().split("=").map(decodeURIComponent))
  );
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const userId = await verifySessionToken(token);
  if (!userId) return null;

  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
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

  /** GET /api/auth/me — útil para el cliente si quiere verificar sesión vía REST */
  router.get("/api/auth/me", async (req: Request, res: Response) => {
    const user = await getUserFromRequest(req);
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
