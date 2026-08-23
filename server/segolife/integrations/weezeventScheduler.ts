/**
 * weezeventScheduler.ts — SEGOLIFE Weezevent Live Operations (2026-08-23).
 *
 * Mismo criterio EXACTO que integrationScheduler.ts (Fourvenues)/
 * communityLifecycleScheduler.ts/engagementScheduler.ts: tick de node-cron
 * cada minuto, NUNCA arranca solo (feature flag DB-backed
 * `weezevent_scheduler_enabled`, default false, vía conditionallyStartJob en
 * server/_core/index.ts). "ONE SYNC PATH" (spec §16): este scheduler NUNCA
 * reimplementa la ingesta — llama a syncEventIntegration(), el MISMO punto
 * de entrada que ya usa el botón manual "Sync now" (routers/integrations.ts)
 * — heredando su lock (tryAcquireSyncLock, SELECT...FOR UPDATE, real
 * cross-proceso, spec §5) y su supresión de loyalty (resolveSuppressLoyaltyFlag)
 * automáticamente, sin ningún código nuevo de locking.
 *
 * DISEÑO DELIBERADAMENTE DISTINTO DE FOURVENUES (spec §1 — auditoría previa:
 * "no fuerces Weezevent en la abstracción incorrecta solo por reutilizar").
 * Fourvenues es venue_integration: descubre eventos NUEVOS en un catálogo,
 * por eso tiene 3 cadencias (incremental/catalog/reconciliation). Weezevent
 * es event_integration: 1:1 con UN evento YA CONOCIDO (integration.eventId +
 * externalEventId) — no existe ningún catálogo que descubrir. Solo hacen
 * falta DOS cadencias:
 *
 *  - INCREMENTAL: usa el cursor real (`since`) para TICKETS (nuevos
 *    participantes/compras) — cadencia ADAPTATIVA según la proximidad real
 *    al evento (ver resolveWeezeventSyncIntervalMinutes). La ASISTENCIA
 *    (listAttendance) nunca usa `since`, en NINGÚN modo — ver la nota real
 *    en integrationSyncService.ts: confirmado empíricamente (2026-08-23,
 *    TANKER AUTUMN 2025, evento real cerrado, solo lectura) que
 *    `last_update` NO se actualiza al escanear una entrada — un `since`
 *    fijado tras el ÚLTIMO check-in real seguía devolviendo el histórico
 *    completo. Por eso attendance siempre se pide entera; el coste real
 *    (PARTICIPANT_PAGE_SIZE=500, ~4-6 páginas para 1800-2600 participantes)
 *    es trivial frente al límite de Fair Use.
 *  - RECONCILIATION: fuerza un refetch COMPLETO de TICKETS (since=undefined,
 *    ver EventSyncOptions.mode) — colchón de seguridad de cadencia fija y
 *    espaciada (mismo intervalo que Fourvenues, 360min/6h), para el ítem
 *    aislado que falla dentro de un run que en conjunto termina "success"
 *    (aislamiento de fallos por ítem, mismo patrón que syncVenueIntegration)
 *    y que de otro modo nunca se reintentaría por sí solo.
 *
 * ADAPTIVE FREQUENCY (spec §4) — intervalos determinados aquí en base a DOS
 * fuentes reales, nunca inventados:
 *  (a) Fair Use — reconsultado 2026-08-23 en
 *      https://api.weezevent.com/doc/fair-use: 600 req/min por cuenta,
 *      10 intentos de auth/min, 5 credenciales inválidas -> ban 30min, y la
 *      propia doc RECOMIENDA explícitamente filtrar por diferencial
 *      ("only modified participants") para minimizar llamadas — seguido
 *      para TICKETS (since real), roto deliberadamente para ATTENDANCE por
 *      el motivo empírico de arriba. Incluso en la ventana más agresiva
 *      (cada 2min) el coste real de SKYLANDS (~1800-2600 participantes,
 *      4-6 páginas) es ~2-3 req/min — muy por debajo de 600/min.
 *  (b) Proximidad real al evento — events.startsAt/endsAt (columna real,
 *      NUNCA inventada, NUNCA leída de Weezevent) vía el evento Segolife
 *      vinculado. Ejemplo CONCEPTUAL del spec (lejano=baja, 24h antes=media,
 *      ventana del evento=alta, tras el evento=media de reconciliación,
 *      cerrado=parar) traducido a valores concretos abajo — configurables
 *      como constantes con nombre, nunca un número mágico suelto.
 *
 * `event_integrations.sync_interval_minutes` (columna YA EXISTENTE, sin
 * migración, mismo patrón que venue_integrations) sigue funcionando como
 * override manual — si el admin lo fija, gana SIEMPRE sobre la cadencia
 * adaptativa (mismo criterio que Fourvenues: "el valor por fila siempre
 * gana", spec §13).
 */
import cron, { type ScheduledTask } from "node-cron";
import { listProviders, listEventIntegrations, getEventIntegrationRaw, getWeezeventConnectionRaw, getEventDatesForScheduler, isDueForScheduledSync, getLastSuccessfulModeRunAt } from "./integrationsDb";
import { isExternalIntegrationsGloballyEnabled, canSync, syncEventIntegration } from "./integrationSyncService";

// Propuesta de cadencia (spec §4) — ver informe final para la justificación
// completa con evidencia real (Fair Use + volumen real de SKYLANDS). Solo
// FALLBACK cuando `event_integrations.sync_interval_minutes` es null.
export const WEEZEVENT_FAR_INTERVAL_MINUTES = 60;          // > 7 días antes del evento — baja frecuencia, nada relevante cambia hora a hora.
export const WEEZEVENT_NEAR_INTERVAL_MINUTES = 15;         // entre 7 días y la ventana del evento — actividad de venta creciente.
export const WEEZEVENT_EVENT_WINDOW_INTERVAL_MINUTES = 2;  // ventana activa del evento (2h antes -> fin) — máxima frecuencia permitida por Fair Use sin riesgo real.
export const WEEZEVENT_POST_EVENT_INTERVAL_MINUTES = 15;   // tras el fin del evento -> ventana de reconciliación fina (check-ins/altas tardías).
export const WEEZEVENT_RECONCILIATION_INTERVAL_MINUTES = 360; // 6h — refetch completo de tickets, mismo intervalo que Fourvenues.
export const WEEZEVENT_EVENT_WINDOW_PRE_HOURS = 2;          // cuánto antes del startsAt entra en "ventana activa".
export const WEEZEVENT_POST_EVENT_STOP_HOURS = 48;          // tras esto, el scheduler deja de tocar la mapping automáticamente ("cerrado/reconciliado, parar" — spec §4). Sync now manual sigue disponible siempre.
export const WEEZEVENT_NEAR_THRESHOLD_DAYS = 7;

/**
 * Pura, sin I/O (testeable sin mockear BD) — mismo criterio que
 * isDueForScheduledSync. Devuelve la cadencia ADAPTATIVA en minutos, o
 * `null` si el evento ya está fuera de la ventana automática (más de
 * WEEZEVENT_POST_EVENT_STOP_HOURS tras su fin) — el scheduler deja de
 * tocar esta mapping por sí solo (spec §4 "detener o reducir
 * drásticamente"), pero NUNCA deshabilita `enabled`/`syncEnabled` ni
 * cambia ningún dato — Sync now manual sigue funcionando igual siempre.
 */
export function resolveWeezeventSyncIntervalMinutes(now: Date, eventStartsAt: Date, eventEndsAt: Date | null): number | null {
  const windowStart = new Date(eventStartsAt.getTime() - WEEZEVENT_EVENT_WINDOW_PRE_HOURS * 3600_000);

  if (eventEndsAt == null) {
    // events.ends_at es nullable (schema real) — un evento real sin fin
    // registrado NUNCA se trata como "ya terminado" solo porque pasó su
    // instante de inicio (eso dejaría de detectar check-ins reales durante
    // el grueso del evento). Se mantiene la cadencia MÁS frecuente
    // (EVENT_WINDOW) desde 2h antes del inicio hasta la parada real
    // (WEEZEVENT_POST_EVENT_STOP_HOURS medida desde el INICIO, no desde un
    // fin desconocido) — más caro en llamadas, pero seguro: nunca se asume
    // una duración inventada. Fuera de esa ventana, cadencia normal por
    // proximidad (far/near), igual que con endsAt conocido.
    const stopAt = new Date(eventStartsAt.getTime() + WEEZEVENT_POST_EVENT_STOP_HOURS * 3600_000);
    if (now.getTime() >= stopAt.getTime()) return null;
    if (now.getTime() >= windowStart.getTime()) return WEEZEVENT_EVENT_WINDOW_INTERVAL_MINUTES;
    const daysUntilStart = (eventStartsAt.getTime() - now.getTime()) / 86_400_000;
    return daysUntilStart <= WEEZEVENT_NEAR_THRESHOLD_DAYS ? WEEZEVENT_NEAR_INTERVAL_MINUTES : WEEZEVENT_FAR_INTERVAL_MINUTES;
  }

  const stopAt = new Date(eventEndsAt.getTime() + WEEZEVENT_POST_EVENT_STOP_HOURS * 3600_000);
  if (now.getTime() >= stopAt.getTime()) return null;
  if (now.getTime() >= windowStart.getTime() && now.getTime() <= eventEndsAt.getTime()) return WEEZEVENT_EVENT_WINDOW_INTERVAL_MINUTES;
  if (now.getTime() > eventEndsAt.getTime()) return WEEZEVENT_POST_EVENT_INTERVAL_MINUTES;
  const daysUntilStart = (eventStartsAt.getTime() - now.getTime()) / 86_400_000;
  if (daysUntilStart <= WEEZEVENT_NEAR_THRESHOLD_DAYS) return WEEZEVENT_NEAR_INTERVAL_MINUTES;
  return WEEZEVENT_FAR_INTERVAL_MINUTES;
}

async function runScheduled(eventIntegrationId: number, mode: "incremental" | "reconciliation"): Promise<void> {
  try {
    const result = await syncEventIntegration(eventIntegrationId, { trigger: "scheduler", mode });
    console.log(
      `[WeezeventScheduler] mode=${mode} eventIntegrationId=${eventIntegrationId} status=${result.status} ` +
      `tickets=${result.ticketsFound} paymentless=+${result.paymentlessCreated}/${result.paymentlessAlreadyExists} ` +
      `attendance=${result.attendanceProcessed}/${result.attendanceUnresolved} failed=${result.failedCount}`
    );
  } catch (err) {
    console.error(`[WeezeventScheduler] mode=${mode} eventIntegrationId=${eventIntegrationId} falló:`, err instanceof Error ? err.message : err);
  }
}

/** Exportado solo para tests — nunca se llama directamente fuera de este módulo/startWeezeventScheduler. */
export async function tick(): Promise<void> {
  // Kill switch global — 0 llamadas si no está en "true", ni siquiera de listado (mismo criterio que Fourvenues).
  if (!isExternalIntegrationsGloballyEnabled()) return;

  const providers = await listProviders();
  const weezeventProviderId = providers.find(p => p.key === "weezevent")?.id;
  if (weezeventProviderId == null) return;

  const integrations = await listEventIntegrations();
  for (const safe of integrations) {
    // Weezevent only — activar el switch global nunca debe arrancar
    // Fourvenues u otro provider por accidente (mismo criterio inverso que
    // integrationScheduler.ts, spec §93 aplicado en ambos sentidos).
    if (safe.providerId !== weezeventProviderId) continue;

    const raw = await getEventIntegrationRaw(safe.id);
    if (!raw || raw.eventId == null) continue;

    const connection = await getWeezeventConnectionRaw(raw.connectionId);
    if (!canSync({ ...raw, credentialsEncrypted: connection?.credentialsEncrypted ?? null })) continue;

    const eventRow = await getEventDatesForScheduler(raw.eventId);
    if (!eventRow) continue; // evento Segolife borrado/inconsistente — nunca debería pasar (FK lógica), pero nunca se asume

    const now = new Date();
    const adaptiveInterval = resolveWeezeventSyncIntervalMinutes(now, eventRow.startsAt, eventRow.endsAt);
    if (adaptiveInterval == null) continue; // evento reconciliado/cerrado hace tiempo — el scheduler deja de tocarlo automáticamente

    const intervalMinutes = raw.syncIntervalMinutes ?? adaptiveInterval; // override manual siempre gana (spec §13)
    if (isDueForScheduledSync(raw, now, intervalMinutes)) {
      await runScheduled(raw.id, "incremental");
    }

    const lastReconciliation = await getLastSuccessfulModeRunAt("event_integration", raw.id, "reconciliation");
    const reconciliationDue = !lastReconciliation || (now.getTime() - lastReconciliation.getTime()) >= WEEZEVENT_RECONCILIATION_INTERVAL_MINUTES * 60_000;
    if (reconciliationDue) {
      await runScheduled(raw.id, "reconciliation");
    }
  }
}

let task: ScheduledTask | null = null;

export function isWeezeventSchedulerRunning(): boolean {
  return task !== null;
}

/** Se llama SOLO desde server/_core/index.ts vía conditionallyStartJob("weezevent_scheduler_enabled", ...) — nunca directamente. */
export function startWeezeventScheduler(): void {
  if (task) return;
  task = cron.schedule("* * * * *", () => {
    tick().catch(err => console.error("[WeezeventScheduler] tick falló:", err));
  });
  console.log("[WeezeventScheduler] Iniciado (tick cada minuto, cadencia adaptativa por evento) — weezevent_scheduler_enabled=true");
}

export function stopWeezeventScheduler(): void {
  task?.stop();
  task = null;
}
