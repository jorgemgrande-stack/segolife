import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, AlertCircle } from "lucide-react";

/**
 * UnresolvedOperations — /admin/integrations/unresolved (Fase 5, spec punto
 * 56). Muestra operaciones (asistencia/comercio) que no se pudieron
 * resolver a un estudiante — el admin las vincula manualmente por userId.
 * Solo se muestran los identity hints mínimos (email/teléfono/nombre), no
 * más PII de la necesaria.
 */
export default function UnresolvedOperations() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.integrations.listUnresolved.useQuery({ status: "unresolved" });
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [userIdInput, setUserIdInput] = useState("");

  const linkMut = trpc.integrations.linkUnresolved.useMutation({
    onSuccess: () => { toast.success("Vinculado"); utils.integrations.listUnresolved.invalidate(); setLinkingId(null); setUserIdInput(""); },
    onError: (e) => toast.error(e.message),
  });
  const ignoreMut = trpc.integrations.ignoreUnresolved.useMutation({
    onSuccess: () => { toast.success("Descartado"); utils.integrations.listUnresolved.invalidate(); },
  });

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto py-6 space-y-4">
        <h1 className="text-xl font-semibold flex items-center gap-2"><AlertCircle className="w-5 h-5" /> Unresolved Operations</h1>
        <p className="text-sm text-muted-foreground">Operaciones externas (asistencia/comercio) que no se pudieron asociar automáticamente a un estudiante. Nunca se pierden — quedan aquí hasta vincular o descartar.</p>

        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-8 text-center">Sin operaciones pendientes.</p>
        ) : (
          <div className="space-y-2">
            {data.map(op => (
              <div key={op.id} className="border border-border rounded-lg p-3 text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{op.operationType} · {op.provider}</span>
                  {op.amountCents != null && <Badge variant="secondary">{(op.amountCents / 100).toFixed(2)} €</Badge>}
                </div>
                <div className="text-muted-foreground">
                  {op.identityHintName && <span>{op.identityHintName} · </span>}
                  {op.identityHintEmail && <span>{op.identityHintEmail} · </span>}
                  {op.identityHintPhone && <span>{op.identityHintPhone} · </span>}
                  {new Date(op.createdAt).toLocaleString()}
                </div>
                {linkingId === op.id ? (
                  <div className="flex items-center gap-2">
                    <Input placeholder="ID de usuario" value={userIdInput} onChange={e => setUserIdInput(e.target.value)} className="w-32" />
                    <Button size="sm" disabled={!userIdInput || linkMut.isPending} onClick={() => linkMut.mutate({ id: op.id, userId: Number(userIdInput) })}>Confirmar</Button>
                    <Button size="sm" variant="ghost" onClick={() => setLinkingId(null)}>Cancelar</Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setLinkingId(op.id)}>Link student</Button>
                    <Button size="sm" variant="ghost" onClick={() => ignoreMut.mutate({ id: op.id })}>Ignore</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
