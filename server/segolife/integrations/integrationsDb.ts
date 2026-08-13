/**
 * integrationsDb.ts — CRUD del Integration Hub (Fase 5): catálogo de
 * providers, integraciones por venue/evento, mappings de entidades externas,
 * runs/estado de sincronización. Los routers llaman aquí, nunca SQL inline
 * (misma regla que el resto del proyecto).
 *
 * SEGURIDAD: `credentialsEncrypted` NUNCA sale de este archivo hacia un
 * router sin pasar por `toSafeIntegration()`, que lo sustituye por un
 * booleano `credentialsConfigured` + `credentialsLast4`.
 */
import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  integrationProviders, venueIntegrations, eventIntegrations, externalEntityMappings,
  integrationSyncRuns, integrationSyncState,
  type IntegrationProviderRow, type VenueIntegration, type EventIntegration,
  type InsertVenueIntegration, type InsertEventIntegration,
  type IntegrationSyncRun, type InsertIntegrationSyncRun,
} from "../../../drizzle/schema";
import { encryptCredentials, last4 } from "./integrationCredentialCrypto";
import type { ProviderCapabilities } from "./capabilities";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface SafeIntegration {
  id: number;
  venueId?: number;
  eventId?: number;
  providerId: number;
  providerKey: string;
  environment: "sandbox" | "production";
  enabled: boolean;
  status: "not_configured" | "configured" | "connected" | "error" | "disabled";
  capabilities: ProviderCapabilities | null;
  credentialsConfigured: boolean;
  credentialsLast4: string | null;
  syncEnabled: boolean;
  /** Production Scheduler — solo real en venue_integrations (event_integrations no lo tiene todavía, no hay necesidad hoy); siempre false para "event". */
  loyaltyEnabled: boolean;
  syncIntervalMinutes: number | null;
  lastSyncAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
}

function toSafeIntegration(row: VenueIntegration | EventIntegration, providerKey: string, kind: "venue" | "event"): SafeIntegration {
  return {
    id: row.id,
    ...(kind === "venue" ? { venueId: (row as VenueIntegration).venueId } : { eventId: (row as EventIntegration).eventId }),
    providerId: row.providerId,
    providerKey,
    environment: row.environment,
    enabled: row.enabled,
    status: row.status,
    capabilities: (row.capabilities as ProviderCapabilities | null) ?? null,
    credentialsConfigured: !!row.credentialsEncrypted,
    credentialsLast4: row.credentialsLast4,
    syncEnabled: row.syncEnabled,
    loyaltyEnabled: kind === "venue" ? (row as VenueIntegration).loyaltyEnabled : false,
    syncIntervalMinutes: row.syncIntervalMinutes,
    lastSyncAt: row.lastSyncAt,
    lastSuccessAt: row.lastSuccessAt,
    lastErrorAt: row.lastErrorAt,
    lastErrorMessage: row.lastErrorMessage,
  };
}

// ─── PROVIDERS ────────────────────────────────────────────────────────────────

export async function listProviders(db?: DbHandle): Promise<IntegrationProviderRow[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(integrationProviders);
}

export async function getProviderByKey(key: string, db?: DbHandle): Promise<IntegrationProviderRow | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(integrationProviders).where(eq(integrationProviders.key, key)).limit(1);
  return row ?? null;
}

export async function getProviderById(id: number, db?: DbHandle): Promise<IntegrationProviderRow | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(integrationProviders).where(eq(integrationProviders.id, id)).limit(1);
  return row ?? null;
}

// ─── VENUE INTEGRATIONS (Fourvenues) ──────────────────────────────────────────

export async function listVenueIntegrations(venueId?: number, db?: DbHandle): Promise<SafeIntegration[]> {
  const conn = db ?? (await getDb());
  const rows = venueId != null
    ? await conn.select().from(venueIntegrations).where(eq(venueIntegrations.venueId, venueId))
    : await conn.select().from(venueIntegrations);
  const providers = await listProviders(conn);
  const byId = new Map(providers.map(p => [p.id, p.key]));
  return rows.map(r => toSafeIntegration(r, byId.get(r.providerId) ?? "unknown", "venue"));
}

export async function getVenueIntegrationRaw(id: number, db?: DbHandle): Promise<VenueIntegration | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(venueIntegrations).where(eq(venueIntegrations.id, id)).limit(1);
  return row ?? null;
}

export interface CreateVenueIntegrationInput {
  venueId: number;
  providerId: number;
  externalAccountId?: string | null;
  externalVenueId?: string | null;
  environment: "sandbox" | "production";
  credentials?: Record<string, string | undefined>;
  credentialsDisplayValue?: string; // el campo "representativo" para calcular last4 (p.ej. apiKey)
}

export async function createVenueIntegration(input: CreateVenueIntegrationInput, db?: DbHandle): Promise<SafeIntegration> {
  const conn = db ?? (await getDb());
  const credentialsEncrypted = input.credentials ? encryptCredentials(input.credentials) : null;
  const values: InsertVenueIntegration = {
    venueId: input.venueId,
    providerId: input.providerId,
    externalAccountId: input.externalAccountId ?? null,
    externalVenueId: input.externalVenueId ?? null,
    environment: input.environment,
    enabled: false, // spec Fase 5, punto 62 — SIEMPRE false al crear, el admin lo activa explícitamente
    status: credentialsEncrypted ? "configured" : "not_configured",
    credentialsEncrypted,
    credentialsLast4: last4(input.credentialsDisplayValue),
    syncEnabled: false,
  };
  const [result] = await conn.insert(venueIntegrations).values(values);
  const insertId = (result as unknown as { insertId: number }).insertId;
  const row = await getVenueIntegrationRaw(insertId, conn);
  const provider = await conn.select().from(integrationProviders).where(eq(integrationProviders.id, input.providerId)).limit(1);
  return toSafeIntegration(row!, provider[0]?.key ?? "unknown", "venue");
}

// `syncEnabled` se mueve junto con `enabled` — hoy no existe ningún worker/
// scheduler automático que necesite activarse por separado (spec Fourvenues
// Operational Sync §82: "confirmar que NO existe worker automático"), así
// que la única diferencia entre ambos flags sería una UI incompleta sin
// forma de satisfacer canSync() nunca. El día que exista un scheduler real,
// syncEnabled debe desacoplarse aquí para controlar ESE automatismo
// específicamente — no antes.
export async function setVenueIntegrationEnabled(id: number, enabled: boolean, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(venueIntegrations).set({ enabled, syncEnabled: enabled }).where(eq(venueIntegrations.id, id));
}

/**
 * Production Scheduler (2026-08-13) — gate DECOUPLADO de `enabled`/
 * `syncEnabled` a propósito (a diferencia de setVenueIntegrationEnabled de
 * arriba): los datos pueden sincronizarse en vivo con loyalty_enabled=false
 * (default) sin conceder ni un token. Activarlo es SIEMPRE un flip explícito
 * separado — nunca un efecto colateral de habilitar sync/scheduler.
 */
export async function setVenueIntegrationLoyaltyEnabled(id: number, loyaltyEnabled: boolean, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(venueIntegrations).set({ loyaltyEnabled }).where(eq(venueIntegrations.id, id));
}

export async function setVenueIntegrationSyncInterval(id: number, syncIntervalMinutes: number | null, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(venueIntegrations).set({ syncIntervalMinutes }).where(eq(venueIntegrations.id, id));
}

export async function updateVenueIntegrationCredentials(id: number, credentials: Record<string, string | undefined>, displayValue?: string, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(venueIntegrations).set({
    credentialsEncrypted: encryptCredentials(credentials),
    credentialsLast4: last4(displayValue),
    status: "configured",
  }).where(eq(venueIntegrations.id, id));
}

export async function recordVenueIntegrationResult(id: number, ok: boolean, message: string | null, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  const now = new Date();
  await conn.update(venueIntegrations).set(
    ok
      ? { status: "connected", lastSyncAt: now, lastSuccessAt: now, lastErrorMessage: null }
      : { status: "error", lastSyncAt: now, lastErrorAt: now, lastErrorMessage: message?.slice(0, 512) ?? null }
  ).where(eq(venueIntegrations.id, id));
}

// ─── EVENT INTEGRATIONS (Weezevent) ───────────────────────────────────────────

export async function listEventIntegrations(eventId?: number, db?: DbHandle): Promise<SafeIntegration[]> {
  const conn = db ?? (await getDb());
  const rows = eventId != null
    ? await conn.select().from(eventIntegrations).where(eq(eventIntegrations.eventId, eventId))
    : await conn.select().from(eventIntegrations);
  const providers = await listProviders(conn);
  const byId = new Map(providers.map(p => [p.id, p.key]));
  return rows.map(r => toSafeIntegration(r, byId.get(r.providerId) ?? "unknown", "event"));
}

export async function getEventIntegrationRaw(id: number, db?: DbHandle): Promise<EventIntegration | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(eventIntegrations).where(eq(eventIntegrations.id, id)).limit(1);
  return row ?? null;
}

export interface CreateEventIntegrationInput {
  eventId: number;
  providerId: number;
  externalEventId?: string | null;
  environment: "sandbox" | "production";
  credentials?: Record<string, string | undefined>;
  credentialsDisplayValue?: string;
}

export async function createEventIntegration(input: CreateEventIntegrationInput, db?: DbHandle): Promise<SafeIntegration> {
  const conn = db ?? (await getDb());
  const credentialsEncrypted = input.credentials ? encryptCredentials(input.credentials) : null;
  const values: InsertEventIntegration = {
    eventId: input.eventId,
    providerId: input.providerId,
    externalEventId: input.externalEventId ?? null,
    environment: input.environment,
    enabled: false,
    status: credentialsEncrypted ? "configured" : "not_configured",
    credentialsEncrypted,
    credentialsLast4: last4(input.credentialsDisplayValue),
    syncEnabled: false,
  };
  const [result] = await conn.insert(eventIntegrations).values(values);
  const insertId = (result as unknown as { insertId: number }).insertId;
  const row = await getEventIntegrationRaw(insertId, conn);
  const provider = await conn.select().from(integrationProviders).where(eq(integrationProviders.id, input.providerId)).limit(1);
  return toSafeIntegration(row!, provider[0]?.key ?? "unknown", "event");
}

export async function setEventIntegrationEnabled(id: number, enabled: boolean, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(eventIntegrations).set({ enabled }).where(eq(eventIntegrations.id, id));
}

// ─── MAPPINGS / SYNC RUNS / SYNC STATE ────────────────────────────────────────

export async function upsertExternalEntityMapping(input: { provider: string; integrationType: "venue_integration" | "event_integration"; integrationId: number; externalType: string; externalId: string; internalType: string; internalId: number }, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.insert(externalEntityMappings).ignore().values(input);
}

export async function findInternalIdForExternal(provider: string, externalType: string, externalId: string, db?: DbHandle): Promise<number | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(externalEntityMappings)
    .where(and(eq(externalEntityMappings.provider, provider), eq(externalEntityMappings.externalType, externalType), eq(externalEntityMappings.externalId, externalId)))
    .limit(1);
  return row?.internalId ?? null;
}

export async function startSyncRun(input: { integrationType: "venue_integration" | "event_integration"; integrationId: number; syncType: "full" | "incremental"; metadata?: Record<string, unknown> }, db?: DbHandle): Promise<IntegrationSyncRun> {
  const conn = db ?? (await getDb());
  const values: InsertIntegrationSyncRun = { integrationType: input.integrationType, integrationId: input.integrationId, syncType: input.syncType, status: "running", metadata: input.metadata ?? null };
  const [result] = await conn.insert(integrationSyncRuns).values(values);
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(integrationSyncRuns).where(eq(integrationSyncRuns.id, insertId)).limit(1);
  return row;
}

// ─── SYNC LOCK (Production Scheduler, 2026-08-13) ─────────────────────────────
// Sin Redis, sin GET_LOCK (poco fiable con un pool de conexiones — se
// liberaría en cuanto la conexión vuelve al pool). Se reutiliza la fila YA
// única de integration_sync_state (unique(integrationType, integrationId))
// como punto de serialización real vía `SELECT ... FOR UPDATE` dentro de una
// transacción: dos intentos concurrentes de adquirir el lock de la MISMA
// integración (scheduler vs scheduler en 2 instancias de Railway, scheduler
// vs manual Sync Now) se serializan por MySQL mismo, sin lock en memoria
// (que no sobreviviría a multi-instancia) y sin tabla/columna nueva.
//
// "Ocupado" = ya existe una fila integration_sync_runs con status='running'
// para esta integración, con menos de SYNC_STALE_LOCK_MINUTES de antigüedad.
// Una fila "running" más vieja que eso se considera abandonada (contenedor
// caído a mitad de sync, redeploy que mató el proceso) — se marca
// automáticamente como failed (nunca se deja "running" para siempre) y el
// intento actual continúa con normalidad.
export const SYNC_STALE_LOCK_MINUTES = 30;

export interface AcquireSyncLockResult {
  acquired: boolean;
  run: IntegrationSyncRun | null;
  /** Motivo legible cuando acquired=false — para el mensaje "sync already running" del admin/scheduler. */
  reason?: string;
}

export async function tryAcquireSyncLock(
  integrationType: "venue_integration" | "event_integration",
  integrationId: number,
  syncType: "full" | "incremental",
  metadata: Record<string, unknown> | undefined,
  db?: DbHandle
): Promise<AcquireSyncLockResult> {
  const conn = db ?? (await getDb());
  return conn.transaction(async (tx): Promise<AcquireSyncLockResult> => {
    // Garantiza que la fila de sync_state existe (no-op si ya estaba) — hace
    // falta una fila real para poder tomar FOR UPDATE sobre ella. `new Date()`
    // (nunca epoch/new Date(0)): MySQL en modo estricto (Railway, default)
    // rechaza 1970-01-01T00:00:00.000Z en una columna TIMESTAMP — confirmado
    // con evidencia real en el piloto (ver informe, "Failed query" en logs,
    // params mostraban literalmente "1970-01-01 00:00:00.000"). Solo importa
    // que la fila EXISTA para el FOR UPDATE de abajo — el valor real de
    // updated_since no se usa hasta que exista un cursor real.
    await tx.insert(integrationSyncState).values({ integrationType, integrationId, cursor: null, updatedSince: new Date() })
      .onDuplicateKeyUpdate({ set: { integrationType } }); // update sin efecto — solo asegura la existencia de la fila
    await tx.select().from(integrationSyncState)
      .where(and(eq(integrationSyncState.integrationType, integrationType), eq(integrationSyncState.integrationId, integrationId)))
      .limit(1).for("update"); // serializa cualquier otro intento concurrente hasta el commit/rollback de esta transacción

    const staleThreshold = new Date(Date.now() - SYNC_STALE_LOCK_MINUTES * 60_000);
    const [runningRow] = await tx.select().from(integrationSyncRuns)
      .where(and(eq(integrationSyncRuns.integrationType, integrationType), eq(integrationSyncRuns.integrationId, integrationId), eq(integrationSyncRuns.status, "running")))
      .orderBy(desc(integrationSyncRuns.id)).limit(1);

    if (runningRow) {
      if (runningRow.startedAt > staleThreshold) {
        return { acquired: false, run: null, reason: `sync already running (run #${runningRow.id}, iniciado ${runningRow.startedAt.toISOString()})` };
      }
      await tx.update(integrationSyncRuns).set({
        status: "failed",
        errorMessage: "Stale lock — run abandonado (posible caída de contenedor/redeploy a mitad de sync), auto-recuperado por el siguiente intento",
        finishedAt: new Date(),
      }).where(eq(integrationSyncRuns.id, runningRow.id));
    }

    const values: InsertIntegrationSyncRun = { integrationType, integrationId, syncType, status: "running", metadata: metadata ?? null };
    const [result] = await tx.insert(integrationSyncRuns).values(values);
    const insertId = (result as unknown as { insertId: number }).insertId;
    const [row] = await tx.select().from(integrationSyncRuns).where(eq(integrationSyncRuns.id, insertId)).limit(1);
    return { acquired: true, run: row };
  });
}

/** Estado derivado para el admin (spec §61/§101) — SIN columna/tabla nueva, calculado sobre integration_sync_runs. */
export async function getCurrentLockStatus(integrationType: "venue_integration" | "event_integration", integrationId: number, db?: DbHandle): Promise<{ locked: boolean; run: IntegrationSyncRun | null }> {
  const conn = db ?? (await getDb());
  const staleThreshold = new Date(Date.now() - SYNC_STALE_LOCK_MINUTES * 60_000);
  const [runningRow] = await conn.select().from(integrationSyncRuns)
    .where(and(eq(integrationSyncRuns.integrationType, integrationType), eq(integrationSyncRuns.integrationId, integrationId), eq(integrationSyncRuns.status, "running")))
    .orderBy(desc(integrationSyncRuns.id)).limit(1);
  if (!runningRow) return { locked: false, run: null };
  return { locked: runningRow.startedAt > staleThreshold, run: runningRow };
}

// ─── DUE CALCULATION (Production Scheduler) ───────────────────────────────────
// Pura, sin I/O — testeable sin mockear BD. `lastSuccessAt` (nunca
// `lastSyncAt`, que también se actualiza en fallos) es la referencia: un
// sync fallido no debe "resetear" la cadencia y bloquear reintentos hasta el
// próximo intervalo completo.
export function isDueForScheduledSync(
  integration: Pick<VenueIntegration, "lastSuccessAt" | "syncIntervalMinutes">,
  now: Date,
  defaultIntervalMinutes: number
): boolean {
  const intervalMinutes = integration.syncIntervalMinutes ?? defaultIntervalMinutes;
  if (!integration.lastSuccessAt) return true; // nunca sincronizada — debida en cuanto está habilitada explícitamente (canSync ya lo exige aparte)
  const elapsedMs = now.getTime() - integration.lastSuccessAt.getTime();
  return elapsedMs >= intervalMinutes * 60_000;
}

/**
 * Último run EXITOSO con metadata.mode=<mode> (Production Scheduler) — NUNCA
 * reutiliza `lastSuccessAt` (que se actualiza en CUALQUIER sync exitoso,
 * incremental o reconciliation): usarlo aquí resetearía el reloj de
 * reconciliation en cada incremental y esta cadencia más espaciada nunca
 * llegaría a dispararse. Escanea los últimos 20 runs exitosos — más que
 * suficiente al volumen real de Casanova, evita filtrar por JSON path en
 * SQL sin necesidad real de volumen.
 */
export async function getLastSuccessfulModeRunAt(
  integrationType: "venue_integration" | "event_integration",
  integrationId: number,
  mode: "incremental" | "reconciliation",
  db?: DbHandle
): Promise<Date | null> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({ startedAt: integrationSyncRuns.startedAt, metadata: integrationSyncRuns.metadata })
    .from(integrationSyncRuns)
    .where(and(eq(integrationSyncRuns.integrationType, integrationType), eq(integrationSyncRuns.integrationId, integrationId), eq(integrationSyncRuns.status, "success")))
    .orderBy(desc(integrationSyncRuns.id)).limit(20);
  const match = rows.find(r => (r.metadata as Record<string, unknown> | null)?.mode === mode);
  return match?.startedAt ?? null;
}

export async function finishSyncRun(id: number, counts: { fetchedCount: number; createdCount: number; updatedCount: number; unresolvedCount: number; failedCount: number }, status: "success" | "partial" | "failed", errorMessage?: string | null, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(integrationSyncRuns).set({ ...counts, status, errorMessage: errorMessage?.slice(0, 512) ?? null, finishedAt: new Date() }).where(eq(integrationSyncRuns.id, id));
}

export async function listSyncRuns(integrationType: "venue_integration" | "event_integration", integrationId: number, db?: DbHandle): Promise<IntegrationSyncRun[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(integrationSyncRuns)
    .where(and(eq(integrationSyncRuns.integrationType, integrationType), eq(integrationSyncRuns.integrationId, integrationId)))
    .orderBy(desc(integrationSyncRuns.startedAt))
    .limit(20);
}

export async function getSyncState(integrationType: "venue_integration" | "event_integration", integrationId: number, db?: DbHandle) {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(integrationSyncState)
    .where(and(eq(integrationSyncState.integrationType, integrationType), eq(integrationSyncState.integrationId, integrationId)))
    .limit(1);
  return row ?? null;
}

export async function setSyncCursor(integrationType: "venue_integration" | "event_integration", integrationId: number, cursor: string | null, updatedSince: Date, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.insert(integrationSyncState).values({ integrationType, integrationId, cursor, updatedSince })
    .onDuplicateKeyUpdate({ set: { cursor, updatedSince } });
}
