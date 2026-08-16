/**
 * RetentionAndActivity.tsx — SEGOLIFE ADMIN COMMAND CENTER (Fase 14, spec
 * §15/§16). Retención (primera vez vs recurrente) + actividad por hora/día
 * de semana. Se usan barras compactas en vez de una grilla 24×7 completa —
 * con el volumen real actual de producción, una grilla 2D quedaría casi
 * vacía y sería más confusa que informativa (spec §16 "avoid misleading
 * visualizations on sparse datasets"); el backend ya calcula ambos ejes
 * por separado, listo para una grilla real si el volumen lo justifica más
 * adelante.
 */
import { Repeat, BarChart3 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, StatRow, fmtNum, fmtPct } from "./shared";
import type { DashboardQueryInput } from "./useDashboardFilters";

function HourBars({ data }: { data: Array<{ hour: number; count: number }> }) {
  const max = Math.max(1, ...data.map(d => d.count));
  return (
    <div className="flex items-end gap-[2px] h-12">
      {data.map(d => (
        <div key={d.hour} className="flex-1 rounded-sm bg-violet-500/70" style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} title={`${d.hour}:00 — ${d.count}`} />
      ))}
    </div>
  );
}

const WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function WeekdayBars({ data }: { data: Array<{ weekday: number; count: number }> }) {
  const max = Math.max(1, ...data.map(d => d.count));
  return (
    <div className="flex items-end gap-1.5 h-12">
      {data.map(d => (
        <div key={d.weekday} className="flex-1 flex flex-col items-center gap-0.5">
          <div className="w-full rounded-sm bg-violet-500/70" style={{ height: `${Math.max(4, (d.count / max) * 32)}px` }} title={`${WEEKDAY_SHORT[d.weekday]} — ${d.count}`} />
          <span className="text-[8px] text-muted-foreground">{WEEKDAY_SHORT[d.weekday]}</span>
        </div>
      ))}
    </div>
  );
}

export function RetentionAndActivity({ filters }: { filters: DashboardQueryInput }) {
  const retention = trpc.dashboard.getRetention.useQuery(filters);
  const heatmap = trpc.dashboard.getHeatmap.useQuery(filters);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Panel title="Retención" icon={Repeat}>
        {retention.isLoading && <DashboardEmptyState kind="loading" title="" />}
        {retention.error && <DashboardEmptyState kind="error" title="No se pudo cargar retención" detail={retention.error.message} />}
        {retention.data && retention.data.activeStudents === 0 && <DashboardEmptyState kind="zero-real" title="Sin Students activos en este rango" />}
        {retention.data && retention.data.activeStudents > 0 && (
          <div className="space-y-1">
            <StatRow label="Students activos" value={fmtNum(retention.data.activeStudents)} />
            <StatRow label="Primera vez" value={fmtNum(retention.data.firstTimeInPeriod)} />
            <StatRow label="Recurrentes" value={fmtNum(retention.data.returningInPeriod)} sub={fmtPct(retention.data.returningRatePct)} />
            {retention.data.avgActiveDaysPerStudent != null && (
              <StatRow label="Días activos por Student (media)" value={retention.data.avgActiveDaysPerStudent} />
            )}
            <StatRow label="Multi-venue en el periodo" value={fmtNum(retention.data.multiVenueStudents)} />
          </div>
        )}
      </Panel>

      <Panel title="Actividad por hora / día" icon={BarChart3}>
        {heatmap.isLoading && <DashboardEmptyState kind="loading" title="" />}
        {heatmap.error && <DashboardEmptyState kind="error" title="No se pudo cargar la actividad" detail={heatmap.error.message} />}
        {heatmap.data && heatmap.data.attendance.sampleSize === 0 && <DashboardEmptyState kind="zero-real" title="Sin asistencias en este rango" />}
        {heatmap.data && heatmap.data.attendance.sampleSize > 0 && (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Por hora (Madrid)</p>
              <HourBars data={heatmap.data.attendance.byHour} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Por día de semana</p>
              <WeekdayBars data={heatmap.data.attendance.byWeekday} />
            </div>
            <p className="text-[9px] text-muted-foreground/50 italic">Basado en {fmtNum(heatmap.data.attendance.sampleSize)} asistencias{heatmap.data.attendance.truncated ? " (muestra acotada)" : ""}.</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
