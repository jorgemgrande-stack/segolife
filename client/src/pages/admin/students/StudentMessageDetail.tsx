import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, Send, Lock, LockOpen, Info, Paperclip, X } from "lucide-react";

const MESSAGE_MAX_LENGTH = 5000;
// Mismos límites que chatImageService.ts/studentPhotoService.ts — feedback rápido, la validación real es siempre server-side.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

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
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isError } = trpc.studentMessages.adminGetConversation.useQuery(
    { id: conversationId },
    { enabled: Number.isInteger(conversationId) && conversationId > 0 }
  );

  const markRead = trpc.studentMessages.adminMarkRead.useMutation();
  const trimmed = body.trim();

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_PHOTO_TYPES.has(file.type)) { toast.error("Formato de imagen no permitido."); return; }
    if (file.size > MAX_PHOTO_BYTES) { toast.error("La imagen es demasiado grande (máx. 8MB)."); return; }
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function handleRemovePhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview(null);
  }

  async function handleSend() {
    if (sending) return;
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("body", trimmed);
      formData.append("visibility", internal ? "internal" : "public");
      if (photoFile) formData.append("image", photoFile);

      const res = await fetch(`/api/student-messages/${conversationId}/admin-reply`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const resBody = await res.json().catch(() => null);
      if (!res.ok || !resBody?.success) throw new Error(resBody?.error ?? "No se pudo enviar el mensaje.");

      setBody(""); setInternal(false); handleRemovePhoto();
      utils.studentMessages.adminGetConversation.invalidate({ id: conversationId });
      utils.studentMessages.adminList.invalidate();
      utils.studentMessages.adminPendingCount.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar el mensaje.");
    } finally {
      setSending(false);
    }
  }
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
  const canSend = (trimmed.length > 0 || !!photoFile) && trimmed.length <= MESSAGE_MAX_LENGTH && !isClosed && !sending;

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
                  {m.imageStorageKey && (
                    <img
                      src={`/api/student-messages/messages/${m.id}/image`}
                      alt=""
                      className="mb-1.5 max-h-64 rounded-md object-contain"
                    />
                  )}
                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
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
            {photoPreview && (
              <div className="relative inline-block">
                <img src={photoPreview} alt="" className="h-20 w-20 rounded-md object-cover" />
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  aria-label="Quitar imagen"
                  className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={handleFileSelected}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Switch id="internal-note" checked={internal} onCheckedChange={setInternal} />
                <Label htmlFor="internal-note" className="text-xs text-muted-foreground">Nota interna (solo staff, el Student nunca la ve)</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="w-3.5 h-3.5 mr-1.5" /> {photoFile ? "Cambiar imagen" : "Adjuntar imagen"}
                </Button>
              </div>
              <Button disabled={!canSend} onClick={handleSend}>
                {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                {internal ? "Guardar nota" : "Enviar respuesta"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
