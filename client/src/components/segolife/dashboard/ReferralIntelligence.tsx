/**
 * ReferralIntelligence.tsx — SEGOLIFE ADMIN COMMAND CENTER (Fase 14, spec
 * §17). Hueco real señalado en el informe de la Fase 12: el motor de
 * Referrals ya existe y funciona (server/routers/referrals.ts), pero nunca
 * se resumía en el Command Center. Enlaza al admin real de Referrals para
 * la gestión detallada — este panel es solo inteligencia/resumen.
 */
import { Link } from "wouter";
import { UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, StatRow, fmtPct, fmtNum } from "./shared";
import type { DashboardQueryInput } from "./useDashboardFilters";

export function ReferralIntelligence({ filters }: { filters: DashboardQueryInput }) {
  const referrals = trpc.dashboard.getReferralBi.useQuery(filters);

  return (
    <Panel title="Referrals" icon={UserPlus} action={<Link href="/admin/students/referrals" className="text-[10px] font-semibold text-violet-500 hover:underline">Ver Referral Admin →</Link>}>
      {referrals.isLoading && <DashboardEmptyState kind="loading" title="" />}
      {referrals.error && <DashboardEmptyState kind="error" title="No se pudo cargar Referrals" detail={referrals.error.message} />}
      {referrals.data && referrals.data.registeredInPeriod === 0 && <DashboardEmptyState kind="zero-real" title="Sin referidos registrados en este rango" />}
      {referrals.data && referrals.data.registeredInPeriod > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <StatRow label="Registrados" value={fmtNum(referrals.data.registeredInPeriod)} />
            <StatRow label="Convertidos" value={fmtNum(referrals.data.convertedInPeriod)} sub={fmtPct(referrals.data.conversionRatePct)} />
            <StatRow label="Recompensados" value={fmtNum(referrals.data.rewardedInPeriod)} />
            <StatRow label="ST emitidos" value={fmtNum(referrals.data.tokensIssuedInPeriod)} />
            <StatRow label="Invitadores únicos" value={fmtNum(referrals.data.uniqueInvitersInPeriod)} />
            {referrals.data.pendingReconciliation > 0 && (
              <div className="pt-1">
                <Link href="/admin/students/referrals" className="text-[10px] font-semibold text-amber-500 hover:underline">
                  {referrals.data.pendingReconciliation} pendiente(s) de reconciliar →
                </Link>
              </div>
            )}
          </div>
          {referrals.data.topReferrers.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Top invitadores</p>
              {referrals.data.topReferrers.slice(0, 5).map(r => (
                <StatRow key={r.referrerUserId} label={r.name ?? `Student #${r.referrerUserId}`} value={r.convertedCount} />
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
