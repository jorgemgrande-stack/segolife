import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Bell, User } from "lucide-react";
import { isSupportedLocale, type SupportedLocale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { SegolifeIdentityQrButton } from "./SegolifeIdentityQr";

// Nunca brand_logo_url/brand_name (heredado de Náyade) — mismas claves
// propias de Segolife que ya usa AdminLayout.tsx, nunca ese fallback.
const SEGOLIFE_LOGO_FALLBACK = "/icons/segolife-icon.svg";

/**
 * Header móvil minimalista de Segolife (Fase 6, + campana Fase 7, + QR de
 * identidad en STUDENT IDENTITY, UNIVERSAL QR & UNIFIED CHECK-IN) — logo +
 * selector de idioma (solo si la comunidad tiene más de un idioma disponible,
 * p.ej. IE) + acceso rápido al QR permanente + campana de notificaciones +
 * acceso al perfil. Sin sobrecargar: nada de saludo/usuario aquí (eso vive
 * en el contenido de Home, no se repite en cada página). El badge de
 * no-leídas es el único indicador — Home nunca se inunda de notificaciones,
 * el inbox es la fuente de verdad real. El QR se abre en un Dialog (nunca
 * navega) — accesible desde CUALQUIER página, no solo Home/Profile.
 */
export function SegolifeHeader({
  slug,
  availableLocales,
  unreadCount = 0,
}: {
  slug: string;
  availableLocales: string[];
  unreadCount?: number;
}) {
  const { t, i18n } = useTranslation();
  const showLanguageSwitcher = availableLocales.length > 1;
  const { data: publicSettings } = trpc.config.getPublicSettings.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const brandLogo = publicSettings?.segolife_brand_logo_url || SEGOLIFE_LOGO_FALLBACK;
  const brandName = publicSettings?.segolife_brand_name || "Segolife";

  return (
    <header className="segolife-safe-top sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
        <Link href={`/${slug}`} className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <img src={brandLogo} alt={brandName} className="size-7 shrink-0 rounded-full object-contain" />
          {brandName}
        </Link>
        <div className="flex items-center gap-3">
          {showLanguageSwitcher && (
            <div className="flex gap-1">
              {availableLocales.filter(isSupportedLocale).map((locale: SupportedLocale) => (
                <button
                  key={locale}
                  onClick={() => i18n.changeLanguage(locale)}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium border transition-colors ${
                    i18n.language === locale ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
                  }`}
                >
                  {locale.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          <SegolifeIdentityQrButton />
          <Link
            href={`/${slug}/notifications`}
            aria-label={t("notifications.bellLabel")}
            className="relative flex size-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
          >
            <Bell className="size-4" aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-bold leading-none text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
          <Link
            href={`/${slug}/profile`}
            aria-label="Profile"
            className="flex size-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
          >
            <User className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
