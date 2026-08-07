import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { KpiCard } from "@/components/KpiCard";
import { Badge } from "@/components/ui/badge";
import { Coins, TrendingUp, TrendingDown, Wallet, Sparkles, Megaphone, Loader2, ArrowRight } from "lucide-react";

function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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
