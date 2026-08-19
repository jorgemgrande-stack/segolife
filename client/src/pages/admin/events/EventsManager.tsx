import { useMemo, useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Search, CalendarDays, Loader2, Plus, Star, ImageIcon } from "lucide-react";
import { useAdminCommunity } from "@/contexts/AdminCommunityContext";
import { ADMIN_COMMUNITY_FILTER_ALL } from "@shared/segolife/adminCommunityFilter";
import { isEventTonight, isEventPast, splitUpcomingPast, sortByStartAscending } from "@shared/segolife/eventTiming";

const ALL = "__all__";

const FOURVENUES_SOURCE_PREFIX = "integration:fourvenues";

/**
 * FIX-04 (spec §36) — el badge "Estado" antes solo reflejaba events.status
 * (active/inactive), así que un evento finalizado hace un año seguía
 * mostrando "Activo" (CASO A, event 119) y un borrador de Fourvenues
 * mostraba "Activo" igual que uno publicado (CASO B). Prioridad: 1) status
 * admin-curado (inactive gana siempre, es una acción explícita del admin),
 * 2) borrador de Fourvenues (afecta si es comprable — más accionable que
 * "finalizado" para un evento que nunca llegó a publicarse), 3) finalizado
 * (temporal), 4) activo. NUNCA mezcla los tres conceptos en un único valor.
 */
function eventStatusBadge(e: { status: string; sourceType?: string | null; sourcePublicationStatus?: string | null; startsAt: Date | string; endsAt?: Date | string | null }) {
  if (e.status !== "active") return { label: "Inactivo", variant: "outline" as const };
  const isFourvenuesSourced = typeof e.sourceType === "string" && e.sourceType.startsWith(FOURVENUES_SOURCE_PREFIX);
  if (isFourvenuesSourced && e.sourcePublicationStatus !== "published") {
    return { label: "Borrador Fourvenues", variant: "secondary" as const };
  }
  if (isEventPast(e)) return { label: "Finalizado", variant: "secondary" as const };
  return { label: "Activo", variant: "default" as const };
}

function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type TimeFilter = "all" | "upcoming" | "tonight" | "past";
type SalesFilter = "all" | "external_redirect" | "native" | "none";

const SALES_MODE_LABEL: Record<string, string> = {
  external_redirect: "Externo (redirect)",
  external_checkout: "Externo (checkout)",
  native: "Nativo",
};

function salesModeBadge(item: { primarySalesChannel: { salesMode: string } | null }) {
  if (!item.primarySalesChannel) return <Badge variant="outline">Sin canal</Badge>;
  return <Badge variant="secondary">{SALES_MODE_LABEL[item.primarySalesChannel.salesMode] ?? item.primarySalesChannel.salesMode}</Badge>;
}

export default function EventsManager() {
  const { filter: communityFilter, communities } = useAdminCommunity();

  const [search, setSearch] = useState("");
  const [venueId, setVenueId] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [featured, setFeatured] = useState<string>(ALL);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [salesFilter, setSalesFilter] = useState<SalesFilter>("all");

  const { data: venuesData } = trpc.venues.publicActive.useQuery({});

  const { data, isLoading, error } = trpc.events.list.useQuery({
    communityId: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? "all" : communityFilter,
    search: search || undefined,
    venueId: venueId !== ALL ? Number(venueId) : undefined,
    status: status !== ALL ? (status as "active" | "inactive") : undefined,
    isFeatured: featured !== ALL ? featured === "true" : undefined,
    limit: 100,
    offset: 0,
  });

  const utils = trpc.useUtils();
  const setFeaturedMut = trpc.events.setFeatured.useMutation({
    onSuccess: () => { utils.events.list.invalidate(); },
    onError: e => toast.error(e.message),
  });

  // Filtro temporal + canal de venta — client-side sobre lo ya traído por el
  // servidor (spec punto 26: mismo helper compartido en toda la app, nunca
  // `new Date()` repetido). No son filtros de servidor nuevos porque no hace
  // falta: 100 eventos por página es un volumen manejable para calcular en
  // el cliente (mismo criterio ya aplicado al filtro temporal existente).
  //
  // FIX-04 (spec §10) — orden por defecto: próximos ASC (el más cercano
  // primero) agrupados ANTES que pasados DESC (el más reciente primero) —
  // antes la tabla venía en orden cronológico plano desde el servidor
  // (ORDER BY starts_at ASC), lo que enterraba los eventos próximos detrás
  // de años de histórico. Reutiliza splitUpcomingPast (shared/segolife/
  // eventTiming.ts, ya usado por VenueDetail.tsx) — ambos subconjuntos ya
  // vienen ordenados correctamente, solo hace falta concatenarlos.
  const timeFiltered = useMemo(() => {
    const items = data?.items ?? [];
    const { upcoming, past } = splitUpcomingPast(items);
    const byTime = timeFilter === "all" ? [...upcoming, ...past]
      : timeFilter === "tonight" ? sortByStartAscending(items.filter(e => isEventTonight(e)))
      : timeFilter === "upcoming" ? upcoming
      : past;
    if (salesFilter === "all") return byTime;
    if (salesFilter === "none") return byTime.filter(e => !e.primarySalesChannel);
    return byTime.filter(e => e.primarySalesChannel?.salesMode === salesFilter);
  }, [data, timeFilter, salesFilter]);

  return (
    <AdminLayout title="Eventos">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarDays className="w-6 h-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Eventos</h2>
              <p className="text-sm text-muted-foreground">
                {communityFilter === ADMIN_COMMUNITY_FILTER_ALL
                  ? "Todas las comunidades"
                  : communities.find(c => c.id === communityFilter)?.name ?? "Comunidad seleccionada"}
                {typeof data?.total === "number" ? ` · ${data.total} evento(s)` : ""}
              </p>
            </div>
          </div>
          <Link href="/admin/events/new">
            <Button><Plus className="w-4 h-4 mr-2" /> Nuevo evento</Button>
          </Link>
        </div>

        {/* ── Filtro temporal ── */}
        <div className="flex gap-2">
          {([
            ["all", "Todos"], ["upcoming", "Próximos"], ["tonight", "Esta noche"], ["past", "Pasados"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTimeFilter(value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                timeFilter === value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Filtros ── */}
        <div className="flex flex-wrap gap-3 items-center bg-card border border-border rounded-lg p-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o descripción…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={venueId} onValueChange={setVenueId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Venue" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los venues</SelectItem>
              {(venuesData ?? []).map(v => (
                <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Cualquier estado</SelectItem>
              <SelectItem value="active">Activo</SelectItem>
              <SelectItem value="inactive">Inactivo</SelectItem>
            </SelectContent>
          </Select>

          <Select value={featured} onValueChange={setFeatured}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Destacado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Destacado (todos)</SelectItem>
              <SelectItem value="true">Destacados</SelectItem>
              <SelectItem value="false">No destacados</SelectItem>
            </SelectContent>
          </Select>

          <Select value={salesFilter} onValueChange={v => setSalesFilter(v as SalesFilter)}>
            <SelectTrigger className="w-[190px]"><SelectValue placeholder="Canal de venta" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Canal de venta (todos)</SelectItem>
              <SelectItem value="external_redirect">Externo (redirect)</SelectItem>
              <SelectItem value="native">Nativo</SelectItem>
              <SelectItem value="none">Sin canal</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* ── Tabla ── */}
        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-destructive">{error.message}</div>
          ) : timeFiltered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Sin eventos que coincidan con los filtros.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead></TableHead>
                  <TableHead>Evento</TableHead>
                  <TableHead>Venue</TableHead>
                  <TableHead>Comunidad</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Canal de venta</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Destacado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timeFiltered.map(e => (
                  <TableRow key={e.id} className="cursor-pointer hover:bg-accent/50">
                    <TableCell>
                      <div className="w-10 h-10 rounded-md overflow-hidden bg-secondary flex items-center justify-center shrink-0">
                        {e.imageUrl ? <img src={e.imageUrl} alt="" className="size-full object-cover" /> : <ImageIcon className="w-4 h-4 text-muted-foreground" />}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link href={`/admin/events/${e.id}`} className="font-medium text-foreground">
                        {e.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">/{e.slug}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.venue?.name ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {e.communities.length === 0
                          ? <span className="text-muted-foreground">—</span>
                          : e.communities.map(c => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDateTime(e.startsAt)}</TableCell>
                    <TableCell>{salesModeBadge(e)}</TableCell>
                    <TableCell>
                      <Badge variant={eventStatusBadge(e).variant}>{eventStatusBadge(e).label}</Badge>
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={ev => { ev.preventDefault(); ev.stopPropagation(); setFeaturedMut.mutate({ id: e.id, featured: !e.isFeatured }); }}
                        className="p-1 rounded hover:bg-accent"
                        title={e.isFeatured ? "Quitar destacado" : "Destacar"}
                      >
                        <Star className={`w-4 h-4 ${e.isFeatured ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
