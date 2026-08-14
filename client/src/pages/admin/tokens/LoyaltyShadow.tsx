import { useMemo, useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { KpiCard } from "@/components/KpiCard";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAdminCommunity } from "@/contexts/AdminCommunityContext";
import {
  Ghost, Lock, Loader2, Activity, Users, UserX, CheckCircle2, XCircle,
  Coins, Undo2, AlertTriangle, Ticket, CalendarCheck,
} from "lucide-react";

/**
 * SEGOLIFE LOYALTY SHADOW MODE — /admin/tokens/shadow (spec §18-21/§58).
 * SOLO OBSERVACIÓN: ninguna acción de esta pantalla escribe en token_ledger/
 * token_wallets/user_benefits — todo viene de loyalty_shadow_evaluations,
 * una tabla completamente aislada. Header siempre visible: SHADOW ON/OFF +
 * LIVE LOCKED, para que nunca se confunda observación con activación real.
 */

const PERIOD_OPTIONS = [
  { key: "today", label: "Hoy", days: 1 },
  { key: "7d", label: "7 días", days: 7 },
  { key: "30d", label: "30 días", days: 30 },
] as const;

const TOKEN_VALUE_OPTIONS = [0.01, 0.02, 0.05];

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtEUR(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(cents / 100);
}

const TRIGGER_LABEL: Record<string, string> = {
  EVENT_PURCHASE: "Compra", EVENT_ATTENDANCE: "Asistencia", EVENT_REFUND: "Reembolso",
  EVENT_CANCEL: "Cancelación", PENDING_TO_PAID: "Pendiente→Pagado",
};
const TRIGGER_ICON: Record<string, React.ElementType> = {
  EVENT_PURCHASE: Ticket, EVENT_ATTENDANCE: CalendarCheck, EVENT_REFUND: Undo2, EVENT_CANCEL: XCircle, PENDING_TO_PAID: Coins,
};
const DENIAL_LABEL: Record<string, string> = {
  NO_STUDENT: "Identidad histórica sin Student", CUTOFF_BLOCKED: "Anterior al corte de loyalty",
  OUTSIDE_SCHEDULE: "Fuera de horario", NO_RULE_FOUND: "Sin regla activa",
  RULE_LIMIT_EXCEEDED: "Tope alcanzado", NOTHING_TO_REVERSE: "Nada que revertir",
};

export default function LoyaltyShadow() {
  const { filter: communityFilter, communities } = useAdminCommunity();
  const [period, setPeriod] = useState<(typeof PERIOD_OPTIONS)[number]["key"]>("7d");
  const [venueId, setVenueId] = useState<string>("all");
  const [tokenValue, setTokenValue] = useState(0.02);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const range = useMemo(() => {
    const days = PERIOD_OPTIONS.find(p => p.key === period)!.days;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [period]);

  const filters = {
    communityIds: communityFilter === "all" ? ("all" as const) : [communityFilter],
    venueId: venueId === "all" ? undefined : Number(venueId),
    from: range.from, to: range.to,
  };

  const { data: status } = trpc.loyaltyShadow.getStatus.useQuery();
  const { data: kpis, isLoading: kpisLoading } = trpc.loyaltyShadow.getKpis.useQuery(filters);
  const { data: aggregates } = trpc.loyaltyShadow.getAggregates.useQuery(filters);
  const { data: health } = trpc.loyaltyShadow.getHealth.useQuery();
  const { data: feed, isLoading: feedLoading } = trpc.loyaltyShadow.getFeed.useQuery({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE });

  const venueOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const row of aggregates?.byVenue ?? []) seen.set(row.venueId, row.venueName);
    return Array.from(seen.entries());
  }, [aggregates]);

  return (
    <AdminLayout title="Loyalty Shadow">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Ghost className="w-6 h-6 text-violet-500" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">Loyalty Shadow</h2>
                <Badge variant={status?.enabled ? "default" : "secondary"} className="gap-1">
                  {status?.enabled ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  SHADOW: {status?.enabled ? "ACTIVE" : "OFF"}
                </Badge>
                <Badge variant="outline" className="gap-1"><Lock className="w-3 h-3" /> LIVE: LOCKED</Badge>
              </div>
              <p className="text-sm text-muted-foreground">Qué habría hecho el Reward Engine sobre tráfico real — cero SegoTokens reales, cero escritura en wallets/Benefits.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={period} onValueChange={v => setPeriod(v as typeof period)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{PERIOD_OPTIONS.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={venueId} onValueChange={setVenueId}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Todos los venues" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los venues</SelectItem>
                {venueOptions.map(([id, name]) => <SelectItem key={id} value={String(id)}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!status?.enabled && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Shadow está OFF — no se está observando tráfico. Actívalo en Configuración → Feature flags (<code className="font-mono text-xs">loyalty_shadow_enabled</code>) para empezar a recibir observaciones.
          </div>
        )}

        {kpisLoading || !kpis ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <KpiCard label="Operations Observed" value={kpis.operationsObserved} icon={Activity} color="violet" />
              <KpiCard label="Known Students" value={kpis.knownStudents} icon={Users} color="blue" />
              <KpiCard label="Unresolved Identities" value={kpis.unresolvedIdentities} icon={UserX} color="amber" />
              <KpiCard label="Eligible Rewards" value={kpis.eligibleRewards} icon={CheckCircle2} color="emerald" />
              <KpiCard label="Denied Rewards" value={kpis.deniedRewards} icon={XCircle} color="rose" />
              <KpiCard label="Simulated Tokens" value={kpis.simulatedTokens} icon={Coins} color="violet" />
              <KpiCard label="Simulated Reversals" value={kpis.simulatedReversals} icon={Undo2} color="orange" />
            </div>

            <div className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">Simulación económica</h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  Valor simulado del token:
                  <Select value={String(tokenValue)} onValueChange={v => setTokenValue(Number(v))}>
                    <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{TOKEN_VALUE_OPTIONS.map(v => <SelectItem key={v} value={String(v)}>{v.toFixed(2)} €</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-2xl font-bold tabular-nums text-foreground">{fmtEUR(kpis.simulatedTokens * tokenValue * 100)}</p>
              <p className="text-xs text-muted-foreground mt-1">{kpis.simulatedTokens.toLocaleString("es-ES")} tokens simulados × {tokenValue.toFixed(2)} € — solo analítico, nunca una política oficial guardada.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-lg p-5">
                <h3 className="text-sm font-semibold text-foreground mb-3">Por venue</h3>
                {(aggregates?.byVenue ?? []).length === 0 ? <p className="text-xs text-muted-foreground">Sin datos en este periodo.</p> : (
                  <div className="space-y-1.5">
                    {aggregates!.byVenue.map(v => (
                      <div key={v.venueId} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">{v.venueName}</span>
                        <span className="text-muted-foreground tabular-nums">{v.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-card border border-border rounded-lg p-5">
                <h3 className="text-sm font-semibold text-foreground mb-3">Por trigger</h3>
                {(aggregates?.byTrigger ?? []).length === 0 ? <p className="text-xs text-muted-foreground">Sin datos en este periodo.</p> : (
                  <div className="space-y-1.5">
                    {aggregates!.byTrigger.map(t => (
                      <div key={t.trigger} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">{TRIGGER_LABEL[t.trigger] ?? t.trigger}</span>
                        <span className="text-muted-foreground tabular-nums">{t.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-card border border-border rounded-lg p-5">
                <h3 className="text-sm font-semibold text-foreground mb-3">Top reglas</h3>
                {(aggregates?.byRule ?? []).length === 0 ? <p className="text-xs text-muted-foreground">Sin datos en este periodo.</p> : (
                  <div className="space-y-1.5">
                    {aggregates!.byRule.map(r => (
                      <div key={r.ruleId} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">{r.ruleName}</span>
                        <span className="text-muted-foreground tabular-nums">{r.count} · {r.tokens} tokens</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-card border border-border rounded-lg p-5">
                <h3 className="text-sm font-semibold text-foreground mb-3">Por motivo de denegación</h3>
                {(aggregates?.byDenialReason ?? []).length === 0 ? <p className="text-xs text-muted-foreground">Sin denegaciones en este periodo.</p> : (
                  <div className="space-y-1.5">
                    {aggregates!.byDenialReason.map(d => (
                      <div key={d.reason} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">{DENIAL_LABEL[d.reason] ?? d.reason}</span>
                        <span className="text-muted-foreground tabular-nums">{d.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3">Feed</h3>
              {feedLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : (feed?.items ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">Sin observaciones en este periodo.</p>
              ) : (
                <div className="space-y-1.5">
                  {feed!.items.map(item => {
                    const Icon = TRIGGER_ICON[item.trigger] ?? Activity;
                    return (
                      <div key={item.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground w-28 shrink-0">{fmtDateTime(item.evaluatedAt)}</span>
                          <span className="text-foreground truncate">{item.venueName ?? "—"}{item.eventName ? ` · ${item.eventName}` : ""}</span>
                          {item.userId ? (
                            <Link href={`/admin/students/${item.userId}`} className="text-xs text-violet-500 hover:underline shrink-0">Student #{item.userId}</Link>
                          ) : (
                            <span className="text-xs text-muted-foreground shrink-0">Identidad histórica</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {item.ruleName && <span className="text-xs text-muted-foreground">{item.ruleName}</span>}
                          <Badge variant={item.decision === "GRANTED" ? "default" : item.decision === "SIMULATED_REVERSAL" ? "outline" : "secondary"}>
                            {item.decision === "GRANTED" ? `+${item.finalTokens ?? 0}` : item.decision === "SIMULATED_REVERSAL" ? `−${item.finalTokens ?? 0}` : (DENIAL_LABEL[item.denialReason ?? ""] ?? item.denialReason ?? "DENIED")}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center justify-between pt-3">
                <button className="text-xs text-muted-foreground disabled:opacity-40" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Anterior</button>
                <button className="text-xs text-muted-foreground disabled:opacity-40" disabled={!feed || (page + 1) * PAGE_SIZE >= feed.total} onClick={() => setPage(p => p + 1)}>Siguiente</button>
              </div>
            </div>

            {health && (
              <div className="bg-card border border-border rounded-lg p-5">
                <h3 className="text-sm font-semibold text-foreground mb-3">Salud de la observabilidad</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><p className="text-xs text-muted-foreground">Última evaluación</p><p className="text-foreground font-medium">{health.lastEvaluationAt ? fmtDateTime(health.lastEvaluationAt) : "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Evaluaciones (última hora)</p><p className="text-foreground font-medium tabular-nums">{health.evaluationRateLast1h}</p></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Errores (24h)</p>
                    <p className={health.errorCountLast24h > 0 ? "text-rose-500 font-medium tabular-nums" : "text-foreground font-medium tabular-nums"}>{health.errorCountLast24h}</p>
                  </div>
                  <div><p className="text-xs text-muted-foreground">Estado</p><p className="text-foreground font-medium">{status?.enabled ? "Observando" : "Desactivado"}</p></div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
