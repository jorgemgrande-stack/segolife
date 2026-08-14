/**
 * VenuePerformance.tsx — spec §14: rollup DINÁMICO por venue (nunca
 * hardcoded), revenue SIEMPRE desglosado Ticket/Commerce/Total.
 */
import { Link } from "wouter";
import { Building2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, Badge, fmtEUR } from "./shared";
import type { DashboardQueryInput } from "./useDashboardFilters";

export function VenuePerformance({ filters }: { filters: DashboardQueryInput }) {
  const { data, isLoading, error } = trpc.dashboard.getVenuePerformance.useQuery(filters);

  return (
    <Panel title="Venue Performance" icon={Building2} action={<Link href="/admin/venues" className="text-[10px] font-semibold text-violet-500 hover:underline">Ver venues →</Link>}>
      {isLoading && <DashboardEmptyState kind="loading" title="" />}
      {error && <DashboardEmptyState kind="error" title="No se pudo cargar Venue Performance" detail={error.message} />}
      {data && data.rows.length === 0 && <DashboardEmptyState kind="no-data" title="No hay venues configurados para este filtro" />}

      {data && data.rows.length > 0 && (
        <div className="space-y-2.5">
          {data.rows.map(row => (
            <div key={row.venueId} className="rounded-lg border border-border/30 p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-sm">{row.venueName}</span>
                <Badge tone={row.trend.direction === "up" ? "good" : row.trend.direction === "down" ? "bad" : "neutral"}>
                  {row.trend.direction === "up" ? "↑" : row.trend.direction === "down" ? "↓" : "→"}
                </Badge>
              </div>
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div>
                  <div className="text-muted-foreground">Students</div>
                  <div className="font-bold tabular-nums text-xs">{row.activeStudents}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Tickets</div>
                  <div className="font-bold tabular-nums text-xs">{row.ticketsSold}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">SegoTokens</div>
                  <div className="font-bold tabular-nums text-xs">{row.segoTokensEarned}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Benefits</div>
                  <div className="font-bold tabular-nums text-xs">{row.benefitsGenerated}</div>
                </div>
              </div>
              <div className="mt-1.5 pt-1.5 border-t border-border/20 flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">Ticket {fmtEUR(row.ticketRevenueCents)} + Commerce {fmtEUR(row.commerceRevenueCents)}</span>
                <span className="font-bold">= {fmtEUR(row.totalEcosystemRevenueCents)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
