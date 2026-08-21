import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Home as HomeIcon, Compass, Vote, QrCode, Gift } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Navegación inferior definitiva de Segolife (Fase 6) — Home | Explore |
 * [SCAN] | Comunity | Rewards, con SCAN como botón central elevado
 * REALMENTE centrado (2 items a cada lado — spec, punto "navegación
 * principal"). `slug` es el prefijo de comunidad actual (p.ej. "ie") —
 * nunca se hardcodea "ie"/"uva" aquí, se recibe como prop.
 *
 * FIX-07B: Profile se retira de AQUÍ exclusivamente — sigue existiendo
 * como ruta y sigue accesible desde el icono de usuario de
 * SegolifeHeader.tsx (nunca tocado). FIX-07 había insertado Comunity
 * ANTES del hueco central, dejando 3 items a la izquierda y 2 a la
 * derecha en un grid de 6 columnas — un grid de 6 columnas no tiene una
 * columna central real, así que el botón SCAN quedaba descuadrado hacia
 * la izquierda. Con Profile fuera y Comunity movida DESPUÉS del hueco
 * central, vuelven a ser 5 columnas (2 + hueco + 2), la misma proporción
 * simétrica que existía antes de FIX-07 — Comunity ocupa ahora la
 * posición que antes tenía Profile en el grid, no la que tenía en el
 * array previo a este cambio.
 */
export function SegolifeBottomNav({ slug, benefitsBadge }: { slug: string; benefitsBadge?: boolean }) {
  const { t } = useTranslation();
  const [location] = useLocation();

  const items = [
    { key: "home", href: `/${slug}`, icon: HomeIcon, label: t("nav.home"), exact: true },
    { key: "explore", href: `/${slug}/explore`, icon: Compass, label: t("nav.explore") },
    null, // hueco central para el botón SCAN elevado
    { key: "comunity", href: `/${slug}/comunity`, icon: Vote, label: t("nav.comunity") },
    { key: "rewards", href: `/${slug}/rewards`, icon: Gift, label: t("nav.rewards"), badge: benefitsBadge },
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
