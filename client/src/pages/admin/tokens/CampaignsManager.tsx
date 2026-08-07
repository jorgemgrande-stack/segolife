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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Megaphone, Loader2, Pencil } from "lucide-react";

interface CampaignForm {
  name: string;
  description: string;
  multiplier: string;
  bonusTokens: string;
  startsAt: string;
  endsAt: string;
  priority: string;
}

const emptyForm: CampaignForm = { name: "", description: "", multiplier: "", bonusTokens: "", startsAt: "", endsAt: "", priority: "0" };

export default function CampaignsManager() {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<CampaignForm>(emptyForm);
  const [scopeCommunities, setScopeCommunities] = useState<Set<number>>(new Set());
  const [scopeVenues, setScopeVenues] = useState<Set<number>>(new Set());
  const utils = trpc.useUtils();

  const { data: campaigns, isLoading, error } = trpc.tokens.listCampaigns.useQuery();
  const { data: communities } = trpc.communities.list.useQuery();
  const { data: venues } = trpc.venues.publicActive.useQuery({});

  const createMut = trpc.tokens.createCampaign.useMutation({
    onSuccess: async (res) => {
      if (res.campaign) await scopeMut.mutateAsync({ id: res.campaign.id, communityIds: Array.from(scopeCommunities), venueIds: Array.from(scopeVenues), eventIds: [] });
      utils.tokens.listCampaigns.invalidate(); toast.success("Campaña creada"); setOpen(false);
    },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.tokens.updateCampaign.useMutation({
    onSuccess: async () => {
      if (editId) await scopeMut.mutateAsync({ id: editId, communityIds: Array.from(scopeCommunities), venueIds: Array.from(scopeVenues), eventIds: [] });
      utils.tokens.listCampaigns.invalidate(); toast.success("Campaña actualizada"); setOpen(false);
    },
    onError: e => toast.error(e.message),
  });
  const scopeMut = trpc.tokens.setCampaignScope.useMutation({ onError: e => toast.error(e.message) });
  const setActiveMut = trpc.tokens.setCampaignActive.useMutation({
    onSuccess: () => utils.tokens.listCampaigns.invalidate(),
    onError: e => toast.error(e.message),
  });

  const openCreate = () => { setEditId(null); setForm(emptyForm); setScopeCommunities(new Set()); setScopeVenues(new Set()); setOpen(true); };
  const openEdit = (c: NonNullable<typeof campaigns>[number]) => {
    setEditId(c.id);
    setForm({
      name: c.name, description: c.description ?? "", multiplier: c.multiplier ?? "", bonusTokens: c.bonusTokens != null ? String(c.bonusTokens) : "",
      startsAt: c.startsAt ? new Date(c.startsAt).toISOString().slice(0, 16) : "",
      endsAt: c.endsAt ? new Date(c.endsAt).toISOString().slice(0, 16) : "",
      priority: String(c.priority),
    });
    setScopeCommunities(new Set(c.scope.communityIds));
    setScopeVenues(new Set(c.scope.venueIds));
    setOpen(true);
  };

  const buildPayload = () => ({
    name: form.name,
    description: form.description || undefined,
    multiplier: form.multiplier || undefined,
    bonusTokens: form.bonusTokens ? Number(form.bonusTokens) : undefined,
    startsAt: form.startsAt ? new Date(form.startsAt) : undefined,
    endsAt: form.endsAt ? new Date(form.endsAt) : undefined,
    priority: Number(form.priority) || 0,
  });

  const handleSubmit = () => {
    if (!form.name.trim()) { toast.error("El nombre es obligatorio"); return; }
    if (editId) updateMut.mutate({ id: editId, ...buildPayload() });
    else createMut.mutate(buildPayload());
  };

  const toggleSet = (set: Set<number>, setter: (s: Set<number>) => void, id: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  return (
    <AdminLayout title="Campañas SegoTokens">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Megaphone className="w-6 h-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Campañas</h2>
              <p className="text-sm text-muted-foreground">Bonificaciones temporales (x2, x3, bonus fijo) sobre las reglas base.</p>
            </div>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Nueva campaña</Button>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-destructive">{error.message}</div>
          ) : !campaigns || campaigns.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Sin campañas todavía.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Multiplicador</TableHead>
                  <TableHead>Bonus fijo</TableHead>
                  <TableHead>Alcance</TableHead>
                  <TableHead>Prioridad</TableHead>
                  <TableHead>Activa</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.multiplier ? `x${c.multiplier}` : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.bonusTokens ?? "—"}</TableCell>
                    <TableCell>
                      {c.scope.communityIds.length === 0 && c.scope.venueIds.length === 0 && c.scope.eventIds.length === 0
                        ? <Badge variant="secondary">Global</Badge>
                        : <Badge variant="outline">{c.scope.communityIds.length + c.scope.venueIds.length + c.scope.eventIds.length} restricción(es)</Badge>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.priority}</TableCell>
                    <TableCell><Switch checked={c.active} onCheckedChange={v => setActiveMut.mutate({ id: c.id, active: v })} /></TableCell>
                    <TableCell><Button size="sm" variant="outline" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Editar campaña" : "Nueva campaña"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Nombre *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: x2 esta noche" /></div>
            <div><Label>Descripción</Label><Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Multiplicador</Label><Input value={form.multiplier} onChange={e => setForm(f => ({ ...f, multiplier: e.target.value }))} placeholder="2.00" /></div>
              <div><Label>Bonus fijo</Label><Input type="number" value={form.bonusTokens} onChange={e => setForm(f => ({ ...f, bonusTokens: e.target.value }))} /></div>
              <div><Label>Inicio</Label><Input type="datetime-local" value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} /></div>
              <div><Label>Fin</Label><Input type="datetime-local" value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} /></div>
              <div><Label>Prioridad</Label><Input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} /></div>
            </div>
            <div>
              <Label className="block mb-2">Alcance (vacío = global)</Label>
              <p className="text-xs text-muted-foreground mb-2">Comunidades</p>
              <div className="flex flex-wrap gap-3 mb-3">
                {(communities ?? []).map(c => (
                  <label key={c.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={scopeCommunities.has(c.id)} onCheckedChange={() => toggleSet(scopeCommunities, setScopeCommunities, c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mb-2">Venues</p>
              <div className="flex flex-wrap gap-3">
                {(venues ?? []).map(v => (
                  <label key={v.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={scopeVenues.has(v.id)} onCheckedChange={() => toggleSet(scopeVenues, setScopeVenues, v.id)} />
                    {v.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>{editId ? "Guardar" : "Crear campaña"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
