import { useMemo, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronLeft, CalendarDays, Clock, MapPin, Ticket, Minus, Plus, Loader2, ImageOff, Coins } from "lucide-react";
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
 * Event Detail UI Refresh (2026-08-23) — el evento SIEMPRE ocurre en un
 * venue físico de Segovia: la fecha/hora que ve el Student debe ser SIEMPRE
 * la hora de pared real del venue (Europe/Madrid), nunca la del dispositivo
 * de quien mira la pantalla. Confirmado como bug real y reproducible antes
 * de este rediseño (mismo evento real, mismo instante UTC almacenado,
 * abierto con 4 timezones de navegador distintas vía Playwright): sin fijar
 * `timeZone` explícitamente, `toLocaleDateString`/`toLocaleTimeString`
 * usan la del navegador — Madrid mostraba "00:00–04:30" (correcto), pero
 * New York mostraba "18:00–22:30" y Tokyo "07:00–11:00" para el MISMO
 * evento. Nunca antes se había manifestado porque hasta ahora solo se había
 * verificado desde un navegador ya en huso horario de Madrid.
 */
const MADRID_TZ = "Europe/Madrid";

/**
 * Detalle de un Evento — /:community/events/:slug (Fase 6, rediseño UI
 * 2026-08-23). Página pública (sin sesión, como Explore): poster
 * protagonista, título con jerarquía real, fecha/hora/venue/comunidades sin
 * aspecto de tabla administrativa, descripción con ancho de lectura cómodo,
 * y sección de entradas separada. "ticketsComingSoon" es un placeholder
 * honesto — la compra real de entradas (integración Fourvenues) es una fase
 * futura, aquí NUNCA se simula un flujo de compra.
 *
 * Auditado antes de tocar nada (spec §2): 3 estados reales de purchaseAction
 * (external_url/native_checkout/unavailable, ver purchaseAction.ts) — los
 * 3 se conservan intactos, este rediseño es puramente presentacional. Sin
 * fuente de datos real para "social proof" (asistentes confirmados) ni para
 * precio de puerta/restricción de edad estructurados — esa información SOLO
 * existe como texto libre dentro de `description` (copy real de Fourvenues,
 * ver docs/integrations/fourvenues.md) y se mantiene ahí, nunca parseada
 * mágicamente en datos falsos (spec §13/§16).
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
  // Rediseño 2026-08-23 (spec §17): NO se amplía a external_url aunque
  // conceptualmente podría existir una recompensa de asistencia también ahí
  // — mantener exactamente el mismo gate que ya había, cero cambio de
  // lógica/lectura de datos, solo presentación.
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
          páginas hideNav. */}
      <SegolifePageContainer wide className="xl:max-w-[1400px]">
        <Button variant="ghost" size="sm" className="-ml-2 mb-4 xl:mb-6" onClick={() => navigate(`/${slug}/explore`)}>
          <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("eventDetail.backToExplore")}
        </Button>

        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="aspect-[4/5] w-full max-w-[440px] rounded-3xl" />
            <Skeleton className="h-8 w-2/3 rounded-full" />
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
          // de 2 columnas — poster a la izquierda con proporción propia
          // acotada (nunca "rellena" la altura de la columna derecha, eso es
          // lo que antes disparaba el alto del póster con un flyer fuente
          // muy vertical). Columna derecha = título+contexto+fecha/hora+
          // comunidades+descripción+entradas apilados en un único bloque
          // editorial, mismo orden que en móvil y mismo `space-y-6` que el
          // contenedor externo usaba, para que el resultado en móvil (sin
          // ninguna clase `xl:`) sea el mismo flujo vertical de siempre —
          // solo con más aire (spec §4/§20), nunca menos información.
          <div className="space-y-6 xl:grid xl:grid-cols-[minmax(340px,440px)_1fr] xl:items-start xl:gap-x-12 xl:space-y-0">
            <div className="relative overflow-hidden rounded-3xl bg-muted">
              <div className="aspect-[4/5] w-full">
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
                <Badge className="absolute left-3 top-3 border-none bg-accent text-accent-foreground shadow-sm">
                  {t("eventDetail.featuredBadge")}
                </Badge>
              )}
            </div>

            <div className="space-y-6">
              {/* CABECERA — título con jerarquía real (misma escala que
                  VenueDetail.tsx, la ficha hermana ya rediseñada) + venue
                  como único subtítulo real (spec §6: nunca inventar un
                  subtítulo a partir de la descripción). */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight text-balance text-foreground sm:text-3xl xl:text-4xl">
                    {data.event.name}
                  </h1>
                  {isEventPast(data.event) && (
                    <Badge variant="outline" className="shrink-0">{t("eventDetail.pastBadge")}</Badge>
                  )}
                </div>
                {data.venue && (
                  <Link
                    href={`/${slug}/venues/${data.venue.slug}`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                  >
                    <MapPin className="size-4 shrink-0" aria-hidden="true" /> {data.venue.name}
                  </Link>
                )}
              </div>

              {/* FECHA / HORA — dos bloques visuales, no una fila de tabla (spec §7). */}
              <div className="grid grid-cols-2 gap-3">
                <div className="segolife-card-shadow rounded-2xl bg-card p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <CalendarDays className="size-3.5" aria-hidden="true" /> {t("eventDetail.dateLabel")}
                  </p>
                  <p className="mt-1.5 text-[15px] font-semibold text-foreground sm:text-base">
                    {new Date(data.event.startsAt).toLocaleDateString(i18n.language, { weekday: "long", day: "numeric", month: "long", timeZone: MADRID_TZ })}
                  </p>
                </div>
                <div className="segolife-card-shadow rounded-2xl bg-card p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Clock className="size-3.5" aria-hidden="true" /> {t("eventDetail.timeLabel")}
                  </p>
                  <p className="mt-1.5 text-[15px] font-semibold tabular-nums text-foreground sm:text-base">
                    {data.event.endsAt
                      ? `${new Date(data.event.startsAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone: MADRID_TZ })} – ${new Date(data.event.endsAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone: MADRID_TZ })}`
                      : new Date(data.event.startsAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone: MADRID_TZ })}
                  </p>
                </div>
              </div>

              {/* COMUNIDADES — chips discretos, nunca una lista tipo campo
                  de formulario; nunca IE/UVA hardcodeado, siempre lo real
                  que devuelve el backend (spec §10). */}
              {!!data.communities.length && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {data.communities.map(c => (
                    <Badge key={c.id} variant="secondary" className="rounded-full px-3 py-1 text-xs font-medium">
                      {c.name}
                    </Badge>
                  ))}
                </div>
              )}

              {/* ABOUT THIS EVENT — separado del bloque de metadatos, ancho
                  de lectura cómodo (max-w-prose ≈ 65ch), párrafos con
                  respiro (spec §11). Texto plano vía React (nunca
                  dangerouslySetInnerHTML) — mismo mecanismo seguro que ya
                  existía, auditado, sin cambios (spec §12). */}
              {!!data.event.description && (
                <div className="max-w-prose space-y-2 border-t border-border pt-6">
                  <h2 className="text-lg font-semibold text-foreground sm:text-xl">
                    {t("eventDetail.descriptionLabel")}
                  </h2>
                  <p className="whitespace-pre-line text-[15px] leading-relaxed text-foreground/90">{data.event.description}</p>
                </div>
              )}

              {/* ENTRADAS — sección propia, CTA con jerarquía comercial
                  clara; ancho completo solo en pantallas pequeñas (spec
                  §14), nunca ocupando una columna de escritorio entera. */}
              <div className="space-y-3 border-t border-border pt-6">
                <h2 className="text-lg font-semibold text-foreground sm:text-xl">{t("eventDetail.ticketsLabel")}</h2>

                {data.purchaseAction?.type === "external_url" && (
                  <Button asChild className="w-full rounded-full py-6 text-sm font-semibold sm:w-auto sm:min-w-64 sm:px-8">
                    <a href={data.purchaseAction.url} target="_blank" rel="noopener noreferrer">
                      <Ticket className="mr-2 size-4" aria-hidden="true" /> {t("eventDetail.buyTickets")}
                    </a>
                  </Button>
                )}

                {data.purchaseAction?.type === "native_checkout" && (
                  <div className="space-y-3">
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
                      className="w-full rounded-full py-6 text-sm font-semibold sm:w-auto sm:min-w-64 sm:px-8"
                      disabled={totalQuantity === 0 || startCheckoutMut.isPending}
                      onClick={handleContinue}
                    >
                      {startCheckoutMut.isPending ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : <Ticket className="mr-2 size-4" aria-hidden="true" />}
                      {t("ticketing.continueToCheckout")}
                    </Button>
                  </div>
                )}

                {data.purchaseAction?.type === "unavailable" && (
                  <Button variant="outline" disabled className="w-full rounded-full py-6 text-sm font-semibold sm:w-auto sm:min-w-64 sm:px-8">
                    <Ticket className="mr-2 size-4" aria-hidden="true" />
                    {isEventPast(data.event) ? t("eventDetail.eventEnded") : t("eventDetail.ticketsComingSoon")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
