import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, AlertCircle, Home, QrCode, CalendarDays, Activity, Store, LogOut, DoorOpen, Wallet, ShoppingCart } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import VenueAppToday from "./VenueAppToday";
import VenueAppScan from "./VenueAppScan";
import VenueAppEvents from "./VenueAppEvents";
import VenueAppActivity from "./VenueAppActivity";
import VenueAppVenue from "./VenueAppVenue";
import VenueAppSales from "./VenueAppSales";
import VenueAppPos from "./VenueAppPos";
import VenueAppFinance from "./VenueAppFinance";

/**
 * VenueApp.tsx — SEGOLIFE VENUE & PARTNER APP (spec §1/§2/§3). Shell
 * operativo para staff real de un venue: móvil primero, sin la navegación
 * pesada de AdminLayout (spec §1: "must NOT expose full Global Admin nav").
 * Deliberadamente FUERA de <AdminLayout> — mismo criterio que
 * StaffEventScan.tsx (pantalla completa, sin sidebar), pero dentro de
 * /admin/mi-local para que un Venue Admin siga aterrizando aquí tras login
 * (único ítem de nav visible para su rol, ver AdminLayout.tsx) y un
 * GLOBAL_ADMIN pueda entrar igual para soporte (spec §25).
 *
 * Selección de venue (spec §2): un único venue autorizado → se entra
 * directo, sin selector. Varios → selector explícito. El último venue
 * elegido se recuerda en localStorage solo por UX — CADA llamada al backend
 * (today/studentCard/myVenueEvents/...) vuelve a autorizar server-side vía
 * requireVenueAccess, nunca confía en este valor.
 */

const LAST_VENUE_KEY = "segolife.venueApp.lastVenueId";

type Tab = "today" | "scan" | "pos" | "sales" | "finance" | "events" | "activity" | "venue";

// SEGOLIFE — VENUE BAR POS & LIVE COMMERCE TERMINAL (Fase 10.7, spec §2):
// TPV (barra/consumiciones, VenueAppPos) y ENTRADAS (venta de puerta,
// VenueAppSales — mismo componente de siempre, solo relabeled) son
// conceptos DELIBERADAMENTE distintos, nunca la misma pestaña.
const TABS: Array<{ key: Tab; label: string; icon: typeof Home }> = [
  { key: "today", label: "Hoy", icon: Home },
  { key: "scan", label: "Escanear", icon: QrCode },
  { key: "pos", label: "TPV", icon: ShoppingCart },
  { key: "sales", label: "Entradas", icon: DoorOpen },
  { key: "finance", label: "Caja", icon: Wallet },
  { key: "events", label: "Eventos", icon: CalendarDays },
  { key: "activity", label: "Actividad", icon: Activity },
  { key: "venue", label: "Venue", icon: Store },
];

export default function VenueApp() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("today");
  const [selectedVenueId, setSelectedVenueId] = useState<number | null>(null);

  const authQ = trpc.venueApp.myAuthorizedVenues.useQuery();
  const allVenuesQ = trpc.venues.publicActive.useQuery({}, { enabled: !!authQ.data?.all });

  const venueOptions = useMemo(() => {
    if (!authQ.data) return [];
    if (authQ.data.all) return (allVenuesQ.data ?? []).map(v => ({ id: v.id, name: v.name }));
    return (allVenuesQ.data ?? [])
      .filter(v => authQ.data!.venueIds.includes(v.id))
      .map(v => ({ id: v.id, name: v.name }));
  }, [authQ.data, allVenuesQ.data]);

  // Auto-selección: un único venue autorizado (no-admin) entra directo sin
  // selector (spec §2). Con acceso global, esperamos a que se cargue el
  // catálogo para poder ofrecer un selector real.
  useEffect(() => {
    if (selectedVenueId != null) return;
    if (!authQ.data) return;
    if (!authQ.data.all && authQ.data.venueIds.length === 1) {
      setSelectedVenueId(authQ.data.venueIds[0]);
      return;
    }
    const remembered = Number(localStorage.getItem(LAST_VENUE_KEY));
    if (remembered && venueOptions.some(v => v.id === remembered)) {
      setSelectedVenueId(remembered);
    }
  }, [authQ.data, venueOptions, selectedVenueId]);

  function selectVenue(id: number) {
    setSelectedVenueId(id);
    localStorage.setItem(LAST_VENUE_KEY, String(id));
  }

  function changeVenue() {
    setSelectedVenueId(null);
    localStorage.removeItem(LAST_VENUE_KEY);
    setTab("today");
  }

  if (authQ.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasNoVenues = authQ.data && !authQ.data.all && authQ.data.venueIds.length === 0;
  if (hasNoVenues) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center gap-3">
        <AlertCircle className="size-8 text-amber-500" />
        <p className="font-semibold text-foreground">Todavía no tienes ningún venue asignado</p>
        <p className="text-sm text-muted-foreground max-w-xs">
          Pide a un Administrador General que te asigne un venue desde Gestión de Usuarios.
        </p>
        <Button variant="outline" onClick={() => void logout()}><LogOut className="size-4 mr-2" /> Cerrar sesión</Button>
      </div>
    );
  }

  if (selectedVenueId == null) {
    return (
      <div className="min-h-screen flex flex-col items-center bg-background px-4 py-10">
        <div className="w-full max-w-sm space-y-4">
          <div className="text-center space-y-1">
            <Store className="size-8 text-primary mx-auto" />
            <h1 className="text-xl font-semibold text-foreground">Elige tu venue</h1>
            <p className="text-sm text-muted-foreground">Vas a operar en nombre de este venue.</p>
          </div>
          {allVenuesQ.isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : venueOptions.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">No hay venues disponibles.</p>
          ) : (
            <div className="space-y-2">
              {venueOptions.map(v => (
                <button
                  key={v.id}
                  onClick={() => selectVenue(v.id)}
                  className="w-full text-left rounded-xl border border-border bg-card p-4 hover:bg-muted/40 transition-colors font-medium text-foreground"
                >
                  {v.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const venueName = venueOptions.find(v => v.id === selectedVenueId)?.name ?? "Venue";
  const canChangeVenue = authQ.data?.all || (authQ.data && authQ.data.venueIds.length > 1);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="shrink-0 border-b border-border bg-card px-4 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-foreground truncate">{venueName}</p>
          <p className="text-xs text-muted-foreground truncate">{user?.name ?? user?.email}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canChangeVenue && (
            <Button variant="ghost" size="sm" onClick={changeVenue}>Cambiar venue</Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => void logout()} aria-label="Cerrar sesión">
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      {/* Desktop/tablet: pestañas arriba, visibles con hover normal.
          Móvil: barra inferior de pulgar, objetivos táctiles grandes (spec §26/27). */}
      <nav className="hidden md:flex shrink-0 border-b border-border bg-card px-4 gap-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto pb-20 md:pb-6">
        {tab === "today" && <VenueAppToday venueId={selectedVenueId} onScan={() => setTab("scan")} onSeeAllActivity={() => setTab("activity")} />}
        {tab === "scan" && <VenueAppScan venueId={selectedVenueId} />}
        {tab === "pos" && <VenueAppPos venueId={selectedVenueId} />}
        {tab === "sales" && <VenueAppSales venueId={selectedVenueId} />}
        {tab === "finance" && <VenueAppFinance venueId={selectedVenueId} />}
        {tab === "events" && <VenueAppEvents venueId={selectedVenueId} />}
        {tab === "activity" && <VenueAppActivity venueId={selectedVenueId} />}
        {tab === "venue" && <VenueAppVenue venueId={selectedVenueId} venueName={venueName} />}
      </main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 border-t border-border bg-card grid grid-cols-8 pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${tab === key ? "text-primary" : "text-muted-foreground"}`}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
