import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Ticket } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { SegolifeRowSkeleton } from "@/components/segolife/SegolifeSkeletons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  issued: "default", used: "secondary", cancelled: "outline", refunded: "outline",
};
const STATUS_KEY: Record<string, string> = {
  issued: "ticketing.ticketStatusIssued", used: "ticketing.ticketStatusUsed",
  cancelled: "ticketing.ticketStatusCancelled", refunded: "ticketing.ticketStatusRefunded",
};

/** /:community/tickets (Fase 8, spec punto 10) — mismo patrón que Activity.tsx/Rewards.tsx. */
export default function MyTickets() {
  const { t, i18n } = useTranslation();
  const { slug } = useCommunity();
  const [, navigate] = useLocation();

  const { data: tickets, isLoading } = trpc.ticketPurchase.myTickets.useQuery();

  return (
    <SegolifeAppShell requireAuth hideNav title={t("ticketing.myTicketsTitle")}>
      <SegolifePageContainer>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(`/${slug}/profile`)}>
          <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("common.back")}
        </Button>

        <h1 className="mb-4 text-xl font-bold text-foreground">{t("ticketing.myTicketsTitle")}</h1>

        {isLoading ? (
          <SegolifeRowSkeleton count={4} />
        ) : !tickets || tickets.length === 0 ? (
          <SegolifeEmptyState
            icon={<Ticket className="size-5" aria-hidden="true" />}
            title={t("ticketing.myTicketsEmpty")}
            description={t("ticketing.myTicketsEmptyDescription")}
          />
        ) : (
          <div className="space-y-2">
            {tickets.map(ticket => (
              <button
                key={ticket.id}
                onClick={() => navigate(`/${slug}/tickets/${ticket.id}`)}
                className="segolife-card-shadow flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left"
              >
                {ticket.event?.imageUrl ? (
                  <img
                    src={ticket.event.imageUrl}
                    alt=""
                    className="size-11 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Ticket className="size-5" aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{ticket.event?.name ?? "—"}</p>
                  {ticket.event?.startsAt && (
                    <p className="text-xs text-muted-foreground">
                      {new Date(ticket.event.startsAt).toLocaleDateString(i18n.language, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </div>
                <Badge variant={STATUS_VARIANT[ticket.status] ?? "outline"} className="shrink-0">{t(STATUS_KEY[ticket.status] ?? ticket.status)}</Badge>
              </button>
            ))}
          </div>
        )}
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
