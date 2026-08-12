/**
 * audienceEngine.ts — motor de segmentación de audiencias (Fase 7, spec
 * puntos 18-22). Extensible por diseño: cada filtro es una función pura
 * `resolveXFilter(filter) → Set<userId>` y `resolveAudience()` combina
 * todos los filtros presentes con intersección (AND) — una campaña que
 * pide "community=IE AND tag=Erasmus" solo llega a quien cumple AMBAS.
 *
 * Deliberadamente NO se implementan todos los filtros conceptuales del
 * spec (nationality, last_activity_at específico) para evitar
 * sobreingeniería — los más valiosos (community, tags, venue activity,
 * event attendance, tokens balance, benefit ownership, recurrence,
 * academic year, profile completeness, fecha de alta) sí, y la
 * arquitectura no requiere cambios para añadir más.
 *
 * Todas las consultas son de SOLO LECTURA sobre tablas ya existentes de
 * Fases 1-5 — el audience engine nunca escribe.
 */
import { eq, and, gte, lte, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  userCommunities, studentProfiles, studentTagAssignments,
  tokenWallets, userBenefits, eventAttendance, commerceTransactions,
  users,
} from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface AudienceDefinition {
  /**
   * Escape hatch explícito para "TODOS los estudiantes" (usado por COMUNITY,
   * spec punto 9) — sin esto, un `AudienceDefinition` vacío ya devuelve `[]`
   * a propósito ("nunca todos los usuarios por accidente"). `allStudents`
   * exige la misma intención explícita, solo que declarada en vez de
   * implícita: cualquier usuario con fila en student_profiles, sin más
   * filtros. Combinable con el resto de filtros (AND) igual que los demás.
   */
  allStudents?: boolean;
  communityIds?: number[];
  tagIds?: number[];
  venueActivity?: { venueId: number; kind: "visited" | "benefit_granted" | "benefit_redeemed" };
  eventAttended?: { eventId: number };
  tokensBalanceMin?: number;
  tokensBalanceMax?: number;
  benefitOwnership?: { benefitDefinitionId?: number; status?: "active" | "used" | "expired" | "cancelled" };
  academicYear?: string;
  profileComplete?: boolean;
  createdAfter?: string; // ISO date
  createdBefore?: string;
}

async function intersect(sets: Set<number>[]): Promise<Set<number>> {
  if (sets.length === 0) return new Set();
  return sets.reduce((acc, s) => new Set(Array.from(acc).filter(id => s.has(id))));
}

export async function resolveAudience(definition: AudienceDefinition, db?: DbHandle): Promise<number[]> {
  const conn = db ?? (await getDb());
  const sets: Set<number>[] = [];

  if (definition.allStudents) {
    const rows = await conn.select({ userId: studentProfiles.userId }).from(studentProfiles);
    sets.push(new Set(rows.map(r => r.userId)));
  }

  if (definition.communityIds?.length) {
    const rows = await conn.select({ userId: userCommunities.userId }).from(userCommunities)
      .where(inArray(userCommunities.communityId, definition.communityIds));
    sets.push(new Set(rows.map(r => r.userId)));
  }

  if (definition.tagIds?.length) {
    const rows = await conn.select({ userId: studentProfiles.userId }).from(studentTagAssignments)
      .innerJoin(studentProfiles, eq(studentTagAssignments.studentProfileId, studentProfiles.id))
      .where(inArray(studentTagAssignments.tagId, definition.tagIds));
    sets.push(new Set(rows.map(r => r.userId)));
  }

  if (definition.venueActivity) {
    const { venueId, kind } = definition.venueActivity;
    if (kind === "visited") {
      const rows = await conn.select({ userId: commerceTransactions.userId }).from(commerceTransactions)
        .where(and(eq(commerceTransactions.venueId, venueId), isNotNull(commerceTransactions.userId)));
      sets.push(new Set(rows.map(r => r.userId).filter((id): id is number => id != null)));
    } else if (kind === "benefit_granted") {
      const rows = await conn.select({ userId: userBenefits.userId }).from(userBenefits)
        .where(eq(userBenefits.sourceVenueId, venueId));
      sets.push(new Set(rows.map(r => r.userId)));
    } else {
      const rows = await conn.select({ userId: userBenefits.userId }).from(userBenefits)
        .where(eq(userBenefits.usedAtVenueId, venueId));
      sets.push(new Set(rows.map(r => r.userId)));
    }
  }

  if (definition.eventAttended) {
    const rows = await conn.select({ userId: eventAttendance.userId }).from(eventAttendance)
      .where(eq(eventAttendance.eventId, definition.eventAttended.eventId));
    sets.push(new Set(rows.map(r => r.userId)));
  }

  if (definition.tokensBalanceMin != null || definition.tokensBalanceMax != null) {
    const conditions = [];
    if (definition.tokensBalanceMin != null) conditions.push(gte(tokenWallets.balance, definition.tokensBalanceMin));
    if (definition.tokensBalanceMax != null) conditions.push(lte(tokenWallets.balance, definition.tokensBalanceMax));
    const rows = await conn.select({ userId: tokenWallets.userId }).from(tokenWallets).where(and(...conditions));
    sets.push(new Set(rows.map(r => r.userId)));
  }

  if (definition.benefitOwnership) {
    const conditions = [];
    if (definition.benefitOwnership.benefitDefinitionId) conditions.push(eq(userBenefits.benefitDefinitionId, definition.benefitOwnership.benefitDefinitionId));
    if (definition.benefitOwnership.status) conditions.push(eq(userBenefits.status, definition.benefitOwnership.status));
    const rows = await conn.select({ userId: userBenefits.userId }).from(userBenefits).where(conditions.length ? and(...conditions) : undefined);
    sets.push(new Set(rows.map(r => r.userId)));
  }

  if (definition.academicYear) {
    const rows = await conn.select({ userId: studentProfiles.userId }).from(studentProfiles)
      .where(eq(studentProfiles.academicYear, definition.academicYear));
    sets.push(new Set(rows.map(r => r.userId)));
  }

  if (definition.profileComplete != null) {
    const rows = await conn.select({ userId: studentProfiles.userId }).from(studentProfiles)
      .where(eq(studentProfiles.profileCompleted, definition.profileComplete));
    sets.push(new Set(rows.map(r => r.userId)));
  }

  if (definition.createdAfter || definition.createdBefore) {
    const conditions = [];
    if (definition.createdAfter) conditions.push(gte(users.createdAt, new Date(definition.createdAfter)));
    if (definition.createdBefore) conditions.push(lte(users.createdAt, new Date(definition.createdBefore)));
    const rows = await conn.select({ userId: users.id }).from(users).where(and(...conditions));
    sets.push(new Set(rows.map(r => r.userId)));
  }

  if (sets.length === 0) return []; // sin filtros = sin audiencia — nunca "todos los usuarios" por accidente

  const result = await intersect(sets);
  return Array.from(result);
}

export async function previewAudienceCount(definition: AudienceDefinition, db?: DbHandle): Promise<number> {
  const ids = await resolveAudience(definition, db);
  return ids.length;
}
