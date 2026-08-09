import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { ChevronLeft, Bell, Calendar, Coins, Gift, Megaphone, UserCog } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { SegolifeRowSkeleton } from "@/components/segolife/SegolifeSkeletons";
import { Button } from "@/components/ui/button";

type NotificationCategory = "events" | "rewards" | "benefits" | "promotions" | "account";

const CATEGORY_ICON: Record<NotificationCategory, typeof Bell> = {
  events: Calendar,
  rewards: Coins,
  benefits: Gift,
  promotions: Megaphone,
  account: UserCog,
};

const CATEGORY_STYLES: Record<NotificationCategory, string> = {
  events: "bg-primary/10 text-primary",
  rewards: "bg-primary/10 text-primary",
  benefits: "bg-accent/10 text-accent",
  promotions: "bg-accent/10 text-accent",
  account: "bg-secondary text-muted-foreground",
};

/**
 * Inbox del estudiante — /:community/notifications (Fase 7, spec puntos
 * 13-17). Fuente de verdad real del sistema de notificaciones: la campana en
 * el header solo muestra un contador, todo el contenido vive aquí. Tocar una
 * fila la marca como leída (y como "clicked" si tiene deep link) y navega —
 * el deep link ya viene saneado por el backend (deepLinkPolicy.ts), nunca se
 * confía en una URL externa aquí tampoco.
 */
export default function Notifications() {
  const { t, i18n } = useTranslation();
  const { slug } = useCommunity();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: notifications, isLoading } = trpc.studentNotifications.myNotifications.useQuery({ limit: 50 });

  const markRead = trpc.studentNotifications.markRead.useMutation({
    onSuccess: () => { utils.studentNotifications.unreadCount.invalidate(); utils.studentNotifications.myNotifications.invalidate(); },
  });
  const markClicked = trpc.studentNotifications.markClicked.useMutation();
  const markAllRead = trpc.studentNotifications.markAllRead.useMutation({
    onSuccess: () => { utils.studentNotifications.unreadCount.invalidate(); utils.studentNotifications.myNotifications.invalidate(); },
  });

  const hasUnread = (notifications ?? []).some(n => !n.readAt);

  function handleOpen(n: NonNullable<typeof notifications>[number]) {
    if (!n.readAt) markRead.mutate({ id: n.id });
    if (n.deepLink) {
      markClicked.mutate({ id: n.id });
      navigate(n.deepLink);
    }
  }

  return (
    <SegolifeAppShell requireAuth hideNav title={t("notifications.inboxTitle")}>
      <SegolifePageContainer>
        <div className="mb-2 flex items-center justify-between">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(`/${slug}/profile`)}>
            <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("common.back")}
          </Button>
          {hasUnread && (
            <Button variant="ghost" size="sm" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
              {t("notifications.markAllRead")}
            </Button>
          )}
        </div>

        <h1 className="mb-4 text-xl font-bold text-foreground">{t("notifications.inboxTitle")}</h1>

        {isLoading ? (
          <SegolifeRowSkeleton count={6} />
        ) : !notifications || notifications.length === 0 ? (
          <SegolifeEmptyState
            icon={<Bell className="size-5" aria-hidden="true" />}
            title={t("notifications.empty")}
            description={t("notifications.emptyDescription")}
          />
        ) : (
          <div className="space-y-2">
            {notifications.map(n => {
              const category = n.category as NotificationCategory;
              const Icon = CATEGORY_ICON[category] ?? Bell;
              const title = i18n.language === "es" ? n.titleEs : n.titleEn;
              const body = i18n.language === "es" ? n.bodyEs : n.bodyEn;
              const isUnread = !n.readAt;
              return (
                <button
                  key={n.id}
                  onClick={() => handleOpen(n)}
                  className={`segolife-card-shadow flex w-full items-start gap-3 rounded-2xl bg-card p-3 text-left transition-opacity ${isUnread ? "" : "opacity-60"}`}
                >
                  <div className={`flex size-11 shrink-0 items-center justify-center rounded-full ${CATEGORY_STYLES[category] ?? CATEGORY_STYLES.account}`}>
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-foreground">{title}</p>
                      {isUnread && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString(i18n.language, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
