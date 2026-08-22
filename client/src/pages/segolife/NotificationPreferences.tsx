import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ChevronLeft, Loader2, Bell, BellOff } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePushSubscription, isPushSupported } from "@/hooks/usePushSubscription";

type NotificationCategory = "events" | "rewards" | "benefits" | "promotions" | "account";
type MarketingChannel = "email" | "push" | "whatsapp";

const CATEGORIES: NotificationCategory[] = ["events", "rewards", "benefits", "promotions", "account"];
const CHANNELS: MarketingChannel[] = ["email", "push", "whatsapp"];

const CATEGORY_LABEL_KEY: Record<NotificationCategory, string> = {
  events: "notifications.categoryEvents",
  rewards: "notifications.categoryRewards",
  benefits: "notifications.categoryBenefits",
  promotions: "notifications.categoryPromotions",
  account: "notifications.categoryAccount",
};

const CHANNEL_LABEL_KEY: Record<MarketingChannel, string> = {
  email: "notifications.channelEmail",
  push: "notifications.channelPush",
  whatsapp: "notifications.channelWhatsapp",
};

/**
 * Ajustes de notificaciones — /:community/settings/notifications (Fase 7,
 * spec puntos 63/72). Solo canales realmente configurados aparecen
 * accionables (channelAvailability) — nunca se muestra push/WhatsApp como si
 * funcionaran cuando el provider no está configurado. in_app nunca aparece
 * aquí: no es desactivable (ver studentNotifications.ts, updatePreferences).
 */
export default function NotificationPreferences() {
  const { t } = useTranslation();
  const { slug } = useCommunity();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: preferences, isLoading: prefsLoading } = trpc.studentNotifications.preferences.useQuery();
  const { data: availability, isLoading: availLoading } = trpc.studentNotifications.channelAvailability.useQuery();

  // F67 (Push + WhatsApp) — "activado en este dispositivo" es una acción
  // aparte de la preferencia de categoría/canal de arriba: un estudiante
  // puede tener push permitido a nivel de preferencia pero nunca haber
  // concedido el permiso del navegador en ESTE dispositivo concreto. Solo
  // se ofrece si el provider está realmente configurado (availability.push)
  // — nunca un botón que prometa algo que el backend no puede cumplir.
  const { data: hasActiveSubscription, isLoading: subLoading } = trpc.studentNotifications.hasActivePushSubscription.useQuery(undefined, {
    enabled: !!availability?.push,
  });
  const { subscribe, unsubscribe, isSubscribing } = usePushSubscription();

  async function handleActivatePush() {
    const result = await subscribe();
    if (result.ok) {
      toast.success(t("notifications.pushActivated"));
    } else if (result.reason === "denied") {
      toast.error(t("notifications.pushDenied"));
    } else {
      toast.error(t("notifications.pushError"));
    }
  }

  async function handleDeactivatePush() {
    await unsubscribe();
    toast.success(t("notifications.pushDeactivated"));
  }

  const updatePreference = trpc.studentNotifications.updatePreferences.useMutation({
    onSuccess: () => { utils.studentNotifications.preferences.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const isLoading = prefsLoading || availLoading;

  function isEnabled(category: NotificationCategory, channel: MarketingChannel): boolean {
    return preferences?.find(p => p.category === category && p.channel === channel)?.enabled ?? false;
  }

  function handleToggle(category: NotificationCategory, channel: MarketingChannel, enabled: boolean) {
    updatePreference.mutate({ category, channel, enabled });
  }

  return (
    <SegolifeAppShell requireAuth hideNav title={t("notifications.settingsTitle")}>
      <SegolifePageContainer>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(`/${slug}/profile`)}>
          <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("common.back")}
        </Button>

        <h1 className="text-xl font-bold text-foreground">{t("notifications.settingsTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("notifications.settingsDescription")}</p>

        {isLoading ? (
          <div className="mt-8 flex justify-center">
            <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {availability?.push && isPushSupported() && (
              <section className="segolife-card-shadow flex items-center justify-between gap-3 rounded-2xl bg-card p-4">
                <div className="flex min-w-0 items-center gap-3">
                  {hasActiveSubscription ? <Bell className="size-5 shrink-0 text-primary" aria-hidden="true" /> : <BellOff className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{t("notifications.pushDeviceTitle")}</p>
                    <p className="text-xs text-muted-foreground">{hasActiveSubscription ? t("notifications.pushDeviceActive") : t("notifications.pushDeviceInactive")}</p>
                  </div>
                </div>
                {subLoading ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground shrink-0" aria-hidden="true" />
                ) : hasActiveSubscription ? (
                  <Button size="sm" variant="outline" className="shrink-0" onClick={handleDeactivatePush}>{t("notifications.pushDeactivate")}</Button>
                ) : (
                  <Button size="sm" className="shrink-0" disabled={isSubscribing} onClick={handleActivatePush}>
                    {isSubscribing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" /> : null}
                    {t("notifications.pushActivate")}
                  </Button>
                )}
              </section>
            )}

            {CATEGORIES.map(category => (
              <section key={category} className="segolife-card-shadow rounded-2xl bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">{t(CATEGORY_LABEL_KEY[category])}</h2>
                <div className="mt-3 space-y-3">
                  {CHANNELS.map(channel => {
                    const available = !!availability?.[channel];
                    return (
                      <div key={channel} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground">{t(CHANNEL_LABEL_KEY[channel])}</p>
                          {!available && <p className="text-xs text-muted-foreground">{t("notifications.channelUnavailable")}</p>}
                        </div>
                        <Switch
                          checked={available && isEnabled(category, channel)}
                          disabled={!available || updatePreference.isPending}
                          onCheckedChange={v => handleToggle(category, channel, v)}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            <p className="px-1 text-xs text-muted-foreground">{t("notifications.transactionalNote")}</p>
          </div>
        )}
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
