import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useLocation } from "wouter";
import { toast } from "sonner";
import { ChevronLeft, Loader2, Lock, Send } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MESSAGE_MAX_LENGTH = 5000;

/**
 * COM-01 — /:community/messages/:id. Conversación individual del Student:
 * histórico cronológico + composer. Nunca permite: cambiar destinatario,
 * añadir otro Student, convertir en broadcast, cerrar la conversación,
 * cambiar contexto ni crear notas internas (spec §10) — el único control
 * expuesto aquí es responder, y solo si sigue abierta.
 */
export default function MessageDetail() {
  const { t, i18n } = useTranslation();
  const { slug } = useCommunity();
  const [, navigate] = useLocation();
  const { id } = useParams<{ id: string }>();
  const conversationId = Number(id);
  const utils = trpc.useUtils();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [body, setBody] = useState("");

  const { data, isLoading, isError } = trpc.studentMessages.getConversation.useQuery(
    { id: conversationId },
    { enabled: Number.isInteger(conversationId) && conversationId > 0 }
  );

  const markRead = trpc.studentMessages.markRead.useMutation();
  const reply = trpc.studentMessages.reply.useMutation({
    onSuccess: () => {
      setBody("");
      utils.studentMessages.getConversation.invalidate({ id: conversationId });
      utils.studentMessages.myConversations.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  useEffect(() => {
    if (data && !markRead.isPending) markRead.mutate({ conversationId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.conversation.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [data?.messages.length]);

  const trimmed = body.trim();
  const isClosed = data?.conversation.status === "closed";
  const canSend = trimmed.length > 0 && trimmed.length <= MESSAGE_MAX_LENGTH && !isClosed && !reply.isPending;

  function handleSend() {
    if (!canSend) return;
    reply.mutate({ conversationId, body: trimmed });
  }

  if (isLoading) {
    return (
      <SegolifeAppShell requireAuth hideNav title={t("messages.inboxTitle")}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
        </div>
      </SegolifeAppShell>
    );
  }

  if (isError || !data) {
    return (
      <SegolifeAppShell requireAuth hideNav title={t("messages.inboxTitle")}>
        <SegolifePageContainer>
          <SegolifeEmptyState
            icon={<Lock className="size-5" aria-hidden="true" />}
            title={t("messages.notFoundTitle")}
            description={t("messages.notFoundDescription")}
            actionLabel={t("messages.backToInbox")}
            actionHref={`/${slug}/messages`}
          />
        </SegolifePageContainer>
      </SegolifeAppShell>
    );
  }

  return (
    <SegolifeAppShell requireAuth hideNav title={data.conversation.subject}>
      <div className="flex min-h-dvh flex-col">
        <div className="border-b border-border px-4 py-3">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(`/${slug}/messages`)}>
            <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("common.back")}
          </Button>
          <h1 className="mt-1 truncate text-lg font-bold text-foreground">{data.conversation.subject}</h1>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {data.messages.map(m => {
            const isStudent = m.senderRole === "student";
            return (
              <div key={m.id} className={`flex ${isStudent ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${isStudent ? "bg-primary text-primary-foreground" : "segolife-card-shadow bg-card text-foreground"}`}>
                  <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                  <p className={`mt-1 text-[10px] ${isStudent ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {isStudent ? t("messages.senderYou") : t("messages.senderSegolife")} · {new Date(m.createdAt).toLocaleString(i18n.language, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="segolife-safe-bottom border-t border-border px-4 py-3">
          {isClosed ? (
            <p className="flex items-center gap-2 rounded-2xl bg-secondary px-4 py-3 text-sm text-muted-foreground">
              <Lock className="size-4 shrink-0" aria-hidden="true" /> {t("messages.conversationClosed")}
            </p>
          ) : (
            <div className="flex items-end gap-2">
              <Textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={t("messages.composerPlaceholder")}
                maxLength={MESSAGE_MAX_LENGTH}
                rows={2}
                className="flex-1 resize-none"
                aria-label={t("messages.composerPlaceholder")}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <Button size="icon" disabled={!canSend} onClick={handleSend} aria-label={t("messages.send")}>
                {reply.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              </Button>
            </div>
          )}
        </div>
      </div>
    </SegolifeAppShell>
  );
}
