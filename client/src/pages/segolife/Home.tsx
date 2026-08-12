import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Coins, Gift, ChevronRight, Flame, Sparkles, PartyPopper, Vote } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeEventCard } from "@/components/segolife/SegolifeEventCard";
import { SegolifeVenueCard } from "@/components/segolife/SegolifeVenueCard";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { SegolifeWalletSkeleton, SegolifeCardRowSkeleton } from "@/components/segolife/SegolifeSkeletons";
import { Progress } from "@/components/ui/progress";

/**
 * Home definitiva de Segolife (Fase 6) — responde "¿qué pasa hoy/esta
 * noche?" en vez de ser una home corporativa. Orden: saludo → wallet →
 * benefit destacado → tonight → featured → campaña → recurrencia → venues
 * → próximos eventos. Todo dato real (home.getSummary + venues/events
 * públicos ya existentes) — ningún módulo se muestra si no hay datos reales
 * que mostrarle (spec, punto 44: "REAL DATA ONLY").
 */
function greetingKey(hour: number): "greetingMorning" | "greetingAfternoon" | "greetingEvening" {
  if (hour < 12) return "greetingMorning";
  if (hour < 19) return "greetingAfternoon";
  return "greetingEvening";
}

export default function Home() {
  const { t, i18n } = useTranslation();
  const { community, slug } = useCommunity();

  const { data: summary, isLoading } = trpc.home.getSummary.useQuery();
  const { data: me } = trpc.students.me.useQuery();
  const { data: venues } = trpc.venues.publicActive.useQuery({ communityId: community?.id });
  const { data: activeComunity } = trpc.community.myActive.useQuery();

  const firstName = me?.profile.firstName ?? me?.user.name?.split(" ")[0] ?? "";
  const hour = new Date().getHours();
  const greeting = t(`home.${greetingKey(hour)}`);

  return (
    <SegolifeAppShell requireAuth title={t("home.tonightTitle")}>
      <SegolifePageContainer className="space-y-7">
        <div>
          <p className="text-xl font-semibold text-foreground">{greeting}{firstName ? `, ${firstName}` : ""}</p>
          {community?.name && <p className="text-sm text-muted-foreground">{community.name}</p>}
        </div>

        {isLoading ? (
          <SegolifeWalletSkeleton />
        ) : (
          <Link href={`/${slug}/rewards`} className="block segolife-elevated-shadow rounded-3xl bg-primary p-5 text-primary-foreground">
            <div className="flex items-center justify-between">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary-foreground/80">
                  <Coins className="size-3.5" aria-hidden="true" /> {t("home.walletBalance")}
                </p>
                <p className="mt-1 text-4xl font-bold tabular-nums">{(summary?.walletBalance ?? 0).toLocaleString(i18n.language)}</p>
                {!!summary?.earnedThisWeek && (
                  <p className="mt-1.5 text-xs text-primary-foreground/80">{t("home.earnedThisWeek", { count: summary.earnedThisWeek })}</p>
                )}
              </div>
              <ChevronRight className="size-5 text-primary-foreground/70" aria-hidden="true" />
            </div>
          </Link>
        )}

        {summary?.activeBenefit && (
          <Link
            href={`/${slug}/benefits/${summary.activeBenefit.id}`}
            className="block segolife-card-shadow rounded-3xl border border-accent/30 bg-accent/10 p-4"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <PartyPopper className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-accent">{t("home.benefitUnlockedTitle")}</p>
                <p className="truncate text-sm font-semibold text-foreground">
                  {i18n.language === "en"
                    ? (summary.activeBenefit.definition.nameEn ?? summary.activeBenefit.definition.name)
                    : (summary.activeBenefit.definition.nameEs ?? summary.activeBenefit.definition.name)}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </div>
          </Link>
        )}

        {!!activeComunity?.length && (
          <Link
            href={`/${slug}/comunity`}
            className="block segolife-card-shadow rounded-3xl border border-primary/30 bg-primary/5 p-4"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Vote className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{t("home.comunityTitle")}</p>
                <p className="truncate text-sm font-semibold text-foreground">
                  {t("home.comunityActiveCount", { count: activeComunity.length })}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </div>
          </Link>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
              <Flame className="size-4 text-accent" aria-hidden="true" /> {t("home.tonightTitle")}
            </h2>
            <Link href={`/${slug}/explore`} className="text-xs font-medium text-primary">{t("home.exploreAll")}</Link>
          </div>
          {isLoading ? (
            <SegolifeCardRowSkeleton />
          ) : !summary?.tonightEvents.length ? (
            <SegolifeEmptyState
              icon={<Flame className="size-5" aria-hidden="true" />}
              title={t("home.noEventsTonight")}
              description={t("home.noEventsTonightDescription")}
            />
          ) : (
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
              {summary.tonightEvents.map(e => (
                <SegolifeEventCard key={e.id} event={e} slug={slug!} className="w-36 shrink-0" />
              ))}
            </div>
          )}
        </section>

        {!!summary?.featuredEvents.length && (
          <section className="space-y-3">
            <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
              <Sparkles className="size-4 text-primary" aria-hidden="true" /> {t("home.featuredTitle")}
            </h2>
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
              {summary.featuredEvents.map(e => (
                <SegolifeEventCard key={e.id} event={e} slug={slug!} className="w-36 shrink-0" />
              ))}
            </div>
          </section>
        )}

        {summary?.activeCampaign && (
          <div className="segolife-card-shadow flex items-center gap-2 rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground">
            <Sparkles className="size-4 shrink-0" aria-hidden="true" />
            <p className="text-sm font-medium">
              {summary.activeCampaign.name}
              {summary.activeCampaign.multiplier ? ` ×${summary.activeCampaign.multiplier}` : ""}
            </p>
          </div>
        )}

        {summary?.recurrenceProgress && summary.recurrenceProgress.remaining > 0 && (
          <div className="segolife-card-shadow rounded-2xl bg-card p-4">
            <p className="text-sm font-semibold text-foreground">
              {t("home.recurrenceTitle", { count: summary.recurrenceProgress.count })}
            </p>
            <Progress
              value={(summary.recurrenceProgress.count / summary.recurrenceProgress.threshold) * 100}
              className="mt-2.5 h-2"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {t("home.recurrenceNextReward", { remaining: summary.recurrenceProgress.remaining, bonus: summary.recurrenceProgress.bonus })}
            </p>
          </div>
        )}

        {!!venues?.length && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">{t("home.venuesTitle")}</h2>
              <Link href={`/${slug}/explore`} className="text-xs font-medium text-primary">{t("home.exploreAll")}</Link>
            </div>
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
              {venues.slice(0, 8).map(v => (
                <SegolifeVenueCard key={v.id} venue={{ ...v, categoryName: v.category?.name }} slug={slug!} className="w-28 shrink-0" />
              ))}
            </div>
          </section>
        )}

        <Link
          href={`/${slug}/scan`}
          className="segolife-elevated-shadow flex items-center justify-center gap-2 rounded-full bg-foreground py-4 text-sm font-semibold text-background"
        >
          <Gift className="size-4" aria-hidden="true" /> {t("home.scanCta")}
        </Link>
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
