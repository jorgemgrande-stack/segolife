import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Store, Sparkles } from "lucide-react";

const NONE = "__none__";

function FutureModulePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground border border-dashed border-border rounded-lg justify-center">
      <Sparkles className="w-4 h-4" />
      {label} — todavía no implementado en esta fase
    </div>
  );
}

export default function VenueDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const venueId = Number(params.id);
  const utils = trpc.useUtils();

  const { data: detail, isLoading, error } = trpc.venues.getById.useQuery({ id: venueId });
  const { data: categories } = trpc.venues.listCategories.useQuery();
  const { data: allCommunities } = trpc.communities.list.useQuery();
  const { data: events } = trpc.events.publicByVenue.useQuery({ venueId }, { enabled: !!venueId });

  const [form, setForm] = useState({
    name: "", slug: "", description: "", categoryId: NONE,
    address: "", city: "", phone: "", email: "", website: "", imageUrl: "",
  });
  const [selectedCommunities, setSelectedCommunities] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!detail) return;
    setForm({
      name: detail.venue.name,
      slug: detail.venue.slug,
      description: detail.venue.description ?? "",
      categoryId: detail.venue.categoryId ? String(detail.venue.categoryId) : NONE,
      address: detail.venue.address ?? "",
      city: detail.venue.city,
      phone: detail.venue.phone ?? "",
      email: detail.venue.email ?? "",
      website: detail.venue.website ?? "",
      imageUrl: detail.venue.imageUrl ?? "",
    });
    setSelectedCommunities(new Set(detail.communities.map(c => c.id)));
  }, [detail]);

  const updateMut = trpc.venues.update.useMutation({
    onSuccess: () => { toast.success("Venue actualizado"); utils.venues.getById.invalidate({ id: venueId }); utils.venues.list.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const setActiveMut = trpc.venues.setActive.useMutation({
    onSuccess: () => { toast.success("Estado actualizado"); utils.venues.getById.invalidate({ id: venueId }); utils.venues.list.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const setCommunitiesMut = trpc.venues.setCommunities.useMutation({
    onSuccess: () => { toast.success("Comunidades actualizadas"); utils.venues.getById.invalidate({ id: venueId }); utils.venues.list.invalidate(); },
    onError: e => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <AdminLayout title="Venue">
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      </AdminLayout>
    );
  }

  if (error || !detail) {
    return (
      <AdminLayout title="Venue">
        <div className="py-16 text-center text-sm text-destructive">{error?.message ?? "Venue no encontrado"}</div>
      </AdminLayout>
    );
  }

  const toggleCommunity = (id: number) => {
    setSelectedCommunities(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const saveGeneral = () => {
    updateMut.mutate({
      id: venueId,
      name: form.name,
      slug: form.slug,
      description: form.description || null,
      categoryId: form.categoryId !== NONE ? Number(form.categoryId) : null,
      address: form.address || null,
      city: form.city || undefined,
      phone: form.phone || null,
      email: form.email || null,
      website: form.website || null,
      imageUrl: form.imageUrl || null,
    });
  };

  return (
    <AdminLayout title="Venue">
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/venues")} className="gap-1 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Volver al listado
        </Button>

        <div className="flex items-start gap-4 bg-card border border-border rounded-lg p-5">
          <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center">
            <Store className="w-8 h-8 text-primary" />
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="text-xl font-semibold text-foreground">{detail.venue.name}</h2>
            <p className="text-sm text-muted-foreground">/{detail.venue.slug}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {detail.category && <Badge variant="secondary">{detail.category.name}</Badge>}
              {detail.communities.map(c => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Activo</span>
            <Switch
              checked={detail.venue.status === "active"}
              onCheckedChange={v => setActiveMut.mutate({ id: venueId, active: v })}
            />
          </div>
        </div>

        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">Datos generales</TabsTrigger>
            <TabsTrigger value="comunidades">Comunidades</TabsTrigger>
            <TabsTrigger value="eventos">Eventos</TabsTrigger>
            <TabsTrigger value="futuro">Próximamente</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="bg-card border border-border rounded-lg p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Nombre</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <Label>Slug</Label>
                <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
              </div>
              <div>
                <Label>Categoría</Label>
                <Select value={form.categoryId} onValueChange={v => setForm(f => ({ ...f, categoryId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sin categorizar</SelectItem>
                    {(categories ?? []).map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ciudad</Label>
                <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div>
                <Label>Dirección</Label>
                <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <Label>Web</Label>
                <Input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
              </div>
              <div>
                <Label>URL de imagen</Label>
                <Input value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://…" />
              </div>
            </div>
            <div>
              <Label>Descripción</Label>
              <Textarea rows={4} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <Button onClick={saveGeneral} disabled={updateMut.isPending}>Guardar cambios</Button>
          </TabsContent>

          <TabsContent value="comunidades" className="bg-card border border-border rounded-lg p-5 space-y-4">
            <p className="text-sm text-muted-foreground">Comunidades a las que pertenece este venue (IE, UVA, futuros campus…).</p>
            <div className="space-y-2">
              {(allCommunities ?? []).map(c => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selectedCommunities.has(c.id)} onCheckedChange={() => toggleCommunity(c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
            <Button
              onClick={() => setCommunitiesMut.mutate({ id: venueId, communityIds: Array.from(selectedCommunities) })}
              disabled={setCommunitiesMut.isPending}
            >
              Guardar comunidades
            </Button>
          </TabsContent>

          <TabsContent value="eventos" className="bg-card border border-border rounded-lg p-5">
            {(events ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin eventos asociados a este venue todavía.</p>
            ) : (
              <div className="space-y-2">
                {(events ?? []).map(e => (
                  <div key={e.id} className="text-sm bg-accent/40 rounded-md p-3 flex items-center justify-between">
                    <span className="text-foreground">{e.name}</span>
                    <span className="text-xs text-muted-foreground">{new Date(e.startsAt).toLocaleDateString("es-ES")}</span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="futuro" className="space-y-3">
            <FutureModulePlaceholder label="Beneficios / redenciones" />
            <FutureModulePlaceholder label="SegoTokens" />
            <FutureModulePlaceholder label="Estadísticas de actividad" />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
