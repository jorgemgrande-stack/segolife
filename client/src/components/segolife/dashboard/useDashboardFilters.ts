/**
 * useDashboardFilters.ts — spec §5/§33: estado ÚNICO de filtro (Comunidad +
 * Rango de tiempo), compartido por TODOS los widgets del Command Center —
 * ningún widget resuelve su propio filtro por separado. `communityId: null`
 * = "Todas" (nunca se infiere una comunidad desde un venue).
 */
import { useState, useMemo } from "react";

export type TimeRangeKey = "today" | "7d" | "30d" | "course";

export interface DashboardFiltersState {
  communityId: number | null;
  range: TimeRangeKey;
}

export interface DashboardQueryInput {
  communityId?: number | null;
  range?: TimeRangeKey;
}

export function useDashboardFilters() {
  const [communityId, setCommunityId] = useState<number | null>(null);
  const [range, setRange] = useState<TimeRangeKey>("30d");

  const queryInput: DashboardQueryInput = useMemo(() => ({ communityId, range }), [communityId, range]);

  return { communityId, setCommunityId, range, setRange, queryInput };
}
