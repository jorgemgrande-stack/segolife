/**
 * useDashboardFilters.ts — spec §5/§33 (Command Center) + Production Polish
 * Gate §11/§74 ("audita tokens/componentes existentes... no crear un
 * segundo sistema de filtros"): el filtro de COMUNIDAD reutiliza el
 * `AdminCommunityContext` REAL, ya usado por StudentsManager/VenuesManager/
 * EventsManager (persistido en localStorage, app-wide) — el Command Center
 * tenía antes su propio `useState` local, un sistema paralelo que además
 * rompía la propagación de contexto al navegar a otras pantallas del admin
 * (ver Production Polish Gate §11 "Community Context en Deep Links": ahora
 * es automática, mismo estado compartido, sin necesidad de pasar `?community=`
 * por la URL). El rango de tiempo SÍ es local — no existe un patrón
 * equivalente en el resto de /admin todavía.
 */
import { useState, useMemo } from "react";
import { useAdminCommunity, ADMIN_COMMUNITY_FILTER_ALL } from "@/contexts/AdminCommunityContext";

export type TimeRangeKey = "today" | "7d" | "30d" | "course";

export interface DashboardQueryInput {
  communityId?: number | null;
  range?: TimeRangeKey;
}

export function useDashboardFilters() {
  const { filter, setFilter, communities } = useAdminCommunity();
  const [range, setRange] = useState<TimeRangeKey>("30d");

  const communityId = filter === ADMIN_COMMUNITY_FILTER_ALL ? null : filter;
  const setCommunityId = (id: number | null) => setFilter(id === null ? ADMIN_COMMUNITY_FILTER_ALL : id);

  const queryInput: DashboardQueryInput = useMemo(() => ({ communityId, range }), [communityId, range]);

  return { communityId, setCommunityId, range, setRange, queryInput, communities };
}
