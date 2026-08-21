import { useTranslation } from "react-i18next";
import { useParams, useLocation } from "wouter";
import { ChevronLeft, Loader2, Lock, MessageCircle, PackageSearch } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { Button } from "@/components/ui/button";

const STATUS_KEY: Record<string, string> = {
  open: "lostFound.statusOpen",
  found: "lostFound.statusFound",
  closed_not_found: "lostFound.statusClosedNotFound",
};

/**
 * LNF-01 — /:community/lost-items/:id. Detalle del propio caso del Student
 * (IDOR: lostFound.myReport resuelve por ctx.user.id, nunca confía en el id
 * de la URL por sí solo — otro Student recibe NOT_FOUND). "Ver conversación"
 * enlaza a MessageDetail.tsx SIN TOCAR (spec §10/§11: reutiliza COM-01 tal
 * cual, nunca un hilo de chat paralelo aquí).
 */
export default function LostItemDetail() {
  const { t, i18n } = useTranslation();
  const { slug } = useCommunity();
  const [, navigate] = useLocation();
  const { id } = useParams<{ id: string }>();
  const reportId = Number(id);

  const { data: report, isLoading, isError } = trpc.lostFound.myReport.useQuery(
    { id: reportId },
    { enabled: Number.isInteger(reportId) && reportId > 0 }
  );

  if (isLoading) {
    return (
      <SegolifeAppShell requireAuth hideNav title={t("lostFound.myLostItems")}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
        </div>
      </SegolifeAppShell>
    );
  }

  if (isError || !report) {
    return (
      <SegolifeAppShell requireAuth hideNav title={t("lostFound.myLostItems")}>
        <SegolifePageContainer>
          <SegolifeEmptyState
            icon={<Lock className="size-5" aria-hidden="true" />}
            title={t("lostFound.notFoundTitle")}
            description={t("lostFound.notFoundDescription")}
            actionLabel={t("lostFound.backToList")}
            actionHref={`/${slug}/lost-items`}
          />
        </SegolifePageContainer>
      </SegolifeAppShell>
    );
  }

  return (
    <SegolifeAppShell requireAuth hideNav title={report.venueName ?? t("lostFound.myLostItems")}>
      <SegolifePageContainer>
        <div className="mb-2">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(`/${slug}/lost-items`)}>
            <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("lostFound.backToList")}
          </Button>
        </div>

        <div className="segolife-card-shadow space-y-4 rounded-2xl bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-foreground">{report.venueName ?? "—"}</h1>
              <p className="text-xs text-muted-foreground">
                {t("lostFound.reportedOn")} {new Date(report.createdAt).toLocaleDateString(i18n.language, { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${report.status === "found" ? "bg-primary/15 text-primary" : report.status === "closed_not_found" ? "bg-secondary text-secondary-foreground" : "bg-accent/15 text-accent"}`}>
              {t(STATUS_KEY[report.status] ?? "lostFound.statusOpen")}
            </span>
          </div>

          {report.imageStorageKey && (
            <img
              src={`/api/lost-found/${report.id}/photo`}
              alt=""
              className="max-h-72 w-full rounded-xl object-cover"
            />
          )}

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t("lostFound.descriptionLabel")}</p>
            <p className="whitespace-pre-wrap text-sm text-foreground">{report.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t("lostFound.dateLostLabel")}</p>
              <p className="text-foreground">{report.lostDate}</p>
            </div>
            {report.approximateTime && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("lostFound.approximateTimeLabel")}</p>
                <p className="text-foreground">{report.approximateTime}</p>
              </div>
            )}
          </div>

          {report.resolutionNote && (
            <div className="rounded-xl bg-secondary p-3">
              <p className="text-xs font-medium text-secondary-foreground/80">{t("lostFound.lastUpdate")}</p>
              <p className="mt-0.5 text-sm text-secondary-foreground">{report.resolutionNote}</p>
            </div>
          )}

          {report.conversationId && (
            <Button
              variant="secondary"
              className="w-full rounded-full"
              onClick={() => navigate(`/${slug}/messages/${report.conversationId}`)}
            >
              <MessageCircle className="mr-2 size-4" aria-hidden="true" />
              {t("lostFound.viewConversation")}
              {report.unread && <span className="ml-2 size-1.5 rounded-full bg-accent" aria-hidden="true" />}
            </Button>
          )}
        </div>
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
