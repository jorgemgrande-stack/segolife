import { useState } from "react";
import { useParams, Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, ArrowLeft, CalendarDays, Ticket, CheckCircle2, Euro, Link2, Unlink } from "lucide-react";
import { toast } from "sonner";

const STATUS_LABEL: Record<string, string> = {
  UNREGISTERED: "No registrado en Segolife",
  POSSIBLE_MATCH: "Posible coincidencia",
  AUTO_MATCH_CANDIDATE: "Coincidencia exacta (email + teléfono)",
  LINKED: "Vinculado a un estudiante",
  CONFLICT: "Conflicto de identidad",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  UNREGISTERED: "outline", POSSIBLE_MATCH: "secondary", AUTO_MATCH_CANDIDATE: "default", LINKED: "default", CONFLICT: "destructive",
};

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtSpend(cents: number) {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "");
}

function ClaimDialog({ identityKey, open, onOpenChange }: { identityKey: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const { data: students } = trpc.students.list.useQuery({ search: search || undefined, limit: 10, offset: 0, sortBy: "name", sortDir: "asc" }, { enabled: search.length >= 2 });
  const { data: preview } = trpc.historicalIdentities.previewMatchForStudent.useQuery({ userId: selectedUserId! }, { enabled: !!selectedUserId });

  const claim = trpc.historicalIdentities.claim.useMutation({
    onSuccess: (result) => {
      if (result.status === "CLAIM_CONFLICT") {
        toast.error("Esta identidad ya está vinculada a otro estudiante.");
        return;
      }
      toast.success(`${result.operationsLinked} operación(es) vinculada(s), ${result.attendanceMaterialized} asistencia(s) materializada(s).`);
      utils.historicalIdentities.detail.invalidate({ identityKey });
      utils.historicalIdentities.list.invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Vincular a un estudiante</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Buscar estudiante por nombre o email…" value={search} onChange={e => { setSearch(e.target.value); setSelectedUserId(null); }} />
          {students && students.items.length > 0 && !selectedUserId && (
            <div className="border border-border rounded-md divide-y divide-border max-h-48 overflow-y-auto">
              {students.items.map(s => (
                <button
                  key={s.userId}
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-accent/50 text-sm"
                  onClick={() => { setSelectedUserId(s.userId); setSearch(s.name ?? s.email ?? ""); }}
                >
                  <div className="font-medium">{s.name ?? "(sin nombre)"}</div>
                  <div className="text-xs text-muted-foreground">{s.email}</div>
                </button>
              ))}
            </div>
          )}
          {selectedUserId && preview && (
            <div className="text-sm rounded-md border border-border p-3 bg-muted/30">
              Confianza del match: <Badge variant={preview.confidence === "EXACT_EMAIL_AND_PHONE" ? "default" : "secondary"}>{preview.confidence}</Badge>
            </div>
          )}
          <Input placeholder="Motivo (opcional)" value={reason} onChange={e => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={!selectedUserId || claim.isPending}
            onClick={() => selectedUserId && claim.mutate({ identityKey, userId: selectedUserId, reason: reason || undefined })}
          >
            {claim.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Vincular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnclaimDialog({ identityKey, open, onOpenChange }: { identityKey: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const utils = trpc.useUtils();
  const [reason, setReason] = useState("");
  const unclaim = trpc.historicalIdentities.unclaim.useMutation({
    onSuccess: (result) => {
      toast.success(`${result.operationsReverted} operación(es) revertida(s).`);
      utils.historicalIdentities.detail.invalidate({ identityKey });
      utils.historicalIdentities.list.invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Retirar vinculación</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Los datos de Fourvenues (eventos, pedidos, tickets) permanecen intactos. Solo se retira la asociación con el estudiante.
        </p>
        <Input placeholder="Motivo (obligatorio)" value={reason} onChange={e => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="destructive" disabled={!reason.trim() || unclaim.isPending} onClick={() => unclaim.mutate({ identityKey, reason })}>
            {unclaim.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Retirar vínculo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function HistoricalIdentityDetail() {
  const params = useParams<{ identityKey: string }>();
  const identityKey = decodeURIComponent(params.identityKey ?? "");
  const [claimOpen, setClaimOpen] = useState(false);
  const [unclaimOpen, setUnclaimOpen] = useState(false);

  const { data, isLoading, error } = trpc.historicalIdentities.detail.useQuery({ identityKey }, { enabled: !!identityKey });

  if (isLoading) {
    return <AdminLayout title="Identidad histórica"><div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div></AdminLayout>;
  }
  if (error || !data) {
    return <AdminLayout title="Identidad histórica"><div className="py-20 text-center text-sm text-destructive">{error?.message ?? "No encontrada"}</div></AdminLayout>;
  }

  return (
    <AdminLayout title="Identidad histórica">
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link href="/admin/students/historical"><Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button></Link>
            <Avatar className="w-11 h-11"><AvatarFallback>{initials(data.name)}</AvatarFallback></Avatar>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{data.name ?? "(sin nombre)"}</h2>
              <p className="text-sm text-muted-foreground">
                {data.email ?? "—"}{data.email && data.phone ? " · " : ""}{data.phone ?? ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[data.status]}>{STATUS_LABEL[data.status]}</Badge>
            {data.status === "LINKED" ? (
              <Button variant="outline" size="sm" onClick={() => setUnclaimOpen(true)}><Unlink className="w-4 h-4 mr-1" />Retirar vínculo</Button>
            ) : data.status !== "CONFLICT" ? (
              <Button size="sm" onClick={() => setClaimOpen(true)}><Link2 className="w-4 h-4 mr-1" />Vincular a estudiante</Button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-6"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><CalendarDays className="w-3.5 h-3.5" />Eventos</div><div className="text-2xl font-semibold">{data.eventsCount}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Ticket className="w-3.5 h-3.5" />Tickets</div><div className="text-2xl font-semibold">{data.ticketsCount}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><CheckCircle2 className="w-3.5 h-3.5" />Asistencias</div><div className="text-2xl font-semibold">{data.attendanceCount}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Euro className="w-3.5 h-3.5" />Gasto histórico</div><div className="text-2xl font-semibold">{fmtSpend(data.historicalSpendCents)}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Venues
              {data.crossVenue && (
                <Badge variant="outline">Actividad en {data.venueBreakdown.length} venues — cross-venue</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {data.venueBreakdown.map(v => (
                <div key={v.venueId} className="border border-border rounded-md p-3">
                  <div className="font-medium">{v.venueName}</div>
                  <div className="text-xs text-muted-foreground mt-1">{v.eventsCount} eventos · {v.ticketsCount} tickets · {v.attendanceCount} asistencias</div>
                  <div className="text-xs text-muted-foreground">{fmtSpend(v.spendCents)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Actividad ({data.firstActivity ? fmtDateTime(data.firstActivity) : "—"} → {fmtDateTime(data.lastActivity)})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {data.timeline.map(t => (
                <div key={t.operationId} className="flex items-center justify-between text-sm border-b border-border/50 pb-2">
                  <div>
                    <span className="font-medium">{t.operationType === "order" ? "Compra" : "Asistencia"}</span>
                    {t.eventName && <span className="text-muted-foreground"> · {t.eventName}</span>}
                  </div>
                  <div className="text-muted-foreground">{fmtDateTime(t.occurredAt)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <ClaimDialog identityKey={identityKey} open={claimOpen} onOpenChange={setClaimOpen} />
        <UnclaimDialog identityKey={identityKey} open={unclaimOpen} onOpenChange={setUnclaimOpen} />
      </div>
    </AdminLayout>
  );
}
