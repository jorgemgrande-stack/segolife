import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Loader2, Users, RotateCcw, Ban, Store, ExternalLink, CircleOff,
  CheckCircle2, AlertTriangle, ChevronDown, MoreVertical, Plus, Link as LinkIcon,
} from "lucide-react";

const ORDER_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline", awaiting_payment: "secondary", paid: "default", cancelled: "destructive",
  expired: "outline", refunded: "secondary", partially_refunded: "secondary", failed: "destructive",
  reconciliation_required: "destructive",
};

const PROVIDER_LABEL: Record<string, string> = {
  fourvenues: "Fourvenues",
  weezevent: "Weezevent",
  manual: "Otra plataforma",
  partner: "Otra plataforma",
};

type SalesChannelRow = {
  id: number; eventId: number; channelType: string; salesMode: string;
  externalUrl: string | null; status: string; isPrimary: boolean; sortOrder: number;
  metadata: Record<string, unknown> | null;
};
type TicketTypeRow = {
  id: number; eventId: number; name: string; description: string | null;
  priceCents: number; currency: string; capacity: number | null;
  salesStart: string | Date | null; salesEnd: string | Date | null; status: string;
  isDoorEntry?: boolean;
};

function centsToEuroStr(cents: number): string {
  return (cents / 100).toFixed(2);
}
function euroStrToCents(str: string): number {
  const n = parseFloat(str.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function channelMeta(channel: SalesChannelRow | undefined | null): { buttonText: string | null; openInNewTab: boolean } {
  const m = (channel?.metadata ?? {}) as { buttonText?: string | null; openInNewTab?: boolean };
  return { buttonText: m.buttonText ?? null, openInNewTab: m.openInNewTab ?? true };
}

/**
 * Ticketing / Sales — rediseño operativo (Fase 9). La UI habla en términos
 * de negocio ("Venta en SEGOLIFE" / "Venta en otra plataforma" / "Solo
 * información") — sales_channels/provider/sales_mode/primary siguen siendo
 * el modelo real, pero el administrador nunca necesita conocerlos para
 * configurar cómo se vende un evento. Ver configureSalesMode() en
 * salesModeService.ts para la lógica que traduce la decisión de UI a
 * operaciones sobre sales_channels.
 */
export function EventTicketingTab({ eventId, eventStartsAt, eventEndsAt }: { eventId: number; eventStartsAt?: string | Date; eventEndsAt?: string | Date | null }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.eventTicketing.getEventTicketingSummary.useQuery({ eventId });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showTicketTypeDialog, setShowTicketTypeDialog] = useState<TicketTypeRow | "new" | null>(null);
  // "External" seleccionada pero todavía no guardada — solo revela el
  // formulario (spec punto 5: nada se persiste hasta "Guardar configuración").
  const [pendingExternal, setPendingExternal] = useState(false);

  const invalidate = () => utils.eventTicketing.getEventTicketingSummary.invalidate({ eventId });

  const configureSalesModeMut = trpc.eventTicketing.configureSalesMode.useMutation({
    onSuccess: () => invalidate(),
    onError: e => toast.error(e.message),
  });
  const setPrimaryMut = trpc.eventTicketing.setPrimarySalesChannel.useMutation({
    onSuccess: () => { invalidate(); toast.success("Canal principal actualizado"); },
    onError: e => toast.error(e.message),
  });
  const deleteChannelMut = trpc.eventTicketing.deleteSalesChannel.useMutation({
    onSuccess: res => {
      invalidate();
      if (res.deleted) toast.success("Canal eliminado");
      else toast.error(res.reason ?? "No se puede eliminar este canal");
    },
    onError: e => toast.error(e.message),
  });

  // Todos los hooks (arriba) se llaman siempre, antes de cualquier return
  // condicional — regla de hooks de React.
  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return null;

  const channels = data.channels as SalesChannelRow[];
  const ticketTypes = data.ticketTypes as TicketTypeRow[];
  const activeChannels = channels.filter(c => c.status === "active");
  const native = channels.find(c => c.salesMode === "native") ?? null;
  const external = channels.find(c => c.salesMode === "external_redirect") ?? null;
  // Mismo criterio de selección que computePurchaseAction (server/segolife/ticketing/purchaseAction.ts):
  // isPrimary entre los activos, si no el de menor sortOrder.
  const primary = activeChannels.find(c => c.isPrimary) ?? activeChannels[0] ?? null;
  const hybridEnabled = activeChannels.length > 1;
  const currentMode: "native" | "external" | "none" = !primary ? "none" : primary.salesMode === "native" ? "native" : "external";
  const eventPast = eventStartsAt ? new Date(eventStartsAt) < new Date() && (!eventEndsAt || new Date(eventEndsAt) < new Date()) : false;

  const activeTicketTypes = ticketTypes.filter(t => t.status === "active");
  const prices = activeTicketTypes.map(t => t.priceCents);
  const minPrice = prices.length ? Math.min(...prices) : null;

  const setMode = (mode: "native" | "external" | "none") => {
    if (mode === "external") { setPendingExternal(true); return; }
    setPendingExternal(false);
    configureSalesModeMut.mutate({ eventId, mode, hybridEnabled });
  };
  // Mientras "external" está seleccionada pero sin guardar, manda sobre el
  // modo real de BD solo para qué tarjeta se resalta — evita que dos
  // tarjetas del selector aparezcan "seleccionadas" a la vez.
  const displayMode: "native" | "external" | "none" = pendingExternal ? "external" : currentMode;
  const showExternalForm = displayMode === "external" || (hybridEnabled && !!external);
  const showNativePanel = displayMode === "native" || (hybridEnabled && !!native);

  const toggleHybrid = (checked: boolean) => {
    if (currentMode === "none") { toast.error("Configura primero un canal de venta principal."); return; }
    configureSalesModeMut.mutate({ eventId, mode: currentMode, hybridEnabled: checked });
  };

  return (
    <div className="space-y-6">
      {/* ── Título + banda resumen (spec puntos 2 y 15) ─────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-foreground">Venta de entradas</h2>
        <p className="text-sm text-muted-foreground">Configura cómo podrán conseguir sus entradas los asistentes.</p>
      </div>

      <SalesSummaryBand mode={currentMode} activeTicketTypesCount={activeTicketTypes.length} minPriceCents={minPrice} externalConfigured={!!external?.externalUrl} providerLabel={external ? (PROVIDER_LABEL[external.channelType] ?? external.channelType) : null} />

      <SalesStatusCard
        mode={currentMode}
        eventPast={eventPast}
        hasActiveTicketTypes={activeTicketTypes.length > 0}
        externalUrl={external?.externalUrl ?? null}
        providerLabel={external ? (PROVIDER_LABEL[external.channelType] ?? external.channelType) : null}
      />

      {/* ── Selector de modalidad (spec punto 2) ────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ModeCard
          icon={<Store className="w-5 h-5" />}
          title="Venta en SEGOLIFE"
          description="Gestiona precios, aforo, entradas y asistentes directamente desde SEGOLIFE."
          selected={displayMode === "native"}
          onClick={() => setMode("native")}
          disabled={configureSalesModeMut.isPending}
        />
        <ModeCard
          icon={<ExternalLink className="w-5 h-5" />}
          title="Venta en otra plataforma"
          description="SEGOLIFE mostrará el evento y enviará al usuario a la plataforma donde se venden las entradas."
          selected={displayMode === "external"}
          onClick={() => setMode("external")}
          disabled={configureSalesModeMut.isPending}
        />
        <ModeCard
          icon={<CircleOff className="w-5 h-5" />}
          title="Solo información"
          description="El evento será visible pero todavía no tendrá venta de entradas."
          selected={displayMode === "none"}
          onClick={() => setMode("none")}
          disabled={configureSalesModeMut.isPending}
        />
      </div>

      {/* ── Configuración avanzada / Hybrid (spec punto 3) ──────────────────── */}
      {currentMode !== "none" && (native || external) && (
        <div className="border border-border rounded-lg">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground"
            onClick={() => setAdvancedOpen(v => !v)}
          >
            Configuración avanzada
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
          </button>
          {advancedOpen && (
            <div className="px-4 pb-4 border-t border-border pt-3 space-y-2">
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox checked={hybridEnabled} onCheckedChange={v => toggleHybrid(v === true)} disabled={configureSalesModeMut.isPending} className="mt-0.5" />
                <span>
                  <span className="font-medium text-foreground">Combinar venta SEGOLIFE y venta externa</span>
                  <br />
                  <span className="text-muted-foreground">Permite vender algunos tipos de entrada en SEGOLIFE y utilizar además un proveedor externo.</span>
                </span>
              </label>
            </div>
          )}
        </div>
      )}

      {/* ── Panel Nativo: Tipos de entrada (spec puntos 7-10) ───────────────── */}
      {showNativePanel && (
        <div className="space-y-3">
          {hybridEnabled && <ChannelBlockHeader label={native?.isPrimary ? "VENTA PRINCIPAL" : "VENTA SECUNDARIA"} title="SEGOLIFE" isPrimary={!!native?.isPrimary} onMakePrimary={native && !native.isPrimary ? () => setPrimaryMut.mutate({ channelId: native.id }) : undefined} />}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Tipos de entrada</h3>
            <Button size="sm" onClick={() => setShowTicketTypeDialog("new")}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Añadir tipo de entrada
            </Button>
          </div>
          {ticketTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-6 text-center">
              Sin tipos de entrada todavía — añade el primero para empezar a vender.
            </p>
          ) : (
            <div className="space-y-2">
              {ticketTypes.map(t => {
                const inv = data.inventory.find((i: { ticketTypeId: number }) => i.ticketTypeId === t.id);
                return <TicketTypeCard key={t.id} ticketType={t} available={inv?.available ?? null} onEdit={() => setShowTicketTypeDialog(t)} onChanged={invalidate} />;
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Panel Externo (spec puntos 5-6) ─────────────────────────────────── */}
      {showExternalForm && (
        <div className="space-y-3">
          {hybridEnabled && <ChannelBlockHeader label={external?.isPrimary ? "VENTA PRINCIPAL" : "CANAL EXTERNO"} title={external ? (PROVIDER_LABEL[external.channelType] ?? external.channelType) : "Externo"} isPrimary={!!external?.isPrimary} onMakePrimary={external && !external.isPrimary ? () => setPrimaryMut.mutate({ channelId: external.id }) : undefined} />}
          <ExternalChannelForm
            eventId={eventId}
            channel={external}
            hybridEnabled={hybridEnabled}
            onSaved={() => { invalidate(); setPendingExternal(false); }}
            onDelete={external ? () => {
              if (!confirm("¿Eliminar este canal de venta externo?")) return;
              deleteChannelMut.mutate({ id: external.id });
            } : undefined}
          />
        </div>
      )}

      {hybridEnabled && (native || external) && (
        <p className="text-xs text-muted-foreground italic">
          Cuando un estudiante pulse Comprar, se utilizará: <span className="font-semibold text-foreground">{currentMode === "native" ? "SEGOLIFE" : currentMode === "external" ? (PROVIDER_LABEL[external?.channelType ?? ""] ?? "canal externo") : "—"}</span>
        </p>
      )}

      <Separator />

      {/* ── Orders / Tickets / Attendance (sin cambios) ─────────────────────── */}
      <OrdersSection orders={data.orders} onChanged={invalidate} />
      <TicketsSection tickets={data.tickets} />
      <AttendanceSection eventId={eventId} />

      {showTicketTypeDialog && (
        <TicketTypeDialog
          eventId={eventId}
          ticketType={showTicketTypeDialog === "new" ? null : showTicketTypeDialog}
          onClose={() => setShowTicketTypeDialog(null)}
          onSaved={() => { invalidate(); setShowTicketTypeDialog(null); }}
        />
      )}
    </div>
  );
}

// ─── Selector de modalidad ────────────────────────────────────────────────────

function ModeCard({ icon, title, description, selected, onClick, disabled }: { icon: React.ReactNode; title: string; description: string; selected: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-left rounded-lg border p-4 space-y-2 transition-colors disabled:opacity-60 ${
        selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40"
      }`}
    >
      <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${selected ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
        {icon}
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
    </button>
  );
}

function ChannelBlockHeader({ label, title, isPrimary, onMakePrimary }: { label: string; title: string; isPrimary: boolean; onMakePrimary?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground">{title}</p>
      </div>
      {onMakePrimary && <Button size="sm" variant="outline" onClick={onMakePrimary}>Hacer principal</Button>}
      {isPrimary && <Badge>Canal principal</Badge>}
    </div>
  );
}

// ─── Banda resumen + estado (spec puntos 4, 15) ───────────────────────────────

function SalesSummaryBand({ mode, activeTicketTypesCount, minPriceCents, externalConfigured, providerLabel }: {
  mode: "native" | "external" | "none"; activeTicketTypesCount: number; minPriceCents: number | null;
  externalConfigured: boolean; providerLabel: string | null;
}) {
  const label = mode === "native" ? "SEGOLIFE" : mode === "external" ? (providerLabel ?? "Externo") : "No configurada";
  const detail = mode === "native"
    ? (activeTicketTypesCount > 0 ? `${activeTicketTypesCount} tipo(s) de entrada · Desde ${centsToEuroStr(minPriceCents ?? 0)} €` : "Sin tipos de entrada todavía")
    : mode === "external"
    ? (externalConfigured ? "Redirección externa · Canal activo" : "Redirección externa · Falta URL")
    : "Publicación informativa";
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Venta</p>
        <p className="text-sm font-semibold text-foreground">{label}</p>
      </div>
      <Separator orientation="vertical" className="h-8" />
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function SalesStatusCard({ mode, eventPast, hasActiveTicketTypes, externalUrl, providerLabel }: {
  mode: "native" | "external" | "none"; eventPast: boolean; hasActiveTicketTypes: boolean; externalUrl: string | null; providerLabel: string | null;
}) {
  if (eventPast) {
    return (
      <StatusBox variant="warning" title="Evento finalizado" description="Este evento ya ha terminado — no se muestra ningún botón de compra a los estudiantes." />
    );
  }
  if (mode === "none") {
    return <StatusBox variant="neutral" title="Publicación informativa" description="El evento es visible pero todavía no tiene venta de entradas configurada." />;
  }
  if (mode === "native") {
    if (!hasActiveTicketTypes) {
      return <StatusBox variant="warning" title="Falta completar la venta" description="Has activado la venta en SEGOLIFE pero todavía no hay ningún tipo de entrada activo." />;
    }
    return <StatusBox variant="success" title="Venta configurada" description="Los estudiantes comprarán sus entradas directamente en SEGOLIFE." footer="Canal principal: SEGOLIFE" />;
  }
  // external
  if (!externalUrl) {
    return <StatusBox variant="warning" title="Falta completar la venta" description={`Has seleccionado ${providerLabel ?? "una plataforma externa"} pero todavía no existe una URL de compra.`} />;
  }
  return <StatusBox variant="success" title="Venta configurada" description={`Los estudiantes serán redirigidos a ${providerLabel} para comprar sus entradas.`} footer={`Canal principal: ${providerLabel}`} />;
}

function StatusBox({ variant, title, description, footer }: { variant: "success" | "warning" | "neutral"; title: string; description: string; footer?: string }) {
  const styles = {
    success: "border-emerald-500/30 bg-emerald-500/5",
    warning: "border-amber-500/30 bg-amber-500/5",
    neutral: "border-border bg-secondary/30",
  }[variant];
  const Icon = variant === "success" ? CheckCircle2 : variant === "warning" ? AlertTriangle : Store;
  const iconColor = variant === "success" ? "text-emerald-500" : variant === "warning" ? "text-amber-500" : "text-muted-foreground";
  return (
    <div className={`rounded-lg border p-4 ${styles}`}>
      <div className="flex items-start gap-2.5">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          {footer && <p className="text-xs font-medium text-foreground mt-1.5">{footer}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Panel externo ─────────────────────────────────────────────────────────────

function ExternalChannelForm({ eventId, channel, hybridEnabled, onSaved, onDelete }: {
  eventId: number; channel: SalesChannelRow | null; hybridEnabled: boolean; onSaved: () => void; onDelete?: () => void;
}) {
  const meta = channelMeta(channel);
  const [provider, setProvider] = useState<string>(channel?.channelType ?? "fourvenues");
  const [url, setUrl] = useState(channel?.externalUrl ?? "");
  const [buttonText, setButtonText] = useState(meta.buttonText ?? "");
  const [openInNewTab, setOpenInNewTab] = useState(meta.openInNewTab);

  const configureMut = trpc.eventTicketing.configureSalesMode.useMutation({
    onSuccess: () => { toast.success("Configuración guardada"); onSaved(); },
    onError: e => toast.error(e.message),
  });

  const incomplete = !!channel && !channel.externalUrl;

  const save = () => {
    if (url && !/^https?:\/\//.test(url)) { toast.error("La URL debe empezar por http:// o https://"); return; }
    configureMut.mutate({
      eventId,
      mode: "external",
      hybridEnabled,
      external: { channelType: provider as "fourvenues" | "weezevent" | "manual" | "partner", externalUrl: url, buttonText: buttonText || null, openInNewTab },
    });
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      {incomplete && (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Configuración incompleta — introduce la URL del evento para activar la venta.
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Plataforma</Label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fourvenues">Fourvenues</SelectItem>
              <SelectItem value="weezevent">Weezevent</SelectItem>
              <SelectItem value="manual">Otra plataforma</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Texto del botón</Label>
          <Input value={buttonText} onChange={e => setButtonText(e.target.value)} placeholder="Comprar entradas" />
        </div>
      </div>
      <div>
        <Label>URL de compra</Label>
        <div className="relative">
          <LinkIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <Checkbox checked={openInNewTab} onCheckedChange={v => setOpenInNewTab(v === true)} />
        Abrir enlace en una nueva pestaña
      </label>
      <div className="flex items-center justify-between pt-1">
        {onDelete ? (
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={onDelete}>Eliminar canal</Button>
        ) : <span />}
        <Button onClick={save} disabled={configureMut.isPending}>
          {configureMut.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />} Guardar configuración
        </Button>
      </div>
    </div>
  );
}

// ─── Tipos de entrada ──────────────────────────────────────────────────────────

function TicketTypeCard({ ticketType, available, onEdit, onChanged }: { ticketType: TicketTypeRow; available: number | null; onEdit: () => void; onChanged: () => void }) {
  const updateMut = trpc.eventTicketing.updateTicketType.useMutation({
    onSuccess: () => { onChanged(); toast.success("Actualizado"); },
    onError: e => toast.error(e.message),
  });
  const duplicateMut = trpc.eventTicketing.duplicateTicketType.useMutation({
    onSuccess: () => { onChanged(); toast.success("Tipo de entrada duplicado"); },
    onError: e => toast.error(e.message),
  });
  const deleteMut = trpc.eventTicketing.deleteTicketType.useMutation({
    onSuccess: res => {
      onChanged();
      if (res.deleted) toast.success("Eliminado");
      else toast.error(res.reason ?? "No se puede eliminar");
    },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground uppercase tracking-wide">{ticketType.name}</p>
        <p className="text-sm text-foreground">{centsToEuroStr(ticketType.priceCents)} {ticketType.currency}</p>
        <p className="text-xs text-muted-foreground">
          {available != null ? `${available} disponibles / ${ticketType.capacity} aforo` : "Sin límite de aforo"}
          {" · "}
          {ticketType.status === "active" ? "Venta activa" : "Venta desactivada"}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button size="sm" variant="outline" onClick={onEdit}>Editar</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0"><MoreVertical className="w-4 h-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={onEdit}>Editar</DropdownMenuItem>
            <DropdownMenuItem onClick={() => duplicateMut.mutate({ id: ticketType.id })}>Duplicar</DropdownMenuItem>
            <DropdownMenuItem onClick={() => updateMut.mutate({ id: ticketType.id, status: ticketType.status === "active" ? "inactive" : "active" })}>
              {ticketType.status === "active" ? "Desactivar" : "Activar"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => { if (confirm(`¿Eliminar "${ticketType.name}"? Esta acción no se puede deshacer.`)) deleteMut.mutate({ id: ticketType.id }); }}
            >
              Eliminar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function toDatetimeLocal(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function TicketTypeDialog({ eventId, ticketType, onClose, onSaved }: { eventId: number; ticketType: TicketTypeRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(ticketType?.name ?? "");
  const [description, setDescription] = useState(ticketType?.description ?? "");
  const [price, setPrice] = useState(ticketType ? centsToEuroStr(ticketType.priceCents) : "");
  const [currency, setCurrency] = useState(ticketType?.currency ?? "EUR");
  const [capacity, setCapacity] = useState(ticketType?.capacity != null ? String(ticketType.capacity) : "");
  const [salesStart, setSalesStart] = useState(toDatetimeLocal(ticketType?.salesStart));
  const [salesEnd, setSalesEnd] = useState(toDatetimeLocal(ticketType?.salesEnd));
  const [active, setActive] = useState(ticketType?.status !== "inactive");
  const [isDoorEntry, setIsDoorEntry] = useState(ticketType?.isDoorEntry ?? false);

  const createMut = trpc.eventTicketing.createTicketType.useMutation({
    onSuccess: () => { toast.success("Tipo de entrada creado"); onSaved(); },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.eventTicketing.updateTicketType.useMutation({
    onSuccess: () => { toast.success("Tipo de entrada actualizado"); onSaved(); },
    onError: e => toast.error(e.message),
  });
  const pending = createMut.isPending || updateMut.isPending;

  const save = () => {
    if (!name.trim()) { toast.error("El nombre es obligatorio"); return; }
    const priceCents = euroStrToCents(price || "0");
    const fields = {
      name: name.trim(),
      description: description.trim() || null,
      priceCents,
      currency,
      capacity: capacity ? Number(capacity) : null,
      salesStart: salesStart ? new Date(salesStart) : null,
      salesEnd: salesEnd ? new Date(salesEnd) : null,
      status: (active ? "active" : "inactive") as "active" | "inactive",
      isDoorEntry,
    };
    if (ticketType) updateMut.mutate({ id: ticketType.id, ...fields });
    else createMut.mutate({ eventId, ...fields });
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ticketType ? "Editar tipo de entrada" : "Nuevo tipo de entrada"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Nombre</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: General" />
          </div>
          <div>
            <Label>Descripción (opcional)</Label>
            <Textarea rows={2} value={description ?? ""} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Precio</Label>
              <Input value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" inputMode="decimal" />
            </div>
            <div>
              <Label>Moneda</Label>
              <Input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} />
            </div>
          </div>
          <div>
            <Label>Aforo / inventario (vacío = sin límite)</Label>
            <Input value={capacity} onChange={e => setCapacity(e.target.value)} inputMode="numeric" placeholder="Sin límite" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Inicio de venta (opcional)</Label>
              <Input type="datetime-local" value={salesStart} onChange={e => setSalesStart(e.target.value)} />
            </div>
            <div>
              <Label>Fin de venta (opcional)</Label>
              <Input type="datetime-local" value={salesEnd} onChange={e => setSalesEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <Label className="mb-0">Activo</Label>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <Label className="mb-0">Venta en puerta</Label>
              <p className="text-xs text-muted-foreground">Vendible por staff en Venue App — nunca aparece en la compra online pública.</p>
            </div>
            <Switch checked={isDoorEntry} onCheckedChange={setIsDoorEntry} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Orders / Tickets / Attendance (sin cambios funcionales) ─────────────────

function OrdersSection({ orders, onChanged }: { orders: Array<{ id: number; provider: string | null; totalCents: number; currency: string; status: string }>; onChanged: () => void }) {
  const cancelOrderMut = trpc.eventTicketing.cancelOrder.useMutation({ onSuccess: () => { toast.success("Pedido cancelado"); onChanged(); } });
  const refundOrderMut = trpc.eventTicketing.refundOrder.useMutation({ onSuccess: res => { toast.success(res.reconciliationRequired ? "Requiere revisión manual" : "Reembolsado"); onChanged(); } });

  return (
    <section>
      <h3 className="text-sm font-semibold mb-2">Orders ({orders.length})</h3>
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-4 text-center">Sin pedidos todavía.</p>
      ) : (
        <div className="space-y-1.5">
          {orders.map(o => (
            <div key={o.id} className="flex items-center justify-between gap-3 text-sm border border-border rounded-lg px-3 py-2">
              <span className="text-muted-foreground">#{o.id} · {o.provider ?? "—"} · {(o.totalCents / 100).toFixed(2)} {o.currency}</span>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={ORDER_STATUS_VARIANT[o.status] ?? "outline"}>{o.status}</Badge>
                {(o.status === "pending" || o.status === "awaiting_payment") && (
                  <Button size="sm" variant="outline" className="h-7 px-2" disabled={cancelOrderMut.isPending} onClick={() => cancelOrderMut.mutate({ orderId: o.id })}>
                    <Ban className="w-3.5 h-3.5" />
                  </Button>
                )}
                {o.status === "paid" && (
                  <Button size="sm" variant="outline" className="h-7 px-2" disabled={refundOrderMut.isPending} onClick={() => { const reason = prompt("Motivo del reembolso:"); if (reason) refundOrderMut.mutate({ orderId: o.id, reason }); }}>
                    <RotateCcw className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TicketsSection({ tickets }: { tickets: Array<{ id: number; salesChannel: string; provider: string | null; status: string }> }) {
  return (
    <section>
      <h3 className="text-sm font-semibold mb-2">Tickets ({tickets.length})</h3>
      {tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-4 text-center">Sin entradas emitidas todavía.</p>
      ) : (
        <div className="space-y-1.5">
          {tickets.map(tk => (
            <div key={tk.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
              <span className="text-muted-foreground">#{tk.id} · {tk.salesChannel} · {tk.provider ?? "—"}</span>
              <Badge variant={tk.status === "used" ? "secondary" : tk.status === "issued" ? "default" : "outline"}>{tk.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AttendanceSection({ eventId }: { eventId: number }) {
  const { data: attendance, isLoading } = trpc.eventTicketing.listEventAttendance.useQuery({ eventId });
  return (
    <section>
      <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Users className="w-4 h-4" /> Attendance</h3>
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : !attendance?.length ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-4 text-center">Sin asistencia registrada todavía.</p>
      ) : (
        <div className="space-y-1.5">
          {attendance.map(a => (
            <div key={a.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
              <span className="text-muted-foreground">Usuario #{a.userId} · {a.provider}</span>
              <span className="text-xs text-muted-foreground">{new Date(a.occurredAt).toLocaleString("es-ES")}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
