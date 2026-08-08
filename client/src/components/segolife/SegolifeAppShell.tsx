import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, MapPinOff } from "lucide-react";
import { useCommunity } from "@/contexts/CommunityContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { SegolifeHeader } from "./SegolifeHeader";
import { SegolifeBottomNav } from "./SegolifeBottomNav";
import { SegolifeEmptyState } from "./SegolifeEmptyState";

/**
 * Shell definitivo de Segolife (Fase 6) — centraliza CommunityContext, i18n,
 * header, bottom nav, safe-areas, scroll y los estados de carga/error de la
 * resolución de comunidad. Toda página pública nueva se envuelve en esto en
 * vez de repetir su propio layout — ver spec, "2. APP SHELL".
 *
 * AUTENTICACIÓN: Explore/Event/Venue son navegables sin sesión (mismos
 * endpoints públicos que ya usaba CommunityHome en Fase 1B). Home/Scan/
 * Rewards/Profile/Activity son inherentemente personales (wallet, beneficios,
 * historial) — `requireAuth` redirige a /login si no hay sesión, en vez de
 * inventar una versión "vacía" de una pantalla que no tiene sentido sin
 * usuario.
 */
export function SegolifeAppShell({
  children,
  requireAuth = false,
  hideNav = false,
  title,
}: {
  children: ReactNode;
  requireAuth?: boolean;
  hideNav?: boolean;
  title?: string;
}) {
  const { t } = useTranslation();
  const { community, slug, loading, availableLocales } = useCommunity();
  const { user, loading: authLoading } = useAuth({
    redirectOnUnauthenticated: requireAuth,
    redirectPath: getLoginUrl(),
  });

  useEffect(() => {
    document.title = title ? `${title} · Segolife` : "Segolife";
  }, [title]);

  const { data: homeSummary } = trpc.home.getSummary.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });

  if (loading || (requireAuth && authLoading)) {
    return (
      <div className="segolife-theme flex min-h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  // Slug candidato sin comunidad real detrás (o sin slug alguno) → 404, nunca caer en IE/UVA por defecto.
  if (!community) {
    return (
      <div className="segolife-theme flex min-h-dvh flex-col">
        <div className="flex flex-1 items-center justify-center px-6">
          <SegolifeEmptyState
            icon={<MapPinOff className="size-6" aria-hidden="true" />}
            title={t("community.notFoundTitle")}
            description={t("community.notFoundDescription")}
            actionLabel={t("community.backHome")}
            actionHref="/"
          />
        </div>
      </div>
    );
  }

  if (requireAuth && !user) {
    // useAuth ya está redirigiendo — evita parpadeo de contenido protegido.
    return (
      <div className="segolife-theme flex min-h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  // A estas alturas `community` ya está resuelta (ver guard de arriba) — `slug`
  // siempre es el mismo string no-nulo que la resolvió, esta comprobación es
  // solo para que TypeScript lo sepa también (CommunityContext los tipa por
  // separado aunque en la práctica van siempre juntos).
  if (!slug) return null;

  return (
    <div className="segolife-theme flex min-h-dvh flex-col">
      <SegolifeHeader slug={slug} availableLocales={availableLocales} />
      <main className={hideNav ? "flex-1" : "flex-1 pb-24"}>{children}</main>
      {!hideNav && <SegolifeBottomNav slug={slug} benefitsBadge={!!homeSummary?.activeBenefit} />}
    </div>
  );
}
