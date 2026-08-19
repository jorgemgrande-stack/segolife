import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearchParams, Link } from "wouter";
import { Gift, Coins, ChevronRight, Clock, Copy, Check, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { SegolifeErrorState } from "@/components/segolife/SegolifeErrorState";
import { SegolifeImage } from "@/components/segolife/SegolifeImage";
import { SegolifeRowSkeleton, SegolifeCardGridSkeleton } from "@/components/segolife/SegolifeSkeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReferralQrButton } from "@/components/segolife/ReferralQr";

/**
 * Rewards — /:community/rewards (Fase 6, marketplace añadido en Fase 7).
 * Separa explícitamente DOS conceptos que el estudiante no debe confundir
 * (spec, punto 18): gastar SegoTokens (catálogo real de Benefits
 * canjeables, `benefits.marketplaceList`) vs Mis Beneficios (derechos ya
 * desbloqueados, automáticos o comprados). `/:community/benefits` (compat
 * con la Fase 4 ya en producción) abre esta misma página con la pestaña de
 * Beneficios activa.
 */

interface LocalizedNameSource {
  name: string; nameEn: string | null; nameEs: string | null;
}

function localizedName(def: LocalizedNameSource, lang: string): string {
  if (lang === "en" && def.nameEn) return def.nameEn;
  if (lang !== "en" && def.nameEs) return def.nameEs;
  return def.name;
}

interface BenefitListItem {
  id: number;
  status: "active" | "used" | "expired" | "cancelled";
  validFrom: string | Date;
  validUntil: string | Date | null;
  /** SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6, spec §25/§30): nombre de la regla automática que lo concedió, si vino de una — null para beneficios manuales/marketplace. */
  ruleName: string | null;
  definition: LocalizedNameSource & {
    id: number; benefitType: string; imageUrl: string | null;
  };
}

function fmtDateTime(d: string | Date, lang: string) {
  return new Date(d).toLocaleString(lang, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function BenefitCard({ b, lang, slug }: { b: BenefitListItem; lang: string; slug: string }) {
  const { t } = useTranslation();
  const isUpcoming = b.status === "active" && new Date(b.validFrom) > new Date();
  const statusLabel = isUpcoming ? "statusUpcoming" : `status${b.status[0].toUpperCase()}${b.status.slice(1)}`;

  return (
    <Link href={`/${slug}/benefits/${b.id}`} className="segolife-card-shadow flex items-center gap-3 rounded-2xl bg-card p-3.5">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
        <Gift className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{localizedName(b.definition, lang)}</p>
        <p className="text-xs text-muted-foreground">
          {isUpcoming
            ? t("benefits.availableFrom", { date: fmtDateTime(b.validFrom, lang) })
            : b.validUntil
              ? `${t("benefits.validUntilLabel")} ${fmtDateTime(b.validUntil, lang)}`
              : fmtDateTime(b.validFrom, lang)}
        </p>
        {b.ruleName && <p className="truncate text-xs text-primary/80">{t("benefits.unlockedBy", { rule: b.ruleName })}</p>}
      </div>
      <Badge variant={b.status === "active" ? "default" : b.status === "used" ? "secondary" : "outline"}>{t(`benefits.${statusLabel}`)}</Badge>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function BenefitsTab({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const { data: benefits, isLoading } = trpc.benefits.myBenefits.useQuery();

  if (isLoading) return <SegolifeRowSkeleton />;

  const all = (benefits ?? []) as unknown as BenefitListItem[];
  const now = Date.now();
  const active = all.filter(b => b.status === "active" && new Date(b.validFrom).getTime() <= now);
  const upcoming = all.filter(b => b.status === "active" && new Date(b.validFrom).getTime() > now);
  const used = all.filter(b => b.status === "used");
  const expired = all.filter(b => b.status === "expired" || b.status === "cancelled");

  return (
    <Tabs defaultValue="active">
      <TabsList className="w-full">
        <TabsTrigger value="active" className="flex-1">{t("benefits.tabActive")}</TabsTrigger>
        <TabsTrigger value="upcoming" className="flex-1">{t("benefits.tabUpcoming")}</TabsTrigger>
        <TabsTrigger value="used" className="flex-1">{t("benefits.tabUsed")}</TabsTrigger>
        <TabsTrigger value="expired" className="flex-1">{t("benefits.tabExpired")}</TabsTrigger>
      </TabsList>
      <TabsContent value="active" className="mt-3 space-y-2">
        {active.length === 0
          ? <SegolifeEmptyState icon={<Gift className="size-5" aria-hidden="true" />} title={t("benefits.emptyActive")} description={t("benefits.emptyActiveDescription")} />
          : active.map(b => <BenefitCard key={b.id} b={b} lang={i18n.language} slug={slug} />)}
      </TabsContent>
      <TabsContent value="upcoming" className="mt-3 space-y-2">
        {upcoming.length === 0
          ? <SegolifeEmptyState icon={<Clock className="size-5" aria-hidden="true" />} title={t("benefits.emptyUpcoming")} />
          : upcoming.map(b => <BenefitCard key={b.id} b={b} lang={i18n.language} slug={slug} />)}
      </TabsContent>
      <TabsContent value="used" className="mt-3 space-y-2">
        {used.length === 0
          ? <SegolifeEmptyState icon={<Gift className="size-5" aria-hidden="true" />} title={t("benefits.emptyUsed")} />
          : used.map(b => <BenefitCard key={b.id} b={b} lang={i18n.language} slug={slug} />)}
      </TabsContent>
      <TabsContent value="expired" className="mt-3 space-y-2">
        {expired.length === 0
          ? <SegolifeEmptyState icon={<Gift className="size-5" aria-hidden="true" />} title={t("benefits.emptyExpired")} />
          : expired.map(b => <BenefitCard key={b.id} b={b} lang={i18n.language} slug={slug} />)}
      </TabsContent>
    </Tabs>
  );
}

interface MarketplaceItem extends LocalizedNameSource {
  id: number; imageUrl: string | null; tokenCost: number | null;
  available: number | null; ownedCount: number;
  marketplaceStatus: "available" | "sold_out" | "limit_reached" | "not_yet_available" | "ended";
}

function marketplaceStatusLabel(t: (key: string) => string, status: MarketplaceItem["marketplaceStatus"]): string | null {
  switch (status) {
    case "sold_out": return t("marketplace.soldOut");
    case "limit_reached": return t("marketplace.alreadyRedeemed");
    case "not_yet_available": return t("marketplace.notYetAvailable");
    case "ended": return t("marketplace.ended");
    default: return null;
  }
}

function MarketplaceCard({ item, walletBalance, lang, slug }: { item: MarketplaceItem; walletBalance: number; lang: string; slug: string }) {
  const { t } = useTranslation();
  const statusLabel = marketplaceStatusLabel(t, item.marketplaceStatus);
  const cost = item.tokenCost ?? 0;
  const missing = item.marketplaceStatus === "available" && walletBalance < cost ? cost - walletBalance : null;

  return (
    <Link href={`/${slug}/rewards/marketplace/${item.id}`}>
      <div className="relative">
        <SegolifeImage src={item.imageUrl} alt={localizedName(item, lang)} ratio={4 / 3} />
        <Badge className="absolute left-2 top-2 border-none bg-primary text-primary-foreground">
          <Coins className="mr-1 size-3" aria-hidden="true" /> {t("marketplace.tokenCostBadge", { count: cost })}
        </Badge>
        {statusLabel && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/55">
            <Badge variant="outline" className="border-white/40 bg-black/40 text-white">{statusLabel}</Badge>
          </div>
        )}
      </div>
      <div className="mt-2 space-y-0.5">
        <p className="line-clamp-1 text-sm font-semibold text-foreground">{localizedName(item, lang)}</p>
        {missing != null && (
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">{t("marketplace.missingTokens", { count: missing })}</p>
        )}
      </div>
    </Link>
  );
}

/**
 * Gastar SegoTokens — catálogo real de Benefits canjeables
 * (`benefits.marketplaceList`, Fase 7). Elegibilidad (activo/comunidad/
 * ventana/stock/límite por Student) siempre calculada en el servidor
 * (`listMarketplaceBenefits`) — el frontend solo pinta `marketplaceStatus`,
 * nunca decide. Saldo insuficiente NUNCA oculta el item (spec, punto 13):
 * se muestra con "Te faltan XX ST".
 */
function SpendTab({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError, refetch } = trpc.benefits.marketplaceList.useQuery();

  return (
    <div className="space-y-4">
      <div className="segolife-card-shadow flex items-center justify-between rounded-2xl bg-card p-4">
        <span className="text-sm text-muted-foreground">{t("rewards.balanceLabel")}</span>
        <span className="flex items-center gap-1.5 text-lg font-bold text-foreground">
          <Coins className="size-4 text-primary" aria-hidden="true" /> {(data?.walletBalance ?? 0).toLocaleString()}
        </span>
      </div>

      {isLoading ? (
        <SegolifeCardGridSkeleton />
      ) : isError ? (
        <SegolifeErrorState onRetry={() => refetch()} />
      ) : !data || data.items.length === 0 ? (
        <SegolifeEmptyState
          icon={<Coins className="size-5" aria-hidden="true" />}
          title={t("rewards.spendEmptyTitle")}
          description={t("rewards.spendEmptyDescription")}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4 xl:gap-5">
          {data.items.map(item => (
            <MarketplaceCard key={item.id} item={item as MarketplaceItem} walletBalance={data.walletBalance} lang={i18n.language} slug={slug} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * InviteTab — SEGOLIFE REFERRAL & INVITE REWARDS ENGINE (Fase 8, spec
 * §32-34). Enlace + QR de invitación (NUNCA la QR de identidad, spec §4),
 * economía de la campaña activa en lenguaje humano (spec §34: "resolver la
 * campaña antes de prometer nada"), y estadísticas agregadas ligeras del
 * propio Student — nunca PII de a quién invitó (spec §19).
 */
function InviteTab() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const { data, isLoading, isError } = trpc.referrals.mySummary.useQuery();

  if (isLoading) return <SegolifeRowSkeleton />;
  if (isError || !data) return <SegolifeErrorState />;

  const capReached = data.activeCampaign?.maxRewardsPerInviter != null && data.stats.remainingCapThisCampaign === 0;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(data!.inviteLink);
      setCopied(true);
      toast.success(t("inviteFriends.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("inviteFriends.copy"));
    }
  }

  async function handleShare() {
    const shareData = { title: "SEGOLIFE", text: t("inviteFriends.shareText"), url: data!.inviteLink };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch { /* usuario canceló — no es un error */ }
    } else {
      await handleCopy();
    }
  }

  return (
    <div className="space-y-4">
      <div className="segolife-card-shadow rounded-2xl bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
            <UserPlus className="size-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{t("inviteFriends.title")}</p>
            <p className="text-xs text-muted-foreground">{t("inviteFriends.subtitle")}</p>
          </div>
        </div>

        {data.activeCampaign ? (
          <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-foreground">
            <Coins className="size-3.5 text-primary flex-shrink-0" aria-hidden="true" />
            <span>
              {t("inviteFriends.campaignPromise", { inviterAmount: data.activeCampaign.inviterRewardTokens, inviteeAmount: data.activeCampaign.inviteeRewardTokens })}
              {" — "}{t("inviteFriends.conditionPrefix")} {t(`inviteFriends.condition.${data.activeCampaign.conversionCondition}`)}
            </span>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">{t("inviteFriends.noCampaignTitle")}</p>
            <p>{t("inviteFriends.noCampaignBody")}</p>
          </div>
        )}

        {capReached && (
          <p className="text-xs font-medium text-amber-600">{t("inviteFriends.capReached")}</p>
        )}

        <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">{t("inviteFriends.linkLabel")}</p>
          <p className="truncate text-sm text-foreground">{data.inviteLink}</p>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1 gap-1.5" onClick={handleCopy}>
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? t("inviteFriends.copied") : t("inviteFriends.copy")}
          </Button>
          <Button className="flex-1 gap-1.5" onClick={handleShare}>
            <UserPlus className="size-4" aria-hidden="true" /> {t("inviteFriends.share")}
          </Button>
        </div>
        <ReferralQrButton inviteLink={data.inviteLink} />
      </div>

      <div className="segolife-card-shadow rounded-2xl bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{t("inviteFriends.statsTitle")}</p>
        <div className="grid grid-cols-4 gap-2 text-center">
          <div>
            <p className="text-lg font-bold text-foreground">{data.stats.totalReferred}</p>
            <p className="text-[10px] text-muted-foreground">{t("inviteFriends.statsInvited")}</p>
          </div>
          <div>
            <p className="text-lg font-bold text-foreground">{data.stats.converted}</p>
            <p className="text-[10px] text-muted-foreground">{t("inviteFriends.statsConverted")}</p>
          </div>
          <div>
            <p className="text-lg font-bold text-foreground">{data.stats.rewarded}</p>
            <p className="text-[10px] text-muted-foreground">{t("inviteFriends.statsRewarded")}</p>
          </div>
          <div>
            <p className="text-lg font-bold text-primary">{data.stats.tokensEarnedFromReferrals}</p>
            <p className="text-[10px] text-muted-foreground">{t("inviteFriends.tokensEarned")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * FIX-03 — bug real: `?tab=benefits` (deep-link por query, distinto del
 * alias por PATH `/:community/benefits` de arriba) nunca se comprobaba —
 * solo `tab=invite` tenía su rama. Además `<Tabs defaultValue=...>` es
 * NO controlado: solo lee la URL una vez, al montar, así que un cambio de
 * query SIN remount (navegación interna a la MISMA ruta `/rewards` con
 * distinto `?tab=`, o atrás/adelante del navegador entre esas dos URLs) no
 * actualizaba la pestaña visible. Se hace <Tabs> controlado, derivado de
 * forma reactiva de `useSearchParams()` (wouter) + `location`, y cada click
 * de pestaña normaliza la URL a `/rewards[?tab=...]` — así una visita vía
 * el alias `/benefits` deja de "atascar" al Student en esa pestaña si
 * decide cambiar manualmente a otra.
 */
export function resolveActiveTab(tabParam: string | null, location: string): "spend" | "benefits" | "invite" {
  if (tabParam === "invite") return "invite";
  if (tabParam === "benefits" || location.endsWith("/benefits")) return "benefits";
  return "spend";
}

export default function Rewards() {
  const { t } = useTranslation();
  const { slug } = useCommunity();
  const [location, navigate] = useLocation();
  const [searchParams] = useSearchParams();
  const activeTab = resolveActiveTab(searchParams.get("tab"), location);

  function handleTabChange(value: string) {
    if (!slug) return;
    const query = value === "spend" ? "" : `?tab=${value}`;
    navigate(`/${slug}/rewards${query}`, { replace: true });
  }

  return (
    <SegolifeAppShell requireAuth title={t("rewards.title")}>
      <SegolifePageContainer className="space-y-4">
        <h1 className="text-xl font-semibold text-foreground">{t("rewards.title")}</h1>
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="w-full">
            <TabsTrigger value="spend" className="flex-1">{t("rewards.tabSpend")}</TabsTrigger>
            <TabsTrigger value="benefits" className="flex-1">{t("rewards.tabBenefits")}</TabsTrigger>
            <TabsTrigger value="invite" className="flex-1">{t("rewards.tabInvite")}</TabsTrigger>
          </TabsList>
          <TabsContent value="spend" className="mt-4">{slug && <SpendTab slug={slug} />}</TabsContent>
          <TabsContent value="benefits" className="mt-4">{slug && <BenefitsTab slug={slug} />}</TabsContent>
          <TabsContent value="invite" className="mt-4"><InviteTab /></TabsContent>
        </Tabs>
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
