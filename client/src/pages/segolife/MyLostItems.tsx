import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { ChevronLeft, PackageSearch } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { SegolifeRowSkeleton } from "@/components/segolife/SegolifeSkeletons";
import { Button } from "@/components/ui/button";

const STATUS_KEY: Record<string, string> = {
  open: "lostFound.statusOpen",
  found: "lostFound.statusFound",
  closed_not_found: "lostFound.statusClosedNotFound",
};

/**
 * LNF-01 — /:community/lost-items. "Mis objetos perdidos" (spec §16):
 * acceso secundario desde Profile, nunca un ítem más del bottom nav — el
 * volumen real de casos de UN Student es siempre pequeño. Siempre los SUYOS,
 * resueltos server-side por ctx.user.id (lostFound.myReports), nunca un id
 * enviado desde aquí.
 */
export default function MyLostItems() {
  const { t, i18n } = useTranslation();
  const { slug } = useCommunity();
  const [, navigate] = useLocation();

  const { data, isLoading } = trpc.lostFound.myReports.useQuery({ limit: 50 });
  const items = data?.items ?? [];

  return (
    <SegolifeAppShell requireAuth hideNav title={t("lostFound.myLostItems")}>
      <SegolifePageContainer>
        <div className="mb-2">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(`/${slug}/profile`)}>
            <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("common.back")}
          </Button>
        </div>

        <h1 className="mb-4 text-xl font-bold text-foreground">{t("lostFound.myLostItems")}</h1>

        {isLoading ? (
          <SegolifeRowSkeleton count={4} />
        ) : items.length === 0 ? (
          <SegolifeEmptyState
            icon={<PackageSearch className="size-5" aria-hidden="true" />}
            title={t("lostFound.myLostItemsEmpty")}
            description={t("lostFound.myLostItemsEmptyDescription")}
          />
        ) : (
          <div className="space-y-2">
            {items.map(r => (
              <Link
                key={r.id}
                href={`/${slug}/lost-items/${r.id}`}
                className={`segolife-card-shadow flex w-full items-start gap-3 rounded-2xl bg-card p-3 text-left transition-opacity ${r.unread ? "" : "opacity-70"}`}
              >
                <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary">
                  {r.imageStorageKey ? (
                    <img src={`/api/lost-found/${r.id}/photo`} alt="" className="size-full object-cover" />
                  ) : (
                    <PackageSearch className="size-5" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-foreground">{r.venueName ?? "—"}</p>
                    {r.unread && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{r.description}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{new Date(r.createdAt).toLocaleDateString(i18n.language, { day: "2-digit", month: "short" })}</span>
                    <span className={`rounded-full px-1.5 py-0.5 font-medium ${r.status === "found" ? "bg-primary/15 text-primary" : r.status === "closed_not_found" ? "bg-secondary" : "text-primary"}`}>
                      {t(STATUS_KEY[r.status] ?? "lostFound.statusOpen")}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
