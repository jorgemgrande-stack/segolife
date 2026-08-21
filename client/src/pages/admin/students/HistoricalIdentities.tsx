import { useEffect, useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, History, Loader2, ArrowUp, ArrowDown, Link2, UserPlus, Pencil, EyeOff, Trash2, MessageCircle } from "lucide-react";
import { useUrlParam } from "@/hooks/useUrlParam";
import { EditStudentDialog, HideStudentDialog, DeleteStudentDialog, ComunicarDialog, useCommunicateAction } from "./StudentLifecycleDialogs";
import { ClaimDialog, ConvertToStudentDialog } from "./HistoricalIdentityDialogs";

const ALL = "__all__";
const PAGE_SIZE = 25;

const STATUS_LABEL: Record<string, string> = {
  UNREGISTERED: "No registrado",
  POSSIBLE_MATCH: "Posible coincidencia",
  AUTO_MATCH_CANDIDATE: "Coincidencia exacta",
  LINKED: "Vinculado",
  CONFLICT: "Conflicto",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  UNREGISTERED: "outline",
  POSSIBLE_MATCH: "secondary",
  AUTO_MATCH_CANDIDATE: "default",
  LINKED: "default",
  CONFLICT: "destructive",
};

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtSpend(cents: number) {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "");
}

type SortBy = "lastActivity" | "eventsCount" | "historicalSpendCents" | "venueIds";

function SortableHead({ label, column, sortBy, sortDir, onSort }: { label: string; column: SortBy; sortBy: SortBy; sortDir: "asc" | "desc"; onSort: (c: SortBy) => void }) {
  const active = sortBy === column;
  return (
    <TableHead className="cursor-pointer select-none text-right" onClick={() => onSort(column)}>
      <span className="inline-flex items-center gap-1">
        {active && (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
        {label}
      </span>
    </TableHead>
  );
}

const VALID_STATUS = new Set(["UNREGISTERED", "POSSIBLE_MATCH", "AUTO_MATCH_CANDIDATE", "LINKED", "CONFLICT"]);

/** Icon-only, mismo estilo que StudentsManager.tsx (CommunicateRowButton + Editar/Ocultar/Borrar) — para un estudiante YA vinculado, resolviendo el studentProfileId real a partir del linkedUserId. */
function LinkedRowActions({ userId, name }: { userId: number; name: string | null }) {
  const { data } = trpc.historicalIdentities.resolveLinkedStudent.useQuery({ userId });
  const studentProfileId = data?.studentProfileId ?? null;
  const [editOpen, setEditOpen] = useState(false);
  const [hideOpen, setHideOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { communicate, checking, dialogOpen, setDialogOpen } = useCommunicateAction(userId);

  if (!studentProfileId) return null;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={ev => { ev.preventDefault(); ev.stopPropagation(); communicate(); }}
        disabled={checking}
        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
        title="Comunicarse"
        aria-label={`Comunicarse con ${name ?? "estudiante"}`}
      >
        {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
      </button>
      <button
        onClick={ev => { ev.preventDefault(); ev.stopPropagation(); setEditOpen(true); }}
        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        title="Editar estudiante"
        aria-label={`Editar ${name ?? "estudiante"}`}
      >
        <Pencil className="w-4 h-4" />
      </button>
      <button
        onClick={ev => { ev.preventDefault(); ev.stopPropagation(); setHideOpen(true); }}
        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        title="Ocultar/Mostrar estudiante"
        aria-label={`Ocultar/Mostrar ${name ?? "estudiante"}`}
      >
        <EyeOff className="w-4 h-4" />
      </button>
      <button
        onClick={ev => { ev.preventDefault(); ev.stopPropagation(); setDeleteOpen(true); }}
        className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
        title="Eliminar estudiante"
        aria-label={`Eliminar ${name ?? "estudiante"}`}
      >
        <Trash2 className="w-4 h-4" />
      </button>

      <ComunicarDialog studentUserId={userId} open={dialogOpen} onOpenChange={setDialogOpen} />
      <EditStudentDialog studentProfileId={editOpen ? studentProfileId : null} onClose={() => setEditOpen(false)} />
      <HideStudentDialog studentProfileId={hideOpen ? studentProfileId : null} onClose={() => setHideOpen(false)} />
      <DeleteStudentDialog studentProfileId={deleteOpen ? studentProfileId : null} onClose={() => setDeleteOpen(false)} />
    </div>
  );
}

/**
 * Columna "Acciones" del listado (petición del cliente, 2026-08-21): mismo
 * criterio icon-only que /admin/students — qué icono se ofrece depende del
 * status real de la fila (nunca los 4 iconos de Student real para una
 * identidad que todavía no tiene cuenta, spec ya establecida en
 * HistoricalIdentityDetail.tsx). CONFLICT no ofrece ninguna acción rápida
 * aquí — requiere revisión manual en la ficha.
 */
function HistoricalRowActions({ item }: { item: { identityKey: string; name: string | null; email: string | null; status: string; linkedUserId: number | null } }) {
  const [claimOpen, setClaimOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  if (item.status === "LINKED" && item.linkedUserId != null) {
    return <LinkedRowActions userId={item.linkedUserId} name={item.name} />;
  }

  if (item.status === "CONFLICT") return null;

  return (
    <div className="flex items-center gap-1">
      {item.status === "UNREGISTERED" ? (
        <button
          onClick={ev => { ev.preventDefault(); ev.stopPropagation(); setConvertOpen(true); }}
          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          title="Convertir en estudiante real"
          aria-label={`Convertir en estudiante real a ${item.name ?? "identidad histórica"}`}
        >
          <UserPlus className="w-4 h-4" />
        </button>
      ) : (
        <button
          onClick={ev => { ev.preventDefault(); ev.stopPropagation(); setClaimOpen(true); }}
          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          title="Vincular a estudiante"
          aria-label={`Vincular a estudiante a ${item.name ?? "identidad histórica"}`}
        >
          <Link2 className="w-4 h-4" />
        </button>
      )}

      <ClaimDialog identityKey={item.identityKey} open={claimOpen} onOpenChange={setClaimOpen} />
      <ConvertToStudentDialog identityKey={item.identityKey} hasEmail={!!item.email} open={convertOpen} onOpenChange={setConvertOpen} />
    </div>
  );
}

export default function HistoricalIdentities() {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [venueId, setVenueId] = useState<string>(ALL);

  // Deep navigation desde el Command Center (Historical Audience/Cross-Venue,
  // spec §14 "Production Polish Gate") — shareable/reload-safe/back-button-safe.
  const [statusParam, setStatusParam] = useUrlParam("status");
  const status = statusParam && VALID_STATUS.has(statusParam) ? statusParam : ALL;
  const setStatus = (v: string) => setStatusParam(v === ALL ? null : v);

  const [crossVenueParam, setCrossVenueParam] = useUrlParam("crossVenueOnly");
  const crossVenueOnly = crossVenueParam === "true";
  const setCrossVenueOnly = (v: boolean) => setCrossVenueParam(v ? "true" : null);

  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>("lastActivity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Venues reales de la BD — nunca una lista fija de venues Fourvenues
  // conocidos (un venue nuevo con integración recién dada de alta debe
  // aparecer aquí sin tocar código, mismo criterio que IntegrationsManager.tsx).
  const { data: venuesResult } = trpc.venues.list.useQuery({ limit: 200 });
  const venues = venuesResult?.items ?? [];
  const venueNameById = Object.fromEntries(venues.map(v => [v.id, v.name]));

  useEffect(() => { setPage(0); }, [search, venueId, status, crossVenueOnly, sortBy, sortDir]);

  const { data, isLoading, error } = trpc.historicalIdentities.list.useQuery({
    search: search || undefined,
    venueId: venueId !== ALL ? Number(venueId) : undefined,
    status: status !== ALL ? (status as "UNREGISTERED" | "POSSIBLE_MATCH" | "AUTO_MATCH_CANDIDATE" | "LINKED" | "CONFLICT") : undefined,
    crossVenueOnly: crossVenueOnly || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    sortBy,
    sortDir,
  });

  const handleSort = (column: SortBy) => {
    if (sortBy === column) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(column); setSortDir("desc"); }
  };

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminLayout title="Estudiantes históricos">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <History className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Estudiantes históricos</h2>
            <p className="text-sm text-muted-foreground">
              Identidades y actividad histórica importada de Fourvenues — personas reales, aún no vinculadas a una cuenta Segolife.
              {typeof data?.total === "number" ? ` · ${data.total} identidad(es)` : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center bg-card border border-border rounded-lg p-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por nombre, email o teléfono…" value={searchInput} onChange={e => setSearchInput(e.target.value)} className="pl-9" />
          </div>

          <Select value={venueId} onValueChange={setVenueId}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Venue" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los venues</SelectItem>
              {venues.map(v => (
                <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[190px]"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Cualquier estado</SelectItem>
              <SelectItem value="UNREGISTERED">No registrado</SelectItem>
              <SelectItem value="POSSIBLE_MATCH">Posible coincidencia</SelectItem>
              <SelectItem value="AUTO_MATCH_CANDIDATE">Coincidencia exacta</SelectItem>
              <SelectItem value="LINKED">Vinculado</SelectItem>
              <SelectItem value="CONFLICT">Conflicto</SelectItem>
            </SelectContent>
          </Select>

          <Button variant={crossVenueOnly ? "default" : "outline"} size="sm" onClick={() => setCrossVenueOnly(!crossVenueOnly)}>
            Solo cross-venue
          </Button>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-destructive">{error.message}</div>
          ) : !data || data.items.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Sin identidades que coincidan con los filtros.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[240px]">Estudiante histórico</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Venues</TableHead>
                  <SortableHead label="Eventos" column="eventsCount" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  <TableHead className="text-right">Tickets</TableHead>
                  <TableHead className="text-right">Asistencias</TableHead>
                  <SortableHead label="Gasto histórico" column="historicalSpendCents" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  <SortableHead label="Última actividad" column="lastActivity" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map(item => (
                  <TableRow key={item.identityKey} className="cursor-pointer hover:bg-accent/50">
                    <TableCell>
                      <Link href={`/admin/students/historical/${encodeURIComponent(item.identityKey)}`} className="flex items-center gap-2.5">
                        <Avatar className="w-8 h-8 shrink-0">
                          <AvatarFallback className="text-xs">{initials(item.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate">{item.name ?? "(sin nombre)"}</div>
                          <div className="text-xs text-muted-foreground truncate">{item.email ?? "—"}</div>
                          {item.phone && <div className="text-xs text-muted-foreground truncate">{item.phone}</div>}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[item.status]}>{STATUS_LABEL[item.status]}</Badge></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {item.venueIds.map(id => <Badge key={id} variant="secondary">{venueNameById[id] ?? `#${id}`}</Badge>)}
                        {item.crossVenue && <Badge variant="outline">cross-venue</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{item.eventsCount}</TableCell>
                    <TableCell className="text-right">{item.ticketsCount}</TableCell>
                    <TableCell className="text-right">{item.attendanceCount}</TableCell>
                    <TableCell className="text-right">{fmtSpend(item.historicalSpendCents)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtDate(item.lastActivity)}</TableCell>
                    <TableCell><HistoricalRowActions item={item} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Página {page + 1} de {totalPages} · {total} identidad(es) en total</p>
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
