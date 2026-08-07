import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Sparkles, Loader2, Pencil } from "lucide-react";

const NONE = "__none__";

interface RuleForm {
  name: string;
  description: string;
  direction: "earn" | "spend";
  origin: string;
  scope: "global" | "community" | "venue" | "event" | "product";
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
  monthlyLimit: string;
  recurrenceWindow: string;
  recurrenceThreshold: string;
  recurrenceMode: string;
  priority: string;
}

const emptyForm: RuleForm = {
  name: "", description: "", direction: "earn", origin: "manual", scope: "global",
  scopeVenueId: "", scopeEventId: "", scopeCommunityId: "",
  calcMethod: "fixed", fixedAmount: "", rate: "", multiplier: "", minSpend: "",
  maxTokens: "", dailyLimit: "", monthlyLimit: "",
  recurrenceWindow: "", recurrenceThreshold: "", recurrenceMode: "",
  priority: "0",
};

const ORIGINS = ["attendance", "event", "ticket", "purchase", "consumption", "product", "manual", "recurrence", "campaign"];

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
      monthlyLimit: rule.monthlyLimit != null ? String(rule.monthlyLimit) : "",
      recurrenceWindow: rule.recurrenceWindow ?? "", recurrenceThreshold: rule.recurrenceThreshold != null ? String(rule.recurrenceThreshold) : "",
      recurrenceMode: rule.recurrenceMode ?? "",
      priority: String(rule.priority),
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
    monthlyLimit: form.monthlyLimit ? Number(form.monthlyLimit) : undefined,
    recurrenceWindow: form.origin === "recurrence" && form.recurrenceWindow ? (form.recurrenceWindow as never) : undefined,
    recurrenceThreshold: form.origin === "recurrence" && form.recurrenceThreshold ? Number(form.recurrenceThreshold) : undefined,
    recurrenceMode: form.origin === "recurrence" && form.recurrenceMode ? (form.recurrenceMode as never) : undefined,
    priority: Number(form.priority) || 0,
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
                    {ORIGINS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Alcance</Label>
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
              <div><Label>Prioridad</Label><Input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} /></div>

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
              <div><Label>Límite diario</Label><Input type="number" value={form.dailyLimit} onChange={e => setForm(f => ({ ...f, dailyLimit: e.target.value }))} /></div>
              <div><Label>Límite mensual</Label><Input type="number" value={form.monthlyLimit} onChange={e => setForm(f => ({ ...f, monthlyLimit: e.target.value }))} /></div>

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
