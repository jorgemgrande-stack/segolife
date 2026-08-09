import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { ChevronLeft, CalendarDays, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  issued: "default", used: "secondary", cancelled: "outline", refunded: "outline",
};
const STATUS_KEY: Record<string, string> = {
  issued: "ticketing.ticketStatusIssued", used: "ticketing.ticketStatusUsed",
  cancelled: "ticketing.ticketStatusCancelled", refunded: "ticketing.ticketStatusRefunded",
};

/**
 * Detalle de una entrada nativa — /:community/tickets/:id (Fase 8, spec
 * punto 10). El QR SOLO se renderiza si `qrToken` viene relleno en la
 * respuesta — el backend (ticketPurchase.ts) ya lo pone a `null` para
 * cualquier estado que no sea "issued", así que aquí basta con comprobar
 * su presencia, mismo criterio que BenefitDetail.tsx.
 */
export default function TicketDetail() {
  const { t, i18n } = useTranslation();
  const { slug } = useCommunity();
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const ticketId = Number(params.id);

  const { data: ticket, isLoading } = trpc.ticketPurchase.myTicketById.useQuery({ ticketId }, { enabled: !!ticketId });

  if (isLoading) {
    return (
      <SegolifeAppShell requireAuth hideNav title={t("ticketing.myTicketsTitle")}>
        <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" /></div>
      </SegolifeAppShell>
    );
  }

  if (!ticket) {
    return (
      <SegolifeAppShell requireAuth hideNav title={t("ticketing.myTicketsTitle")}>
        <SegolifePageContainer className="text-center text-sm text-muted-foreground">{t("eventDetail.notFoundTitle")}</SegolifePageContainer>
      </SegolifeAppShell>
    );
  }

  return (
    <SegolifeAppShell requireAuth hideNav title={ticket.event?.name}>
      <SegolifePageContainer>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(`/${slug}/tickets`)}>
          <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("common.back")}
        </Button>

        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-foreground">{ticket.event?.name ?? "—"}</h1>
          <Badge variant={STATUS_VARIANT[ticket.status] ?? "outline"}>{t(STATUS_KEY[ticket.status] ?? ticket.status)}</Badge>
        </div>

        {ticket.event?.startsAt && (
          <div className="segolife-card-shadow mb-4 flex items-center gap-2 rounded-2xl bg-card p-3 text-sm">
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-foreground">
              {new Date(ticket.event.startsAt).toLocaleString(i18n.language, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        )}

        {ticket.qrToken ? (
          <div className="segolife-elevated-shadow flex flex-col items-center gap-3 rounded-3xl bg-card p-6">
            <div className="rounded-2xl bg-white p-4">
              <QRCodeSVG value={ticket.qrToken} size={200} level="M" />
            </div>
            <p className="text-center text-xs text-muted-foreground">{t("ticketing.showQrAtEntrance")}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-3xl bg-secondary py-8 text-center">
            <p className="text-sm font-medium text-foreground">{t(STATUS_KEY[ticket.status] ?? ticket.status)}</p>
          </div>
        )}
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
