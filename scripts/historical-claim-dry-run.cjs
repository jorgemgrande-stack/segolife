// SEGOLIFE — HISTORICAL STUDENT CLAIM — DRY RUN (spec §24-25/§48). Solo
// LECTURA — ningún INSERT/UPDATE/DELETE, ningún claim real ejecutado. Sale
// SOLO estadísticas agregadas (nunca nombres/emails/teléfonos individuales)
// para evaluar readiness antes de habilitar cualquier claim real.
//
// Reimplementa en JS plano la MISMA lógica de agrupación/clasificación que
// loadAllIdentityGroups() en server/segolife/students/historicalIdentityService.ts
// (mismo identityKeyFor con prioridad email, mismo normalizeEmail/normalizePhone,
// misma clasificación LINKED/CONFLICT/AUTO_MATCH_CANDIDATE/POSSIBLE_MATCH/
// UNREGISTERED) — no puede importar TS directamente vía railway ssh, así que
// se replica la fórmula exacta en vez de aproximarla.
//
// Run: railway ssh --service segolife -- node scripts/historical-claim-dry-run.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const PROVIDER = "fourvenues_integrations";

function normalizeEmail(email) { return email ? email.trim().toLowerCase() : null; }
function normalizePhone(phone) {
  if (!phone) return null;
  let v = phone.trim().replace(/[\s\-().]/g, "");
  if (v.startsWith("00")) v = "+" + v.slice(2);
  return v || null;
}
function identityKeyFor(email, phone) {
  const e = normalizeEmail(email);
  if (e) return `email:${e}`;
  const p = normalizePhone(phone);
  if (p) return `phone:${p}`;
  return null;
}

async function main() {
  const conn = await mysql.createConnection(DB_URL);
  console.log("=".repeat(72));
  console.log("SEGOLIFE HISTORICAL STUDENT CLAIM — DRY RUN (solo lectura, sin PII)");
  console.log("=".repeat(72));

  const [opRows] = await conn.query(
    `SELECT identity_hint_email, identity_hint_phone, status, linked_user_id, venue_id FROM unresolved_operations WHERE provider = ?`,
    [PROVIDER]
  );
  const [userRows] = await conn.query(`SELECT id, email, phone FROM users`);
  const [studentProfileRows] = await conn.query(`SELECT user_id FROM student_profiles`);
  const studentUserIds = new Set(studentProfileRows.map(r => r.user_id));

  const usersByEmail = new Map();
  const usersByPhone = new Map();
  for (const u of userRows) {
    if (u.email) usersByEmail.set(normalizeEmail(u.email), u.id);
    if (u.phone) {
      const key = normalizePhone(u.phone);
      usersByPhone.set(key, [...(usersByPhone.get(key) ?? []), u.id]);
    }
  }

  const groups = new Map();
  for (const r of opRows) {
    const key = identityKeyFor(r.identity_hint_email, r.identity_hint_phone);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = {
        email: r.identity_hint_email ? normalizeEmail(r.identity_hint_email) : null,
        phone: r.identity_hint_phone ? normalizePhone(r.identity_hint_phone) : null,
        venueIds: new Set(), linkedUserIds: new Set(), rowCount: 0,
      };
      groups.set(key, g);
    }
    g.rowCount++;
    if (r.venue_id) g.venueIds.add(r.venue_id);
    if (r.status === "linked" && r.linked_user_id != null) g.linkedUserIds.add(r.linked_user_id);
  }

  const stats = {
    total: 0, crossVenue: 0,
    linked: 0, conflict: 0,
    autoMatchCandidate: 0, // EXACT_EMAIL_AND_PHONE contra Students reales
    possibleMatchEmailOnly: 0, possibleMatchPhoneOnly: 0,
    unregistered: 0,
    // De las AUTO_MATCH_CANDIDATE/POSSIBLE_MATCH, cuántas corresponden a un userId que YA es Student (tiene student_profiles)
    candidateIsRegisteredStudent: 0,
  };

  for (const g of groups.values()) {
    stats.total++;
    if (g.venueIds.size > 1) stats.crossVenue++;

    if (g.linkedUserIds.size > 1) { stats.conflict++; continue; }
    if (g.linkedUserIds.size === 1) { stats.linked++; continue; }

    const emailMatch = g.email ? usersByEmail.get(g.email) ?? null : null;
    const phoneMatches = g.phone ? (usersByPhone.get(g.phone) ?? []) : [];

    if (emailMatch && phoneMatches.length === 1 && phoneMatches[0] === emailMatch) {
      stats.autoMatchCandidate++;
      if (studentUserIds.has(emailMatch)) stats.candidateIsRegisteredStudent++;
    } else if (emailMatch && phoneMatches.length === 1 && phoneMatches[0] !== emailMatch) {
      stats.conflict++;
    } else if (emailMatch) {
      stats.possibleMatchEmailOnly++;
      if (studentUserIds.has(emailMatch)) stats.candidateIsRegisteredStudent++;
    } else if (phoneMatches.length === 1) {
      stats.possibleMatchPhoneOnly++;
      if (studentUserIds.has(phoneMatches[0])) stats.candidateIsRegisteredStudent++;
    } else {
      stats.unregistered++;
    }
  }

  console.log("\n[IDENTIDADES HISTÓRICAS] (agregadas desde unresolved_operations, provider=fourvenues_integrations)");
  console.log(`  Total identidades:                    ${stats.total}`);
  console.log(`  Cross-venue:                           ${stats.crossVenue}`);
  console.log(`  Ya vinculadas (LINKED):                ${stats.linked}`);
  console.log(`  En conflicto (CONFLICT):                ${stats.conflict}`);
  console.log(`  Candidatas EXACT_EMAIL_AND_PHONE:      ${stats.autoMatchCandidate}`);
  console.log(`  Posible match — SOLO email:            ${stats.possibleMatchEmailOnly}`);
  console.log(`  Posible match — SOLO teléfono:         ${stats.possibleMatchPhoneOnly}`);
  console.log(`  Sin ningún match (UNREGISTERED):       ${stats.unregistered}`);
  console.log(`  Suma de control:                       ${stats.linked + stats.conflict + stats.autoMatchCandidate + stats.possibleMatchEmailOnly + stats.possibleMatchPhoneOnly + stats.unregistered} (debe = total)`);

  console.log("\n[READINESS PARA CLAIM REAL]");
  console.log(`  Identidades cuyo candidato YA es un Student registrado (student_profiles existe): ${stats.candidateIsRegisteredStudent}`);
  console.log(`  -> Estas son las que un claim de autoservicio (student_claim) o admin podría resolver HOY.`);
  console.log(`  -> Ninguna ha sido reclamada por este script (solo lectura).`);

  console.log("\n[VERIFICACIÓN — CERO CLAIMS EJECUTADOS]");
  const [[claimedCheck]] = await conn.query(`SELECT COUNT(*) AS n FROM student_admin_actions WHERE action IN ('historical_identity_claimed')`);
  console.log(`  student_admin_actions con action='historical_identity_claimed': ${claimedCheck.n}`);

  await conn.end();
  console.log("=".repeat(72));
  console.log("FIN DRY RUN — ningún dato modificado");
  console.log("=".repeat(72));
}

main().catch(e => { console.error("ERR", e); process.exit(1); });
