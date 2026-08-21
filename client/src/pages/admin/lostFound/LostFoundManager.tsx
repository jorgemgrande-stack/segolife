import { useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAdminCommunity, ADMIN_COMMUNITY_FILTER_ALL } from "@/contexts/AdminCommunityContext";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, PackageSearch, Loader2, Image as ImageIcon } from "lucide-react";

const ALL = "__all__";
const PAGE_SIZE = 50;

const STATUS_LABEL: Record<string, string> = { open: "Abierto", found: "Encontrado", closed_not_found: "Cerrado — no encontrado" };

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * LNF-01 — /admin/lost-found. Listado global (Global Admin, alcance de
 * getVenueStaffAccess = "all"). El mismo caso, si venue_admin lo gestiona,
 * se ve desde la pestaña "Objetos perdidos" de la Venue App (VenueApp.tsx) —
 * nunca este listado, que asume alcance total. Respeta el selector global
 * de comunidad ya existente en AdminLayout (spec §7), nunca uno propio.
 */
export default function LostFoundManager() {
  const { filter: communityFilter } = useAdminCommunity();
  const [venueId, setVenueId] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const venuesQ = trpc.venues.publicActive.useQuery({});
  const venues = venuesQ.data ?? [];

  const { data, isLoading } = trpc.lostFound.adminList.useQuery({
    venueId: venueId === ALL ? undefined : Number(venueId),
    communityId: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? undefined : Number(communityFilter),
    status: status === ALL ? undefined : (status as "open" | "found" | "closed_not_found"),
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <AdminLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <PackageSearch className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">Objetos perdidos</h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar por estudiante o descripción…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
          <Select value={venueId} onValueChange={v => { setVenueId(v); setPage(0); }}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Venue" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los venues</SelectItem>
              {venues.map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={v => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los estados</SelectItem>
              <SelectItem value="open">Abierto</SelectItem>
              <SelectItem value="found">Encontrado</SelectItem>
              <SelectItem value="closed_not_found">Cerrado — no encontrado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">No hay objetos perdidos registrados.</div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estudiante</TableHead>
                  <TableHead>Venue</TableHead>
                  <TableHead>Fecha de pérdida</TableHead>
                  <TableHead>Creado</TableHead>
                  <TableHead>Foto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(r => (
                  <TableRow key={r.id} className={r.unread ? "font-medium" : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {r.unread && <span className="size-1.5 rounded-full bg-accent shrink-0" aria-hidden="true" />}
                        <span className="truncate">{r.studentName ?? r.studentEmail ?? `#${r.studentUserId}`}</span>
                      </div>
                    </TableCell>
                    <TableCell>{r.venueName ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.lostDate}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-normal">{fmtDate(r.createdAt)}</TableCell>
                    <TableCell>{r.imageStorageKey ? <ImageIcon className="w-4 h-4 text-muted-foreground" aria-label="Con fotografía" /> : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "found" ? "default" : r.status === "closed_not_found" ? "secondary" : "outline"}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link href={`/admin/lost-found/${r.id}`} className="text-xs font-medium text-primary hover:underline">Abrir</Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}</span>
            <div className="flex gap-2">
              <button
                className="px-3 py-1 rounded border border-border disabled:opacity-40"
                disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
              >
                Anterior
              </button>
              <button
                className="px-3 py-1 rounded border border-border disabled:opacity-40"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage(p => p + 1)}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
