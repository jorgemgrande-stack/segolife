import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronLeft, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
 * punto 27). Mientras no exista un PaymentProvider real configurado, "Pay"
 * SIEMPRE devuelve un estado honesto de "no disponible todavía" — nunca se
 * finge un pago exitoso (arquitectura preparada ≠ checkout falso).
 */
export default function TicketCheckout() {
  const { t, i18n } = useTranslation();
  const { slug } = useCommunity();
  const params = useParams<{ orderId: string }>();
  const [, navigate] = useLocation();
  const orderId = Number(params.orderId);
  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.ticketPurchase.myOrderById.useQuery({ orderId }, { enabled: !!orderId });

  const payMut = trpc.ticketPurchase.initiatePayment.useMutation({
    onSuccess: res => {
      if (res.paymentStatus === "succeeded") {
        toast.success(t("ticketing.orderStatusPaid"));
        navigate(`/${slug}/tickets`);
      } else {
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
        <div className="mx-auto max-w-md px-4 py-5 text-center text-sm text-muted-foreground">{t("eventDetail.notFoundTitle")}</div>
      </SegolifeAppShell>
    );
  }

  const { order, items } = data;
  const canPay = order.status === "pending" || order.status === "awaiting_payment";
  const canCancel = order.status === "pending" || order.status === "awaiting_payment";
  const lastFailure = payMut.data && "error" in payMut.data ? payMut.data.error : null;

  return (
    <SegolifeAppShell requireAuth hideNav title={t("ticketing.checkoutTitle")}>
      <div className="mx-auto max-w-md px-4 py-5">
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
            <Button className="mt-4 w-full rounded-full py-6 text-sm font-semibold" disabled={payMut.isPending} onClick={() => payMut.mutate({ orderId })}>
              {payMut.isPending ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {t("ticketing.payButton")} · {(order.totalCents / 100).toFixed(2)} {order.currency}
            </Button>
            {canCancel && (
              <Button variant="ghost" className="mt-2 w-full text-destructive" disabled={cancelMut.isPending} onClick={() => cancelMut.mutate({ orderId })}>
                {t("ticketing.cancelOrder")}
              </Button>
            )}
          </>
        )}
      </div>
    </SegolifeAppShell>
  );
}
