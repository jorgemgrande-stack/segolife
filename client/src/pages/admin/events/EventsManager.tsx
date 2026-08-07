import { useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search, CalendarDays, Loader2, Plus, Star } from "lucide-react";
import { useAdminCommunity } from "@/contexts/AdminCommunityContext";
import { ADMIN_COMMUNITY_FILTER_ALL } from "@shared/segolife/adminCommunityFilter";

const ALL = "__all__";
const NONE = "__none__";

function toSlug(name: string): string {
  return name.toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface EventForm {
  name: string;
  slug: string;
  venueId: string;
  startsAt: string;
}

const emptyForm: EventForm = { name: "", slug: "", venueId: NONE, startsAt: "" };

export default function EventsManager() {
  const { filter: communityFilter, communities } = useAdminCommunity();

  const [search, setSearch] = useState("");
  const [venueId, setVenueId] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [featured, setFeatured] = useState<string>(ALL);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EventForm>(emptyForm);

  const utils = trpc.useUtils();

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

  const createMut = trpc.events.create.useMutation({
    onSuccess: () => {
      utils.events.list.invalidate();
      toast.success("Evento creado");
      setOpen(false);
      setForm(emptyForm);
    },
    onError: e => toast.error(e.message),
  });

  const setFeaturedMut = trpc.events.setFeatured.useMutation({
    onSuccess: () => { utils.events.list.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const handleCreate = () => {
    if (!form.name.trim() || !form.slug.trim() || !form.startsAt) { toast.error("Nombre, slug y fecha de inicio son obligatorios"); return; }
    createMut.mutate({
      name: form.name.trim(),
      slug: form.slug.trim(),
      venueId: form.venueId !== NONE ? Number(form.venueId) : undefined,
      startsAt: new Date(form.startsAt),
      communityIds: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? [] : [communityFilter],
    });
  };

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
          <Button onClick={() => { setForm(emptyForm); setOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" /> Nuevo evento
          </Button>
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
        </div>

        {/* ── Tabla ── */}
        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-destructive">{error.message}</div>
          ) : !data || data.items.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Sin eventos que coincidan con los filtros.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Evento</TableHead>
                  <TableHead>Venue</TableHead>
                  <TableHead>Comunidad</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Destacado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map(e => (
                  <TableRow key={e.id} className="cursor-pointer hover:bg-accent/50">
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
                    <TableCell>
                      <Badge variant={e.status === "active" ? "default" : "outline"}>
                        {e.status === "active" ? "Activo" : "Inactivo"}
                      </Badge>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo evento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nombre *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: toSlug(e.target.value) }))}
                placeholder="Ej: Fiesta de bienvenida"
              />
            </div>
            <div>
              <Label>Slug *</Label>
              <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: toSlug(e.target.value) }))} placeholder="fiesta-de-bienvenida" />
            </div>
            <div>
              <Label>Venue</Label>
              <Select value={form.venueId} onValueChange={v => setForm(f => ({ ...f, venueId: v }))}>
                <SelectTrigger><SelectValue placeholder="Sin venue fijo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin venue fijo</SelectItem>
                  {(venuesData ?? []).map(v => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fecha y hora de inicio *</Label>
              <Input type="datetime-local" value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} />
            </div>
            <p className="text-xs text-muted-foreground">
              El resto de los datos (descripción, fin, aforo, comunidades) se completan desde la ficha del evento tras crearlo.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={createMut.isPending}>Crear evento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
