import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Coins, Gift, ChevronRight, Flame, Sparkles, PartyPopper, Vote, Ticket, Compass, UserRound, Clock3, CheckCircle2, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatCardRewardBadge } from "@/lib/rewardPreview";
import { useCommunity } from "@/contexts/CommunityContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeEventCard } from "@/components/segolife/SegolifeEventCard";
import { SegolifeVenueCard } from "@/components/segolife/SegolifeVenueCard";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { SegolifeWalletSkeleton, SegolifeCardRowSkeleton, SegolifeRowSkeleton } from "@/components/segolife/SegolifeSkeletons";
import { Progress } from "@/components/ui/progress";
import CommunityPublicLanding from "./CommunityPublicLanding";

/**
 * Home de Segolife en /:community — Fase 15.1 (corrección tras un bug real
 * reportado con capturas): la versión anterior (Fase 15 "remate") pintaba la
 * landing pública anónima DENTRO de SegolifeAppShell — el mismo shell de la
 * Student App autenticada — así que un visitante sin sesión veía el sidebar
 * de Home/Explore/Comunity/Tickets/Scan/Rewards/Perfil y los iconos de
 * campana/perfil, como si ya hubiera iniciado sesión. Home() ahora decide
 * ANTES de montar ningún shell: con sesión, envuelve el dashboard
 * personalizado de siempre (AuthenticatedHome) en SegolifeAppShell, sin
 * cambios; sin sesión, monta CommunityPublicLanding — que NUNCA importa
 * SegolifeAppShell, usa el mismo sistema visual público que la Home master
 * (PublicHomeNav/Footer + secciones reexportadas de PublicHome.tsx).
 */
export default function Home() {
  const { t } = useTranslation();
  const { community, slug, loading: communityLoading } = useCommunity();
  const { isAuthenticated, loading: authLoading } = useAuth();

  if (communityLoading || authLoading) {
    return (
      <div className="segolife-theme flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <CommunityPublicLanding community={community} slug={slug} />;
  }

  return (
    <SegolifeAppShell title={t("home.tonightTitle")}>
      <AuthenticatedHome />
    </SegolifeAppShell>
  );
}

function greetingKey(hour: number): "greetingMorning" | "greetingAfternoon" | "greetingEvening" {
  if (hour < 12) return "greetingMorning";
  if (hour < 19) return "greetingAfternoon";
  return "greetingEvening";
}

const ACTIVITY_ICON: Record<string, typeof Coins> = {
  earned: Coins,
  spent: Coins,
  benefitUnlocked: Gift,
  benefitUsed: CheckCircle2,
};

const ACTIVITY_KICKER_KEY: Record<string, string> = {
  earned: "activity.typeEarned",
  spent: "activity.typeSpent",
  benefitUnlocked: "activity.typeBenefitUnlocked",
  benefitUsed: "activity.typeBenefitUsed",
};

/**
 * Home definitiva de Segolife (STUDENT APP, PERSONALIZED HOME) — responde
 * "¿qué pasa para mí?" en vez de listar módulos. Orden: saludo → wallet →
 * HERO (Next Best Action, spec §8) → For You (resto de candidatos
 * priorizados, spec §9/§23, deduplicados por construcción — spec §24) →
 * Tonight → Featured → campaña → recurrencia → Actividad reciente → venues
 * → scan. Todo el ranking (`summary.ranking`) ya viene decidido por el
 * servidor (homeFeedRanking.ts, reglas deterministas, spec §22: sin IA/ML) —
 * esta página solo pinta el resultado. REAL DATA ONLY (spec §48): cada
 * sección desaparece si no hay dato real que mostrar, nunca se rellena con
 * un placeholder.
 */
function AuthenticatedHome() {
  const { t, i18n } = useTranslation();
  const { community, slug } = useCommunity();

  const { data: summary, isLoading } = trpc.home.getSummary.useQuery({ communityId: community?.id });
  const { data: walletValue } = trpc.tokens.myWalletPromotionalValue.useQuery();
  type HomeCardKind = NonNullable<typeof summary>["ranking"]["forYou"][number];
  const { data: me } = trpc.students.me.useQuery();
  const { data: venues } = trpc.venues.publicActive.useQuery({ communityId: community?.id });
  const track = trpc.studentAnalytics.track.useMutation();

  const firstName = me?.profile.firstName ?? me?.user.name?.split(" ")[0] ?? "";
  const hour = new Date().getHours();
  const greeting = t(`home.${greetingKey(hour)}`);

  useEffect(() => {
    track.mutate({ event: "student_home_viewed" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function trackCard(kind: HomeCardKind | "wallet" | "venue" | "event") {
    track.mutate({ event: "home_card_clicked", kind });
    const eventByKind: Partial<Record<string, "event_opened" | "community_opened" | "benefit_opened" | "venue_opened" | "wallet_opened">> = {
      ticket: "event_opened",
      tonight: "event_opened",
      event: "event_opened",
      community: "community_opened",
      benefit_active: "benefit_opened",
      marketplace: "benefit_opened",
      venue: "venue_opened",
      wallet: "wallet_opened",
    };
    const mapped = eventByKind[kind];
    if (mapped) track.mutate({ event: mapped, kind });
  }

  const hero = summary?.ranking.hero ?? null;
  const forYou = (summary?.ranking.forYou ?? []).filter(k => k !== "tonight");
  const ticketEventId = summary?.myTicketToday?.event?.id;
  const tonightEvents = ticketEventId
    ? (summary?.tonightEvents ?? []).filter(e => e.id !== ticketEventId)
    : (summary?.tonightEvents ?? []);
  const marketplaceVenueName = summary?.marketplaceRecommendation?.destinationVenueId != null
    ? venues?.find(v => v.id === summary.marketplaceRecommendation!.destinationVenueId)?.name
    : undefined;

  // SEGOTOKENS REWARD PREVIEW (Fase 10.6, spec §31/§33) — un solo lote para
  // Tonight+Featured (Home ya requiere sesión, nunca necesita el guard
  // isAuthenticated que sí usa Explore, que es pública).
  const homeEventBatchItems = useMemo(() => {
    const seen = new Set<number>();
    const items: { key: string; eventId: number; venueId?: number }[] = [];
    for (const e of [...tonightEvents, ...(summary?.featuredEvents ?? [])]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      items.push({ key: String(e.id), eventId: e.id, venueId: e.venue?.id ?? undefined });
    }
    return items.slice(0, 24);
  }, [tonightEvents, summary?.featuredEvents]);
  const homeRewardBatchQ = trpc.tokens.previewMyEventRewardBatch.useQuery(
    { items: homeEventBatchItems },
    { enabled: homeEventBatchItems.length > 0 }
  );

  function renderCard(kind: HomeCardKind, elevated: boolean) {
    const shell = elevated
      ? "block segolife-elevated-shadow rounded-3xl p-5"
      : "block segolife-card-shadow rounded-3xl p-4";
    const iconWrap = elevated ? "flex size-12 shrink-0 items-center justify-center rounded-2xl" : "flex size-11 shrink-0 items-center justify-center rounded-2xl";
    const kicker = elevated ? "text-[10px] font-bold uppercase tracking-widest" : "text-[10px] font-bold uppercase tracking-widest";
    const title = elevated ? "mt-0.5 text-base font-semibold text-foreground" : "truncate text-sm font-semibold text-foreground";

    if (kind === "ticket" && summary?.myTicketToday?.event) {
      const ev = summary.myTicketToday.event;
      const time = new Date(ev.startsAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
      return (
        <Link key="ticket" href={`/${slug}/tickets/${summary.myTicketToday.id}`} onClick={() => trackCard("ticket")} className={`${shell} border border-primary/30 bg-primary/5`}>
          <div className="flex items-center gap-3">
            <div className={`${iconWrap} bg-primary text-primary-foreground`}><Ticket className="size-5" aria-hidden="true" /></div>
            <div className="min-w-0 flex-1">
              <p className={`${kicker} text-primary`}>{t("home.ticketReadyKicker")}</p>
              <p className={title}>{ev.name}</p>
              <p className="text-xs text-muted-foreground">{time}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
        </Link>
      );
    }

    if (kind === "community" && (summary?.activeCommunityCount ?? 0) > 0) {
      return (
        <Link key="community" href={`/${slug}/comunity`} onClick={() => trackCard("community")} className={`${shell} border border-primary/30 bg-primary/5`}>
          <div className="flex items-center gap-3">
            <div className={`${iconWrap} bg-primary text-primary-foreground`}><Vote className="size-5" aria-hidden="true" /></div>
            <div className="min-w-0 flex-1">
              <p className={`${kicker} text-primary`}>{t("home.comunityTitle")}</p>
              <p className={title}>{t("home.comunityActiveCount", { count: summary!.activeCommunityCount })}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
        </Link>
      );
    }

    if (kind === "benefit_active" && summary?.activeBenefit) {
      const name = i18n.language === "en"
        ? (summary.activeBenefit.definition.nameEn ?? summary.activeBenefit.definition.name)
        : (summary.activeBenefit.definition.nameEs ?? summary.activeBenefit.definition.name);
      return (
        <Link key="benefit_active" href={`/${slug}/benefits/${summary.activeBenefit.id}`} onClick={() => trackCard("benefit_active")} className={`${shell} border border-accent/30 bg-accent/10`}>
          <div className="flex items-center gap-3">
            <div className={`${iconWrap} bg-accent text-accent-foreground`}><PartyPopper className="size-5" aria-hidden="true" /></div>
            <div className="min-w-0 flex-1">
              <p className={`${kicker} text-accent`}>{t("home.benefitUnlockedTitle")}</p>
              <p className={title}>{name}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
        </Link>
      );
    }

    if (kind === "marketplace" && summary?.marketplaceRecommendation) {
      const item = summary.marketplaceRecommendation;
      const name = i18n.language === "en" ? (item.nameEn ?? item.name) : (item.nameEs ?? item.name);
      return (
        <Link key="marketplace" href={`/${slug}/rewards/marketplace/${item.id}`} onClick={() => trackCard("marketplace")} className={`${shell} border border-secondary bg-secondary/40`}>
          <div className="flex items-center gap-3">
            <div className={`${iconWrap} bg-foreground text-background`}><Gift className="size-5" aria-hidden="true" /></div>
            <div className="min-w-0 flex-1">
              <p className={`${kicker} text-foreground/70`}>{t("home.marketplaceKicker")}</p>
              <p className={title}>{name}{marketplaceVenueName ? ` · ${marketplaceVenueName}` : ""}</p>
              <p className="text-xs text-muted-foreground">{t("marketplace.tokenCostBadge", { count: item.tokenCost })} · {t("home.marketplaceBalance", { count: summary.walletBalance })}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
        </Link>
      );
    }

    if (kind === "cross_venue" && summary?.crossVenueDiscovery) {
      return (
        <Link key="cross_venue" href={`/${slug}/explore`} onClick={() => trackCard("cross_venue")} className={`${shell} border border-primary/30 bg-primary/5`}>
          <div className="flex items-center gap-3">
            <div className={`${iconWrap} bg-primary text-primary-foreground`}><Compass className="size-5" aria-hidden="true" /></div>
            <div className="min-w-0 flex-1">
              <p className={`${kicker} text-primary`}>{t("home.crossVenueKicker")}</p>
              <p className={title}>{t("home.crossVenueTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("home.crossVenueBonus", { count: summary.crossVenueDiscovery.bonus })}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
        </Link>
      );
    }

    if (kind === "profile" && summary) {
      return (
        <Link key="profile" href={`/${slug}/profile`} onClick={() => trackCard("profile")} className={`${shell} border border-border bg-card`}>
          <div className="flex items-center gap-3">
            <div className={`${iconWrap} bg-secondary text-foreground`}><UserRound className="size-5" aria-hidden="true" /></div>
            <div className="min-w-0 flex-1">
              <p className={`${kicker} text-muted-foreground`}>{t("home.profileKicker")}</p>
              <p className={title}>{t("home.profileTitle", { percent: summary.profileCompleteness.percent })}</p>
              <Progress value={summary.profileCompleteness.percent} className="mt-1.5 h-1.5" />
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
        </Link>
      );
    }

    return null;
  }

  return (
    <SegolifePageContainer className="space-y-7">
      <div>
        <p className="text-xl font-semibold text-foreground">{greeting}{firstName ? `, ${firstName}` : ""}</p>
        {community?.name && <p className="text-sm text-muted-foreground">{community.name}</p>}
      </div>

      {isLoading ? (
        <SegolifeWalletSkeleton />
      ) : (
        <Link href={`/${slug}/rewards`} onClick={() => trackCard("wallet")} className="block segolife-elevated-shadow rounded-3xl bg-primary p-5 text-primary-foreground">
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary-foreground/80">
                <Coins className="size-3.5" aria-hidden="true" /> {t("home.walletBalance")}
              </p>
              <p className="mt-1 text-4xl font-bold tabular-nums">{(summary?.walletBalance ?? 0).toLocaleString(i18n.language)}</p>
              {walletValue?.promotionalValue && (
                <p className="mt-1 text-xs text-primary-foreground/80">{t("rewardPreview.approxValue", { value: walletValue.promotionalValue.formatted })}</p>
              )}
              {!!summary?.earnedThisWeek && (
                <p className="mt-1.5 text-xs text-primary-foreground/80">{t("home.earnedThisWeek", { count: summary.earnedThisWeek })}</p>
              )}
            </div>
            <ChevronRight className="size-5 text-primary-foreground/70" aria-hidden="true" />
          </div>
        </Link>
      )}

      {!isLoading && hero && renderCard(hero, true)}

      {!!forYou.length && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{t("home.forYouTitle")}</h2>
          <div className="space-y-2.5">
            {forYou.map(kind => renderCard(kind, false))}
          </div>
        </section>
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
        ) : !tonightEvents.length ? (
          <SegolifeEmptyState
            icon={<Flame className="size-5" aria-hidden="true" />}
            title={t("home.noEventsTonight")}
            description={t("home.noEventsTonightDescription")}
          />
        ) : (
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {tonightEvents.map(e => (
              <div key={e.id} className="contents" onClick={() => trackCard("event")}>
                <SegolifeEventCard event={e} slug={slug!} className="w-36 shrink-0" rewardBadge={formatCardRewardBadge(homeRewardBatchQ.data?.[String(e.id)], t)} />
              </div>
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
              <div key={e.id} className="contents" onClick={() => trackCard("event")}>
                <SegolifeEventCard event={e} slug={slug!} className="w-36 shrink-0" rewardBadge={formatCardRewardBadge(homeRewardBatchQ.data?.[String(e.id)], t)} />
              </div>
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

      {!isLoading && !!summary?.recentActivity.length && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
              <Clock3 className="size-4 text-muted-foreground" aria-hidden="true" /> {t("home.activityTitle")}
            </h2>
            <Link href={`/${slug}/activity`} className="text-xs font-medium text-primary">{t("home.activityViewAll")}</Link>
          </div>
          <div className="space-y-2">
            {summary.recentActivity.map(entry => {
              const Icon = ACTIVITY_ICON[entry.type] ?? Coins;
              return (
                <div key={entry.id} className="segolife-card-shadow flex items-center gap-3 rounded-2xl bg-card p-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                    <Icon className="size-4.5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t(ACTIVITY_KICKER_KEY[entry.type])}</p>
                    <p className="truncate text-sm font-semibold text-foreground">{entry.label}</p>
                  </div>
                  {entry.amount != null && (entry.type === "earned" || entry.type === "spent") && (
                    <span className={`shrink-0 text-sm font-semibold tabular-nums ${entry.type === "earned" ? "text-primary" : "text-muted-foreground"}`}>
                      {entry.type === "earned" ? "+" : "-"}{entry.amount}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {isLoading && <SegolifeRowSkeleton count={2} />}

      {!!venues?.length && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">{t("home.venuesTitle")}</h2>
            <Link href={`/${slug}/explore`} className="text-xs font-medium text-primary">{t("home.exploreAll")}</Link>
          </div>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {venues.slice(0, 8).map(v => (
              <div key={v.id} className="contents" onClick={() => trackCard("venue")}>
                <SegolifeVenueCard venue={{ ...v, categoryName: v.category?.name }} slug={slug!} className="w-28 shrink-0" />
              </div>
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
  );
}
