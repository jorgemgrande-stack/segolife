import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, ArrowLeft, Sparkles, Ticket, Users, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * VenueAppEvents.tsx — "EVENTS" (spec §13/§14/§15). Vista OPERATIVA de los
 * eventos de este venue (en curso/próximos/recién terminados) — nunca el
 * catálogo global de gestión de events.ts. El detalle en vivo es honesto
 * sobre lo que SÍ es real: check-ins nativos vs sincronizados de
 * Fourvenues, nunca una etiqueta "en vivo" para datos que llegan por
 * sincronización periódica (spec §15).
 */

function formatDateTime(d: string | Date) {
  return new Date(d).toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function VenueAppEvents({ venueId }: { venueId: number }) {
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const eventsQ = trpc.events.myVenueEvents.useQuery({ venueId }, { refetchInterval: 60_000 });

  if (selectedEventId != null) {
    return <EventLiveView eventId={selectedEventId} onBack={() => setSelectedEventId(null)} />;
  }

  if (eventsQ.isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }
  if (eventsQ.error || !eventsQ.data) {
    return <p className="text-center text-sm text-destructive py-16">No se pudieron cargar los eventos.</p>;
  }

  const { current, upcoming, recentlyCompleted } = eventsQ.data;
  const groups = [
    { label: "En curso", items: current, accent: true },
    { label: "Próximos", items: upcoming, accent: false },
    { label: "Recién terminados", items: recentlyCompleted, accent: false },
  ].filter(g => g.items.length > 0);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-5">
      {groups.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-16">No hay eventos programados en este venue.</p>
      ) : (
        groups.map(g => (
          <div key={g.label} className="space-y-2">
            <p className="text-sm font-semibold text-muted-foreground">{g.label}</p>
            <div className="space-y-2">
              {g.items.map(ev => (
                <button
                  key={ev.id}
                  onClick={() => setSelectedEventId(ev.id)}
                  className="w-full text-left rounded-xl border border-border bg-card p-3.5 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {g.accent && <Sparkles className="size-4 text-emerald-600 shrink-0" />}
                    <p className="font-medium text-foreground truncate">{ev.name}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(ev.startsAt)}</p>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function EventLiveView({ eventId, onBack }: { eventId: number; onBack: () => void }) {
  const statsQ = trpc.events.myVenueEventLiveStats.useQuery({ eventId }, { refetchInterval: 20_000 });

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> Volver a eventos
      </button>

      {statsQ.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : !statsQ.data ? (
        <p className="text-center text-sm text-destructive py-16">No se pudo cargar el evento.</p>
      ) : (
        <>
          <div>
            <h2 className="text-xl font-bold text-foreground">{statsQ.data.event.name}</h2>
            <p className="text-sm text-muted-foreground">{formatDateTime(statsQ.data.event.startsAt)}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-2xl font-bold text-foreground tabular-nums">{statsQ.data.checkInsTotal}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="size-3" /> Check-ins totales</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-2xl font-bold text-foreground tabular-nums">{statsQ.data.ticketsIssued}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Ticket className="size-3" /> Entradas emitidas</p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">SEGOLIFE nativo</span>
              <span className="font-medium text-foreground tabular-nums">{statsQ.data.checkInsNative}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1"><RefreshCcw className="size-3" /> Sincronizado (Fourvenues)</span>
              <span className="font-medium text-foreground tabular-nums">{statsQ.data.checkInsExternal}</span>
            </div>
            <p className="text-xs text-muted-foreground pt-1 border-t border-border">
              Los datos externos llegan por sincronización periódica, no en tiempo real.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
