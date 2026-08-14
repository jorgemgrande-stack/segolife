import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronLeft, Coins, CheckCircle2, Gift } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeImage } from "@/components/segolife/SegolifeImage";
import { SegolifeErrorState } from "@/components/segolife/SegolifeErrorState";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

/**
 * Detalle + canje de un Benefit del marketplace —
 * /:community/rewards/marketplace/:id (Fase 7). Distinto de BenefitDetail
 * (que muestra un Benefit YA adquirido con su QR): esta página vende, esa
 * otra enseña. Elegibilidad/precio/stock siempre confiados al servidor
 * (`marketplaceGetById`) — el frontend solo refleja `marketplaceStatus`,
 * nunca decide si se puede canjear. Confirmación explícita antes de gastar
 * (spec, punto 51: "Vas a utilizar N SegoTokens" → Cancelar/Canjear), sin
 * dark patterns.
 */
export default function RewardsMarketplaceDetail() {
  const { t, i18n } = useTranslation();
  const { slug } = useCommunity();
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const id = Number(params.id);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [success, setSuccess] = useState<{ userBenefitId: number } | null>(null);

  const { data, isLoading, error, refetch } = trpc.benefits.marketplaceGetById.useQuery({ id }, { enabled: !!id });

  const purchaseMut = trpc.benefits.purchase.useMutation({
    onSuccess: res => {
      setConfirmOpen(false);
      setSuccess({ userBenefitId: res.userBenefitId });
      utils.tokens.getMyWallet.invalidate();
      utils.benefits.myBenefits.invalidate();
      utils.benefits.marketplaceList.invalidate();
      utils.benefits.marketplaceGetById.invalidate({ id });
    },
    onError: e => {
      setConfirmOpen(false);
      toast.error(e.message);
    },
  });

  const handleConfirm = () => {
    purchaseMut.mutate({ benefitDefinitionId: id, idempotencyKey: `benefit_redemption:${id}:${crypto.randomUUID()}` });
  };

  const isNotFound = (error as unknown as { data?: { code?: string } } | null)?.data?.code === "NOT_FOUND";

  return (
    <SegolifeAppShell requireAuth hideNav title={data?.item ? localizedName(data.item, i18n.language) : t("rewards.tabSpend")}>
      <SegolifePageContainer>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(`/${slug}/rewards`)}>
          <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("marketplace.back")}
        </Button>

        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="aspect-[16/10] w-full rounded-3xl" />
            <Skeleton className="h-6 w-2/3 rounded-full" />
            <Skeleton className="h-32 w-full rounded-2xl" />
          </div>
        )}

        {error && !isLoading && (
          isNotFound
            ? <SegolifeEmptyState icon={<Gift className="size-5" aria-hidden="true" />} title={t("marketplace.notFound")} />
            : <SegolifeErrorState onRetry={() => refetch()} />
        )}

        {success && (
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CheckCircle2 className="size-8" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{t("marketplace.successTitle")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("marketplace.successDescription")}</p>
            </div>
            <Button className="rounded-full px-6" onClick={() => navigate(`/${slug}/benefits/${success.userBenefitId}`)}>
              {t("marketplace.viewMyBenefit")}
            </Button>
          </div>
        )}

        {data?.item && !isLoading && !success && (
          <MarketplaceDetailContent
            item={data.item}
            walletBalance={data.walletBalance}
            lang={i18n.language}
            onRedeem={() => setConfirmOpen(true)}
          />
        )}

        <Dialog open={confirmOpen} onOpenChange={o => !purchaseMut.isPending && setConfirmOpen(o)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("marketplace.confirmTitle", { count: data?.item?.tokenCost ?? 0 })}</DialogTitle>
              <DialogDescription>{t("marketplace.confirmDescription")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={purchaseMut.isPending}>
                {t("marketplace.confirmCancel")}
              </Button>
              <Button onClick={handleConfirm} disabled={purchaseMut.isPending}>
                {purchaseMut.isPending ? t("marketplace.redeeming") : t("marketplace.confirmSubmit")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}

interface MarketplaceDetailItem {
  id: number; name: string; nameEn: string | null; nameEs: string | null;
  descriptionEn: string | null; descriptionEs: string | null;
  termsEn: string | null; termsEs: string | null;
  imageUrl: string | null; tokenCost: number | null;
  purchaseWindowEnd: string | Date | null; redemptionValidityDays: number | null;
  marketplaceStatus: "available" | "sold_out" | "limit_reached" | "not_yet_available" | "ended";
}

function localizedName(item: MarketplaceDetailItem, lang: string): string {
  if (lang === "en" && item.nameEn) return item.nameEn;
  if (lang !== "en" && item.nameEs) return item.nameEs;
  return item.name;
}

function MarketplaceDetailContent({
  item, walletBalance, lang, onRedeem,
}: {
  item: MarketplaceDetailItem; walletBalance: number; lang: string; onRedeem: () => void;
}) {
  const { t } = useTranslation();
  const description = lang === "en" ? item.descriptionEn : item.descriptionEs;
  const terms = lang === "en" ? item.termsEn : item.termsEs;
  const cost = item.tokenCost ?? 0;
  const missing = walletBalance < cost ? cost - walletBalance : 0;

  let ctaLabel = t("marketplace.redeemCta", { count: cost });
  let ctaDisabled = false;
  if (item.marketplaceStatus === "sold_out") { ctaLabel = t("marketplace.soldOut"); ctaDisabled = true; }
  else if (item.marketplaceStatus === "limit_reached") { ctaLabel = t("marketplace.alreadyRedeemed"); ctaDisabled = true; }
  else if (item.marketplaceStatus === "not_yet_available") { ctaLabel = t("marketplace.notYetAvailable"); ctaDisabled = true; }
  else if (item.marketplaceStatus === "ended") { ctaLabel = t("marketplace.ended"); ctaDisabled = true; }
  else if (missing > 0) { ctaLabel = t("marketplace.missingTokens", { count: missing }); ctaDisabled = true; }

  return (
    <div className="space-y-5">
      <SegolifeImage src={item.imageUrl} alt={localizedName(item, lang)} ratio={16 / 10} rounded="rounded-3xl" />

      <div className="text-center">
        <h1 className="text-xl font-bold text-foreground">{localizedName(item, lang)}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>

      <div className="segolife-card-shadow space-y-2.5 rounded-2xl bg-card p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("marketplace.yourBalance")}</span>
          <span className="flex items-center gap-1 font-semibold text-foreground"><Coins className="size-3.5 text-primary" aria-hidden="true" /> {walletBalance.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("marketplace.cost")}</span>
          <span className="flex items-center gap-1 font-semibold text-foreground"><Coins className="size-3.5 text-primary" aria-hidden="true" /> {cost.toLocaleString()}</span>
        </div>
        {item.purchaseWindowEnd && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("marketplace.validUntilPurchase", { date: new Date(item.purchaseWindowEnd).toLocaleString(lang, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) })}</span>
          </div>
        )}
        {item.redemptionValidityDays != null && (
          <p className="text-xs text-muted-foreground">{t("marketplace.redemptionValidity", { days: item.redemptionValidityDays })}</p>
        )}
        {terms && (
          <div className="border-t border-border pt-2.5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("marketplace.conditions")}</p>
            <p className="text-foreground">{terms}</p>
          </div>
        )}
      </div>

      <Button className="w-full rounded-full" size="lg" disabled={ctaDisabled} onClick={onRedeem}>
        {ctaLabel}
      </Button>
    </div>
  );
}
