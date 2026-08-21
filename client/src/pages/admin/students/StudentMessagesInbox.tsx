import { useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, MessageCircle, Loader2 } from "lucide-react";

const ALL = "__all__";
const PAGE_SIZE = 50;

function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function waitingForLabel(waitingFor: string) {
  if (waitingFor === "student") return <Badge variant="outline" className="text-muted-foreground">Estudiante</Badge>;
  if (waitingFor === "admin") return <Badge className="bg-red-500 text-white">Admin</Badge>;
  return <Badge variant="secondary">—</Badge>;
}

/**
 * COM-01 — /admin/students/messages. Bandeja de conversaciones Admin↔Student
 * (nunca campañas/broadcast — eso sigue en Communication Center). Cualquier
 * admin con student_messages.view puede leer; solo student_messages.manage
 * puede responder/cerrar/reabrir (ver la propia ficha de conversación).
 */
export default function StudentMessagesInbox() {
  const [status, setStatus] = useState<string>(ALL);
  const [waitingFor, setWaitingFor] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const { data, isLoading } = trpc.studentMessages.adminList.useQuery({
    status: status === ALL ? undefined : (status as "open" | "closed"),
    waitingFor: waitingFor === ALL ? undefined : (waitingFor as "student" | "admin" | "none"),
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
          <MessageCircle className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">Mensajes</h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar por estudiante o asunto…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
          <Select value={status} onValueChange={v => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los estados</SelectItem>
              <SelectItem value="open">Abiertas</SelectItem>
              <SelectItem value="closed">Cerradas</SelectItem>
            </SelectContent>
          </Select>
          <Select value={waitingFor} onValueChange={v => { setWaitingFor(v); setPage(0); }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Esperando respuesta de" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Cualquiera</SelectItem>
              <SelectItem value="admin">Esperando a Admin</SelectItem>
              <SelectItem value="student">Esperando al Student</SelectItem>
              <SelectItem value="none">Ninguno (cerrada)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">No hay conversaciones pendientes.</div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estudiante</TableHead>
                  <TableHead>Asunto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Esperando a</TableHead>
                  <TableHead>Última actividad</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(c => (
                  <TableRow key={c.id} className={c.unread ? "font-medium" : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {c.unread && <span className="size-1.5 rounded-full bg-accent shrink-0" aria-hidden="true" />}
                        <span className="truncate">{c.studentName ?? c.studentEmail ?? `#${c.studentUserId}`}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate">
                      <Link href={`/admin/students/messages/${c.id}`} className="hover:underline">{c.subject}</Link>
                      {c.lastMessagePreview && <p className="text-xs text-muted-foreground truncate font-normal">{c.lastMessagePreview}</p>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.status === "open" ? "default" : "secondary"}>{c.status === "open" ? "Abierta" : "Cerrada"}</Badge>
                    </TableCell>
                    <TableCell>{waitingForLabel(c.waitingFor)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-normal">{fmtDateTime(c.lastMessageAt)}</TableCell>
                    <TableCell>
                      <Link href={`/admin/students/messages/${c.id}`} className="text-xs font-medium text-primary hover:underline">Abrir</Link>
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
