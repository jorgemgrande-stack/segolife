import { useEffect, useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, History, Loader2, ArrowUp, ArrowDown } from "lucide-react";

const ALL = "__all__";
const PAGE_SIZE = 25;

const VENUE_NAMES: Record<number, string> = { 1: "Casanova", 4: "Limoncello", 7: "Tía Felisa" };

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

export default function HistoricalIdentities() {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [venueId, setVenueId] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [crossVenueOnly, setCrossVenueOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>("lastActivity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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
    <AdminLayout title="Históricos Fourvenues">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <History className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Identidades históricas — Fourvenues</h2>
            <p className="text-sm text-muted-foreground">
              Compradores/asistentes reales de Casanova, Tía Felisa y Limoncello anteriores a su alta como estudiante.
              {typeof data?.total === "number" ? ` · ${data.total} identidad(es)` : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center bg-card border border-border rounded-lg p-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por email o teléfono…" value={searchInput} onChange={e => setSearchInput(e.target.value)} className="pl-9" />
          </div>

          <Select value={venueId} onValueChange={setVenueId}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Venue" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los venues</SelectItem>
              <SelectItem value="1">Casanova</SelectItem>
              <SelectItem value="7">Tía Felisa</SelectItem>
              <SelectItem value="4">Limoncello</SelectItem>
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

          <Button variant={crossVenueOnly ? "default" : "outline"} size="sm" onClick={() => setCrossVenueOnly(v => !v)}>
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
                  <TableHead>Contacto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Venues</TableHead>
                  <SortableHead label="Eventos" column="eventsCount" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  <TableHead className="text-right">Tickets</TableHead>
                  <TableHead className="text-right">Asistencias</TableHead>
                  <SortableHead label="Gasto histórico" column="historicalSpendCents" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  <SortableHead label="Última actividad" column="lastActivity" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map(item => (
                  <TableRow key={item.identityKey} className="cursor-pointer hover:bg-accent/50">
                    <TableCell>
                      <Link href={`/admin/students/historical/${encodeURIComponent(item.identityKey)}`} className="block">
                        <div className="font-medium text-foreground">{item.email ?? item.phone ?? "—"}</div>
                        {item.email && item.phone && <div className="text-xs text-muted-foreground">{item.phone}</div>}
                      </Link>
                    </TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[item.status]}>{STATUS_LABEL[item.status]}</Badge></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {item.venueIds.map(id => <Badge key={id} variant="secondary">{VENUE_NAMES[id] ?? `#${id}`}</Badge>)}
                        {item.crossVenue && <Badge variant="outline">cross-venue</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{item.eventsCount}</TableCell>
                    <TableCell className="text-right">{item.ticketsCount}</TableCell>
                    <TableCell className="text-right">{item.attendanceCount}</TableCell>
                    <TableCell className="text-right">{fmtSpend(item.historicalSpendCents)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtDate(item.lastActivity)}</TableCell>
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
