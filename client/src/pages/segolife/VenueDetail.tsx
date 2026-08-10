import { useParams, useLocation, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronLeft, MapPin, MapPinOff, CalendarDays, Instagram, ImageIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifeImage } from "@/components/segolife/SegolifeImage";
import { SegolifeEventCard } from "@/components/segolife/SegolifeEventCard";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { SegolifeErrorState } from "@/components/segolife/SegolifeErrorState";
import { SegolifeCardRowSkeleton } from "@/components/segolife/SegolifeSkeletons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { splitUpcomingPast } from "@shared/segolife/eventTiming";

/**
 * Detalle de un Venue — /:community/venues/:slug (Fase 6, rehecho a fondo
 * en Fase 8.6 — spec puntos 17-30: el venue deja de ser una ficha tipo CRUD
 * y pasa a ser un destino digital editorial). Página pública (sin auth).
 *
 * LOGO vs COVER vs GALLERY (spec punto 13): `venue.imageUrl` = logo
 * (object-contain, puede tener transparencia), `venue.coverImageUrl` = foto
 * grande del hero (object-cover), `gallery_items` con este venueId y
 * category="venue_gallery" = galería adicional. Los tres son opcionales —
 * sin cover, el hero cae al mismo fondo degradado que PublicHome sin fotos
 * (nunca una pantalla rota).
 *
 * SegoTokens/Benefits del venue NO se muestran aquí todavía (spec puntos
 * 28-29): no existe un endpoint PÚBLICO de horarios/beneficios por venue
 * (solo admin, ver VenueSegoTokensTab/VenueBenefitsTab) — construirlo es
 * fuera de alcance de esta fase, mejor omitir que afirmar sin dato real.
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

  return (
    <SegolifeAppShell hideNav title={venue?.name}>
      {isLoading && (
        <div className="mx-auto max-w-md space-y-4 px-4 py-5 md:max-w-2xl xl:max-w-3xl">
          <Skeleton className="aspect-[16/10] w-full rounded-3xl" />
          <Skeleton className="h-6 w-2/3 rounded-full" />
          <Skeleton className="h-5 w-1/3 rounded-full" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      )}

      {error && !isLoading && (
        <div className="mx-auto max-w-md px-4 py-5"><SegolifeErrorState onRetry={() => refetch()} /></div>
      )}

      {!isLoading && !error && detail === null && (
        <div className="mx-auto max-w-md px-4 py-5">
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
        <div className="pb-10">
          {/* ── HERO: cover + logo superpuesto ── */}
          <div className="relative">
            <SegolifeImage
              src={venue.coverImageUrl ?? venue.imageUrl}
              alt={venue.name}
              ratio={16 / 10}
              rounded="rounded-none"
              className="xl:rounded-b-[2.5rem]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/30" />
            <Button
              variant="secondary"
              size="sm"
              className="absolute left-4 top-4 gap-1 rounded-full shadow-md"
              onClick={() => navigate(`/${communitySlug}/explore`)}
            >
              <ChevronLeft className="size-4" aria-hidden="true" /> {t("common.back")}
            </Button>

            <div className="absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-md items-end gap-3 px-4 pb-5 md:max-w-2xl xl:max-w-3xl">
              {venue.coverImageUrl && venue.imageUrl && (
                // bg-black/50 + blur en vez de bg-white: muchos logos de venues de
                // nightlife son marcas blancas/claras sobre fondo transparente (ver
                // Casanova/Tanker Events) — una tarjeta blanca los deja invisibles
                // (blanco sobre blanco). Un fondo oscuro semitransparente da contraste
                // real a un logo claro y sigue funcionando para uno oscuro u opaco.
                <div className="size-16 shrink-0 overflow-hidden rounded-2xl border-2 border-white/80 bg-black/50 shadow-lg backdrop-blur-sm">
                  <img src={venue.imageUrl} alt="" className="size-full object-contain p-1" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-2xl font-bold text-white xl:text-3xl">{venue.name}</h1>
                <p className="truncate text-sm text-white/80">
                  {venue.tagline || [category?.name, venue.city].filter(Boolean).join(" · ")}
                </p>
              </div>
              {venue.instagramUrl && (
                <a
                  href={venue.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("venueDetail.instagramLabel")}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
                >
                  <Instagram className="size-5" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>

          <div className="mx-auto max-w-md space-y-7 px-4 pt-5 md:max-w-2xl xl:max-w-3xl">
            {!venue.coverImageUrl && !venue.imageUrl && (
              <div>
                <h1 className="text-xl font-bold text-foreground">{venue.name}</h1>
                {(venue.tagline || category) && (
                  <p className="mt-1 text-sm text-muted-foreground">{venue.tagline || category?.name}</p>
                )}
              </div>
            )}

            {venue.address && (
              <div className="segolife-card-shadow rounded-2xl bg-card p-4 text-sm">
                <div className="flex items-start gap-2.5">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("venueDetail.addressLabel")}</p>
                    <p className="mt-0.5 text-foreground">{venue.address}{venue.city ? `, ${venue.city}` : ""}</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── ABOUT ── */}
            <section className="space-y-1.5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("venueDetail.aboutLabel")}</h2>
              <p className={venue.description ? "text-sm leading-relaxed text-foreground" : "text-sm leading-relaxed text-muted-foreground"}>
                {venue.description || t("venueDetail.noDescription")}
              </p>
            </section>

            {/* ── GALLERY ── */}
            {!galleryLoading && !!galleryPhotos?.length && (
              <section className="space-y-3">
                <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
                  <ImageIcon className="size-4 text-primary" aria-hidden="true" /> {t("venueDetail.galleryLabel")}
                </h2>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3 xl:grid-cols-3">
                  {galleryPhotos.map(p => (
                    <SegolifeImage key={p.id} src={p.imageUrl} alt={p.title ?? venue.name} ratio={4 / 5} />
                  ))}
                </div>
              </section>
            )}

            {/* ── UPCOMING EVENTS ── */}
            <section className="space-y-3">
              <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
                <CalendarDays className="size-4 text-primary" aria-hidden="true" /> {t("venueDetail.upcomingEventsLabel")}
              </h2>
              {eventsLoading ? (
                <SegolifeCardRowSkeleton />
              ) : !upcomingEvents.length ? (
                <p className="text-sm text-muted-foreground">{t("venueDetail.noUpcomingEvents")}</p>
              ) : (
                <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 xl:grid-cols-4">
                  {upcomingEvents.map(e => (
                    <SegolifeEventCard key={e.id} event={e} slug={communitySlug!} className="w-36 shrink-0 xl:w-auto" />
                  ))}
                </div>
              )}
            </section>

            {/* ── PAST EVENTS — tratamiento secundario, nunca CTA de compra ── */}
            {!eventsLoading && !!pastEvents.length && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold text-muted-foreground">{t("venueDetail.pastEventsLabel")}</h2>
                <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 xl:grid-cols-4">
                  {pastEvents.slice(0, 8).map(e => (
                    <SegolifeEventCard key={e.id} event={e} slug={communitySlug!} className="w-32 shrink-0 opacity-60 grayscale-[35%] xl:w-auto" />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </SegolifeAppShell>
  );
}
