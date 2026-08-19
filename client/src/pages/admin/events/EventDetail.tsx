import { useState, useEffect, useRef } from "react";
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
import { ArrowLeft, Loader2, CalendarDays, Star, Upload, ImageIcon, Plug } from "lucide-react";
import { EventTicketingTab } from "./EventTicketingTab";
import { getEventTemporalStatus, type EventTemporalStatus } from "@shared/segolife/eventTiming";

const NONE = "__none__";

const FOURVENUES_SOURCE_PREFIX = "integration:fourvenues";

const PUBLICATION_STATUS_LABEL: Record<string, string> = {
  published: "Publicado",
  unpublished: "Borrador",
  unknown: "Desconocido",
};

const TEMPORAL_STATUS_LABEL: Record<EventTemporalStatus, string> = {
  upcoming: "Próximo",
  ongoing: "En curso",
  past: "Finalizado",
};

/**
 * FIX-04 — bloque de origen Fourvenues (spec §37): Provider / estado de
 * publicación en origen / estado temporal / última sincronización. Reutiliza
 * datos ya existentes y seguros — integrations.listVenueIntegrations (misma
 * query que /admin/integrations, ya autorizada para admin) para
 * lastSyncAt del venue, y getEventTemporalStatus (shared/segolife/
 * eventTiming.ts) para el estado temporal — nunca un volcado del payload
 * crudo de Fourvenues, nunca una query nueva paralela.
 */
function EventFourvenuesSourceBlock({ event }: { event: { venueId: number | null; sourcePublicationStatus: string | null; startsAt: Date | string; endsAt: Date | string | null } }) {
  const { data: venueIntegrations } = trpc.integrations.listVenueIntegrations.useQuery(
    { venueId: event.venueId ?? undefined },
    { enabled: event.venueId != null }
  );
  const fourvenuesIntegration = (venueIntegrations ?? []).find(i => i.providerKey === "fourvenues_integrations");
  const publicationStatus = event.sourcePublicationStatus ?? "unknown";
  const temporalStatus = getEventTemporalStatus(event);

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3"><Plug className="w-4 h-4" /> Origen — Fourvenues</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Proveedor</p>
          <p className="text-sm text-foreground">Fourvenues</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Estado en origen</p>
          <Badge variant={publicationStatus === "published" ? "default" : "secondary"}>
            {PUBLICATION_STATUS_LABEL[publicationStatus] ?? publicationStatus}
          </Badge>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Estado temporal</p>
          <Badge variant={temporalStatus === "past" ? "outline" : "secondary"}>{TEMPORAL_STATUS_LABEL[temporalStatus]}</Badge>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Última sincronización</p>
          <p className="text-sm text-foreground">
            {fourvenuesIntegration?.lastSyncAt ? new Date(fourvenuesIntegration.lastSyncAt).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
          </p>
        </div>
      </div>
      {publicationStatus !== "published" && (
        <p className="text-xs text-muted-foreground mt-3">
          Este evento está sincronizado desde Fourvenues pero NO está publicado en origen — no es visible ni comprable para el Student, aunque aparezca en este panel de administración.
        </p>
      )}
    </div>
  );
}

/** Pestaña Media — flyer del evento (Fase 8.6, punto 49). REUSE: mismo /api/upload/image. */
function EventMediaTab({ eventId, imageUrl }: { eventId: number; imageUrl: string | null }) {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const updateMut = trpc.events.update.useMutation({
    onSuccess: () => { utils.events.getById.invalidate({ id: eventId }); toast.success("Flyer actualizado"); },
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
      updateMut.mutate({ id: eventId, imageUrl: data.url });
    } catch {
      toast.error("Error de conexión al subir la imagen");
    }
    setUploading(false);
  };

  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-3">
      <p className="text-sm font-semibold text-foreground">Flyer</p>
      <div className="flex items-center gap-4">
        <div className="w-32 h-32 rounded-lg overflow-hidden bg-secondary/40 border border-dashed border-border flex items-center justify-center shrink-0">
          {imageUrl ? <img src={imageUrl} alt="" className="size-full object-cover" /> : <ImageIcon className="w-6 h-6 text-muted-foreground" />}
        </div>
        <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Upload className="w-3.5 h-3.5 mr-1.5" /> {uploading ? "Subiendo…" : "Cambiar flyer"}
        </Button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && uploadFlyer(e.target.files[0])} />
      </div>
    </div>
  );
}

/** Pestaña Ventas — SEGOLIFE COMMERCE CORE (Fase 9, spec §33). Único sitio donde un admin ve ingresos/canal reales de ESTE evento — antes solo existía un recuento crudo de asistencia (ver EventAttendanceTab). Reutiliza salesOperations.eventOperationsDetail, nunca una query nueva paralela. */
function EventSalesTab({ eventId }: { eventId: number }) {
  const { data, isLoading } = trpc.salesOperations.eventOperationsDetail.useQuery({ eventId });
  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return null;

  const euro = (c: number) => (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

  const cards = [
    { label: "Entradas vendidas", value: data.ticketsSoldTotal },
    { label: "SEGOLIFE", value: data.ticketsSoldSegolife },
    { label: "Fourvenues", value: data.ticketsSoldFourvenues },
    { label: "Ventas de puerta", value: data.doorSalesCount },
    { label: "Check-ins", value: data.checkInsTotal },
    { label: "Devoluciones", value: data.refundsCount },
    { label: "Ingresos brutos", value: euro(data.grossSalesCents) },
    { label: "SEGOLIFE / Fourvenues (€)", value: `${euro(data.segolifeSalesCents)} / ${euro(data.fourvenuesSalesCents)}` },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map(c => (
        <div key={c.label} className="bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{c.label}</p>
          <p className="text-xl font-semibold text-foreground">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

/** Pestaña Attendance — REUSE: eventTicketing.listEventAttendance ya existe (Fase 8). */
function EventAttendanceTab({ eventId }: { eventId: number }) {
  const { data, isLoading } = trpc.eventTicketing.listEventAttendance.useQuery({ eventId });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Asistencias registradas</p>
        <p className="text-2xl font-semibold text-foreground">{data?.length ?? 0}</p>
      </div>
      <div className="bg-card border border-border rounded-lg p-4">
        {!data?.length ? (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-4 text-center">
            Sin asistencias registradas todavía para este evento.
          </p>
        ) : (
          <div className="space-y-1.5">
            {data.slice(0, 50).map(a => (
              <div key={a.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <span className="text-foreground">Usuario #{a.userId} · {a.provider}</span>
                <span className="text-xs text-muted-foreground">{new Date(a.occurredAt).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Pestaña Integrations — REUSE: integrations.listEventIntegrations ya existe (Fase 5). Weezevent, nunca activado aquí. */
function EventIntegrationsTab({ eventId }: { eventId: number }) {
  const { data, isLoading } = trpc.integrations.listEventIntegrations.useQuery({ eventId });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3"><Plug className="w-4 h-4" /> Integraciones (Weezevent)</h3>
      {!data?.length ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-4 text-center">
          Sin integración configurada para este evento — dar de alta desde /admin/integrations.
        </p>
      ) : (
        <div className="space-y-1.5">
          {data.map(i => (
            <div key={i.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
              <span>{i.providerKey} · {i.environment}</span>
              <div className="flex items-center gap-2">
                {!i.credentialsConfigured && <Badge variant="outline">Awaiting credentials</Badge>}
                <Badge variant={i.status === "connected" ? "default" : i.status === "error" ? "destructive" : "secondary"}>{i.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}
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

        {detail.event.sourceType?.startsWith(FOURVENUES_SOURCE_PREFIX) && (
          <EventFourvenuesSourceBlock
            event={{
              venueId: detail.event.venueId,
              sourcePublicationStatus: detail.event.sourcePublicationStatus,
              startsAt: detail.event.startsAt,
              endsAt: detail.event.endsAt,
            }}
          />
        )}

        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">Datos generales</TabsTrigger>
            <TabsTrigger value="media">Media</TabsTrigger>
            <TabsTrigger value="comunidades">Comunidades</TabsTrigger>
            <TabsTrigger value="ticketing">Ticketing / Sales</TabsTrigger>
            <TabsTrigger value="ventas">Ventas</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
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
            </div>
            <div>
              <Label>Descripción</Label>
              <Textarea rows={4} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <Button onClick={saveGeneral} disabled={updateMut.isPending}>Guardar cambios</Button>
          </TabsContent>

          <TabsContent value="media">
            <EventMediaTab eventId={eventId} imageUrl={detail.event.imageUrl} />
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

          <TabsContent value="ticketing" className="bg-card border border-border rounded-lg p-5">
            <EventTicketingTab eventId={eventId} eventStartsAt={detail.event.startsAt} eventEndsAt={detail.event.endsAt} />
          </TabsContent>

          <TabsContent value="ventas">
            <EventSalesTab eventId={eventId} />
          </TabsContent>

          <TabsContent value="attendance">
            <EventAttendanceTab eventId={eventId} />
          </TabsContent>

          <TabsContent value="integrations">
            <EventIntegrationsTab eventId={eventId} />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
