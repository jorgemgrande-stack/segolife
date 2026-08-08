import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Bell } from "lucide-react";

/**
 * Notificaciones creadas — /admin/engagement/notifications (Fase 7, spec
 * punto 33). Vista de solo lectura del contenido canónico ya entregado a
 * cada usuario (in-app) — nunca una segunda vía para enviar nada nuevo, eso
 * vive únicamente en Campañas.
 */
export default function NotificationsLog() {
  const { data: notifications, isLoading } = trpc.engagement.listNotifications.useQuery();

  return (
    <AdminLayout title="Notificaciones">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Bell className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Notificaciones</h2>
            <p className="text-sm text-muted-foreground">Contenido canónico ya creado (solo lectura) — las 100 más recientes.</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : !notifications || notifications.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Sin notificaciones todavía.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Audiencia</TableHead>
                  <TableHead>Título (EN)</TableHead>
                  <TableHead>Leída</TableHead>
                  <TableHead>Creada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notifications.map(n => (
                  <TableRow key={n.id}>
                    <TableCell className="text-muted-foreground">#{n.userId}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{n.type}</TableCell>
                    <TableCell><Badge variant="outline">{n.category}</Badge></TableCell>
                    <TableCell><Badge variant={n.audienceType === "transactional" ? "default" : "secondary"}>{n.audienceType}</Badge></TableCell>
                    <TableCell className="max-w-xs truncate">{n.titleEn}</TableCell>
                    <TableCell className="text-muted-foreground">{n.readAt ? "Sí" : "No"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(n.createdAt).toLocaleString("es-ES")}</TableCell>
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
