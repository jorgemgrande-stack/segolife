/**
 * communityLifecycleScheduler.ts — F65 (Community: ciclo de vida automático).
 *
 * Hallazgo real de auditoría (F64/Task C): `listExpiredActiveProposals`/
 * `listDueScheduledProposals` (communityDb.ts) existían desde el diseño
 * original de COMUNITY pero NINGÚN caller real las invocaba en todo el
 * repo — ni cron, ni siquiera detrás de un feature flag (el flag
 * `COMUNITY_SCHEDULER_ENABLED` solo existía documentado en un .md, nunca en
 * código). Resultado real: una propuesta FLASH de 15 minutos quedaba
 * `status='active'` en BD para siempre salvo que un admin pulsara "Cerrar
 * ahora"; una "scheduled" nunca se activaba sola. Las queries públicas
 * (isProposalOpenForResponses) ya revalidaban la ventana en cada lectura, así
 * que el estudiante nunca podía votar fuera de plazo — pero el ESTADO
 * persistido nunca reflejaba la realidad, y "scheduled" jamás pasaba a
 * "active" sin intervención humana.
 *
 * Mismo criterio EXACTO que engagementScheduler.ts/integrationScheduler.ts:
 * node-cron cada minuto, NUNCA arranca solo (feature flag DB-backed vía
 * conditionallyStartJob en server/_core/index.ts, default false). "ONE PATH":
 * activar/cerrar aquí llama a las MISMAS funciones que ya usan las mutations
 * manuales (`community.publish`→activateScheduledProposal reutiliza
 * activateProposalNow; `community.closeNow`→setProposalStatus) — este
 * scheduler nunca reimplementa esa lógica, solo decide CUÁNDO llamarla.
 *
 * Sin lock explícito: no hace falta uno nuevo. Cerrar una propuesta ya
 * cerrada es un no-op idempotente (mismo status, sin efectos secundarios).
 * Activar una "scheduled" dos veces en paralelo es seguro por construcción:
 * activateScheduledProposal() vuelve a comprobar status==='scheduled' antes
 * de actuar (perdedora de la carrera no hace nada), y aunque ambas ganaran
 * la lectura antes de que la otra escribiera, tanto earnTokens()
 * (idempotencyKey=community_proposal_approved:<id>) como createNotification()
 * (idempotencyKey=<templateKey>:<proposalId>:<userId>) ya son idempotentes en
 * su propia capa — un segundo intento nunca duplica tokens ni notificaciones.
 */
import cron, { type ScheduledTask } from "node-cron";
import { listExpiredActiveProposals, listDueScheduledProposals, setProposalStatus } from "./communityDb";
import { activateScheduledProposal } from "./communityAudienceService";

export async function tick(): Promise<void> {
  const now = new Date();

  const due = await listDueScheduledProposals(now);
  for (const proposal of due) {
    try {
      await activateScheduledProposal(proposal.id);
    } catch (err) {
      console.error(`[CommunityLifecycleScheduler] fallo al activar propuesta ${proposal.id}:`, err);
    }
  }

  const expired = await listExpiredActiveProposals(now);
  for (const proposal of expired) {
    try {
      await setProposalStatus(proposal.id, "closed", { closedAt: now });
    } catch (err) {
      console.error(`[CommunityLifecycleScheduler] fallo al cerrar propuesta ${proposal.id}:`, err);
    }
  }
}

let task: ScheduledTask | null = null;

export function isCommunityLifecycleSchedulerRunning(): boolean {
  return task !== null;
}

/** Se llama SOLO desde server/_core/index.ts, condicionado al feature flag `community_lifecycle_scheduler_enabled` — nunca desde este módulo directamente. */
export function startCommunityLifecycleScheduler(): void {
  if (task) return;
  task = cron.schedule("* * * * *", () => {
    tick().catch(err => console.error("[CommunityLifecycleScheduler] tick falló:", err));
  });
  console.log("[CommunityLifecycleScheduler] Iniciado (cada minuto) — community_lifecycle_scheduler_enabled=true");
}

export function stopCommunityLifecycleScheduler(): void {
  task?.stop();
  task = null;
}
