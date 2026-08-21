import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Loader2, PackageSearch, ArrowLeft, Image as ImageIcon } from "lucide-react";
import LostFoundCaseDetail from "@/components/admin/lostFound/LostFoundCaseDetail";

const STATUS_LABEL: Record<string, string> = { open: "Abierto", found: "Encontrado", closed_not_found: "Cerrado — no encontrado" };

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

/**
 * VenueAppLostFound.tsx — pestaña "Objetos perdidos" de la Venue App (spec
 * §14: venue_admin gestiona SUS propios casos sin necesitar students.manage
 * ni el CRM global). `lostFound.adminList` con este venueId ya se cruza
 * server-side con el alcance real del actor (requireVenueAccess) — pedirlo
 * con este venueId nunca es "confiar en el cliente", es solo el filtro
 * visual, la autorización real es la del servidor. Reutiliza el MISMO
 * componente de ficha que /admin/lost-found/:id (Global Admin).
 */
export default function VenueAppLostFound({ venueId }: { venueId: number }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading } = trpc.lostFound.adminList.useQuery({ venueId, limit: 50 }, { enabled: selectedId === null });
  const items = data?.items ?? [];

  if (selectedId !== null) {
    return (
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
          <ArrowLeft className="size-4 mr-1.5" /> Objetos perdidos
        </Button>
        <LostFoundCaseDetail reportId={selectedId} />
      </div>
    );
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  if (items.length === 0) {
    return (
      <div className="max-w-sm mx-auto px-4 py-16 text-center space-y-2">
        <PackageSearch className="size-8 text-muted-foreground mx-auto" />
        <p className="font-medium text-foreground">Sin objetos perdidos</p>
        <p className="text-sm text-muted-foreground">Cuando un Student informe de un objeto perdido en este venue, aparecerá aquí.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-2">
      <h2 className="text-lg font-semibold text-foreground px-1">Objetos perdidos</h2>
      {items.map(r => (
        <button
          key={r.id}
          onClick={() => setSelectedId(r.id)}
          className="w-full flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-left hover:bg-muted/40 transition-colors"
        >
          <div className="min-w-0 flex items-center gap-2">
            {r.unread && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{r.studentName ?? r.studentEmail ?? `#${r.studentUserId}`}</p>
              <p className="truncate text-xs text-muted-foreground">{r.description}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {r.imageStorageKey && <ImageIcon className="size-3.5" aria-label="Con fotografía" />}
            <span>{fmtDate(r.createdAt)}</span>
            <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">{STATUS_LABEL[r.status] ?? r.status}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
