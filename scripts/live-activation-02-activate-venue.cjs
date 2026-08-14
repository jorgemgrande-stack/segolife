// SEGOLIFE — SEGOTOKENS LIVE ACTIVATION — activa loyalty_enabled=1 para UN venue (spec §18/§20).
// IDEMPOTENTE: si ya está en 1, no hace nada. Requiere que el corte global YA esté
// establecido (spec §3: "nunca debe existir un momento en que histórico pueda cobrar").
// Run: railway ssh --service segolife -- node scripts/live-activation-02-activate-venue.cjs <venueId>
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const venueId = Number(process.argv[2]);
if (!venueId || Number.isNaN(venueId)) {
  console.error("USO: node live-activation-02-activate-venue.cjs <venueId>");
  process.exit(1);
}

(async () => {
  const c = await mysql.createConnection(DB_URL);
  console.log("=".repeat(72));
  console.log(`SEGOLIFE — SEGOTOKENS LIVE ACTIVATION — 02: activar venue_id=${venueId}`);
  console.log("=".repeat(72));

  const [[cutoff]] = await c.query(`SELECT value FROM system_settings WHERE \`key\` = 'loyalty_global_cutoff_at'`);
  if (!cutoff || !cutoff.value || !cutoff.value.trim()) {
    console.error("ABORTADO: loyalty_global_cutoff_at sigue NULL — ejecutar live-activation-01-set-cutoff.cjs PRIMERO. Nunca se activa un venue sin corte establecido.");
    process.exit(1);
  }
  console.log(`Corte global vigente: ${cutoff.value}`);

  const [[integration]] = await c.query(
    `SELECT vi.id AS integration_id, vi.loyalty_enabled, vi.enabled, vi.sync_enabled, vi.status, v.name AS venue_name
     FROM venue_integrations vi JOIN venues v ON v.id = vi.venue_id WHERE vi.venue_id = ?`,
    [venueId]
  );
  if (!integration) {
    console.error(`ABORTADO: no existe venue_integrations para venue_id=${venueId}`);
    process.exit(1);
  }
  console.log("Estado actual:", integration);

  if (integration.loyalty_enabled === 1) {
    console.log(`YA ACTIVO — no se toca (idempotente): ${integration.venue_name} ya tiene loyalty_enabled=1.`);
    await c.end();
    return;
  }

  const [result] = await c.execute(
    `UPDATE venue_integrations SET loyalty_enabled = 1 WHERE venue_id = ? AND loyalty_enabled = 0`,
    [venueId]
  );
  if (result.affectedRows !== 1) {
    console.error(`ABORTADO: UPDATE afectó ${result.affectedRows} filas (esperado 1) — posible carrera, revisar antes de reintentar.`);
    process.exit(1);
  }
  console.log(`✓ loyalty_enabled=1 para ${integration.venue_name} (venue_id=${venueId}, integration_id=${integration.integration_id})`);

  const [[after]] = await c.query(`SELECT loyalty_enabled FROM venue_integrations WHERE venue_id = ?`, [venueId]);
  console.log("Verificación post-write loyalty_enabled:", after.loyalty_enabled);

  await c.end();
  console.log("=".repeat(72));
  console.log(`FIN — ${integration.venue_name} activado. Observar antes de continuar al siguiente venue.`);
})().catch(e => { console.error("ERR", e); process.exit(1); });
