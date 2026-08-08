import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plug, Receipt, AlertCircle } from "lucide-react";

/**
 * VenueCommerceTab — tab "Commerce / Integrations" del admin de venues
 * (Fase 5, spec punto 58): integraciones del proveedor (Fourvenues),
 * transacciones de comercio, no resueltas, estado de sync. Explícitamente
 * SIN contabilidad (eso sigue viviendo en el módulo fiscal legacy, no aquí).
 */
export function VenueCommerceTab({ venueId }: { venueId: number }) {
  const { data: venueIntegrations, isLoading: loadingIntegrations } = trpc.integrations.listVenueIntegrations.useQuery({ venueId });
  const { data: transactions, isLoading: loadingTx } = trpc.commerce.listByVenue.useQuery({ venueId });
  const { data: unresolved } = trpc.integrations.listUnresolved.useQuery({ status: "unresolved" });

  const venueUnresolved = (unresolved ?? []).filter(u => u.venueId === venueId);

  if (loadingIntegrations || loadingTx) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Plug className="w-4 h-4" /> Integraciones (Fourvenues)</h3>
        {!venueIntegrations?.length ? (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-4 text-center">
            Sin integración configurada — dar de alta desde /admin/integrations.
          </p>
        ) : (
          <div className="space-y-1.5">
            {venueIntegrations.map(i => (
              <div key={i.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
                <span>{i.providerKey} · {i.environment}</span>
                <div className="flex items-center gap-2">
                  {!i.credentialsConfigured && <Badge variant="outline">Awaiting credentials</Badge>}
                  <Badge variant={i.status === "connected" ? "default" : i.status === "error" ? "destructive" : "secondary"}>{i.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Receipt className="w-4 h-4" /> Commerce Transactions</h3>
        {!transactions?.length ? (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-4 text-center">Sin transacciones de comercio todavía.</p>
        ) : (
          <div className="space-y-1.5">
            {transactions.slice(0, 20).map(t => (
              <div key={t.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
                <span>{t.provider} · {new Date(t.occurredAt).toLocaleString()}</span>
                <span>{(t.totalCents / 100).toFixed(2)} {t.currency} · <Badge variant="secondary">{t.status}</Badge></span>
              </div>
            ))}
          </div>
        )}
      </section>

      {venueUnresolved.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2 text-amber-600"><AlertCircle className="w-4 h-4" /> Operaciones no resueltas ({venueUnresolved.length})</h3>
          <p className="text-sm text-muted-foreground">Ver y vincular en /admin/integrations/unresolved.</p>
        </section>
      )}
    </div>
  );
}
