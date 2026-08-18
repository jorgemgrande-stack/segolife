import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, MapPin, MapPinOff, CalendarDays, Instagram, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatCardRewardBadge, type StudentRewardPreview } from "@/lib/rewardPreview";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifeEventCard, type SegolifeEventCardData } from "@/components/segolife/SegolifeEventCard";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { SegolifeErrorState } from "@/components/segolife/SegolifeErrorState";
import { SegolifeCardRowSkeleton } from "@/components/segolife/SegolifeSkeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { splitUpcomingPast } from "@shared/segolife/eventTiming";
import { cn } from "@/lib/utils";

const CONTAINER = "mx-auto max-w-[1280px] px-4 sm:px-6 xl:px-10";

/**
 * Detalle de un Venue — /:community/venues/:slug. Página pública (sin auth).
 *
 * Rediseño editorial (corrección visual post-cierre de Fase 8.6): la ficha
 * pasa de "foto + campos de base de datos" a un destino de descubrimiento —
 * hero corto (nunca una pantalla entera), identity card que se superpone al
 * hero, Upcoming Events como bloque prioritario justo debajo (no enterrado
 * tras Gallery), y composición adaptativa real: cada sección opcional
 * (About/Gallery/Past) se OCULTA por completo si no hay dato real detrás —
 * nunca un placeholder tipo "No description yet" ocupando espacio. Mismo
 * shell/nav que el resto de la app (antes usaba hideNav, lo que dejaba la
 * ficha visualmente fuera de contexto de Segolife).
 *
 * LOGO vs COVER vs GALLERY: `venue.imageUrl` = logo (object-contain, puede
 * tener transparencia), `venue.coverImageUrl` = foto grande del hero
 * (object-cover), `gallery_items` con este venueId y category="venue_gallery"
 * = galería adicional. Los tres son opcionales — sin cover, el hero cae a un
 * fondo degradado con los tokens de marca Segolife (nunca una pantalla rota).
 *
 * SegoTokens/Benefits del venue NO se muestran aquí (no existe todavía un
 * endpoint público de horarios/beneficios por venue — solo admin) — mejor
 * omitir que afirmar sin dato real.
 */
export default function VenueDetail() {
  const { t } = useTranslation();
  const { slug: communitySlug } = useCommunity();
  const params = useParams<{ community: string; slug: string }>();
  const [, navigate] = useLocation();
  const venueSlug = params.slug;

  const { data: detail, isLoading, error, refetch } = trpc.venues.publicGetBySlug.useQuery(
    { slug: venueSlug },
    { enabled: !!venueSlug }
  );
  const venue = detail?.venue;
  const category = detail?.category ?? null;

  const { data: venueEvents, isLoading: eventsLoading } = trpc.events.publicByVenue.useQuery(
    { venueId: venue?.id ?? 0 },
    { enabled: !!venue?.id }
  );
  const { data: galleryPhotos, isLoading: galleryLoading } = trpc.gallery.getItems.useQuery(
    { venueId: venue?.id, category: "venue_gallery" },
    { enabled: !!venue?.id }
  );

  const { upcoming: upcomingEvents, past: pastEvents } = splitUpcomingPast(venueEvents ?? []);
  const hasEventsData = !eventsLoading;
  const hasAnyEvents = hasEventsData && (upcomingEvents.length > 0 || pastEvents.length > 0);

  // SEGOTOKENS REWARD PREVIEW (MG-02 — hallazgo real: esta ficha reutiliza
  // el mismo SegolifeEventCard que Home/Explore, pero nunca le pasaba
  // rewardBadge, así que el Student veía el badge en unos sitios y en otros
  // no para el mismo evento real). Un solo lote, igual que Explore — solo
  // con sesión (autoservicio del propio Student) y solo para Upcoming: un
  // evento pasado ya no se puede comprar/asistir, mostrarle un badge sería
  // una promesa vacía.
  const { isAuthenticated } = useAuth();
  const rewardBatchItems = useMemo(
    () => upcomingEvents.slice(0, 24).map(e => ({ key: String(e.id), eventId: e.id, venueId: venue?.id })),
    [upcomingEvents, venue?.id]
  );
  const rewardBatchQ = trpc.tokens.previewMyEventRewardBatch.useQuery(
    { items: rewardBatchItems },
    { enabled: isAuthenticated && rewardBatchItems.length > 0 }
  );

  const subtitle = venue?.tagline || [category?.name, venue?.city].filter(Boolean).join(" · ");
  const hasIdentityMedia = !!(venue?.coverImageUrl || venue?.imageUrl);

  return (
    <SegolifeAppShell title={venue?.name}>
      {isLoading && (
        <div className={cn(CONTAINER, "space-y-4 py-6")}>
          <Skeleton className="h-[46vh] min-h-[280px] w-full rounded-3xl xl:h-[58vh]" />
          <Skeleton className="h-6 w-2/3 rounded-full" />
          <Skeleton className="h-5 w-1/3 rounded-full" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
      )}

      {error && !isLoading && (
        <div className={cn(CONTAINER, "py-6")}><SegolifeErrorState onRetry={() => refetch()} /></div>
      )}

      {!isLoading && !error && detail === null && (
        <div className={cn(CONTAINER, "py-6")}>
          <SegolifeEmptyState
            icon={<MapPinOff className="size-6" aria-hidden="true" />}
            title={t("venueDetail.notFoundTitle")}
            description={t("venueDetail.notFoundDescription")}
            actionLabel={t("nav.explore")}
            actionHref={`/${communitySlug}/explore`}
          />
        </div>
      )}

      {venue && !isLoading && (
        <div className="pb-16 md:pb-20">
          <VenueHero
            venue={venue}
            onBack={() => navigate(`/${communitySlug}/explore`)}
            backLabel={t("nav.explore")}
          />

          <div className={cn(CONTAINER, "relative z-10", hasIdentityMedia ? "-mt-14 sm:-mt-16 xl:-mt-20" : "mt-6")}>
            <VenueIdentityCard venue={venue} category={category} subtitle={subtitle} hasUpcoming={upcomingEvents.length > 0} />
          </div>

          <div className={cn(CONTAINER, "mt-8 space-y-12 md:mt-12 md:space-y-16")}>
            {/* ── UPCOMING EVENTS — bloque prioritario ── */}
            <section id="upcoming" className="scroll-mt-20">
              <SectionHeading icon={<CalendarDays className="size-4" aria-hidden="true" />}>
                {t("venueDetail.upcomingEventsLabel")}
              </SectionHeading>
              <div className="mt-4">
                {!hasEventsData ? (
                  <SegolifeCardRowSkeleton count={3} />
                ) : upcomingEvents.length > 0 ? (
                  <EventGrid events={upcomingEvents} slug={communitySlug!} size="lg" rewardBatch={rewardBatchQ.data} />
                ) : (
                  <UpcomingEmptyState />
                )}
              </div>
            </section>

            {/* ── ABOUT + GALLERY — se ocultan por completo si no hay dato real ── */}
            {(venue.description || (!galleryLoading && !!galleryPhotos?.length)) && (
              <div
                className={cn(
                  "grid gap-8 md:gap-10",
                  venue.description && !galleryLoading && !!galleryPhotos?.length && "xl:grid-cols-[0.85fr_1.15fr] xl:gap-14"
                )}
              >
                {venue.description && (
                  <section className="max-w-prose">
                    <SectionHeading>{t("venueDetail.aboutLabel")}</SectionHeading>
                    <p className="mt-4 text-[15px] leading-relaxed text-foreground/90">{venue.description}</p>
                  </section>
                )}

                {!galleryLoading && !!galleryPhotos?.length && (
                  <section>
                    <SectionHeading>{t("venueDetail.galleryLabel")}</SectionHeading>
                    <div className="mt-4">
                      <VenueGallery photos={galleryPhotos} venueName={venue.name} />
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* ── PAST EVENTS — tratamiento secundario, nunca CTA de compra; oculto si no hay nada que mostrar en absoluto ── */}
            {hasEventsData && pastEvents.length > 0 && (
              <section>
                <SectionHeading muted>{t("venueDetail.pastEventsLabel")}</SectionHeading>
                <div className="mt-4">
                  <EventGrid events={pastEvents.slice(0, 8)} slug={communitySlug!} size="sm" muted />
                </div>
              </section>
            )}

            {hasEventsData && !hasAnyEvents && (
              <p className="text-center text-xs text-muted-foreground">{t("venueDetail.noPastEvents")}</p>
            )}
          </div>
        </div>
      )}
    </SegolifeAppShell>
  );
}

// ─── HERO ───────────────────────────────────────────────────────────────────

function VenueHero({
  venue,
  onBack,
  backLabel,
}: {
  venue: { name: string; coverImageUrl: string | null; imageUrl: string | null };
  onBack: () => void;
  backLabel: string;
}) {
  const cover = venue.coverImageUrl ?? venue.imageUrl;

  return (
    <div className="relative h-[46vh] min-h-[280px] w-full overflow-hidden sm:h-[52vh] xl:h-[60vh] xl:max-h-[720px]">
      {cover ? (
        <img
          src={cover}
          alt=""
          className="size-full object-cover"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,oklch(0.30_0.14_296)_0%,transparent_45%),radial-gradient(circle_at_85%_75%,oklch(0.30_0.16_350)_0%,transparent_50%),#150a28]" />
      )}
      {/* Degradado inferior: legibilidad del back button + transición hacia la identity card que se superpone (nunca un corte duro imagen→blanco). */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/25" />
      <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background to-transparent xl:h-36" />

      <div className="segolife-safe-top absolute left-4 top-4 sm:left-6 sm:top-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-full border border-white/25 bg-black/30 py-2 pl-2.5 pr-4 text-sm font-medium text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/45"
        >
          <ChevronLeft className="size-4" aria-hidden="true" /> {backLabel}
        </button>
      </div>
    </div>
  );
}

// ─── IDENTITY CARD ──────────────────────────────────────────────────────────

function VenueIdentityCard({
  venue,
  category,
  subtitle,
  hasUpcoming,
}: {
  venue: { name: string; imageUrl: string | null; coverImageUrl: string | null; instagramUrl: string | null; address: string | null };
  category: { name: string } | null;
  subtitle: string;
  hasUpcoming: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: venue.name, url });
      } catch {
        // El usuario canceló el share sheet — no es un error a reportar.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("venueDetail.shareCopied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard no disponible — degradar en silencio, no romper la página por un extra */
    }
  };

  const mapsHref = venue.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`
    : null;

  const hasLogo = !!(venue.coverImageUrl && venue.imageUrl);

  return (
    <div className="segolife-card-shadow rounded-3xl border border-border/60 bg-card/95 p-5 backdrop-blur-sm sm:p-6 xl:p-7">
      <div className="flex items-end gap-4">
        {hasLogo && (
          // Fondo oscuro semitransparente (no blanco): muchos logos de venue
          // son marcas claras sobre transparencia — una tarjeta blanca los
          // deja invisibles (blanco sobre blanco).
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/60 bg-black/85 shadow-md sm:size-20">
            <img src={venue.imageUrl!} alt="" className="size-full object-contain p-2" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight text-foreground sm:text-3xl xl:text-4xl">{venue.name}</h1>
          {subtitle && <p className="mt-1 truncate text-sm text-muted-foreground sm:text-base">{subtitle}</p>}
        </div>
      </div>

      {(venue.instagramUrl || mapsHref || hasUpcoming) && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          {hasUpcoming && (
            <a
              href="#upcoming"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <CalendarDays className="size-3.5" aria-hidden="true" /> {t("venueDetail.upcomingEventsLabel")}
            </a>
          )}
          {mapsHref && (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/70"
            >
              <MapPin className="size-3.5" aria-hidden="true" /> {t("venueDetail.directionsLabel")}
            </a>
          )}
          {venue.instagramUrl && (
            <a
              href={venue.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("venueDetail.instagramLabel")}
              className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/70"
            >
              <Instagram className="size-3.5" aria-hidden="true" /> {t("venueDetail.instagramLabel")}
            </a>
          )}
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/70"
          >
            <Share2 className="size-3.5" aria-hidden="true" /> {copied ? t("venueDetail.shareCopied") : t("venueDetail.shareLabel")}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── SECTION HEADING ────────────────────────────────────────────────────────

function SectionHeading({ children, icon, muted }: { children: React.ReactNode; icon?: React.ReactNode; muted?: boolean }) {
  return (
    <h2
      className={cn(
        "flex items-center gap-1.5 text-lg font-semibold sm:text-xl",
        muted ? "text-muted-foreground" : "text-foreground"
      )}
    >
      {icon && <span className={muted ? "text-muted-foreground" : "text-primary"}>{icon}</span>}
      {children}
    </h2>
  );
}

// ─── UPCOMING EMPTY STATE — editorial compacto, no el EmptyState grande de página completa ──

function UpcomingEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-dashed border-border bg-secondary/40 px-5 py-6">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
        <CalendarDays className="size-4.5" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{t("venueDetail.upcomingEmptyTitle")}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("venueDetail.upcomingEmptyDescription")}</p>
      </div>
    </div>
  );
}

// ─── EVENT GRID (Upcoming/Past) ─────────────────────────────────────────────

function EventGrid({
  events,
  slug,
  size,
  muted,
  rewardBatch,
}: {
  events: SegolifeEventCardData[];
  slug: string;
  size: "lg" | "sm";
  muted?: boolean;
  /** MG-02 — solo se pasa para Upcoming; Past nunca recibe esta prop (sin badge en eventos ya pasados). */
  rewardBatch?: Record<string, StudentRewardPreview>;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:overflow-visible sm:px-0",
        size === "lg" ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-3 xl:grid-cols-4"
      )}
    >
      {events.map(e => (
        <SegolifeEventCard
          key={e.slug}
          event={e}
          slug={slug}
          className={cn(size === "lg" ? "w-64 shrink-0 sm:w-auto" : "w-36 shrink-0 sm:w-auto", muted && "opacity-60 grayscale-[35%]")}
          rewardBadge={rewardBatch ? formatCardRewardBadge(rewardBatch[String(e.id)], t) : undefined}
        />
      ))}
    </div>
  );
}

// ─── GALLERY — composición adaptativa por número de fotos + lightbox ──────

interface GalleryPhoto {
  id: number;
  imageUrl: string;
  title: string | null;
}

function VenueGallery({ photos, venueName }: { photos: GalleryPhoto[]; venueName: string }) {
  const { t } = useTranslation();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
      if (e.key === "ArrowLeft") setOpenIndex(i => (i === null ? null : (i - 1 + photos.length) % photos.length));
      if (e.key === "ArrowRight") setOpenIndex(i => (i === null ? null : (i + 1) % photos.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, photos.length]);

  const tile = (p: GalleryPhoto, i: number, className?: string) => (
    <button
      key={p.id}
      type="button"
      onClick={() => setOpenIndex(i)}
      className={cn("group overflow-hidden rounded-2xl bg-muted focus-visible:outline-2 focus-visible:outline-ring", className)}
    >
      <img
        src={p.imageUrl}
        alt={p.title ?? venueName}
        loading="lazy"
        decoding="async"
        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
    </button>
  );

  return (
    <>
      {photos.length === 1 && <div className="overflow-hidden rounded-3xl">{tile(photos[0], 0, "h-[280px] w-full sm:h-[380px]")}</div>}

      {photos.length === 2 && (
        <div className="grid h-[240px] grid-cols-5 gap-3 sm:h-[320px]">
          {tile(photos[0], 0, "col-span-3 h-full")}
          {tile(photos[1], 1, "col-span-2 h-full")}
        </div>
      )}

      {photos.length === 3 && (
        <div className="grid h-[280px] grid-cols-2 grid-rows-2 gap-3 sm:h-[380px]">
          {tile(photos[0], 0, "row-span-2 h-full")}
          {tile(photos[1], 1, "h-full")}
          {tile(photos[2], 2, "h-full")}
        </div>
      )}

      {photos.length >= 4 && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
          {photos.map((p, i) => (
            <div key={p.id} className="aspect-square">{tile(p, i, "size-full")}</div>
          ))}
        </div>
      )}

      {openIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
          onClick={() => setOpenIndex(null)}
          role="dialog"
          aria-modal="true"
          aria-label={venueName}
        >
          <button
            type="button"
            onClick={() => setOpenIndex(null)}
            aria-label={t("common.close")}
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setOpenIndex(i => (i === null ? null : (i - 1 + photos.length) % photos.length)); }}
                className="absolute left-3 flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:left-6"
              >
                <ChevronLeft className="size-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setOpenIndex(i => (i === null ? null : (i + 1) % photos.length)); }}
                className="absolute right-3 flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:right-6"
              >
                <ChevronRight className="size-5" aria-hidden="true" />
              </button>
            </>
          )}
          <img
            src={photos[openIndex].imageUrl}
            alt={photos[openIndex].title ?? venueName}
            className="max-h-[85vh] max-w-full rounded-xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
