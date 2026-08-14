/**
 * ActionCenterAndHealth.tsx — spec §23 (Action Center, reglas deterministas,
 * nunca IA) + §24 (System Health, estados reales) + §25 (Quick Actions, solo
 * rutas reales, sin enlaces muertos).
 */
import { Link } from "wouter";
import {
  Bell, HeartPulse as HealthIcon, Compass, Users, CalendarDays, Building2, Coins, Gift,
  History, Vote, Plug, Send,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, Badge } from "./shared";
import type { DashboardQueryInput } from "./useDashboardFilters";

const SEVERITY_TONE: Record<string, "bad" | "warn" | "info" | "neutral"> = {
  critical: "bad", warning: "warn", opportunity: "info", info: "neutral",
};
const SEVERITY_LABEL: Record<string, string> = {
  critical: "CRÍTICO", warning: "AVISO", opportunity: "OPORTUNIDAD", info: "INFO",
};
const ENTITY_HREF: Record<string, string> = {
  event: "/admin/events", venue: "/admin/venues", integration: "/admin/integrations",
  benefit: "/admin/benefits", proposal: "/admin/comunity", historical: "/admin/students/historical",
};

const HEALTH_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  ok: "good", degraded: "warn", error: "bad", off: "neutral",
};

const QUICK_ACTIONS = [
  { label: "Students", icon: Users, href: "/admin/students" },
  { label: "Eventos", icon: CalendarDays, href: "/admin/events" },
  { label: "Venues", icon: Building2, href: "/admin/venues" },
  { label: "SegoTokens", icon: Coins, href: "/admin/tokens" },
  { label: "Benefits", icon: Gift, href: "/admin/benefits" },
  { label: "Estudiantes históricos", icon: History, href: "/admin/students/historical" },
  { label: "Plan & Play", icon: Vote, href: "/admin/comunity" },
  { label: "Integraciones", icon: Plug, href: "/admin/integrations" },
  { label: "Engagement", icon: Send, href: "/admin/engagement/campaigns" },
];

export function ActionCenterAndHealth({ filters }: { filters: DashboardQueryInput }) {
  const alerts = trpc.dashboard.getAlerts.useQuery(filters);
  const health = trpc.dashboard.getSystemHealth.useQuery({ communityId: filters.communityId ?? null });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Panel title="Requiere tu atención" icon={Bell} className="lg:col-span-2" badge={alerts.data?.length}>
        {alerts.isLoading && <DashboardEmptyState kind="loading" title="" />}
        {alerts.error && <DashboardEmptyState kind="error" title="No se pudo calcular el Action Center" detail={alerts.error.message} />}
        {alerts.data && alerts.data.length === 0 && <DashboardEmptyState kind="zero-real" title="Todo en orden — sin alertas activas" />}
        {alerts.data && alerts.data.length > 0 && (
          <div className="space-y-2">
            {alerts.data.map((alert, i) => {
              const href = alert.ctaEntity ? ENTITY_HREF[alert.ctaEntity] : undefined;
              const content = (
                <div className="flex items-start gap-2">
                  <Badge tone={SEVERITY_TONE[alert.severity]}>{SEVERITY_LABEL[alert.severity]}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">{alert.title}</p>
                    <p className="text-[10px] text-muted-foreground">{alert.context}</p>
                  </div>
                </div>
              );
              return href ? (
                <Link key={i} href={href} className="block rounded-lg border border-border/30 p-2 hover:border-violet-500/40 transition-colors">{content}</Link>
              ) : (
                <div key={i} className="rounded-lg border border-border/30 p-2">{content}</div>
              );
            })}
          </div>
        )}
      </Panel>

      <div className="space-y-4">
        <Panel title="System Health" icon={HealthIcon}>
          {health.isLoading && <DashboardEmptyState kind="loading" title="" />}
          {health.error && <DashboardEmptyState kind="error" title="Error" detail={health.error.message} />}
          {health.data && (
            <div className="space-y-1">
              {health.data.items.map(item => (
                <div key={item.key} className="flex items-center justify-between text-[11px] py-0.5">
                  <span className="text-foreground/80">{item.label}</span>
                  <Badge tone={HEALTH_TONE[item.status] ?? "neutral"}>{item.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Accesos rápidos" icon={Compass}>
          <div className="grid grid-cols-3 gap-2">
            {QUICK_ACTIONS.map(action => (
              <Link key={action.href} href={action.href} className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-muted/60 transition-colors text-center">
                <action.icon className="w-4 h-4 text-violet-500" />
                <span className="text-[9px] font-semibold leading-tight">{action.label}</span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
