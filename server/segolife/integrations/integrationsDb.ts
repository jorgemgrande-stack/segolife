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

export async function startSyncRun(input: { integrationType: "venue_integration" | "event_integration"; integrationId: number; syncType: "full" | "incremental" }, db?: DbHandle): Promise<IntegrationSyncRun> {
  const conn = db ?? (await getDb());
  const values: InsertIntegrationSyncRun = { ...input, status: "running" };
  const [result] = await conn.insert(integrationSyncRuns).values(values);
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(integrationSyncRuns).where(eq(integrationSyncRuns.id, insertId)).limit(1);
  return row;
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
