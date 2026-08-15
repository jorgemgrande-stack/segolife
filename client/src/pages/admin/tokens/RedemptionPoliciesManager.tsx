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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Coins, Loader2, Pencil } from "lucide-react";

/**
 * RedemptionPoliciesManager.tsx — SEGOLIFE SEGOTOKENS UNIVERSAL SPEND
 * (Fase 7, spec §7). Sigue el mismo patrón exacto que CampaignsManager.tsx
 * (página hermana bajo /admin/tokens, nunca un admin aparte). Tasa
 * ADMIN-CONFIGURABLE como ratio entero (tokensPerUnit/valueCentsPerUnit) —
 * el formulario pide "cuántos ST" y "cuántos céntimos" por separado, nunca
 * un decimal que arrastraría redondeo float.
 */

const NONE = "__none__";

interface PolicyForm {
  name: string; description: string;
  communityId: string; venueId: string; eventId: string;
  tokensPerUnit: string; valueCentsPerUnit: string;
  minTokenSpend: string; maxTokenSpend: string; maxPercentage: string;
  allowFullTokenPayment: boolean;
  startsAt: string; endsAt: string; priority: string;
}

const emptyForm: PolicyForm = {
  name: "", description: "",
  communityId: NONE, venueId: NONE, eventId: NONE,
  tokensPerUnit: "100", valueCentsPerUnit: "100",
  minTokenSpend: "", maxTokenSpend: "", maxPercentage: "",
  allowFullTokenPayment: false,
  startsAt: "", endsAt: "", priority: "0",
};

/** Resumen legible (spec §7) — "At Casanova, 100 SegoTokens currently reduce the payable amount by €1.00, up to 50% of the purchase." */
function buildPreview(form: PolicyForm, venueName: string | null, communityName: string | null, eventName: string | null): string {
  const tokens = Number(form.tokensPerUnit) || 0;
  const cents = Number(form.valueCentsPerUnit) || 0;
  const scope = venueName ?? eventName ?? communityName ?? "toda la plataforma";
  const euros = (cents / 100).toFixed(2);
  const parts = [`En ${scope}, ${tokens} SegoTokens reducen el importe a pagar en €${euros}`];
  if (form.allowFullTokenPayment) parts.push(", hasta cubrirlo al 100% si el saldo alcanza");
  else if (form.maxPercentage) parts.push(`, hasta un máximo del ${form.maxPercentage}% de la compra`);
  if (form.minTokenSpend) parts.push(`. Mínimo ${form.minTokenSpend} ST por operación`);
  if (form.maxTokenSpend) parts.push(`. Máximo ${form.maxTokenSpend} ST por operación`);
  return parts.join("") + ".";
}

export default function RedemptionPoliciesManager() {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PolicyForm>(emptyForm);
  const utils = trpc.useUtils();

  const { data: policies, isLoading, error } = trpc.tokens.listRedemptionPolicies.useQuery();
  const { data: communities } = trpc.communities.list.useQuery();
  const { data: venues } = trpc.venues.publicActive.useQuery({});

  const createMut = trpc.tokens.createRedemptionPolicy.useMutation({
    onSuccess: () => { utils.tokens.listRedemptionPolicies.invalidate(); toast.success("Política creada"); setOpen(false); },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.tokens.updateRedemptionPolicy.useMutation({
    onSuccess: () => { utils.tokens.listRedemptionPolicies.invalidate(); toast.success("Política actualizada"); setOpen(false); },
    onError: e => toast.error(e.message),
  });
  const setActiveMut = trpc.tokens.setRedemptionPolicyActive.useMutation({
    onSuccess: () => utils.tokens.listRedemptionPolicies.invalidate(),
    onError: e => toast.error(e.message),
  });

  const openCreate = () => { setEditId(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (p: NonNullable<typeof policies>[number]) => {
    setEditId(p.id);
    setForm({
      name: p.name, description: p.description ?? "",
      communityId: p.communityId != null ? String(p.communityId) : NONE,
      venueId: p.venueId != null ? String(p.venueId) : NONE,
      eventId: p.eventId != null ? String(p.eventId) : NONE,
      tokensPerUnit: String(p.tokensPerUnit), valueCentsPerUnit: String(p.valueCentsPerUnit),
      minTokenSpend: p.minTokenSpend != null ? String(p.minTokenSpend) : "",
      maxTokenSpend: p.maxTokenSpend != null ? String(p.maxTokenSpend) : "",
      maxPercentage: p.maxPercentage != null ? String(p.maxPercentage) : "",
      allowFullTokenPayment: p.allowFullTokenPayment,
      startsAt: p.startsAt ? new Date(p.startsAt).toISOString().slice(0, 16) : "",
      endsAt: p.endsAt ? new Date(p.endsAt).toISOString().slice(0, 16) : "",
      priority: String(p.priority),
    });
    setOpen(true);
  };

  const buildPayload = () => ({
    name: form.name, description: form.description || undefined,
    communityId: form.communityId !== NONE ? Number(form.communityId) : null,
    venueId: form.venueId !== NONE ? Number(form.venueId) : null,
    eventId: form.eventId !== NONE ? Number(form.eventId) : null,
    tokensPerUnit: Number(form.tokensPerUnit) || 1,
    valueCentsPerUnit: Number(form.valueCentsPerUnit) || 0,
    minTokenSpend: form.minTokenSpend ? Number(form.minTokenSpend) : null,
    maxTokenSpend: form.maxTokenSpend ? Number(form.maxTokenSpend) : null,
    maxPercentage: form.maxPercentage ? Number(form.maxPercentage) : null,
    allowFullTokenPayment: form.allowFullTokenPayment,
    startsAt: form.startsAt ? new Date(form.startsAt) : undefined,
    endsAt: form.endsAt ? new Date(form.endsAt) : undefined,
    priority: Number(form.priority) || 0,
  });

  const handleSubmit = () => {
    if (!form.name.trim() || !form.valueCentsPerUnit) { toast.error("Nombre y valor por token son obligatorios"); return; }
    if (editId) updateMut.mutate({ id: editId, ...buildPayload() });
    else createMut.mutate(buildPayload());
  };

  const venueName = form.venueId !== NONE ? (venues ?? []).find(v => String(v.id) === form.venueId)?.name ?? null : null;
  const communityName = form.communityId !== NONE ? (communities ?? []).find(c => String(c.id) === form.communityId)?.name ?? null : null;

  return (
    <AdminLayout title="Políticas de canje SegoTokens">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Coins className="w-6 h-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Políticas de canje</h2>
              <p className="text-sm text-muted-foreground">Cuántos céntimos de valor promocional da 1 SegoToken al aplicarse contra un precio real.</p>
            </div>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Nueva política</Button>
        </div>

        {!isLoading && policies && policies.length === 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            Sin ninguna política activa, los SegoTokens no se pueden aplicar contra ningún precio todavía (comportamiento seguro por defecto — nunca se activa solo por desplegar código).
          </div>
        )}

        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-destructive">{error.message}</div>
          ) : !policies || policies.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Sin políticas todavía.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead><TableHead>Tasa</TableHead><TableHead>Alcance</TableHead>
                  <TableHead>Tope</TableHead><TableHead>100% ST</TableHead><TableHead>Activa</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-foreground">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{p.tokensPerUnit} ST = €{(p.valueCentsPerUnit / 100).toFixed(2)}</TableCell>
                    <TableCell>
                      {p.venueId == null && p.eventId == null && p.communityId == null
                        ? <Badge variant="secondary">Global</Badge>
                        : <Badge variant="outline">{[p.eventId && "Evento", p.venueId && "Venue", p.communityId && "Comunidad"].filter(Boolean).join(" · ")}</Badge>}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{p.maxPercentage != null ? `${p.maxPercentage}%` : "Sin tope"}</TableCell>
                    <TableCell className="text-muted-foreground">{p.allowFullTokenPayment ? "Sí" : "No"}</TableCell>
                    <TableCell><Switch checked={p.active} onCheckedChange={v => setActiveMut.mutate({ id: p.id, active: v })} /></TableCell>
                    <TableCell><Button size="sm" variant="outline" onClick={() => openEdit(p)}><Pencil className="w-3.5 h-3.5" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Editar política" : "Nueva política"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Nombre *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Política global" /></div>
            <div><Label>Descripción</Label><Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>

            <p className="text-xs font-semibold text-muted-foreground uppercase pt-1">Alcance (vacío = global)</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Venue</Label>
                <Select value={form.venueId} onValueChange={v => setForm(f => ({ ...f, venueId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Cualquiera</SelectItem>
                    {(venues ?? []).map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Comunidad</Label>
                <Select value={form.communityId} onValueChange={v => setForm(f => ({ ...f, communityId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Cualquiera</SelectItem>
                    {(communities ?? []).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase pt-1">Tasa de canje</p>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>SegoTokens</Label><Input type="number" min={1} value={form.tokensPerUnit} onChange={e => setForm(f => ({ ...f, tokensPerUnit: e.target.value }))} /></div>
              <div><Label>Valen (céntimos €)</Label><Input type="number" min={1} value={form.valueCentsPerUnit} onChange={e => setForm(f => ({ ...f, valueCentsPerUnit: e.target.value }))} /></div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase pt-1">Límites</p>
            <div className="grid grid-cols-3 gap-4">
              <div><Label>Mín. ST</Label><Input type="number" value={form.minTokenSpend} onChange={e => setForm(f => ({ ...f, minTokenSpend: e.target.value }))} /></div>
              <div><Label>Máx. ST</Label><Input type="number" value={form.maxTokenSpend} onChange={e => setForm(f => ({ ...f, maxTokenSpend: e.target.value }))} /></div>
              <div><Label>Máx. % de la compra</Label><Input type="number" min={0} max={100} value={form.maxPercentage} onChange={e => setForm(f => ({ ...f, maxPercentage: e.target.value }))} placeholder="Sin tope" /></div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.allowFullTokenPayment} onCheckedChange={v => setForm(f => ({ ...f, allowFullTokenPayment: !!v }))} />
              Permitir pagar el 100% con SegoTokens
            </label>

            <div className="grid grid-cols-3 gap-4">
              <div><Label>Inicio</Label><Input type="datetime-local" value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} /></div>
              <div><Label>Fin</Label><Input type="datetime-local" value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} /></div>
              <div><Label>Prioridad</Label><Input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} /></div>
            </div>

            {form.valueCentsPerUnit && (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Resumen</p>
                {buildPreview(form, venueName, communityName, null)}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>{editId ? "Guardar" : "Crear política"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
