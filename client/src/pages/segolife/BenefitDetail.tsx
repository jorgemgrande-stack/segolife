import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { ChevronLeft, Clock, Gift } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifeImage } from "@/components/segolife/SegolifeImage";
import { SegolifeErrorState } from "@/components/segolife/SegolifeErrorState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Detalle de un Benefit — /:community/benefits/:id (Fase 6). Se siente como
 * un pase/entrada digital: imagen, nombre, destino, vigencia, condiciones y
 * QR grande. El QR SOLO se renderiza si el backend devuelve qrToken (no
 * null) — nunca se genera nada en el cliente con datos distintos (spec,
 * punto 22: "no intentar generar QR frontend con datos distintos").
 */
export default function BenefitDetail() {
  const { t, i18n } = useTranslation();
  const { slug } = useCommunity();
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const id = Number(params.id);

  const { data: benefit, isLoading, error, refetch } = trpc.benefits.getMyBenefit.useQuery({ id }, { enabled: !!id });

  return (
    <SegolifeAppShell requireAuth hideNav title={t("benefits.myTitle")}>
      <div className="mx-auto max-w-md px-4 py-5">
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(`/${slug}/rewards`)}>
          <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("common.back")}
        </Button>

        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="aspect-[4/3] w-full rounded-3xl" />
            <Skeleton className="h-6 w-2/3 rounded-full" />
            <Skeleton className="h-32 w-full rounded-2xl" />
          </div>
        )}

        {error && !isLoading && <SegolifeErrorState onRetry={() => refetch()} />}

        {benefit && !isLoading && (
          <div className="space-y-5">
            <SegolifeImage src={benefit.definition.imageUrl} alt={benefit.definition.name} ratio={16 / 10} rounded="rounded-3xl" />

            <div className="text-center">
              <h1 className="text-xl font-bold text-foreground">
                {i18n.language === "en" ? (benefit.definition.nameEn ?? benefit.definition.name) : (benefit.definition.nameEs ?? benefit.definition.name)}
              </h1>
              {(i18n.language === "en" ? benefit.definition.descriptionEn : benefit.definition.descriptionEs) && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {i18n.language === "en" ? benefit.definition.descriptionEn : benefit.definition.descriptionEs}
                </p>
              )}
            </div>

            <div className="segolife-card-shadow space-y-2.5 rounded-2xl bg-card p-4 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t("benefits.validFromLabel")}</span><span className="text-foreground">{new Date(benefit.validFrom).toLocaleString(i18n.language, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
              {benefit.validUntil && (
                <div className="flex justify-between"><span className="text-muted-foreground">{t("benefits.validUntilLabel")}</span><span className="text-foreground">{new Date(benefit.validUntil).toLocaleString(i18n.language, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
              )}
              {benefit.usedAt && (
                <div className="flex justify-between"><span className="text-muted-foreground">{t("benefits.usedAtLabel")}</span><span className="text-foreground">{new Date(benefit.usedAt).toLocaleString(i18n.language, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
              )}
              {(i18n.language === "en" ? benefit.definition.termsEn : benefit.definition.termsEs) && (
                <div className="border-t border-border pt-2.5">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("benefits.conditionsLabel")}</p>
                  <p className="text-foreground">{i18n.language === "en" ? benefit.definition.termsEn : benefit.definition.termsEs}</p>
                </div>
              )}
            </div>

            {benefit.status === "active" && benefit.qrToken && (
              <div className="segolife-elevated-shadow flex flex-col items-center gap-3 rounded-3xl bg-card p-6">
                <div className="rounded-2xl bg-white p-4">
                  <QRCodeSVG value={benefit.qrToken} size={200} level="M" />
                </div>
                <p className="text-center text-xs text-muted-foreground">{t("benefits.showQrAtEntrance")}</p>
              </div>
            )}

            {benefit.status === "active" && !benefit.qrToken && (
              <div className="flex flex-col items-center gap-2 rounded-3xl bg-secondary py-8 text-center">
                <Clock className="size-7 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">
                  {new Date(benefit.validFrom).getTime() > Date.now()
                    ? t("benefits.availableFrom", { date: new Date(benefit.validFrom).toLocaleString(i18n.language, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) })
                    : t("benefits.statusExpired")}
                </p>
              </div>
            )}

            {benefit.status !== "active" && (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Gift className="size-7 text-muted-foreground" aria-hidden="true" />
                <Badge variant={benefit.status === "used" ? "secondary" : "outline"}>
                  {t(`benefits.status${benefit.status[0].toUpperCase()}${benefit.status.slice(1)}`)}
                </Badge>
              </div>
            )}
          </div>
        )}
      </div>
    </SegolifeAppShell>
  );
}
