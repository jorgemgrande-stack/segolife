import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { getLoginUrl, getRegisterUrl } from "@/const";
import { trpc } from "@/lib/trpc";

// Nunca brand_logo_url/brand_name (heredado de Náyade) — mismas claves
// propias de Segolife que ya usa AdminLayout.tsx, nunca ese fallback.
const SEGOLIFE_LOGO_FALLBACK = "/icons/segolife-icon.svg";

/**
 * Nav pública de la nueva Home SEGOLIFE (Fase 8.5) — deliberadamente propia,
 * NUNCA reutiliza PublicNav.tsx (branding Náyade hardcodeado, no leído de
 * publicSettings — ver auditoría de la fase). Minimal: wordmark + CTAs.
 */
export function PublicHomeNav({ variant = "overlay", communitySlug }: { variant?: "overlay" | "solid"; communitySlug?: string }) {
  const { t, i18n } = useTranslation();
  const loginUrl = getLoginUrl();
  // PRE-16.17 (QA manual, Block B): esta nav es compartida (Home, IE, UVA,
  // páginas legales) — cuando se renderiza dentro de una landing de
  // comunidad hay que pasarle `communitySlug` para que "Join SEGOLIFE"
  // preserve la comunidad (?community=ie/uva), igual que ya hacía el
  // FinalCta de CommunityPublicLanding.tsx. Sin el prop (Home, legales),
  // se comporta exactamente igual que antes.
  const registerUrl = getRegisterUrl("/", communitySlug);
  const { data: publicSettings } = trpc.config.getPublicSettings.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const brandLogo = publicSettings?.segolife_brand_logo_url || SEGOLIFE_LOGO_FALLBACK;
  const brandName = publicSettings?.segolife_brand_name || "SEGOLIFE";

  return (
    <header
      className={
        variant === "overlay"
          ? "absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/50 to-transparent"
          : "sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur"
      }
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className={`flex items-center gap-2 text-lg font-bold tracking-tight ${variant === "overlay" ? "text-white" : "text-foreground"}`}>
          <img src={brandLogo} alt={brandName} className="size-8 shrink-0 rounded-full object-contain" />
          {brandName}
        </Link>
        <div className="flex items-center gap-2">
          <div className={`hidden sm:flex items-center gap-1 rounded-full border p-0.5 ${variant === "overlay" ? "border-white/25" : "border-border"}`}>
            {(["es", "en"] as const).map((locale) => (
              <button
                key={locale}
                onClick={() => i18n.changeLanguage(locale)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  i18n.language === locale
                    ? "bg-primary text-primary-foreground"
                    : variant === "overlay"
                      ? "text-white/80"
                      : "text-muted-foreground"
                }`}
              >
                {locale.toUpperCase()}
              </button>
            ))}
          </div>
          <a
            href={loginUrl}
            className={`hidden rounded-full px-4 py-2 text-sm font-medium transition-colors sm:inline-flex ${
              variant === "overlay" ? "text-white hover:bg-white/10" : "text-foreground hover:bg-secondary"
            }`}
          >
            {t("publicHome.nav.login")}
          </a>
          <a
            href={registerUrl}
            className="inline-flex rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-transform active:scale-95"
          >
            {t("publicHome.nav.join")}
          </a>
        </div>
      </div>
    </header>
  );
}
