/**
 * CommandCenterHeader.tsx — spec §6-7: saludo + frase ejecutiva DETERMINISTA
 * (sin IA, sin texto inventado — construida solo con datos reales de
 * `dashboard.getOverview`) + tira de 6 KPIs con sub-métricas y click-through.
 */
import { Users, UserCheck, Ticket, CalendarCheck, Coins, Gift, Radio } from "lucide-react";
import { KpiCard } from "@/components/KpiCard";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useAdminCommunity, ADMIN_COMMUNITY_FILTER_ALL } from "@/contexts/AdminCommunityContext";
import { DashboardEmptyState } from "./shared";
import type { DashboardQueryInput, TimeRangeKey } from "./useDashboardFilters";

const RANGE_LABEL: Record<TimeRangeKey, string> = {
  today: "hoy", "7d": "en los últimos 7 días", "30d": "en los últimos 30 días", course: "durante el curso actual",
};
const RANGE_LABEL_SHORT: Record<TimeRangeKey, string> = {
  today: "Hoy", "7d": "Últimos 7 días", "30d": "Últimos 30 días", course: "Curso actual",
};

function buildExecutiveSummary(overview: NonNullable<ReturnType<typeof useOverview>["data"]>, range: TimeRangeKey): string {
  const { active, tickets, attendance } = overview;
  if (active.activeInPeriod === 0) {
    return "No hay actividad significativa registrada " + RANGE_LABEL[range] + ".";
  }
  const parts = [`SEGOLIFE está activo. ${active.activeInPeriod} estudiantes han interactuado ${RANGE_LABEL[range]}`];
  if (tickets.paid > 0) parts.push(`, ${tickets.paid} tickets vendidos`);
  if (attendance.confirmed > 0) parts.push(`, ${attendance.confirmed} asistencias confirmadas`);
  return parts.join("") + ".";
}

function useOverview(input: DashboardQueryInput) {
  return trpc.dashboard.getOverview.useQuery(input);
}

export function CommandCenterHeader({ filters }: { filters: DashboardQueryInput }) {
  const { user } = useAuth();
  const { filter: communityFilter, communities } = useAdminCommunity();
  const firstName = user?.name?.split(" ")[0] ?? "Administrador";
  const { data, isLoading, error } = useOverview(filters);
  const range = filters.range ?? "30d";
  const communityLabel = communityFilter === ADMIN_COMMUNITY_FILTER_ALL
    ? "Todas las comunidades"
    : communities.find(c => c.id === communityFilter)?.name ?? "Comunidad seleccionada";

  return (
    <div className="space-y-4">
      <div>
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-violet-500 dark:text-violet-400 mb-1">
          <Radio className="w-3 h-3" /> SEGOLIFE Command Center
        </p>
        <h1 className="text-xl font-black tracking-tight">Buenos días, {firstName}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {isLoading && "Calculando el estado de SEGOLIFE…"}
          {error && "No se pudo calcular el resumen ejecutivo (fallo de red)."}
          {data && buildExecutiveSummary(data, range)}
        </p>
        {/* Feedback de contexto activo (spec §34) — nunca dejar que el admin olvide que está filtrando. */}
        <p className="text-[11px] text-muted-foreground/70 mt-1.5 font-medium">
          {communityLabel} · {RANGE_LABEL_SHORT[range]}
        </p>
      </div>

      {error && <DashboardEmptyState kind="error" title="No se pudieron cargar los KPIs" detail={error.message} />}

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard label="Estudiantes" value={data.students.total} icon={Users} color="violet"
            subLabel={`+${data.students.newInPeriod} nuevos`} href="/admin/students" />
          <KpiCard label="Activos" value={data.active.activeInPeriod} icon={UserCheck} color="emerald"
            subLabel={`DAU ${data.active.dau} · WAU ${data.active.wau} · MAU ${data.active.mau}`} href="/admin/students" />
          <KpiCard label="Tickets" value={data.tickets.paid} icon={Ticket} color="blue"
            subLabel={`${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(data.tickets.ticketRevenueCents / 100)} · SEGOLIFE ${data.tickets.nativePaid} / Fourvenues ${data.tickets.fourvenuesPaid}`}
            href="/admin/events" />
          <KpiCard label="Asistencias" value={data.attendance.confirmed} icon={CalendarCheck} color="amber"
            subLabel={data.attendance.attendanceRatePct != null ? `${data.attendance.attendanceRatePct}% tasa` : "sin tickets elegibles"} href="/admin/events" />
          <KpiCard label="SegoTokens" value={data.segoTokens.earnedInPeriod} icon={Coins} color="orange"
            subLabel={data.segoTokens.liveStatus === "LIVE_ACTIVE" ? "LIVE ON" : "LIVE OFF · simulación"} href="/admin/tokens" />
          <KpiCard label="Benefits" value={data.benefits.generated} icon={Gift} color="rose"
            subLabel={`${data.benefits.redeemed} canjeados`} href="/admin/benefits" />
        </div>
      )}
    </div>
  );
}
