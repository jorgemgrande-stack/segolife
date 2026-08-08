import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, CalendarDays, Store } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifeEventCard } from "@/components/segolife/SegolifeEventCard";
import { SegolifeVenueCard } from "@/components/segolife/SegolifeVenueCard";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { SegolifeErrorState } from "@/components/segolife/SegolifeErrorState";
import { SegolifeCardGridSkeleton } from "@/components/segolife/SegolifeSkeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Explore — /:community/explore (Fase 6, spec puntos 9-13). Navegable sin
 * sesión (mismos endpoints públicos que ya usaba CommunityHome en Fase 1B):
 * pestañas Eventos/Locales, filtro de fecha (eventos) y categoría (locales)
 * calculados en cliente sobre el resultado ya cargado, búsqueda por nombre.
 * Sin mapa real: el mapa de Google Maps que pedía el spec no tiene ninguna
 * integración funcional en este repo (client/src/components/Map.tsx es
 * código muerto, apunta a un proxy de terceros no relacionado y no está
 * importado en ningún sitio) — en vez de simularlo se avisa con
 * explore.mapUnavailable y se muestra el listado completo (REAL DATA ONLY).
 */

type EventDateFilter = "today" | "tomorrow" | "week" | "all";

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Filtro de fecha en cliente — comparación de límites de día en hora local del navegador, suficiente para un chip de filtro (no es un límite de negocio ni de seguridad). */
function matchesDateFilter(startsAt: string | Date, filter: EventDateFilter, now: Date): boolean {
  if (filter === "all") return true;
  const starts = new Date(startsAt);
  if (filter === "today") return isSameLocalDay(starts, now);
  if (filter === "tomorrow") {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return isSameLocalDay(starts, tomorrow);
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekEnd = new Date(startOfToday);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return starts >= startOfToday && starts < weekEnd;
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
      )}
    >
      {label}
    </button>
  );
}

function EventsTab({ slug, communityId, search }: { slug: string; communityId?: number; search: string }) {
  const { t } = useTranslation();
  const { data: events, isLoading, isError, refetch } = trpc.events.publicActive.useQuery({ communityId });
  const [dateFilter, setDateFilter] = useState<EventDateFilter>("all");
  const now = useMemo(() => new Date(), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (events ?? []).filter(
      e => matchesDateFilter(e.startsAt, dateFilter, now) && (!q || e.name.toLowerCase().includes(q))
    );
  }, [events, dateFilter, search, now]);

  if (isLoading) return <SegolifeCardGridSkeleton />;
  if (isError) return <SegolifeErrorState onRetry={() => refetch()} />;

  const filters: { key: EventDateFilter; label: string }[] = [
    { key: "today", label: t("explore.filterToday") },
    { key: "tomorrow", label: t("explore.filterTomorrow") },
    { key: "week", label: t("explore.filterThisWeek") },
    { key: "all", label: t("explore.filterAll") },
  ];

  return (
    <div className="space-y-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {filters.map(f => (
          <FilterChip key={f.key} label={f.label} active={dateFilter === f.key} onClick={() => setDateFilter(f.key)} />
        ))}
      </div>
      {filtered.length === 0 ? (
        <SegolifeEmptyState
          icon={<CalendarDays className="size-5" aria-hidden="true" />}
          title={t("explore.noEventsFound")}
          description={t("explore.noEventsFoundDescription")}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map(e => (
            <SegolifeEventCard key={e.id} event={e} slug={slug} />
          ))}
        </div>
      )}
    </div>
  );
}

function VenuesTab({ slug, communityId, search }: { slug: string; communityId?: number; search: string }) {
  const { t } = useTranslation();
  const { data: venues, isLoading, isError, refetch } = trpc.venues.publicActive.useQuery({ communityId });
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const v of venues ?? []) {
      if (v.category?.name) names.add(v.category.name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [venues]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (venues ?? []).filter(
      v => (!category || v.category?.name === category) && (!q || v.name.toLowerCase().includes(q))
    );
  }, [venues, category, search]);

  if (isLoading) return <SegolifeCardGridSkeleton />;
  if (isError) return <SegolifeErrorState onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("explore.mapUnavailable")}</p>
      {!!categories.length && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <FilterChip label={t("explore.categoryAll")} active={!category} onClick={() => setCategory(null)} />
          {categories.map(c => (
            <FilterChip key={c} label={c} active={category === c} onClick={() => setCategory(c)} />
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <SegolifeEmptyState
          icon={<Store className="size-5" aria-hidden="true" />}
          title={t("explore.noVenuesFound")}
          description={t("explore.noVenuesFoundDescription")}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map(v => (
            <SegolifeVenueCard key={v.id} venue={{ ...v, categoryName: v.category?.name }} slug={slug} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Explore() {
  const { t } = useTranslation();
  const { community, slug } = useCommunity();
  const [tab, setTab] = useState<"events" | "venues">("events");
  const [search, setSearch] = useState("");

  return (
    <SegolifeAppShell title={t("explore.title")}>
      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        <h1 className="text-xl font-semibold text-foreground">{t("explore.title")}</h1>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("explore.searchPlaceholder")}
            className="rounded-full pl-9"
          />
        </div>

        <Tabs value={tab} onValueChange={v => setTab(v as "events" | "venues")}>
          <TabsList className="w-full">
            <TabsTrigger value="events" className="flex-1">{t("explore.tabEvents")}</TabsTrigger>
            <TabsTrigger value="venues" className="flex-1">{t("explore.tabVenues")}</TabsTrigger>
          </TabsList>
          <TabsContent value="events" className="mt-4">
            {slug && <EventsTab slug={slug} communityId={community?.id} search={search} />}
          </TabsContent>
          <TabsContent value="venues" className="mt-4">
            {slug && <VenuesTab slug={slug} communityId={community?.id} search={search} />}
          </TabsContent>
        </Tabs>
      </div>
    </SegolifeAppShell>
  );
}
