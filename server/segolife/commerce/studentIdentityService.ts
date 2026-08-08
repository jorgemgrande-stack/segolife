/**
 * studentIdentityService.ts — QR de identidad del estudiante para POS
 * nativo (Fase 8, spec punto 23). Auditado antes de crear: NUNCA reutiliza
 * el QR de Benefits (autoriza un canje real), el de Consumption (un solo
 * uso, hash-only) ni el de un Ticket (identifica una ENTRADA, no una
 * persona) — propósito distinto, entidad distinta (`student_identity_tokens`).
 *
 * MODELO DE AMENAZA (documentado explícitamente, seguridad antes que
 * comodidad): este token identifica AL ESTUDIANTE frente al staff de un
 * POS — nunca autoriza un cargo por sí mismo. El staff sigue eligiendo
 * productos/cantidad/importe a mano; el QR solo evita teclear un email. Una
 * fuga (captura de pantalla, etc.) permite a un tercero que ATRIBUYA una
 * compra en efectivo — que de todos modos requiere presencia física de un
 * miembro de staff autorizado en un venue real — a otro estudiante; riesgo
 * bajo, comparable a llevar puesta una pulsera con nombre, nunca
 * equivalente a filtrar un medio de pago. Mismo patrón cripto que Benefits
 * (token en claro recuperable + hash único de búsqueda) porque, igual que
 * un Benefit, el estudiante debe poder volver a mostrarlo repetidamente.
 * `rotateMyIdentityToken()` permite invalidar+regenerar si se sospecha una
 * fuga (defensa en profundidad, igual que cambiar una contraseña).
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import crypto from "crypto";
import { studentIdentityTokens, users, type StudentIdentityToken } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Devuelve el token en claro del propio usuario, creándolo si es la primera vez (idempotente vía UNIQUE user_id). */
export async function getOrCreateMyIdentityToken(userId: number, db?: DbHandle): Promise<{ token: string }> {
  const conn = db ?? (await getDb());
  const [existing] = await conn.select().from(studentIdentityTokens).where(eq(studentIdentityTokens.userId, userId)).limit(1);
  if (existing) return { token: existing.token };

  const token = generateToken();
  const tokenHash = hashToken(token);
  const [insertResult] = await conn.insert(studentIdentityTokens).ignore().values({ userId, token, tokenHash });
  const insertId = (insertResult as unknown as { insertId: number }).insertId;
  if (!insertId) {
    // Carrera real (doble clic) — otra llamada ya lo creó, devolver el suyo.
    const [row] = await conn.select().from(studentIdentityTokens).where(eq(studentIdentityTokens.userId, userId)).limit(1);
    return { token: row.token };
  }
  return { token };
}

/** Invalida el token actual y genera uno nuevo — acción explícita del propio estudiante si sospecha una fuga. */
export async function rotateMyIdentityToken(userId: number, db?: DbHandle): Promise<{ token: string }> {
  const conn = db ?? (await getDb());
  const token = generateToken();
  const tokenHash = hashToken(token);
  await conn.update(studentIdentityTokens).set({ token, tokenHash, rotatedAt: new Date() }).where(eq(studentIdentityTokens.userId, userId));
  const [row] = await conn.select().from(studentIdentityTokens).where(eq(studentIdentityTokens.userId, userId)).limit(1);
  if (!row) return getOrCreateMyIdentityToken(userId, conn);
  return { token: row.token };
}

export interface IdentifiedStudent {
  userId: number;
  name: string;
}

/** Búsqueda por parte del STAFF — SIEMPRE por hash, nunca compara el texto plano (evita timing attacks, mismo criterio que Benefits/tickets). */
export async function lookupStudentByIdentityToken(token: string, db?: DbHandle): Promise<IdentifiedStudent | null> {
  const conn = db ?? (await getDb());
  const tokenHash = hashToken(token);
  const [row] = await conn.select().from(studentIdentityTokens).where(eq(studentIdentityTokens.tokenHash, tokenHash)).limit(1);
  if (!row) return null;

  const [student] = await conn.select({ name: users.name }).from(users).where(eq(users.id, row.userId)).limit(1);
  return { userId: row.userId, name: student?.name ?? "—" };
}

export type { StudentIdentityToken };
