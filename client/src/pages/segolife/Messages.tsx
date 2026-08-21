import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { ChevronLeft, MessageCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { SegolifeRowSkeleton } from "@/components/segolife/SegolifeSkeletons";
import { Button } from "@/components/ui/button";

/**
 * COM-01 — /:community/messages. Lista de conversaciones del Student
 * (siempre las SUYAS, resueltas server-side por ctx.user.id — nunca un id
 * enviado desde aquí). Sin selector de comunidad ni forma de iniciar una
 * conversación nueva a propósito (spec §11: "COM-01 NO crea un chat libre
 * con Segolife" — el Student solo responde a lo que Admin ya inició).
 */
export default function Messages() {
  const { t, i18n } = useTranslation();
  const { slug } = useCommunity();
  const [, navigate] = useLocation();

  const { data, isLoading } = trpc.studentMessages.myConversations.useQuery({ limit: 50 });
  const items = data?.items ?? [];

  return (
    <SegolifeAppShell requireAuth hideNav title={t("messages.inboxTitle")}>
      <SegolifePageContainer>
        <div className="mb-2">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(`/${slug}/profile`)}>
            <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("common.back")}
          </Button>
        </div>

        <h1 className="mb-4 text-xl font-bold text-foreground">{t("messages.inboxTitle")}</h1>

        {isLoading ? (
          <SegolifeRowSkeleton count={4} />
        ) : items.length === 0 ? (
          <SegolifeEmptyState
            icon={<MessageCircle className="size-5" aria-hidden="true" />}
            title={t("messages.empty")}
            description={t("messages.emptyDescription")}
          />
        ) : (
          <div className="space-y-2">
            {items.map(c => (
              <Link
                key={c.id}
                href={`/${slug}/messages/${c.id}`}
                className={`segolife-card-shadow flex w-full items-start gap-3 rounded-2xl bg-card p-3 text-left transition-opacity ${c.unread ? "" : "opacity-70"}`}
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <MessageCircle className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-foreground">{c.subject}</p>
                    {c.unread && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
                  </div>
                  {c.lastMessagePreview && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{c.lastMessagePreview}</p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    {c.lastMessageAt && (
                      <span>{new Date(c.lastMessageAt).toLocaleString(i18n.language, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    )}
                    {c.status === "closed" && <span className="rounded-full bg-secondary px-1.5 py-0.5 font-medium">{t("messages.statusClosed")}</span>}
                    {c.status === "open" && c.waitingFor === "student" && <span className="font-medium text-primary">{t("messages.waitingForYou")}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
