import { useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Plug, ExternalLink } from "lucide-react";

/**
 * IntegrationsManager — /admin/integrations (Fase 5, spec puntos 52-55).
 * Lista de integraciones Fourvenues (por venue) y Weezevent (por evento),
 * alta de una nueva, "Test connection", estado de sync. No siembra
 * Casanova/Tía Felisa/Limoncello/Tankers/Mambo — el admin las da de alta
 * manualmente cuando existan credenciales reales.
 */
export default function IntegrationsManager() {
  const utils = trpc.useUtils();
  const { data: globalStatus } = trpc.integrations.getGlobalStatus.useQuery();
  const { data: providers } = trpc.integrations.listProviders.useQuery();
  const { data: venueIntegrations, isLoading: loadingVenue } = trpc.integrations.listVenueIntegrations.useQuery({});
  const { data: eventIntegrations, isLoading: loadingEvent } = trpc.integrations.listEventIntegrations.useQuery({});
  const { data: venuesResult } = trpc.venues.list.useQuery({});
  const { data: eventsResult } = trpc.events.list.useQuery({});
  const venues = venuesResult?.items;
  const events = eventsResult?.items;

  const [showCreate, setShowCreate] = useState<"venue" | "event" | null>(null);
  const [venueId, setVenueId] = useState<string>("");
  const [eventId, setEventId] = useState<string>("");
  const [providerId, setProviderId] = useState<string>("");
  const [fourvenuesProviderId, setFourvenuesProviderId] = useState<string>("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [apiKey, setApiKey] = useState("");
  const [editingVenueCredsId, setEditingVenueCredsId] = useState<number | null>(null);
  const [editVenueApiKey, setEditVenueApiKey] = useState("");

  const createVenueMut = trpc.integrations.createVenueIntegration.useMutation({
    onSuccess: () => { toast.success("Integración creada (deshabilitada por defecto)"); utils.integrations.listVenueIntegrations.invalidate(); setShowCreate(null); },
  });
  const createEventMut = trpc.integrations.createEventIntegration.useMutation({
    onSuccess: () => { toast.success("Integración creada (deshabilitada por defecto)"); utils.integrations.listEventIntegrations.invalidate(); setShowCreate(null); },
  });
  const testVenueMut = trpc.integrations.testVenueConnection.useMutation({
    onSuccess: (r) => toast[r.ok ? "success" : "error"](r.message),
  });
  const testEventMut = trpc.integrations.testEventConnection.useMutation({
    onSuccess: (r) => toast[r.ok ? "success" : "error"](r.message),
  });
  const setVenueEnabledMut = trpc.integrations.setVenueIntegrationEnabled.useMutation({ onSuccess: () => utils.integrations.listVenueIntegrations.invalidate() });
  const updateVenueCredsMut = trpc.integrations.updateVenueIntegrationCredentials.useMutation({
    onSuccess: () => { toast.success("API key actualizada"); utils.integrations.listVenueIntegrations.invalidate(); setEditingVenueCredsId(null); setEditVenueApiKey(""); },
    onError: e => toast.error(e.message),
  });
  const setEventEnabledMut = trpc.integrations.setEventIntegrationEnabled.useMutation({ onSuccess: () => utils.integrations.listEventIntegrations.invalidate() });

  // Dos APIs distintas de Fourvenues conviven en el catálogo — Integrations
  // API es el modelo real confirmado para Casanova/Tía Felisa/Limoncello
  // (credenciales ik_live_... independientes por venue), Channel Manager
  // queda disponible por si algún día Segolife opera como marketplace.
  const fourvenuesProviders = providers?.filter(p => p.key === "fourvenues" || p.key === "fourvenues_integrations") ?? [];
  const selectedFourvenuesProvider = fourvenuesProviders.find(p => String(p.id) === fourvenuesProviderId)
    ?? fourvenuesProviders.find(p => p.key === "fourvenues_integrations")
    ?? fourvenuesProviders[0];
  const weezeventProvider = providers?.find(p => p.key === "weezevent");

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2"><Plug className="w-5 h-5" /> Integrations</h1>
            <p className="text-sm text-muted-foreground">Fourvenues (por venue) y Weezevent (por evento) — Fase 5.</p>
          </div>
          <Link href="/admin/integrations/unresolved" className="text-sm text-primary hover:underline flex items-center gap-1">
            Unresolved operations <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 text-sm flex items-center gap-2">
          <span className="text-muted-foreground">Kill switch global (EXTERNAL_INTEGRATIONS_ENABLED):</span>
          <Badge variant={globalStatus?.externalIntegrationsEnabled ? "default" : "secondary"}>
            {globalStatus?.externalIntegrationsEnabled ? "ON" : "OFF (ningún sync puede ejecutarse)"}
          </Badge>
        </div>

        <section className="bg-card border border-border rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Fourvenues — integraciones por venue</h2>
            <Button size="sm" variant="outline" onClick={() => setShowCreate(showCreate === "venue" ? null : "venue")}>+ Nueva</Button>
          </div>
          {showCreate === "venue" && (
            <div className="grid grid-cols-2 gap-3 p-3 border border-dashed border-border rounded-lg">
              <div>
                <Label>Venue</Label>
                <Select value={venueId} onValueChange={setVenueId}>
                  <SelectTrigger><SelectValue placeholder="Selecciona un venue" /></SelectTrigger>
                  <SelectContent>{(venues ?? []).map((v: { id: number; name: string }) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Modo Fourvenues</Label>
                <Select value={String(selectedFourvenuesProvider?.id ?? "")} onValueChange={setFourvenuesProviderId}>
                  <SelectTrigger><SelectValue placeholder="Selecciona un modo" /></SelectTrigger>
                  <SelectContent>{fourvenuesProviders.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Entorno</Label>
                <Select value={environment} onValueChange={v => setEnvironment(v as "sandbox" | "production")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="sandbox">Sandbox (alpha)</SelectItem><SelectItem value="production">Producción</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>API Key (opcional al crear — puede añadirse después)</Label>
                <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Awaiting credentials si se deja vacío" />
              </div>
              <div className="col-span-2">
                <Button
                  disabled={!venueId || !selectedFourvenuesProvider || createVenueMut.isPending}
                  onClick={() => createVenueMut.mutate({ venueId: Number(venueId), providerId: selectedFourvenuesProvider!.id, environment, apiKey: apiKey || undefined })}
                >
                  Crear integración
                </Button>
              </div>
            </div>
          )}
          {loadingVenue ? <Loader2 className="w-4 h-4 animate-spin" /> : !venueIntegrations?.length ? (
            <p className="text-sm text-muted-foreground text-center py-3">Sin integraciones Fourvenues configuradas.</p>
          ) : (
            <div className="space-y-1.5">
              {venueIntegrations.map(i => (
                <div key={i.id} className="border border-border rounded-lg px-3 py-2 text-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span>venue #{i.venueId} · {i.providerKey === "fourvenues_integrations" ? "Integrations API" : "Channel Manager"} · {i.environment} · {i.credentialsConfigured ? `····${i.credentialsLast4 ?? ""}` : "Awaiting credentials"}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={i.status === "connected" ? "default" : i.status === "error" ? "destructive" : "secondary"}>{i.status}</Badge>
                      <Button size="sm" variant="outline" onClick={() => setEditingVenueCredsId(editingVenueCredsId === i.id ? null : i.id)}>
                        {editingVenueCredsId === i.id ? "Cancelar" : "Editar API key"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => testVenueMut.mutate({ id: i.id })} disabled={testVenueMut.isPending}>Test connection</Button>
                      <Button size="sm" variant={i.enabled ? "default" : "outline"} onClick={() => setVenueEnabledMut.mutate({ id: i.id, enabled: !i.enabled })}>{i.enabled ? "Enabled" : "Disabled"}</Button>
                    </div>
                  </div>
                  {editingVenueCredsId === i.id && (
                    <div className="flex items-center gap-2 pt-1 border-t border-border">
                      <Input type="password" value={editVenueApiKey} onChange={e => setEditVenueApiKey(e.target.value)} placeholder="Nueva API key" className="h-8" />
                      <Button
                        size="sm"
                        disabled={!editVenueApiKey || updateVenueCredsMut.isPending}
                        onClick={() => updateVenueCredsMut.mutate({ id: i.id, apiKey: editVenueApiKey })}
                      >
                        Guardar
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-card border border-border rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Weezevent — integraciones por evento</h2>
            <Button size="sm" variant="outline" onClick={() => setShowCreate(showCreate === "event" ? null : "event")}>+ Nueva</Button>
          </div>
          {showCreate === "event" && (
            <div className="grid grid-cols-2 gap-3 p-3 border border-dashed border-border rounded-lg">
              <div>
                <Label>Evento</Label>
                <Select value={eventId} onValueChange={setEventId}>
                  <SelectTrigger><SelectValue placeholder="Selecciona un evento" /></SelectTrigger>
                  <SelectContent>{(events ?? []).map((e: { id: number; name: string }) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Entorno</Label>
                <Select value={environment} onValueChange={v => setEnvironment(v as "sandbox" | "production")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="production">Producción (Weezevent sin sandbox documentado)</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>API Key</Label>
                <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} />
              </div>
              <div className="col-span-2">
                <Button
                  disabled={!eventId || !weezeventProvider || createEventMut.isPending}
                  onClick={() => createEventMut.mutate({ eventId: Number(eventId), providerId: weezeventProvider!.id, environment, apiKey: apiKey || undefined })}
                >
                  Crear integración
                </Button>
              </div>
            </div>
          )}
          {loadingEvent ? <Loader2 className="w-4 h-4 animate-spin" /> : !eventIntegrations?.length ? (
            <p className="text-sm text-muted-foreground text-center py-3">Sin integraciones Weezevent configuradas.</p>
          ) : (
            <div className="space-y-1.5">
              {eventIntegrations.map(i => (
                <div key={i.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
                  <span>evento #{i.eventId} · {i.environment} · {i.credentialsConfigured ? `····${i.credentialsLast4 ?? ""}` : "Awaiting credentials"}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={i.status === "connected" ? "default" : i.status === "error" ? "destructive" : "secondary"}>{i.status}</Badge>
                    <Button size="sm" variant="outline" onClick={() => testEventMut.mutate({ id: i.id })} disabled={testEventMut.isPending}>Test connection</Button>
                    <Button size="sm" variant={i.enabled ? "default" : "outline"} onClick={() => setEventEnabledMut.mutate({ id: i.id, enabled: !i.enabled })}>{i.enabled ? "Enabled" : "Disabled"}</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
