import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, Send, Lock, LockOpen, Info } from "lucide-react";

const MESSAGE_MAX_LENGTH = 5000;

function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * COM-01 — /admin/students/messages/:id. Ficha de una conversación real.
 * Cualquier admin con student_messages.manage puede responder/cerrar/
 * reabrir — la conversación pertenece al Student, nunca a un admin fijo
 * (spec §17, multi-admin).
 */
export default function StudentMessageDetail() {
  const { id } = useParams<{ id: string }>();
  const conversationId = Number(id);
  const utils = trpc.useUtils();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);

  const { data, isLoading, isError } = trpc.studentMessages.adminGetConversation.useQuery(
    { id: conversationId },
    { enabled: Number.isInteger(conversationId) && conversationId > 0 }
  );

  const markRead = trpc.studentMessages.adminMarkRead.useMutation();
  const reply = trpc.studentMessages.adminReply.useMutation({
    onSuccess: () => {
      setBody(""); setInternal(false);
      utils.studentMessages.adminGetConversation.invalidate({ id: conversationId });
      utils.studentMessages.adminList.invalidate();
      utils.studentMessages.adminPendingCount.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const closeMut = trpc.studentMessages.adminClose.useMutation({
    onSuccess: () => {
      toast.success("Conversación cerrada");
      utils.studentMessages.adminGetConversation.invalidate({ id: conversationId });
      utils.studentMessages.adminList.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const reopenMut = trpc.studentMessages.adminReopen.useMutation({
    onSuccess: () => {
      toast.success("Conversación reabierta");
      utils.studentMessages.adminGetConversation.invalidate({ id: conversationId });
      utils.studentMessages.adminList.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  useEffect(() => {
    if (data) markRead.mutate({ conversationId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.conversation.id]);

  if (isLoading) {
    return <AdminLayout><div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div></AdminLayout>;
  }
  if (isError || !data) {
    return (
      <AdminLayout>
        <div className="p-6">
          <Link href="/admin/students/messages" className="text-sm text-primary hover:underline">← Volver a Mensajes</Link>
          <p className="mt-4 text-sm text-muted-foreground">Conversación no encontrada.</p>
        </div>
      </AdminLayout>
    );
  }

  const { conversation, messages, student } = data;
  const isClosed = conversation.status === "closed";
  const trimmed = body.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MESSAGE_MAX_LENGTH && !isClosed && !reply.isPending;

  return (
    <AdminLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Link href="/admin/students/messages" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Mensajes
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{conversation.subject}</h1>
            <p className="text-sm text-muted-foreground">
              {student?.name ?? student?.email ?? `Student #${conversation.studentUserId}`}
              {student?.email && student?.name && <span className="text-muted-foreground/70"> · {student.email}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={isClosed ? "secondary" : "default"}>{isClosed ? "Cerrada" : "Abierta"}</Badge>
            {isClosed ? (
              <Button size="sm" variant="outline" disabled={reopenMut.isPending} onClick={() => reopenMut.mutate({ conversationId })}>
                <LockOpen className="w-4 h-4 mr-1.5" /> Reabrir
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={closeMut.isPending} onClick={() => closeMut.mutate({ conversationId })}>
                <Lock className="w-4 h-4 mr-1.5" /> Cerrar
              </Button>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 space-y-3 max-h-[50vh] overflow-y-auto">
          {messages.map(m => {
            const isAdmin = m.senderRole === "admin";
            const isInternal = m.visibility === "internal";
            return (
              <div key={m.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  isInternal ? "border border-amber-400/40 bg-amber-400/10" : isAdmin ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
                }`}>
                  {isInternal && (
                    <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                      <Info className="w-3 h-3" /> Nota interna — solo staff
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`mt-1 text-[10px] ${isAdmin && !isInternal ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {isAdmin ? "Admin" : "Student"} · {fmtDateTime(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {isClosed ? (
          <p className="text-sm text-muted-foreground">Conversación cerrada — reábrela para poder responder.</p>
        ) : (
          <div className="space-y-2">
            <Textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              maxLength={MESSAGE_MAX_LENGTH}
              rows={3}
              placeholder={internal ? "Nota interna (nunca visible para el Student)…" : "Escribe tu respuesta…"}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch id="internal-note" checked={internal} onCheckedChange={setInternal} />
                <Label htmlFor="internal-note" className="text-xs text-muted-foreground">Nota interna (solo staff, el Student nunca la ve)</Label>
              </div>
              <Button
                disabled={!canSend}
                onClick={() => reply.mutate({ conversationId, body: trimmed, visibility: internal ? "internal" : "public" })}
              >
                {reply.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                {internal ? "Guardar nota" : "Enviar respuesta"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
