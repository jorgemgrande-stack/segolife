import { useEffect, type ReactNode } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { MapPin, Compass, Ticket, Gift, Building2, Percent, Users, Sparkles, ArrowRight } from "lucide-react";
import "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { getLoginUrl, getRegisterUrl } from "@/const";
import { SegolifeImage } from "@/components/segolife/SegolifeImage";
import { PublicHomeNav } from "@/components/publicHome/PublicHomeNav";
import { PublicHomeFooter } from "@/components/publicHome/PublicHomeFooter";

/**
 * Nueva Home pública de SEGOLIFE (Fase 8.5) — sustituye conceptualmente a
 * client/src/pages/Home.tsx (home heredada de Náyade Experiences, que sigue
 * existiendo en el repo pero deja de montarse en "/", ver App.tsx). Misión:
 * convertir a un estudiante que no usa Segolife todavía en usuario
 * registrado — nunca una landing SaaS genérica (spec: "no hero blanco, no
 * pricing cards, no footer corporativo").
 *
 * Contenido real, nunca inventado: "Lo que se cuece"/"Esta noche en Segovia"
 * consumen events.publicActive/venues.publicActive (endpoints públicos ya
 * existentes) SIN filtro de comunidad — ambas comunidades a la vez. Si la
 * BD está vacía (como hoy), cada sección esconde su grid y muestra un empty
 * state editorial, nunca un grid vacío ni datos ficticios.
 *
 * Fotografía del hero: gallery.getItems({category:"home_hero"}) — reutiliza
 * la Biblioteca Multimedia ya existente (gallery_items, administrable desde
 * /admin/cms/galeria) en vez de hardcodear URLs — así el hero es 100%
 * gestionable por el equipo sin tocar código (spec CMS). Si aún no hay
 * ninguna foto curada, cae a un fondo con los tokens de marca Segolife
 * (gradiente lila/coral), nunca una pantalla rota.
 */
export default function PublicHome() {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = "SEGOLIFE — Your student life in Segovia";
  }, []);

  const { data: heroPhotos } = trpc.gallery.getItems.useQuery({ category: "home_hero" });
  const { data: featuredEvents } = trpc.events.publicFeatured.useQuery({});
  const { data: events } = trpc.events.publicActive.useQuery({});
  const { data: featuredVenues } = trpc.venues.publicFeatured.useQuery({});
  const { data: venues } = trpc.venues.publicActive.useQuery({});
  const { data: communities } = trpc.communities.list.useQuery();

  // "Lo que se cuece" prioriza los eventos que el admin marcó como
  // destacados (control ya existente en EventsManager, `isFeatured` /
  // events.publicFeatured) y solo completa con el resto de activos si aún
  // no hay 6 destacados — nunca al revés, para que marcar un evento como
  // destacado tenga un efecto real y visible en la Home.
  const featuredIds = new Set((featuredEvents ?? []).map(e => e.id));
  const upcomingEvents = [
    ...(featuredEvents ?? []),
    ...(events ?? []).filter(e => !featuredIds.has(e.id)),
  ].slice(0, 6);
  // A diferencia de "Lo que se cuece": aquí se listan TODOS los locales
  // activos (sin slice), destacados primero en el orden curado desde
  // /admin/cms/inicio (homeSortOrder) — los venues son un catálogo estable,
  // no un flujo de eventos que necesite recortarse.
  const featuredVenueIds = new Set((featuredVenues ?? []).map(v => v.id));
  const tonightVenues = [
    ...(featuredVenues ?? []),
    ...(venues ?? []).filter(v => !featuredVenueIds.has(v.id)),
  ];

  return (
    <div className="segolife-theme min-h-dvh bg-background">
      <Hero heroPhotos={heroPhotos} />
      <WhatsHappening events={upcomingEvents} />
      <TonightInSegovia venues={tonightVenues} />
      <Explainer />
      <Communities communities={communities ?? []} />
      <RewardsSection />
      <FinalCta />
      <PublicHomeFooter />
    </div>
  );
}

// ─── 01 — HERO ────────────────────────────────────────────────────────────────

function Hero({ heroPhotos }: { heroPhotos?: Array<{ id: number; imageUrl: string; title: string | null }> }) {
  const { t } = useTranslation();
  const photos = (heroPhotos ?? []).slice(0, 5);
  const loginUrl = getLoginUrl();
  const registerUrl = getRegisterUrl();

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
              // La primera foto es el candidato a LCP del hero: nunca lazy, prioridad alta.
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
          {t("publicHome.hero.titleLine1")}
          <br />
          {t("publicHome.hero.titleLine2")}
          <br />
          <span className="bg-gradient-to-r from-[oklch(0.78_0.14_296)] to-[oklch(0.78_0.16_350)] bg-clip-text text-transparent">
            {t("publicHome.hero.titleLine3")}
          </span>
        </h1>
        <p className="mt-6 max-w-lg text-lg text-white/75 sm:text-xl">{t("publicHome.hero.subtitle")}</p>
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

// ─── 02 — WHAT'S HAPPENING ─────────────────────────────────────────────────────

interface PublicEvent {
  slug: string;
  name: string;
  imageUrl: string | null;
  startsAt: string | Date;
  isFeatured: boolean;
  venue: { name: string } | null;
  communities: Array<{ slug: string }>;
}

/** Elige de forma determinista con qué comunidad enlazar desde la Home
 * pública (sin comunidad elegida todavía) — antes usaba communities[0]
 * directamente, dependiente del orden de fila que devuelve la consulta
 * (no garantizado sin ORDER BY); ordenar por slug lo vuelve estable. */
function primaryCommunitySlug(communities: Array<{ slug: string }>): string | undefined {
  return [...communities].sort((a, b) => a.slug.localeCompare(b.slug))[0]?.slug;
}

function WhatsHappening({ events }: { events: PublicEvent[] }) {
  const { t, i18n } = useTranslation();

  return (
    <section className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader title={t("publicHome.events.title")} subtitle={t("publicHome.events.subtitle")} />
        {events.length === 0 ? (
          <EmptyEditorial icon={<Ticket className="size-6" aria-hidden="true" />} text={t("publicHome.events.empty")} />
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4">
            {events.map((event) => {
              const slug = primaryCommunitySlug(event.communities);
              const starts = new Date(event.startsAt);
              const day = starts.toLocaleDateString(i18n.language, { weekday: "short", day: "numeric", month: "short" });
              return (
                <Link key={event.slug} href={slug ? `/${slug}/events/${event.slug}` : "#"} className="group">
                  <div className="relative">
                    <SegolifeImage src={event.imageUrl} alt={event.name} ratio={4 / 5} className="transition-transform duration-300 group-hover:scale-[1.03]" />
                    {event.isFeatured && (
                      <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground">★</span>
                    )}
                    <div className="absolute inset-x-0 bottom-0 rounded-b-2xl bg-gradient-to-t from-black/75 to-transparent p-3 pt-8">
                      <p className="text-[11px] font-semibold text-white/85">{day}</p>
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-1 text-sm font-semibold text-foreground">{event.name}</p>
                  {event.venue && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3" aria-hidden="true" /> {event.venue.name}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── 03 — TONIGHT IN SEGOVIA ────────────────────────────────────────────────────

interface PublicVenue {
  slug: string;
  name: string;
  imageUrl: string | null;
  /** Fase 8.6: foto grande real del venue — `imageUrl` pasó a ser el LOGO. */
  coverImageUrl?: string | null;
  category: { name: string } | null;
  communities: Array<{ slug: string }>;
}

function TonightInSegovia({ venues }: { venues: PublicVenue[] }) {
  const { t } = useTranslation();

  return (
    <section className="bg-[#150a28] py-16 text-white sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader title={t("publicHome.tonight.title")} subtitle={t("publicHome.tonight.subtitle")} dark />
        {venues.length === 0 ? (
          <EmptyEditorial icon={<Sparkles className="size-6" aria-hidden="true" />} text={t("publicHome.tonight.empty")} dark />
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {venues.map((venue) => {
              const slug = primaryCommunitySlug(venue.communities);
              return (
                <Link key={venue.slug} href={slug ? `/${slug}/venues/${venue.slug}` : "#"} className="group relative block overflow-hidden rounded-3xl">
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
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── 04 — YOUR STUDENT LIFE, IN ONE PLACE ──────────────────────────────────────

function Explainer() {
  const { t } = useTranslation();
  const items = [
    { key: "events", icon: Compass },
    { key: "tickets", icon: Ticket },
    { key: "rewards", icon: Gift },
    { key: "venues", icon: Building2 },
    { key: "benefits", icon: Percent },
    { key: "community", icon: Users },
  ] as const;

  return (
    <section className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t("publicHome.explainer.title")}</h2>
        <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ key, icon: Icon }) => (
            <div key={key} className="bg-background p-6 sm:p-8">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
                <Icon className="size-5" aria-hidden="true" />
              </div>
              <p className="mt-4 text-lg font-semibold text-foreground">{t(`publicHome.explainer.${key}.title`)}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t(`publicHome.explainer.${key}.desc`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 05 — COMMUNITIES ───────────────────────────────────────────────────────────

function Communities({ communities }: { communities: Array<{ slug: string; name: string }> }) {
  const { t } = useTranslation();
  if (communities.length === 0) return null;

  return (
    <section className="bg-arena py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader title={t("publicHome.communities.title")} subtitle={t("publicHome.communities.subtitle")} />
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {communities.map((c) => (
            <Link
              key={c.slug}
              href={`/${c.slug}`}
              className="group flex items-center justify-between rounded-3xl border border-border bg-card p-6 transition-shadow segolife-card-shadow hover:segolife-elevated-shadow sm:p-8"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SEGOLIFE</p>
                <p className="mt-1 text-2xl font-bold text-foreground">{c.name}</p>
              </div>
              <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                {t("publicHome.communities.cta")}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 06 — SEGOTOKENS / REWARDS ──────────────────────────────────────────────────

function RewardsSection() {
  const { t } = useTranslation();
  const steps = ["discover", "go", "earn", "unlock"] as const;

  return (
    <section className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader title={t("publicHome.rewards.title")} subtitle={t("publicHome.rewards.subtitle")} />
        <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-4">
          {steps.map((step, i) => (
            <div key={step} className="relative">
              <p className="text-5xl font-bold text-primary/20">{String(i + 1).padStart(2, "0")}</p>
              <p className="mt-2 text-lg font-bold text-foreground">{t(`publicHome.rewards.${step}`)}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t(`publicHome.rewards.${step}Desc`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 07 — FINAL CTA ──────────────────────────────────────────────────────────────

function FinalCta() {
  const { t } = useTranslation();
  return (
    <section className="bg-[#150a28] py-20 text-center text-white sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">{t("publicHome.finalCta.title")}</h2>
        <a
          href={getRegisterUrl()}
          className="mt-8 inline-flex items-center justify-center rounded-full bg-white px-8 py-4 text-base font-semibold text-[#150a28] shadow-xl transition-transform active:scale-95"
        >
          {t("publicHome.finalCta.cta")}
        </a>
      </div>
    </section>
  );
}

// ─── Primitivas compartidas de sección ──────────────────────────────────────────

function SectionHeader({ title, subtitle, dark }: { title: string; subtitle: string; dark?: boolean }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className={`text-3xl font-bold tracking-tight sm:text-4xl ${dark ? "text-white" : "text-foreground"}`}>{title}</h2>
        <p className={`mt-1 text-base ${dark ? "text-white/60" : "text-muted-foreground"}`}>{subtitle}</p>
      </div>
    </div>
  );
}

function EmptyEditorial({ icon, text, dark }: { icon: ReactNode; text: string; dark?: boolean }) {
  return (
    <div className={`mt-8 flex flex-col items-center gap-3 rounded-3xl border border-dashed px-6 py-16 text-center ${dark ? "border-white/15 text-white/50" : "border-border text-muted-foreground"}`}>
      <div className={`flex size-12 items-center justify-center rounded-full ${dark ? "bg-white/10" : "bg-secondary"}`}>{icon}</div>
      <p className="max-w-sm text-sm">{text}</p>
    </div>
  );
}
