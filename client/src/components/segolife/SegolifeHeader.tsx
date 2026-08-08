import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { User } from "lucide-react";
import { isSupportedLocale, type SupportedLocale } from "@/lib/i18n";

/**
 * Header móvil minimalista de Segolife (Fase 6) — logo + selector de idioma
 * (solo si la comunidad tiene más de un idioma disponible, p.ej. IE) +
 * acceso al perfil. Sin sobrecargar: nada de saludo/usuario aquí (eso vive
 * en el contenido de Home, no se repite en cada página).
 */
export function SegolifeHeader({ slug, availableLocales }: { slug: string; availableLocales: string[] }) {
  const { i18n } = useTranslation();
  const showLanguageSwitcher = availableLocales.length > 1;

  return (
    <header className="segolife-safe-top sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
        <Link href={`/${slug}`} className="text-lg font-semibold tracking-tight text-foreground">
          Segolife
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
