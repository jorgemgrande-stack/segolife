import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { CheckCircle2, XCircle, RotateCcw, Loader2, Send, PackageSearch } from "lucide-react";

const RESOLUTION_NOTE_MAX_LENGTH = 1000;
const MESSAGE_MAX_LENGTH = 5000;

function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL: Record<string, string> = { open: "Abierto", found: "Encontrado", closed_not_found: "Cerrado — no encontrado" };
const ACTION_LABEL: Record<string, string> = {
  marked_found: "Marcado como encontrado",
  marked_closed_not_found: "Cerrado sin encontrarse",
  reopened: "Reabierto",
};

/**
 * LNF-01 — ficha de un caso, reutilizada TAL CUAL desde /admin/lost-found/:id
 * (Global Admin, alcance completo vía comunidad) y desde la pestaña "Objetos
 * perdidos" de la Venue App (venue_admin, alcance de su único venue) — la
 * autorización real vive en el servidor (requireVenueAccess), este
 * componente no decide nada de eso, solo evita mantener dos fichas casi
 * idénticas. La conversación embebida reutiliza COM-01 tal cual (spec §10):
 * envoltorio fino de lostFound.adminGetConversation/adminReplyToConversation,
 * nunca una segunda mensajería.
 */
export default function LostFoundCaseDetail({ reportId }: { reportId: number }) {
  const utils = trpc.useUtils();
  const [resolutionNote, setResolutionNote] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [photoExpanded, setPhotoExpanded] = useState(false);

  const { data, isLoading, isError } = trpc.lostFound.adminGet.useQuery({ id: reportId }, { enabled: Number.isInteger(reportId) && reportId > 0 });

  const convQ = trpc.lostFound.adminGetConversation.useQuery(
    { reportId },
    { enabled: !!data?.report.conversationId }
  );

  const markRead = trpc.lostFound.adminMarkConversationRead.useMutation();
  useEffect(() => {
    if (convQ.data) markRead.mutate({ reportId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convQ.data?.conversation.id]);

  function invalidateAll() {
    utils.lostFound.adminGet.invalidate({ id: reportId });
    utils.lostFound.adminGetConversation.invalidate({ reportId });
    utils.lostFound.adminList.invalidate();
  }

  const markFound = trpc.lostFound.adminMarkFound.useMutation({
    onSuccess: () => { toast.success("Caso marcado como encontrado"); setResolutionNote(""); invalidateAll(); },
    onError: e => toast.error(e.message),
  });
  const markClosedNotFound = trpc.lostFound.adminMarkClosedNotFound.useMutation({
    onSuccess: () => { toast.success("Caso cerrado — no encontrado"); setResolutionNote(""); invalidateAll(); },
    onError: e => toast.error(e.message),
  });
  const reopen = trpc.lostFound.adminReopen.useMutation({
    onSuccess: () => { toast.success("Caso reabierto"); setReopenReason(""); invalidateAll(); },
    onError: e => toast.error(e.message),
  });
  const reply = trpc.lostFound.adminReplyToConversation.useMutation({
    onSuccess: () => { setReplyBody(""); invalidateAll(); },
    onError: e => toast.error(e.message),
  });

  if (isLoading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (isError || !data) return <p className="p-6 text-sm text-muted-foreground">Caso no encontrado.</p>;

  const { report, venueName, communityName, student, actions } = data;
  const trimmedNote = resolutionNote.trim();
  const trimmedReason = reopenReason.trim();
  const trimmedReply = replyBody.trim();
  const busy = markFound.isPending || markClosedNotFound.isPending || reopen.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Caso #{report.id} · {venueName ?? "—"}</h2>
          <p className="text-sm text-muted-foreground">
            {student.name ?? student.email ?? `Student #${student.id}`}
            {student.email && student.name && <span className="text-muted-foreground/70"> · {student.email}</span>}
            {student.phone && <span className="text-muted-foreground/70"> · {student.phone}</span>}
          </p>
          {communityName && <p className="text-xs text-muted-foreground">{communityName}</p>}
        </div>
        <Badge variant={report.status === "found" ? "default" : report.status === "closed_not_found" ? "secondary" : "outline"}>
          {STATUS_LABEL[report.status] ?? report.status}
        </Badge>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Fecha de pérdida</p>
            <p className="text-foreground">{report.lostDate}</p>
          </div>
          {report.approximateTime && (
            <div>
              <p className="text-xs text-muted-foreground">Hora aproximada</p>
              <p className="text-foreground">{report.approximateTime}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">Creado</p>
            <p className="text-foreground">{fmtDateTime(report.createdAt)}</p>
          </div>
          {report.resolvedAt && (
            <div>
              <p className="text-xs text-muted-foreground">Resuelto</p>
              <p className="text-foreground">{fmtDateTime(report.resolvedAt)}</p>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Descripción</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{report.description}</p>
        </div>

        {report.imageStorageKey && (
          <button type="button" onClick={() => setPhotoExpanded(v => !v)} className="block">
            <img
              src={`/api/lost-found/${report.id}/photo`}
              alt="Fotografía del objeto perdido"
              className={photoExpanded ? "max-h-[70vh] rounded-lg object-contain" : "h-28 w-28 rounded-lg object-cover"}
            />
          </button>
        )}

        {report.resolutionNote && (
          <div className="rounded-lg bg-secondary p-3">
            <p className="text-xs font-medium text-secondary-foreground/80">Última nota de resolución</p>
            <p className="mt-0.5 text-sm text-secondary-foreground">{report.resolutionNote}</p>
          </div>
        )}
      </div>

      {report.status === "open" ? (
        <div className="bg-card border border-border rounded-lg p-4 space-y-2">
          <p className="text-sm font-medium text-foreground">Resolver caso</p>
          <Textarea
            value={resolutionNote}
            onChange={e => setResolutionNote(e.target.value)}
            maxLength={RESOLUTION_NOTE_MAX_LENGTH}
            rows={3}
            placeholder="Mensaje para el Student (p. ej. 'Hemos encontrado una cartera que coincide con tu descripción. Puedes recogerla en...')"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!trimmedNote || busy}
              onClick={() => markFound.mutate({ reportId, resolutionNote: trimmedNote })}
            >
              {markFound.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
              Marcar encontrado
            </Button>
            <Button
              variant="outline"
              disabled={!trimmedNote || busy}
              onClick={() => markClosedNotFound.mutate({ reportId, resolutionNote: trimmedNote })}
            >
              {markClosedNotFound.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <XCircle className="w-4 h-4 mr-1.5" />}
              Marcar perdido definitivamente
            </Button>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-4 space-y-2">
          <p className="text-sm font-medium text-foreground">Reabrir caso</p>
          <Input value={reopenReason} onChange={e => setReopenReason(e.target.value)} maxLength={500} placeholder="Motivo de la reapertura" />
          <Button variant="outline" disabled={!trimmedReason || busy} onClick={() => reopen.mutate({ reportId, reason: trimmedReason })}>
            {reopen.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-1.5" />}
            Reabrir
          </Button>
        </div>
      )}

      {actions.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="mb-2 text-sm font-medium text-foreground">Historial</p>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {actions.map(a => (
              <li key={a.id}>
                {fmtDateTime(a.createdAt)} · {ACTION_LABEL[a.action] ?? a.action}
                {a.reason && <span> — {a.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <PackageSearch className="w-4 h-4" aria-hidden="true" /> Conversación con el Student
        </p>
        {convQ.isLoading ? (
          <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : !convQ.data ? (
          <p className="text-sm text-muted-foreground">Sin conversación todavía.</p>
        ) : (
          <>
            <div className="max-h-[40vh] space-y-3 overflow-y-auto">
              {convQ.data.messages.map(m => {
                const isAdmin = m.senderRole === "admin";
                return (
                  <div key={m.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${isAdmin ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`mt-1 text-[10px] ${isAdmin ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {isAdmin ? "Admin" : "Student"} · {fmtDateTime(m.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="space-y-2">
              <Textarea
                value={replyBody}
                onChange={e => setReplyBody(e.target.value)}
                maxLength={MESSAGE_MAX_LENGTH}
                rows={2}
                placeholder="Escribe un mensaje al Student…"
              />
              <Button
                disabled={!trimmedReply || reply.isPending}
                onClick={() => reply.mutate({ reportId, body: trimmedReply })}
              >
                {reply.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                Enviar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
