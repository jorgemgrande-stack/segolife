/**
 * ReferralsAdmin.tsx — SEGOLIFE REFERRAL & INVITE REWARDS ENGINE (Fase 8,
 * spec §41-45/§73-74). Overview / Campañas / Conversiones — GLOBAL_ADMIN
 * exclusivamente (referrals.view/referrals.manage, ver rbacSeed.ts).
 * Producción arranca SIEMPRE con 0 campañas activas (spec §13/§91) — crear
 * una campaña aquí la deja en DRAFT, la activación es un paso explícito
 * separado.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Coins, Users, TrendingUp, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const CONDITION_LABEL: Record<string, string> = {
  account_created: "Cuenta creada",
  verified_student: "Estudiante verificado",
  profile_completed: "Perfil completo",
  first_venue_visit: "Primera visita a un local",
  first_event_attendance: "Primera asistencia a un evento",
};

// verified_student excluido a propósito (auditoría Fase 8: sin hecho real
// de verificación en el repo hoy — ver referralService.ts, cabecera).
const SELECTABLE_CONDITIONS = ["account_created", "profile_completed", "first_venue_visit", "first_event_attendance"];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  active: "default",
  paused: "secondary",
  ended: "outline",
  archived: "outline",
  registered: "outline",
  converted: "secondary",
  rewarded: "default",
  ineligible: "destructive",
  expired: "outline",
  cancelled: "destructive",
};

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function Kpi({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon: React.ElementType }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-full bg-secondary text-primary shrink-0">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold text-foreground">{value}</p>
      </div>
    </div>
  );
}

function OverviewTab() {
  const { data, isLoading } = trpc.referrals.overview.useQuery();
  if (isLoading || !data) return <Loader2 className="w-6 h-6 animate-spin text-primary" />;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Kpi label="Referidos totales" value={data.totalReferred} icon={Users} />
      <Kpi label="Convertidos" value={data.totalConverted} icon={TrendingUp} />
      <Kpi label="Recompensados" value={data.totalRewarded} icon={Coins} />
      <Kpi label="Tasa de conversión" value={`${(data.conversionRate * 100).toFixed(0)}%`} icon={TrendingUp} />
      <Kpi label="SegoTokens emitidos" value={data.tokensIssued} icon={Coins} />
      <Kpi label="Inviters únicos" value={data.uniqueInviters} icon={Users} />
      <Kpi label="Pendientes de reconciliar" value={data.pendingReconciliation} icon={RefreshCw} />
    </div>
  );
}

function CreateCampaignDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const utils = trpc.useUtils();
  const { data: communities } = trpc.communities.list.useQuery();
  const [name, setName] = useState("");
  const [communityId, setCommunityId] = useState<string>("all");
  const [inviterReward, setInviterReward] = useState("50");
  const [inviteeReward, setInviteeReward] = useState("25");
  const [condition, setCondition] = useState("profile_completed");
  const [windowDays, setWindowDays] = useState("30");
  const [maxPerInviter, setMaxPerInviter] = useState("");

  const createMut = trpc.referrals.createCampaign.useMutation({
    onSuccess: () => {
      toast.success("Campaña creada en borrador");
      utils.referrals.listCampaigns.invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function submit() {
    createMut.mutate({
      name,
      communityId: communityId === "all" ? null : Number(communityId),
      inviterRewardTokens: Number(inviterReward),
      inviteeRewardTokens: Number(inviteeReward),
      conversionCondition: condition as never,
      attributionWindowDays: Number(windowDays),
      maxRewardsPerInviter: maxPerInviter ? Number(maxPerInviter) : null,
      maxTotalConversions: null,
      budgetTokens: null,
      priority: 0,
      startsAt: null,
      endsAt: null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nueva campaña de referidos</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="WELCOME WEEK" />
          </div>
          <div className="space-y-1.5">
            <Label>Comunidad</Label>
            <Select value={communityId} onValueChange={setCommunityId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las comunidades</SelectItem>
                {(communities ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Recompensa inviter (ST)</Label>
              <Input type="number" min={0} value={inviterReward} onChange={(e) => setInviterReward(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Recompensa invitee (ST)</Label>
              <Input type="number" min={0} value={inviteeReward} onChange={(e) => setInviteeReward(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Condición de conversión</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SELECTABLE_CONDITIONS.map((c) => <SelectItem key={c} value={c}>{CONDITION_LABEL[c]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Ventana de atribución (días)</Label>
              <Input type="number" min={1} value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Máx. por inviter (opcional)</Label>
              <Input type="number" min={1} value={maxPerInviter} onChange={(e) => setMaxPerInviter(e.target.value)} />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
            Resumen: Inviter {inviterReward || 0} ST · Invitee {inviteeReward || 0} ST · Coste por referido completado:{" "}
            <strong className="text-foreground">{(Number(inviterReward) || 0) + (Number(inviteeReward) || 0)} ST</strong>
            {maxPerInviter && <> · Máx. {maxPerInviter} por inviter</>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!name.trim() || createMut.isPending} onClick={submit}>
            {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : "Crear en borrador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignsTab() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.referrals.listCampaigns.useQuery();
  const [createOpen, setCreateOpen] = useState(false);

  const activateMut = trpc.referrals.activateCampaign.useMutation({
    onSuccess: () => { toast.success("Campaña activada"); utils.referrals.listCampaigns.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const pauseMut = trpc.referrals.pauseCampaign.useMutation({
    onSuccess: () => { toast.success("Campaña pausada"); utils.referrals.listCampaigns.invalidate(); },
  });
  const archiveMut = trpc.referrals.archiveCampaign.useMutation({
    onSuccess: () => { toast.success("Campaña archivada"); utils.referrals.listCampaigns.invalidate(); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5"><Plus className="size-4" /> Nueva campaña</Button>
      </div>
      {isLoading ? (
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      ) : (data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay ninguna campaña de referidos.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Economía</TableHead>
              <TableHead>Condición</TableHead>
              <TableHead>Límites</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell><Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge></TableCell>
                <TableCell>{c.inviterRewardTokens} / {c.inviteeRewardTokens} ST</TableCell>
                <TableCell className="text-xs">{CONDITION_LABEL[c.conversionCondition] ?? c.conversionCondition}</TableCell>
                <TableCell className="text-xs">{c.maxRewardsPerInviter ? `${c.maxRewardsPerInviter}/inviter` : "—"}{c.budgetTokens ? ` · presup. ${c.budgetTokens} ST` : ""}</TableCell>
                <TableCell className="text-right space-x-1.5">
                  {(c.status === "draft" || c.status === "paused") && (
                    <Button size="sm" variant="outline" disabled={activateMut.isPending} onClick={() => activateMut.mutate({ id: c.id })}>Activar</Button>
                  )}
                  {c.status === "active" && (
                    <Button size="sm" variant="outline" disabled={pauseMut.isPending} onClick={() => pauseMut.mutate({ id: c.id })}>Pausar</Button>
                  )}
                  {c.status !== "archived" && (
                    <Button size="sm" variant="ghost" disabled={archiveMut.isPending} onClick={() => archiveMut.mutate({ id: c.id })}>Archivar</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <CreateCampaignDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function ConversionsTab() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.referrals.listReferrals.useQuery({ limit: 100 });
  const retryMut = trpc.referrals.retryReward.useMutation({
    onSuccess: () => { toast.success("Reintento ejecutado"); utils.referrals.listReferrals.invalidate(); utils.referrals.overview.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Loader2 className="w-6 h-6 animate-spin text-primary" />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Referrer</TableHead>
          <TableHead>Invitado</TableHead>
          <TableHead>Comunidad</TableHead>
          <TableHead>Campaña</TableHead>
          <TableHead>Registrado</TableHead>
          <TableHead>Convertido</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Recompensa</TableHead>
          <TableHead className="text-right">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(data ?? []).map((r) => (
          <TableRow key={r.id}>
            <TableCell>{r.referrerName ?? `#${r.referrerUserId}`}</TableCell>
            <TableCell>{r.referredName ?? `#${r.referredUserId}`}</TableCell>
            <TableCell className="text-xs">{r.communityName ?? "—"}</TableCell>
            <TableCell className="text-xs">{r.campaignName ?? "—"}</TableCell>
            <TableCell className="text-xs">{fmtDate(r.registeredAt)}</TableCell>
            <TableCell className="text-xs">{fmtDate(r.convertedAt)}</TableCell>
            <TableCell><Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge></TableCell>
            <TableCell className="text-xs">
              {r.inviterRewarded ? `✓ ${r.inviterRewardTokens} ST` : "—"} / {r.inviteeRewarded ? `✓ ${r.inviteeRewardTokens} ST` : "—"}
            </TableCell>
            <TableCell className="text-right">
              {r.status === "converted" && (
                <Button size="sm" variant="outline" disabled={retryMut.isPending} onClick={() => retryMut.mutate({ referralId: r.id })}>
                  Reintentar
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function ReferralsAdmin() {
  return (
    <AdminLayout title="Referrals">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Referrals</h1>
          <p className="text-sm text-muted-foreground">Motor de invitaciones estudiante→estudiante — campañas, conversiones y recompensas en SegoTokens.</p>
        </div>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="campaigns">Campañas</TabsTrigger>
            <TabsTrigger value="conversions">Conversiones</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4"><OverviewTab /></TabsContent>
          <TabsContent value="campaigns" className="mt-4"><CampaignsTab /></TabsContent>
          <TabsContent value="conversions" className="mt-4"><ConversionsTab /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
