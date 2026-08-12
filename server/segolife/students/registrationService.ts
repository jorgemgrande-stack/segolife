/**
 * registrationService.ts — alta de estudiante desde el formulario público
 * /register (SEGOLIFE — STUDENT REGISTRATION & ONBOARDING).
 *
 * Auditado antes de escribir — todo REUTILIZADO, nada duplicado:
 *  - auth local: mismo bcrypt cost (12) y patrón openId="local_<...>" que
 *    scripts/create-admin.mjs / server/passwordReset.ts.
 *  - perfil de estudiante: ensureStudentProfile/updateStudentProfile de
 *    server/db/studentsDb.ts (misma tabla student_profiles, sin CRM paralelo).
 *  - comunidad: getCommunityBySlug/addUserToCommunity de
 *    server/db/communitiesDb.ts (M2M user_communities existente, nunca un
 *    users.communityId directo).
 *  - teléfono: users.phone (columna ya existente, sin tabla nueva).
 *  - universidad: student_profiles.universityId (columna ya existente),
 *    validada con getCommunityUniversities — debe pertenecer a las
 *    universidades reales que sirve la comunidad elegida, igual que la
 *    propia comunidad nunca se confía tal cual del cliente.
 *  - consentimiento de marketing: updatePreference de
 *    server/segolife/engagement/notificationPreferencesService.ts —
 *    notification_preferences ES la tabla de consent, no se crea ninguna otra.
 *  - rol: users.role="user" (default de la tabla) — el enum heredado no
 *    tiene "student" y no hace falta uno: un protectedProcedure normal ya
 *    representa al estudiante.
 *
 * Todo el alta ocurre en UNA transacción (user + student_profile +
 * user_communities + notification_preferences): si cualquier paso falla se
 * revierte entero, nunca queda un `users` huérfano. La unicidad de email la
 * cierra en última instancia la restricción UNIQUE real de MySQL (ver
 * drizzle/0140_users_email_unique.sql) — la comprobación de aplicación de
 * abajo solo da un mensaje limpio en el caso normal (no-carrera); ante dos
 * registros simultáneos con el mismo email, uno de los dos INSERT choca con
 * ER_DUP_ENTRY (errno 1062) y se traduce al mismo EMAIL_EXISTS, nunca un 500.
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { users } from "../../../drizzle/schema";
import { getCommunityBySlug, addUserToCommunity, getCommunityUniversities } from "../../db/communitiesDb";
import { ensureStudentProfile, updateStudentProfile } from "../../db/studentsDb";
import { updatePreference } from "../engagement/notificationPreferencesService";
import { getBenefitDefinitionBySlug, getBenefitDefinitionCommunities } from "../../db/benefitsDb";
import { grantBenefit } from "../benefits/benefitGrantService";
import { emitBenefitGranted, buildBenefitGrantedPayload } from "../benefits/benefitEvents";

/**
 * Slug del beneficio de bienvenida (recomendación Student 360 §"Bienvenida
 * al estudiante nuevo") — la definición en sí (nombre, tipo, venue/producto
 * destino) se crea desde /admin/benefits con ESTE slug exacto; aquí solo se
 * dispara el grant automático. Si todavía no existe esa definición,
 * grantWelcomeBenefit no hace nada (nunca fabrica una definición).
 */
const WELCOME_BENEFIT_SLUG = "bienvenida-nuevo-estudiante";

/**
 * Grant automático del beneficio de bienvenida — SIEMPRE best-effort: un
 * fallo aquí (definición todavía no creada, beneficio inactivo, no aplica a
 * esta comunidad...) nunca debe romper el alta de un estudiante. Se llama
 * DESPUÉS de confirmar la transacción de registro, nunca dentro de ella
 * (mismo criterio que earnTokens en attendancePipeline.ts/commercePipeline.ts:
 * un side-effect de loyalty no bloquea la operación principal).
 */
async function grantWelcomeBenefitBestEffort(userId: number, communityId: number): Promise<void> {
  try {
    const definition = await getBenefitDefinitionBySlug(WELCOME_BENEFIT_SLUG);
    if (!definition || !definition.active) return;

    // Sin filas en benefit_communities = universal; si tiene filas, debe
    // incluir la comunidad de alta (mismo criterio que el resto del motor
    // de Benefits, ver drizzle/schema.ts comentario de benefit_communities).
    const scopedCommunities = await getBenefitDefinitionCommunities(definition.id);
    if (scopedCommunities.length > 0 && !scopedCommunities.includes(communityId)) return;

    const result = await grantBenefit({
      userId,
      benefitDefinitionId: definition.id,
      sourceType: "registration_welcome",
      communityId,
      validFrom: new Date(),
      validUntil: null,
      grantedByUserId: null,
      idempotencyKey: `registration_welcome:${userId}`,
      metadata: { reason: "Beneficio de bienvenida automático al registrarse en SEGOLIFE" },
    });
    if (result.created) {
      emitBenefitGranted(buildBenefitGrantedPayload(result.benefit, definition));
    }
  } catch (err) {
    console.error("[registerStudent] No se pudo conceder el beneficio de bienvenida:", err);
  }
}

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

// Mismo coste que scripts/create-admin.mjs y server/passwordReset.ts (BCRYPT_ROUNDS).
const BCRYPT_ROUNDS = 12;

// Misma política que server/passwordReset.ts (spec punto 12: "no imponer
// nada absurdo si no ya está exigido en otro lugar").
const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Laxo a propósito (spec: "sin validación agresiva") — cuenta dígitos totales
// tras quitar +/espacios/guiones (los grupos de un número real casi nunca
// tienen 6 dígitos SEGUIDOS: "+34 600 123 456") y solo exige un mínimo
// razonable, sin bloquear formatos internacionales (IE University tiene
// alumnado de fuera de España).
const MIN_PHONE_DIGITS = 6;

export type RegistrationErrorCode =
  | "INVALID_EMAIL"
  | "WEAK_PASSWORD"
  | "INVALID_PHONE"
  | "EMAIL_EXISTS"
  | "COMMUNITY_NOT_FOUND"
  | "UNIVERSITY_NOT_FOUND";

export class RegistrationError extends Error {
  code: RegistrationErrorCode;
  constructor(code: RegistrationErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "RegistrationError";
  }
}

/**
 * true si el error es un duplicado de clave única de MySQL (ER_DUP_ENTRY =
 * 1062) — comprueba tanto el error directo (mysql2 plano, mismo shape que
 * communitiesDb.ts) como `.cause` (drizzle-orm envuelve el error real de
 * mysql2 en un DrizzleQueryError cuando el INSERT corre dentro de una
 * transacción — verificado empíricamente contra el segolife_db local: sin
 * este segundo chequeo, la carrera real de dos registros simultáneos con el
 * mismo email devolvía un 500 en vez de EMAIL_EXISTS).
 */
function isDuplicateKeyError(err: unknown): boolean {
  const hasErrno1062 = (e: unknown): boolean =>
    !!e && typeof e === "object" && "errno" in e && (e as { errno?: number }).errno === 1062;
  if (hasErrno1062(err)) return true;
  const cause = err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined;
  return hasErrno1062(cause);
}

export interface RegisterStudentInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  /** Slug real de `communities` (spec punto 33: nunca confiar en un id enviado por el cliente). */
  communitySlug: string;
  /** Debe pertenecer a las universidades servidas por `communitySlug` — se revalida server-side. */
  universityId: number;
  academicYear?: string;
  marketingConsent: boolean;
}

export interface RegisterStudentResult {
  userId: number;
  name: string;
  email: string;
  role: string;
  communitySlug: string;
}

/**
 * Alta transaccional de estudiante. Lanza RegistrationError con un código
 * estable — el handler REST (server/localAuth.ts) lo traduce a copy EN/ES
 * amigable, nunca expone el error crudo de MySQL/Drizzle al cliente.
 */
export async function registerStudent(input: RegisterStudentInput, db?: DbHandle): Promise<RegisterStudentResult> {
  const conn = db ?? (await getDb());

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim().toLowerCase();

  const phone = input.phone.trim();

  if (!firstName || !lastName || !EMAIL_RE.test(email)) {
    throw new RegistrationError("INVALID_EMAIL", "El email introducido no es válido.");
  }
  if (phone.replace(/\D/g, "").length < MIN_PHONE_DIGITS) {
    throw new RegistrationError("INVALID_PHONE", "El teléfono introducido no es válido.");
  }
  if (typeof input.password !== "string" || input.password.length < MIN_PASSWORD_LENGTH) {
    throw new RegistrationError("WEAK_PASSWORD", `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  // Comunidad: nunca confiar en un id/slug del cliente sin validar — se
  // resuelve server-side y se exige status="active" (no "inactive"/"onboarding").
  const community = await getCommunityBySlug(input.communitySlug, conn);
  if (!community || community.status !== "active") {
    throw new RegistrationError("COMMUNITY_NOT_FOUND", "La comunidad seleccionada no está disponible.");
  }

  // Universidad: igual que la comunidad, nunca confiar en el id del cliente
  // — debe estar entre las universidades reales que sirve la comunidad elegida.
  const communityUniversities = await getCommunityUniversities(community.id, conn);
  const university = communityUniversities.find(u => u.id === input.universityId);
  if (!university) {
    throw new RegistrationError("UNIVERSITY_NOT_FOUND", "La universidad seleccionada no está disponible para esta comunidad.");
  }

  // Comprobación de aplicación — mensaje limpio en el caso normal. La
  // garantía real ante una carrera es el UNIQUE de MySQL capturado abajo.
  const [existingUser] = await conn.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existingUser) {
    throw new RegistrationError("EMAIL_EXISTS", "Ya existe una cuenta con este email.");
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const name = `${firstName} ${lastName}`;
  // Mismo patrón que scripts/create-admin.mjs (local_<timestamp>), reforzado
  // con un sufijo aleatorio: users.openId es NOT NULL UNIQUE y dos altas en
  // el mismo milisegundo no deben poder colisionar ahí.
  const openId = `local_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  const userId = await conn.transaction(async (tx) => {
    let insertId: number;
    try {
      const insertResult = await tx.insert(users).values({
        openId,
        email,
        name,
        phone,
        passwordHash,
        loginMethod: "local",
        isActive: true,
      });
      insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new RegistrationError("EMAIL_EXISTS", "Ya existe una cuenta con este email.");
      }
      throw err;
    }

    await ensureStudentProfile(insertId, tx);
    await updateStudentProfile(
      insertId,
      { firstName, lastName, universityId: university.id, ...(input.academicYear?.trim() ? { academicYear: input.academicYear.trim() } : {}) },
      tx
    );

    await addUserToCommunity(insertId, community.id, undefined, tx);

    // notification_preferences ES el registro de consentimiento de
    // marketing (spec punto 27) — se escribe siempre explícitamente (incluso
    // enabled:false) para dejar constancia auditable de la decisión tomada.
    await updatePreference(
      { userId: insertId, category: "promotions", channel: "email", enabled: input.marketingConsent },
      tx
    );

    return insertId;
  });

  await grantWelcomeBenefitBestEffort(userId, community.id);

  return { userId, name, email, role: "user", communitySlug: community.slug };
}
