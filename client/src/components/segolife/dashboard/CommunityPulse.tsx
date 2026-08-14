/**
 * CommunityPulse.tsx — spec §9: DAU/WAU/MAU/nuevos/inactivos/completitud de
 * perfil + serie diaria de 30 días. Sin "Community Pulse Score" (spec: solo
 * si hay una fórmula defendible — no la hay todavía, se documenta como
 * pendiente en vez de inventar un número).
 */
import { HeartPulse } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, StatRow, fmtDateShort, fmtPct } from "./shared";
import type { DashboardQueryInput } from "./useDashboardFilters";

export function CommunityPulse({ filters }: { filters: DashboardQueryInput }) {
  const { data, isLoading, error } = trpc.dashboard.getCommunityPulse.useQuery(filters);

  return (
    <Panel title="Community Pulse" icon={HeartPulse}>
      {isLoading && <DashboardEmptyState kind="loading" title="" />}
      {error && <DashboardEmptyState kind="error" title="No se pudo cargar Community Pulse" detail={error.message} />}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-violet-500/10 py-2">
              <div className="text-lg font-black tabular-nums text-violet-600 dark:text-violet-400">{data.dau}</div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">DAU</div>
            </div>
            <div className="rounded-lg bg-violet-500/10 py-2">
              <div className="text-lg font-black tabular-nums text-violet-600 dark:text-violet-400">{data.wau}</div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">WAU</div>
            </div>
            <div className="rounded-lg bg-violet-500/10 py-2">
              <div className="text-lg font-black tabular-nums text-violet-600 dark:text-violet-400">{data.mau}</div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">MAU</div>
            </div>
          </div>

          {data.dailySeries.length > 1 ? (
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.dailySeries} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-violet-500, #8b5cf6)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--color-violet-500, #8b5cf6)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip labelFormatter={fmtDateShort} formatter={(v: number) => [v, "Activos"]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Area type="monotone" dataKey="activeCount" stroke="#8b5cf6" fill="url(#pulseFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <DashboardEmptyState kind="no-data" title="Todavía no hay suficiente historial para la serie diaria" />
          )}

          <div className="pt-1 border-t border-border/20">
            <StatRow label="Nuevos Students en el periodo" value={data.newStudents} />
            <StatRow label="Inactivos (7 días)" value={data.inactive7d} />
            <StatRow label="Inactivos (30 días)" value={data.inactive30d} />
            <StatRow label="Perfil completado" value={fmtPct(data.profileCompletionPct)} />
          </div>
        </div>
      )}
    </Panel>
  );
}
