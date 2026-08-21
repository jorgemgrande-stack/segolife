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
import { Search, GraduationCap, Loader2, ArrowUp, ArrowDown, Coins, X, Pencil, Eye, EyeOff, Trash2, MessageCircle } from "lucide-react";
import { useAdminCommunity } from "@/contexts/AdminCommunityContext";
import { ADMIN_COMMUNITY_FILTER_ALL } from "@shared/segolife/adminCommunityFilter";
import { useUrlParam } from "@/hooks/useUrlParam";
import { EditStudentDialog, HideStudentDialog, DeleteStudentDialog, ComunicarDialog, useCommunicateAction } from "./StudentLifecycleDialogs";

/** STU-02 — botón "Comunicarse" de una fila: hook y diálogo propios, ya que cada fila necesita resolver/crear su propia conversación de forma independiente. */
function CommunicateRowButton({ studentUserId, name }: { studentUserId: number; name: string | null }) {
  const { communicate, checking, dialogOpen, setDialogOpen } = useCommunicateAction(studentUserId);
  return (
    <>
      <button
        onClick={ev => { ev.preventDefault(); ev.stopPropagation(); communicate(); }}
        disabled={checking}
        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
        title="Comunicarse"
        aria-label={`Comunicarse con ${name ?? "estudiante"}`}
      >
        {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
      </button>
      <ComunicarDialog studentUserId={studentUserId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

const SEGMENT_LABEL: Record<string, string> = {
  new: "Nuevos", active: "Activos", highly_engaged: "Muy comprometidos",
  at_risk: "En riesgo", dormant: "Dormidos", high_spend: "Alto gasto",
};
const VALID_SEGMENTS = new Set(Object.keys(SEGMENT_LABEL));

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

  // Deep navigation desde el Command Center (Student Intelligence) — spec §10/§13
  // "Production Polish Gate": ?segment=at_risk etc. Shareable/reload-safe/
  // back-button-safe (useUrlParam sincroniza con la URL real, no solo estado local).
  const [segmentParam, setSegmentParam] = useUrlParam("segment");
  const segment = segmentParam && VALID_SEGMENTS.has(segmentParam) ? segmentParam : null;

  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [universityId, setUniversityId] = useState<string>(ALL);
  const [nationality, setNationality] = useState("");
  // STU-01 — por defecto solo Activos (antes ALL): un estudiante Oculto
  // (status=inactive) debe dejar de aparecer en el listado normal salvo que
  // el Admin pida explícitamente "Inactivo" o "Cualquier estado" — nunca un
  // usuario perdido sin forma de encontrarlo, el filtro sigue disponible.
  const [status, setStatus] = useState<string>("active");
  const [profileCompleted, setProfileCompleted] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [editTarget, setEditTarget] = useState<number | null>(null);
  const [hideTarget, setHideTarget] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  // Cualquier cambio de filtro/orden vuelve a la primera página — evita
  // quedarse en un offset que ya no tiene sentido con el nuevo filtro.
  useEffect(() => { setPage(0); }, [search, universityId, nationality, status, profileCompleted, communityFilter, sortBy, sortDir, segment]);

  const { data: universities } = trpc.communities.listUniversities.useQuery();

  const communityIdParam = communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? "all" : communityFilter;

  // Segmento = motor de clasificación aparte (studentSegmentFilterService.ts,
  // no soporta `status`/sortBy — la clasificación por segmento reemplaza el
  // orden habitual, siempre por fecha de alta más reciente).
  const segmentQuery = trpc.students.listBySegment.useQuery(
    {
      segment: (segment ?? "active") as "new" | "active" | "highly_engaged" | "at_risk" | "dormant" | "high_spend",
      communityId: communityIdParam,
      search: search || undefined,
      universityId: universityId !== ALL ? Number(universityId) : undefined,
      nationality: nationality || undefined,
      profileCompleted: profileCompleted !== ALL ? profileCompleted === "true" : undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    },
    { enabled: segment !== null }
  );
  const listQuery = trpc.students.list.useQuery(
    {
      communityId: communityIdParam,
      search: search || undefined,
      universityId: universityId !== ALL ? Number(universityId) : undefined,
      nationality: nationality || undefined,
      status: status !== ALL ? (status as "active" | "inactive") : undefined,
      profileCompleted: profileCompleted !== ALL ? profileCompleted === "true" : undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      sortBy,
      sortDir,
    },
    { enabled: segment === null }
  );
  const { data, isLoading, error } = segment !== null ? segmentQuery : listQuery;

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
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-foreground">Estudiantes</h2>
            <p className="text-sm text-muted-foreground">
              {communityFilter === ADMIN_COMMUNITY_FILTER_ALL
                ? "Todas las comunidades"
                : communities.find(c => c.id === communityFilter)?.name ?? "Comunidad seleccionada"}
              {typeof data?.total === "number" ? ` · ${data.total} estudiante(s)` : ""}
            </p>
          </div>
          {segment && (
            <button
              onClick={() => setSegmentParam(null)}
              className="flex items-center gap-1.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-semibold px-3 py-1.5 hover:bg-violet-500/20 transition-colors"
            >
              Segmento: {SEGMENT_LABEL[segment]}
              <X className="w-3.5 h-3.5" />
            </button>
          )}
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

          <Select value={status} onValueChange={setStatus} disabled={segment !== null}>
            <SelectTrigger className="w-[150px]" title={segment !== null ? "No aplica junto con un filtro de segmento" : undefined}>
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
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
                  <TableHead>Acciones</TableHead>
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
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <CommunicateRowButton studentUserId={s.userId} name={s.name} />
                        <button
                          onClick={ev => { ev.preventDefault(); ev.stopPropagation(); setEditTarget(s.studentProfileId); }}
                          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                          title="Editar estudiante"
                          aria-label={`Editar ${s.name ?? s.email ?? "estudiante"}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={ev => { ev.preventDefault(); ev.stopPropagation(); setHideTarget(s.studentProfileId); }}
                          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                          title={s.status === "active" ? "Ocultar estudiante" : "Mostrar estudiante"}
                          aria-label={s.status === "active" ? `Ocultar ${s.name ?? "estudiante"}` : `Mostrar ${s.name ?? "estudiante"}`}
                        >
                          {s.status === "active" ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={ev => { ev.preventDefault(); ev.stopPropagation(); setDeleteTarget(s.studentProfileId); }}
                          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          title="Eliminar estudiante"
                          aria-label={`Eliminar ${s.name ?? "estudiante"}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </TableCell>
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

      <EditStudentDialog studentProfileId={editTarget} onClose={() => setEditTarget(null)} />
      <HideStudentDialog studentProfileId={hideTarget} onClose={() => setHideTarget(null)} />
      <DeleteStudentDialog studentProfileId={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </AdminLayout>
  );
}
