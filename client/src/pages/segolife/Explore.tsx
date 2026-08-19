import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, CalendarDays, Store } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatCardRewardBadge } from "@/lib/rewardPreview";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
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

type EventDateFilter = "today" | "tomorrow" | "week" | "all" | "ended";

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Filtro de fecha en cliente — comparación de límites de día en hora local
 * del navegador, suficiente para un chip de filtro (no es un límite de
 * negocio ni de seguridad). "ended" NUNCA pasa por aquí — usa su propia
 * query (publicEnded, Student-visible + temporal-aware de verdad, ver
 * eventsDb.ts::listEndedEvents) en vez de filtrar en cliente sobre
 * publicActive (que ya excluye todo lo pasado en el servidor) — por eso
 * este chequeo defensivo devuelve false explícitamente en vez de caer al
 * branch de "week" por accidente.
 */
function matchesDateFilter(startsAt: string | Date, filter: EventDateFilter, now: Date): boolean {
  if (filter === "ended") return false;
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
  const { isAuthenticated } = useAuth();
  const [dateFilter, setDateFilter] = useState<EventDateFilter>("all");
  const now = useMemo(() => new Date(), []);

  // "all" (y today/tomorrow/week) siguen consumiendo EXCLUSIVAMENTE
  // publicActive — nunca mezcla borradores ni histórico (spec FIX-05A §6:
  // "'All' NO debe volver a mezclar borradores privados"). Ended Events es
  // una fuente de datos DISTINTA a propósito (publicEnded/listEndedEvents,
  // Student-visible + temporal-aware de verdad — la mayoría del histórico
  // real ni siquiera tiene sourcePublicationStatus confirmado, así que
  // filtrar en cliente sobre publicActive sería directamente incorrecto:
  // publicActive nunca incluye eventos pasados en absoluto).
  const { data: events, isLoading, isError, refetch } = trpc.events.publicActive.useQuery(
    { communityId },
    { enabled: dateFilter !== "ended" }
  );
  const endedQ = trpc.events.publicEnded.useQuery(
    { communityId, limit: 24 },
    { enabled: dateFilter === "ended" }
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (dateFilter === "ended") {
      return (endedQ.data ?? []).filter(e => !q || e.name.toLowerCase().includes(q));
    }
    return (events ?? []).filter(
      e => matchesDateFilter(e.startsAt, dateFilter, now) && (!q || e.name.toLowerCase().includes(q))
    );
  }, [events, endedQ.data, dateFilter, search, now]);

  // SEGOTOKENS REWARD PREVIEW (Fase 10.6, spec §30/§31) — UN solo request de
  // red para toda la grilla visible (nunca N por card); solo con sesión, ya
  // que previewMyEventRewardBatch es autoservicio del propio Student.
  // Limitado a los primeros 24 eventos visibles (mismo tope que el servidor).
  // Ended Events NUNCA recibe reward preview — mismo criterio ya
  // establecido en VenueDetail.tsx para su sección de Past Events (un
  // evento ya finalizado no tiene una recompensa "por venir" que previsualizar).
  const batchItems = useMemo(
    () => (dateFilter === "ended" ? [] : filtered.slice(0, 24).map(e => ({ key: String(e.id), eventId: e.id, venueId: e.venue?.id ?? undefined }))),
    [filtered, dateFilter]
  );
  const rewardBatchQ = trpc.tokens.previewMyEventRewardBatch.useQuery(
    { items: batchItems },
    { enabled: isAuthenticated && batchItems.length > 0 }
  );

  const loading = dateFilter === "ended" ? endedQ.isLoading : isLoading;
  const errored = dateFilter === "ended" ? endedQ.isError : isError;
  const retry = dateFilter === "ended" ? () => endedQ.refetch() : () => refetch();

  if (loading) return <SegolifeCardGridSkeleton />;
  if (errored) return <SegolifeErrorState onRetry={retry} />;

  const filters: { key: EventDateFilter; label: string }[] = [
    { key: "today", label: t("explore.filterToday") },
    { key: "tomorrow", label: t("explore.filterTomorrow") },
    { key: "week", label: t("explore.filterThisWeek") },
    { key: "all", label: t("explore.filterAll") },
    { key: "ended", label: t("explore.filterEnded") },
  ];

  return (
    <div className="space-y-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4 xl:gap-5">
          {filtered.map(e => (
            <SegolifeEventCard
              key={e.id}
              event={e}
              slug={slug}
              rewardBadge={dateFilter === "ended" ? null : formatCardRewardBadge(rewardBatchQ.data?.[String(e.id)], t)}
            />
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
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4 xl:gap-5">
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
  // PRE-16.15 (auditoría overnight): Explore es navegable sin sesión (mismo
  // criterio documentado arriba), pero montaba SIEMPRE el nav completo de
  // SegolifeAppShell (Tickets/Comunity/Scan/Rewards/Perfil) — un visitante
  // anónimo veía la navegación de un Student ya autenticado, aunque
  // cualquier destino real le redirigiera limpiamente a /login. Reutiliza
  // `hideNav`, el prop YA existente de SegolifeAppShell para exactamente
  // esto — nunca un shell nuevo. Solo se oculta para el visitante SIN
  // sesión; un Student autenticado sigue viendo su nav completo, ya que
  // Explore es uno de sus destinos principales de navegación.
  const { isAuthenticated } = useAuth();
  const [tab, setTab] = useState<"events" | "venues">("events");
  const [search, setSearch] = useState("");

  return (
    <SegolifeAppShell title={t("explore.title")} hideNav={!isAuthenticated}>
      <SegolifePageContainer wide className="space-y-4 md:space-y-6">
        <h1 className="text-xl font-semibold text-foreground md:text-3xl">{t("explore.title")}</h1>

        <div className="relative md:max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground md:left-4 md:size-5" aria-hidden="true" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("explore.searchPlaceholder")}
            className="rounded-full pl-9 md:h-12 md:pl-11 md:text-base"
          />
        </div>

        <Tabs value={tab} onValueChange={v => setTab(v as "events" | "venues")}>
          <TabsList className="w-full md:w-auto">
            <TabsTrigger value="events" className="flex-1 md:flex-none md:px-6">{t("explore.tabEvents")}</TabsTrigger>
            <TabsTrigger value="venues" className="flex-1 md:flex-none md:px-6">{t("explore.tabVenues")}</TabsTrigger>
          </TabsList>
          <TabsContent value="events" className="mt-4">
            {slug && <EventsTab slug={slug} communityId={community?.id} search={search} />}
          </TabsContent>
          <TabsContent value="venues" className="mt-4">
            {slug && <VenuesTab slug={slug} communityId={community?.id} search={search} />}
          </TabsContent>
        </Tabs>
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
