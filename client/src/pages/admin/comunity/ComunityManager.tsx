import { useMemo, useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Vote, Loader2, Plus, Zap, Flame, ShieldQuestion, Clock, CheckCircle2 } from "lucide-react";
import { useAdminCommunity } from "@/contexts/AdminCommunityContext";
import { ADMIN_COMMUNITY_FILTER_ALL } from "@shared/segolife/adminCommunityFilter";
import { QUESTION_TYPE_LABEL, STATUS_LABEL, STATUS_VARIANT, fmtDateTime, timeLeftLabel, type ComunityQuestionType, type ComunityStatus } from "@/lib/comunity";

const ALL = "__all__";
const ENDING_SOON_MS = 3 * 60 * 60 * 1000; // spec punto 36: "Ending soon" — próximas 3h

/**
 * Panel de COMUNITY — /admin/comunity (spec puntos 36-37, 81). Nunca una
 * tabla CRUD plana como pantalla principal: cabecera de "cubos" visuales
 * (activas/flash/moderación pendiente/a punto de cerrar/alta demanda/
 * convertidas) + la tabla operativa debajo con filtros reales.
 */
export default function ComunityManager() {
  const { filter: communityFilter, communities } = useAdminCommunity();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [questionType, setQuestionType] = useState<string>(ALL);

  const { data, isLoading, error } = trpc.community.list.useQuery({
    communityId: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? "all" : communityFilter,
    search: search || undefined,
    status: status !== ALL ? (status as ComunityStatus) : undefined,
    questionType: questionType !== ALL ? (questionType as ComunityQuestionType) : undefined,
    limit: 200,
    offset: 0,
  });

  const { data: pendingIdeas } = trpc.community.listStudentProposals.useQuery({
    communityId: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? "all" : communityFilter,
    status: "pending_moderation",
    limit: 200,
  });
  const { data: trending } = trpc.community.trending.useQuery({});

  const items = data?.items ?? [];

  const buckets = useMemo(() => {
    const now = Date.now();
    const active = items.filter(p => p.status === "active");
    const flash = active.filter(p => p.urgencyType === "flash");
    const endingSoon = active.filter(p => p.endsAt && new Date(p.endsAt).getTime() - now <= ENDING_SOON_MS && new Date(p.endsAt).getTime() > now);
    const converted = items.filter(p => p.status === "converted");
    return {
      active: active.length,
      flash: flash.length,
      pendingModeration: pendingIdeas?.total ?? 0,
      endingSoon: endingSoon.length,
      highDemand: trending?.length ?? 0,
      converted: converted.length,
    };
  }, [items, pendingIdeas, trending]);

  return (
    <AdminLayout title="COMUNITY">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Vote className="w-6 h-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">COMUNITY</h2>
              <p className="text-sm text-muted-foreground">
                {communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? "Todas las comunidades" : communities.find(c => c.id === communityFilter)?.name ?? "Comunidad seleccionada"}
                {typeof data?.total === "number" ? ` · ${data.total} propuesta(s)` : ""}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/comunity/moderacion"><Button variant="outline"><ShieldQuestion className="w-4 h-4 mr-2" /> Moderación</Button></Link>
            <Link href="/admin/comunity/nueva"><Button><Plus className="w-4 h-4 mr-2" /> Nueva propuesta</Button></Link>
          </div>
        </div>

        {/* ── Cubos visuales ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <BucketCard icon={Vote} label="Activas" value={buckets.active} tone="text-primary" />
          <BucketCard icon={Zap} label="Flash" value={buckets.flash} tone="text-amber-500" />
          <BucketCard icon={ShieldQuestion} label="Moderación pendiente" value={buckets.pendingModeration} tone="text-orange-500" href="/admin/comunity/moderacion" />
          <BucketCard icon={Clock} label="A punto de cerrar" value={buckets.endingSoon} tone="text-destructive" />
          <BucketCard icon={Flame} label="Alta demanda" value={buckets.highDemand} tone="text-rose-500" href="/admin/comunity/moderacion" />
          <BucketCard icon={CheckCircle2} label="Convertidas" value={buckets.converted} tone="text-emerald-500" />
        </div>

        {/* ── Filtros ── */}
        <div className="flex flex-wrap gap-3 items-center bg-card border border-border rounded-lg p-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por título…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Cualquier estado</SelectItem>
              {(Object.entries(STATUS_LABEL) as [ComunityStatus, string][]).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={questionType} onValueChange={setQuestionType}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Cualquier tipo</SelectItem>
              {(Object.entries(QUESTION_TYPE_LABEL) as [ComunityQuestionType, string][]).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* ── Tabla operativa ── */}
        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-destructive">{error.message}</div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Sin propuestas que coincidan con los filtros.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Comunidad</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Cierra</TableHead>
                  <TableHead>Origen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(p => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-accent/50">
                    <TableCell>
                      <Link href={`/admin/comunity/${p.id}`} className="font-medium text-foreground">{p.title}</Link>
                      {p.urgencyType === "flash" && <Badge variant="secondary" className="ml-2">⚡ Flash</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {p.communities.length === 0 ? <span className="text-muted-foreground">Global</span> : p.communities.map(c => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{QUESTION_TYPE_LABEL[p.questionType as ComunityQuestionType]}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[p.status as ComunityStatus]}>{STATUS_LABEL[p.status as ComunityStatus]}</Badge></TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {p.status === "active" ? timeLeftLabel(p.endsAt) : fmtDateTime(p.endsAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {p.sourceStudentProposalId ? "Idea de estudiante" : "Admin"}
                    </TableCell>
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

function BucketCard({ icon: Icon, label, value, tone, href }: { icon: React.ElementType; label: string; value: number; tone: string; href?: string }) {
  const content = (
    <div className="bg-card border border-border rounded-lg p-4 h-full">
      <div className="flex items-center justify-between">
        <Icon className={`size-5 ${tone}`} aria-hidden="true" />
        <span className="text-2xl font-bold text-foreground tabular-nums">{value}</span>
      </div>
      <p className="mt-2 text-xs font-medium text-muted-foreground">{label}</p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
