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

/** Definiciones REALES (mismos umbrales que studentIntelligenceService.ts) — nunca inventadas, spec §22/§67. */
const SEGMENT_TOOLTIP: Record<string, string> = {
  new: "Registrado hace menos de 14 días.",
  active: "Con actividad genuina en los últimos 30 días, sin cumplir ningún otro criterio especial.",
  highly_engaged: "10 o más señales de actividad en los últimos 90 días, con actividad en los últimos 14 días.",
  at_risk: "Sin actividad genuina entre 30 y 60 días.",
  dormant: "Sin actividad genuina registrada nunca, o más de 60 días sin actividad.",
  high_spend: "Gasto acumulado o SegoTokens acumulados altos, con actividad en los últimos 30 días.",
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
            <Link
              key={seg.key}
              href={`/admin/students?segment=${seg.key}`}
              className="flex items-center gap-2 -mx-1 px-1 py-0.5 rounded-md hover:bg-muted/60 transition-colors group"
              title={SEGMENT_TOOLTIP[seg.key]}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${SEGMENT_COLOR[seg.key] ?? "bg-muted"}`} />
              <span className="text-xs text-foreground/80 flex-1 group-hover:text-violet-500 dark:group-hover:text-violet-400">{seg.label}</span>
              <span className="text-xs font-bold tabular-nums">{seg.count}</span>
              <span className="text-[10px] text-muted-foreground w-10 text-right">{seg.populationPct}%</span>
            </Link>
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
            <div className="space-y-1">
              <Link href="/admin/students/historical" className="block hover:text-violet-500 dark:hover:text-violet-400 transition-colors">
                <StatRow label="Total" value={historical.data.total} />
              </Link>
              <Link href="/admin/students/historical?status=LINKED" className="block hover:text-violet-500 dark:hover:text-violet-400 transition-colors">
                <StatRow label="Vinculadas" value={historical.data.linked} />
              </Link>
              <Link href="/admin/students/historical?status=POSSIBLE_MATCH" className="block hover:text-violet-500 dark:hover:text-violet-400 transition-colors">
                <StatRow label="Posibles" value={historical.data.possibleMatch + historical.data.autoMatchCandidate} />
              </Link>
              <Link href="/admin/students/historical?crossVenueOnly=true" className="block hover:text-violet-500 dark:hover:text-violet-400 transition-colors">
                <StatRow label="Cross-venue" value={historical.data.crossVenue} />
              </Link>
            </div>
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
              {/* Sin filtro multi-venue real en StudentsManager todavía — no se enlaza para no simular una función que no existe (spec §9). */}
              <StatRow label="Registrados multi-venue" value={`${crossVenue.data.registered.multiVenue} (${fmtPct(crossVenue.data.registered.multiVenuePct)})`} />
              <Link href="/admin/students/historical?crossVenueOnly=true" className="block hover:text-violet-500 dark:hover:text-violet-400 transition-colors">
                <StatRow label="Históricos multi-venue" value={`${crossVenue.data.historical.crossVenue} (${fmtPct(crossVenue.data.historical.crossVenuePct)})`} />
              </Link>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
