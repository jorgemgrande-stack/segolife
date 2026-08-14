/**
 * SegolifeLive.tsx — spec §8: feed de actividad reciente, real, sin PII,
 * paginado server-side.
 */
import { useState } from "react";
import { Radio, ChevronLeft, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, fmtDateTime, Badge } from "./shared";
import type { DashboardQueryInput } from "./useDashboardFilters";

const TYPE_LABEL: Record<string, string> = {
  registration: "Registro", login: "Login", ticket_purchase: "Compra de ticket", attendance: "Asistencia",
  commerce: "Consumo", qr_redemption: "QR canjeado", token_earn: "SegoTokens ganados", token_spend: "SegoTokens gastados",
  benefit_granted: "Benefit generado", benefit_redeemed: "Benefit canjeado", plan_and_play_response: "Respuesta Comunity",
  support: "Apoyo a propuesta", student_proposal: "Propuesta de estudiante", historical_claim: "Identidad histórica vinculada",
};

const PAGE_SIZE = 15;

export function SegolifeLive({ filters }: { filters: DashboardQueryInput }) {
  const [offset, setOffset] = useState(0);
  const { data, isLoading, error } = trpc.dashboard.getActivity.useQuery({ ...filters, limit: PAGE_SIZE, offset });

  return (
    <Panel title="SEGOLIFE LIVE" icon={Radio}>
      {isLoading && <DashboardEmptyState kind="loading" title="" />}
      {error && <DashboardEmptyState kind="error" title="No se pudo cargar la actividad" detail={error.message} />}
      {data && data.length === 0 && offset === 0 && (
        <DashboardEmptyState kind="zero-real" title="Sin actividad registrada en este rango" detail="No hay compras, asistencias, consumos ni interacciones de Comunity todavía." />
      )}
      {data && data.length > 0 && (
        <div className="space-y-1 max-h-[420px] overflow-y-auto">
          {data.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/20 last:border-0 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Badge tone="info">{TYPE_LABEL[item.type] ?? item.type}</Badge>
                <span className="truncate text-foreground/80">{item.studentName ?? "Estudiante"}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                {item.valueLabel && <span className="font-semibold">{item.valueLabel}</span>}
                <span className="tabular-nums">{fmtDateTime(item.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {data && (data.length === PAGE_SIZE || offset > 0) && (
        <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t border-border/20">
          <button onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))} disabled={offset === 0}
            className="p-1 rounded-md hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setOffset(o => o + PAGE_SIZE)} disabled={data.length < PAGE_SIZE}
            className="p-1 rounded-md hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </Panel>
  );
}
