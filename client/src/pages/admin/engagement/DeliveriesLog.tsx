import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Send, RotateCcw, XCircle } from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "secondary", sent: "default", delivered: "default", failed: "destructive", skipped: "outline", cancelled: "outline",
};

/**
 * Log de entregas — /admin/engagement/deliveries (Fase 7, spec puntos
 * 51-52). Un canal por notificación (in_app/email/push/whatsapp), nunca
 * expone secretos de provider ni payloads — solo estado/error saneado.
 */
export default function DeliveriesLog() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<string>("");
  const [channel, setChannel] = useState<string>("");

  const { data: deliveries, isLoading } = trpc.engagement.listDeliveries.useQuery({
    status: status ? (status as any) : undefined,
    channel: channel ? (channel as any) : undefined,
  });

  const retryMut = trpc.engagement.retryDelivery.useMutation({
    onSuccess: () => { utils.engagement.listDeliveries.invalidate(); toast.success("Marcada para reintento"); },
    onError: e => toast.error(e.message),
  });
  const cancelMut = trpc.engagement.cancelDelivery.useMutation({
    onSuccess: () => { utils.engagement.listDeliveries.invalidate(); toast.success("Entrega cancelada"); },
    onError: e => toast.error(e.message),
  });

  return (
    <AdminLayout title="Entregas de Engagement">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Send className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Entregas</h2>
            <p className="text-sm text-muted-foreground">Intentos por canal — un reintento nunca es infinito (máx. 3 intentos).</p>
          </div>
        </div>

        <div className="flex gap-3">
          <Select value={status || "all"} onValueChange={v => setStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="pending">Pendiente</SelectItem>
              <SelectItem value="sent">Enviada</SelectItem>
              <SelectItem value="delivered">Entregada</SelectItem>
              <SelectItem value="failed">Fallida</SelectItem>
              <SelectItem value="skipped">Omitida</SelectItem>
              <SelectItem value="cancelled">Cancelada</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channel || "all"} onValueChange={v => setChannel(v === "all" ? "" : v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Canal" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los canales</SelectItem>
              <SelectItem value="in_app">In-app</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="push">Push</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : !deliveries || deliveries.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Sin entregas todavía.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID notif.</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Intentos</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Creada</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map(d => (
                  <TableRow key={d.id}>
                    <TableCell className="text-muted-foreground">#{d.notificationId}</TableCell>
                    <TableCell>{d.channel}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[d.status] ?? "outline"}>{d.status}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{d.attemptCount}/{d.maxAttempts}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-destructive">{d.lastError ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(d.createdAt).toLocaleString("es-ES")}</TableCell>
                    <TableCell className="flex justify-end gap-2">
                      {d.status === "failed" && (
                        <Button size="sm" variant="outline" onClick={() => retryMut.mutate({ id: d.id })}>
                          <RotateCcw className="size-3.5 mr-1" /> Reintentar
                        </Button>
                      )}
                      {(d.status === "pending" || d.status === "failed") && (
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => cancelMut.mutate({ id: d.id })}>
                          <XCircle className="size-3.5 mr-1" /> Cancelar
                        </Button>
                      )}
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
