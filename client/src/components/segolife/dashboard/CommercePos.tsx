/**
 * CommercePos.tsx — SEGOLIFE ADMIN COMMAND CENTER (Fase 14). Superficie
 * visual de `dashboard.getPosProducts`/`getPaymentMix` — datos y backend ya
 * existentes desde la Fase 12 (spec §15/§16/§69), pendientes de panel hasta
 * ahora. SegoTokens NUNCA se suma al bruto de ventas (spec §16/§52) — se
 * muestra siempre como una línea aparte, "valor promocional".
 */
import { ShoppingCart } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, DashboardEmptyState, StatRow, fmtEUR, fmtNum } from "./shared";
import type { DashboardQueryInput } from "./useDashboardFilters";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo", card: "Tarjeta", mixed_cash: "Mixto (efectivo)", mixed_card: "Mixto (tarjeta)",
  segotokens: "SegoTokens", mixed: "Mixto", desconocido: "Desconocido",
};

export function CommercePos({ filters }: { filters: DashboardQueryInput }) {
  const products = trpc.dashboard.getPosProducts.useQuery(filters);
  const paymentMix = trpc.dashboard.getPaymentMix.useQuery(filters);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Panel title="POS · Productos más vendidos" icon={ShoppingCart}>
        {products.isLoading && <DashboardEmptyState kind="loading" title="" />}
        {products.error && <DashboardEmptyState kind="error" title="No se pudo cargar POS" detail={products.error.message} />}
        {products.data && products.data.length === 0 && <DashboardEmptyState kind="zero-real" title="Sin ventas de POS en este rango" />}
        {products.data && products.data.length > 0 && (
          <div className="space-y-1">
            {products.data.slice(0, 8).map(p => (
              <StatRow key={p.venueProductId} label={`${p.productName} · ${p.venueName}`} value={fmtNum(p.unitsSold)} sub={fmtEUR(p.grossSalesCents)} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Mezcla de método de pago" icon={ShoppingCart}>
        {paymentMix.isLoading && <DashboardEmptyState kind="loading" title="" />}
        {paymentMix.error && <DashboardEmptyState kind="error" title="No se pudo cargar la mezcla de pago" detail={paymentMix.error.message} />}
        {paymentMix.data && paymentMix.data.rows.length === 0 && <DashboardEmptyState kind="zero-real" title="Sin transacciones en este rango" />}
        {paymentMix.data && paymentMix.data.rows.length > 0 && (
          <div className="space-y-1">
            {paymentMix.data.rows.map(r => (
              <StatRow key={r.paymentMethod} label={PAYMENT_METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod} value={fmtEUR(r.grossSalesCents)} sub={`${fmtNum(r.transactionCount)} trans.`} />
            ))}
            {paymentMix.data.segoTokensPromotionalValueCents > 0 && (
              <div className="pt-2 mt-2 border-t border-border/20">
                <StatRow label="Valor promocional en SegoTokens (no es ingreso)" value={fmtEUR(paymentMix.data.segoTokensPromotionalValueCents)} />
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
