/**
 * historicalIdentityService.ts — Historical Fourvenues Identity → Segolife
 * Student (SEGOLIFE — HISTORICAL STUDENT IDENTITY CLAIM).
 *
 * PRINCIPIO (spec §2): FOURVENUES IDENTITY != SEGOLIFE USER. Una identidad
 * histórica es una AGREGACIÓN COMPUTADA sobre `unresolved_operations`
 * (provider="fourvenues_integrations") — nunca una tabla nueva (spec §9:
 * "REUSE FIRST... NO CREES TABLAS NUEVAS POR COMODIDAD"). No existe fila
 * "Historical Identity" en BD: su identificador (`identityKey`) es
 * `email:<normalizado>` o, si no hay email, `phone:<normalizado>`.
 *
 * ONE IDENTITY RESOLUTION ENGINE (spec §17/§54): `classifyMatch()` es la
 * ÚNICA función que decide si una identidad histórica coincide con un
 * usuario Segolife real — la llaman por igual el registro de estudiantes,
 * el directorio admin y el claim manual. Nunca se duplica esta lógica.
 *
 * NUNCA fuzzy-match por nombre (spec §12). NUNCA infiere comunidad (spec
 * §34). NUNCA concede loyalty — toda resolución retroactiva de attendance
 * pasa `suppressLoyalty:true` incondicionalmente (spec §32), nunca depende
 * de `venue_integrations.loyaltyEnabled` ni de ningún flag opcional (ver
 * nota IMPORTANTE más abajo sobre `linkUnresolvedOperation`/`integrations.ts`).
 */
import { eq, and, or, inArray, sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  unresolvedOperations, users, studentProfiles, events, venues, eventTickets,
  type UnresolvedOperation,
} from "../../../drizzle/schema";
import { linkUnresolvedOperation, ignoreUnresolvedOperation, UnresolvedOperationError } from "../integrations/unresolvedOperationsService";
import { ingestAttendance } from "../ticketing/attendancePipeline";
import { recordStudentAdminAction } from "./studentAdminActionsDb";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
async function getDb(): Promise<DbHandle> { return _db; }

const PROVIDER = "fourvenues_integrations";

// ─── Normalización (spec §13) ──────────────────────────────────────────────

/** Idéntico a identityResolver.ts:normalizeEmail — trim + lowercase, nada agresivo (sin gmail-dots/+alias). */
export function normalizeEmail(email: string | null | undefined): string | null {
  return email ? email.trim().toLowerCase() : null;
}

/**
 * Normalización CONSERVADORA (spec §13): solo trim + quitar espacios/
 * guiones/paréntesis/puntos + "00" → "+". NUNCA asume prefijo +34 para un
 * número ambiguo sin evidencia — un número de 9 dígitos sin prefijo se deja
 * TAL CUAL (no se le antepone país). Esto significa que el match por
 * teléfono solo será determinista cuando ambos lados (histórico Fourvenues
 * y alta de estudiante) usen la misma convención de formato — limitación
 * real, documentada, no oculta (ver informe final, Historical Claim
 * Readiness).
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let v = phone.trim().replace(/[\s\-().]/g, "");
  if (v.startsWith("00")) v = "+" + v.slice(2);
  return v || null;
}

export function identityKeyFor(email: string | null | undefined, phone: string | null | undefined): string | null {
  const e = normalizeEmail(email);
  if (e) return `email:${e}`;
  const p = normalizePhone(phone);
  if (p) return `phone:${p}`;
  return null;
}

// ─── Niveles de confianza (spec §14) ───────────────────────────────────────

export type MatchConfidence =
  | "EXACT_EMAIL_AND_PHONE"
  | "EXACT_EMAIL"
  | "EXACT_PHONE"
  | "CONFLICT_EMAIL_PHONE"
  | "AMBIGUOUS"
  | "NO_MATCH";

export interface MatchResult {
  confidence: MatchConfidence;
  /** userId candidato — solo presente si confidence no es CONFLICT/AMBIGUOUS/NO_MATCH. */
  candidateUserId: number | null;
  /** Solo en CONFLICT_EMAIL_PHONE: el userId que el teléfono señala, distinto del de email. */
  conflictUserId?: number | null;
}

/**
 * ONE IDENTITY RESOLUTION ENGINE (spec §17) — dado un email/teléfono
 * (de una identidad histórica O de un estudiante recién registrado), decide
 * si coincide de forma determinista con un usuario Segolife real. NUNCA
 * fuzzy, NUNCA por nombre. Igual que identityResolver.ts, nunca elige la
 * primera fila de una ambigüedad.
 */
export async function classifyMatch(email: string | null | undefined, phone: string | null | undefined, db?: DbHandle): Promise<MatchResult> {
  const conn = db ?? (await getDb());
  const normEmail = normalizeEmail(email);
  const normPhone = normalizePhone(phone);

  let emailUserId: number | null = null;
  if (normEmail) {
    const rows = await conn.select({ id: users.id }).from(users).where(eq(users.email, normEmail)).limit(2);
    if (rows.length === 1) emailUserId = rows[0].id;
    else if (rows.length > 1) return { confidence: "AMBIGUOUS", candidateUserId: null }; // defensa en profundidad — email es UNIQUE real
  }

  let phoneUserId: number | null = null;
  let phoneAmbiguous = false;
  if (normPhone) {
    const rows = await conn.select({ id: users.id }).from(users).where(eq(users.phone, normPhone)).limit(2);
    if (rows.length === 1) phoneUserId = rows[0].id;
    else if (rows.length > 1) phoneAmbiguous = true; // phone SIN unique real — 2+ Students pueden compartirlo
  }

  if (emailUserId && phoneUserId) {
    if (emailUserId === phoneUserId) return { confidence: "EXACT_EMAIL_AND_PHONE", candidateUserId: emailUserId };
    return { confidence: "CONFLICT_EMAIL_PHONE", candidateUserId: null, conflictUserId: phoneUserId };
  }
  if (emailUserId) return { confidence: "EXACT_EMAIL", candidateUserId: emailUserId };
  if (phoneUserId) return { confidence: "EXACT_PHONE", candidateUserId: phoneUserId };
  if (phoneAmbiguous) return { confidence: "AMBIGUOUS", candidateUserId: null };
  return { confidence: "NO_MATCH", candidateUserId: null };
}

// ─── Directorio admin — agregación (spec §5, §58-59) ───────────────────────

export interface HistoricalIdentityListItem {
  identityKey: string;
  /**
   * Nombre completo tal cual lo entrega Fourvenues — UN SOLO campo, nunca
   * separado en nombre/apellidos (el proveedor no distingue esos dos
   * campos; partir el string por espacios sería un heurístico no fiable —
   * ver informe, auditoría real: nombres de 1 a 4 palabras). Cuando la
   * misma identidad trae variantes distintas entre operaciones (~37% de los
   * casos, real, auditado), se usa la de la operación MÁS RECIENTE — nunca
   * se usa para matching, solo presentación (spec §1/§9: "NO fuzzy matching").
   */
  name: string | null;
  email: string | null;
  phone: string | null;
  eventsCount: number;
  ticketsCount: number;
  attendanceCount: number;
  historicalSpendCents: number;
  firstActivity: string;
  lastActivity: string;
  venueIds: number[];
  crossVenue: boolean;
  status: "UNREGISTERED" | "POSSIBLE_MATCH" | "AUTO_MATCH_CANDIDATE" | "LINKED" | "CONFLICT";
  linkedUserId: number | null;
}

export interface ListHistoricalIdentitiesFilters {
  search?: string;
  venueId?: number;
  crossVenueOnly?: boolean;
  status?: HistoricalIdentityListItem["status"];
  limit: number;
  offset: number;
  sortBy: "lastActivity" | "eventsCount" | "historicalSpendCents" | "venueIds";
  sortDir: "asc" | "desc";
}

/**
 * Agrega TODAS las unresolved_operations (spec §58: 6.086 identidades, sin
 * N+1) en memoria de un único query, agrupadas por identityKey. La escala
 * actual (decenas de miles de filas, un puñado de KB por fila) cabe
 * cómodamente en memoria de un proceso Node — el mismo criterio de
 * trade-off ya documentado en studentActivityAggregator.ts. El match contra
 * `users` se resuelve con UN solo SELECT de toda la tabla (4 filas reales
 * hoy) en vez de N queries — ver nota de performance en el informe.
 */
async function loadAllIdentityGroups(db?: DbHandle): Promise<Map<string, HistoricalIdentityListItem & { rows: UnresolvedOperation[] }>> {
  const conn = db ?? (await getDb());
  const rows = await conn.select().from(unresolvedOperations).where(
    and(eq(unresolvedOperations.provider, PROVIDER), inArray(unresolvedOperations.venueId, [1, 4, 7]))
  );

  const allUsers = await conn.select({ id: users.id, email: users.email, phone: users.phone }).from(users);
  const usersByEmail = new Map<string, number>();
  const usersByPhone = new Map<string, number[]>();
  for (const u of allUsers) {
    if (u.email) usersByEmail.set(normalizeEmail(u.email)!, u.id);
    if (u.phone) {
      const key = normalizePhone(u.phone)!;
      usersByPhone.set(key, [...(usersByPhone.get(key) ?? []), u.id]);
    }
  }

  const groups = new Map<string, HistoricalIdentityListItem & { rows: UnresolvedOperation[] }>();
  for (const r of rows) {
    const key = identityKeyFor(r.identityHintEmail, r.identityHintPhone);
    if (!key) continue; // sin ningún indicio de contacto — nunca forma parte del directorio (nada que reclamar)

    let g = groups.get(key);
    if (!g) {
      g = {
        identityKey: key, name: r.identityHintName ?? null,
        email: r.identityHintEmail ? normalizeEmail(r.identityHintEmail) : null,
        phone: r.identityHintPhone ? normalizePhone(r.identityHintPhone) : null,
        eventsCount: 0, ticketsCount: 0, attendanceCount: 0, historicalSpendCents: 0,
        firstActivity: r.occurredAt?.toISOString() ?? new Date(0).toISOString(),
        lastActivity: r.occurredAt?.toISOString() ?? new Date(0).toISOString(),
        venueIds: [], crossVenue: false, status: "UNREGISTERED", linkedUserId: null, rows: [],
      };
      groups.set(key, g);
    }
    g.rows.push(r);
    if (r.operationType === "order") { g.ticketsCount++; g.historicalSpendCents += r.amountCents ?? 0; }
    if (r.operationType === "attendance") g.attendanceCount++;
    if (r.venueId && !g.venueIds.includes(r.venueId)) g.venueIds.push(r.venueId);
    // Nombre de la operación MÁS RECIENTE (nunca decide matching — solo presentación, spec §9).
    if (r.identityHintName && r.occurredAt && (!g.lastActivity || r.occurredAt.toISOString() >= g.lastActivity)) {
      g.name = r.identityHintName;
    }
    const occ = r.occurredAt?.toISOString();
    if (occ && occ < g.firstActivity) g.firstActivity = occ;
    if (occ && occ > g.lastActivity) g.lastActivity = occ;
  }

  for (const g of Array.from(groups.values())) {
    g.eventsCount = new Set(g.rows.map(r => r.eventId).filter((v): v is number => v != null)).size;
    g.crossVenue = g.venueIds.length > 1;

    const linkedRows = g.rows.filter(r => r.status === "linked" && r.linkedUserId != null);
    if (linkedRows.length > 0) {
      const distinctLinkedUsers = new Set(linkedRows.map(r => r.linkedUserId));
      if (distinctLinkedUsers.size > 1) { g.status = "CONFLICT"; g.linkedUserId = null; }
      else { g.status = "LINKED"; g.linkedUserId = linkedRows[0].linkedUserId; }
      continue;
    }

    // Sin ningún row linked todavía — clasificar contra `users` en memoria (sin N+1).
    const emailMatch = g.email ? usersByEmail.get(g.email) ?? null : null;
    const phoneMatches = g.phone ? (usersByPhone.get(g.phone) ?? []) : [];
    if (emailMatch && phoneMatches.length === 1 && phoneMatches[0] === emailMatch) g.status = "AUTO_MATCH_CANDIDATE";
    else if (emailMatch && phoneMatches.length === 1 && phoneMatches[0] !== emailMatch) g.status = "CONFLICT";
    else if (emailMatch || phoneMatches.length === 1) g.status = "POSSIBLE_MATCH";
    else g.status = "UNREGISTERED";
  }

  return groups;
}

export async function listHistoricalIdentities(filters: ListHistoricalIdentitiesFilters, db?: DbHandle): Promise<{ items: HistoricalIdentityListItem[]; total: number }> {
  const groups = await loadAllIdentityGroups(db);
  let items = Array.from(groups.values());

  if (filters.venueId) items = items.filter(g => g.venueIds.includes(filters.venueId!));
  if (filters.crossVenueOnly) items = items.filter(g => g.crossVenue);
  if (filters.status) items = items.filter(g => g.status === filters.status);
  if (filters.search?.trim()) {
    // Búsqueda por nombre/email/teléfono — SOLO presentación/localización,
    // nunca alimenta classifyMatch() (spec §9: el nombre no decide matching).
    const q = filters.search.trim().toLowerCase();
    items = items.filter(g =>
      (g.name && g.name.toLowerCase().includes(q)) ||
      (g.email && g.email.includes(q)) ||
      (g.phone && g.phone.includes(q)) ||
      g.identityKey.includes(q)
    );
  }

  const dir = filters.sortDir === "asc" ? 1 : -1;
  items.sort((a, b) => {
    const av = filters.sortBy === "venueIds" ? a.venueIds.length : (a as unknown as Record<string, string | number>)[filters.sortBy];
    const bv = filters.sortBy === "venueIds" ? b.venueIds.length : (b as unknown as Record<string, string | number>)[filters.sortBy];
    return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
  });

  const total = items.length;
  const page = items.slice(filters.offset, filters.offset + filters.limit).map(({ rows: _rows, ...rest }) => rest);
  return { items: page, total };
}

// ─── Ficha detalle (spec §7-8) ─────────────────────────────────────────────

export interface HistoricalIdentityDetail extends HistoricalIdentityListItem {
  venueBreakdown: Array<{ venueId: number; venueName: string; eventsCount: number; ticketsCount: number; attendanceCount: number; spendCents: number }>;
  timeline: Array<{ operationId: number; operationType: string; occurredAt: string; eventId: number | null; eventName: string | null; venueId: number | null; amountCents: number | null; status: string }>;
  matchDetail: MatchResult;
}

export async function getHistoricalIdentityDetail(identityKey: string, db?: DbHandle): Promise<HistoricalIdentityDetail | null> {
  const conn = db ?? (await getDb());
  const groups = await loadAllIdentityGroups(conn);
  const g = groups.get(identityKey);
  if (!g) return null;

  const eventIds = Array.from(new Set(g.rows.map(r => r.eventId).filter((v): v is number => v != null)));
  const eventNames = new Map<number, string>();
  if (eventIds.length > 0) {
    const evRows = await conn.select({ id: events.id, name: events.name }).from(events).where(inArray(events.id, eventIds));
    for (const e of evRows) eventNames.set(e.id, e.name);
  }
  const venueRows = await conn.select({ id: venues.id, name: venues.name }).from(venues).where(inArray(venues.id, g.venueIds.length ? g.venueIds : [0]));
  const venueNames = new Map(venueRows.map(v => [v.id, v.name]));

  const venueBreakdown = g.venueIds.map(venueId => {
    const rowsForVenue = g.rows.filter(r => r.venueId === venueId);
    return {
      venueId, venueName: venueNames.get(venueId) ?? `Venue #${venueId}`,
      eventsCount: new Set(rowsForVenue.map(r => r.eventId).filter((v): v is number => v != null)).size,
      ticketsCount: rowsForVenue.filter(r => r.operationType === "order").length,
      attendanceCount: rowsForVenue.filter(r => r.operationType === "attendance").length,
      spendCents: rowsForVenue.reduce((sum, r) => sum + (r.operationType === "order" ? (r.amountCents ?? 0) : 0), 0),
    };
  });

  const timeline = g.rows
    .sort((a, b) => (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0))
    .map(r => ({
      operationId: r.id, operationType: r.operationType, occurredAt: r.occurredAt?.toISOString() ?? new Date(0).toISOString(),
      eventId: r.eventId, eventName: r.eventId ? eventNames.get(r.eventId) ?? null : null, venueId: r.venueId,
      amountCents: r.amountCents, status: r.status,
    }));

  const matchDetail = g.status === "LINKED" || g.status === "CONFLICT"
    ? { confidence: g.status === "LINKED" ? "EXACT_EMAIL_AND_PHONE" as const : "CONFLICT_EMAIL_PHONE" as const, candidateUserId: g.linkedUserId }
    : await classifyMatch(g.email, g.phone, conn);

  const { rows: _rows, ...rest } = g;
  return { ...rest, venueBreakdown, timeline, matchDetail };
}

// ─── Claim / Unclaim (spec §18-19, §44-46) ─────────────────────────────────

export type ClaimResultStatus = "CLAIMED" | "ALREADY_CLAIMED_BY_THIS_USER" | "CLAIM_CONFLICT";

export interface ClaimResult {
  status: ClaimResultStatus;
  identityKey: string;
  userId: number;
  operationsLinked: number;
  operationsAlreadyLinked: number;
  ticketsAttributed: number;
  attendanceMaterialized: number;
}

/**
 * CLAIM HISTORICAL IDENTITY — vincula TODAS las unresolved_operations de una
 * identityKey a un userId real. Idempotente (spec §44): repetir el mismo
 * claim nunca duplica nada; si TODAS las filas ya están linked a este mismo
 * userId, devuelve ALREADY_CLAIMED_BY_THIS_USER sin tocar nada. Si alguna
 * fila ya está linked a OTRO userId, devuelve CLAIM_CONFLICT sin tocar nada
 * (spec §41: nunca reassignment automático).
 *
 * SEGURIDAD (spec §19): el caller (router) es responsable de que `userId`
 * proceda del usuario AUTENTICADO o de un admin con permiso — esta función
 * nunca confía en un userId de cliente sin ese contexto ya validado.
 *
 * LOYALTY (spec §32): `ingestAttendance()` se llama SIEMPRE con
 * `suppressLoyalty: true` — nunca condicionado a `venue_integrations.
 * loyaltyEnabled` ni a ningún flag opcional (a diferencia del mutation
 * legacy `integrations.linkUnresolved`, que NO pasa este flag — ver
 * hallazgo documentado en el informe final; no se toca ese código legacy en
 * esta fase, pero este motor nunca hereda su comportamiento).
 */
export async function claimHistoricalIdentity(
  input: { identityKey: string; userId: number; actorUserId: number; method: string; reason?: string | null },
  db?: DbHandle
): Promise<ClaimResult> {
  const conn = db ?? (await getDb());
  const groups = await loadAllIdentityGroups(conn);
  const g = groups.get(input.identityKey);
  if (!g) throw new HistoricalIdentityError("NOT_FOUND", "Identidad histórica no encontrada");

  const linkedRows = g.rows.filter(r => r.status === "linked");
  if (linkedRows.length > 0) {
    const distinctUsers = new Set(linkedRows.map(r => r.linkedUserId));
    if (distinctUsers.size === 1 && distinctUsers.has(input.userId) && linkedRows.length === g.rows.length) {
      return { status: "ALREADY_CLAIMED_BY_THIS_USER", identityKey: input.identityKey, userId: input.userId, operationsLinked: 0, operationsAlreadyLinked: linkedRows.length, ticketsAttributed: 0, attendanceMaterialized: 0 };
    }
    if (!distinctUsers.has(input.userId) || distinctUsers.size > 1) {
      return { status: "CLAIM_CONFLICT", identityKey: input.identityKey, userId: input.userId, operationsLinked: 0, operationsAlreadyLinked: linkedRows.length, ticketsAttributed: 0, attendanceMaterialized: 0 };
    }
  }

  let operationsLinked = 0, ticketsAttributed = 0, attendanceMaterialized = 0;
  const pending = g.rows.filter(r => r.status === "unresolved");

  for (const r of pending) {
    let linked: UnresolvedOperation;
    try {
      linked = await linkUnresolvedOperation(r.id, input.userId, input.actorUserId, conn);
    } catch (err) {
      if (err instanceof UnresolvedOperationError && err.code === "ALREADY_RESOLVED") continue; // carrera — otra llamada ya la resolvió
      throw err;
    }
    operationsLinked++;

    if (linked.operationType === "order" && linked.referenceType === "event_ticket" && linked.referenceId) {
      await conn.update(eventTickets).set({ userId: input.userId }).where(eq(eventTickets.id, linked.referenceId));
      ticketsAttributed++;
    }
    if (linked.operationType === "attendance" && linked.eventId) {
      const result = await ingestAttendance({
        provider: linked.provider,
        integrationType: linked.integrationType ?? null,
        integrationId: linked.integrationId ?? null,
        eventId: linked.eventId,
        venueId: linked.venueId ?? null,
        resolvedUserId: input.userId,
        suppressLoyalty: true, // spec §32 — INCONDICIONAL, nunca depende de loyaltyEnabled del venue.
        // Loyalty Shadow Mode (spec §25 de esa fase — "no hacer replay automático"):
        // un claim histórico nunca debe generar una observación Shadow como si fuera tráfico en vivo.
        isHistoricalImport: true,
        attendance: {
          externalAttendanceId: linked.externalReferenceId ?? `unresolved:${linked.id}`,
          externalEventId: String(linked.eventId),
          participant: { email: linked.identityHintEmail, phone: linked.identityHintPhone, name: linked.identityHintName },
          occurredAt: linked.occurredAt ?? new Date(),
        },
      }, conn);
      if (result.status === "processed") attendanceMaterialized++;
    }
  }

  const studentProfileId = await getStudentProfileId(input.userId, conn);
  if (studentProfileId) {
    await recordStudentAdminAction({
      studentProfileId, actorUserId: input.actorUserId, action: "historical_identity_claimed",
      beforeValue: null, afterValue: input.identityKey,
      reason: input.reason ?? null,
      metadata: { identityKey: input.identityKey, method: input.method, operationsLinked, ticketsAttributed, attendanceMaterialized },
    }, conn);
  }

  return { status: "CLAIMED", identityKey: input.identityKey, userId: input.userId, operationsLinked, operationsAlreadyLinked: linkedRows.length, ticketsAttributed, attendanceMaterialized };
}

export interface UnclaimResult {
  identityKey: string;
  operationsReverted: number;
  ticketsReverted: number;
  attendanceRemoved: number;
}

/**
 * ADMIN CORRECTION (spec §45) — revierte un claim. NUNCA hard-delete de
 * evidencia Fourvenues (orders/tickets/events permanecen intactos): solo
 * revierte lo que el claim añadió — `event_tickets.userId` vuelve a NULL,
 * las filas de `event_attendance` MATERIALIZADAS por el claim se eliminan
 * (seguro: se crearon con `suppressLoyalty:true`, por lo que
 * `tokensLedgerId` es SIEMPRE null — nunca hay loyalty que revertir), y
 * `unresolved_operations` vuelve a `status="unresolved"`.
 */
export async function unclaimHistoricalIdentity(
  input: { identityKey: string; actorUserId: number; reason: string },
  db?: DbHandle
): Promise<UnclaimResult> {
  if (!input.reason?.trim()) throw new HistoricalIdentityError("REASON_REQUIRED", "El unclaim requiere un motivo");
  const conn = db ?? (await getDb());
  const groups = await loadAllIdentityGroups(conn);
  const g = groups.get(input.identityKey);
  if (!g) throw new HistoricalIdentityError("NOT_FOUND", "Identidad histórica no encontrada");

  const linkedRows = g.rows.filter(r => r.status === "linked");
  if (linkedRows.length === 0) throw new HistoricalIdentityError("NOT_LINKED", "Esta identidad no está vinculada");
  const userId = linkedRows[0].linkedUserId!;

  let ticketsReverted = 0, attendanceRemoved = 0;
  for (const r of linkedRows) {
    if (r.operationType === "order" && r.referenceType === "event_ticket" && r.referenceId) {
      await conn.update(eventTickets).set({ userId: null }).where(and(eq(eventTickets.id, r.referenceId), eq(eventTickets.userId, userId)));
      ticketsReverted++;
    }
    if (r.operationType === "attendance" && r.eventId) {
      const idempotencyKey = `${r.provider}:${r.integrationType ?? "native"}:${r.integrationId ?? 0}:${r.externalReferenceId ?? `unresolved:${r.id}`}`;
      const [deleteResult] = await conn.execute(drizzleSql`DELETE FROM event_attendance WHERE idempotency_key = ${idempotencyKey} AND tokens_ledger_id IS NULL`);
      attendanceRemoved += (deleteResult as unknown as { affectedRows: number }).affectedRows ?? 0;
    }
    await conn.update(unresolvedOperations)
      .set({ status: "unresolved", linkedUserId: null, linkedByUserId: null, linkedAt: null })
      .where(eq(unresolvedOperations.id, r.id));
  }

  const studentProfileId = await getStudentProfileId(userId, conn);
  if (studentProfileId) {
    await recordStudentAdminAction({
      studentProfileId, actorUserId: input.actorUserId, action: "historical_identity_unclaimed",
      beforeValue: input.identityKey, afterValue: null, reason: input.reason,
      metadata: { identityKey: input.identityKey, ticketsReverted, attendanceRemoved },
    }, conn);
  }

  return { identityKey: input.identityKey, operationsReverted: linkedRows.length, ticketsReverted, attendanceRemoved };
}

async function getStudentProfileId(userId: number, db: DbHandle): Promise<number | null> {
  const [row] = await db.select({ id: studentProfiles.id }).from(studentProfiles).where(eq(studentProfiles.userId, userId)).limit(1);
  return row?.id ?? null;
}

export class HistoricalIdentityError extends Error {
  constructor(public code: "NOT_FOUND" | "NOT_LINKED" | "REASON_REQUIRED", message: string) {
    super(message);
    this.name = "HistoricalIdentityError";
  }
}

// ─── Estadísticas agregadas para el Admin Command Center (spec §15) ────────
// Una SOLA pasada sobre loadAllIdentityGroups (ya calcula status/crossVenue
// por identidad) — nunca 5 llamadas a listHistoricalIdentities con filtros
// distintos, que repetiría el escaneo completo de unresolved_operations
// cinco veces.

export interface HistoricalIdentityStats {
  total: number;
  unregistered: number;
  possibleMatch: number;
  autoMatchCandidate: number;
  linked: number;
  conflict: number;
  crossVenue: number;
}

export async function getHistoricalIdentityStats(db?: DbHandle): Promise<HistoricalIdentityStats> {
  const groups = await loadAllIdentityGroups(db);
  const stats: HistoricalIdentityStats = { total: 0, unregistered: 0, possibleMatch: 0, autoMatchCandidate: 0, linked: 0, conflict: 0, crossVenue: 0 };
  for (const g of Array.from(groups.values())) {
    stats.total++;
    if (g.crossVenue) stats.crossVenue++;
    switch (g.status) {
      case "UNREGISTERED": stats.unregistered++; break;
      case "POSSIBLE_MATCH": stats.possibleMatch++; break;
      case "AUTO_MATCH_CANDIDATE": stats.autoMatchCandidate++; break;
      case "LINKED": stats.linked++; break;
      case "CONFLICT": stats.conflict++; break;
    }
  }
  return stats;
}

export interface HistoricalIdentityVenueStat {
  venueId: number;
  total: number;
  crossVenue: number;
}

/**
 * Desglose por venue (Command Center §14, Venue Performance) — reutiliza la
 * MISMA agregación de un solo pase (`loadAllIdentityGroups`) en vez de
 * llamar a `listHistoricalIdentities({venueId})` una vez por venue, que
 * repetiría el escaneo completo de `unresolved_operations` por cada venue.
 * Una identidad cross-venue cuenta en el total de CADA venue que tocó (spec:
 * mostrar Historical Audience por venue, no forzar una identidad a un único
 * venue "dueño").
 */
export async function getHistoricalIdentityStatsByVenue(db?: DbHandle): Promise<HistoricalIdentityVenueStat[]> {
  const groups = await loadAllIdentityGroups(db);
  const byVenue = new Map<number, HistoricalIdentityVenueStat>();
  for (const g of Array.from(groups.values())) {
    for (const venueId of g.venueIds) {
      let v = byVenue.get(venueId);
      if (!v) { v = { venueId, total: 0, crossVenue: 0 }; byVenue.set(venueId, v); }
      v.total++;
      if (g.crossVenue) v.crossVenue++;
    }
  }
  return Array.from(byVenue.values());
}

// ─── Entrada para el Historical Reward Simulator (Live Loyalty Design) ─────
// Reutiliza la MISMA agregación canónica (`loadAllIdentityGroups`) en vez de
// que el simulador vuelva a consultar/agrupar `unresolved_operations` por su
// cuenta — spec "REUSE FIRST", ya aplicado en esta fase para el directorio
// admin. `isKnownStudent` = status "LINKED" (claim real ya ejecutado), nunca
// POSSIBLE_MATCH/AUTO_MATCH_CANDIDATE (esos son candidatos, no Students
// confirmados) — el simulador calcula aparte, como análisis explícito, qué
// habrían ganado los NO-Students "si lo hubieran sido" (spec Historical
// Simulation, distinción Students conocidos vs identidades históricas).

export interface SimulationRow {
  operationType: "order" | "attendance";
  occurredAt: Date;
  eventId: number | null;
  venueId: number | null;
  amountCents: number | null;
}

export interface SimulationIdentity {
  identityKey: string;
  isKnownStudent: boolean;
  rows: SimulationRow[];
}

export async function loadHistoricalSimulationInput(db?: DbHandle): Promise<SimulationIdentity[]> {
  const groups = await loadAllIdentityGroups(db);
  return Array.from(groups.values()).map(g => ({
    identityKey: g.identityKey,
    isKnownStudent: g.status === "LINKED",
    rows: g.rows
      .filter((r): r is UnresolvedOperation & { operationType: "order" | "attendance" } => r.operationType === "order" || r.operationType === "attendance")
      .map(r => ({
        operationType: r.operationType,
        occurredAt: r.occurredAt ?? new Date(0),
        eventId: r.eventId,
        venueId: r.venueId,
        amountCents: r.amountCents,
      })),
  }));
}

// ─── Búsqueda indexada acotada a UNA identidad (spec §26) ──────────────────

/**
 * Lookup indexado y acotado a UNA identidad concreta (spec §26 — O(log n)
 * con los índices nuevos sobre identity_hint_email/identity_hint_phone,
 * nunca el escaneo completo de loadAllIdentityGroups). Usado por el hook de
 * registro y por el autoservicio del estudiante — los dos únicos puntos
 * donde SÍ importa evitar un full-scan de unresolved_operations en cada
 * alta/visita al perfil. El directorio admin sigue usando
 * loadAllIdentityGroups a propósito: necesita el agregado completo para
 * filtrar/ordenar entre TODAS las identidades a la vez, no resolver una
 * identidad concreta.
 */
async function findHistoricalGroupForContact(
  email: string | null | undefined, phone: string | null | undefined, db: DbHandle
): Promise<(HistoricalIdentityListItem & { rows: UnresolvedOperation[] }) | null> {
  const key = identityKeyFor(email, phone);
  if (!key) return null;
  const normEmail = normalizeEmail(email);
  const normPhone = normalizePhone(phone);

  const contactConditions = [];
  if (normEmail) contactConditions.push(eq(unresolvedOperations.identityHintEmail, normEmail));
  if (normPhone) contactConditions.push(eq(unresolvedOperations.identityHintPhone, normPhone));
  if (contactConditions.length === 0) return null;

  const rows = await db.select().from(unresolvedOperations).where(
    and(eq(unresolvedOperations.provider, PROVIDER), or(...contactConditions))
  );
  // Se acota a las filas que realmente comparten el MISMO identityKey (un
  // teléfono compartido con otra identidad distinta no debe contaminar el
  // resultado) — mismo criterio de agrupación que loadAllIdentityGroups.
  const matchingRows = rows.filter(r => identityKeyFor(r.identityHintEmail, r.identityHintPhone) === key);
  if (matchingRows.length === 0) return null;

  const g: HistoricalIdentityListItem & { rows: UnresolvedOperation[] } = {
    identityKey: key, name: null, email: null, phone: null,
    eventsCount: 0, ticketsCount: 0, attendanceCount: 0, historicalSpendCents: 0,
    firstActivity: new Date(0).toISOString(), lastActivity: new Date(0).toISOString(),
    venueIds: [], crossVenue: false, status: "UNREGISTERED", linkedUserId: null, rows: [],
  };
  for (const r of matchingRows) {
    if (g.rows.length === 0) {
      g.email = r.identityHintEmail ? normalizeEmail(r.identityHintEmail) : null;
      g.phone = r.identityHintPhone ? normalizePhone(r.identityHintPhone) : null;
      g.name = r.identityHintName ?? null;
      g.firstActivity = r.occurredAt?.toISOString() ?? new Date(0).toISOString();
      g.lastActivity = g.firstActivity;
    }
    g.rows.push(r);
    if (r.operationType === "order") { g.ticketsCount++; g.historicalSpendCents += r.amountCents ?? 0; }
    if (r.operationType === "attendance") g.attendanceCount++;
    if (r.venueId && !g.venueIds.includes(r.venueId)) g.venueIds.push(r.venueId);
    if (r.identityHintName && r.occurredAt && r.occurredAt.toISOString() >= g.lastActivity) g.name = r.identityHintName;
    const occ = r.occurredAt?.toISOString();
    if (occ && occ < g.firstActivity) g.firstActivity = occ;
    if (occ && occ > g.lastActivity) g.lastActivity = occ;
  }
  g.eventsCount = new Set(g.rows.map(r => r.eventId).filter((v): v is number => v != null)).size;
  g.crossVenue = g.venueIds.length > 1;

  const linkedRows = g.rows.filter(r => r.status === "linked" && r.linkedUserId != null);
  if (linkedRows.length > 0) {
    const distinctLinkedUsers = new Set(linkedRows.map(r => r.linkedUserId));
    if (distinctLinkedUsers.size > 1) { g.status = "CONFLICT"; g.linkedUserId = null; }
    else { g.status = "LINKED"; g.linkedUserId = linkedRows[0].linkedUserId; }
  }
  return g;
}

// ─── Autoservicio del estudiante (spec §7-9, §37-40) ───────────────────────

export type MyHistoricalMatchStatus = "AVAILABLE" | "ALREADY_CLAIMED" | "NOT_AVAILABLE";

export interface MyHistoricalMatchPreview {
  status: MyHistoricalMatchStatus;
  eventsCount: number;
  ticketsCount: number;
  attendanceCount: number;
  venuesCount: number;
  firstActivity: string | null;
  lastActivity: string | null;
  /** Solo si status="ALREADY_CLAIMED" (spec §37 — indicador discreto con fecha de claim). */
  claimedAt: string | null;
}

const NO_MATCH_PREVIEW: MyHistoricalMatchPreview = {
  status: "NOT_AVAILABLE", eventsCount: 0, ticketsCount: 0, attendanceCount: 0, venuesCount: 0, firstActivity: null, lastActivity: null, claimedAt: null,
};

/**
 * Preview PRIVACY-SAFE (spec §9): solo agregados (nº eventos/tickets/
 * asistencias/venues + rango de fechas) — NUNCA el email/teléfono histórico
 * ni ningún detalle identificable como "prueba" antes de reclamar. Nunca
 * revela si la identidad pertenece a OTRO usuario (spec §30): un CONFLICT o
 * un LINKED a otro userId se ven exactamente igual que "no hay nada" desde
 * fuera — la única diferencia visible es si YA está reclamada por este mismo
 * usuario (ALREADY_CLAIMED).
 */
export async function getMyHistoricalMatchPreview(userId: number, db?: DbHandle): Promise<MyHistoricalMatchPreview> {
  const conn = db ?? (await getDb());
  const [u] = await conn.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return NO_MATCH_PREVIEW;

  const g = await findHistoricalGroupForContact(u.email, u.phone, conn);
  if (!g) return NO_MATCH_PREVIEW;
  if (g.status === "CONFLICT") return NO_MATCH_PREVIEW; // spec §6 — conflicto siempre a revisión admin, nunca self-serve
  if (g.status === "LINKED" && g.linkedUserId !== userId) return NO_MATCH_PREVIEW; // spec §30 — nunca revela que pertenece a otro usuario

  const claimedAt = g.status === "LINKED"
    ? g.rows.map(r => r.linkedAt?.toISOString() ?? null).filter((v): v is string => !!v).sort()[0] ?? null
    : null;

  return {
    status: g.status === "LINKED" ? "ALREADY_CLAIMED" : "AVAILABLE",
    eventsCount: g.eventsCount, ticketsCount: g.ticketsCount, attendanceCount: g.attendanceCount,
    venuesCount: g.venueIds.length, firstActivity: g.firstActivity, lastActivity: g.lastActivity,
    claimedAt,
  };
}

/**
 * CLAIM AUTOSERVICIO (spec §7/§40) — el propio estudiante confirma su
 * historial. NUNCA acepta un identityKey del cliente: se recalcula SIEMPRE
 * server-side a partir del email/teléfono YA GUARDADOS del usuario
 * autenticado (userId viene de ctx.user.id en el router, nunca del body),
 * igual que getMyHistoricalMatchPreview. Esta es la única vía de
 * auto-vinculación que queda en pie tras el hallazgo de seguridad de
 * resolveHistoricalIdentityBestEffort: exige una acción explícita,
 * autenticada, de la propia persona — nunca ocurre en silencio.
 */
export async function claimMyHistoricalIdentity(userId: number, db?: DbHandle): Promise<ClaimResult> {
  const conn = db ?? (await getDb());
  const [u] = await conn.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new HistoricalIdentityError("NOT_FOUND", "No hay ningún historial disponible para reclamar");

  const g = await findHistoricalGroupForContact(u.email, u.phone, conn);
  if (!g || g.status === "CONFLICT" || (g.status === "LINKED" && g.linkedUserId !== userId)) {
    throw new HistoricalIdentityError("NOT_FOUND", "No hay ningún historial disponible para reclamar");
  }

  return claimHistoricalIdentity({ identityKey: g.identityKey, userId, actorUserId: userId, method: "student_claim" }, conn);
}

// ─── Student 360 — Historical Overview & Timeline (spec §16-18) ───────────

export interface StudentHistoricalOverview {
  hasHistory: boolean;
  identityKey: string | null;
  eventsCount: number;
  ticketsCount: number;
  attendanceCount: number;
  historicalSpendCents: number;
  venuesCount: number;
  crossVenue: boolean;
  firstActivity: string | null;
  lastActivity: string | null;
  claimedAt: string | null;
}

/**
 * Resumen histórico para Student 360 (spec §17) — lee DIRECTAMENTE de
 * unresolved_operations por linkedUserId, nunca depende solo de que
 * event_tickets/event_attendance ya reflejen el claim: una operación tipo
 * "commerce" (o un "order" sin referenceType="event_ticket") queda marcada
 * "linked" pero NUNCA se materializa en una tabla nativa — spec §17 pide la
 * foto histórica COMPLETA, no solo lo que ya tiene tabla propia.
 */
export async function getHistoricalOverviewForStudent(userId: number, db?: DbHandle): Promise<StudentHistoricalOverview> {
  const conn = db ?? (await getDb());
  const rows = await conn.select().from(unresolvedOperations).where(eq(unresolvedOperations.linkedUserId, userId));
  if (rows.length === 0) {
    return { hasHistory: false, identityKey: null, eventsCount: 0, ticketsCount: 0, attendanceCount: 0, historicalSpendCents: 0, venuesCount: 0, crossVenue: false, firstActivity: null, lastActivity: null, claimedAt: null };
  }
  const identityKey = identityKeyFor(rows[0].identityHintEmail, rows[0].identityHintPhone);
  let ticketsCount = 0, attendanceCount = 0, historicalSpendCents = 0;
  const venueIds = new Set<number>();
  const eventIds = new Set<number>();
  let firstActivity: string | null = null, lastActivity: string | null = null, claimedAt: string | null = null;
  for (const r of rows) {
    if (r.operationType === "order") { ticketsCount++; historicalSpendCents += r.amountCents ?? 0; }
    if (r.operationType === "attendance") attendanceCount++;
    if (r.venueId) venueIds.add(r.venueId);
    if (r.eventId) eventIds.add(r.eventId);
    const occ = r.occurredAt?.toISOString() ?? null;
    if (occ && (!firstActivity || occ < firstActivity)) firstActivity = occ;
    if (occ && (!lastActivity || occ > lastActivity)) lastActivity = occ;
    const linked = r.linkedAt?.toISOString() ?? null;
    if (linked && (!claimedAt || linked < claimedAt)) claimedAt = linked; // primera vinculación real, no la última
  }
  return {
    hasHistory: true, identityKey,
    eventsCount: eventIds.size, ticketsCount, attendanceCount, historicalSpendCents,
    venuesCount: venueIds.size, crossVenue: venueIds.size > 1,
    firstActivity, lastActivity, claimedAt,
  };
}

export interface StudentHistoricalTimelineItem {
  operationId: number; operationType: string; occurredAt: string;
  eventId: number | null; eventName: string | null;
  venueId: number | null; venueName: string | null;
  amountCents: number | null;
}

/** Timeline paginado en memoria — el volumen por Student individual (decenas de operaciones) nunca justifica paginación en SQL. */
export async function getHistoricalTimelineForStudent(
  userId: number, limit: number, offset: number, db?: DbHandle
): Promise<{ items: StudentHistoricalTimelineItem[]; total: number }> {
  const conn = db ?? (await getDb());
  const rows = await conn.select().from(unresolvedOperations).where(eq(unresolvedOperations.linkedUserId, userId));
  const sorted = rows.slice().sort((a, b) => (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0));

  const eventIds = Array.from(new Set(sorted.map(r => r.eventId).filter((v): v is number => v != null)));
  const venueIds = Array.from(new Set(sorted.map(r => r.venueId).filter((v): v is number => v != null)));
  const [eventRows, venueRows] = await Promise.all([
    eventIds.length ? conn.select({ id: events.id, name: events.name }).from(events).where(inArray(events.id, eventIds)) : Promise.resolve([]),
    venueIds.length ? conn.select({ id: venues.id, name: venues.name }).from(venues).where(inArray(venues.id, venueIds)) : Promise.resolve([]),
  ]);
  const eventNames = new Map(eventRows.map(e => [e.id, e.name]));
  const venueNames = new Map(venueRows.map(v => [v.id, v.name]));

  const page = sorted.slice(offset, offset + limit).map(r => ({
    operationId: r.id, operationType: r.operationType,
    occurredAt: r.occurredAt?.toISOString() ?? new Date(0).toISOString(),
    eventId: r.eventId, eventName: r.eventId ? eventNames.get(r.eventId) ?? null : null,
    venueId: r.venueId, venueName: r.venueId ? venueNames.get(r.venueId) ?? null : null,
    amountCents: r.amountCents,
  }));
  return { items: page, total: sorted.length };
}

// ─── Hook de registro (spec §16-17, §54, Production Safety Gate §8) ───────

/**
 * Best-effort — llamar DESPUÉS de confirmar la transacción de registro
 * (mismo patrón que grantWelcomeBenefitBestEffort en registrationService.ts:
 * un fallo aquí NUNCA debe romper el alta).
 *
 * SEGURIDAD (spec §8 — BLOCKER real encontrado y corregido en esta fase):
 * esta función ANTES auto-vinculaba en EXACT_EMAIL_AND_PHONE. Pero el alta
 * de Segolife no verifica la propiedad del email ni del teléfono (no hay
 * verificación por email/SMS en ningún punto del registro — auditado). Y el
 * chequeo `classifyMatch(email, phone)` que decidía el auto-link comparaba
 * el email/teléfono del usuario RECIÉN CREADO contra la tabla `users` — es
 * decir, contra SU PROPIA fila recién insertada, que siempre resuelve en
 * macheo consigo mismo. El único filtro real que determinaba si había
 * vínculo histórico era `identityKeyFor` (prioridad email, sin comprobar
 * siquiera el teléfono contra el histórico). Resultado: cualquiera que
 * conociera el email histórico de OTRA persona (Fourvenues nunca exige
 * probar esa propiedad) heredaba en silencio, sin ninguna confirmación
 * humana, todo su historial de compras/asistencia con solo registrarse con
 * ese email. Verificado que nunca se explotó en producción (0 claims reales
 * existentes antes de este fix), pero el vector estaba desplegado y activo.
 *
 * Por eso esta función YA NUNCA auto-vincula: solo detecta (deja constancia
 * observable en logs, spec §23) y deja el claim a una acción explícita del
 * propio estudiante (`claimMyHistoricalIdentity`, autoservicio autenticado)
 * o de un admin (`claimHistoricalIdentity` vía RBAC students.manage). Ver
 * informe final, sección "Auto-Link Security".
 */
export async function resolveHistoricalIdentityBestEffort(userId: number, email: string, phone: string, db?: DbHandle): Promise<void> {
  try {
    const conn = db ?? (await getDb());
    const g = await findHistoricalGroupForContact(email, phone, conn);
    if (!g || g.status === "LINKED" || g.status === "CONFLICT") return;
    console.log(`[historicalIdentity] Posible historial detectado en registro userId=${userId} identityKey=${g.identityKey} (pendiente de claim explícito — nunca auto-vinculado, spec §8)`);
  } catch (err) {
    console.error("[resolveHistoricalIdentityBestEffort] No se pudo detectar histórico:", err);
  }
}
