/**
 * benefitsDb.ts — lecturas/CRUD administrativo del módulo de Benefits
 * (Fase 4). CRUD simple de `benefit_definitions`/`benefit_rules`/
 * `benefit_communities`/`venue_staff` vive aquí (mismo criterio que
 * tokenRulesDb.ts) — la escritura con garantías de atomicidad/idempotencia
 * de `user_benefits` vive en benefitGrantService.ts, nunca aquí.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, inArray, desc, type SQL } from "drizzle-orm";
import {
  benefitDefinitions,
  benefitCommunities,
  benefitRules,
  userBenefits,
  benefitRedemptionAttempts,
  venueStaff,
  venues,
  communityVenues,
  users,
  type BenefitDefinition,
  type InsertBenefitDefinition,
  type BenefitRule,
  type InsertBenefitRule,
  type UserBenefit,
  type BenefitRedemptionAttempt,
  type VenueStaff,
} from "../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

/** venueIds vinculados a alguna de las comunidades dadas — mismo patrón que venuesDb.ts/consumptionQrDb.ts. */
async function getVenueIdsInCommunities(communityIds: number[], conn: DbHandle): Promise<number[]> {
  if (communityIds.length === 0) return [];
  const rows = await conn.select({ venueId: communityVenues.venueId }).from(communityVenues)
    .where(inArray(communityVenues.communityId, communityIds));
  return Array.from(new Set(rows.map(r => r.venueId)));
}

// ─── BENEFIT_DEFINITIONS ─────────────────────────────────────────────────────

export async function listBenefitDefinitions(db?: DbHandle): Promise<BenefitDefinition[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(benefitDefinitions).orderBy(desc(benefitDefinitions.createdAt));
}

export async function getBenefitDefinitionById(id: number, db?: DbHandle): Promise<BenefitDefinition | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(benefitDefinitions).where(eq(benefitDefinitions.id, id)).limit(1);
  return row ?? null;
}

/** Por slug (único) — usado por triggers automáticos que necesitan referenciar un beneficio concreto sin depender de su id numérico. */
export async function getBenefitDefinitionBySlug(slug: string, db?: DbHandle): Promise<BenefitDefinition | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(benefitDefinitions).where(eq(benefitDefinitions.slug, slug)).limit(1);
  return row ?? null;
}

export async function createBenefitDefinition(input: InsertBenefitDefinition, db?: DbHandle): Promise<BenefitDefinition> {
  const conn = db ?? (await getDb());
  const insertResult = await conn.insert(benefitDefinitions).values(input);
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [created] = await conn.select().from(benefitDefinitions).where(eq(benefitDefinitions.id, insertId)).limit(1);
  return created;
}

export async function updateBenefitDefinition(id: number, fields: Partial<InsertBenefitDefinition>, db?: DbHandle): Promise<BenefitDefinition | null> {
  const conn = db ?? (await getDb());
  await conn.update(benefitDefinitions).set(fields).where(eq(benefitDefinitions.id, id));
  const [updated] = await conn.select().from(benefitDefinitions).where(eq(benefitDefinitions.id, id)).limit(1);
  return updated ?? null;
}

export async function setBenefitDefinitionActive(id: number, active: boolean, db?: DbHandle): Promise<BenefitDefinition | null> {
  const conn = db ?? (await getDb());
  await conn.update(benefitDefinitions).set({ active }).where(eq(benefitDefinitions.id, id));
  const [updated] = await conn.select().from(benefitDefinitions).where(eq(benefitDefinitions.id, id)).limit(1);
  return updated ?? null;
}

export async function getBenefitDefinitionCommunities(benefitDefinitionId: number, db?: DbHandle): Promise<number[]> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({ communityId: benefitCommunities.communityId }).from(benefitCommunities)
    .where(eq(benefitCommunities.benefitDefinitionId, benefitDefinitionId));
  return rows.map(r => r.communityId);
}

/** Reemplaza el conjunto completo de comunidades de una definición — delete+insert dentro de una transacción, mismo patrón usado para M2M en otros módulos del proyecto. */
export async function setBenefitDefinitionCommunities(benefitDefinitionId: number, communityIds: number[], db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.transaction(async (tx) => {
    await tx.delete(benefitCommunities).where(eq(benefitCommunities.benefitDefinitionId, benefitDefinitionId));
    for (const communityId of communityIds) {
      await tx.insert(benefitCommunities).values({ benefitDefinitionId, communityId });
    }
  });
}

// ─── BENEFIT_RULES ───────────────────────────────────────────────────────────

export async function listBenefitRules(db?: DbHandle): Promise<BenefitRule[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(benefitRules).orderBy(desc(benefitRules.priority), desc(benefitRules.createdAt));
}

export async function getBenefitRuleById(id: number, db?: DbHandle): Promise<BenefitRule | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(benefitRules).where(eq(benefitRules.id, id)).limit(1);
  return row ?? null;
}

export async function createBenefitRule(input: InsertBenefitRule, db?: DbHandle): Promise<BenefitRule> {
  const conn = db ?? (await getDb());
  const insertResult = await conn.insert(benefitRules).values(input);
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [created] = await conn.select().from(benefitRules).where(eq(benefitRules.id, insertId)).limit(1);
  return created;
}

export async function updateBenefitRule(id: number, fields: Partial<InsertBenefitRule>, db?: DbHandle): Promise<BenefitRule | null> {
  const conn = db ?? (await getDb());
  await conn.update(benefitRules).set(fields).where(eq(benefitRules.id, id));
  const [updated] = await conn.select().from(benefitRules).where(eq(benefitRules.id, id)).limit(1);
  return updated ?? null;
}

export async function setBenefitRuleActive(id: number, active: boolean, db?: DbHandle): Promise<BenefitRule | null> {
  const conn = db ?? (await getDb());
  await conn.update(benefitRules).set({ active }).where(eq(benefitRules.id, id));
  const [updated] = await conn.select().from(benefitRules).where(eq(benefitRules.id, id)).limit(1);
  return updated ?? null;
}

// ─── USER_BENEFITS — admin "Concedidos" + CRM + estudiante ─────────────────

/**
 * SEGURIDAD: `qrToken`/`qrTokenHash` se excluyen EXPLÍCITAMENTE del tipo de
 * cualquier LISTADO (admin, CRM, ficha de venue) — ver informe de revisión
 * de seguridad Fase 4, punto 2. El secreto en claro solo debe poder salir
 * de `getUserBenefitWithDefinition` (un único beneficio, gateado por
 * ownership en el router), nunca de una consulta que devuelve varias filas.
 */
type UserBenefitSafeFields = Omit<UserBenefit, "qrToken" | "qrTokenHash">;

function omitQrSecret(row: UserBenefit): UserBenefitSafeFields {
  const { qrToken: _qrToken, qrTokenHash: _qrTokenHash, ...safe } = row;
  return safe;
}

function extractGrantReason(metadata: Record<string, unknown> | null): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const reason = (metadata as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.trim() ? reason : null;
}

export interface GrantedBenefitListItem extends UserBenefitSafeFields {
  definitionName: string;
  benefitType: string;
  studentName: string | null;
  sourceVenueName: string | null;
  destinationVenueName: string | null;
  /**
   * Motivo del grant manual — antes vivía sin tipar dentro de metadata.reason
   * (asimétrico respecto a cancellationReason, que sí es columna dedicada;
   * ver auditoría Student 360 §E). Se expone aquí ya extraído, null si no es
   * un grant manual o no tiene motivo registrado — el dato de origen (JSON)
   * no cambia, solo se deja de obligar al caller a parsearlo.
   */
  grantReason: string | null;
}

export interface GrantedBenefitFilters {
  /** "all" = sin restricción de comunidad (ya resuelto por communityAccess.ts). */
  communityIds: number[] | "all";
  userId?: number;
  status?: "active" | "used" | "expired" | "cancelled";
  benefitDefinitionId?: number;
  sourceVenueId?: number;
  destinationVenueId?: number;
  limit?: number;
  offset?: number;
}

export async function listGrantedBenefits(filters: GrantedBenefitFilters, db?: DbHandle): Promise<{ items: GrantedBenefitListItem[]; total: number }> {
  const conn = db ?? (await getDb());

  let restrictToVenueIds: number[] | null = null;
  if (filters.communityIds !== "all") {
    restrictToVenueIds = await getVenueIdsInCommunities(filters.communityIds, conn);
    if (restrictToVenueIds.length === 0) return { items: [], total: 0 };
  }

  const conditions: SQL[] = [];
  if (filters.userId) conditions.push(eq(userBenefits.userId, filters.userId));
  if (filters.status) conditions.push(eq(userBenefits.status, filters.status));
  if (filters.benefitDefinitionId) conditions.push(eq(userBenefits.benefitDefinitionId, filters.benefitDefinitionId));
  if (filters.sourceVenueId) conditions.push(eq(userBenefits.sourceVenueId, filters.sourceVenueId));
  if (filters.destinationVenueId) conditions.push(eq(benefitDefinitions.destinationVenueId, filters.destinationVenueId));
  if (restrictToVenueIds) {
    // comunidad se resuelve por el venue DESTINO de la definición (donde realmente se canjea).
    conditions.push(inArray(benefitDefinitions.destinationVenueId, restrictToVenueIds));
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const baseQuery = conn
    .select({ ub: userBenefits, def: benefitDefinitions, student: users })
    .from(userBenefits)
    .innerJoin(benefitDefinitions, eq(userBenefits.benefitDefinitionId, benefitDefinitions.id))
    .leftJoin(users, eq(userBenefits.userId, users.id));

  const rows = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .orderBy(desc(userBenefits.grantedAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  const countQuery = conn.select({ ub: userBenefits }).from(userBenefits)
    .innerJoin(benefitDefinitions, eq(userBenefits.benefitDefinitionId, benefitDefinitions.id));
  const countRows = await (whereClause ? countQuery.where(whereClause) : countQuery);

  const venueIds = Array.from(new Set([
    ...rows.map(r => r.ub.sourceVenueId).filter((v): v is number => v != null),
    ...rows.map(r => r.def.destinationVenueId).filter((v): v is number => v != null),
  ]));
  const venueRows = venueIds.length > 0
    ? await conn.select({ id: venues.id, name: venues.name }).from(venues).where(inArray(venues.id, venueIds))
    : [];
  const venueNameById = new Map(venueRows.map(v => [v.id, v.name]));

  const items: GrantedBenefitListItem[] = rows.map(r => ({
    ...omitQrSecret(r.ub),
    definitionName: r.def.name,
    benefitType: r.def.benefitType,
    studentName: r.student?.name ?? null,
    sourceVenueName: r.ub.sourceVenueId != null ? (venueNameById.get(r.ub.sourceVenueId) ?? null) : null,
    destinationVenueName: r.def.destinationVenueId != null ? (venueNameById.get(r.def.destinationVenueId) ?? null) : null,
    grantReason: extractGrantReason(r.ub.metadata),
  }));

  return { items, total: countRows.length };
}

/** Forma "de listado" — SIN qrToken/qrTokenHash. Usada por myBenefits (varios beneficios a la vez). */
export interface UserBenefitListItemWithDefinition extends UserBenefitSafeFields {
  definition: BenefitDefinition;
}

/** Forma "de detalle" — SÍ incluye qrToken/qrTokenHash (fila completa). Solo debe usarla getUserBenefitWithDefinition, consumida por un único endpoint gateado por ownership (server/routers/benefits.ts, getMyBenefit). */
export interface UserBenefitWithDefinition extends UserBenefit {
  definition: BenefitDefinition;
}

/** "Mis Beneficios" — estudiante, sus propios beneficios únicamente. Listado: nunca lleva el secreto del QR. */
export async function listUserBenefits(userId: number, db?: DbHandle): Promise<UserBenefitListItemWithDefinition[]> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({ ub: userBenefits, def: benefitDefinitions }).from(userBenefits)
    .innerJoin(benefitDefinitions, eq(userBenefits.benefitDefinitionId, benefitDefinitions.id))
    .where(eq(userBenefits.userId, userId))
    .orderBy(desc(userBenefits.grantedAt));
  return rows.map(r => ({ ...omitQrSecret(r.ub), definition: r.def }));
}

/**
 * Detalle de UN beneficio — incluye qrToken/qrTokenHash a propósito: es la
 * única función que alimenta getMyBenefit, que decide si revelarlo o no
 * (ownership + vigencia) ANTES de que llegue a la respuesta HTTP. No usar
 * esta función para listados — para eso está listUserBenefits/listGrantedBenefits.
 */
export async function getUserBenefitWithDefinition(id: number, db?: DbHandle): Promise<UserBenefitWithDefinition | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select({ ub: userBenefits, def: benefitDefinitions }).from(userBenefits)
    .innerJoin(benefitDefinitions, eq(userBenefits.benefitDefinitionId, benefitDefinitions.id))
    .where(eq(userBenefits.id, id)).limit(1);
  if (!row) return null;
  return { ...row.ub, definition: row.def };
}

// ─── VENUE DETAIL — generados (origen) vs canjeados (destino) ──────────────
// Separación explícita origen≠destino (spec Fase 4, punto 29/30): "generados"
// cuenta beneficios cuyo source_venue_id es este venue; "canjeados" cuenta
// los cuyo used_at_venue_id es este venue — miden tráfico cruzado real.

export interface VenueBenefitStats {
  generatedCount: number;
  redeemedCount: number;
}

export async function getVenueBenefitStats(venueId: number, db?: DbHandle): Promise<VenueBenefitStats> {
  const conn = db ?? (await getDb());
  const [generatedRows, redeemedRows] = await Promise.all([
    conn.select({ id: userBenefits.id }).from(userBenefits).where(eq(userBenefits.sourceVenueId, venueId)),
    conn.select({ id: userBenefits.id }).from(userBenefits).where(eq(userBenefits.usedAtVenueId, venueId)),
  ]);
  return { generatedCount: generatedRows.length, redeemedCount: redeemedRows.length };
}

// ─── REDEMPTION ATTEMPTS — auditoría antifraude ────────────────────────────

export async function listBenefitRedemptionAttempts(
  filters: { userBenefitId?: number; venueId?: number; result?: string; limit?: number; offset?: number },
  db?: DbHandle
): Promise<BenefitRedemptionAttempt[]> {
  const conn = db ?? (await getDb());
  const conditions: SQL[] = [];
  if (filters.userBenefitId) conditions.push(eq(benefitRedemptionAttempts.userBenefitId, filters.userBenefitId));
  if (filters.venueId) conditions.push(eq(benefitRedemptionAttempts.venueId, filters.venueId));
  if (filters.result) conditions.push(eq(benefitRedemptionAttempts.result, filters.result as BenefitRedemptionAttempt["result"]));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const baseQuery = conn.select().from(benefitRedemptionAttempts);
  return (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .orderBy(desc(benefitRedemptionAttempts.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);
}

// ─── VENUE_STAFF — asignación de personal a venue (admin) ──────────────────

export async function listVenueStaff(venueId?: number, db?: DbHandle): Promise<Array<VenueStaff & { userName: string | null; venueName: string }>> {
  const conn = db ?? (await getDb());
  const baseQuery = conn.select({ vs: venueStaff, userName: users.name, venueName: venues.name }).from(venueStaff)
    .innerJoin(venues, eq(venueStaff.venueId, venues.id))
    .leftJoin(users, eq(venueStaff.userId, users.id));
  const rows = await (venueId ? baseQuery.where(eq(venueStaff.venueId, venueId)) : baseQuery);
  return rows.map(r => ({ ...r.vs, userName: r.userName, venueName: r.venueName }));
}

export async function addVenueStaff(userId: number, venueId: number, db?: DbHandle): Promise<VenueStaff> {
  const conn = db ?? (await getDb());
  try {
    await conn.insert(venueStaff).values({ userId, venueId });
  } catch (err) {
    if (!(err && typeof err === "object" && "errno" in err && (err as { errno?: number }).errno === 1062)) throw err;
    await conn.update(venueStaff).set({ active: true }).where(and(eq(venueStaff.userId, userId), eq(venueStaff.venueId, venueId)));
  }
  const [row] = await conn.select().from(venueStaff).where(and(eq(venueStaff.userId, userId), eq(venueStaff.venueId, venueId))).limit(1);
  return row;
}

export async function removeVenueStaff(userId: number, venueId: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(venueStaff).set({ active: false }).where(and(eq(venueStaff.userId, userId), eq(venueStaff.venueId, venueId)));
}
