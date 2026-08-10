import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronLeft, CalendarDays, Clock, MapPin, Users, Ticket, Minus, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeImage } from "@/components/segolife/SegolifeImage";
import { SegolifeErrorState } from "@/components/segolife/SegolifeErrorState";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { isEventPast } from "@shared/segolife/eventTiming";

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
  const { user } = useAuth();

  const { data, isLoading, error, refetch } = trpc.events.publicGetBySlug.useQuery(
    { slug: eventSlug },
    { enabled: !!eventSlug }
  );

  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const startCheckoutMut = trpc.ticketPurchase.startCheckout.useMutation({
    onSuccess: res => navigate(`/${slug}/checkout/${res.order.id}`),
    onError: e => toast.error(e.message),
  });

  const setQty = (ticketTypeId: number, delta: number, max: number | null) => {
    setQuantities(q => {
      const next = Math.max(0, (q[ticketTypeId] ?? 0) + delta);
      return { ...q, [ticketTypeId]: max != null ? Math.min(next, max) : next };
    });
  };

  const handleContinue = () => {
    if (!user) { window.location.href = getLoginUrl(); return; }
    if (data?.purchaseAction?.type !== "native_checkout") return;
    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([ticketTypeId, quantity]) => ({ ticketTypeId: Number(ticketTypeId), quantity }));
    if (!items.length) return;
    startCheckoutMut.mutate({
      eventId: data.purchaseAction.eventId,
      items,
      idempotencyKey: `checkout:${data.purchaseAction.eventId}:${crypto.randomUUID()}`,
    });
  };

  const totalQuantity = Object.values(quantities).reduce((a, b) => a + b, 0);

  return (
    <SegolifeAppShell hideNav title={data?.event.name}>
      <SegolifePageContainer wide>
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
          // Desktop (xl+, mismo umbral que SegolifePageContainer wide): grid
          // de 2 columnas — poster a la izquierda (ocupa las 3 filas de
          // título/datos/compra) e info a la derecha, con la descripción a
          // ancho completo debajo. Sin ninguna clase `xl:` el móvil queda
          // exactamente igual que antes (mismo space-y-5 en flujo normal,
          // sin grid) — no se toca su salida visual.
          <div className="space-y-5 xl:grid xl:grid-cols-[minmax(320px,420px)_1fr] xl:items-start xl:gap-x-10 xl:gap-y-6 xl:space-y-0">
            <div className="relative xl:col-start-1 xl:row-start-1 xl:row-span-3">
              <SegolifeImage src={data.event.imageUrl} alt={data.event.name} ratio={16 / 10} rounded="rounded-3xl" />
              {data.event.isFeatured && (
                <Badge className="absolute left-3 top-3 border-none bg-accent text-accent-foreground">
                  {t("eventDetail.featuredBadge")}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 xl:col-start-2 xl:row-start-1">
              <h1 className="text-xl font-bold text-foreground">{data.event.name}</h1>
              {isEventPast(data.event) && (
                <Badge variant="outline" className="shrink-0">{t("eventDetail.pastBadge")}</Badge>
              )}
            </div>

            <div className="segolife-card-shadow space-y-2.5 rounded-2xl bg-card p-4 text-sm xl:col-start-2 xl:row-start-2">
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
              <div className="space-y-1.5 xl:col-span-2 xl:row-start-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("eventDetail.descriptionLabel")}
                </h2>
                <p className="whitespace-pre-line text-sm text-foreground">{data.event.description}</p>
              </div>
            )}

            {data.purchaseAction?.type === "external_url" && (
              <Button asChild className="w-full rounded-full py-6 text-sm font-semibold xl:col-start-2 xl:row-start-3">
                <a href={data.purchaseAction.url} target="_blank" rel="noopener noreferrer">
                  <Ticket className="mr-2 size-4" aria-hidden="true" /> {t("eventDetail.buyTickets")}
                </a>
              </Button>
            )}

            {data.purchaseAction?.type === "native_checkout" && (
              <div className="space-y-3 xl:col-start-2 xl:row-start-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("ticketing.selectTickets")}</h2>
                <div className="space-y-2">
                  {data.purchaseAction.ticketTypes.map(tt => {
                    const soldOut = tt.available === 0;
                    const qty = quantities[tt.id] ?? 0;
                    return (
                      <div key={tt.id} className="segolife-card-shadow flex items-center justify-between gap-3 rounded-2xl bg-card p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{tt.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(tt.priceCents / 100).toFixed(2)} {tt.currency}
                            {tt.available != null && <> · {soldOut ? t("ticketing.soldOut") : t("ticketing.available", { count: tt.available })}</>}
                          </p>
                        </div>
                        {soldOut ? (
                          <Badge variant="secondary">{t("ticketing.soldOut")}</Badge>
                        ) : (
                          <div className="flex shrink-0 items-center gap-2">
                            <Button size="icon" variant="outline" className="size-8 rounded-full" disabled={qty === 0} onClick={() => setQty(tt.id, -1, tt.available)}>
                              <Minus className="size-3.5" aria-hidden="true" />
                            </Button>
                            <span className="w-5 text-center text-sm font-semibold tabular-nums">{qty}</span>
                            <Button size="icon" variant="outline" className="size-8 rounded-full" disabled={tt.available != null && qty >= tt.available} onClick={() => setQty(tt.id, 1, tt.available)}>
                              <Plus className="size-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Button
                  className="w-full rounded-full py-6 text-sm font-semibold"
                  disabled={totalQuantity === 0 || startCheckoutMut.isPending}
                  onClick={handleContinue}
                >
                  {startCheckoutMut.isPending ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : <Ticket className="mr-2 size-4" aria-hidden="true" />}
                  {t("ticketing.continueToCheckout")}
                </Button>
              </div>
            )}

            {data.purchaseAction?.type === "unavailable" && (
              <Button variant="outline" disabled className="w-full rounded-full py-6 text-sm font-semibold xl:col-start-2 xl:row-start-3">
                <Ticket className="mr-2 size-4" aria-hidden="true" />
                {isEventPast(data.event) ? t("eventDetail.eventEnded") : t("eventDetail.ticketsComingSoon")}
              </Button>
            )}
          </div>
        )}
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
