import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronLeft, Loader2, AlertTriangle, CheckCircle2, Coins } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const STATUS_KEY: Record<string, string> = {
  pending: "ticketing.orderStatusPending",
  awaiting_payment: "ticketing.orderStatusAwaitingPayment",
  paid: "ticketing.orderStatusPaid",
  cancelled: "ticketing.orderStatusCancelled",
  expired: "ticketing.orderStatusExpired",
  refunded: "ticketing.orderStatusRefunded",
  partially_refunded: "ticketing.orderStatusPartiallyRefunded",
  failed: "ticketing.orderStatusFailed",
  reconciliation_required: "ticketing.orderStatusReconciliationRequired",
};

/**
 * Resumen de pedido + pago — /:community/checkout/:orderId (Fase 8, spec
 * punto 27; SegoTokens parciales/totales en Pre-16.2 "Online Event
 * Checkout — SegoTokens + Money"). Mientras no exista un PaymentProvider
 * real configurado, cualquier importe de DINERO pendiente SIEMPRE devuelve
 * un estado honesto de "no disponible todavía" — nunca se finge un pago
 * exitoso (arquitectura preparada ≠ checkout falso). Una compra 100%
 * cubierta por SegoTokens sigue completándose sin tocar el provider.
 */
export default function TicketCheckout() {
  const { t, i18n } = useTranslation();
  const { slug } = useCommunity();
  const params = useParams<{ orderId: string }>();
  const [, navigate] = useLocation();
  const orderId = Number(params.orderId);
  const utils = trpc.useUtils();
  const [tokensInput, setTokensInput] = useState("");

  const { data, isLoading, refetch } = trpc.ticketPurchase.myOrderById.useQuery({ orderId }, { enabled: !!orderId });
  const walletQ = trpc.tokens.getMyWallet.useQuery();

  const requestedTokensNum = Number(tokensInput) || 0;
  const canPay = data ? data.order.status === "pending" || data.order.status === "awaiting_payment" : false;

  // SEGOTOKENS SPEND — COTIZACIÓN CANÓNICA (Pre-16.2, spec §7): el ST→€ y el
  // "cuánto queda por pagar" NUNCA se calculan en el cliente — siempre se
  // pide al mismo motor server-side que initiatePayment() usará de verdad
  // (tokenSpendService.ts), con el MISMO alcance venueId/eventId. Distinto
  // del preview de abajo (rewardQ), que es el lado "earn" — este es "spend".
  const quoteQ = trpc.tokens.myQuoteTokenSpend.useQuery(
    { venueId: data?.venueId ?? null, eventId: data?.order.eventId, grossAmountCents: data?.order.totalCents ?? 0, requestedTokens: requestedTokensNum },
    { enabled: !!data && canPay && requestedTokensNum > 0 }
  );
  const quote = quoteQ.data?.eligible ? quoteQ.data : null;
  const exceedsBalance = !!walletQ.data && requestedTokensNum > walletQ.data.balance;
  const moneyDueCents = quote ? quote.moneyDueCents : (data?.order.totalCents ?? 0);

  // SEGOTOKENS REWARD PREVIEW (Fase 10.6, spec §32) — cuánto ST va a ganar
  // ESTA compra (lado "earn", distinto del input de "pagar con ST" de abajo,
  // que es el lado "spend") — solo mientras el pedido sigue pagable.
  const rewardQ = trpc.tokens.previewMyReward.useQuery(
    { origin: "ticket", eventId: data?.order.eventId, amountSpent: data ? data.order.totalCents / 100 : undefined },
    { enabled: !!data && canPay }
  );

  const payMut = trpc.ticketPurchase.initiatePayment.useMutation({
    onSuccess: res => {
      if (res.paymentStatus === "succeeded") {
        toast.success(t("ticketing.orderStatusPaid"));
        navigate(`/${slug}/tickets`);
      } else {
        // "pending" (checkout hospedado, futuro real) o "failed" — en ambos
        // casos el order/badge de estado ya refleja la realidad al refetch,
        // nunca se finge un éxito (spec §14/§45.5).
        refetch();
      }
    },
    onError: e => toast.error(e.message),
  });
  const cancelMut = trpc.ticketPurchase.cancelMyOrder.useMutation({
    onSuccess: () => { utils.ticketPurchase.myOrders.invalidate(); navigate(`/${slug}/tickets`); },
    onError: e => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <SegolifeAppShell requireAuth hideNav title={t("ticketing.checkoutTitle")}>
        <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" /></div>
      </SegolifeAppShell>
    );
  }

  if (!data) {
    return (
      <SegolifeAppShell requireAuth hideNav title={t("ticketing.checkoutTitle")}>
        <SegolifePageContainer className="text-center text-sm text-muted-foreground">{t("eventDetail.notFoundTitle")}</SegolifePageContainer>
      </SegolifeAppShell>
    );
  }

  const { order, items } = data;
  const canCancel = order.status === "pending" || order.status === "awaiting_payment";
  const lastFailure = payMut.data && "error" in payMut.data ? payMut.data.error : null;

  return (
    <SegolifeAppShell requireAuth hideNav title={t("ticketing.checkoutTitle")}>
      <SegolifePageContainer>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(`/${slug}/tickets`)}>
          <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("common.back")}
        </Button>

        <h1 className="mb-1 text-xl font-bold text-foreground">{t("ticketing.checkoutTitle")}</h1>
        <Badge variant="secondary" className="mb-4">{t(STATUS_KEY[order.status] ?? order.status)}</Badge>

        <div className="segolife-card-shadow space-y-2.5 rounded-2xl bg-card p-4 text-sm">
          {items.map(item => (
            <div key={item.id} className="flex items-center justify-between gap-3">
              <span className="text-foreground">{item.ticketTypeName ?? "—"} × {item.quantity}</span>
              <span className="tabular-nums text-muted-foreground">{(item.totalPriceCents / 100).toFixed(2)} {order.currency}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-2.5 font-semibold">
            <span className="text-foreground">{t("ticketing.orderTotal")}</span>
            <span className="tabular-nums text-foreground">{(order.totalCents / 100).toFixed(2)} {order.currency}</span>
          </div>
        </div>

        {order.status === "paid" && (
          <div className="segolife-card-shadow mt-4 flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm text-foreground">
            <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden="true" /> {t("ticketing.orderStatusPaid")}
          </div>
        )}

        {canPay && (
          <>
            {lastFailure && (
              <div className="segolife-card-shadow mt-4 flex items-start gap-2 rounded-2xl border border-accent/30 bg-accent/10 p-4 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-foreground">{t("ticketing.paymentUnavailableTitle")}</p>
                  <p className="mt-0.5 text-muted-foreground">{t("ticketing.paymentUnavailableDescription")}</p>
                </div>
              </div>
            )}
            {!!rewardQ.data && rewardQ.data.totalGuaranteedTokens > 0 && (
              <div className="segolife-card-shadow mt-4 flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm">
                <Coins className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-foreground">
                  {t("rewardPreview.checkoutEarn", { amount: rewardQ.data.totalGuaranteedTokens })}
                  {rewardQ.data.promotionalValue && (
                    <span className="ml-1 text-xs text-muted-foreground">({t("rewardPreview.approxValue", { value: rewardQ.data.promotionalValue.formatted })})</span>
                  )}
                </p>
              </div>
            )}

            {/* Pre-16.2 ("Online Event Checkout — SegoTokens + Money"): el
                Student elige cuántos ST aplicar — parcial o total, el
                servidor clama/recalcula según la política de canje vigente
                (misma cotización canónica que initiatePayment() usará de
                verdad al confirmar). */}
            {walletQ.data && walletQ.data.balance > 0 && (
              <div className="segolife-card-shadow mt-4 space-y-2 rounded-2xl bg-card p-4 text-sm">
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  <Coins className="size-4 text-primary" aria-hidden="true" /> {t("ticketing.payWithTokens")}
                </p>
                <p className="text-xs text-muted-foreground">{t("ticketing.payWithTokensHint")} ({walletQ.data.balance} ST)</p>
                <div className="flex gap-2">
                  <Input type="number" min={0} max={walletQ.data.balance} value={tokensInput} onChange={e => setTokensInput(e.target.value)} placeholder="0" />
                  <Button variant="outline" size="sm" onClick={() => setTokensInput(String(walletQ.data!.balance))}>
                    {t("ticketing.useMaxTokensButton")}
                  </Button>
                </div>
                {exceedsBalance && <p className="text-xs text-destructive">{t("ticketing.tokensExceedBalance")}</p>}
                {quote && (
                  <div className="space-y-1 border-t border-border pt-2 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">{t("ticketing.tokensAppliedLabel")}</span><span className="font-medium text-foreground">{quote.tokensToSpend} ST</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t("ticketing.promotionalValueLabel")}</span><span className="font-medium text-foreground">−{(quote.promotionalValueCents / 100).toFixed(2)} {order.currency}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t("ticketing.remainingToPayLabel")}</span><span className="font-semibold text-foreground">{(quote.moneyDueCents / 100).toFixed(2)} {order.currency}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t("ticketing.balanceAfterLabel")}</span><span className="font-medium text-foreground">{walletQ.data.balance - quote.tokensToSpend} ST</span></div>
                  </div>
                )}
              </div>
            )}

            <Button
              className="mt-4 w-full rounded-full py-6 text-sm font-semibold"
              disabled={payMut.isPending || exceedsBalance}
              onClick={() => payMut.mutate({ orderId, tokensToApply: requestedTokensNum > 0 ? requestedTokensNum : undefined })}
            >
              {payMut.isPending ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {t("ticketing.payButton")} · {(moneyDueCents / 100).toFixed(2)} {order.currency}
            </Button>
            {canCancel && (
              <Button variant="ghost" className="mt-2 w-full text-destructive" disabled={cancelMut.isPending} onClick={() => cancelMut.mutate({ orderId })}>
                {t("ticketing.cancelOrder")}
              </Button>
            )}
          </>
        )}
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
