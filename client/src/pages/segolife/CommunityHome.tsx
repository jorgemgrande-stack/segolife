import { useTranslation } from "react-i18next";
import { useCommunity } from "@/contexts/CommunityContext";
import { isSupportedLocale, type SupportedLocale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Star } from "lucide-react";

/**
 * Página pública mínima de una comunidad Segolife (/ie, /uva, futuros
 * campus). Un único componente para todas las comunidades — no hardcodea
 * "IE"/"UVA": todo lo que muestra viene de `community` (CommunityContext,
 * datos de la tabla `communities`). Prueba funcional de la Fase 1B, no el
 * diseño final.
 *
 * El bloque de venues/eventos (Fase 1D) prueba que los datos fluyen
 * correctamente end-to-end desde el admin hasta lo público — no es el
 * diseño final de la home (eso es Fase 6).
 */
export default function CommunityHome() {
  const { community, slug, loading, error, availableLocales } = useCommunity();
  const { t, i18n } = useTranslation();

  const { data: venues } = trpc.venues.publicActive.useQuery(
    { communityId: community?.id },
    { enabled: !!community }
  );
  const { data: events } = trpc.events.publicActive.useQuery(
    { communityId: community?.id },
    { enabled: !!community }
  );

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

      <div className="w-full max-w-2xl space-y-8 pt-4">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{t("communityHome.venuesTitle")}</h2>
          {!venues || venues.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("communityHome.noVenues")}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {venues.map(v => (
                <div key={v.id} className="border border-border rounded-lg p-4 bg-card text-left">
                  <p className="font-medium text-foreground">{v.name}</p>
                  {v.category && <p className="text-xs text-muted-foreground">{v.category.name}</p>}
                  {v.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{v.description}</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{t("communityHome.eventsTitle")}</h2>
          {!events || events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("communityHome.noEvents")}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {events.map(e => (
                <div key={e.id} className="border border-border rounded-lg p-4 bg-card text-left">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{e.name}</p>
                    {e.isFeatured && (
                      <Badge variant="secondary" className="gap-1">
                        <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                        {t("communityHome.featuredBadge")}
                      </Badge>
                    )}
                  </div>
                  {e.venue && <p className="text-xs text-muted-foreground">{e.venue.name}</p>}
                  <p className="text-sm text-muted-foreground mt-1">
                    {new Date(e.startsAt).toLocaleString(i18n.language, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
