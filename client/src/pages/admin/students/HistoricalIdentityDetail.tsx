import { useState } from "react";
import { useParams, Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft, CalendarDays, Ticket, CheckCircle2, Euro, Link2, Unlink, UserPlus, ExternalLink, Pencil, EyeOff, Trash2, MessageCircle } from "lucide-react";
import { EditStudentDialog, HideStudentDialog, DeleteStudentDialog, ComunicarDialog, useCommunicateAction } from "./StudentLifecycleDialogs";
import { ClaimDialog, UnclaimDialog, ConvertToStudentDialog } from "./HistoricalIdentityDialogs";

const STATUS_LABEL: Record<string, string> = {
  UNREGISTERED: "No registrado en Segolife",
  POSSIBLE_MATCH: "Posible coincidencia",
  AUTO_MATCH_CANDIDATE: "Coincidencia exacta (email + teléfono)",
  LINKED: "Vinculado a un estudiante",
  CONFLICT: "Conflicto de identidad",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  UNREGISTERED: "outline", POSSIBLE_MATCH: "secondary", AUTO_MATCH_CANDIDATE: "default", LINKED: "default", CONFLICT: "destructive",
};

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtSpend(cents: number) {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "");
}

/**
 * Cuando la identidad ya está LINKED, "los mismos modales que ya pusimos a
 * estudiantes reales" (Editar/Ocultar/Borrar/Comunicarse —
 * StudentLifecycleDialogs.tsx, STU-01/STU-02) — MISMOS componentes, nunca
 * una segunda implementación — disponibles directamente aquí, resolviendo
 * el studentProfileId real a partir del linkedUserId (esta página solo
 * conoce el userId de la identidad histórica).
 */
function LinkedStudentActions({ userId }: { userId: number }) {
  const { data } = trpc.historicalIdentities.resolveLinkedStudent.useQuery({ userId });
  const studentProfileId = data?.studentProfileId ?? null;
  const [editOpen, setEditOpen] = useState(false);
  const [hideOpen, setHideOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { communicate, checking, dialogOpen, setDialogOpen } = useCommunicateAction(userId);

  if (!studentProfileId) return null;

  return (
    <>
      <Link href={`/admin/students/${studentProfileId}`}>
        <Button variant="outline" size="sm"><ExternalLink className="w-4 h-4 mr-1" />Ver ficha completa</Button>
      </Link>
      <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}><Pencil className="w-4 h-4 mr-1" />Editar</Button>
      <Button variant="outline" size="sm" onClick={() => setHideOpen(true)}><EyeOff className="w-4 h-4 mr-1" />Ocultar/Mostrar</Button>
      <Button variant="outline" size="sm" onClick={communicate} disabled={checking}>
        {checking ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <MessageCircle className="w-4 h-4 mr-1" />}
        Comunicarse
      </Button>
      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 className="w-4 h-4 mr-1" />Borrar</Button>

      <EditStudentDialog studentProfileId={editOpen ? studentProfileId : null} onClose={() => setEditOpen(false)} />
      <HideStudentDialog studentProfileId={hideOpen ? studentProfileId : null} onClose={() => setHideOpen(false)} />
      <DeleteStudentDialog studentProfileId={deleteOpen ? studentProfileId : null} onClose={() => setDeleteOpen(false)} />
      <ComunicarDialog studentUserId={userId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

export default function HistoricalIdentityDetail() {
  const params = useParams<{ identityKey: string }>();
  const identityKey = decodeURIComponent(params.identityKey ?? "");
  const [claimOpen, setClaimOpen] = useState(false);
  const [unclaimOpen, setUnclaimOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const { data, isLoading, error } = trpc.historicalIdentities.detail.useQuery({ identityKey }, { enabled: !!identityKey });

  if (isLoading) {
    return <AdminLayout title="Identidad histórica"><div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div></AdminLayout>;
  }
  if (error || !data) {
    return <AdminLayout title="Identidad histórica"><div className="py-20 text-center text-sm text-destructive">{error?.message ?? "No encontrada"}</div></AdminLayout>;
  }

  return (
    <AdminLayout title="Identidad histórica">
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link href="/admin/students/historical"><Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button></Link>
            <Avatar className="w-11 h-11"><AvatarFallback>{initials(data.name)}</AvatarFallback></Avatar>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{data.name ?? "(sin nombre)"}</h2>
              <p className="text-sm text-muted-foreground">
                {data.email ?? "—"}{data.email && data.phone ? " · " : ""}{data.phone ?? ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={STATUS_VARIANT[data.status]}>{STATUS_LABEL[data.status]}</Badge>
            {data.status === "LINKED" && data.linkedUserId != null ? (
              <>
                <LinkedStudentActions userId={data.linkedUserId} />
                <Button variant="outline" size="sm" onClick={() => setUnclaimOpen(true)}><Unlink className="w-4 h-4 mr-1" />Retirar vínculo</Button>
              </>
            ) : data.status !== "CONFLICT" ? (
              <>
                <Button size="sm" onClick={() => setClaimOpen(true)}><Link2 className="w-4 h-4 mr-1" />Vincular a estudiante</Button>
                {data.status === "UNREGISTERED" && (
                  <Button variant="outline" size="sm" onClick={() => setConvertOpen(true)}><UserPlus className="w-4 h-4 mr-1" />Convertir en estudiante real</Button>
                )}
              </>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-6"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><CalendarDays className="w-3.5 h-3.5" />Eventos</div><div className="text-2xl font-semibold">{data.eventsCount}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Ticket className="w-3.5 h-3.5" />Tickets</div><div className="text-2xl font-semibold">{data.ticketsCount}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><CheckCircle2 className="w-3.5 h-3.5" />Asistencias</div><div className="text-2xl font-semibold">{data.attendanceCount}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Euro className="w-3.5 h-3.5" />Gasto histórico</div><div className="text-2xl font-semibold">{fmtSpend(data.historicalSpendCents)}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Venues
              {data.crossVenue && (
                <Badge variant="outline">Actividad en {data.venueBreakdown.length} venues — cross-venue</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {data.venueBreakdown.map(v => (
                <div key={v.venueId} className="border border-border rounded-md p-3">
                  <div className="font-medium">{v.venueName}</div>
                  <div className="text-xs text-muted-foreground mt-1">{v.eventsCount} eventos · {v.ticketsCount} tickets · {v.attendanceCount} asistencias</div>
                  <div className="text-xs text-muted-foreground">{fmtSpend(v.spendCents)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Actividad ({data.firstActivity ? fmtDateTime(data.firstActivity) : "—"} → {fmtDateTime(data.lastActivity)})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {data.timeline.map(t => (
                <div key={t.operationId} className="flex items-center justify-between text-sm border-b border-border/50 pb-2">
                  <div>
                    <span className="font-medium">{t.operationType === "order" ? "Compra" : "Asistencia"}</span>
                    {t.eventName && <span className="text-muted-foreground"> · {t.eventName}</span>}
                  </div>
                  <div className="text-muted-foreground">{fmtDateTime(t.occurredAt)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <ClaimDialog identityKey={identityKey} open={claimOpen} onOpenChange={setClaimOpen} />
        <UnclaimDialog identityKey={identityKey} open={unclaimOpen} onOpenChange={setUnclaimOpen} />
        <ConvertToStudentDialog identityKey={identityKey} hasEmail={!!data.email} open={convertOpen} onOpenChange={setConvertOpen} />
      </div>
    </AdminLayout>
  );
}
