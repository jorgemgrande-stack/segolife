/**
 * LoyaltyAndBenefits.tsx — spec §19 (SegoTokens Economy, READ-ONLY, badge
 * LIVE ON/OFF dinámico desde `loyalty.data.liveStatus`, nunca "tokens
 * expirando") + §20 (Benefits Performance, expiración perezosa,
 * expiringWithin48h, ranking de más canjeados) + Fase 14 (spec §13/§16:
 * ST por origen y flujo cruzado de Benefits — datos ya existentes desde la
 * Fase 12, pendientes de superficie visual hasta ahora).
 */
import { Link } from "wouter";
import { Coins, Gift } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, StatRow, Badge, fmtPct } from "./shared";
import type { DashboardQueryInput } from "./useDashboardFilters";

export function LoyaltyAndBenefits({ filters }: { filters: DashboardQueryInput }) {
  const loyalty = trpc.dashboard.getLoyalty.useQuery(filters);
  const benefits = trpc.dashboard.getBenefits.useQuery(filters);
  const crossVenueFlow = trpc.dashboard.getCrossVenueBenefitFlow.useQuery(filters);
  const shadowStatus = trpc.loyaltyShadow.getStatus.useQuery();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Panel title="SegoTokens Economy" icon={Coins} action={<Link href="/admin/tokens" className="text-[10px] font-semibold text-violet-500 hover:underline">Ver tokens →</Link>}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Badge tone={loyalty.data?.liveStatus === "LIVE_ACTIVE" ? "good" : "locked"}>
            {loyalty.data?.liveStatus === "LIVE_ACTIVE" ? "LIVE ON" : "LIVE OFF · simulación"}
          </Badge>
          <Badge tone={shadowStatus.data?.enabled ? "good" : "locked"}>SHADOW {shadowStatus.data?.enabled ? "ACTIVE" : "OFF"}</Badge>
        </div>
        {loyalty.isLoading && <DashboardEmptyState kind="loading" title="" />}
        {loyalty.error && <DashboardEmptyState kind="error" title="No se pudo cargar SegoTokens" detail={loyalty.error.message} />}
        {loyalty.data && (
          <div className="space-y-1">
            <StatRow label="Ganados en el periodo" value={loyalty.data.earnedInPeriod} />
            <StatRow label="Gastados en el periodo" value={loyalty.data.spentInPeriod} />
            <StatRow label="Balance circulante" value={loyalty.data.circulatingBalance} />
            <StatRow label="Wallets activas" value={loyalty.data.activeWallets} sub={loyalty.data.avgBalance != null ? `media ${loyalty.data.avgBalance}` : undefined} />
            {loyalty.data.topEarningRules.length > 0 && (
              <div className="pt-2 mt-2 border-t border-border/20">
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Reglas que más generan</p>
                {loyalty.data.topEarningRules.slice(0, 3).map(r => (
                  <StatRow key={r.ruleId ?? r.ruleName} label={r.ruleName} value={r.totalEarned} />
                ))}
              </div>
            )}
            {loyalty.data.tokensByOrigin.length > 0 && (
              <div className="pt-2 mt-2 border-t border-border/20">
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">ST por origen</p>
                {loyalty.data.tokensByOrigin.map(o => (
                  <StatRow key={o.origin} label={o.origin} value={o.earned} sub={o.spent > 0 ? `−${o.spent} gastado` : undefined} />
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Benefits Performance" icon={Gift} action={<Link href="/admin/benefits" className="text-[10px] font-semibold text-violet-500 hover:underline">Ver Benefits →</Link>}>
        {benefits.isLoading && <DashboardEmptyState kind="loading" title="" />}
        {benefits.error && <DashboardEmptyState kind="error" title="No se pudo cargar Benefits" detail={benefits.error.message} />}
        {benefits.data && benefits.data.generated === 0 && <DashboardEmptyState kind="zero-real" title="Sin Benefits generados en este rango" />}
        {benefits.data && benefits.data.generated > 0 && (
          <div className="space-y-1">
            <StatRow label="Generados" value={benefits.data.generated} />
            <StatRow label="Disponibles" value={benefits.data.available} />
            <StatRow label="Canjeados" value={benefits.data.redeemed} sub={fmtPct(benefits.data.redemptionRatePct)} />
            <StatRow label="Caducados" value={benefits.data.expired} />
            {benefits.data.expiringWithin48h > 0 && (
              <div className="mt-1"><Badge tone="warn">{benefits.data.expiringWithin48h} caducan en &lt;48h</Badge></div>
            )}
            {benefits.data.mostRedeemed.length > 0 && (
              <div className="pt-2 mt-2 border-t border-border/20">
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Más canjeados</p>
                {benefits.data.mostRedeemed.slice(0, 3).map(b => (
                  <StatRow key={b.benefitDefinitionId} label={b.benefitName} value={b.redeemedCount} />
                ))}
              </div>
            )}
            {/* Fase 14 (spec §20) — "¿SEGOLIFE mueve Students entre negocios?" */}
            {crossVenueFlow.data && crossVenueFlow.data.length > 0 && (
              <div className="pt-2 mt-2 border-t border-border/20">
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Flujo cruzado entre venues</p>
                {crossVenueFlow.data.slice(0, 3).map((f, i) => (
                  <StatRow
                    key={i}
                    label={`${f.sourceVenueName} → ${f.destinationVenueName}`}
                    value={f.granted}
                    sub={f.redemptionRatePct != null ? `${fmtPct(f.redemptionRatePct)} canjeado` : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
