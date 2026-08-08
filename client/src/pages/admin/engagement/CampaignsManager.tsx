import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Megaphone, Loader2, Send, CalendarClock, Ban, ChevronLeft, ChevronRight } from "lucide-react";
import { AudienceFilterBuilder, EMPTY_AUDIENCE_FORM, toAudienceDefinition, type AudienceDefinitionForm } from "@/components/admin/engagement/AudienceFilterBuilder";

type Channel = "email" | "push" | "whatsapp";
const OPTIONAL_CHANNELS: { key: Channel; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "push", label: "Push" },
  { key: "whatsapp", label: "WhatsApp" },
];

const STEPS = ["Audiencia", "Mensaje", "Canales", "Revisión"] as const;

interface MessageForm {
  category: "events" | "rewards" | "benefits" | "promotions" | "account";
  titleEn: string; titleEs: string; bodyEn: string; bodyEs: string; deepLink: string;
}
const EMPTY_MESSAGE: MessageForm = { category: "promotions", titleEn: "", titleEs: "", bodyEn: "", bodyEs: "", deepLink: "" };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", scheduled: "secondary", running: "default", completed: "default", cancelled: "destructive",
};

/**
 * Campañas de Engagement — /admin/engagement/campaigns (Fase 7, spec puntos
 * 70-71). Crear SIEMPRE deja la campaña en draft — programar/enviar/cancelar
 * son acciones explícitas y separadas desde la lista, nunca automáticas al
 * crear (spec punto 23: "creating a campaign must never send anything").
 */
export default function CampaignsManager() {
  const utils = trpc.useUtils();
  const { data: campaigns, isLoading } = trpc.engagement.listCampaigns.useQuery();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [audience, setAudience] = useState<AudienceDefinitionForm>(EMPTY_AUDIENCE_FORM);
  const [message, setMessage] = useState<MessageForm>(EMPTY_MESSAGE);
  const [channels, setChannels] = useState<Set<Channel>>(new Set());

  const [scheduleTarget, setScheduleTarget] = useState<number | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");

  const createMut = trpc.engagement.createCampaign.useMutation({
    onSuccess: () => { utils.engagement.listCampaigns.invalidate(); toast.success("Campaña creada como borrador"); closeWizard(); },
    onError: e => toast.error(e.message),
  });
  const scheduleMut = trpc.engagement.scheduleCampaign.useMutation({
    onSuccess: () => { utils.engagement.listCampaigns.invalidate(); toast.success("Campaña programada"); setScheduleTarget(null); },
    onError: e => toast.error(e.message),
  });
  const cancelMut = trpc.engagement.cancelCampaign.useMutation({
    onSuccess: () => { utils.engagement.listCampaigns.invalidate(); toast.success("Campaña cancelada"); },
    onError: e => toast.error(e.message),
  });
  const sendNowMut = trpc.engagement.sendCampaignNow.useMutation({
    onSuccess: res => { utils.engagement.listCampaigns.invalidate(); toast.success(`Enviada a ${res.notified} usuario(s)`); },
    onError: e => toast.error(e.message),
  });

  function openWizard() {
    setName(""); setAudience(EMPTY_AUDIENCE_FORM); setMessage(EMPTY_MESSAGE); setChannels(new Set()); setStep(0);
    setWizardOpen(true);
  }
  function closeWizard() { setWizardOpen(false); }

  function handleCreate() {
    if (!name.trim()) { toast.error("El nombre es obligatorio"); return; }
    if (!message.titleEn.trim() || !message.titleEs.trim() || !message.bodyEn.trim() || !message.bodyEs.trim()) {
      toast.error("Título y cuerpo (EN/ES) son obligatorios");
      return;
    }
    const messages = [
      { channel: "in_app" as const, category: message.category, titleEn: message.titleEn, titleEs: message.titleEs, bodyEn: message.bodyEn, bodyEs: message.bodyEs, deepLink: message.deepLink || undefined },
      ...Array.from(channels).map(channel => ({
        channel, category: message.category, titleEn: message.titleEn, titleEs: message.titleEs, bodyEn: message.bodyEn, bodyEs: message.bodyEs, deepLink: message.deepLink || undefined,
      })),
    ];
    createMut.mutate({ name, type: "manual", communityId: null, audienceDefinition: toAudienceDefinition(audience), messages });
  }

  return (
    <AdminLayout title="Campañas de Engagement">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Megaphone className="w-6 h-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Campañas</h2>
              <p className="text-sm text-muted-foreground">Mensajería manual/programada por audiencia — nunca se envía nada al crear.</p>
            </div>
          </div>
          <Button onClick={openWizard}><Plus className="w-4 h-4 mr-2" /> Nueva campaña</Button>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : !campaigns || campaigns.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Sin campañas todavía.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Programada</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.type}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[c.status] ?? "outline"}>{c.status}</Badge></TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.scheduledAt ? new Date(c.scheduledAt).toLocaleString("es-ES") : "—"}</TableCell>
                    <TableCell className="flex justify-end gap-2">
                      {c.status === "draft" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setScheduleTarget(c.id)}><CalendarClock className="size-3.5 mr-1" /> Programar</Button>
                          <Button size="sm" variant="outline" onClick={() => { if (confirm(`¿Enviar "${c.name}" ahora a la audiencia resuelta?`)) sendNowMut.mutate({ id: c.id }); }}>
                            <Send className="size-3.5 mr-1" /> Enviar ya
                          </Button>
                        </>
                      )}
                      {(c.status === "draft" || c.status === "scheduled") && (
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => { if (confirm(`¿Cancelar "${c.name}"?`)) cancelMut.mutate({ id: c.id }); }}>
                          <Ban className="size-3.5 mr-1" /> Cancelar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Wizard de creación — Audiencia → Mensaje → Canales → Revisión */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva campaña — {STEPS[step]} ({step + 1}/{STEPS.length})</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {step === 0 && (
              <>
                <div><Label>Nombre de la campaña *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Promo apertura curso IE" /></div>
                <AudienceFilterBuilder value={audience} onChange={setAudience} />
              </>
            )}

            {step === 1 && (
              <>
                <div>
                  <Label>Categoría</Label>
                  <Select value={message.category} onValueChange={v => setMessage(m => ({ ...m, category: v as MessageForm["category"] }))}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="events">Eventos</SelectItem>
                      <SelectItem value="rewards">Recompensas</SelectItem>
                      <SelectItem value="benefits">Beneficios</SelectItem>
                      <SelectItem value="promotions">Promociones</SelectItem>
                      <SelectItem value="account">Cuenta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Título (EN) *</Label><Input value={message.titleEn} onChange={e => setMessage(m => ({ ...m, titleEn: e.target.value }))} /></div>
                  <div><Label>Título (ES) *</Label><Input value={message.titleEs} onChange={e => setMessage(m => ({ ...m, titleEs: e.target.value }))} /></div>
                  <div><Label>Cuerpo (EN) *</Label><Textarea rows={3} value={message.bodyEn} onChange={e => setMessage(m => ({ ...m, bodyEn: e.target.value }))} /></div>
                  <div><Label>Cuerpo (ES) *</Label><Textarea rows={3} value={message.bodyEs} onChange={e => setMessage(m => ({ ...m, bodyEs: e.target.value }))} /></div>
                </div>
                <div>
                  <Label>Deep link (opcional)</Label>
                  <Input value={message.deepLink} onChange={e => setMessage(m => ({ ...m, deepLink: e.target.value }))} placeholder="/ie/explore" />
                  <p className="mt-1 text-xs text-muted-foreground">Solo rutas internas conocidas — cualquier otra se descarta en el servidor.</p>
                </div>
              </>
            )}

            {step === 2 && (
              <div>
                <Label className="mb-2 block">Canales adicionales (in-app siempre se entrega)</Label>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Checkbox checked disabled /> In-app
                  </label>
                  {OPTIONAL_CHANNELS.map(ch => (
                    <label key={ch.key} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        checked={channels.has(ch.key)}
                        onCheckedChange={() => setChannels(prev => {
                          const next = new Set(prev);
                          if (next.has(ch.key)) next.delete(ch.key); else next.add(ch.key);
                          return next;
                        })}
                      />
                      {ch.label}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Un canal solo entregará de verdad si su provider está configurado y su kill switch está activo — si no, la entrega queda "skipped".
                </p>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3 text-sm">
                <p><span className="text-muted-foreground">Nombre:</span> <span className="font-medium text-foreground">{name || "—"}</span></p>
                <p><span className="text-muted-foreground">Canales:</span> in_app{Array.from(channels).map(c => `, ${c}`).join("")}</p>
                <p><span className="text-muted-foreground">Título (EN):</span> {message.titleEn || "—"}</p>
                <p><span className="text-muted-foreground">Título (ES):</span> {message.titleEs || "—"}</p>
                <AudienceFilterBuilder value={audience} onChange={setAudience} />
              </div>
            )}
          </div>

          <DialogFooter className="justify-between sm:justify-between">
            <Button variant="ghost" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>
              <ChevronLeft className="size-4 mr-1" /> Atrás
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}>Siguiente <ChevronRight className="size-4 ml-1" /></Button>
            ) : (
              <Button onClick={handleCreate} disabled={createMut.isPending}>
                {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : "Crear borrador"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Programar */}
      <Dialog open={scheduleTarget !== null} onOpenChange={o => !o && setScheduleTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Programar envío</DialogTitle></DialogHeader>
          <div className="py-2">
            <Label>Fecha y hora (Europe/Madrid)</Label>
            <Input type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleTarget(null)}>Cancelar</Button>
            <Button
              disabled={!scheduleAt || scheduleMut.isPending}
              onClick={() => scheduleTarget != null && scheduleMut.mutate({ id: scheduleTarget, scheduledAt: new Date(scheduleAt) })}
            >
              Programar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
