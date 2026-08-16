/**
 * ExecutiveBriefPanel.tsx — SEGOLIFE ADMIN COMMAND CENTER (Fase 14, spec
 * §21/§22/§36). "Resumen de hoy" en prosa + Recomendaciones — AMBOS 100%
 * deterministas (sin proveedor de IA conectado en producción, confirmado de
 * nuevo en esta fase). Distinto del resumen de una frase de
 * CommandCenterHeader.tsx (mucho más simple) — este incluye comparación con
 * el periodo anterior, retención, referidos y recomendaciones accionables.
 *
 * Las recomendaciones se etiquetan SIEMPRE como tales (spec §22 "clearly
 * labelled as RECOMMENDATIONS, not facts") — nunca se ejecutan solas, cada
 * una lleva un CTA a un módulo canónico real (spec §23 human approval).
 */
import { Link } from "wouter";
import { Sparkles, Lightbulb } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, Badge } from "./shared";
import type { DashboardQueryInput } from "./useDashboardFilters";

export function ExecutiveBriefPanel({ filters }: { filters: DashboardQueryInput }) {
  const brief = trpc.dashboard.getExecutiveBrief.useQuery(filters);

  return (
    <Panel title="Resumen de hoy" icon={Sparkles} badge={brief.data?.recommendations.length}>
      <div className="mb-2">
        <Badge tone="locked">SIN IA · determinista</Badge>
      </div>
      {brief.isLoading && <DashboardEmptyState kind="loading" title="" />}
      {brief.error && <DashboardEmptyState kind="error" title="No se pudo calcular el resumen" detail={brief.error.message} />}
      {brief.data && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            {brief.data.brief.sentences.map((s, i) => (
              <p key={i} className="text-sm text-foreground/90">{s}</p>
            ))}
          </div>

          {brief.data.recommendations.length > 0 && (
            <div className="pt-3 border-t border-border/20 space-y-2">
              <p className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1"><Lightbulb className="w-3 h-3" /> Recomendaciones</p>
              {brief.data.recommendations.map(rec => (
                <div key={rec.id} className="rounded-lg border border-border/30 p-2.5">
                  <div className="flex items-start gap-2">
                    <Badge tone="info">RECOMENDACIÓN</Badge>
                  </div>
                  <p className="text-xs font-semibold mt-1">{rec.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{rec.why}</p>
                  <Link href={rec.deepLink} className="inline-block mt-1.5 text-[10px] font-semibold text-violet-500 hover:underline">
                    {rec.possibleAction} →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
