/**
 * FourvenuesHealth.tsx — spec §13: reutiliza el motor de integraciones ya
 * existente (solo lectura, nunca dispara sync ni hace polling desde aquí).
 */
import { Link } from "wouter";
import { Plug } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, Badge, fmtDateTime } from "./shared";

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  connected: "good", configured: "warn", error: "bad", disabled: "neutral", not_configured: "neutral",
};

export function FourvenuesHealth() {
  const { data, isLoading, error } = trpc.dashboard.getFourvenuesHealth.useQuery({});

  return (
    <Panel title="Fourvenues Health" icon={Plug} action={<Link href="/admin/integrations" className="text-[10px] font-semibold text-violet-500 hover:underline">Ver integraciones →</Link>}>
      {isLoading && <DashboardEmptyState kind="loading" title="" />}
      {error && <DashboardEmptyState kind="error" title="No se pudo cargar Fourvenues Health" detail={error.message} />}
      {data && data.integrations.length === 0 && <DashboardEmptyState kind="no-data" title="Sin integraciones configuradas" />}

      {data && data.integrations.length > 0 && (
        <div className="space-y-2">
          {data.overallStatus === "all_healthy" && (
            <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 mb-1">
              {data.integrations.length}/{data.integrations.length} CONNECTED — sin incidencias
            </p>
          )}
          {data.integrations.map(integ => (
            <Link key={integ.integrationId} href="/admin/integrations" className="flex items-center justify-between gap-2 text-xs py-1 border-b border-border/20 last:border-0 hover:bg-muted/30 -mx-1 px-1 rounded transition-colors">
              <span className="font-semibold truncate">{integ.venueName ?? `Venue #${integ.venueId}`}</span>
              <div className="flex items-center gap-2 shrink-0">
                {integ.scheduler?.lastSuccessAt && (
                  <span className="text-[10px] text-muted-foreground">último sync: {fmtDateTime(integ.scheduler.lastSuccessAt as unknown as string)}</span>
                )}
                <Badge tone={STATUS_TONE[integ.status] ?? "neutral"}>{integ.status}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}
