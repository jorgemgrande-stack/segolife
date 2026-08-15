import { trpc } from "@/lib/trpc";
import { Loader2, UserCheck, Ticket, MapPin, Gift } from "lucide-react";

/**
 * VenueAppActivity.tsx — "ACTIVITY" (spec §5): el feed completo, reutiliza
 * la MISMA query que Today (venueApp.today, cacheada por TanStack Query) —
 * un único agregador server-side, nunca una segunda fuente de verdad para
 * "qué ha pasado".
 */

const ACTIVITY_LABEL: Record<string, string> = {
  event_checkin: "Check-in a evento",
  venue_visit: "Visita al venue",
  benefit_redeemed: "Beneficio canjeado",
};
const ACTIVITY_ICON: Record<string, typeof UserCheck> = {
  event_checkin: Ticket,
  venue_visit: MapPin,
  benefit_redeemed: Gift,
};

function formatTime(d: string | Date) {
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function VenueAppActivity({ venueId }: { venueId: number }) {
  const todayQ = trpc.venueApp.today.useQuery({ venueId }, { refetchInterval: 30_000 });

  if (todayQ.isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }
  if (todayQ.error || !todayQ.data) {
    return <p className="text-center text-sm text-destructive py-16">No se pudo cargar la actividad.</p>;
  }

  const { recentActivity } = todayQ.data;

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-2">
      <p className="text-sm font-semibold text-foreground pb-1">Actividad reciente</p>
      {recentActivity.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-16">Sin actividad todavía.</p>
      ) : (
        recentActivity.map((item, i) => {
          const Icon = ACTIVITY_ICON[item.type] ?? UserCheck;
          return (
            <div key={i} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
              <Icon className="size-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground truncate">{item.studentName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {ACTIVITY_LABEL[item.type] ?? item.type}
                  {item.eventName ? ` · ${item.eventName}` : ""}
                  {item.benefitName ? ` · ${item.benefitName}` : ""}
                </p>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatTime(item.at)}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
