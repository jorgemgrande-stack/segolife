import { useEffect } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { MapPin, Flame, Compass } from "lucide-react";
import "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { getLoginUrl, getRegisterUrl } from "@/const";
import { PublicHomeNav } from "@/components/publicHome/PublicHomeNav";
import { PublicHomeFooter } from "@/components/publicHome/PublicHomeFooter";
import { Explainer, RewardsSection, FinalCta, SectionHeader } from "@/pages/PublicHome";
import { SegolifeImage } from "@/components/segolife/SegolifeImage";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import type { Community } from "../../../../drizzle/schema";

/**
 * Landing pública de una comunidad — /ie, /uva sin sesión (Fase 15.1).
 *
 * Corrige el defecto real reportado con capturas de la Fase 15 "remate": la
 * versión anterior (CommunityLanding, ver Home.tsx) reutilizaba
 * SegolifeAppShell — el MISMO shell que la Student App autenticada — así que
 * un visitante anónimo veía el sidebar/bottom-nav de Home/Explore/Comunity/
 * Tickets/Scan/Rewards/Perfil y los iconos de campana/perfil de arriba a la
 * derecha, aunque no hubiera iniciado sesión. Esta página NUNCA importa
 * SegolifeAppShell — usa el mismo sistema visual que la Home master pública
 * (PublicHomeNav/PublicHomeFooter + las mismas secciones Explainer/
 * RewardsSection/FinalCta, reexportadas desde PublicHome.tsx, nunca
 * duplicadas) y añade solo lo que es genuinamente propio de una comunidad:
 * hero con su nombre real, sus eventos y sus locales reales (mismos
 * endpoints públicos que Explore.tsx, filtrados por communityId).
 *
 * Auditoría de producción de esta fase (2026-08-16): HOY los 159 eventos y
 * los 7 locales activos están asignados a IE Y a UVA a la vez (100%
 * compartido, 0 diferenciación real de contenido) — así que /ie y /uva
 * mostrarán las MISMAS tarjetas reales hasta que un admin diferencie
 * asignaciones de verdad. Esto es honesto con los datos reales, nunca se
 * fabrica contenido falso para simular diferenciación (spec §28/§36).
 */
export default function CommunityPublicLanding({ community, slug }: { community: Community | null; slug: string | null }) {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = community ? `${community.name} — SEGOLIFE` : "SEGOLIFE";
  }, [community]);

  if (!community || !slug) {
    return (
      <div className="segolife-theme flex min-h-dvh flex-col bg-background">
        <div className="flex flex-1 items-center justify-center px-6">
          <SegolifeEmptyState
            icon={<Compass className="size-6" aria-hidden="true" />}
            title={t("community.notFoundTitle")}
            description={t("community.notFoundDescription")}
            actionLabel={t("community.backHome")}
            actionHref="/"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="segolife-theme min-h-dvh bg-background">
      <Hero community={community} slug={slug} />
      <EventsSection communityId={community.id} slug={slug} />
      <VenuesSection communityId={community.id} slug={slug} />
      <Explainer />
      <RewardsSection />
      <FinalCta registerUrl={getRegisterUrl("/", slug)} />
      <PublicHomeFooter />
    </div>
  );
}

// ─── HERO ────────────────────────────────────────────────────────────────────

function Hero({ community, slug }: { community: Community; slug: string }) {
  const { t } = useTranslation();
  // Mismas fotos curadas que la Home master (spec §30: sin CMS por comunidad
  // todavía — reutilizar el activo compartido es la opción correcta, no
  // construir un sistema de temas nuevo para este remate).
  const { data: heroPhotos } = trpc.gallery.getItems.useQuery({ category: "home_hero" });
  const photos = (heroPhotos ?? []).slice(0, 5);
  const registerUrl = getRegisterUrl("/", slug);
  const loginUrl = getLoginUrl(`/${slug}`);

  return (
    <section className="relative flex min-h-[92dvh] flex-col overflow-hidden bg-[#150a28] text-white">
      {photos.length > 0 ? (
        <div className="absolute inset-0 grid grid-cols-2 gap-1 opacity-70 sm:grid-cols-4">
          {photos.map((p, i) => (
            <img
              key={p.id}
              src={p.imageUrl}
              alt={p.title ?? ""}
              className={`h-full w-full object-cover ${i >= 2 ? "hidden sm:block" : ""}`}
              loading={i === 0 ? "eager" : "lazy"}
              fetchPriority={i === 0 ? "high" : undefined}
              decoding="async"
            />
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,oklch(0.30_0.14_296)_0%,transparent_45%),radial-gradient(circle_at_85%_75%,oklch(0.30_0.16_350)_0%,transparent_50%),#150a28]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0d0817] via-[#150a28]/70 to-[#150a28]/30" />

      <PublicHomeNav variant="overlay" />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-end px-4 pb-20 pt-32 sm:px-6 lg:px-8 lg:pb-28">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/60">{t("publicHome.hero.eyebrow")}</p>
        <h1 className="mt-4 max-w-3xl text-5xl font-bold leading-[1.02] tracking-tight sm:text-7xl lg:text-8xl">
          {community.name}
        </h1>
        <p className="mt-6 max-w-lg text-lg text-white/75 sm:text-xl">{t("communityHome.tagline")}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a
            href={registerUrl}
            className="inline-flex items-center justify-center rounded-full bg-white px-7 py-3.5 text-base font-semibold text-[#150a28] shadow-xl transition-transform active:scale-95"
          >
            {t("publicHome.hero.ctaPrimary")}
          </a>
          <a
            href={loginUrl}
            className="inline-flex items-center justify-center rounded-full border border-white/30 px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-white/10"
          >
            {t("publicHome.hero.ctaSecondary")}
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

interface PublicScopedEvent {
  id: number;
  slug: string;
  name: string;
  imageUrl: string | null;
  startsAt: string | Date;
  isFeatured: boolean;
  venue: { name: string } | null;
}

function EventsSection({ communityId, slug }: { communityId: number; slug: string }) {
  const { t } = useTranslation();
  const { data: events } = trpc.events.publicActive.useQuery({ communityId });
  const upcoming = (events ?? []).slice(0, 8);

  return (
    <section className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader title={t("communityHome.eventsTitle")} subtitle={t("publicHome.events.subtitle")} />
        {upcoming.length === 0 ? (
          <SegolifeEmptyState icon={<Flame className="size-6" aria-hidden="true" />} title={t("communityHome.noEvents")} />
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4">
            {upcoming.map((event: PublicScopedEvent) => (
              <PublicEventCard key={event.id} event={event} slug={slug} />
            ))}
          </div>
        )}
        {upcoming.length > 0 && (
          <div className="mt-8 text-center">
            <Link href={`/${slug}/explore`} className="text-sm font-semibold text-primary hover:underline">
              {t("home.exploreAll")}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

function PublicEventCard({ event, slug }: { event: PublicScopedEvent; slug: string }) {
  const { i18n } = useTranslation();
  const starts = new Date(event.startsAt);
  const day = starts.toLocaleDateString(i18n.language, { weekday: "short", day: "numeric", month: "short" });
  const time = starts.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });

  return (
    <Link href={`/${slug}/events/${event.slug}`} className="group block">
      <div className="relative">
        <SegolifeImage src={event.imageUrl} alt={event.name} ratio={4 / 5} className="transition-transform duration-300 group-hover:scale-[1.03]" />
        {event.isFeatured && (
          <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground">★</span>
        )}
        <div className="absolute inset-x-0 bottom-0 rounded-b-2xl bg-gradient-to-t from-black/75 to-transparent p-3 pt-10">
          <p className="text-[11px] font-semibold text-white/90">{day} · {time}</p>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-semibold text-foreground">{event.name}</p>
      {event.venue && (
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" aria-hidden="true" /> <span className="truncate">{event.venue.name}</span>
        </p>
      )}
    </Link>
  );
}

// ─── VENUES ──────────────────────────────────────────────────────────────────

interface PublicScopedVenue {
  id: number;
  slug: string;
  name: string;
  imageUrl: string | null;
  coverImageUrl?: string | null;
  category: { name: string } | null;
}

function VenuesSection({ communityId, slug }: { communityId: number; slug: string }) {
  const { t } = useTranslation();
  const { data: venues } = trpc.venues.publicActive.useQuery({ communityId });
  const list = venues ?? [];

  return (
    <section className="bg-[#150a28] py-16 text-white sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader title={t("communityHome.venuesTitle")} subtitle={t("publicHome.tonight.subtitle")} dark />
        {list.length === 0 ? (
          <SegolifeEmptyState icon={<Compass className="size-6" aria-hidden="true" />} title={t("communityHome.noVenues")} />
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((venue: PublicScopedVenue) => (
              <PublicVenueCard key={venue.id} venue={venue} slug={slug} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function PublicVenueCard({ venue, slug }: { venue: PublicScopedVenue; slug: string }) {
  return (
    <Link href={`/${slug}/venues/${venue.slug}`} className="group relative block overflow-hidden rounded-3xl">
      <SegolifeImage src={venue.coverImageUrl ?? venue.imageUrl} alt={venue.name} ratio={16 / 11} rounded="rounded-3xl" className="transition-transform duration-300 group-hover:scale-[1.04]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5">
        {venue.category && (
          <p className="text-xs font-semibold uppercase tracking-wide text-white/60">{venue.category.name}</p>
        )}
        <p className="mt-1 text-xl font-bold">{venue.name}</p>
      </div>
    </Link>
  );
}
