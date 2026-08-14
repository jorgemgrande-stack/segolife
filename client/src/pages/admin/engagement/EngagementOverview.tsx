import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, LayoutDashboard, ShieldOff, Mail, Bell } from "lucide-react";

/**
 * Overview — /admin/engagement/overview (Communication Center, spec §13).
 * Primera pestaña real de estadísticas agregadas — las otras 5 pantallas
 * (Campañas/Notificaciones/Entregas/Plantillas/Audiencia) ya existían pero
 * ninguna daba una vista agregada de un vistazo. Reutiliza notifications/
 * notification_deliveries — sin tabla nueva, sin dato inventado.
 */

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground mt-1 tabular-nums">{value}</p>
    </div>
  );
}

function ProviderStatusRow() {
  const { data } = trpc.engagement.getProviderStatus.useQuery();
  if (!data) return null;
  const rows = [
    { groupLabel: "Brevo (email)", ...data.email },
    { groupLabel: "In-app", ...data.inApp },
    { groupLabel: "Push", ...data.push },
    { groupLabel: "WhatsApp", ...data.whatsapp },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map(r => (
        <Badge key={r.groupLabel} variant={r.configured ? "default" : "outline"}>{r.groupLabel}: {r.label}</Badge>
      ))}
    </div>
  );
}

function SuppressionsSection() {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const { data: suppressions, isLoading } = trpc.engagement.listSuppressions.useQuery();
  const removeMut = trpc.engagement.removeSuppression.useMutation({
    onSuccess: () => { utils.engagement.listSuppressions.invalidate(); toast.success("Supresión eliminada"); setEmail(""); },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <ShieldOff className="w-4 h-4 text-amber-500" />
        <p className="text-sm font-medium text-foreground">Supresiones técnicas</p>
        <p className="text-xs text-muted-foreground">— hard bounce / blocked / spam, distinto de opt-out de marketing</p>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : !suppressions || suppressions.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Sin direcciones suprimidas.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead><TableHead>Motivo</TableHead><TableHead>Origen</TableHead><TableHead>Fecha</TableHead><TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppressions.map(s => (
              <TableRow key={s.id}>
                <TableCell className="text-foreground">{s.email}</TableCell>
                <TableCell><Badge variant="destructive">{s.reason}</Badge></TableCell>
                <TableCell className="text-muted-foreground text-xs">{s.source}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{new Date(s.suppressedAt).toLocaleString("es-ES")}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => removeMut.mutate({ email: s.email })} disabled={removeMut.isPending}>
                    Quitar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="px-4 py-3 border-t border-border flex gap-2">
        <Input placeholder="email@ejemplo.com" value={email} onChange={e => setEmail(e.target.value)} className="max-w-xs" />
        <Button
          variant="outline" disabled={!email.trim() || removeMut.isPending}
          onClick={() => removeMut.mutate({ email: email.trim() })}
        >
          Quitar supresión manualmente
        </Button>
      </div>
    </div>
  );
}

export default function EngagementOverview() {
  const { data, isLoading } = trpc.engagement.getOverview.useQuery();

  return (
    <AdminLayout title="Communication Center — Overview">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Overview</h2>
            <p className="text-sm text-muted-foreground">Vista agregada de envíos, entregas y errores — últimos 30 días salvo indicado.</p>
          </div>
        </div>

        <ProviderStatusRow />

        {isLoading || !data ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard label="Enviados hoy" value={data.sentToday} />
              <StatCard label="Enviados 7d" value={data.sent7d} />
              <StatCard label="Enviados 30d" value={data.sent30d} />
              <StatCard label="Abiertos (30d)" value={data.openedCount} />
              <StatCard label="Clics (30d)" value={data.clickedCount} />
              <StatCard label="Fallidos (30d)" value={data.byStatus.find(s => s.status === "failed")?.count ?? 0} />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-lg p-4">
                <p className="text-sm font-medium text-foreground mb-3 flex items-center gap-1.5"><Bell className="w-4 h-4" /> Por estado (30d)</p>
                <div className="space-y-1.5">
                  {data.byStatus.map(s => (
                    <div key={s.status} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{s.status}</span>
                      <span className="tabular-nums text-foreground">{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-card border border-border rounded-lg p-4">
                <p className="text-sm font-medium text-foreground mb-3 flex items-center gap-1.5"><Mail className="w-4 h-4" /> Por canal (30d)</p>
                <div className="space-y-1.5">
                  {data.byChannel.map(c => (
                    <div key={c.channel} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{c.channel}</span>
                      <span className="tabular-nums text-foreground">{c.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-lg p-4">
                <p className="text-sm font-medium text-foreground mb-3">Top plantillas (30d)</p>
                {data.topTemplates.length === 0 ? <p className="text-sm text-muted-foreground">Sin datos.</p> : (
                  <div className="space-y-1.5">
                    {data.topTemplates.map(t => (
                      <div key={t.templateKey ?? "—"} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t.templateKey}</span>
                        <span className="tabular-nums text-foreground">{t.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-card border border-border rounded-lg p-4">
                <p className="text-sm font-medium text-foreground mb-3">Top campañas</p>
                {data.topCampaigns.length === 0 ? <p className="text-sm text-muted-foreground">Sin datos.</p> : (
                  <div className="space-y-1.5">
                    {data.topCampaigns.map(c => (
                      <div key={c.campaignId} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{c.campaignName}</span>
                        <span className="tabular-nums text-foreground">{c.notified}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <p className="text-sm font-medium text-foreground">Últimos errores</p>
              </div>
              {data.lastErrors.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Sin errores registrados.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Canal</TableHead><TableHead>Error</TableHead><TableHead>Fecha</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.lastErrors.map(e => (
                      <TableRow key={e.id}>
                        <TableCell>{e.channel}</TableCell>
                        <TableCell className="text-xs text-destructive max-w-md truncate">{e.lastError ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{new Date(e.createdAt).toLocaleString("es-ES")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <SuppressionsSection />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
