import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Home as HomeIcon, Compass, Ticket, Gift, QrCode, User, ChevronDown, Check, Vote } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

/**
 * Sidebar de escritorio de Segolife (Fase 8.5, >=1200px vía el breakpoint
 * `xl:`) — resuelve la navegación desktop sin duplicar lógica por
 * comunidad (spec: "no crear IeAppShell/UvaAppShell, sistema común
 * community-aware"). Reutiliza el MISMO `slug` que ya resuelve
 * CommunityContext/SegolifeBottomNav, así que cambiar de comunidad activa
 * (selector inferior) es solo navegar a `/${otraComunidad}` — nunca lógica
 * paralela.
 *
 * El QR (acción central elevada en mobile) aquí es un ítem de navegación
 * más, con el mismo peso visual que el resto — spec: "el QR central mobile
 * NO debe convertirse en un botón gigante en desktop", la superficie de
 * escritorio no tiene la restricción de alcance del pulgar que justificaba
 * el FAB elevado en mobile.
 *
 * El selector de comunidad usa myMemberships (comunidades REALES del
 * usuario), nunca communities.list (catálogo global) — bug real corregido:
 * antes ofrecía cambiar a CUALQUIER comunidad existente aunque el
 * estudiante no perteneciera a ella (p.ej. un estudiante solo de IE podía
 * "cambiar" a UVA sin ser miembro). Con myMemberships, un estudiante con
 * una sola comunidad simplemente no ve selector — la condición
 * `.length > 1` ya existente hace el resto sin lógica nueva.
 */
// Nunca brand_logo_url/brand_name (heredado de Náyade) — mismas claves
// propias de Segolife que ya usa AdminLayout.tsx, nunca ese fallback.
const SEGOLIFE_LOGO_FALLBACK = "/icons/segolife-icon.svg";

export function SegolifeSidebar({ slug, benefitsBadge }: { slug: string; benefitsBadge?: boolean }) {
  const { t } = useTranslation();
  const [location] = useLocation();
  // Bug real reportado: un visitante ANÓNIMO en /ie o /uva rebotaba
  // constantemente a /login sin ningún requireAuth de por medio.
  // myMemberships es protectedProcedure — llamarla sin `enabled` disparaba
  // un 401 en CADA visita anónima (el sidebar se monta siempre que
  // hideNav=false, aunque esté oculto por CSS bajo el breakpoint xl:), y
  // main.tsx tiene un handler GLOBAL que redirige a /login ante cualquier
  // error con el mensaje UNAUTHED_ERR_MSG — exactamente lo que
  // protectedProcedure lanza. Bug preexistente (Fase 8.5), nunca detectado
  // antes porque solo se manifiesta con un navegador real y una visita sin
  // sesión — los tests de este componente mockean trpc entero, así que
  // nunca ejercitan ni el error real ni el handler global de main.tsx.
  const { isAuthenticated } = useAuth();
  const { data: availableCommunities } = trpc.communities.myMemberships.useQuery(undefined, { enabled: isAuthenticated });
  const { data: publicSettings } = trpc.config.getPublicSettings.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const brandLogo = publicSettings?.segolife_brand_logo_url || SEGOLIFE_LOGO_FALLBACK;
  const brandName = publicSettings?.segolife_brand_name || "SEGOLIFE";
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const items = [
    { key: "home", href: `/${slug}`, icon: HomeIcon, label: t("nav.home"), exact: true },
    { key: "explore", href: `/${slug}/explore`, icon: Compass, label: t("nav.explore") },
    { key: "comunity", href: `/${slug}/comunity`, icon: Vote, label: t("nav.comunity") },
    { key: "tickets", href: `/${slug}/tickets`, icon: Ticket, label: t("nav.tickets") },
    { key: "scan", href: `/${slug}/scan`, icon: QrCode, label: t("nav.scan") },
    { key: "rewards", href: `/${slug}/rewards`, icon: Gift, label: t("nav.rewards"), badge: benefitsBadge },
    { key: "profile", href: `/${slug}/profile`, icon: User, label: t("nav.profile") },
  ] as const;

  const isActive = (href: string, exact?: boolean) => (exact ? location === href : location.startsWith(href));
  const currentCommunity = availableCommunities?.find((c) => c.slug === slug);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar xl:flex">
      <Link href={`/${slug}`} className="flex h-16 items-center gap-2.5 px-6 text-xl font-bold tracking-tight text-sidebar-foreground">
        <img src={brandLogo} alt={brandName} className="size-8 shrink-0 rounded-full object-contain" />
        {brandName}
      </Link>
      <nav className="flex-1 space-y-1 px-3 py-2" aria-label={t("nav.home")}>
        {items.map((item) => {
          const active = isActive(item.href, "exact" in item ? item.exact : false);
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <span className="relative">
                <Icon className="size-5" aria-hidden="true" />
                {"badge" in item && item.badge && (
                  <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent" aria-hidden="true" />
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {availableCommunities && availableCommunities.length > 1 && (
        <div className="relative border-t border-sidebar-border p-3">
          {switcherOpen && (
            <div className="absolute inset-x-3 bottom-full mb-2 overflow-hidden rounded-xl border border-sidebar-border bg-popover shadow-lg">
              {availableCommunities.map((c) => (
                <Link
                  key={c.slug}
                  href={`/${c.slug}`}
                  onClick={() => setSwitcherOpen(false)}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-popover-foreground hover:bg-secondary"
                >
                  {c.name}
                  {c.slug === slug && <Check className="size-4 text-primary" aria-hidden="true" />}
                </Link>
              ))}
            </div>
          )}
          <button
            onClick={() => setSwitcherOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent"
            aria-expanded={switcherOpen}
          >
            <span className="truncate">{currentCommunity?.name ?? slug}</span>
            <ChevronDown className={cn("size-4 shrink-0 transition-transform", switcherOpen && "rotate-180")} aria-hidden="true" />
          </button>
        </div>
      )}
    </aside>
  );
}
