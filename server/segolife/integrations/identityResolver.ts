/**
 * identityResolver.ts — resolución de identidad externa → usuario Segolife
 * (Fase 5, spec puntos 31-34). Política ESTRICTA, en este orden, nunca
 * fuzzy-match por nombre:
 *
 *  1. external_identity_mappings ya confirmado para ese provider+externalCustomerId.
 *  2. email del participante.
 *  3. teléfono del participante.
 *  4. email del comprador (buyer) — solo si no hay participante distinto.
 *  5. unresolved.
 *
 * Una vez resuelta con confianza (1-4), se persiste en
 * external_identity_mappings para no volver a resolver la próxima vez.
 *
 * AMBIGÜEDAD (Fourvenues Casanova Historical Validation, spec §17): un email
 * tiene UNIQUE real en `users` (nunca puede haber 2 filas), pero `phone` NO
 * tiene esa garantía — si 2+ Students comparten el mismo teléfono
 * normalizado, esta función NUNCA elige la primera fila a ciegas. Cada paso
 * pide hasta 2 filas; si encuentra exactamente 1, resuelve como antes; si
 * encuentra 2+, ese paso queda "ambiguous" y se prueba el siguiente paso —
 * un paso posterior que sí resuelva sin ambigüedad gana. Si ningún paso
 * resuelve, el resultado final es `unresolved`, pero conserva qué paso fue
 * ambiguo (`method: "ambiguous_email" | "ambiguous_phone"`) para que la cola
 * de `unresolved_operations` y la analítica puedan distinguir "sin ningún
 * indicio" de "indicio real pero irresoluble sin intervención humana".
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { externalIdentityMappings, users } from "../../../drizzle/schema";
import type { NormalizedBuyerOrParticipant } from "./externalTicketingProvider";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface IdentityResolutionInput {
  provider: string;
  externalCustomerId?: string | null;
  participant?: NormalizedBuyerOrParticipant | null;
  buyer?: NormalizedBuyerOrParticipant | null;
}

/** Subconjunto que SÍ puede persistirse en external_identity_mappings.resolution_method (enum real de BD) — los estados "ambiguous_*" nunca llegan aquí porque siempre van con userId: null. */
export type ConfirmedResolutionMethod = "previous_mapping" | "participant_email" | "participant_phone" | "buyer_email" | "manual";

export interface IdentityResolutionResult {
  userId: number | null;
  method: ConfirmedResolutionMethod | "ambiguous_email" | "ambiguous_phone" | null;
}

function normalizeEmail(email: string | null | undefined): string | null {
  return email ? email.trim().toLowerCase() : null;
}

export async function resolveIdentity(input: IdentityResolutionInput, db?: DbHandle): Promise<IdentityResolutionResult> {
  const conn = db ?? (await getDb());
  let ambiguousMethod: "ambiguous_email" | "ambiguous_phone" | null = null;

  // 1. Mapping previo confirmado.
  if (input.externalCustomerId) {
    const [existing] = await conn.select().from(externalIdentityMappings)
      .where(and(eq(externalIdentityMappings.provider, input.provider), eq(externalIdentityMappings.externalCustomerId, input.externalCustomerId)))
      .limit(1);
    if (existing) return { userId: existing.userId, method: "previous_mapping" };
  }

  // 2. Email del participante — email tiene UNIQUE real en `users`, pero se
  //    pide hasta 2 filas igualmente por defensa en profundidad (nunca
  //    asumir que la constraint está aplicada en todos los entornos).
  const participantEmail = normalizeEmail(input.participant?.email);
  if (participantEmail) {
    const matches = await conn.select().from(users).where(eq(users.email, participantEmail)).limit(2);
    if (matches.length === 1) return { userId: matches[0].id, method: "participant_email" };
    if (matches.length > 1) ambiguousMethod = "ambiguous_email";
  }

  // 3. Teléfono del participante — SIN UNIQUE real: 2+ Students pueden
  //    compartir el mismo teléfono normalizado. Nunca elegir la primera fila.
  if (input.participant?.phone) {
    const matches = await conn.select().from(users).where(eq(users.phone, input.participant.phone)).limit(2);
    if (matches.length === 1) return { userId: matches[0].id, method: "participant_phone" };
    if (matches.length > 1) ambiguousMethod = ambiguousMethod ?? "ambiguous_phone";
  }

  // 4. Email del comprador — solo si es semánticamente la misma persona (no
  //    hay un participante DISTINTO con su propio email ya intentado arriba).
  const buyerEmail = normalizeEmail(input.buyer?.email);
  if (buyerEmail && (!participantEmail || participantEmail === buyerEmail)) {
    const matches = await conn.select().from(users).where(eq(users.email, buyerEmail)).limit(2);
    if (matches.length === 1) return { userId: matches[0].id, method: "buyer_email" };
    if (matches.length > 1) ambiguousMethod = ambiguousMethod ?? "ambiguous_email";
  }

  // 5. Unresolved — conserva qué paso fue ambiguo, si alguno lo fue.
  return { userId: null, method: ambiguousMethod };
}

/** true si `method` es persistible en external_identity_mappings (nunca lo son los estados "ambiguous_*", que siempre van con userId: null). */
export function isConfirmedResolutionMethod(method: IdentityResolutionResult["method"]): method is ConfirmedResolutionMethod {
  return method != null && method !== "ambiguous_email" && method !== "ambiguous_phone";
}

/** Persiste la resolución para no repetirla — llamar solo tras una resolución automática (1-4) o manual confirmada por admin. */
export async function persistIdentityMapping(
  input: IdentityResolutionInput & { userId: number; method: ConfirmedResolutionMethod | null },
  db?: DbHandle
): Promise<void> {
  if (!input.externalCustomerId || !input.method) return;
  const conn = db ?? (await getDb());
  await conn.insert(externalIdentityMappings).ignore().values({
    provider: input.provider,
    externalCustomerId: input.externalCustomerId,
    buyerEmail: input.buyer?.email ?? null,
    buyerPhone: input.buyer?.phone ?? null,
    participantEmail: input.participant?.email ?? null,
    participantPhone: input.participant?.phone ?? null,
    name: input.participant?.name ?? input.buyer?.name ?? null,
    userId: input.userId,
    resolutionMethod: input.method,
  });
}
