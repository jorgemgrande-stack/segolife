// SEGOLIFE — Weezevent Live Operations (2026-08-23) — activa en producción el
// scheduler automático de Weezevent (server/segolife/integrations/weezeventScheduler.ts),
// construido y testeado en esta misma intervención pero nunca activado: la
// fila del feature flag no existe todavía en `feature_flags`, así que
// `getFeatureFlag()` cae al fallback `false` (ver server/_core/index.ts,
// conditionallyStartJob). Este script siembra esa fila con `enabled=1`
// directamente — activación deliberada, mismo criterio exacto que
// scripts/apply-0172-enable-community-lifecycle-scheduler.cjs.
//
// Seguro activar: el mapping SKYLANDS (event_integrations.id=1) ya tiene
// enabled=1/sync_enabled=1/status='connected' (confirmado por lectura real
// antes de este script), y loyaltyEnabled=0 (Loyalty se queda OFF — el
// scheduler solo automatiza SINCRONIZACIÓN de datos, nunca activa Loyalty
// por sí mismo). El scheduler reutiliza EXACTAMENTE la misma
// syncEventIntegration()/tryAcquireSyncLock() que ya usa el botón manual
// "Sync now" — ningún camino nuevo de escritura.
//
// El scheduler en sí no arranca solo al escribir esta fila — arranca la
// próxima vez que el proceso reinicie y lea el flag en el arranque
// (conditionallyStartJob se evalúa una sola vez, al boot). Este script solo
// prepara el dato; el reinicio real ocurre por separado (redeploy).
//
// Aditiva, idempotente (SELECT antes de INSERT/UPDATE).
// Run: railway ssh -- node scripts/apply-0174-enable-weezevent-scheduler.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const FLAG_KEY = "weezevent_scheduler_enabled";

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0174 — activar weezevent_scheduler_enabled");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  // Re-chequeo de seguridad inmediatamente antes de escribir (convención de
  // esta sesión) — confirma que SKYLANDS sigue en el estado esperado antes
  // de activar el scheduler que empezará a tocarlo automáticamente.
  const [mappings] = await c.query(
    "SELECT id, event_id, enabled, sync_enabled, status, loyalty_enabled FROM event_integrations WHERE provider_id = (SELECT id FROM integration_providers WHERE `key` = 'weezevent')"
  );
  console.log("\n[Re-chequeo] event_integrations Weezevent reales:", JSON.stringify(mappings));
  const skylands = mappings.find((m) => m.event_id === 233);
  if (!skylands || !skylands.enabled || !skylands.sync_enabled || skylands.status !== "connected") {
    console.error("ABORTADO: SKYLANDS (event_id=233) no está en el estado esperado (enabled=1/sync_enabled=1/status=connected) — revisar antes de activar el scheduler.");
    await c.end();
    process.exit(1);
  }
  if (skylands.loyalty_enabled) {
    console.error("ABORTADO: SKYLANDS tiene loyalty_enabled=1 — este script solo debe activar el scheduler mientras Loyalty sigue OFF por decisión deliberada (spec §18/§26).");
    await c.end();
    process.exit(1);
  }
  console.log("✓ SKYLANDS (event_id=233): enabled=1, sync_enabled=1, status=connected, loyalty_enabled=0 — seguro activar el scheduler.");

  const [[existing]] = await c.query("SELECT id, enabled FROM feature_flags WHERE `key` = ?", [FLAG_KEY]);

  if (!existing) {
    await c.execute(
      `INSERT INTO feature_flags (\`key\`, name, description, module, enabled, default_enabled, risk_level)
       VALUES (?, ?, ?, 'integrations', 1, 0, 'medium')`,
      [
        FLAG_KEY,
        "Weezevent — scheduler automático adaptativo",
        "Cada minuto: sincroniza automáticamente los event_integrations de Weezevent con enabled=1/sync_enabled=1, con cadencia ADAPTATIVA según la proximidad real al evento (lejano=60min, próximo<7días=15min, ventana activa=2min, tras el evento=15min, >48h tras el fin=detenido) más un refetch de reconciliación completo cada 6h. Reutiliza EXACTAMENTE la misma syncEventIntegration()/tryAcquireSyncLock() que el botón manual 'Sync now' — nunca un camino de escritura nuevo, nunca reimplementa la ingesta. loyalty_enabled sigue siendo un gate independiente (por fila) — activar este scheduler NUNCA activa Loyalty por sí mismo.",
      ]
    );
    console.log(`\n✓ INSERT feature_flags.${FLAG_KEY} (enabled=1)`);
  } else if (existing.enabled) {
    console.log(`\n· skip (${FLAG_KEY} ya existía con enabled=1)`);
  } else {
    await c.execute("UPDATE feature_flags SET enabled = 1 WHERE `key` = ?", [FLAG_KEY]);
    console.log(`\n✓ UPDATE feature_flags.${FLAG_KEY} enabled 0→1 (fila ya existía)`);
  }

  const [[after]] = await c.query("SELECT `key`, enabled, module, risk_level FROM feature_flags WHERE `key` = ?", [FLAG_KEY]);
  console.log("\n[DESPUÉS]", JSON.stringify(after));

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0174 aplicada (el scheduler arrancará en el próximo reinicio del proceso)");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
