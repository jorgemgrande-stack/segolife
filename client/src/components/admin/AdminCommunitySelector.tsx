import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAdminCommunity } from "@/contexts/AdminCommunityContext";
import { ADMIN_COMMUNITY_FILTER_ALL } from "@shared/segolife/adminCommunityFilter";
import { Globe } from "lucide-react";

/**
 * Selector global Todas/IE/UVA del admin. Las opciones vienen de la API
 * (communities.list) — nunca hardcodea nombres de comunidad. El valor
 * seleccionado persiste durante la sesión (AdminCommunityContext) y queda
 * listo para que CRM/eventos/venues/analítica lo lean como filtro (Fase 1C+).
 */
export default function AdminCommunitySelector() {
  const { filter, setFilter, communities, loading } = useAdminCommunity();

  if (loading || communities.length === 0) return null;

  const value = filter === ADMIN_COMMUNITY_FILTER_ALL ? ADMIN_COMMUNITY_FILTER_ALL : String(filter);

  return (
    <Select
      value={value}
      onValueChange={(v) => setFilter(v === ADMIN_COMMUNITY_FILTER_ALL ? ADMIN_COMMUNITY_FILTER_ALL : Number(v))}
    >
      <SelectTrigger className="w-[140px] h-9" aria-label="Filtro de comunidad">
        <Globe className="w-4 h-4 shrink-0 text-muted-foreground" />
        <SelectValue placeholder="Comunidad" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ADMIN_COMMUNITY_FILTER_ALL}>Todas</SelectItem>
        {communities.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
