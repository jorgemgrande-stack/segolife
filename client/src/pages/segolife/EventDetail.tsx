import { useParams, useLocation, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronLeft, CalendarDays, Clock, MapPin, Users, Ticket } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifeImage } from "@/components/segolife/SegolifeImage";
import { SegolifeErrorState } from "@/components/segolife/SegolifeErrorState";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Detalle de un Evento — /:community/events/:slug (Fase 6). Página pública
 * (sin sesión, como Explore): hero, título, fecha/hora/venue/comunidades y
 * descripción. "ticketsComingSoon" es un placeholder honesto — la compra
 * real de entradas (integración Fourvenues) es una fase futura, aquí NUNCA
 * se simula un flujo de compra.
 */
export default function EventDetail() {
  const { t, i18n } = useTranslation();
  const { slug } = useCommunity();
  const params = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const eventSlug = params.slug;

  const { data, isLoading, error, refetch } = trpc.events.publicGetBySlug.useQuery(
    { slug: eventSlug },
    { enabled: !!eventSlug }
  );

  return (
    <SegolifeAppShell hideNav title={data?.event.name}>
      <div className="mx-auto max-w-md px-4 py-5">
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(`/${slug}/explore`)}>
          <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("eventDetail.backToExplore")}
        </Button>

        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="aspect-[16/10] w-full rounded-3xl" />
            <Skeleton className="h-6 w-2/3 rounded-full" />
            <Skeleton className="h-32 w-full rounded-2xl" />
          </div>
        )}

        {error && !isLoading && <SegolifeErrorState onRetry={() => refetch()} />}

        {!isLoading && !error && data === null && (
          <SegolifeEmptyState
            icon={<CalendarDays className="size-5" aria-hidden="true" />}
            title={t("eventDetail.notFoundTitle")}
            description={t("eventDetail.notFoundDescription")}
            actionLabel={t("eventDetail.backToExplore")}
            actionHref={`/${slug}/explore`}
          />
        )}

        {data && !isLoading && (
          <div className="space-y-5">
            <div className="relative">
              <SegolifeImage src={data.event.imageUrl} alt={data.event.name} ratio={16 / 10} rounded="rounded-3xl" />
              {data.event.isFeatured && (
                <Badge className="absolute left-3 top-3 border-none bg-accent text-accent-foreground">
                  {t("eventDetail.featuredBadge")}
                </Badge>
              )}
            </div>

            <h1 className="text-xl font-bold text-foreground">{data.event.name}</h1>

            <div className="segolife-card-shadow space-y-2.5 rounded-2xl bg-card p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <CalendarDays className="size-4" aria-hidden="true" /> {t("eventDetail.dateLabel")}
                </span>
                <span className="text-right text-foreground">
                  {new Date(data.event.startsAt).toLocaleDateString(i18n.language, { weekday: "long", day: "numeric", month: "long" })}
                </span>
              </div>

              <div className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="size-4" aria-hidden="true" /> {t("eventDetail.timeLabel")}
                </span>
                <span className="text-right text-foreground">
                  {data.event.endsAt
                    ? `${new Date(data.event.startsAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })} – ${new Date(data.event.endsAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })}`
                    : new Date(data.event.startsAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>

              {data.venue && (
                <div className="flex items-start justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="size-4" aria-hidden="true" /> {t("eventDetail.venueLabel")}
                  </span>
                  <Link href={`/${slug}/venues/${data.venue.slug}`} className="text-right font-medium text-primary">
                    {data.venue.name}
                  </Link>
                </div>
              )}

              {!!data.communities.length && (
                <div className="flex items-start justify-between gap-3 border-t border-border pt-2.5">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Users className="size-4" aria-hidden="true" /> {t("eventDetail.communityLabel")}
                  </span>
                  <span className="text-right text-foreground">{data.communities.map(c => c.name).join(", ")}</span>
                </div>
              )}
            </div>

            {!!data.event.description && (
              <div className="space-y-1.5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("eventDetail.descriptionLabel")}
                </h2>
                <p className="whitespace-pre-line text-sm text-foreground">{data.event.description}</p>
              </div>
            )}

            {data.purchaseAction?.type === "external_url" ? (
              <Button asChild className="w-full rounded-full py-6 text-sm font-semibold">
                <a href={data.purchaseAction.url} target="_blank" rel="noopener noreferrer">
                  <Ticket className="mr-2 size-4" aria-hidden="true" /> {t("eventDetail.buyTickets")}
                </a>
              </Button>
            ) : (
              <Button variant="outline" disabled className="w-full rounded-full py-6 text-sm font-semibold">
                <Ticket className="mr-2 size-4" aria-hidden="true" /> {t("eventDetail.ticketsComingSoon")}
              </Button>
            )}
          </div>
        )}
      </div>
    </SegolifeAppShell>
  );
}
