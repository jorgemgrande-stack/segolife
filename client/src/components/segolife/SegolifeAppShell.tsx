import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Loader2, MapPinOff, Bell, User as UserIcon } from "lucide-react";
import { useCommunity } from "@/contexts/CommunityContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { SegolifeHeader } from "./SegolifeHeader";
import { SegolifeBottomNav } from "./SegolifeBottomNav";
import { SegolifeSidebar } from "./SegolifeSidebar";
import { SegolifeEmptyState } from "./SegolifeEmptyState";
import { SegolifeIdentityQrButton } from "./SegolifeIdentityQr";

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
  const [currentPath, navigate] = useLocation();
  // El redirect-a-login de useAuth es un efecto independiente del render (navega
  // con window.location.href), así que si se habilitara siempre que requireAuth
  // es true, puede dispararse ANTES de saber si `community` es válida — mandando
  // a un slug inexistente a /login (con marca heredada) en vez de al 404 "Community
  // not found" de abajo. Solo se habilita una vez community terminó de resolverse
  // y es una comunidad real.
  //
  // Fase 15 (spec §11/§32, "community attribution must survive the funnel",
  // "URL preservation"): auditoría de esta fase confirmó que getLoginUrl()
  // se llamaba SIN argumentos aquí — cualquier deep link no autenticado a
  // /ie/... o /uva/... (p.ej. desde un QR en el venue) perdía la ruta Y la
  // comunidad por completo al mandar a /login, que solo sabe volver a "/".
  // wouter ya expone la ruta completa (incluida la comunidad) vía useLocation().
  const { user, loading: authLoading } = useAuth({
    redirectOnUnauthenticated: requireAuth && !loading && !!community,
    redirectPath: getLoginUrl(currentPath),
  });

  useEffect(() => {
    document.title = title ? `${title} · Segolife` : "Segolife";
  }, [title]);

  // Fase 15 — misma comunidad que ya resuelve la URL (`community?.id`), en
  // vez de dejar que el backend adivine "la primera membresía" (spec §11/§13).
  const { data: homeSummary } = trpc.home.getSummary.useQuery({ communityId: community?.id }, {
    enabled: !!user,
    staleTime: 60_000,
  });

  // Badge de la campana — polling ligero, nunca websocket (spec Fase 7, punto 17).
  const { data: unreadCount } = trpc.studentNotifications.unreadCount.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  // Bug real reportado con capturas: un Student autenticado que navegaba a la
  // URL de OTRA comunidad de la que no es miembro (p.ej. Cristina, solo IE,
  // visitando /uva) "se convertía" en esa comunidad — el saludo decía
  // "Segolife UVA" y las queries de esta página (venues, etc.) pedían datos
  // de esa comunidad ajena, aunque home.getSummary ya se defendía server-side
  // cayendo a la membresía real. Un usuario logueado debe acceder SIEMPRE a
  // su propia comunidad real, nunca a la que diga la URL sin comprobarla —
  // igual que ya hacía el selector de SegolifeSidebar (myMemberships, nunca
  // communities.list). Si no es miembro real de la comunidad de la URL, se
  // redirige a su comunidad real (la primera membresía, mismo criterio de
  // "primaria" que ya usa home.ts en el servidor) en vez de mostrarle
  // contenido de una comunidad ajena disfrazado de "su" Home.
  const { data: myMemberships, isLoading: membershipsLoading } = trpc.communities.myMemberships.useQuery(undefined, {
    enabled: !!user && !!community,
    staleTime: 60_000,
  });
  const isRealMember = !myMemberships || myMemberships.length === 0 || myMemberships.some(m => m.id === community?.id);

  useEffect(() => {
    if (!user || !community || !myMemberships || myMemberships.length === 0) return;
    if (isRealMember) return;
    const primarySlug = myMemberships[0].slug;
    if (primarySlug && primarySlug !== slug) {
      navigate(`/${primarySlug}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, community?.id, myMemberships, slug]);

  if (loading || (requireAuth && authLoading) || (!!user && !!community && membershipsLoading) || (!!user && !isRealMember)) {
    return (
      <div className="segolife-theme flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  // Slug candidato sin comunidad real detrás (o sin slug alguno) → 404, nunca caer en IE/UVA por defecto.
  if (!community) {
    return (
      <div className="segolife-theme flex min-h-dvh flex-col bg-background">
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
      <div className="segolife-theme flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  // A estas alturas `community` ya está resuelta (ver guard de arriba) — `slug`
  // siempre es el mismo string no-nulo que la resolvió, esta comprobación es
  // solo para que TypeScript lo sepa también (CommunityContext los tipa por
  // separado aunque en la práctica van siempre juntos).
  if (!slug) return null;

  // Fase 8.5 — shell responsive: <1200px conserva exactamente el shell mobile
  // ya validado (header superior + bottom nav, "protected experience", spec
  // "no reinterpretar visualmente mobile"). >=1200px sustituye ambos por un
  // sidebar fijo (mismo `slug`, ningún shell paralelo por comunidad) — el QR
  // deja de ser un FAB elevado y pasa a ser un ítem más de navegación, sin la
  // restricción de alcance del pulgar que justificaba el diseño mobile.
  return (
    <div className="segolife-theme flex min-h-dvh flex-col bg-background xl:flex-row">
      {!hideNav && <SegolifeSidebar slug={slug} benefitsBadge={!!homeSummary?.activeBenefit} />}
      {/* xl:pl-64 reserva sitio para el sidebar fijo — sin sidebar (hideNav)
          no debe aplicarse, o el contenido queda descentrado con un hueco
          fantasma a la izquierda en desktop (bug real, reportado con
          captura en Event Detail — las 8 páginas hideNav lo heredaban). */}
      <div className={`flex min-w-0 flex-1 flex-col ${hideNav ? "" : "xl:pl-64"}`}>
        <div className="xl:hidden">
          <SegolifeHeader slug={slug} availableLocales={availableLocales} unreadCount={unreadCount ?? 0} />
        </div>
        {!hideNav && <SegolifeDesktopTopBar slug={slug} unreadCount={unreadCount ?? 0} />}
        {/* pb-32: pb-24 dejaba el último elemento de páginas largas (ej. "Log
            out" en Profile) tocando el bottom nav en el punto de scroll máximo
            — visto en revisión visual real, no solo margen visual de sobra.
            xl:pb-0 — sin bottom nav que despejar en desktop. */}
        <main className={hideNav ? "flex-1" : "flex-1 pb-32 xl:pb-12"}>{children}</main>
        {!hideNav && (
          <div className="xl:hidden">
            <SegolifeBottomNav slug={slug} benefitsBadge={!!homeSummary?.activeBenefit} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Top bar de escritorio — QR de identidad + notificaciones + perfil (el
 * resto del header mobile, logo y wordmark, ya vive en el sidebar fijo,
 * repetirlo aquí sería ruido). Visible únicamente junto al sidebar (>=1200px).
 */
function SegolifeDesktopTopBar({ slug, unreadCount }: { slug: string; unreadCount: number }) {
  const { t } = useTranslation();
  return (
    <header className="hidden h-16 items-center justify-end gap-3 border-b border-border px-8 xl:flex">
      <SegolifeIdentityQrButton size="size-9" />
      <Link
        href={`/${slug}/notifications`}
        aria-label={t("notifications.bellLabel")}
        className="relative flex size-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-colors hover:bg-secondary/70"
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
        className="flex size-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-colors hover:bg-secondary/70"
      >
        <UserIcon className="size-4" aria-hidden="true" />
      </Link>
    </header>
  );
}
