// Cierre post-roadmap (2026-08-23) — activa en producción el scheduler de
// ciclo de vida de Community (F65), construido y testeado desde hace días
// pero nunca activado: la fila del feature flag no existía todavía en
// `feature_flags`, así que `getFeatureFlag()` siempre caía al fallback
// `false` (ver server/_core/index.ts, conditionallyStartJob). Este script
// siembra esa fila con `enabled=1` directamente — es una activación
// deliberada, no un simple seed a "off por defecto" como el resto de flags
// nuevos de esta sesión.
//
// El scheduler en sí (server/segolife/community/communityLifecycleScheduler.ts)
// no arranca solo al escribir esta fila — arranca la próxima vez que el
// proceso reinicie y lea el flag en el arranque (conditionallyStartJob se
// evalúa una sola vez, al boot). Este script solo prepara el dato; el
// reinicio real ocurre por separado (en esta intervención, coincide con la
// activación de las variables VAPID de Push).
//
// Aditiva, idempotente (SELECT antes de INSERT/UPDATE).
// Run: railway ssh -- node scripts/apply-0172-enable-community-lifecycle-scheduler.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const FLAG_KEY = "community_lifecycle_scheduler_enabled";

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0172 — activar community_lifecycle_scheduler_enabled");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  const [[existing]] = await c.query("SELECT id, enabled FROM feature_flags WHERE `key` = ?", [FLAG_KEY]);

  if (!existing) {
    await c.execute(
      `INSERT INTO feature_flags (\`key\`, name, description, module, enabled, default_enabled, risk_level)
       VALUES (?, ?, ?, 'community', 1, 0, 'medium')`,
      [
        FLAG_KEY,
        "Community — ciclo de vida automático",
        "Cada minuto: activa las propuestas de Community programadas cuya fecha de inicio ya llegó, y cierra las propuestas activas (FLASH o normales) cuya fecha de fin ya pasó. Reutiliza exactamente las mismas funciones que ya usan las acciones manuales del admin (publicar/cerrar ahora) — nunca reimplementa esa lógica. Bloquear un voto fuera de plazo YA funcionaba antes de este flag (server-side, siempre) — este flag solo automatiza el archivado del estado y la activación de propuestas programadas, que antes requerían una acción manual del admin.",
      ]
    );
    console.log(`✓ INSERT feature_flags.${FLAG_KEY} (enabled=1)`);
  } else if (existing.enabled) {
    console.log(`· skip (${FLAG_KEY} ya existía con enabled=1)`);
  } else {
    await c.execute("UPDATE feature_flags SET enabled = 1 WHERE `key` = ?", [FLAG_KEY]);
    console.log(`✓ UPDATE feature_flags.${FLAG_KEY} enabled 0→1 (fila ya existía)`);
  }

  const [[after]] = await c.query("SELECT `key`, enabled, module, risk_level FROM feature_flags WHERE `key` = ?", [FLAG_KEY]);
  console.log("\n[DESPUÉS]", JSON.stringify(after));

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0172 aplicada (el scheduler arrancará en el próximo reinicio del proceso)");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
