/**
 * PlanAndPlayAndFunnel.tsx — spec §21 (Comunity — "Plan & Play" era solo la
 * marca antigua de este mismo panel, ya retirada del texto visible, ver
 * SEGOLIFE — COMMUNITY Production Implementation §30) + §22 (Community
 * Funnel, cada etapa con su propia población/periodo — nunca fusionadas).
 */
import { Link } from "wouter";
import { Vote, Milestone } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, StatRow, fmtNum, fmtPct } from "./shared";
import type { DashboardQueryInput } from "./useDashboardFilters";

export function PlanAndPlayAndFunnel({ filters }: { filters: DashboardQueryInput }) {
  const planAndPlay = trpc.dashboard.getPlanAndPlay.useQuery(filters);
  const funnel = trpc.dashboard.getCommunityFunnel.useQuery(filters);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Panel title="Comunity" icon={Vote} action={<Link href="/admin/comunity" className="text-[10px] font-semibold text-violet-500 hover:underline">Ver Comunity →</Link>}>
        {planAndPlay.isLoading && <DashboardEmptyState kind="loading" title="" />}
        {planAndPlay.error && <DashboardEmptyState kind="error" title="No se pudo cargar Comunity" detail={planAndPlay.error.message} />}
        {planAndPlay.data && planAndPlay.data.activeProposals === 0 && (
          <DashboardEmptyState kind="zero-real" title="No hay propuestas activas" />
        )}
        {planAndPlay.data && planAndPlay.data.activeProposals > 0 && (
          <div className="space-y-1">
            <StatRow label="Propuestas activas" value={planAndPlay.data.activeProposals} />
            <StatRow label="Respuestas en el periodo" value={planAndPlay.data.responsesInPeriod} sub={fmtPct(planAndPlay.data.participationPct)} />
            {planAndPlay.data.pendingModerationStudentProposals > 0 && (
              <StatRow label="Pendientes de moderar" value={planAndPlay.data.pendingModerationStudentProposals} />
            )}
            {planAndPlay.data.mostActive && (
              <Link href={`/admin/comunity/${planAndPlay.data.mostActive.proposalId}`} className="block mt-2 pt-2 border-t border-border/20 rounded-lg hover:bg-muted/40 transition-colors -mx-1 px-1">
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Más activa</p>
                <p className="text-xs font-semibold">{planAndPlay.data.mostActive.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {planAndPlay.data.mostActive.topAnswerLabel ?? "—"} {planAndPlay.data.mostActive.topAnswerPct != null ? `${planAndPlay.data.mostActive.topAnswerPct}%` : ""} · {planAndPlay.data.mostActive.responseCount} respuestas
                </p>
              </Link>
            )}
            {planAndPlay.data.endingSoon.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/20 space-y-1">
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Terminan pronto</p>
                {planAndPlay.data.endingSoon.slice(0, 3).map(p => (
                  <Link key={p.proposalId} href={`/admin/comunity/${p.proposalId}`} className="block text-[11px] hover:text-violet-500 dark:hover:text-violet-400 transition-colors truncate">
                    {p.title}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Community Funnel" icon={Milestone}>
        {funnel.isLoading && <DashboardEmptyState kind="loading" title="" />}
        {funnel.error && <DashboardEmptyState kind="error" title="No se pudo cargar el Funnel" detail={funnel.error.message} />}
        {funnel.data && (
          <div className="space-y-1.5">
            {funnel.data.stages.map(stage => (
              <div key={stage.key} className="flex items-center justify-between gap-2 text-xs" title={`${stage.population} · ${stage.period}`}>
                <span className="text-foreground/80 truncate">{stage.label}</span>
                <span className="font-bold tabular-nums shrink-0">{fmtNum(stage.count)}</span>
              </div>
            ))}
            <p className="text-[9px] text-muted-foreground/50 italic pt-1">{funnel.data.note}</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
