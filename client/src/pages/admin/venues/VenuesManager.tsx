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
import { Search, Store, Loader2, Plus, Star } from "lucide-react";
import { useAdminCommunity } from "@/contexts/AdminCommunityContext";
import { ADMIN_COMMUNITY_FILTER_ALL } from "@shared/segolife/adminCommunityFilter";

const ALL = "__all__";

function toSlug(name: string): string {
  return name.toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

interface VenueForm {
  name: string;
  slug: string;
  categoryId: string;
}

const emptyForm: VenueForm = { name: "", slug: "", categoryId: ALL };

export default function VenuesManager() {
  const { filter: communityFilter, communities } = useAdminCommunity();

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [featured, setFeatured] = useState<string>(ALL);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<VenueForm>(emptyForm);

  const utils = trpc.useUtils();

  const { data: categories } = trpc.venues.listCategories.useQuery();

  const { data, isLoading, error } = trpc.venues.list.useQuery({
    communityId: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? "all" : communityFilter,
    search: search || undefined,
    categoryId: categoryId !== ALL ? Number(categoryId) : undefined,
    status: status !== ALL ? (status as "active" | "inactive") : undefined,
    isFeatured: featured !== ALL ? featured === "true" : undefined,
    limit: 100,
    offset: 0,
  });

  const createMut = trpc.venues.create.useMutation({
    onSuccess: () => {
      utils.venues.list.invalidate();
      toast.success("Venue creado");
      setOpen(false);
      setForm(emptyForm);
    },
    onError: e => toast.error(e.message),
  });

  const setFeaturedMut = trpc.venues.setFeatured.useMutation({
    onSuccess: () => { utils.venues.list.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const handleCreate = () => {
    if (!form.name.trim() || !form.slug.trim()) { toast.error("Nombre y slug son obligatorios"); return; }
    createMut.mutate({
      name: form.name.trim(),
      slug: form.slug.trim(),
      categoryId: form.categoryId !== ALL ? Number(form.categoryId) : undefined,
      communityIds: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? [] : [communityFilter],
    });
  };

  return (
    <AdminLayout title="Venues">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Store className="w-6 h-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Venues</h2>
              <p className="text-sm text-muted-foreground">
                {communityFilter === ADMIN_COMMUNITY_FILTER_ALL
                  ? "Todas las comunidades"
                  : communities.find(c => c.id === communityFilter)?.name ?? "Comunidad seleccionada"}
                {typeof data?.total === "number" ? ` · ${data.total} venue(s)` : ""}
              </p>
            </div>
          </div>
          <Button onClick={() => { setForm(emptyForm); setOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" /> Nuevo venue
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

          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Categoría" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las categorías</SelectItem>
              {(categories ?? []).map(c => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
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
            <div className="py-16 text-center text-sm text-muted-foreground">Sin venues que coincidan con los filtros.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Venue</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Comunidad</TableHead>
                  <TableHead>Ciudad</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Destacado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map(v => (
                  <TableRow key={v.id} className="cursor-pointer hover:bg-accent/50">
                    <TableCell>
                      <Link href={`/admin/venues/${v.id}`} className="font-medium text-foreground">
                        {v.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">/{v.slug}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{v.category?.name ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {v.communities.length === 0
                          ? <span className="text-muted-foreground">—</span>
                          : v.communities.map(c => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{v.city}</TableCell>
                    <TableCell>
                      <Badge variant={v.status === "active" ? "default" : "outline"}>
                        {v.status === "active" ? "Activo" : "Inactivo"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={ev => { ev.preventDefault(); ev.stopPropagation(); setFeaturedMut.mutate({ id: v.id, featured: !v.isFeatured }); }}
                        className="p-1 rounded hover:bg-accent"
                        title={v.isFeatured ? "Quitar destacado" : "Destacar"}
                      >
                        <Star className={`w-4 h-4 ${v.isFeatured ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
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
            <DialogTitle>Nuevo venue</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nombre *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: toSlug(e.target.value) }))}
                placeholder="Ej: Café Central"
              />
            </div>
            <div>
              <Label>Slug *</Label>
              <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: toSlug(e.target.value) }))} placeholder="cafe-central" />
            </div>
            <div>
              <Label>Categoría</Label>
              <Select value={form.categoryId} onValueChange={v => setForm(f => ({ ...f, categoryId: v }))}>
                <SelectTrigger><SelectValue placeholder="Sin categorizar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Sin categorizar</SelectItem>
                  {(categories ?? []).map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              El resto de los datos (descripción, contacto, comunidades) se completan desde la ficha del venue tras crearlo.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={createMut.isPending}>Crear venue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
