/**
 * StudentIntelligence.tsx — spec §10 (segmentos, reutilizando
 * studentIntelligenceService.ts vía agregado SQL) + §15 (Historical
 * Audience, 1 pasada) + §16 (Cross-Venue, poblaciones SEPARADAS —
 * Registered Students e Historical Audience nunca se suman).
 */
import { Link } from "wouter";
import { Brain, History, Network } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, StatRow, fmtPct } from "./shared";
import type { DashboardQueryInput } from "./useDashboardFilters";

const SEGMENT_COLOR: Record<string, string> = {
  new: "bg-blue-500", active: "bg-emerald-500", highly_engaged: "bg-violet-500",
  at_risk: "bg-amber-500", dormant: "bg-muted-foreground/40", high_spend: "bg-rose-500",
};

export function StudentIntelligence({ filters }: { filters: DashboardQueryInput }) {
  const { data, isLoading, error } = trpc.dashboard.getStudentIntelligence.useQuery(filters);
  const historical = trpc.dashboard.getHistoricalAudience.useQuery();
  const crossVenue = trpc.dashboard.getCrossVenue.useQuery();

  return (
    <Panel title="Student Intelligence" icon={Brain} action={<Link href="/admin/students" className="text-[10px] font-semibold text-violet-500 hover:underline">Ver Students →</Link>}>
      {isLoading && <DashboardEmptyState kind="loading" title="" />}
      {error && <DashboardEmptyState kind="error" title="No se pudo cargar Student Intelligence" detail={error.message} />}
      {data && data.totalStudents === 0 && <DashboardEmptyState kind="zero-real" title="Todavía no hay Students registrados" />}
      {data && data.totalStudents > 0 && (
        <div className="space-y-1.5">
          {data.segments.filter(s => s.count > 0 || s.key !== "dormant").map(seg => (
            <div key={seg.key} className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${SEGMENT_COLOR[seg.key] ?? "bg-muted"}`} />
              <span className="text-xs text-foreground/80 flex-1">{seg.label}</span>
              <span className="text-xs font-bold tabular-nums">{seg.count}</span>
              <span className="text-[10px] text-muted-foreground w-10 text-right">{seg.populationPct}%</span>
            </div>
          ))}
          <div className="pt-2 mt-2 border-t border-border/20">
            <StatRow label="Multi-venue (dimensión aparte)" value={`${data.multiVenue.count} (${fmtPct(data.multiVenue.populationPct)})`} />
          </div>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-border/20 grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            <History className="w-3 h-3" /> Historical Audience
          </div>
          {historical.isLoading && <DashboardEmptyState kind="loading" title="" />}
          {historical.error && <DashboardEmptyState kind="error" title="Error" detail={historical.error.message} />}
          {historical.data && (
            <Link href="/admin/students/historical" className="block space-y-1 hover:opacity-80">
              <StatRow label="Total" value={historical.data.total} />
              <StatRow label="Vinculadas" value={historical.data.linked} />
              <StatRow label="Posibles" value={historical.data.possibleMatch + historical.data.autoMatchCandidate} />
              <StatRow label="Cross-venue" value={historical.data.crossVenue} />
            </Link>
          )}
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            <Network className="w-3 h-3" /> Cross-Venue
          </div>
          {crossVenue.isLoading && <DashboardEmptyState kind="loading" title="" />}
          {crossVenue.error && <DashboardEmptyState kind="error" title="Error" detail={crossVenue.error.message} />}
          {crossVenue.data && (
            <div className="space-y-1">
              <StatRow label="Registrados multi-venue" value={`${crossVenue.data.registered.multiVenue} (${fmtPct(crossVenue.data.registered.multiVenuePct)})`} />
              <StatRow label="Históricos multi-venue" value={`${crossVenue.data.historical.crossVenue} (${fmtPct(crossVenue.data.historical.crossVenuePct)})`} />
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
