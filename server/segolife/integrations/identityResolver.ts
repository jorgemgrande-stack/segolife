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

export interface IdentityResolutionResult {
  userId: number | null;
  method: "previous_mapping" | "participant_email" | "participant_phone" | "buyer_email" | "manual" | null;
}

function normalizeEmail(email: string | null | undefined): string | null {
  return email ? email.trim().toLowerCase() : null;
}

export async function resolveIdentity(input: IdentityResolutionInput, db?: DbHandle): Promise<IdentityResolutionResult> {
  const conn = db ?? (await getDb());

  // 1. Mapping previo confirmado.
  if (input.externalCustomerId) {
    const [existing] = await conn.select().from(externalIdentityMappings)
      .where(and(eq(externalIdentityMappings.provider, input.provider), eq(externalIdentityMappings.externalCustomerId, input.externalCustomerId)))
      .limit(1);
    if (existing) return { userId: existing.userId, method: "previous_mapping" };
  }

  // 2. Email del participante.
  const participantEmail = normalizeEmail(input.participant?.email);
  if (participantEmail) {
    const [match] = await conn.select().from(users).where(eq(users.email, participantEmail)).limit(1);
    if (match) return { userId: match.id, method: "participant_email" };
  }

  // 3. Teléfono del participante.
  if (input.participant?.phone) {
    const [match] = await conn.select().from(users).where(eq(users.phone, input.participant.phone)).limit(1);
    if (match) return { userId: match.id, method: "participant_phone" };
  }

  // 4. Email del comprador — solo si es semánticamente la misma persona (no
  //    hay un participante DISTINTO con su propio email ya intentado arriba).
  const buyerEmail = normalizeEmail(input.buyer?.email);
  if (buyerEmail && (!participantEmail || participantEmail === buyerEmail)) {
    const [match] = await conn.select().from(users).where(eq(users.email, buyerEmail)).limit(1);
    if (match) return { userId: match.id, method: "buyer_email" };
  }

  // 5. Unresolved.
  return { userId: null, method: null };
}

/** Persiste la resolución para no repetirla — llamar solo tras una resolución automática (1-4) o manual confirmada por admin. */
export async function persistIdentityMapping(
  input: IdentityResolutionInput & { userId: number; method: IdentityResolutionResult["method"] },
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
