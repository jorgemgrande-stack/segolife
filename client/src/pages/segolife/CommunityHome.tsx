import { useTranslation } from "react-i18next";
import { useCommunity } from "@/contexts/CommunityContext";
import { isSupportedLocale, type SupportedLocale } from "@/lib/i18n";

/**
 * Página pública mínima de una comunidad Segolife (/ie, /uva, futuros
 * campus). Un único componente para todas las comunidades — no hardcodea
 * "IE"/"UVA": todo lo que muestra viene de `community` (CommunityContext,
 * datos de la tabla `communities`). Prueba funcional de la Fase 1B, no el
 * diseño final.
 */
export default function CommunityHome() {
  const { community, slug, loading, error, availableLocales } = useCommunity();
  const { t, i18n } = useTranslation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <p className="text-muted-foreground">{t("communityHome.loading")}</p>
      </div>
    );
  }

  if (error || !community) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <p className="text-muted-foreground">
          {t("communityHome.notFound")}{slug ? ` ("${slug}")` : ""}
        </p>
      </div>
    );
  }

  const showLanguageSwitcher = availableLocales.length > 1;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-background text-foreground px-6">
      <div className="text-center space-y-2">
        <p className="text-sm uppercase tracking-widest text-muted-foreground">
          {t("communityHome.poweredBy")}
        </p>
        <h1 className="text-4xl font-display font-bold">{t("brand")}</h1>
        <p className="text-lg text-muted-foreground">
          {t("communityHome.communityLabel")}: <span className="font-semibold text-foreground">{community.name}</span>
        </p>
        <p className="text-sm text-muted-foreground max-w-md">{t("communityHome.tagline")}</p>
      </div>

      <div className="text-sm text-muted-foreground">
        {t("communityHome.languageLabel")}:{" "}
        <span className="font-semibold text-foreground">{i18n.language.toUpperCase()}</span>
      </div>

      {showLanguageSwitcher && (
        <div className="flex gap-2" role="group" aria-label={t("communityHome.languageLabel")}>
          {availableLocales.filter(isSupportedLocale).map((locale: SupportedLocale) => (
            <button
              key={locale}
              onClick={() => i18n.changeLanguage(locale)}
              className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                i18n.language === locale
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-foreground hover:bg-accent"
              }`}
              aria-pressed={i18n.language === locale}
            >
              {t(`languageSwitcher.${locale}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
