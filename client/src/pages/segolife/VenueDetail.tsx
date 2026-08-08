import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronLeft, MapPin, MapPinOff, CalendarDays } from "lucide-react";
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

/**
 * Detalle de un Venue — /:community/venues/:slug (Fase 6). Página pública
 * (sin auth): imagen, nombre, categoría, dirección, descripción y próximos
 * eventos ahí. No existe todavía un endpoint público de "campañas activas" ni
 * de "beneficios disponibles" en este venue — esas secciones NO se
 * construyen con datos inventados, se omiten por completo hasta que haya una
 * fuente real (spec, "REAL DATA ONLY").
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

  const upcomingEvents = (venueEvents ?? [])
    .filter(e => new Date(e.startsAt).getTime() >= Date.now())
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  return (
    <SegolifeAppShell hideNav title={venue?.name}>
      <div className="mx-auto max-w-md px-4 py-5">
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(`/${communitySlug}/explore`)}>
          <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("common.back")}
        </Button>

        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="aspect-[16/10] w-full rounded-3xl" />
            <Skeleton className="h-6 w-2/3 rounded-full" />
            <Skeleton className="h-5 w-1/3 rounded-full" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        )}

        {error && !isLoading && <SegolifeErrorState onRetry={() => refetch()} />}

        {!isLoading && !error && detail === null && (
          <SegolifeEmptyState
            icon={<MapPinOff className="size-6" aria-hidden="true" />}
            title={t("venueDetail.notFoundTitle")}
            description={t("venueDetail.notFoundDescription")}
            actionLabel={t("nav.explore")}
            actionHref={`/${communitySlug}/explore`}
          />
        )}

        {venue && !isLoading && (
          <div className="space-y-5">
            <SegolifeImage src={venue.imageUrl} alt={venue.name} ratio={16 / 10} rounded="rounded-3xl" />

            <div>
              <h1 className="text-xl font-bold text-foreground">{venue.name}</h1>
              {category && (
                <div className="mt-1.5">
                  <span className="sr-only">{t("venueDetail.categoryLabel")}: </span>
                  <Badge variant="secondary">{category.name}</Badge>
                </div>
              )}
            </div>

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

            <p className={venue.description ? "text-sm leading-relaxed text-foreground" : "text-sm leading-relaxed text-muted-foreground"}>
              {venue.description || t("venueDetail.noDescription")}
            </p>

            <section className="space-y-3">
              <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
                <CalendarDays className="size-4 text-primary" aria-hidden="true" /> {t("venueDetail.upcomingEventsLabel")}
              </h2>
              {eventsLoading ? (
                <SegolifeCardRowSkeleton />
              ) : !upcomingEvents.length ? (
                <p className="text-sm text-muted-foreground">{t("venueDetail.noUpcomingEvents")}</p>
              ) : (
                <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
                  {upcomingEvents.map(e => (
                    <SegolifeEventCard key={e.id} event={e} slug={communitySlug!} className="w-36 shrink-0" />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </SegolifeAppShell>
  );
}
