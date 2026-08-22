import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LabelWithInfo } from "@/components/ui/info-tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Sparkles, Loader2, Pencil, FlaskConical } from "lucide-react";

const NONE = "__none__";

interface RuleForm {
  name: string;
  description: string;
  direction: "earn" | "spend";
  origin: string;
  // "ticket_type" (Loyalty Production Hardening) — el backend ya lo admite;
  // este formulario todavía no expone scopeTicketTypeId (fuera de alcance de
  // esta fase, ver informe) pero el tipo debe aceptarlo para no romper la
  // edición de una regla que ya tenga ese scope.
  scope: "global" | "community" | "venue" | "event" | "product" | "ticket_type";
  scopeVenueId: string;
  scopeEventId: string;
  scopeCommunityId: string;
  calcMethod: "fixed" | "per_euro" | "percentage" | "multiplier";
  fixedAmount: string;
  rate: string;
  multiplier: string;
  minSpend: string;
  maxTokens: string;
  dailyLimit: string;
  weeklyLimit: string;
  monthlyLimit: string;
  lifetimeLimit: string;
  recurrenceWindow: string;
  recurrenceThreshold: string;
  recurrenceMode: string;
  priority: string;
  startsAt: string;
  endsAt: string;
}

const emptyForm: RuleForm = {
  name: "", description: "", direction: "earn", origin: "manual", scope: "global",
  scopeVenueId: "", scopeEventId: "", scopeCommunityId: "",
  calcMethod: "fixed", fixedAmount: "", rate: "", multiplier: "", minSpend: "",
  maxTokens: "", dailyLimit: "", weeklyLimit: "", monthlyLimit: "", lifetimeLimit: "",
  recurrenceWindow: "", recurrenceThreshold: "", recurrenceMode: "",
  priority: "0", startsAt: "", endsAt: "",
};

// F60 (saneamiento funcional) — "participación en Community"/"idea aprobada"
// SÍ tienen reglas reales activas en producción (communityResponseService.ts/
// communityAudienceService.ts llaman a earnTokens con estos orígenes), pero
// el desplegable nunca los ofrecía — esas reglas solo podían darse de alta
// escribiendo directamente en la base de datos. "event"/"product"/"purchase"/
// "manual" (como origen de UNA REGLA, distinto del ajuste manual de saldo)
// siguen sin ningún disparador real conectado — se dejan seleccionables para
// no romper una edición futura, pero jamás se presentan como "ya conectados".
const ORIGINS = ["attendance", "event", "ticket", "purchase", "consumption", "product", "manual", "recurrence", "campaign", "community_response", "community_proposal_approved"];
const ORIGIN_LABELS: Record<string, string> = {
  attendance: "Asistencia a evento", event: "Evento (sin disparador conectado)",
  ticket: "Compra de entrada", purchase: "Compra genérica (sin disparador conectado)",
  consumption: "Consumición (QR / TPV)", product: "Producto (sin disparador conectado)",
  manual: "Manual (sin disparador conectado — usa Ajuste manual en la ficha del estudiante)",
  recurrence: "Recurrencia (bonus)", campaign: "Campaña (bonus)",
  community_response: "Participación en Community", community_proposal_approved: "Idea de estudiante aprobada en Community",
};

/**
 * SEGOTOKENS ECONOMY (spec §26-27) — Rule Preview/Simulador. SIEMPRE vía
 * tokens.previewReward, que llama a evaluateReward(ctx, "SIMULATION") real
 * — nunca una calculadora paralela aquí. Requiere un Student real para que
 * topes/recurrencia reflejen su historial real de token_ledger.
 */
function RulePreviewPanel() {
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<{ userId: number; name: string } | null>(null);
  const [origin, setOrigin] = useState("attendance");
  const [venueId, setVenueId] = useState("");
  const [eventId, setEventId] = useState("");
  const [amountSpent, setAmountSpent] = useState("");

  const { data: studentResults } = trpc.students.list.useQuery(
    { communityId: "all", search: studentSearch, limit: 5 },
    { enabled: studentSearch.trim().length >= 2 }
  );

  const { data: preview, isFetching } = trpc.tokens.previewReward.useQuery(
    {
      userId: selectedStudent?.userId ?? 0,
      origin: origin as never,
      venueId: venueId ? Number(venueId) : undefined,
      // F60 — el backend ya aceptaba eventId (evaluateReward/findApplicableRule
      // lo usan para decidir la regla ganadora entre un venue general y un
      // evento específico), pero este simulador nunca lo pedía — un admin no
      // podía comprobar en pantalla ese escenario concreto sin leer código.
      eventId: eventId ? Number(eventId) : undefined,
      amountSpent: amountSpent ? Number(amountSpent) : undefined,
    },
    { enabled: !!selectedStudent }
  );

  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-5 h-5 text-violet-500" />
        <h3 className="text-sm font-semibold text-foreground">Simulador de regla</h3>
      </div>
      <p className="text-xs text-muted-foreground">Motor real (evaluateReward, SIMULATION) contra un Student real — nunca escribe nada, mismo motor que usará LIVE.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Student</Label>
          {selectedStudent ? (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span className="text-foreground">{selectedStudent.name}</span>
              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelectedStudent(null)}>Cambiar</button>
            </div>
          ) : (
            <div className="relative">
              <Input placeholder="Buscar por nombre o email..." value={studentSearch} onChange={e => setStudentSearch(e.target.value)} />
              {studentResults && studentResults.items.length > 0 && (
                <div className="absolute z-10 mt-1 w-full border border-border rounded-md bg-popover shadow-md divide-y divide-border">
                  {studentResults.items.map(s => (
                    <button
                      key={s.userId}
                      className="block w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
                      onClick={() => { setSelectedStudent({ userId: s.userId, name: s.name ?? `Student #${s.userId}` }); setStudentSearch(""); }}
                    >
                      {s.name ?? `Student #${s.userId}`} · <span className="text-muted-foreground">{s.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div>
          <Label>Origen</Label>
          <Select value={origin} onValueChange={setOrigin}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{ORIGINS.map(o => <SelectItem key={o} value={o}>{ORIGIN_LABELS[o] ?? o}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Venue ID (opcional)</Label><Input type="number" value={venueId} onChange={e => setVenueId(e.target.value)} /></div>
        <div><Label>Evento ID (opcional)</Label><Input type="number" value={eventId} onChange={e => setEventId(e.target.value)} /></div>
        <div><Label>Importe pagado € (si aplica)</Label><Input value={amountSpent} onChange={e => setAmountSpent(e.target.value)} placeholder="18.00" /></div>
      </div>
      {selectedStudent && (
        <div className="border-t border-border pt-3">
          {isFetching ? (
            <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
          ) : !preview ? null : !preview.eligible ? (
            <p className="text-sm text-rose-500 font-medium">DENIED — {preview.reason}</p>
          ) : (
            <div className="space-y-1 text-sm">
              {/* F61 — "regla ganadora" explícita (nombre + prioridad), antes solo se mostraba el desglose numérico sin decir QUÉ regla lo produjo. */}
              {preview.rule && (
                <div className="flex justify-between"><span className="text-muted-foreground">Regla ganadora</span><span className="font-medium text-foreground">{preview.rule.name} (prioridad {preview.rule.priority})</span></div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">Base</span><span className="text-foreground">{preview.breakdown?.base ?? 0}</span></div>
              {!!preview.breakdown?.recurrenceBonus && (
                <div className="flex justify-between"><span className="text-muted-foreground">Recurrencia</span><span className="text-foreground">+{preview.breakdown.recurrenceBonus}</span></div>
              )}
              {preview.breakdown?.campaignMultiplier != null && (
                <div className="flex justify-between"><span className="text-muted-foreground">Campaña (multiplicador)</span><span className="text-foreground">×{preview.breakdown.campaignMultiplier}</span></div>
              )}
              {!!preview.breakdown?.campaignBonus && (
                <div className="flex justify-between"><span className="text-muted-foreground">Campaña (bonus)</span><span className="text-foreground">+{preview.breakdown.campaignBonus}</span></div>
              )}
              <div className="flex justify-between text-xs text-muted-foreground"><span>Antes de topes</span><span>{preview.breakdown?.beforeLimits ?? 0}</span></div>
              {preview.breakdown && preview.breakdown.final < preview.breakdown.beforeLimits && (
                <div className="flex justify-between text-xs text-amber-600 dark:text-amber-400"><span>Tope aplicado</span><span>-{preview.breakdown.beforeLimits - preview.breakdown.final}</span></div>
              )}
              <div className="flex justify-between font-semibold border-t border-border pt-1.5 mt-1"><span className="text-foreground">Final</span><span className="text-foreground">{preview.breakdown?.final ?? 0} SegoTokens</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RulesManager() {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const utils = trpc.useUtils();

  const { data: rules, isLoading, error } = trpc.tokens.listRules.useQuery();

  const createMut = trpc.tokens.createRule.useMutation({
    onSuccess: () => { utils.tokens.listRules.invalidate(); toast.success("Regla creada"); setOpen(false); },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.tokens.updateRule.useMutation({
    onSuccess: () => { utils.tokens.listRules.invalidate(); toast.success("Regla actualizada"); setOpen(false); },
    onError: e => toast.error(e.message),
  });
  const setActiveMut = trpc.tokens.setRuleActive.useMutation({
    onSuccess: () => { utils.tokens.listRules.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const openCreate = () => { setEditId(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (rule: NonNullable<typeof rules>[number]) => {
    setEditId(rule.id);
    setForm({
      name: rule.name, description: rule.description ?? "", direction: rule.direction, origin: rule.origin, scope: rule.scope,
      scopeVenueId: rule.scopeVenueId ? String(rule.scopeVenueId) : "",
      scopeEventId: rule.scopeEventId ? String(rule.scopeEventId) : "",
      scopeCommunityId: rule.scopeCommunityId ? String(rule.scopeCommunityId) : "",
      calcMethod: rule.calcMethod, fixedAmount: rule.fixedAmount != null ? String(rule.fixedAmount) : "",
      rate: rule.rate ?? "", multiplier: rule.multiplier ?? "", minSpend: rule.minSpend ?? "",
      maxTokens: rule.maxTokens != null ? String(rule.maxTokens) : "",
      dailyLimit: rule.dailyLimit != null ? String(rule.dailyLimit) : "",
      weeklyLimit: rule.weeklyLimit != null ? String(rule.weeklyLimit) : "",
      monthlyLimit: rule.monthlyLimit != null ? String(rule.monthlyLimit) : "",
      lifetimeLimit: rule.lifetimeLimit != null ? String(rule.lifetimeLimit) : "",
      recurrenceWindow: rule.recurrenceWindow ?? "", recurrenceThreshold: rule.recurrenceThreshold != null ? String(rule.recurrenceThreshold) : "",
      recurrenceMode: rule.recurrenceMode ?? "",
      priority: String(rule.priority),
      startsAt: rule.startsAt ? new Date(rule.startsAt).toISOString().slice(0, 16) : "",
      endsAt: rule.endsAt ? new Date(rule.endsAt).toISOString().slice(0, 16) : "",
    });
    setOpen(true);
  };

  const buildPayload = () => ({
    name: form.name,
    description: form.description || undefined,
    direction: form.direction,
    origin: form.origin as never,
    scope: form.scope,
    scopeVenueId: form.scope === "venue" && form.scopeVenueId ? Number(form.scopeVenueId) : undefined,
    scopeEventId: form.scope === "event" && form.scopeEventId ? Number(form.scopeEventId) : undefined,
    scopeCommunityId: form.scope === "community" && form.scopeCommunityId ? Number(form.scopeCommunityId) : undefined,
    calcMethod: form.calcMethod,
    fixedAmount: form.fixedAmount ? Number(form.fixedAmount) : undefined,
    rate: form.rate || undefined,
    multiplier: form.multiplier || undefined,
    minSpend: form.minSpend || undefined,
    maxTokens: form.maxTokens ? Number(form.maxTokens) : undefined,
    dailyLimit: form.dailyLimit ? Number(form.dailyLimit) : undefined,
    weeklyLimit: form.weeklyLimit ? Number(form.weeklyLimit) : undefined,
    monthlyLimit: form.monthlyLimit ? Number(form.monthlyLimit) : undefined,
    lifetimeLimit: form.lifetimeLimit ? Number(form.lifetimeLimit) : undefined,
    recurrenceWindow: form.origin === "recurrence" && form.recurrenceWindow ? (form.recurrenceWindow as never) : undefined,
    recurrenceThreshold: form.origin === "recurrence" && form.recurrenceThreshold ? Number(form.recurrenceThreshold) : undefined,
    recurrenceMode: form.origin === "recurrence" && form.recurrenceMode ? (form.recurrenceMode as never) : undefined,
    priority: Number(form.priority) || 0,
    startsAt: form.startsAt ? new Date(form.startsAt) : undefined,
    endsAt: form.endsAt ? new Date(form.endsAt) : undefined,
  });

  const handleSubmit = () => {
    if (!form.name.trim()) { toast.error("El nombre es obligatorio"); return; }
    if (editId) updateMut.mutate({ id: editId, ...buildPayload() });
    else createMut.mutate(buildPayload());
  };

  return (
    <AdminLayout title="Reglas SegoTokens">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Reglas</h2>
              <p className="text-sm text-muted-foreground">Motor configurable de ganancia/gasto de SegoTokens.</p>
            </div>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Nueva regla</Button>
        </div>

        <RulePreviewPanel />

        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-destructive">{error.message}</div>
          ) : !rules || rules.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Sin reglas todavía.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>Alcance</TableHead>
                  <TableHead>Cálculo</TableHead>
                  <TableHead>Prioridad</TableHead>
                  <TableHead>Activa</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-foreground">{r.name}</TableCell>
                    <TableCell><Badge variant={r.direction === "earn" ? "default" : "secondary"}>{r.direction === "earn" ? "Ganar" : "Gastar"}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{r.origin}</TableCell>
                    <TableCell className="text-muted-foreground">{r.scope}</TableCell>
                    <TableCell className="text-muted-foreground">{r.calcMethod}</TableCell>
                    <TableCell className="text-muted-foreground">{r.priority}</TableCell>
                    <TableCell>
                      <Switch checked={r.active} onCheckedChange={v => setActiveMut.mutate({ id: r.id, active: v })} />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => openEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Editar regla" : "Nueva regla"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Nombre *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: 2 tokens por euro en Chin Chin" />
              </div>
              <div className="col-span-2">
                <Label>Descripción</Label>
                <Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>

              <div>
                <Label>Dirección</Label>
                <Select value={form.direction} onValueChange={v => setForm(f => ({ ...f, direction: v as "earn" | "spend" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="earn">Ganar</SelectItem>
                    <SelectItem value="spend">Gastar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Origen</Label>
                <Select value={form.origin} onValueChange={v => setForm(f => ({ ...f, origin: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ORIGINS.map(o => <SelectItem key={o} value={o}>{ORIGIN_LABELS[o] ?? o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <LabelWithInfo info="Sobre qué se aplica la regla. Global = toda Segolife. Comunidad/Venue/Evento/Producto = solo cuando la acción ocurre ahí. Cuanto más específico el alcance, más prioridad tiene en un empate exacto (Evento > Producto > Venue > Comunidad > Global) frente a una regla más general con la misma prioridad numérica.">Alcance</LabelWithInfo>
                <Select value={form.scope} onValueChange={v => setForm(f => ({ ...f, scope: v as RuleForm["scope"] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global</SelectItem>
                    <SelectItem value="community">Comunidad</SelectItem>
                    <SelectItem value="venue">Venue</SelectItem>
                    <SelectItem value="event">Evento</SelectItem>
                    <SelectItem value="product">Producto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.scope === "venue" && (
                <div><Label>ID del venue</Label><Input type="number" value={form.scopeVenueId} onChange={e => setForm(f => ({ ...f, scopeVenueId: e.target.value }))} /></div>
              )}
              {form.scope === "event" && (
                <div><Label>ID del evento</Label><Input type="number" value={form.scopeEventId} onChange={e => setForm(f => ({ ...f, scopeEventId: e.target.value }))} /></div>
              )}
              {form.scope === "community" && (
                <div><Label>ID de la comunidad</Label><Input type="number" value={form.scopeCommunityId} onChange={e => setForm(f => ({ ...f, scopeCommunityId: e.target.value }))} /></div>
              )}

              <div>
                <Label>Método de cálculo</Label>
                <Select value={form.calcMethod} onValueChange={v => setForm(f => ({ ...f, calcMethod: v as RuleForm["calcMethod"] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fijo</SelectItem>
                    <SelectItem value="per_euro">Por euro</SelectItem>
                    <SelectItem value="percentage">Porcentaje</SelectItem>
                    <SelectItem value="multiplier">Multiplicador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Prioridad</Label>
                <Input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
                <p className="mt-1 text-xs text-muted-foreground">Mayor número = más prioridad. Si dos reglas activas pueden aplicar a la misma acción, gana una sola — nunca se suman. En caso de empate exacto, decide primero el alcance más específico (evento &gt; producto &gt; venue &gt; comunidad &gt; global) y, si aun así empatan, la regla creada primero. Evita depender de esto: pon prioridades distintas cuando quieras que una gane siempre — revisa "Salud" en Economía para ver si hay reglas en conflicto.</p>
              </div>
              <div>
                <LabelWithInfo info="Vacío = sin fecha de inicio/fin (la regla vale desde ya y para siempre, mientras siga Activa). Con fechas, la regla solo aplica dentro de esa ventana — fuera de ella se comporta como si no existiera, aunque siga marcada Activa. Hora del servidor, no la del navegador del estudiante.">Inicio (opcional)</LabelWithInfo>
                <Input type="datetime-local" value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} />
              </div>
              <div><Label>Fin (opcional)</Label><Input type="datetime-local" value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} /></div>

              {form.calcMethod === "fixed" && (
                <div><Label>Tokens fijos</Label><Input type="number" value={form.fixedAmount} onChange={e => setForm(f => ({ ...f, fixedAmount: e.target.value }))} /></div>
              )}
              {(form.calcMethod === "per_euro" || form.calcMethod === "percentage") && (
                <div><Label>{form.calcMethod === "per_euro" ? "Tokens por euro" : "Porcentaje (%)"}</Label><Input value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} /></div>
              )}
              {form.calcMethod === "multiplier" && (
                <div><Label>Multiplicador</Label><Input value={form.multiplier} onChange={e => setForm(f => ({ ...f, multiplier: e.target.value }))} /></div>
              )}
              <div><Label>Gasto mínimo (€)</Label><Input value={form.minSpend} onChange={e => setForm(f => ({ ...f, minSpend: e.target.value }))} /></div>
              <div><Label>Máx. tokens por operación</Label><Input type="number" value={form.maxTokens} onChange={e => setForm(f => ({ ...f, maxTokens: e.target.value }))} /></div>

              <div className="col-span-2">
                <LabelWithInfo info="Todos vacíos = sin tope, la regla concede siempre que se cumpla. Los 4 son independientes y se comprueban todos (diario, semanal, mensual, de por vida) — basta con que UNO se alcance para que ese estudiante deje de recibir más por esta regla hasta que el periodo correspondiente se reinicie (o para siempre, en el caso del límite de por vida).">Límites de recompensa (opcionales)</LabelWithInfo>
              </div>
              <div><Label>Límite diario</Label><Input type="number" value={form.dailyLimit} onChange={e => setForm(f => ({ ...f, dailyLimit: e.target.value }))} /></div>
              <div><Label>Límite semanal</Label><Input type="number" value={form.weeklyLimit} onChange={e => setForm(f => ({ ...f, weeklyLimit: e.target.value }))} /></div>
              <div><Label>Límite mensual</Label><Input type="number" value={form.monthlyLimit} onChange={e => setForm(f => ({ ...f, monthlyLimit: e.target.value }))} /></div>
              <div><Label>Límite de por vida</Label><Input type="number" value={form.lifetimeLimit} onChange={e => setForm(f => ({ ...f, lifetimeLimit: e.target.value }))} /></div>

              {form.origin === "recurrence" && (
                <>
                  <div>
                    <Label>Ventana de recurrencia</Label>
                    <Select value={form.recurrenceWindow || NONE} onValueChange={v => setForm(f => ({ ...f, recurrenceWindow: v === NONE ? "" : v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>—</SelectItem>
                        <SelectItem value="day">Día</SelectItem>
                        <SelectItem value="week">Semana</SelectItem>
                        <SelectItem value="month">Mes</SelectItem>
                        <SelectItem value="lifetime">De por vida</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Umbral (Nª visita)</Label><Input type="number" value={form.recurrenceThreshold} onChange={e => setForm(f => ({ ...f, recurrenceThreshold: e.target.value }))} /></div>
                  <div>
                    <Label>Modo</Label>
                    <Select value={form.recurrenceMode || NONE} onValueChange={v => setForm(f => ({ ...f, recurrenceMode: v === NONE ? "" : v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>—</SelectItem>
                        <SelectItem value="visit_count">Nº de visitas</SelectItem>
                        <SelectItem value="distinct_venues">Venues distintos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>{editId ? "Guardar" : "Crear regla"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
