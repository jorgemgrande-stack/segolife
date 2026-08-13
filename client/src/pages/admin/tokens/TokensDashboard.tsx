import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { KpiCard } from "@/components/KpiCard";
import { Badge } from "@/components/ui/badge";
import { Coins, TrendingUp, TrendingDown, Wallet, Sparkles, Megaphone, Loader2, ArrowRight, ShieldCheck, Lock } from "lucide-react";

function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Loyalty Production Hardening (spec §19) — diagnóstico mínimo, SOLO
 * LECTURA. Deliberadamente NO incluye ningún control para activar loyalty
 * — el flip real de `loyalty_enabled` sigue siendo una acción manual fuera
 * de esta pantalla (edición directa de la integración), nunca un botón aquí.
 */
function ActivationReadinessCard() {
  const { data, isLoading } = trpc.tokens.activationReadiness.useQuery();
  if (isLoading || !data) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-violet-500" />
        <h3 className="text-sm font-semibold text-foreground">Activation Readiness</h3>
        <Badge variant="outline" className="ml-auto gap-1"><Lock className="w-3 h-3" /> LIVE MODE LOCKED</Badge>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Corte global</p>
          <p className="text-foreground font-medium">{data.globalCutoffConfigured ? "Configurado" : "Not configured"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Topes</p>
          <p className="text-foreground font-medium">Día · Semana · Mes · Lifetime</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Presupuesto de campaña</p>
          <p className="text-foreground font-medium">Soportado</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Reglas / Campañas activas</p>
          <p className="text-foreground font-medium">{data.activeRewardRulesCount} / {data.activeCampaignsCount}</p>
        </div>
      </div>
      <div className="pt-2 border-t border-border">
        <p className="text-xs text-muted-foreground mb-2">Venues (sync vs loyalty)</p>
        <div className="flex flex-wrap gap-2">
          {data.venues.map(v => (
            <div key={v.venueId} className="flex items-center gap-1.5 text-xs bg-muted/40 rounded-md px-2 py-1">
              <span className="text-foreground">{v.venueName}</span>
              <Badge variant={v.syncEnabled ? "default" : "outline"} className="text-[10px] px-1.5 py-0">sync {v.syncEnabled ? "ON" : "OFF"}</Badge>
              <Badge variant={v.loyaltyEnabled ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">loyalty {v.loyaltyEnabled ? "ON" : "OFF"}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function TokensDashboard() {
  const { data, isLoading, error } = trpc.tokens.dashboardSummary.useQuery();

  return (
    <AdminLayout title="SegoTokens">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Coins className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">SegoTokens</h2>
            <p className="text-sm text-muted-foreground">Motor de puntos SegoLife — wallets, reglas, campañas y horarios.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <div className="py-16 text-center text-sm text-destructive">{error.message}</div>
        ) : !data ? null : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Tokens emitidos" value={data.totalIssued} icon={TrendingUp} color="emerald" subLabel="Total histórico" />
              <KpiCard label="Tokens gastados" value={data.totalSpent} icon={TrendingDown} color="orange" subLabel="Total histórico" />
              <KpiCard label="Saldo total existente" value={data.totalBalance} icon={Wallet} color="blue" subLabel="Suma de todos los wallets" />
              <KpiCard label="Reglas activas" value={data.activeRulesCount} icon={Sparkles} color="violet" subLabel={`${data.totalRulesCount} en total`} href="/admin/tokens/rules" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Link href="/admin/tokens/rules" className="block bg-card border border-border rounded-lg p-5 hover:border-primary/40 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-5 h-5 text-violet-500" />
                    <div>
                      <p className="font-medium text-foreground">Reglas</p>
                      <p className="text-sm text-muted-foreground">{data.activeRulesCount} activas de {data.totalRulesCount}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </Link>
              <Link href="/admin/tokens/campaigns" className="block bg-card border border-border rounded-lg p-5 hover:border-primary/40 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Megaphone className="w-5 h-5 text-amber-500" />
                    <div>
                      <p className="font-medium text-foreground">Campañas</p>
                      <p className="text-sm text-muted-foreground">{data.activeCampaignsCount} activas de {data.totalCampaignsCount}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </Link>
            </div>

            <ActivationReadinessCard />

            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground">Movimientos recientes</h3>
              </div>
              {data.recentMovements.length === 0 ? (
                <p className="text-sm text-muted-foreground p-6 text-center">Sin movimientos todavía.</p>
              ) : (
                <div className="divide-y divide-border">
                  {data.recentMovements.map(m => (
                    <div key={m.id} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div>
                        <p className="text-foreground font-medium">{m.userName ?? `Usuario #${m.userId}`}</p>
                        <p className="text-xs text-muted-foreground">{m.reason} · {fmtDateTime(m.createdAt)}</p>
                      </div>
                      <Badge variant={m.direction === "credit" ? "default" : "outline"}>
                        {m.direction === "credit" ? "+" : "-"}{m.amount}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
