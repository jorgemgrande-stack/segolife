import { useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Avatar, AvatarFallback, AvatarImage,
} from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, GraduationCap, Loader2 } from "lucide-react";
import { useAdminCommunity } from "@/contexts/AdminCommunityContext";
import { ADMIN_COMMUNITY_FILTER_ALL } from "@shared/segolife/adminCommunityFilter";

const ALL = "__all__";

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "");
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export default function StudentsManager() {
  // El selector global Todas/IE/UVA de Fase 1B alimenta directamente este
  // listado — es el uso real que le faltaba (ver docs/SEGOLIFE_ROADMAP.md).
  const { filter: communityFilter, communities } = useAdminCommunity();

  const [search, setSearch] = useState("");
  const [universityId, setUniversityId] = useState<string>(ALL);
  const [nationality, setNationality] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [profileCompleted, setProfileCompleted] = useState<string>(ALL);

  const { data: universities } = trpc.communities.listUniversities.useQuery();

  const { data, isLoading, error } = trpc.students.list.useQuery({
    communityId: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? "all" : communityFilter,
    search: search || undefined,
    universityId: universityId !== ALL ? Number(universityId) : undefined,
    nationality: nationality || undefined,
    status: status !== ALL ? (status as "active" | "inactive") : undefined,
    profileCompleted: profileCompleted !== ALL ? profileCompleted === "true" : undefined,
    limit: 100,
    offset: 0,
  });

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
              value={search}
              onChange={e => setSearch(e.target.value)}
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
                  <TableHead>Estudiante</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Universidad</TableHead>
                  <TableHead>Comunidad</TableHead>
                  <TableHead>Nacionalidad</TableHead>
                  <TableHead>Programa</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Alta</TableHead>
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
                    <TableCell className="text-muted-foreground">{fmtDate(s.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
