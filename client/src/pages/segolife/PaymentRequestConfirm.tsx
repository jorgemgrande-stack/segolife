import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import { ChevronLeft, Loader2, Coins, Store, Clock3, CheckCircle2, XCircle, Timer, Ban } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../../server/routers";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { SegolifeErrorState } from "@/components/segolife/SegolifeErrorState";
import { Button } from "@/components/ui/button";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type GetByIdOutput = RouterOutputs["tokenPaymentRequests"]["getById"];
type EffectiveStatus = GetByIdOutput["effectiveStatus"];

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const STATUS_META: Record<Exclude<EffectiveStatus, "pending">, { icon: typeof CheckCircle2; className: string; titleKey: string; descriptionKey: string }> = {
  confirmed: { icon: CheckCircle2, className: "bg-primary/10 text-primary", titleKey: "paymentRequest.confirmedTitle", descriptionKey: "paymentRequest.confirmedDescription" },
  rejected: { icon: XCircle, className: "bg-secondary text-muted-foreground", titleKey: "paymentRequest.rejectedTitle", descriptionKey: "paymentRequest.rejectedDescription" },
  settled: { icon: CheckCircle2, className: "bg-primary/10 text-primary", titleKey: "paymentRequest.settledTitle", descriptionKey: "paymentRequest.settledDescription" },
  expired: { icon: Timer, className: "bg-secondary text-muted-foreground", titleKey: "paymentRequest.expiredTitle", descriptionKey: "paymentRequest.expiredDescription" },
  cancelled: { icon: Ban, className: "bg-secondary text-muted-foreground", titleKey: "paymentRequest.cancelledTitle", descriptionKey: "paymentRequest.cancelledDescription" },
};

/**
 * Confirmación/rechazo de una solicitud de pago con SegoTokens en persona —
 * /:community/payment-requests/:requestId (SEGOLIFE PRE-16.1 "Presential
 * SegoTokens Payments"). El operador (TPV/puerta de un venue) solo puede
 * SOLICITAR el pago — identificar al Student vía QR nunca autoriza el gasto
 * por sí mismo (regla de seguridad dura). Esta pantalla es el ÚNICO lugar
 * donde el propio Student aprueba o rechaza, siempre desde su móvil. Se
 * llega vía la notificación in-app (deep link ya generado server-side en
 * tokenPaymentRequestService.ts) o vía el banner de Home
 * (PendingPaymentRequestBanner en Home.tsx).
 *
 * `confirm` NUNCA mueve el ledger todavía — eso ocurre más tarde, cuando el
 * operador termina de cobrar el resto en el TPV/puerta (settleTokenPaymentRequest).
 * El éxito de esta mutación solo significa "aprobado, a la espera de que el
 * venue complete la venta", nunca "SegoTokens ya gastados".
 */
export default function PaymentRequestConfirm() {
  const { t } = useTranslation();
  const { slug } = useCommunity();
  const params = useParams<{ requestId: string }>();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const requestId = Number(params.requestId);
  const invalidId = !Number.isInteger(requestId) || requestId <= 0;

  const [actionResult, setActionResult] = useState<"confirmed" | "rejected" | null>(null);

  // Polling ligero (nunca websocket, spec Fase 7 punto 17) — mismo criterio
  // que myPending: solo mientras siga pendiente, tiene sentido notar en vivo
  // si el operador cancela o si la reserva caduca mientras el Student mira
  // esta pantalla.
  const { data, isLoading, error, refetch } = trpc.tokenPaymentRequests.getById.useQuery(
    { requestId },
    {
      enabled: !invalidId,
      refetchInterval: query => (query.state.data?.effectiveStatus === "pending" ? 15_000 : false),
      refetchIntervalInBackground: false,
    }
  );

  const walletQ = trpc.tokens.getMyWallet.useQuery();

  const communityId = data?.reservation.communityId ?? undefined;
  const venueId = data?.reservation.venueId ?? undefined;
  const venuesQ = trpc.venues.publicActive.useQuery({ communityId }, { enabled: !!communityId });
  const venueName = venueId != null ? venuesQ.data?.find(v => v.id === venueId)?.name : undefined;

  function resync() {
    utils.tokenPaymentRequests.myPending.invalidate();
    utils.tokenPaymentRequests.getById.invalidate({ requestId });
  }

  const confirmMut = trpc.tokenPaymentRequests.confirm.useMutation({
    onSuccess: () => { setActionResult("confirmed"); resync(); },
    onError: e => { toast.error(e.message); resync(); },
  });
  const rejectMut = trpc.tokenPaymentRequests.reject.useMutation({
    onSuccess: () => { setActionResult("rejected"); resync(); },
    onError: e => { toast.error(e.message); resync(); },
  });

  const isNotFound = ["NOT_FOUND", "FORBIDDEN"].includes((error as unknown as { data?: { code?: string } } | null)?.data?.code ?? "");

  if (isLoading) {
    return (
      <SegolifeAppShell requireAuth hideNav title={t("paymentRequest.title")}>
        <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" /></div>
      </SegolifeAppShell>
    );
  }

  return (
    <SegolifeAppShell requireAuth hideNav title={t("paymentRequest.title")}>
      <SegolifePageContainer>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(`/${slug}`)}>
          <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("common.back")}
        </Button>

        {(invalidId || isNotFound) && (
          <SegolifeEmptyState
            icon={<Ban className="size-5" aria-hidden="true" />}
            title={t("paymentRequest.notFoundTitle")}
            description={t("paymentRequest.notFoundDescription")}
          />
        )}

        {error && !invalidId && !isNotFound && <SegolifeErrorState onRetry={() => refetch()} />}

        {data && !invalidId && !error && (
          <PaymentRequestContent
            view={data}
            venueName={venueName}
            walletBalance={walletQ.data?.balance ?? 0}
            actionResult={actionResult}
            onConfirm={() => confirmMut.mutate({ requestId })}
            onReject={() => rejectMut.mutate({ requestId })}
            confirming={confirmMut.isPending}
            rejecting={rejectMut.isPending}
          />
        )}
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}

function PaymentRequestContent({
  view, venueName, walletBalance, actionResult, onConfirm, onReject, confirming, rejecting,
}: {
  view: GetByIdOutput;
  venueName: string | undefined;
  walletBalance: number;
  actionResult: "confirmed" | "rejected" | null;
  onConfirm: () => void;
  onReject: () => void;
  confirming: boolean;
  rejecting: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { reservation } = view;
  const status: EffectiveStatus = actionResult ?? view.effectiveStatus;

  // Cuenta atrás en vivo — puramente cosmética, la caducidad real siempre la
  // decide el servidor de forma perezosa (reconcileExpiry en
  // tokenPaymentRequestService.ts); esto solo evita dejar los botones
  // activos varios segundos después de que el contador visual llegue a cero.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== "pending") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  if (status !== "pending") {
    const meta = STATUS_META[status as Exclude<EffectiveStatus, "pending">];
    const Icon = meta.icon;
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <div className={`flex size-16 items-center justify-center rounded-full ${meta.className}`}>
          <Icon className="size-8" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">{t(meta.titleKey)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t(meta.descriptionKey)}</p>
        </div>
      </div>
    );
  }

  const remainingMs = new Date(reservation.expiresAt).getTime() - now;
  const expiringSoon = remainingMs <= 0;
  const remainingLabel = formatCountdown(remainingMs);

  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Store className="size-3.5" aria-hidden="true" /> {venueName ?? t("paymentRequest.venueFallback")}
        </p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-3xl font-bold tabular-nums text-foreground">
          <Coins className="size-6 text-primary" aria-hidden="true" /> {reservation.tokensReserved.toLocaleString(i18n.language)}
        </p>
        <p className="text-xs text-muted-foreground">{t("paymentRequest.tokensRequestedLabel")}</p>
      </div>

      <div className="segolife-card-shadow space-y-2.5 rounded-2xl bg-card p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("paymentRequest.valueCoveredLabel")}</span>
          <span className="font-semibold text-foreground">{(reservation.promotionalValueCents / 100).toFixed(2)} €</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("paymentRequest.moneyDueLabel")}</span>
          <span className="font-semibold text-foreground">{(reservation.moneyDueCents / 100).toFixed(2)} €</span>
        </div>
        <div className="flex justify-between border-t border-border pt-2.5">
          <span className="text-muted-foreground">{t("paymentRequest.totalLabel")}</span>
          <span className="font-semibold text-foreground">{(reservation.grossAmountCents / 100).toFixed(2)} €</span>
        </div>
      </div>

      <div className="segolife-card-shadow space-y-2.5 rounded-2xl bg-card p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("paymentRequest.walletBalanceLabel")}</span>
          <span className="font-semibold text-foreground">{walletBalance.toLocaleString(i18n.language)} ST</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("paymentRequest.walletBalanceAfterLabel")}</span>
          <span className="font-semibold text-foreground">{(walletBalance - reservation.tokensReserved).toLocaleString(i18n.language)} ST</span>
        </div>
      </div>

      <div className={`flex items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-medium ${expiringSoon ? "bg-destructive/10 text-destructive" : "bg-secondary text-secondary-foreground"}`}>
        <Clock3 className="size-4" aria-hidden="true" />
        {expiringSoon ? t("paymentRequest.expiringNotice") : t("paymentRequest.expiresInLabel", { time: remainingLabel })}
      </div>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 rounded-full" disabled={confirming || rejecting || expiringSoon} onClick={onReject}>
          {rejecting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : t("paymentRequest.rejectButton")}
        </Button>
        <Button className="flex-1 rounded-full" disabled={confirming || rejecting || expiringSoon} onClick={onConfirm}>
          {confirming ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : t("paymentRequest.confirmButton")}
        </Button>
      </div>
    </div>
  );
}
