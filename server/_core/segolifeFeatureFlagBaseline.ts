/**
 * segolifeFeatureFlagBaseline.ts — baseline operativo explícito para Segolife.
 *
 * `pnpm db:migrate` aplica las 126 migraciones históricas heredadas de Náyade
 * Experiences tal cual — varias de ellas siembran feature flags con
 * `enabled=1` (decisiones correctas para el negocio turístico real de
 * Náyade, irrelevantes para Segolife). No reescribimos esas migraciones
 * (perderíamos su trazabilidad histórica) — en su lugar, este baseline se
 * ejecuta DESPUÉS del seed y fuerza `enabled=0` en los módulos/jobs legacy
 * que Segolife no usa todavía. Es explícito, idempotente (un UPDATE no falla
 * si la fila no existe o ya está en 0) y no borra ninguna tabla ni fila de
 * `feature_flags` — el catálogo histórico se conserva completo, solo se
 * apaga lo que no corresponde a Segolife hoy.
 *
 * Solo se invoca desde `pnpm db:seed` (scripts/db-seed.ts). Nunca desde el
 * arranque del servidor.
 *
 * Clasificación (ver informe de la fase "SEGOLIFE production DB baseline"):
 *
 *  D — Jobs en segundo plano que se auto-arrancan en el boot
 *      (server/_core/index.ts, conditionallyStartJob). Máxima prioridad:
 *      si quedan enabled=1 ejecutan trabajo real (emails, escaneo IMAP,
 *      conciliación bancaria) sin que nadie lo pida.
 *
 *  C — Módulos verticales exclusivos del negocio turístico de Náyade
 *      (hotel, spa, restaurantes, REAV, TPV, datáfono, caja). Gatean
 *      procedures tRPC vía assertModuleEnabled() y visibilidad de menú en
 *      el admin (AdminLayout.tsx / OnboardingWizard.tsx) — no arrancan
 *      nada solos, pero no pintan nada en Segolife hoy.
 *
 *  B — Infraestructura genérica, reutilizable más adelante para Segolife
 *      (CRM/leads, movimientos bancarios, proveedores, ticketing —
 *      ticketing es el candidato más claro, dado el roadmap de eventos).
 *      Se apagan igual que las C por el mismo principio ("todo lo no
 *      necesario, desactivado"), pero se documentan aparte porque no son
 *      descartables sin más.
 *
 * Ninguno de los 21 flags de abajo es "A — necesario para Segolife ahora":
 * lo que Segolife necesita hoy (auth, RBAC, communities, students, admin,
 * tRPC) no está gateado por ningún feature flag, es infraestructura core.
 */
import mysql from "mysql2/promise";

const LEGACY_FLAGS_TO_DISABLE: Array<{ key: string; classification: "B" | "C" | "D"; note: string }> = [
  // D — jobs que se auto-arrancan en boot (server/_core/index.ts)
  { key: "abandoned_checkout_cleanup_enabled", classification: "D", note: "job limpieza de checkouts abandonados (reservas/pagos Náyade)" },
  { key: "installment_overdue_job_enabled",    classification: "D", note: "job cuotas de pago fraccionado vencidas + recordatorio email" },
  { key: "cancellation_stale_job_enabled",     classification: "D", note: "job expedientes de cancelación sin atender" },
  { key: "email_ingestion_enabled",            classification: "D", note: "job de ingesta de emails TPV (IMAP) + gate del router emailIngestion" },
  { key: "email_automation_job_enabled",       classification: "D", note: "cron de email_scheduled_jobs (recordatorios de presupuesto Náyade)" },
  { key: "card_terminal_matching_enabled",     classification: "D", note: "job de conciliación automática de datáfono" },

  // C — módulos verticales exclusivos del negocio turístico de Náyade (gate de router/menú, no arrancan solos)
  { key: "hotel_module_enabled",               classification: "C", note: "reservas de hotel" },
  { key: "spa_module_enabled",                 classification: "C", note: "reservas de SPA" },
  { key: "restaurants_module_enabled",         classification: "C", note: "reservas de restaurante" },
  { key: "reav_module_enabled",                classification: "C", note: "expedientes REAV (régimen fiscal de agencias de viaje)" },
  { key: "tpv_enabled",                        classification: "C", note: "terminal punto de venta presencial" },
  { key: "tpv_cash_closure_enabled",           classification: "C", note: "cierre de caja TPV (sin referencias activas en código, se apaga igualmente)" },
  { key: "tpv_email_notifications_enabled",    classification: "C", note: "notificación por email de cierres TPV" },
  { key: "cash_register_module_enabled",       classification: "C", note: "panel de caja registradora" },
  { key: "card_terminal_batches_enabled",      classification: "C", note: "lotes de datáfono" },
  { key: "card_terminal_auto_match_enabled",   classification: "C", note: "sin referencias activas en código, se apaga igualmente" },
  { key: "cancellations_module_enabled",       classification: "C", note: "gate del router de cancelaciones de reserva" },

  // B — infraestructura genérica, potencialmente reutilizable para Segolife más adelante
  { key: "crm_module_enabled",                 classification: "B", note: "leads/presupuestos/clientes — reutilizable para gestión de comunidad" },
  { key: "bank_movements_module_enabled",      classification: "B", note: "conciliación de movimientos bancarios — reutilizable para contabilidad propia" },
  { key: "suppliers_module_enabled",           classification: "B", note: "gestión de proveedores — reutilizable para partners/proveedores de eventos" },
  { key: "ticketing_module_enabled",           classification: "B", note: "venta de entradas — candidato más claro para el futuro módulo de eventos" },
];

export async function applySegolifeFeatureFlagBaseline(): Promise<{ turnedOff: string[] }> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const turnedOff: string[] = [];
  try {
    for (const { key } of LEGACY_FLAGS_TO_DISABLE) {
      const [result] = await conn.execute(
        `UPDATE feature_flags SET enabled = 0 WHERE \`key\` = ? AND enabled = 1`,
        [key]
      ) as any[];
      if ((result as any).affectedRows > 0) turnedOff.push(key);
    }
    console.log(
      `[FeatureFlagBaseline] Baseline Segolife aplicado — ${turnedOff.length} flag(s) apagados: ${turnedOff.join(", ") || "ninguno (ya estaban todos en 0)"}`
    );
    return { turnedOff };
  } finally {
    await conn.end();
  }
}
