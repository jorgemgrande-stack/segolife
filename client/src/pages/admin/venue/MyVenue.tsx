import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { SegolifeImage } from "@/components/segolife/SegolifeImage";
import { Loader2, Store, AlertCircle } from "lucide-react";

/**
 * SEGOLIFE — RBAC CONSOLIDATION (spec §18/§19): destino mínimo para un
 * Administrador de Local. Deliberadamente NO es un dashboard grande — spec
 * §18: "no hace falta construir todavía gran dashboard", esa es la
 * siguiente fase (Venue & Partner App). Aquí solo se demuestra el scoping
 * real: exactamente sus venues asignados (venues.myAssignedVenues, que a su
 * vez usa venue_staff, nunca "todos" por defecto), nada de datos globales.
 */
export default function MyVenue() {
  const { data: venues, isLoading } = trpc.venues.myAssignedVenues.useQuery();

  return (
    <AdminLayout title="Mi local">
      <div className="max-w-2xl space-y-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Mi local</h1>
          <p className="text-sm text-muted-foreground">
            Como Administrador de Local, tu acceso está limitado a los venues que tienes asignados.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin" /> Cargando…
          </div>
        ) : !venues || venues.length === 0 ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <span>Todavía no tienes ningún venue asignado. Pide a un Administrador General que te asigne uno desde Gestión de Usuarios.</span>
          </div>
        ) : (
          <div className="space-y-3">
            {venues.map(v => (
              <div key={v.venue.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <div className="size-14 shrink-0 overflow-hidden rounded-lg">
                  <SegolifeImage src={v.venue.imageUrl} alt={v.venue.name} ratio={1} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">{v.venue.name}</p>
                  {v.venue.city && <p className="text-xs text-muted-foreground">{v.venue.city}</p>}
                </div>
                <Store className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground pt-2 border-t border-border">
          La validación de Benefits, consumo y comercio de tu venue se habilitará en la siguiente fase (Venue &amp; Partner App).
        </p>
      </div>
    </AdminLayout>
  );
}
