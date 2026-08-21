/**
 * fix-community-proposal-audience-gap.cjs — repara el hueco real reportado
 * 2026-08-22: publishProposal() (server/segolife/community/communityAudienceService.ts)
 * resolvía la audiencia ANTES de conceder el reward COMMUNITY_PROPOSAL_APPROVED
 * al autor de la idea original — si la audiencia exigía tokensBalanceMin y el
 * autor partía de 0 SegoTokens, quedaba fuera del snapshot para siempre (el
 * snapshot es fijo). Corregido en código (el autor ahora se añade siempre a
 * la audiencia); este script repara el ÚNICO caso ya publicado antes del fix
 * (proposal_id=5, sourceStudentProposalId=3, autor userId=26 "Antonio Ruiz").
 *
 * Auditado antes de escribir: verificado por consulta directa contra
 * producción que proposal_id=5 está status=active, que su audiencia (2
 * filas: userId 4 y 5) NO incluye a userId=26, y que la OTRA propuesta
 * convertida existente (proposal_id=3, autor userId=4) SÍ estaba
 * correctamente incluida (su balance ya era >0 antes de su propio reward) —
 * confirmando que este es el único caso afectado, no un problema sistémico
 * de datos.
 *
 * Idempotente: usa INSERT IGNORE contra el UNIQUE real
 * (community_proposal_audiences_unique on proposal_id,user_id) — repetir
 * la ejecución no duplica nada.
 */
const mysql = require("mysql2/promise");

const FIXES = [{ proposalId: 5, userId: 26, label: "Antonio Ruiz (student_profiles.id=16) — proposal #5" }];

(async () => {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    for (const fix of FIXES) {
      const [before] = await conn.query(
        "SELECT COUNT(*) as c FROM community_proposal_audiences WHERE proposal_id=? AND user_id=?",
        [fix.proposalId, fix.userId]
      );
      if (before[0].c > 0) {
        console.log(`[skip] ${fix.label} ya estaba en la audiencia.`);
        continue;
      }
      await conn.execute(
        "INSERT IGNORE INTO community_proposal_audiences (proposal_id, user_id, created_at) VALUES (?, ?, NOW())",
        [fix.proposalId, fix.userId]
      );
      const [after] = await conn.query(
        "SELECT COUNT(*) as c FROM community_proposal_audiences WHERE proposal_id=? AND user_id=?",
        [fix.proposalId, fix.userId]
      );
      console.log(`[fixed] ${fix.label} — insertado (verificado: ${after[0].c === 1 ? "OK" : "FALLO"})`);
    }
  } finally {
    await conn.end();
  }
})();
