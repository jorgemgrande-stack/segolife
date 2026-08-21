import { useState } from "react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

/**
 * HistoricalIdentityDialogs.tsx — diálogos de Estudiantes históricos
 * (Vincular/Retirar vínculo/Convertir en estudiante real), compartidos entre
 * HistoricalIdentities.tsx (fila del listado) y HistoricalIdentityDetail.tsx
 * (ficha) — mismo patrón que StudentLifecycleDialogs.tsx: un único
 * componente reutilizado desde las dos superficies para que nunca diverjan.
 */

export function ClaimDialog({ identityKey, open, onOpenChange }: { identityKey: string; open: boolean; onOpenChange: (v: boolean) => void }) {
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

export function UnclaimDialog({ identityKey, open, onOpenChange }: { identityKey: string; open: boolean; onOpenChange: (v: boolean) => void }) {
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

/**
 * Convertir en estudiante real (petición del cliente, 2026-08-21): crea la
 * cuenta real desde cero (esta identidad no tiene ninguna todavía —
 * distinto de "Vincular", que asocia el historial a una cuenta que YA
 * existe) y envía el email de bienvenida con el enlace para configurar el
 * acceso. Solo tiene sentido para status="UNREGISTERED" — con un email ya
 * coincidente (POSSIBLE_MATCH/AUTO_MATCH_CANDIDATE) la vía correcta sigue
 * siendo "Vincular a estudiante", nunca una segunda cuenta con el mismo email.
 */
export function ConvertToStudentDialog({ identityKey, hasEmail, open, onOpenChange }: { identityKey: string; hasEmail: boolean; open: boolean; onOpenChange: (v: boolean) => void }) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [communityId, setCommunityId] = useState<string>("");
  const [universityId, setUniversityId] = useState<string>("");

  const { data: communities } = trpc.communities.list.useQuery();
  const { data: universities } = trpc.communities.listUniversities.useQuery();

  const convertMut = trpc.historicalIdentities.convertToStudent.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.welcomeEmailSent
          ? "Cuenta creada y email de bienvenida enviado."
          : "Cuenta creada — el email de bienvenida no se pudo enviar, contacta al estudiante desde \"Comunicarse\"."
      );
      utils.historicalIdentities.detail.invalidate({ identityKey });
      utils.historicalIdentities.list.invalidate();
      onOpenChange(false);
      navigate(`/admin/students/historical/${encodeURIComponent(identityKey)}`);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><UserPlus className="w-4 h-4" />Convertir en estudiante real</DialogTitle></DialogHeader>
        {!hasEmail ? (
          <p className="text-sm text-destructive">Esta identidad no tiene email — no se puede crear ni notificar una cuenta sin uno.</p>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Se crea una cuenta real con su nombre, email y teléfono históricos, se vincula todo su historial (igual que "Vincular") y se le envía un email de bienvenida con el enlace para configurar su contraseña de acceso.
            </p>
            <div>
              <Label>Comunidad</Label>
              <Select value={communityId} onValueChange={setCommunityId}>
                <SelectTrigger><SelectValue placeholder="Elige una comunidad…" /></SelectTrigger>
                <SelectContent>
                  {(communities ?? []).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Universidad</Label>
              <Select value={universityId} onValueChange={setUniversityId}>
                <SelectTrigger><SelectValue placeholder="Elige una universidad…" /></SelectTrigger>
                <SelectContent>
                  {(universities ?? []).map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {hasEmail && (
            <Button
              disabled={!communityId || !universityId || convertMut.isPending}
              onClick={() => convertMut.mutate({ identityKey, communityId: Number(communityId), universityId: Number(universityId) })}
            >
              {convertMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
              Crear cuenta y enviar bienvenida
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
