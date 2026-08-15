import { trpc } from "@/lib/trpc";
import { Loader2, QrCode, Users, UserCheck, Sparkles, Ticket, MapPin, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * VenueAppToday.tsx — "TODAY" (spec §4/§5): lo que necesita saber quien
 * lleva el venue esta noche, ahora mismo. Datos reales únicamente — si un
 * motor no tiene nada que mostrar, el campo se omite, nunca se rellena con
 * un placeholder (spec §41). No es el dashboard BI final (Fase 12).
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
  return new Date(d).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export default function VenueAppToday({ venueId, onScan, onSeeAllActivity }: { venueId: number; onScan: () => void; onSeeAllActivity: () => void }) {
  const todayQ = trpc.venueApp.today.useQuery({ venueId }, { refetchInterval: 30_000 });

  if (todayQ.isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }
  if (todayQ.error || !todayQ.data) {
    return <p className="text-center text-sm text-destructive py-16">No se pudo cargar el resumen de hoy.</p>;
  }

  const { currentEvent, nextEvent, checkInsToday, uniqueStudentsToday, recentActivity } = todayQ.data;

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      <Button className="w-full h-16 text-base" onClick={onScan}>
        <QrCode className="size-6 mr-2" /> Escanear
      </Button>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-2xl font-bold text-foreground tabular-nums">{checkInsToday}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1"><UserCheck className="size-3" /> Check-ins hoy</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-2xl font-bold text-foreground tabular-nums">{uniqueStudentsToday}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="size-3" /> Students únicos</p>
        </div>
      </div>

      {(currentEvent || nextEvent) && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          {currentEvent ? (
            <>
              <p className="text-xs font-semibold text-emerald-600 flex items-center gap-1"><Sparkles className="size-3" /> EN CURSO</p>
              <p className="font-semibold text-foreground">{currentEvent.name}</p>
            </>
          ) : nextEvent ? (
            <>
              <p className="text-xs font-semibold text-muted-foreground">PRÓXIMO EVENTO</p>
              <p className="font-semibold text-foreground">{nextEvent.name}</p>
              <p className="text-sm text-muted-foreground">{new Date(nextEvent.startsAt).toLocaleString("es-ES")}</p>
            </>
          ) : null}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Actividad reciente</p>
          <button onClick={onSeeAllActivity} className="text-xs text-primary font-medium">Ver todo</button>
        </div>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Sin actividad todavía.</p>
        ) : (
          <div className="space-y-1.5">
            {recentActivity.slice(0, 6).map((item, i) => {
              const Icon = ACTIVITY_ICON[item.type] ?? UserCheck;
              return (
                <div key={i} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2">
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
            })}
          </div>
        )}
      </div>
    </div>
  );
}
