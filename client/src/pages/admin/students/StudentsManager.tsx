import { useEffect, useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Avatar, AvatarFallback, AvatarImage,
} from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, GraduationCap, Loader2, ArrowUp, ArrowDown, Coins } from "lucide-react";
import { useAdminCommunity } from "@/contexts/AdminCommunityContext";
import { ADMIN_COMMUNITY_FILTER_ALL } from "@shared/segolife/adminCommunityFilter";

const ALL = "__all__";
const PAGE_SIZE = 50;

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "");
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

/** Debounce simple — antes cada tecleo disparaba un refetch inmediato. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

type SortBy = "createdAt" | "name";

function SortableHead({ label, column, sortBy, sortDir, onSort }: { label: string; column: SortBy; sortBy: SortBy; sortDir: "asc" | "desc"; onSort: (c: SortBy) => void }) {
  const active = sortBy === column;
  return (
    <TableHead className="cursor-pointer select-none" onClick={() => onSort(column)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </span>
    </TableHead>
  );
}

export default function StudentsManager() {
  // El selector global Todas/IE/UVA de Fase 1B alimenta directamente este
  // listado — es el uso real que le faltaba (ver docs/SEGOLIFE_ROADMAP.md).
  const { filter: communityFilter, communities } = useAdminCommunity();

  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [universityId, setUniversityId] = useState<string>(ALL);
  const [nationality, setNationality] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [profileCompleted, setProfileCompleted] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Cualquier cambio de filtro/orden vuelve a la primera página — evita
  // quedarse en un offset que ya no tiene sentido con el nuevo filtro.
  useEffect(() => { setPage(0); }, [search, universityId, nationality, status, profileCompleted, communityFilter, sortBy, sortDir]);

  const { data: universities } = trpc.communities.listUniversities.useQuery();

  const { data, isLoading, error } = trpc.students.list.useQuery({
    communityId: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? "all" : communityFilter,
    search: search || undefined,
    universityId: universityId !== ALL ? Number(universityId) : undefined,
    nationality: nationality || undefined,
    status: status !== ALL ? (status as "active" | "inactive") : undefined,
    profileCompleted: profileCompleted !== ALL ? profileCompleted === "true" : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    sortBy,
    sortDir,
  });

  const handleSort = (column: SortBy) => {
    if (sortBy === column) { setSortDir(d => (d === "asc" ? "desc" : "asc")); }
    else { setSortBy(column); setSortDir("desc"); }
  };

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminLayout title="Estudiantes">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <GraduationCap className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Estudiantes</h2>
            <p className="text-sm text-muted-foreground">
              {communityFilter === ADMIN_COMMUNITY_FILTER_ALL
                ? "Todas las comunidades"
                : communities.find(c => c.id === communityFilter)?.name ?? "Comunidad seleccionada"}
              {typeof data?.total === "number" ? ` · ${data.total} estudiante(s)` : ""}
            </p>
          </div>
        </div>

        {/* ── Filtros ── */}
        <div className="flex flex-wrap gap-3 items-center bg-card border border-border rounded-lg p-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o email…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={universityId} onValueChange={setUniversityId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Universidad" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las universidades</SelectItem>
              {(universities ?? []).map(u => (
                <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder="Nacionalidad (ES, US…)"
            value={nationality}
            onChange={e => setNationality(e.target.value.toUpperCase().slice(0, 2))}
            className="w-[160px]"
          />

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Cualquier estado</SelectItem>
              <SelectItem value="active">Activo</SelectItem>
              <SelectItem value="inactive">Inactivo</SelectItem>
            </SelectContent>
          </Select>

          <Select value={profileCompleted} onValueChange={setProfileCompleted}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Perfil" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Perfil (todos)</SelectItem>
              <SelectItem value="true">Perfil completo</SelectItem>
              <SelectItem value="false">Perfil incompleto</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* ── Tabla ── */}
        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-destructive">{error.message}</div>
          ) : !data || data.items.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Sin estudiantes que coincidan con los filtros.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Estudiante" column="name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  <TableHead>Email</TableHead>
                  <TableHead>Universidad</TableHead>
                  <TableHead>Comunidad</TableHead>
                  <TableHead>Nacionalidad</TableHead>
                  <TableHead>Programa</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>SegoTokens</TableHead>
                  <SortableHead label="Alta" column="createdAt" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map(s => (
                  <TableRow key={s.studentProfileId} className="cursor-pointer hover:bg-accent/50">
                    <TableCell>
                      <Link href={`/admin/students/${s.studentProfileId}`} className="flex items-center gap-2">
                        <Avatar className="w-8 h-8">
                          <AvatarImage src={s.avatarUrl ?? undefined} />
                          <AvatarFallback className="text-xs">{initials(s.name)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-foreground">
                          {s.name ?? "(sin nombre)"}
                          {!s.profileCompleted && (
                            <Badge variant="outline" className="ml-2 text-[10px]">Incompleto</Badge>
                          )}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.email ?? "—"}</TableCell>
                    <TableCell>{s.university?.name ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {s.communities.length === 0
                          ? <span className="text-muted-foreground">—</span>
                          : s.communities.map(c => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell>{s.nationality ?? "—"}</TableCell>
                    <TableCell>{s.degreeProgram ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "default" : "outline"}>
                        {s.status === "active" ? "Activo" : "Inactivo"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Coins className="w-3.5 h-3.5" />{s.tokensBalance}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(s.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* ── Paginación real (antes limit:100/offset:0 fijos, sin control) ── */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Página {page + 1} de {totalPages} · {total} estudiante(s) en total
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
