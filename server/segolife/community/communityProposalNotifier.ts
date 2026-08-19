/**
 * communityProposalNotifier.ts — Community Proposals (backlog, spec §15.B).
 * Alerta operacional a los admins activos cuando un Student envía una idea
 * nueva, pendiente de moderación. Reutiliza EXACTAMENTE la infraestructura
 * de Engagement Core ya existente (createNotification()/ENGAGEMENT_TEMPLATES),
 * mismo patrón que fourvenuesPublicationNotifier.ts (FIX-05) — nunca un
 * sistema paralelo, nunca email/SMS/WhatsApp (solo in_app, ver plantilla).
 *
 * IDEMPOTENCIA: delega en `notifications.idempotencyKey` (UNIQUE real) —
 * clave por proposalId+adminId, así que un reintento de la mutación
 * (network flake del cliente, doble click) nunca duplica la alerta.
 *
 * BEST-EFFORT: un fallo al notificar NUNCA debe impedir que la idea del
 * Student se guarde — se registra y se continúa, mismo criterio que el
 * resto de notificadores best-effort de este repo.
 *
 * La confirmación AL PROPIO Student ya existe (toast inmediato en
 * ComunityHub.tsx al enviar) — este notificador es solo el lado Admin.
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { users } from "../../../drizzle/schema";
import { createNotification } from "../engagement/notificationService";
import { renderTemplate } from "../engagement/templates";
import type { CommunityStudentProposal } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

async function listAdminRecipients(conn: DbHandle): Promise<Array<{ id: number }>> {
  // Mismo criterio que fourvenuesPublicationNotifier.ts — Admin solamente,
  // nunca venue_admin, nunca una cuenta desactivada.
  return conn.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.isActive, true)));
}

/** Nunca lanza — ver comentario de cabecera (best-effort). */
export async function notifyStudentProposalSubmitted(proposal: CommunityStudentProposal, studentName: string | null, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  try {
    const admins = await listAdminRecipients(conn);
    if (admins.length === 0) return;

    const templateKey = "community_student_proposal_submitted";
    const rendered = renderTemplate(
      templateKey,
      { studentName: studentName ?? "—", proposalTitle: proposal.title },
      `/admin/comunity/moderacion`
    );

    for (const admin of admins) {
      await createNotification({
        userId: admin.id,
        communityId: proposal.communityId,
        type: templateKey,
        category: "events",
        audienceType: "transactional",
        rendered,
        templateKey,
        templateVersion: 1,
        sourceType: "community_student_proposal",
        sourceId: proposal.id,
        idempotencyKey: `${templateKey}:${proposal.id}:${admin.id}`,
      }, conn);
    }
  } catch (err) {
    console.error(`[CommunityProposalNotifier] fallo al notificar proposalId=${proposal.id}:`, err instanceof Error ? err.message : err);
  }
}
