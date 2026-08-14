/**
 * DashboardFilterBar.tsx — selector de Comunidad (spec §5, real vía
 * `communities.list`, NUNCA hardcoded "IE"/"UVA") y de Rango de tiempo
 * (Hoy/7 días/30 días/Curso).
 */
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { TimeRangeKey } from "./useDashboardFilters";

const ALL = "__all__";

const RANGE_OPTIONS: Array<{ key: TimeRangeKey; label: string }> = [
  { key: "today", label: "Hoy" },
  { key: "7d", label: "7 días" },
  { key: "30d", label: "30 días" },
  { key: "course", label: "Curso" },
];

export function DashboardFilterBar({
  communityId, onCommunityChange, range, onRangeChange,
}: {
  communityId: number | null; onCommunityChange: (id: number | null) => void;
  range: TimeRangeKey; onRangeChange: (r: TimeRangeKey) => void;
}) {
  const { data: communities } = trpc.communities.list.useQuery();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={communityId != null ? String(communityId) : ALL}
        onValueChange={v => onCommunityChange(v === ALL ? null : Number(v))}
      >
        <SelectTrigger className="w-[160px] h-8 text-xs">
          <SelectValue placeholder="Comunidad" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todas las comunidades</SelectItem>
          {(communities ?? []).map(c => (
            <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center rounded-lg border border-border/50 p-0.5 bg-card/40">
        {RANGE_OPTIONS.map(opt => (
          <button
            key={opt.key}
            onClick={() => onRangeChange(opt.key)}
            className={cn(
              "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors",
              range === opt.key ? "bg-violet-500 text-white" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
