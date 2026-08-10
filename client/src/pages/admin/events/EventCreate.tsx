import { useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, CalendarDays, Upload, ImageIcon, Loader2 } from "lucide-react";
import { useAdminCommunity } from "@/contexts/AdminCommunityContext";
import { ADMIN_COMMUNITY_FILTER_ALL } from "@shared/segolife/adminCommunityFilter";

const NONE = "__none__";

function toSlug(name: string): string {
  return name.toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/**
 * Creación profesional de eventos (Fase 8.6, puntos 45-47) — sustituye el
 * modal de 4 campos anterior. Secciones cortas (BASIC / DATE & VENUE /
 * MEDIA / VISIBILITY), no un formulario de 40 campos: ticketing/attendance/
 * integraciones se configuran DESPUÉS en EventDetail (spec punto 48), no
 * aquí — crear un evento no debe exigir completar ticketing primero.
 */
export default function EventCreate() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const preselectedVenueId = new URLSearchParams(search).get("venueId");
  const { filter: communityFilter, communities } = useAdminCommunity();

  const { data: venuesData } = trpc.venues.publicActive.useQuery({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState({
    name: "", slug: "", description: "",
    venueId: preselectedVenueId ?? NONE,
    startsAt: "", endsAt: "", capacity: "", imageUrl: "",
  });
  const [selectedCommunities, setSelectedCommunities] = useState<Set<number>>(
    new Set(communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? [] : [communityFilter])
  );

  const createMut = trpc.events.create.useMutation({
    onSuccess: res => {
      toast.success("Evento creado");
      navigate(`/admin/events/${res.event.id}`);
    },
    onError: e => toast.error(e.message),
  });

  const uploadFlyer = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: formData, credentials: "include" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Error al subir la imagen"); return; }
      setForm(f => ({ ...f, imageUrl: data.url }));
    } catch {
      toast.error("Error de conexión al subir la imagen");
    }
    setUploading(false);
  };

  const toggleCommunity = (id: number) => {
    setSelectedCommunities(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    if (!form.name.trim() || !form.slug.trim() || !form.startsAt) {
      toast.error("Nombre, slug y fecha de inicio son obligatorios");
      return;
    }
    createMut.mutate({
      name: form.name.trim(),
      slug: form.slug.trim(),
      description: form.description || undefined,
      venueId: form.venueId !== NONE ? Number(form.venueId) : undefined,
      startsAt: new Date(form.startsAt),
      endsAt: form.endsAt ? new Date(form.endsAt) : undefined,
      capacity: form.capacity ? Number(form.capacity) : undefined,
      imageUrl: form.imageUrl || undefined,
      communityIds: Array.from(selectedCommunities),
    });
  };

  return (
    <AdminLayout title="Nuevo evento">
      <div className="max-w-2xl space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/events")} className="gap-1 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Volver al listado
        </Button>

        <div className="flex items-center gap-3">
          <CalendarDays className="w-6 h-6 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Nuevo evento</h2>
        </div>

        {/* ── BASIC ── */}
        <section className="bg-card border border-border rounded-lg p-5 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Datos básicos</p>
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
            <Label>Descripción</Label>
            <Textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
        </section>

        {/* ── DATE & VENUE ── */}
        <section className="bg-card border border-border rounded-lg p-5 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Fecha y venue</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          </div>
        </section>

        {/* ── MEDIA ── */}
        <section className="bg-card border border-border rounded-lg p-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Flyer</p>
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-lg overflow-hidden bg-secondary/40 border border-dashed border-border flex items-center justify-center shrink-0">
              {form.imageUrl ? <img src={form.imageUrl} alt="" className="size-full object-cover" /> : <ImageIcon className="w-6 h-6 text-muted-foreground" />}
            </div>
            <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Upload className="w-3.5 h-3.5 mr-1.5" /> {uploading ? "Subiendo…" : "Subir flyer"}
            </Button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && uploadFlyer(e.target.files[0])} />
          </div>
        </section>

        {/* ── VISIBILITY ── */}
        <section className="bg-card border border-border rounded-lg p-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Visibilidad</p>
          <p className="text-sm text-muted-foreground">Comunidades para las que se publica este evento.</p>
          <div className="space-y-2">
            {(communities ?? []).map(c => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selectedCommunities.has(c.id)} onCheckedChange={() => toggleCommunity(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Destacado, ticketing y estado activo/inactivo se configuran desde la ficha del evento tras crearlo.
          </p>
        </section>

        <Button onClick={handleCreate} disabled={createMut.isPending} className="w-full">
          {createMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Crear evento
        </Button>
      </div>
    </AdminLayout>
  );
}
