/**
 * InviteLanding.tsx — SEGOLIFE REFERRAL & INVITE REWARDS ENGINE (Fase 8,
 * spec §3-4/§30/§60-62). Landing pública de un enlace de invitación
 * (`/invite/:code`) — NUNCA la misma credencial que la QR de identidad del
 * propio Student (spec §4, "ESTE SOY YO" vs "ÚNETE A SEGOLIFE POR MI
 * INVITACIÓN" son cosas distintas). Persiste la atribución en el cliente
 * (referralAttribution.ts) y deja que /register haga el resto — esta página
 * nunca crea nada server-side por sí misma, solo el click.
 *
 * Respuesta pública mínima (spec §60-62): nunca el nombre/email del
 * referrer, solo si el código es válido y, si hay campaña activa, la
 * economía prometida — resuelta SIN contexto de comunidad todavía (el
 * visitante la elige en /register), así que solo puede mostrar una
 * campaña GLOBAL si existiera (ver resolveActiveCampaign en
 * referralService.ts).
 */
import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Loader2, PartyPopper, Coins } from "lucide-react";
import { persistReferralClick } from "@/lib/referralAttribution";

const SEGOLIFE_LOGO_FALLBACK = "/icons/segolife-icon.svg";

export default function InviteLanding() {
  const { t, i18n } = useTranslation();
  const { code } = useParams<{ code: string }>();
  const [, navigate] = useLocation();

  const { data: publicSettings } = trpc.config.getPublicSettings.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const brandLogo = publicSettings?.segolife_brand_logo_url || SEGOLIFE_LOGO_FALLBACK;
  const brandName = publicSettings?.segolife_brand_name || "SEGOLIFE";

  const landingQuery = trpc.referrals.publicLanding.useQuery({ code: code ?? "" }, { enabled: !!code, retry: false });

  // Persistir el click SIEMPRE que haya un código en la URL — incluso si
  // resulta inválido, nunca revelamos el motivo (spec §62); el registro
  // simplemente ignorará un código que no resuelva a nadie.
  useEffect(() => {
    if (code) persistReferralClick(code);
  }, [code]);

  useEffect(() => {
    document.title = t("inviteLanding.meta.title");
  }, [t]);

  const campaign = landingQuery.data?.campaign ?? null;

  return (
    <div className="segolife-theme min-h-dvh flex bg-background">
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden bg-[#150a28]">
        <div
          className="absolute inset-0 opacity-80"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, oklch(0.30 0.14 296) 0%, transparent 45%), radial-gradient(circle at 85% 75%, oklch(0.30 0.16 350) 0%, transparent 50%)",
          }}
        />
        <div className="relative z-10 flex items-center gap-3">
          <img src={brandLogo} alt={brandName} className="w-10 h-10 rounded-xl object-contain" />
          <div className="text-white font-bold text-lg leading-tight">{brandName}</div>
        </div>
        <div className="relative z-10">
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">{t("inviteLanding.title")}</h1>
          <p className="text-white/75 text-lg leading-relaxed">{t("inviteLanding.subtitle")}</p>
        </div>
        <div className="relative z-10 text-white/50 text-sm">{t("inviteLanding.eyebrow")}</div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md text-center">
          <div className="flex gap-2 mb-8 justify-center">
            {(["es", "en"] as const).map((locale) => (
              <button
                key={locale}
                type="button"
                onClick={() => i18n.changeLanguage(locale)}
                className={`rounded-2xl border px-4 py-2 text-sm font-medium transition-colors ${
                  i18n.language === locale ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
                }`}
              >
                {t(`languageSwitcher.${locale}`)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 mb-8 justify-center lg:hidden">
            <img src={brandLogo} alt={brandName} className="w-10 h-10 rounded-xl object-contain" />
            <div className="text-foreground font-bold text-lg leading-tight">{brandName}</div>
          </div>

          <PartyPopper className="w-12 h-12 text-primary mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2 lg:hidden">{t("inviteLanding.title")}</h1>
          <p className="text-muted-foreground mb-6">{t("inviteLanding.subtitle")}</p>

          {landingQuery.isLoading ? (
            <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto mb-6" />
          ) : campaign ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 mb-6 text-sm font-medium text-foreground">
              <Coins className="w-4 h-4 text-primary flex-shrink-0" />
              {t("inviteFriends.campaignPromise", { inviterAmount: campaign.inviterRewardTokens, inviteeAmount: campaign.inviteeRewardTokens })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mb-6">{t("inviteLanding.rewardPreview")}</p>
          )}

          <Button className="w-full" size="lg" onClick={() => navigate("/register")}>
            {t("inviteLanding.cta")}
          </Button>

          <div className="mt-8 text-sm text-muted-foreground">
            {t("inviteLanding.footer")}{" "}
            <a href="/login" className="text-primary hover:text-primary/80 font-medium">
              {t("register.footer.login")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
