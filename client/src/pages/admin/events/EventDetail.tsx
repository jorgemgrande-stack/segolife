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
import { ArrowLeft, Loader2, CalendarDays, Sparkles, Star } from "lucide-react";

const NONE = "__none__";

function FutureModulePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground border border-dashed border-border rounded-lg justify-center">
      <Sparkles className="w-4 h-4" />
      {label} — todavía no implementado en esta fase
    </div>
  );
}

/** <input type="datetime-local"> espera "YYYY-MM-DDTHH:mm" en hora local, sin zona. */
function toDatetimeLocal(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function EventDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const eventId = Number(params.id);
  const utils = trpc.useUtils();

  const { data: detail, isLoading, error } = trpc.events.getById.useQuery({ id: eventId });
  const { data: venuesData } = trpc.venues.publicActive.useQuery({});
  const { data: allCommunities } = trpc.communities.list.useQuery();

  const [form, setForm] = useState({
    name: "", slug: "", description: "", venueId: NONE,
    startsAt: "", endsAt: "", capacity: "", imageUrl: "",
  });
  const [selectedCommunities, setSelectedCommunities] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!detail) return;
    setForm({
      name: detail.event.name,
      slug: detail.event.slug,
      description: detail.event.description ?? "",
      venueId: detail.event.venueId ? String(detail.event.venueId) : NONE,
      startsAt: toDatetimeLocal(detail.event.startsAt),
      endsAt: toDatetimeLocal(detail.event.endsAt),
      capacity: detail.event.capacity ? String(detail.event.capacity) : "",
      imageUrl: detail.event.imageUrl ?? "",
    });
    setSelectedCommunities(new Set(detail.communities.map(c => c.id)));
  }, [detail]);

  const updateMut = trpc.events.update.useMutation({
    onSuccess: () => { toast.success("Evento actualizado"); utils.events.getById.invalidate({ id: eventId }); utils.events.list.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const setActiveMut = trpc.events.setActive.useMutation({
    onSuccess: () => { toast.success("Estado actualizado"); utils.events.getById.invalidate({ id: eventId }); utils.events.list.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const setFeaturedMut = trpc.events.setFeatured.useMutation({
    onSuccess: () => { toast.success("Destacado actualizado"); utils.events.getById.invalidate({ id: eventId }); utils.events.list.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const setCommunitiesMut = trpc.events.setCommunities.useMutation({
    onSuccess: () => { toast.success("Comunidades actualizadas"); utils.events.getById.invalidate({ id: eventId }); utils.events.list.invalidate(); },
    onError: e => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <AdminLayout title="Evento">
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      </AdminLayout>
    );
  }

  if (error || !detail) {
    return (
      <AdminLayout title="Evento">
        <div className="py-16 text-center text-sm text-destructive">{error?.message ?? "Evento no encontrado"}</div>
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
    if (!form.startsAt) { toast.error("La fecha de inicio es obligatoria"); return; }
    updateMut.mutate({
      id: eventId,
      name: form.name,
      slug: form.slug,
      description: form.description || null,
      venueId: form.venueId !== NONE ? Number(form.venueId) : null,
      startsAt: new Date(form.startsAt),
      endsAt: form.endsAt ? new Date(form.endsAt) : null,
      capacity: form.capacity ? Number(form.capacity) : null,
      imageUrl: form.imageUrl || null,
    });
  };

  return (
    <AdminLayout title="Evento">
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/events")} className="gap-1 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Volver al listado
        </Button>

        <div className="flex items-start gap-4 bg-card border border-border rounded-lg p-5">
          <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center">
            <CalendarDays className="w-8 h-8 text-primary" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-foreground">{detail.event.name}</h2>
              {detail.event.isFeatured && <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />}
            </div>
            <p className="text-sm text-muted-foreground">/{detail.event.slug}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {detail.venue && <Badge variant="secondary">{detail.venue.name}</Badge>}
              {detail.communities.map(c => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Activo</span>
              <Switch
                checked={detail.event.status === "active"}
                onCheckedChange={v => setActiveMut.mutate({ id: eventId, active: v })}
              />
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Destacado</span>
              <Switch
                checked={detail.event.isFeatured}
                onCheckedChange={v => setFeaturedMut.mutate({ id: eventId, featured: v })}
              />
            </div>
          </div>
        </div>

        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">Datos generales</TabsTrigger>
            <TabsTrigger value="comunidades">Comunidades</TabsTrigger>
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
                <Label>Venue</Label>
                <Select value={form.venueId} onValueChange={v => setForm(f => ({ ...f, venueId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sin venue fijo</SelectItem>
                    {(venuesData ?? []).map(v => (
                      <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Aforo</Label>
                <Input type="number" min={1} value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} />
              </div>
              <div>
                <Label>Inicio *</Label>
                <Input type="datetime-local" value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} />
              </div>
              <div>
                <Label>Fin</Label>
                <Input type="datetime-local" value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
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
            <p className="text-sm text-muted-foreground">Comunidades para las que se publica este evento (IE, UVA, futuros campus…).</p>
            <div className="space-y-2">
              {(allCommunities ?? []).map(c => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selectedCommunities.has(c.id)} onCheckedChange={() => toggleCommunity(c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
            <Button
              onClick={() => setCommunitiesMut.mutate({ id: eventId, communityIds: Array.from(selectedCommunities) })}
              disabled={setCommunitiesMut.isPending}
            >
              Guardar comunidades
            </Button>
          </TabsContent>

          <TabsContent value="futuro" className="space-y-3">
            <FutureModulePlaceholder label="SegoTokens / recompensas" />
            <FutureModulePlaceholder label="QR / control de acceso" />
            <FutureModulePlaceholder label="Aforo en tiempo real" />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
