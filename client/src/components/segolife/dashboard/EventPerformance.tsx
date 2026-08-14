/**
 * EventPerformance.tsx — spec §11-12: ranking + TOP EVENT/TRENDING/NEEDS
 * ATTENTION. Nunca muestra capacity ni % de ocupación (auditoría previa: no
 * fiable).
 */
import { Link } from "wouter";
import { CalendarDays, TrendingUp, Star, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, Badge, fmtEUR, fmtDateShort } from "./shared";
import type { DashboardQueryInput } from "./useDashboardFilters";

export function EventPerformance({ filters }: { filters: DashboardQueryInput }) {
  const { data, isLoading, error } = trpc.dashboard.getEventPerformance.useQuery(filters);

  return (
    <Panel title="Event Performance" icon={CalendarDays} action={<Link href="/admin/events" className="text-[10px] font-semibold text-violet-500 hover:underline">Ver eventos →</Link>}>
      {isLoading && <DashboardEmptyState kind="loading" title="" />}
      {error && <DashboardEmptyState kind="error" title="No se pudo cargar Event Performance" detail={error.message} />}
      {/*
        NEEDS ATTENTION vive FUERA del bloque `rows.length > 0` a propósito
        (bug real detectado por tests, Production Polish Gate): es una señal
        sobre eventos PRÓXIMOS, independiente del periodo de filtro global —
        puede haber alertas reales incluso sin ninguna venta en el rango
        seleccionado. Antes quedaba oculta detrás del estado vacío.
      */}
      {data && !data.needsAttentionDataSufficient && (
        <p className="text-[10px] text-muted-foreground/60 italic mb-2">NEEDS ATTENTION: datos insuficientes (menos de 2 eventos próximos comparables).</p>
      )}
      {data && data.needsAttention.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 space-y-1 mb-3">
          {data.needsAttention.slice(0, 3).map(item => (
            <Link key={item.eventId} href={`/admin/events/${item.eventId}`} className="flex items-center gap-1.5 text-[11px] hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
              <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
              <span className="font-semibold truncate">{item.eventName}</span>
              <span className="text-muted-foreground shrink-0">
                — {item.reason === "zero_sales_close_to_event"
                  ? `0 tickets vendidos, empieza en ${item.daysUntilEvent}d`
                  : `${item.velocityPerDay}/día, muy por debajo de lo esperado`}
              </span>
            </Link>
          ))}
        </div>
      )}

      {data && data.rows.length === 0 && <DashboardEmptyState kind="zero-real" title="Sin ventas de tickets en este rango" />}

      {data && data.rows.length > 0 && (
        <div className="space-y-3">
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-left font-semibold py-1.5 px-1">Evento</th>
                  <th className="text-right font-semibold py-1.5 px-1">Tickets</th>
                  <th className="text-right font-semibold py-1.5 px-1">Asistencia</th>
                  <th className="text-right font-semibold py-1.5 px-1">Revenue</th>
                  <th className="text-right font-semibold py-1.5 px-1">Tendencia</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(0, 8).map(row => (
                  <tr key={row.eventId} className="border-b border-border/10 last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-1.5 px-1">
                      <Link href={`/admin/events/${row.eventId}`} className="flex items-center gap-1.5 min-w-0 hover:text-violet-500 dark:hover:text-violet-400">
                        {row.eventId === data.topEventId && <Star className="w-3 h-3 text-amber-500 shrink-0" />}
                        {row.eventId === data.trendingEventId && <TrendingUp className="w-3 h-3 text-emerald-500 shrink-0" />}
                        <span className="truncate font-medium">{row.eventName}</span>
                      </Link>
                      <span className="text-[9px] text-muted-foreground">
                        {row.venueId ? <Link href={`/admin/venues/${row.venueId}`} className="hover:text-violet-500 dark:hover:text-violet-400">{row.venueName}</Link> : (row.venueName ?? "—")} · {fmtDateShort(row.startsAt)}
                      </span>
                    </td>
                    <td className="text-right tabular-nums py-1.5 px-1">{row.ticketsSold}</td>
                    <td className="text-right tabular-nums py-1.5 px-1">{row.attendanceRatePct != null ? `${row.attendanceRatePct}%` : "—"}</td>
                    <td className="text-right tabular-nums py-1.5 px-1 font-semibold">{fmtEUR(row.ticketRevenueCents)}</td>
                    <td className="text-right py-1.5 px-1">
                      <Badge tone={row.velocity.trend === "up" ? "good" : row.velocity.trend === "down" ? "bad" : "neutral"}>
                        {row.velocity.trend === "up" ? "↑" : row.velocity.trend === "down" ? "↓" : "→"} {row.velocity.last24h}/24h
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}
