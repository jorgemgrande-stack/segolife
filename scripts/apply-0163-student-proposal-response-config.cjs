// MG-05 — Student Community Proposals: configuración de respuesta propuesta.
// Anade 2 columnas NULLABLE a community_student_proposals para que el
// Student pueda proponer (nunca imponer) el mismo tipo de pregunta/opciones
// que ya usa el motor canonico de Admin (community_proposals.questionType,
// mismo enum exacto) — nunca un segundo modelo paralelo.
//
// Aditiva, backward-compatible: ambas columnas NULL por defecto, ninguna
// fila existente se toca. Sin backfill (no hay nada que rellenar — las
// ideas ya enviadas simplemente no tenian esta propuesta).
//
// Idempotente (SHOW COLUMNS antes de ALTER). Run: railway ssh (contenedor
// /app) node scripts/apply-0163-student-proposal-response-config.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0163_community_student_proposal_response_config";

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACION 0163 — MG-05: proposed_question_type/proposed_options");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  const [cols] = await c.query("SHOW COLUMNS FROM community_student_proposals");
  const existing = new Set(cols.map(r => r.Field));

  if (existing.has("proposed_question_type") && existing.has("proposed_options")) {
    console.log("skip — ambas columnas ya existen");
  } else {
    if (!existing.has("proposed_question_type")) {
      await c.query(`
        ALTER TABLE community_student_proposals
        ADD COLUMN proposed_question_type ENUM(
          'single_choice','yes_no','percentage_scale','scale_1_5',
          'multiselect','ranking','attendance_intention','me_apunto','open_text'
        ) NULL AFTER urgency
      `);
      console.log("✓ ADD COLUMN proposed_question_type");
    }
    if (!existing.has("proposed_options")) {
      await c.query(`
        ALTER TABLE community_student_proposals
        ADD COLUMN proposed_options JSON NULL AFTER proposed_question_type
      `);
      console.log("✓ ADD COLUMN proposed_options");
    }
  }

  const [after] = await c.query("SHOW COLUMNS FROM community_student_proposals");
  const ok = after.some(r => r.Field === "proposed_question_type") && after.some(r => r.Field === "proposed_options");
  console.log(ok ? "✓ OK — ambas columnas presentes" : "✗ ERROR — falta alguna columna");

  console.log("\n[TRACKING] __drizzle_migrations");
  const [tracked] = await c.query("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?", [TAG]);
  if (tracked[0].n > 0) {
    console.log(`  skip ${TAG} (ya registrada)`);
  } else {
    await c.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migracion 0163 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
