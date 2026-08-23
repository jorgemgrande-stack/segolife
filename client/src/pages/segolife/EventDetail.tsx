import { useMemo, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronLeft, CalendarDays, Clock, MapPin, Users, Ticket, Minus, Plus, Loader2, ImageOff, Coins } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
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
  const { slug, community } = useCommunity();
  const params = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const eventSlug = params.slug;
  const { user } = useAuth();

  // Fase 15 (spec §16/§43) — pasa la comunidad real de la URL para que el
  // backend pueda ocultar un evento restringido a otra comunidad (nunca
  // solo un filtro de frontend, ver publicGetBySlug en events.ts).
  const { data, isLoading, error, refetch } = trpc.events.publicGetBySlug.useQuery(
    { slug: eventSlug, communityId: community?.id },
    { enabled: !!eventSlug }
  );

  const [posterFailed, setPosterFailed] = useState(false);
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
      communityId: community?.id,
    });
  };

  const totalQuantity = Object.values(quantities).reduce((a, b) => a + b, 0);

  // SEGOTOKENS REWARD PREVIEW (Fase 10.6, spec §31/§32) — el importe que se
  // manda es SOLO el total en € ya calculado con los precios reales que ya
  // muestra esta página (nunca una tasa) — el servidor resuelve cuánto ST da
  // eso. Solo con sesión (el preview es autoservicio del Student) y solo
  // para el flujo de venta nativa (origin="ticket" solo se concede ahí).
  const totalAmountEuros = useMemo(() => {
    if (data?.purchaseAction?.type !== "native_checkout") return undefined;
    const cents = data.purchaseAction.ticketTypes.reduce((sum, tt) => sum + (quantities[tt.id] ?? 0) * tt.priceCents, 0);
    return cents > 0 ? cents / 100 : undefined;
  }, [data, quantities]);

  const rewardQ = trpc.tokens.previewMyEventReward.useQuery(
    { eventId: data?.event.id ?? 0, venueId: data?.venue?.id, amountSpent: totalAmountEuros },
    { enabled: !!user && !!data?.event.id && data?.purchaseAction?.type === "native_checkout" }
  );
  const attendanceReward = rewardQ.data?.conditionalRewards.find(r => r.eligible && r.totalTokens > 0);

  return (
    <SegolifeAppShell hideNav title={data?.event.name}>
      {/* xl:max-w-[1400px] sustituye el xl:max-w-5xl (1024px) de `wide` —
          en desktop grande esta ficha necesita más superficie real (grid de
          2 columnas con poster + selector de entradas) que el resto de
          páginas hideNav; ver referencia visual aportada por el usuario. */}
      <SegolifePageContainer wide className="xl:max-w-[1400px]">
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
          // de 2 columnas — poster a la izquierda con una proporción propia
          // acotada (ya no "rellena" la altura de la columna derecha, que es
          // lo que antes disparaba el alto del póster hasta 2-3 pantallas
          // cuando la imagen fuente era un flyer muy vertical, empujando la
          // descripción a una fila aparte fuera de la vista — reportado con
          // captura real). Columna derecha = título+datos+descripción+CTA
          // apilados en un único bloque, mismo orden que en móvil y mismo
          // `space-y-5` que el contenedor externo usaba, para que el
          // resultado en móvil (sin ninguna clase `xl:`) sea IDÉNTICO al de
          // antes — no se toca su salida visual.
          <div className="space-y-5 xl:grid xl:grid-cols-[minmax(320px,420px)_1fr] xl:items-start xl:gap-x-10 xl:space-y-0">
            <div className="relative overflow-hidden rounded-3xl bg-muted">
              <div className="aspect-[16/10] w-full xl:aspect-[4/5]">
                {posterFailed || !data.event.imageUrl ? (
                  <div className="flex h-full w-full items-center justify-center bg-secondary/60">
                    <ImageOff className="size-6 text-muted-foreground" aria-hidden="true" />
                  </div>
                ) : (
                  <img
                    src={data.event.imageUrl}
                    alt={data.event.name}
                    loading="lazy"
                    decoding="async"
                    onError={() => setPosterFailed(true)}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              {data.event.isFeatured && (
                <Badge className="absolute left-3 top-3 border-none bg-accent text-accent-foreground">
                  {t("eventDetail.featuredBadge")}
                </Badge>
              )}
            </div>

            <div className="space-y-5 xl:space-y-4">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground">{data.event.name}</h1>
                {isEventPast(data.event) && (
                  <Badge variant="outline" className="shrink-0">{t("eventDetail.pastBadge")}</Badge>
                )}
              </div>

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

              {data.purchaseAction?.type === "external_url" && (
                <Button asChild className="w-full rounded-full py-6 text-sm font-semibold">
                  <a href={data.purchaseAction.url} target="_blank" rel="noopener noreferrer">
                    <Ticket className="mr-2 size-4" aria-hidden="true" /> {t("eventDetail.buyTickets")}
                  </a>
                </Button>
              )}

              {data.purchaseAction?.type === "native_checkout" && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("ticketing.selectTickets")}</h2>
                  <div className="space-y-2">
                    {data.purchaseAction.ticketTypes.map(tt => {
                      const soldOut = tt.available === 0;
                      const qty = quantities[tt.id] ?? 0;
                      return (
                        <div key={tt.id} className="segolife-card-shadow flex items-center justify-between gap-3 rounded-2xl bg-card p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{tt.name}</p>
                            {tt.description && <p className="truncate text-xs text-muted-foreground">{tt.description}</p>}
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

                  {!!rewardQ.data && (rewardQ.data.totalGuaranteedTokens > 0 || rewardQ.data.effectiveRate || attendanceReward) && (
                    <div className="segolife-card-shadow space-y-1.5 rounded-2xl border border-primary/20 bg-primary/5 p-3.5 text-sm">
                      {rewardQ.data.totalGuaranteedTokens > 0 ? (
                        <p className="flex items-center gap-1.5 font-medium text-foreground">
                          <Coins className="size-4 shrink-0 text-primary" aria-hidden="true" />
                          {t("rewardPreview.guaranteedWithAmount", { amount: rewardQ.data.totalGuaranteedTokens })}
                          {rewardQ.data.promotionalValue && (
                            <span className="text-xs font-normal text-muted-foreground">({t("rewardPreview.approxValue", { value: rewardQ.data.promotionalValue.formatted })})</span>
                          )}
                        </p>
                      ) : rewardQ.data.effectiveRate ? (
                        <p className="flex items-center gap-1.5 font-medium text-foreground">
                          <Coins className="size-4 shrink-0 text-primary" aria-hidden="true" />
                          {t("rewardPreview.guaranteedRateOnly", { rate: rewardQ.data.effectiveRate })}
                        </p>
                      ) : null}
                      {attendanceReward && (
                        <p className="text-xs text-muted-foreground">{t("rewardPreview.conditionalAttendance", { amount: attendanceReward.totalTokens })}</p>
                      )}
                    </div>
                  )}

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
                <Button variant="outline" disabled className="w-full rounded-full py-6 text-sm font-semibold">
                  <Ticket className="mr-2 size-4" aria-hidden="true" />
                  {isEventPast(data.event) ? t("eventDetail.eventEnded") : t("eventDetail.ticketsComingSoon")}
                </Button>
              )}
            </div>
          </div>
        )}
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
