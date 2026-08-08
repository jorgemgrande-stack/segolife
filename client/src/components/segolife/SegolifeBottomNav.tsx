import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Home as HomeIcon, Compass, QrCode, Gift, User } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Navegación inferior definitiva de Segolife (Fase 6) — Home | Explore |
 * [SCAN] | Rewards | Profile, con SCAN como botón central elevado (spec,
 * punto "navegación principal"). `slug` es el prefijo de comunidad actual
 * (p.ej. "ie") — nunca se hardcodea "ie"/"uva" aquí, se recibe como prop.
 */
export function SegolifeBottomNav({ slug, benefitsBadge }: { slug: string; benefitsBadge?: boolean }) {
  const { t } = useTranslation();
  const [location] = useLocation();

  const items = [
    { key: "home", href: `/${slug}`, icon: HomeIcon, label: t("nav.home"), exact: true },
    { key: "explore", href: `/${slug}/explore`, icon: Compass, label: t("nav.explore") },
    null, // hueco central para el botón SCAN elevado
    { key: "rewards", href: `/${slug}/rewards`, icon: Gift, label: t("nav.rewards"), badge: benefitsBadge },
    { key: "profile", href: `/${slug}/profile`, icon: User, label: t("nav.profile") },
  ] as const;

  const isActive = (href: string, exact?: boolean) => (exact ? location === href : location.startsWith(href));

  return (
    <nav
      className="segolife-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur"
      aria-label={t("nav.home")}
    >
      <div className="relative mx-auto grid max-w-md grid-cols-5 items-center px-2">
        {items.map((item, i) => {
          if (!item) {
            return (
              <div key="scan-slot" className="flex items-center justify-center">
                <Link
                  href={`/${slug}/scan`}
                  aria-label={t("nav.scan")}
                  className={cn(
                    "-mt-7 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground",
                    "segolife-elevated-shadow ring-4 ring-background transition-transform active:scale-95"
                  )}
                >
                  <QrCode className="size-6" aria-hidden="true" />
                </Link>
              </div>
            );
          }
          const active = isActive(item.href, "exact" in item ? item.exact : false);
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium"
              aria-current={active ? "page" : undefined}
            >
              <span className="relative">
                <Icon className={cn("size-5", active ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                {"badge" in item && item.badge && (
                  <span className="absolute -right-1 -top-1 size-2 rounded-full bg-accent" aria-hidden="true" />
                )}
              </span>
              <span className={active ? "text-primary" : "text-muted-foreground"}>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
