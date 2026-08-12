import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Vote, Users, MessageSquare, Gauge, Send, XCircle, Ban,
  CalendarPlus, Bell, Eye, EyeOff, Star, ExternalLink, Pencil,
} from "lucide-react";
import { QUESTION_TYPE_LABEL, STATUS_LABEL, STATUS_VARIANT, fmtDateTime, timeLeftLabel, ATTENDANCE_INTENTION_LABEL, type ComunityQuestionType, type ComunityStatus } from "@/lib/comunity";
import { ComunityEditDialog } from "@/components/admin/comunity/ComunityEditDialog";
import type { ProposalResults } from "../../../../../server/segolife/community/communityResultsService";

/**
 * Ficha de detalle de una propuesta COMUNITY — /admin/comunity/:id (spec
 * punto 82: "una de las pantallas más visuales"). Cabecera + resultados
 * agregados (ya calculados server-side, spec punto 63) + respondientes +
 * acciones sensibles con confirmación.
 */
export default function ComunityDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const proposalId = Number(id);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.community.getById.useQuery({ id: proposalId });
  const { data: results } = trpc.community.getResults.useQuery({ id: proposalId });
  const { data: score } = trpc.community.getScore.useQuery({ id: proposalId });
  const { data: venue } = trpc.venues.getById.useQuery({ id: data?.proposal.venueId ?? 0 }, { enabled: !!data?.proposal.venueId });

  const [respondentsOptionId, setRespondentsOptionId] = useState<number | undefined>(undefined);
  const [showRespondents, setShowRespondents] = useState(false);
  const { data: respondents, isFetching: respondentsLoading } = trpc.community.getRespondents.useQuery(
    { id: proposalId, optionId: respondentsOptionId },
    { enabled: showRespondents }
  );

  const [editOpen, setEditOpen] = useState(false);

  const [convertOpen, setConvertOpen] = useState(false);
  const [convertStartsAt, setConvertStartsAt] = useState("");
  const [convertCapacity, setConvertCapacity] = useState("");

  const invalidate = () => { utils.community.getById.invalidate({ id: proposalId }); utils.community.list.invalidate(); };

  const publishMut = trpc.community.publish.useMutation({ onSuccess: () => { toast.success("Propuesta publicada"); invalidate(); }, onError: e => toast.error(e.message) });
  const closeMut = trpc.community.closeNow.useMutation({ onSuccess: () => { toast.success("Propuesta cerrada"); invalidate(); }, onError: e => toast.error(e.message) });
  const cancelMut = trpc.community.cancel.useMutation({ onSuccess: () => { toast.success("Propuesta cancelada"); invalidate(); }, onError: e => toast.error(e.message) });
  const convertMut = trpc.community.convertToEvent.useMutation({
    onSuccess: res => { toast.success("Evento borrador creado"); setConvertOpen(false); invalidate(); navigate(`/admin/events/${res.event.id}`); },
    onError: e => toast.error(e.message),
  });
  const notifyMut = trpc.community.notifyInterested.useMutation({ onSuccess: res => toast.success(`Notificados ${res.notified ?? 0} estudiante(s) interesados`), onError: e => toast.error(e.message) });
  const visibilityMut = trpc.community.setResponseValueVisibility.useMutation({
    onSuccess: () => utils.community.getResults.invalidate({ id: proposalId }),
    onError: e => toast.error(e.message),
  });

  if (isLoading || !data) {
    return <AdminLayout title="COMUNITY"><div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div></AdminLayout>;
  }

  const { proposal, options } = data;
  const status = proposal.status as ComunityStatus;
  const qType = proposal.questionType as ComunityQuestionType;

  return (
    <AdminLayout title={proposal.title}>
      <div className="space-y-6">
        <Link href="/admin/comunity" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Volver a COMUNITY
        </Link>

        {/* ── Cabecera ── */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Vote className="size-5 text-primary" />
                <h1 className="text-xl font-semibold text-foreground">{proposal.title}</h1>
                <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
                {proposal.urgencyType === "flash" && <Badge variant="secondary">⚡ Flash</Badge>}
              </div>
              {proposal.description && <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{proposal.description}</p>}
            </div>
            {status === "active" && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Cierra en</p>
                <p className="text-lg font-bold text-foreground tabular-nums">{timeLeftLabel(proposal.endsAt)}</p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span>Tipo: <span className="text-foreground">{QUESTION_TYPE_LABEL[qType]}</span></span>
            {venue && <span>Venue: <span className="text-foreground">{venue.venue.name}</span></span>}
            <span>Ventana: <span className="text-foreground">{fmtDateTime(proposal.startsAt)} → {fmtDateTime(proposal.endsAt)}</span></span>
            {proposal.sourceStudentProposalId && <span className="text-foreground">Idea de estudiante</span>}
            {proposal.convertedEventId && (
              <Link href={`/admin/events/${proposal.convertedEventId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                <ExternalLink className="size-3.5" /> Evento convertido
              </Link>
            )}
          </div>
        </div>

        {/* ── KPIs ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi icon={Users} label="Audiencia" value={results?.totalAudience ?? "—"} />
          <Kpi icon={MessageSquare} label="Respuestas" value={results?.totalResponses ?? "—"} />
          <Kpi icon={Gauge} label="Participación" value={results ? `${results.participationRate}%` : "—"} />
          <Kpi icon={Star} label="COMUNITY Score" value={score?.insufficientData ? "Datos insuficientes" : (score?.score ?? "—")} />
        </div>

        {score && !score.insufficientData && score.dimensions.length > 0 && (
          <div className="bg-card border border-border rounded-lg p-4 space-y-2">
            <p className="text-sm font-semibold text-foreground">Desglose del score</p>
            {score.dimensions.map(d => (
              <div key={d.key} className="flex items-center gap-3">
                <span className="w-40 text-xs text-muted-foreground shrink-0">{d.label} ({Math.round(d.weight * 100)}%)</span>
                <Progress value={d.normalizedScore} className="h-2" />
                <span className="w-10 text-right text-xs text-foreground tabular-nums">{d.normalizedScore}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Resultados ── */}
        <div className="bg-card border border-border rounded-lg p-5">
          <p className="text-sm font-semibold text-foreground mb-3">Resultados</p>
          {!results || results.totalResponses === 0 ? (
            <p className="text-sm text-muted-foreground">Sin respuestas todavía.</p>
          ) : (
            <ResultsView results={results} qType={qType} onSelectOption={id => { setRespondentsOptionId(id); setShowRespondents(true); }} onModerate={(responseValueId, field, val) => visibilityMut.mutate({ responseValueId, [field]: val })} />
          )}
        </div>

        {/* ── Respondientes ── */}
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-foreground">Respondientes</p>
            <Button variant="outline" size="sm" onClick={() => { setRespondentsOptionId(undefined); setShowRespondents(true); }}>Ver todos</Button>
          </div>
          {!showRespondents ? (
            <p className="text-sm text-muted-foreground">Pulsa "Ver todos" o un resultado arriba para ver quién ha respondido.</p>
          ) : respondentsLoading ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : !respondents || respondents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin respondientes en este filtro.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Estudiante</TableHead><TableHead>Respondió</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {respondents.map(r => (
                  <TableRow key={r.studentProfileId}>
                    <TableCell className="text-foreground">{r.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{fmtDateTime(r.respondedAt)}</TableCell>
                    <TableCell>
                      <Link href={`/admin/students/${r.studentProfileId}`} className="text-primary text-sm hover:underline">Ver ficha 360 →</Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* ── Acciones ── */}
        <div className="bg-card border border-border rounded-lg p-4 flex flex-wrap gap-2">
          {status !== "cancelled" && status !== "converted" && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4 mr-1.5" /> Editar
            </Button>
          )}
          {(status === "draft" || status === "scheduled") && (
            <Button onClick={() => { if (confirm(`¿Publicar "${proposal.title}" a su audiencia?`)) publishMut.mutate({ id: proposalId }); }} disabled={publishMut.isPending}>
              <Send className="size-4 mr-1.5" /> Publicar
            </Button>
          )}
          {status === "active" && (
            <Button variant="outline" onClick={() => { if (confirm("¿Cerrar esta propuesta ahora?")) closeMut.mutate({ id: proposalId }); }} disabled={closeMut.isPending}>
              <XCircle className="size-4 mr-1.5" /> Cerrar ahora
            </Button>
          )}
          {(status === "draft" || status === "scheduled" || status === "active") && (
            <Button variant="outline" className="text-destructive" onClick={() => { if (confirm("¿Cancelar esta propuesta? No se puede deshacer.")) cancelMut.mutate({ id: proposalId }); }} disabled={cancelMut.isPending}>
              <Ban className="size-4 mr-1.5" /> Cancelar
            </Button>
          )}
          {!proposal.convertedEventId && (
            <Button variant="outline" onClick={() => setConvertOpen(true)}>
              <CalendarPlus className="size-4 mr-1.5" /> Convertir en Evento
            </Button>
          )}
          {proposal.convertedEventId && (
            <Button variant="outline" onClick={() => notifyMut.mutate({ id: proposalId })} disabled={notifyMut.isPending}>
              <Bell className="size-4 mr-1.5" /> Notificar interesados
            </Button>
          )}
        </div>
      </div>

      <ComunityEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        proposal={proposal}
        options={options}
        communityIds={data.communityIds}
        responseCount={results?.totalResponses ?? 0}
        onSaved={invalidate}
      />

      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Convertir en Evento (borrador)</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">Se crea como evento inactivo (borrador) — nunca se publica automáticamente.</p>
            <div><Label>Fecha de inicio {proposal.startsAt ? "(vacío = usa la de la propuesta)" : "*"}</Label><Input type="datetime-local" value={convertStartsAt} onChange={e => setConvertStartsAt(e.target.value)} /></div>
            <div><Label>Aforo (opcional)</Label><Input type="number" min={1} value={convertCapacity} onChange={e => setConvertCapacity(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>Cancelar</Button>
            <Button
              disabled={convertMut.isPending}
              onClick={() => convertMut.mutate({ id: proposalId, startsAt: convertStartsAt ? new Date(convertStartsAt) : undefined, capacity: convertCapacity ? Number(convertCapacity) : undefined })}
            >
              Crear evento borrador
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground"><Icon className="size-3.5" /><span className="text-[10px] uppercase tracking-widest">{label}</span></div>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function ResultsView({ results, qType, onSelectOption, onModerate }: {
  results: ProposalResults;
  qType: ComunityQuestionType;
  onSelectOption: (optionId: number) => void;
  onModerate: (responseValueId: number, field: "isHidden" | "isFeatured", value: boolean) => void;
}) {
  if ((qType === "single_choice" || qType === "multiselect") && (results.singleChoice || results.multiselect)) {
    const items = results.singleChoice ?? results.multiselect ?? [];
    return (
      <div className="space-y-2">
        {items.map(o => (
          <button key={o.optionId} onClick={() => onSelectOption(o.optionId)} className="w-full text-left group">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-foreground group-hover:underline">{o.label}</span>
              <span className="text-muted-foreground">{o.count} · {o.percentage}%</span>
            </div>
            <Progress value={o.percentage} className="h-2" />
          </button>
        ))}
      </div>
    );
  }

  if (results.yesNo) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm mb-1"><span>👍 Sí</span><span>{results.yesNo.yes} · {results.yesNo.yesPercentage}%</span></div>
        <Progress value={results.yesNo.yesPercentage} className="h-2" />
        <div className="flex items-center justify-between text-sm mb-1 mt-3"><span>👎 No</span><span>{results.yesNo.no} · {100 - results.yesNo.yesPercentage}%</span></div>
        <Progress value={100 - results.yesNo.yesPercentage} className="h-2" />
      </div>
    );
  }

  if (results.percentageScale) {
    return (
      <div className="space-y-3">
        {results.percentageScale.map(o => (
          <div key={o.optionId}>
            <div className="flex items-center justify-between text-sm mb-1"><span className="text-foreground">{o.label}</span><span className="text-muted-foreground">{o.average}/100 ({o.count})</span></div>
            <Progress value={o.average} className="h-2" />
          </div>
        ))}
      </div>
    );
  }

  if (results.scale15) {
    const max = Math.max(1, ...Object.values(results.scale15.distribution));
    return (
      <div>
        <p className="text-sm text-foreground mb-2">Media: <span className="font-semibold">{results.scale15.average}</span> / 5</p>
        <div className="space-y-1.5">
          {[1, 2, 3, 4, 5].map(v => (
            <div key={v} className="flex items-center gap-2 text-sm">
              <span className="w-4 text-muted-foreground">{v}</span>
              <Progress value={(results.scale15!.distribution[v] / max) * 100} className="h-2 flex-1" />
              <span className="w-6 text-right text-muted-foreground">{results.scale15!.distribution[v]}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (results.ranking) {
    return (
      <Table>
        <TableHeader><TableRow><TableHead>Opción</TableHead><TableHead>Posición media</TableHead><TableHead>Veces #1</TableHead></TableRow></TableHeader>
        <TableBody>
          {results.ranking.map(o => (
            <TableRow key={o.optionId}><TableCell className="text-foreground">{o.label}</TableCell><TableCell>{o.averageRank}</TableCell><TableCell>{o.topChoiceCount}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  if (results.attendanceIntention) {
    const b = results.attendanceIntention.breakdown;
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          {(["definitely", "probably", "maybe", "no"] as const).map(k => (
            <div key={k}>
              <div className="flex items-center justify-between text-sm mb-1"><span>{ATTENDANCE_INTENTION_LABEL[k]}</span><span className="text-muted-foreground">{b[k] ?? 0}</span></div>
              <Progress value={results.totalResponses > 0 ? ((b[k] ?? 0) / results.totalResponses) * 100 : 0} className="h-2" />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Interés predicho: <span className="font-medium text-foreground">{results.attendanceIntention.predictedInterested}</span> · Intención fuerte: <span className="font-medium text-foreground">{results.attendanceIntention.predictedStrongIntent}</span>
        </p>
      </div>
    );
  }

  if (results.meApunto) {
    return <p className="text-2xl font-bold text-foreground">{results.meApunto.count} <span className="text-sm font-normal text-muted-foreground">se apuntan</span></p>;
  }

  if (results.openText) {
    return (
      <div className="space-y-2">
        {results.openText.map(t => (
          <div key={t.id} className={`flex items-start justify-between gap-3 rounded-md border border-border p-3 ${t.isHidden ? "opacity-50" : ""}`}>
            <p className="text-sm text-foreground flex-1">{t.text}</p>
            <div className="flex gap-1 shrink-0">
              <button title={t.isFeatured ? "Quitar destacado" : "Destacar"} onClick={() => onModerate(t.id, "isFeatured", !t.isFeatured)} className="p-1 rounded hover:bg-accent">
                <Star className={`size-4 ${t.isFeatured ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
              </button>
              <button title={t.isHidden ? "Mostrar" : "Ocultar"} onClick={() => onModerate(t.id, "isHidden", !t.isHidden)} className="p-1 rounded hover:bg-accent">
                {t.isHidden ? <EyeOff className="size-4 text-muted-foreground" /> : <Eye className="size-4 text-muted-foreground" />}
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
}
