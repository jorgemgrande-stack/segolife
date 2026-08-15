import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Gift, Loader2, Plus, Pencil, ShieldAlert, Ban } from "lucide-react";
import { useAdminCommunity } from "@/contexts/AdminCommunityContext";
import { ADMIN_COMMUNITY_FILTER_ALL } from "@shared/segolife/adminCommunityFilter";
import ImageUploader from "@/components/ImageUploader";

const ALL = "__all__";
const NONE = "__none__";

function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const BENEFIT_TYPE_LABEL: Record<string, string> = {
  free_entry: "Entrada gratis", free_product: "Producto gratis", discount_percentage: "Descuento %",
  discount_fixed: "Descuento fijo", vip_access: "Acceso VIP", priority_access: "Acceso prioritario",
  upgrade: "Upgrade", custom: "Personalizado",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default", used: "secondary", expired: "outline", cancelled: "destructive",
};

function toggleSet(set: Set<number>, setter: (s: Set<number>) => void, id: number) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  setter(next);
}

// ─── DEFINICIONES ────────────────────────────────────────────────────────────

interface DefinitionForm {
  name: string; slug: string; description: string; benefitType: string;
  destinationVenueId: string; destinationEventId: string;
  discountType: string; discountValue: string;
  imageUrl: string; nameEn: string; nameEs: string; descriptionEn: string; descriptionEs: string;
  termsEn: string; termsEs: string;
  tokenCost: string; isMarketplaceEnabled: boolean;
  marketplaceInventoryTotal: string; perStudentPurchaseLimit: string;
  purchaseWindowStart: string; purchaseWindowEnd: string; redemptionValidityDays: string;
}
const emptyDefinitionForm: DefinitionForm = {
  name: "", slug: "", description: "", benefitType: "free_entry",
  destinationVenueId: NONE, destinationEventId: NONE,
  discountType: NONE, discountValue: "",
  imageUrl: "", nameEn: "", nameEs: "", descriptionEn: "", descriptionEs: "", termsEn: "", termsEs: "",
  tokenCost: "", isMarketplaceEnabled: false,
  marketplaceInventoryTotal: "", perStudentPurchaseLimit: "",
  purchaseWindowStart: "", purchaseWindowEnd: "", redemptionValidityDays: "",
};

function DefinitionsTab() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<DefinitionForm>(emptyDefinitionForm);
  const [communityIds, setCommunityIds] = useState<Set<number>>(new Set());

  const { data: definitions, isLoading } = trpc.benefits.listDefinitions.useQuery();
  const { data: communities } = trpc.communities.list.useQuery();
  const { data: venues } = trpc.venues.publicActive.useQuery({});
  const { data: events } = trpc.events.publicActive.useQuery({});

  const createMut = trpc.benefits.createDefinition.useMutation({
    onSuccess: async (res) => {
      await communitiesMut.mutateAsync({ id: res.definition.id, communityIds: Array.from(communityIds) });
      utils.benefits.listDefinitions.invalidate(); toast.success("Definición creada"); setOpen(false);
    },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.benefits.updateDefinition.useMutation({
    onSuccess: async () => {
      if (editId) await communitiesMut.mutateAsync({ id: editId, communityIds: Array.from(communityIds) });
      utils.benefits.listDefinitions.invalidate(); toast.success("Definición actualizada"); setOpen(false);
    },
    onError: e => toast.error(e.message),
  });
  const communitiesMut = trpc.benefits.setDefinitionCommunities.useMutation({ onError: e => toast.error(e.message) });
  const setActiveMut = trpc.benefits.setDefinitionActive.useMutation({
    onSuccess: () => utils.benefits.listDefinitions.invalidate(),
    onError: e => toast.error(e.message),
  });

  const openCreate = () => { setEditId(null); setForm(emptyDefinitionForm); setCommunityIds(new Set()); setOpen(true); };
  const openEdit = async (id: number) => {
    const def = await utils.benefits.getDefinitionById.fetch({ id });
    setEditId(id);
    setForm({
      name: def.name, slug: def.slug, description: def.description ?? "", benefitType: def.benefitType,
      destinationVenueId: def.destinationVenueId != null ? String(def.destinationVenueId) : NONE,
      destinationEventId: def.destinationEventId != null ? String(def.destinationEventId) : NONE,
      discountType: def.discountType ?? NONE, discountValue: def.discountValue != null ? String(def.discountValue) : "",
      imageUrl: def.imageUrl ?? "", nameEn: def.nameEn ?? "", nameEs: def.nameEs ?? "",
      descriptionEn: def.descriptionEn ?? "", descriptionEs: def.descriptionEs ?? "",
      termsEn: def.termsEn ?? "", termsEs: def.termsEs ?? "",
      tokenCost: def.tokenCost != null ? String(def.tokenCost) : "",
      isMarketplaceEnabled: def.isMarketplaceEnabled ?? false,
      marketplaceInventoryTotal: def.marketplaceInventoryTotal != null ? String(def.marketplaceInventoryTotal) : "",
      perStudentPurchaseLimit: def.perStudentPurchaseLimit != null ? String(def.perStudentPurchaseLimit) : "",
      purchaseWindowStart: def.purchaseWindowStart ? new Date(def.purchaseWindowStart).toISOString().slice(0, 16) : "",
      purchaseWindowEnd: def.purchaseWindowEnd ? new Date(def.purchaseWindowEnd).toISOString().slice(0, 16) : "",
      redemptionValidityDays: def.redemptionValidityDays != null ? String(def.redemptionValidityDays) : "",
    });
    setCommunityIds(new Set(def.communityIds));
    setOpen(true);
  };

  const buildPayload = () => ({
    name: form.name, slug: form.slug, description: form.description || undefined,
    benefitType: form.benefitType as any,
    destinationVenueId: form.destinationVenueId !== NONE ? Number(form.destinationVenueId) : null,
    destinationEventId: form.destinationEventId !== NONE ? Number(form.destinationEventId) : null,
    discountType: form.discountType !== NONE ? (form.discountType as "percentage" | "fixed") : null,
    discountValue: form.discountValue ? Number(form.discountValue) : null,
    imageUrl: form.imageUrl || undefined,
    nameEn: form.nameEn || undefined, nameEs: form.nameEs || undefined,
    descriptionEn: form.descriptionEn || undefined, descriptionEs: form.descriptionEs || undefined,
    termsEn: form.termsEn || undefined, termsEs: form.termsEs || undefined,
    tokenCost: form.tokenCost ? Number(form.tokenCost) : null,
    isMarketplaceEnabled: form.isMarketplaceEnabled,
    marketplaceInventoryTotal: form.marketplaceInventoryTotal ? Number(form.marketplaceInventoryTotal) : null,
    perStudentPurchaseLimit: form.perStudentPurchaseLimit ? Number(form.perStudentPurchaseLimit) : null,
    purchaseWindowStart: form.purchaseWindowStart ? new Date(form.purchaseWindowStart) : null,
    purchaseWindowEnd: form.purchaseWindowEnd ? new Date(form.purchaseWindowEnd) : null,
    redemptionValidityDays: form.redemptionValidityDays ? Number(form.redemptionValidityDays) : null,
  });

  const handleSubmit = () => {
    if (!form.name.trim() || !form.slug.trim()) { toast.error("Nombre y slug son obligatorios"); return; }
    if (form.isMarketplaceEnabled && (!form.tokenCost || Number(form.tokenCost) <= 0)) {
      toast.error("Para habilitar el marketplace, indica un coste en SegoTokens mayor que 0"); return;
    }
    if (editId) updateMut.mutate({ id: editId, ...buildPayload() });
    else createMut.mutate(buildPayload());
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Nueva definición</Button>
      </div>
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !definitions || definitions.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Sin definiciones todavía.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead><TableHead>Tipo</TableHead><TableHead>Destino</TableHead>
                <TableHead>Slug</TableHead><TableHead>Marketplace</TableHead><TableHead>Activa</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {definitions.map(d => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium text-foreground">{d.name}</TableCell>
                  <TableCell><Badge variant="secondary">{BENEFIT_TYPE_LABEL[d.benefitType] ?? d.benefitType}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{(venues ?? []).find(v => v.id === d.destinationVenueId)?.name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{d.slug}</TableCell>
                  <TableCell>{d.isMarketplaceEnabled ? <Badge variant="outline">{d.tokenCost} ST</Badge> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                  <TableCell><Switch checked={d.active} onCheckedChange={v => setActiveMut.mutate({ id: d.id, active: v })} /></TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => openEdit(d.id)}><Pencil className="w-3.5 h-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Editar definición" : "Nueva definición"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Nombre (interno) *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><Label>Slug *</Label><Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="entrada-casanova" /></div>
            </div>
            <div><Label>Descripción interna</Label><Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <ImageUploader
              label="Imagen (Student — Home/Benefit detail)"
              value={form.imageUrl}
              onChange={url => setForm(f => ({ ...f, imageUrl: url }))}
            />
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Tipo de beneficio *</Label>
                <Select value={form.benefitType} onValueChange={v => setForm(f => ({ ...f, benefitType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(BENEFIT_TYPE_LABEL).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Venue destino</Label>
                <Select value={form.destinationVenueId} onValueChange={v => setForm(f => ({ ...f, destinationVenueId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sin venue (agnóstico)</SelectItem>
                    {(venues ?? []).map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Evento destino</Label>
                <Select value={form.destinationEventId} onValueChange={v => setForm(f => ({ ...f, destinationEventId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sin evento</SelectItem>
                    {(events ?? []).map((ev: any) => <SelectItem key={ev.id} value={String(ev.id)}>{ev.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {(form.benefitType === "discount_percentage" || form.benefitType === "discount_fixed") && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Tipo de descuento</Label>
                  <Select value={form.discountType} onValueChange={v => setForm(f => ({ ...f, discountType: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      <SelectItem value="percentage">Porcentaje</SelectItem>
                      <SelectItem value="fixed">Fijo (céntimos)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Valor ({form.discountType === "percentage" ? "% entero" : "céntimos"})</Label><Input type="number" value={form.discountValue} onChange={e => setForm(f => ({ ...f, discountValue: e.target.value }))} /></div>
              </div>
            )}
            <div>
              <Label className="block mb-2">Comunidades (vacío = cualquiera)</Label>
              <div className="flex flex-wrap gap-3">
                {(communities ?? []).map(c => (
                  <label key={c.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={communityIds.has(c.id)} onCheckedChange={() => toggleSet(communityIds, setCommunityIds, c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-3 pt-3 border-t border-border">
              <div className="flex items-center justify-between">
                <Label className="mb-0">Canjeable con SegoTokens (marketplace)</Label>
                <Switch checked={form.isMarketplaceEnabled} onCheckedChange={v => setForm(f => ({ ...f, isMarketplaceEnabled: v }))} />
              </div>
              {form.isMarketplaceEnabled && (
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Coste en SegoTokens *</Label><Input type="number" min={1} value={form.tokenCost} onChange={e => setForm(f => ({ ...f, tokenCost: e.target.value }))} /></div>
                  <div><Label>Validez tras canje (días)</Label><Input type="number" min={1} placeholder="Sin caducidad" value={form.redemptionValidityDays} onChange={e => setForm(f => ({ ...f, redemptionValidityDays: e.target.value }))} /></div>
                  <div><Label>Stock total</Label><Input type="number" min={1} placeholder="Ilimitado" value={form.marketplaceInventoryTotal} onChange={e => setForm(f => ({ ...f, marketplaceInventoryTotal: e.target.value }))} /></div>
                  <div><Label>Límite por Student</Label><Input type="number" min={1} placeholder="Ilimitado" value={form.perStudentPurchaseLimit} onChange={e => setForm(f => ({ ...f, perStudentPurchaseLimit: e.target.value }))} /></div>
                  <div><Label>Disponible desde</Label><Input type="datetime-local" value={form.purchaseWindowStart} onChange={e => setForm(f => ({ ...f, purchaseWindowStart: e.target.value }))} /></div>
                  <div><Label>Disponible hasta</Label><Input type="datetime-local" value={form.purchaseWindowEnd} onChange={e => setForm(f => ({ ...f, purchaseWindowEnd: e.target.value }))} /></div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
              <div><Label>Nombre EN</Label><Input value={form.nameEn} onChange={e => setForm(f => ({ ...f, nameEn: e.target.value }))} placeholder="Free entry Casanova" /></div>
              <div><Label>Nombre ES</Label><Input value={form.nameEs} onChange={e => setForm(f => ({ ...f, nameEs: e.target.value }))} placeholder="Entrada gratis Casanova" /></div>
              <div><Label>Descripción EN</Label><Textarea rows={2} value={form.descriptionEn} onChange={e => setForm(f => ({ ...f, descriptionEn: e.target.value }))} /></div>
              <div><Label>Descripción ES</Label><Textarea rows={2} value={form.descriptionEs} onChange={e => setForm(f => ({ ...f, descriptionEs: e.target.value }))} /></div>
              <div><Label>Términos EN</Label><Textarea rows={2} value={form.termsEn} onChange={e => setForm(f => ({ ...f, termsEn: e.target.value }))} /></div>
              <div><Label>Términos ES</Label><Textarea rows={2} value={form.termsEs} onChange={e => setForm(f => ({ ...f, termsEs: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>{editId ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── REGLAS ──────────────────────────────────────────────────────────────────

interface RuleForm {
  name: string; description: string; sourceType: string;
  sourceVenueId: string; sourceEventId: string; sourceProductId: string; communityId: string;
  minAmountCents: string; recurrenceWindow: string;
  aggregateMetric: string; aggregateThreshold: string;
  conditionStartTime: string; conditionEndTime: string;
  startsAt: string; endsAt: string; priority: string;
  benefitDefinitionId: string; quantity: string;
  validityType: string; validityOffsetMinutes: string; validityDurationMinutes: string;
  validityStartTime: string; validityEndTime: string; validityDaysOffset: string;
  maxPerUser: string; maxPerDay: string; maxTotal: string;
  oncePerOrigin: boolean; oncePerRule: boolean;
}
const emptyRuleForm: RuleForm = {
  name: "", description: "", sourceType: "consumption",
  sourceVenueId: NONE, sourceEventId: NONE, sourceProductId: NONE, communityId: NONE,
  minAmountCents: "", recurrenceWindow: NONE,
  aggregateMetric: NONE, aggregateThreshold: "",
  conditionStartTime: "", conditionEndTime: "",
  startsAt: "", endsAt: "", priority: "0",
  benefitDefinitionId: "", quantity: "1",
  validityType: "immediate", validityOffsetMinutes: "", validityDurationMinutes: "",
  validityStartTime: "", validityEndTime: "", validityDaysOffset: "",
  maxPerUser: "", maxPerDay: "", maxTotal: "",
  oncePerOrigin: false, oncePerRule: false,
};
const SOURCE_TYPE_LABEL: Record<string, string> = {
  consumption: "Consumición", consumption_product: "Consumición de producto", venue_visit: "Visita a venue",
  event_attendance: "Asistencia a evento", token_earning: "Ganancia de tokens", recurrence: "Recurrencia",
  campaign: "Campaña", manual: "Manual", ticket: "Ticket", future_external: "Externo futuro",
};
/**
 * SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6): solo estos
 * sourceType tienen un productor real que las dispare (ver auditoría de
 * fase) — consumption_product/token_earning/recurrence/campaign/
 * future_external existen en el enum de BD pero ningún módulo las emite
 * todavía, y "manual" tampoco pasa nunca por evaluateBenefitsForOrigin (la
 * concesión manual llama a grantBenefit directamente, ver manualGrant).
 * Ofrecerlas en el selector crearía reglas silenciosamente muertas — se
 * ocultan de "Nueva regla" (nunca del histórico: una regla ya creada con
 * uno de esos tipos se sigue mostrando/editando igual).
 */
const WIRED_SOURCE_TYPES = ["consumption", "event_attendance", "venue_visit", "ticket"];
const AGGREGATE_METRIC_LABEL: Record<string, string> = {
  attendance_count: "Nº de asistencias a eventos",
  venue_visit_count: "Nº de visitas al venue",
  distinct_venues: "Nº de venues distintos visitados",
  commerce_count: "Nº de compras confirmadas",
  commerce_quantity: "Nº de unidades compradas",
  spend_cents: "Importe gastado (céntimos)",
};
const AGGREGATE_METRIC_SUPPORTS_VENUE: Record<string, boolean> = {
  attendance_count: true, venue_visit_count: true, distinct_venues: false, commerce_count: true, commerce_quantity: true, spend_cents: true,
};
const WINDOW_LABEL: Record<string, string> = { day: "esta noche", week: "esta semana", month: "este mes" };

/** SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6, spec §21): resumen legible antes de activar — evita errores de configuración que un formulario de campos sueltos no deja ver de un vistazo. */
function buildRulePreview(form: RuleForm, venueName: (id: string) => string | null, definitionName: (id: string) => string | null): string {
  const parts: string[] = ["Cuando un Student"];
  const originLabel = SOURCE_TYPE_LABEL[form.sourceType]?.toLowerCase() ?? form.sourceType;
  parts.push(originLabel + (form.sourceVenueId !== NONE ? ` en ${venueName(form.sourceVenueId) ?? "…"}` : ""));

  if (form.aggregateMetric !== NONE && form.aggregateThreshold) {
    const metricLabel = AGGREGATE_METRIC_LABEL[form.aggregateMetric]?.toLowerCase() ?? form.aggregateMetric;
    const windowLabel = WINDOW_LABEL[form.recurrenceWindow] ?? WINDOW_LABEL.day;
    parts.push(`, y alcanza ${form.aggregateThreshold} (${metricLabel}) ${windowLabel}`);
  }
  if (form.conditionStartTime && form.conditionEndTime) {
    parts.push(`, entre las ${form.conditionStartTime} y las ${form.conditionEndTime}`);
  }

  const benefitName = form.benefitDefinitionId ? (definitionName(form.benefitDefinitionId) ?? "…") : "…";
  parts.push(` → recibe automáticamente "${benefitName}"`);

  if (form.validityType === "day_anchored" && form.validityDaysOffset) {
    const days = Number(form.validityDaysOffset);
    parts.push(days === 0 ? " (válido esta misma noche" : days === 1 ? " (válido mañana" : ` (válido en ${days} días`);
    if (form.validityStartTime) parts.push(` desde las ${form.validityStartTime}`);
    if (form.validityEndTime) parts.push(` hasta las ${form.validityEndTime}`);
    parts.push(")");
  }

  const limits: string[] = [];
  if (form.oncePerRule) limits.push("máximo 1 vez por Student");
  if (form.maxPerUser) limits.push(`máx. ${form.maxPerUser} por Student`);
  if (form.maxTotal) limits.push(`máx. ${form.maxTotal} en total`);
  if (limits.length > 0) parts.push(`. Límite: ${limits.join(", ")}`);

  return parts.join("") + ".";
}

function RulesTab() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyRuleForm);
  const [statsRuleId, setStatsRuleId] = useState<number | null>(null);

  const { data: rules, isLoading } = trpc.benefits.listRules.useQuery();
  const { data: definitions } = trpc.benefits.listDefinitions.useQuery();
  const { data: venues } = trpc.venues.publicActive.useQuery({});
  const { data: communities } = trpc.communities.list.useQuery();

  const createMut = trpc.benefits.createRule.useMutation({
    onSuccess: () => { utils.benefits.listRules.invalidate(); toast.success("Regla creada"); setOpen(false); },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.benefits.updateRule.useMutation({
    onSuccess: () => { utils.benefits.listRules.invalidate(); toast.success("Regla actualizada"); setOpen(false); },
    onError: e => toast.error(e.message),
  });
  const setActiveMut = trpc.benefits.setRuleActive.useMutation({
    onSuccess: () => utils.benefits.listRules.invalidate(),
    onError: e => toast.error(e.message),
  });

  const openCreate = () => { setEditId(null); setForm(emptyRuleForm); setOpen(true); };
  const openEdit = (r: NonNullable<typeof rules>[number]) => {
    setEditId(r.id);
    setForm({
      name: r.name, description: r.description ?? "", sourceType: r.sourceType,
      sourceVenueId: r.sourceVenueId != null ? String(r.sourceVenueId) : NONE,
      sourceEventId: r.sourceEventId != null ? String(r.sourceEventId) : NONE,
      sourceProductId: r.sourceProductId != null ? String(r.sourceProductId) : NONE,
      communityId: r.communityId != null ? String(r.communityId) : NONE,
      minAmountCents: r.minAmountCents != null ? String(r.minAmountCents) : "",
      recurrenceWindow: r.recurrenceWindow ?? NONE,
      aggregateMetric: r.aggregateMetric ?? NONE,
      aggregateThreshold: r.aggregateThreshold != null ? String(r.aggregateThreshold) : "",
      conditionStartTime: r.conditionStartTime ?? "", conditionEndTime: r.conditionEndTime ?? "",
      startsAt: r.startsAt ? new Date(r.startsAt).toISOString().slice(0, 16) : "",
      endsAt: r.endsAt ? new Date(r.endsAt).toISOString().slice(0, 16) : "",
      priority: String(r.priority),
      benefitDefinitionId: String(r.benefitDefinitionId), quantity: String(r.quantity),
      validityType: r.validityType,
      validityOffsetMinutes: r.validityOffsetMinutes != null ? String(r.validityOffsetMinutes) : "",
      validityDurationMinutes: r.validityDurationMinutes != null ? String(r.validityDurationMinutes) : "",
      validityStartTime: r.validityStartTime ?? "", validityEndTime: r.validityEndTime ?? "",
      validityDaysOffset: r.validityDaysOffset != null ? String(r.validityDaysOffset) : "",
      maxPerUser: r.maxPerUser != null ? String(r.maxPerUser) : "",
      maxPerDay: r.maxPerDay != null ? String(r.maxPerDay) : "",
      maxTotal: r.maxTotal != null ? String(r.maxTotal) : "",
      oncePerOrigin: r.oncePerOrigin, oncePerRule: r.oncePerRule,
    });
    setOpen(true);
  };

  const buildPayload = () => ({
    name: form.name, description: form.description || undefined, sourceType: form.sourceType as any,
    sourceVenueId: form.sourceVenueId !== NONE ? Number(form.sourceVenueId) : null,
    sourceEventId: form.sourceEventId !== NONE ? Number(form.sourceEventId) : null,
    sourceProductId: form.sourceProductId !== NONE ? Number(form.sourceProductId) : null,
    communityId: form.communityId !== NONE ? Number(form.communityId) : null,
    minAmountCents: form.minAmountCents ? Number(form.minAmountCents) : null,
    recurrenceWindow: form.recurrenceWindow !== NONE ? (form.recurrenceWindow as "day" | "week" | "month") : null,
    aggregateMetric: form.aggregateMetric !== NONE ? (form.aggregateMetric as "attendance_count" | "venue_visit_count" | "distinct_venues" | "commerce_count" | "commerce_quantity" | "spend_cents") : null,
    aggregateThreshold: form.aggregateThreshold ? Number(form.aggregateThreshold) : null,
    conditionStartTime: form.conditionStartTime || null, conditionEndTime: form.conditionEndTime || null,
    startsAt: form.startsAt ? new Date(form.startsAt) : undefined,
    endsAt: form.endsAt ? new Date(form.endsAt) : undefined,
    priority: Number(form.priority) || 0,
    benefitDefinitionId: Number(form.benefitDefinitionId), quantity: Number(form.quantity) || 1,
    validityType: form.validityType as any,
    validityOffsetMinutes: form.validityOffsetMinutes ? Number(form.validityOffsetMinutes) : null,
    validityDurationMinutes: form.validityDurationMinutes ? Number(form.validityDurationMinutes) : null,
    validityStartTime: form.validityStartTime || null, validityEndTime: form.validityEndTime || null,
    validityDaysOffset: form.validityDaysOffset ? Number(form.validityDaysOffset) : null,
    maxPerUser: form.maxPerUser ? Number(form.maxPerUser) : null,
    maxPerDay: form.maxPerDay ? Number(form.maxPerDay) : null,
    maxTotal: form.maxTotal ? Number(form.maxTotal) : null,
    oncePerOrigin: form.oncePerOrigin, oncePerRule: form.oncePerRule,
  });

  const handleSubmit = () => {
    if (!form.name.trim() || !form.benefitDefinitionId) { toast.error("Nombre y definición de beneficio son obligatorios"); return; }
    if (editId) updateMut.mutate({ id: editId, ...buildPayload() });
    else createMut.mutate(buildPayload());
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Nueva regla</Button>
      </div>
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !rules || rules.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Sin reglas todavía.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead><TableHead>Origen</TableHead><TableHead>Beneficio</TableHead>
                <TableHead>Vigencia</TableHead><TableHead>Prioridad</TableHead><TableHead>Activa</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-foreground">{r.name}</TableCell>
                  <TableCell><Badge variant="secondary">{SOURCE_TYPE_LABEL[r.sourceType] ?? r.sourceType}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{(definitions ?? []).find(d => d.id === r.benefitDefinitionId)?.name ?? `#${r.benefitDefinitionId}`}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{r.validityType}</TableCell>
                  <TableCell className="text-muted-foreground">{r.priority}</TableCell>
                  <TableCell><Switch checked={r.active} onCheckedChange={v => setActiveMut.mutate({ id: r.id, active: v })} /></TableCell>
                  <TableCell className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setStatsRuleId(r.id)}>Resultados</Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Editar regla" : "Nueva regla"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Nombre *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Descripción</Label><Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>

            <p className="text-xs font-semibold text-muted-foreground uppercase pt-1">Origen</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tipo de origen *</Label>
                <Select value={form.sourceType} onValueChange={v => setForm(f => ({ ...f, sourceType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SOURCE_TYPE_LABEL)
                      .filter(([k]) => WIRED_SOURCE_TYPES.includes(k) || k === form.sourceType)
                      .map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!WIRED_SOURCE_TYPES.includes(form.sourceType) && (
                  <p className="text-xs text-amber-600 mt-1">Este origen no tiene ningún productor todavía — la regla nunca se disparará.</p>
                )}
              </div>
              <div>
                <Label>Venue origen (vacío = cualquiera)</Label>
                <Select value={form.sourceVenueId} onValueChange={v => setForm(f => ({ ...f, sourceVenueId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Cualquier venue</SelectItem>
                    {(venues ?? []).map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Comunidad origen</Label>
                <Select value={form.communityId} onValueChange={v => setForm(f => ({ ...f, communityId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Cualquiera</SelectItem>
                    {(communities ?? []).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Importe mínimo (céntimos)</Label><Input type="number" value={form.minAmountCents} onChange={e => setForm(f => ({ ...f, minAmountCents: e.target.value }))} /></div>
              <div><Label>Hora inicio condición (HH:MM)</Label><Input value={form.conditionStartTime} onChange={e => setForm(f => ({ ...f, conditionStartTime: e.target.value }))} placeholder="22:00" /></div>
              <div><Label>Hora fin condición (HH:MM)</Label><Input value={form.conditionEndTime} onChange={e => setForm(f => ({ ...f, conditionEndTime: e.target.value }))} placeholder="23:59" /></div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase pt-1">Repetición (opcional — "solo tras N veces")</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Métrica</Label>
                <Select value={form.aggregateMetric} onValueChange={v => setForm(f => ({ ...f, aggregateMetric: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sin condición de repetición</SelectItem>
                    {Object.entries(AGGREGATE_METRIC_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Umbral</Label><Input type="number" min={1} value={form.aggregateThreshold} onChange={e => setForm(f => ({ ...f, aggregateThreshold: e.target.value }))} disabled={form.aggregateMetric === NONE} /></div>
              <div>
                <Label>Ventana</Label>
                <Select value={form.recurrenceWindow} onValueChange={v => setForm(f => ({ ...f, recurrenceWindow: v }))} disabled={form.aggregateMetric === NONE}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Esta noche (día operativo)</SelectItem>
                    <SelectItem value="week">Esta semana</SelectItem>
                    <SelectItem value="month">Este mes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.aggregateMetric !== NONE && !AGGREGATE_METRIC_SUPPORTS_VENUE[form.aggregateMetric] && form.sourceVenueId !== NONE && (
              <p className="text-xs text-amber-600">Esta métrica cuenta en todos los venues — el "Venue origen" de arriba no la filtra.</p>
            )}

            <p className="text-xs font-semibold text-muted-foreground uppercase pt-1">Resultado</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Definición de beneficio *</Label>
                <Select value={form.benefitDefinitionId} onValueChange={v => setForm(f => ({ ...f, benefitDefinitionId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                  <SelectContent>{(definitions ?? []).map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Cantidad</Label><Input type="number" min={1} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} /></div>
              <div><Label>Prioridad</Label><Input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} /></div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase pt-1">Vigencia del beneficio concedido</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Estrategia</Label>
                <Select value={form.validityType} onValueChange={v => setForm(f => ({ ...f, validityType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="immediate">Inmediato (+ duración opcional)</SelectItem>
                    <SelectItem value="offset">Offset en minutos desde el origen</SelectItem>
                    <SelectItem value="day_anchored">Anclado a día (mañana, hora concreta…)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Duración (minutos, opcional)</Label><Input type="number" value={form.validityDurationMinutes} onChange={e => setForm(f => ({ ...f, validityDurationMinutes: e.target.value }))} /></div>
              {form.validityType === "offset" && (
                <div><Label>Offset (minutos)</Label><Input type="number" value={form.validityOffsetMinutes} onChange={e => setForm(f => ({ ...f, validityOffsetMinutes: e.target.value }))} /></div>
              )}
              {form.validityType === "day_anchored" && (
                <>
                  <div><Label>Días de desplazamiento (0=hoy, 1=mañana)</Label><Input type="number" min={0} value={form.validityDaysOffset} onChange={e => setForm(f => ({ ...f, validityDaysOffset: e.target.value }))} /></div>
                  <div><Label>Hora inicio (HH:MM, vacío = instante origen)</Label><Input value={form.validityStartTime} onChange={e => setForm(f => ({ ...f, validityStartTime: e.target.value }))} placeholder="00:00" /></div>
                  <div><Label>Hora fin (HH:MM, vacío = sin caducidad)</Label><Input value={form.validityEndTime} onChange={e => setForm(f => ({ ...f, validityEndTime: e.target.value }))} placeholder="01:00" /></div>
                </>
              )}
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase pt-1">Límites</p>
            <div className="grid grid-cols-3 gap-4">
              <div><Label>Máx. por usuario</Label><Input type="number" value={form.maxPerUser} onChange={e => setForm(f => ({ ...f, maxPerUser: e.target.value }))} /></div>
              <div><Label>Máx. por día</Label><Input type="number" value={form.maxPerDay} onChange={e => setForm(f => ({ ...f, maxPerDay: e.target.value }))} /></div>
              <div><Label>Máx. total</Label><Input type="number" value={form.maxTotal} onChange={e => setForm(f => ({ ...f, maxTotal: e.target.value }))} /></div>
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.oncePerOrigin} onCheckedChange={v => setForm(f => ({ ...f, oncePerOrigin: !!v }))} /> Una vez por origen</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.oncePerRule} onCheckedChange={v => setForm(f => ({ ...f, oncePerRule: !!v }))} /> Una vez por usuario (esta regla)</label>
            </div>

            {form.benefitDefinitionId && (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Resumen</p>
                {buildRulePreview(
                  form,
                  id => (venues ?? []).find(v => String(v.id) === id)?.name ?? null,
                  id => (definitions ?? []).find(d => String(d.id) === id)?.name ?? null
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>{editId ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={statsRuleId != null} onOpenChange={v => !v && setStatsRuleId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Resultados de la regla</DialogTitle></DialogHeader>
          {statsRuleId != null && <RuleStatsView ruleId={statsRuleId} venueName={id => (venues ?? []).find(v => v.id === id)?.name ?? `#${id}`} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6, spec §27/§28): concedidos/canjeados/conversión, y si origen≠destino (cross-venue) lo muestra explícitamente — la relación real "Casanova → Tía Felisa" que el negocio quiere poder ver. */
function RuleStatsView({ ruleId, venueName }: { ruleId: number; venueName: (id: number) => string }) {
  const { data: stats, isLoading } = trpc.benefits.getRuleStats.useQuery({ id: ruleId });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!stats) return <p className="text-sm text-muted-foreground py-4">Sin datos.</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-foreground">{stats.ruleName}</p>
      {stats.crossVenue && stats.sourceVenueId != null && stats.destinationVenueId != null && (
        <p className="text-xs text-muted-foreground">Cross-venue: {venueName(stats.sourceVenueId)} → {venueName(stats.destinationVenueId)}</p>
      )}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div><p className="text-2xl font-bold text-foreground tabular-nums">{stats.grantedCount}</p><p className="text-xs text-muted-foreground">Concedidos</p></div>
        <div><p className="text-2xl font-bold text-foreground tabular-nums">{stats.usedCount}</p><p className="text-xs text-muted-foreground">Canjeados</p></div>
        <div><p className="text-2xl font-bold text-foreground tabular-nums">{Math.round(stats.usageRate * 100)}%</p><p className="text-xs text-muted-foreground">Conversión</p></div>
      </div>
      <p className="text-xs text-muted-foreground text-center">{stats.uniqueStudents} Students distintos</p>
    </div>
  );
}

// ─── CONCEDIDOS ──────────────────────────────────────────────────────────────

function GrantedTab() {
  const { filter: communityFilter } = useAdminCommunity();
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<string>(ALL);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantForm, setGrantForm] = useState({ userId: "", benefitDefinitionId: "", validFrom: "", validUntil: "", reason: "" });
  const [cancelReason, setCancelReason] = useState<Record<number, string>>({});

  const { data, isLoading } = trpc.benefits.listGrants.useQuery({
    communityId: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? "all" : communityFilter,
    status: status !== ALL ? (status as any) : undefined,
    limit: 100, offset: 0,
  });
  const { data: definitions } = trpc.benefits.listDefinitions.useQuery();

  const grantMut = trpc.benefits.manualGrant.useMutation({
    onSuccess: () => { utils.benefits.listGrants.invalidate(); toast.success("Beneficio concedido"); setGrantOpen(false); },
    onError: e => toast.error(e.message),
  });
  const cancelMut = trpc.benefits.cancelGrant.useMutation({
    onSuccess: () => { utils.benefits.listGrants.invalidate(); toast.success("Beneficio cancelado"); },
    onError: e => toast.error(e.message),
  });

  const submitGrant = () => {
    if (!grantForm.userId || !grantForm.benefitDefinitionId || !grantForm.validFrom || !grantForm.reason.trim()) {
      toast.error("Usuario, beneficio, vigencia y motivo son obligatorios"); return;
    }
    grantMut.mutate({
      userId: Number(grantForm.userId), benefitDefinitionId: Number(grantForm.benefitDefinitionId),
      validFrom: new Date(grantForm.validFrom), validUntil: grantForm.validUntil ? new Date(grantForm.validUntil) : null,
      reason: grantForm.reason,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Cualquier estado</SelectItem>
            <SelectItem value="active">Activo</SelectItem>
            <SelectItem value="used">Usado</SelectItem>
            <SelectItem value="expired">Caducado</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => { setGrantForm({ userId: "", benefitDefinitionId: "", validFrom: "", validUntil: "", reason: "" }); setGrantOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" /> Concesión manual
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Sin beneficios concedidos que coincidan con los filtros.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estudiante</TableHead><TableHead>Beneficio</TableHead><TableHead>Origen</TableHead>
                <TableHead>Destino</TableHead><TableHead>Válido desde</TableHead><TableHead>Válido hasta</TableHead>
                <TableHead>Estado</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map(g => (
                <TableRow key={g.id}>
                  <TableCell className="text-foreground">{g.studentName ?? `#${g.userId}`}</TableCell>
                  <TableCell className="text-muted-foreground">{g.definitionName}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{g.sourceVenueName ?? g.sourceType}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{g.destinationVenueName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{fmtDateTime(g.validFrom)}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{fmtDateTime(g.validUntil)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[g.status]}>{g.status}</Badge></TableCell>
                  <TableCell>
                    {g.status === "active" && (
                      <div className="flex items-center gap-1">
                        <Input placeholder="Motivo" className="h-7 w-[100px] text-xs" value={cancelReason[g.id] ?? ""} onChange={e => setCancelReason(r => ({ ...r, [g.id]: e.target.value }))} />
                        <Button size="sm" variant="outline" className="h-7" disabled={cancelMut.isPending || !cancelReason[g.id]?.trim()} onClick={() => cancelMut.mutate({ userBenefitId: g.id, reason: cancelReason[g.id] })}>
                          <Ban className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Concesión manual</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>ID de usuario *</Label><Input type="number" value={grantForm.userId} onChange={e => setGrantForm(f => ({ ...f, userId: e.target.value }))} /></div>
            <div>
              <Label>Beneficio *</Label>
              <Select value={grantForm.benefitDefinitionId} onValueChange={v => setGrantForm(f => ({ ...f, benefitDefinitionId: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                <SelectContent>{(definitions ?? []).map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Válido desde *</Label><Input type="datetime-local" value={grantForm.validFrom} onChange={e => setGrantForm(f => ({ ...f, validFrom: e.target.value }))} /></div>
              <div><Label>Válido hasta</Label><Input type="datetime-local" value={grantForm.validUntil} onChange={e => setGrantForm(f => ({ ...f, validUntil: e.target.value }))} /></div>
            </div>
            <div><Label>Motivo *</Label><Textarea rows={2} value={grantForm.reason} onChange={e => setGrantForm(f => ({ ...f, reason: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantOpen(false)}>Cancelar</Button>
            <Button onClick={submitGrant} disabled={grantMut.isPending}>Conceder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── CANJES / AUDITORÍA ──────────────────────────────────────────────────────

function RedemptionsTab() {
  const { data: attempts, isLoading } = trpc.benefits.listRedemptionAttempts.useQuery({ limit: 100, offset: 0 });
  const suspiciousResults = new Set(["invalid_token", "not_found", "already_used", "unauthorized_staff"]);

  return (
    <div className="bg-card border border-border rounded-lg overflow-x-auto">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-amber-500" />
        <p className="text-sm text-muted-foreground">Registro de auditoría de todos los intentos de validación en puerta — éxito y fallo.</p>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : !attempts || attempts.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Sin intentos registrados todavía.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Fecha</TableHead><TableHead>Beneficio</TableHead><TableHead>Staff</TableHead><TableHead>Venue</TableHead><TableHead>Resultado</TableHead><TableHead>IP</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {attempts.map(a => (
              <TableRow key={a.id} className={suspiciousResults.has(a.result) ? "bg-destructive/5" : undefined}>
                <TableCell className="text-muted-foreground">{fmtDateTime(a.createdAt)}</TableCell>
                <TableCell className="text-muted-foreground">{a.userBenefitId ? `#${a.userBenefitId}` : "—"}</TableCell>
                <TableCell className="text-muted-foreground">{a.staffUserId ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{a.venueId ?? "—"}</TableCell>
                <TableCell><Badge variant={a.result === "valid" ? "default" : suspiciousResults.has(a.result) ? "destructive" : "outline"}>{a.result}</Badge></TableCell>
                <TableCell className="text-muted-foreground text-xs">{a.ipAddress ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export default function BenefitsManager() {
  return (
    <AdminLayout title="Benefits">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Gift className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Benefits</h2>
            <p className="text-sm text-muted-foreground">Definiciones, reglas de origen→beneficio, concesiones y canjes en puerta.</p>
          </div>
        </div>

        <Tabs defaultValue="definitions">
          <TabsList>
            <TabsTrigger value="definitions">Definiciones</TabsTrigger>
            <TabsTrigger value="rules">Reglas</TabsTrigger>
            <TabsTrigger value="granted">Concedidos</TabsTrigger>
            <TabsTrigger value="redemptions">Canjes</TabsTrigger>
          </TabsList>
          <TabsContent value="definitions"><DefinitionsTab /></TabsContent>
          <TabsContent value="rules"><RulesTab /></TabsContent>
          <TabsContent value="granted"><GrantedTab /></TabsContent>
          <TabsContent value="redemptions"><RedemptionsTab /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
