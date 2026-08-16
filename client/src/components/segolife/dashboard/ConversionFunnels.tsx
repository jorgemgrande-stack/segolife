/**
 * ConversionFunnels.tsx — SEGOLIFE ADMIN COMMAND CENTER (Fase 14, spec §14).
 * Funnels de CONVERSIÓN reales (evento/referido/Benefit) — distintos del
 * "Community Funnel" ya existente (PlanAndPlayAndFunnel.tsx), que es un
 * snapshot de poblaciones sin secuencia de conversión.
 */
import { Filter } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, fmtNum } from "./shared";
import type { DashboardQueryInput } from "./useDashboardFilters";

interface FunnelStageView { key: string; label: string; count: number }
interface ConversionFunnelView { stages: FunnelStageView[]; note: string }

function FunnelBars({ funnel }: { funnel: ConversionFunnelView }) {
  const max = Math.max(1, ...funnel.stages.map(s => s.count));
  return (
    <div className="space-y-1.5">
      {funnel.stages.map(stage => (
        <div key={stage.key}>
          <div className="flex items-center justify-between text-[11px] mb-0.5">
            <span className="text-foreground/80">{stage.label}</span>
            <span className="font-bold tabular-nums">{fmtNum(stage.count)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(2, (stage.count / max) * 100)}%` }} />
          </div>
        </div>
      ))}
      <p className="text-[9px] text-muted-foreground/50 italic pt-1">{funnel.note}</p>
    </div>
  );
}

export function ConversionFunnels({ filters }: { filters: DashboardQueryInput }) {
  const funnels = trpc.dashboard.getFunnels.useQuery(filters);

  return (
    <Panel title="Funnels de conversión" icon={Filter}>
      {funnels.isLoading && <DashboardEmptyState kind="loading" title="" />}
      {funnels.error && <DashboardEmptyState kind="error" title="No se pudieron cargar los funnels" detail={funnels.error.message} />}
      {funnels.data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Eventos</p>
            {funnels.data.event.stages.every(s => s.count === 0)
              ? <DashboardEmptyState kind="zero-real" title="Sin actividad de eventos en este rango" />
              : <FunnelBars funnel={funnels.data.event} />}
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Referidos</p>
            {funnels.data.referral.stages.every(s => s.count === 0)
              ? <DashboardEmptyState kind="zero-real" title="Sin referidos en este rango" />
              : <FunnelBars funnel={funnels.data.referral} />}
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Benefits</p>
            {funnels.data.benefit.stages.every(s => s.count === 0)
              ? <DashboardEmptyState kind="zero-real" title="Sin Benefits en este rango" />
              : <FunnelBars funnel={funnels.data.benefit} />}
          </div>
        </div>
      )}
    </Panel>
  );
}
