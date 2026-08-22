import { useState, useMemo } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Mail, MessageSquare, Bell, Smartphone, Search } from "lucide-react";
import { InfoTooltip } from "@/components/ui/info-tooltip";

const ADMIN_CATEGORIES = ["ACCOUNT", "SECURITY", "COMMUNITY", "EVENTS", "TICKETING", "SEGOTOKENS", "BENEFITS", "PLAN_AND_PLAY", "ENGAGEMENT", "SYSTEM"] as const;

/**
 * SEGOLIFE Communication Center — /admin/plantillas-email y
 * /admin/engagement/templates apuntan AMBAS a este mismo componente (spec:
 * "exclusivamente comunicaciones SEGOLIFE"). Solo lectura — la gestión real
 * vive en código/versionado (server/segolife/engagement/templates.ts, spec
 * punto 78). El legacy EmailTemplatesManager.tsx (Náyade/Skicenter) queda
 * archivado sin ruta ni entrada de menú, código intacto sin borrar.
 */
export default function TemplatesViewer() {
  const { data: templates, isLoading } = trpc.engagement.listTemplates.useQuery();
  const { data: providerStatus } = trpc.engagement.getProviderStatus.useQuery();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return (templates ?? []).filter(t => {
      if (categoryFilter !== "all" && t.adminCategory !== categoryFilter) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (channelFilter !== "all" && !t.channels.includes(channelFilter as "in_app" | "email" | "push" | "whatsapp")) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!t.key.includes(q) && !t.titleEn.toLowerCase().includes(q) && !t.titleEs.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [templates, search, categoryFilter, statusFilter, channelFilter]);

  const selected = (templates ?? []).find(t => t.key === selectedKey) ?? null;

  return (
    <AdminLayout title="Communication Center">
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">SEGOLIFE Communication Center</h2>
          <p className="text-sm text-muted-foreground">Catálogo de comunicaciones — email + in-app hoy, WhatsApp vía GHL preparado. Definidas en código y versionadas por commit.</p>
        </div>

        {/* ── Estado de providers ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ProviderCard icon={Mail} label="Email" status={providerStatus?.email.label} configured={providerStatus?.email.configured} />
          <ProviderCard icon={Bell} label="In-App" status={providerStatus?.inApp.label} configured={providerStatus?.inApp.configured} />
          <ProviderCard icon={MessageSquare} label="WhatsApp (GHL)" status={providerStatus?.whatsapp.label} configured={providerStatus?.whatsapp.configured} />
          <ProviderCard icon={Smartphone} label="Push" status={providerStatus?.push.label} configured={providerStatus?.push.configured} />
        </div>

        {/* ── Filtros ── */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>
            Cada plantilla es <strong>Transaccional</strong> (siempre se envía, el estudiante nunca puede desactivarla) o <strong>Marketing</strong>{" "}
            (respeta su preferencia de opt-out por canal). "Preparada" = contenido listo pero sin ningún disparador real conectado todavía — nunca se envía.
          </span>
          <InfoTooltip text="Categorías (badge morado): agrupan las plantillas por área de producto para navegar más fácil, es solo presentación — nunca cambia cómo se envía nada. Canal In-App siempre se intenta; Email solo si hay remitente configurado; WhatsApp/Push muestran '(futuro)' mientras no haya proveedor real activado." />
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Categoría" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              {ADMIN_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace("_", " & ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Activas + preparadas</SelectItem>
              <SelectItem value="active">Activas</SelectItem>
              <SelectItem value="prepared">Preparadas (V2)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Canal" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los canales</SelectItem>
              <SelectItem value="in_app">In-App</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="whatsapp">WhatsApp (futuro)</SelectItem>
              <SelectItem value="push">Push (futuro)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map(t => (
              <button key={t.key} onClick={() => setSelectedKey(t.key)} className="text-left rounded-lg border border-border bg-card p-4 space-y-2 hover:border-primary transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-medium text-foreground truncate">{t.key}</span>
                  <Badge variant="outline" className="shrink-0">v{t.version}</Badge>
                </div>
                <p className="text-sm font-medium text-foreground">{t.titleEn}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{t.adminCategory}</Badge>
                  <Badge variant={t.audienceType === "transactional" ? "default" : "secondary"}>{t.audienceType}</Badge>
                  <Badge variant={t.status === "active" ? "default" : "outline"}>{t.status === "active" ? "Active" : "Prepared"}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.channels.map(c => <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}
                </div>
              </button>
            ))}
            {filtered.length === 0 && <p className="text-sm text-muted-foreground col-span-full text-center py-8">Sin resultados con estos filtros.</p>}
          </div>
        )}
      </div>

      {selected && <TemplateDetailDialog template={selected} onClose={() => setSelectedKey(null)} />}
    </AdminLayout>
  );
}

function ProviderCard({ icon: Icon, label, status, configured }: { icon: React.ElementType; label: string; status?: string; configured?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 flex items-center gap-2.5">
      <Icon className="size-4 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className={`text-[11px] ${configured ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{status ?? "…"}</p>
      </div>
    </div>
  );
}

interface TemplateRow {
  key: string; version: number; adminCategory: string; audienceType: string; status: string;
  description: string; triggerEvent: string; channels: string[];
  titleEn: string; titleEs: string; bodyEn: string; bodyEs: string;
  subjectEn?: string; subjectEs?: string; allowedVariables: string[];
}

function TemplateDetailDialog({ template, onClose }: { template: TemplateRow; onClose: () => void }) {
  const { data: preview, isLoading } = trpc.engagement.previewTemplate.useQuery({ templateKey: template.key });
  const [testEmail, setTestEmail] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const sendTestMut = trpc.engagement.sendTestForTemplate.useMutation({
    // El toast SOLO puede ser de éxito si el provider (Brevo) confirmó el
    // envío — `data.ok` refleja el resultado real, nunca solo que la
    // mutation resolvió sin lanzar (diagnóstico Brevo transactional, 2026-08-15).
    onSuccess: data => {
      if (data.ok) {
        toast.success(`Enviado vía Brevo a ${testEmail}${data.externalMessageId ? ` (messageId: ${data.externalMessageId})` : ""}`);
        setConfirmSend(false);
      } else {
        toast.error(data.message ?? "El envío falló");
      }
    },
    onError: e => toast.error(e.message),
  });

  const supportsEmail = template.channels.includes("email");

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{template.key}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{template.adminCategory}</Badge>
            <Badge variant={template.audienceType === "transactional" ? "default" : "secondary"}>{template.audienceType}</Badge>
            <Badge variant={template.status === "active" ? "default" : "outline"}>{template.status === "active" ? "Active" : "Prepared (V2)"}</Badge>
            {template.channels.map(c => <Badge key={c} variant="outline">{c}</Badge>)}
          </div>
          <p className="text-sm text-muted-foreground">{template.description}</p>
          <p className="text-xs text-muted-foreground">Trigger: <span className="font-mono">{template.triggerEvent}</span></p>
          {template.allowedVariables.length > 0 && (
            <p className="text-xs text-muted-foreground">Variables: {template.allowedVariables.map(v => `{{${v}}}`).join(", ")}</p>
          )}

          {isLoading ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : preview ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">English</p>
                {preview.subjectEn && <p className="text-sm"><span className="text-muted-foreground">Subject: </span>{preview.subjectEn}</p>}
                <p className="text-sm font-medium">{preview.titleEn}</p>
                <p className="text-sm text-muted-foreground">{preview.bodyEn}</p>
                {preview.emailHtmlEn && (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <iframe title="preview-en" srcDoc={preview.emailHtmlEn} className="w-full h-[420px] bg-white" />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Español</p>
                {preview.subjectEs && <p className="text-sm"><span className="text-muted-foreground">Asunto: </span>{preview.subjectEs}</p>}
                <p className="text-sm font-medium">{preview.titleEs}</p>
                <p className="text-sm text-muted-foreground">{preview.bodyEs}</p>
                {preview.emailHtmlEs && (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <iframe title="preview-es" srcDoc={preview.emailHtmlEs} className="w-full h-[420px] bg-white" />
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {supportsEmail && (
            <div className="border-t border-border pt-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Enviar prueba</p>
              <p className="text-xs text-muted-foreground">Solo funciona si el email provider está configurado. Nunca se envía a estudiantes reales — elige explícitamente el destino.</p>
              <div className="flex gap-2">
                <Input placeholder="tu@email.com" value={testEmail} onChange={e => setTestEmail(e.target.value)} className="max-w-xs" />
                {!confirmSend ? (
                  <Button variant="outline" disabled={!testEmail} onClick={() => setConfirmSend(true)}>Enviar prueba</Button>
                ) : (
                  <>
                    <Button variant="destructive" disabled={sendTestMut.isPending} onClick={() => sendTestMut.mutate({ templateKey: template.key, testEmail })}>
                      {sendTestMut.isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : null} Confirmar envío a {testEmail}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmSend(false)}>Cancelar</Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
