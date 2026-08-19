import { useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Loader2, ShieldQuestion, Check, X, Sparkles, Heart, Plus, Trash2 } from "lucide-react";
import { useAdminCommunity } from "@/contexts/AdminCommunityContext";
import { ADMIN_COMMUNITY_FILTER_ALL } from "@shared/segolife/adminCommunityFilter";
import { QUESTION_TYPE_LABEL, fmtDateTime, type ComunityQuestionType } from "@/lib/comunity";

const ALL = "__all__";
type IdeaStatus = "pending_moderation" | "approved" | "rejected" | "scheduled" | "active" | "closed" | "converted";

// MG-04 — preferencia/urgencia del Student (nunca prioridad admin interna, ver comentario de schema).
const URGENCY_LABEL: Record<"no_rush" | "soon" | "urgent", { label: string; className: string }> = {
  no_rush: { label: "Sin prisa", className: "bg-secondary text-muted-foreground" },
  soon: { label: "Pronto", className: "bg-accent/10 text-accent" },
  urgent: { label: "Urgente", className: "bg-destructive/10 text-destructive" },
};

const TYPES_WITH_OPTIONS: ComunityQuestionType[] = ["single_choice", "multiselect", "ranking", "percentage_scale"];

/**
 * Cola de moderación de ideas de estudiante — /admin/comunity/moderacion
 * (spec puntos 31-35). Nunca se publica una idea directamente: aprobar solo
 * cambia su estado; convertirla en propuesta formal es una acción aparte y
 * explícita (spec: "nunca se reescribe esta fila como si fuera ya una
 * encuesta").
 */
export default function ComunityModeration() {
  const { filter: communityFilter } = useAdminCommunity();
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<IdeaStatus>("pending_moderation");

  const { data, isLoading } = trpc.community.listStudentProposals.useQuery({
    communityId: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? "all" : communityFilter,
    status,
    limit: 200,
  });

  const approveMut = trpc.community.approveStudentProposal.useMutation({
    onSuccess: () => { toast.success("Idea aprobada"); utils.community.listStudentProposals.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [reasonInternal, setReasonInternal] = useState("");
  const [reasonStudent, setReasonStudent] = useState("");
  const rejectMut = trpc.community.rejectStudentProposal.useMutation({
    onSuccess: () => { toast.success("Idea rechazada"); setRejectTarget(null); setReasonInternal(""); setReasonStudent(""); utils.community.listStudentProposals.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const [convertTarget, setConvertTarget] = useState<number | null>(null);
  const [convertType, setConvertType] = useState<ComunityQuestionType>("yes_no");
  const [convertOptions, setConvertOptions] = useState<string[]>(["", ""]);
  const convertMut = trpc.community.convertStudentProposalToFormal.useMutation({
    onSuccess: res => { toast.success("Convertida en propuesta formal (borrador)"); setConvertTarget(null); utils.community.listStudentProposals.invalidate(); window.location.href = `/admin/comunity/${res.proposal.id}`; },
    onError: e => toast.error(e.message),
  });

  const items = data?.items ?? [];
  const needsOptions = TYPES_WITH_OPTIONS.includes(convertType);

  return (
    <AdminLayout title="Moderación COMUNITY">
      <div className="space-y-6">
        <Link href="/admin/comunity" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Volver a COMUNITY
        </Link>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldQuestion className="w-6 h-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Moderación de ideas de estudiante</h2>
              <p className="text-sm text-muted-foreground">Ninguna idea es visible públicamente hasta ser aprobada y lanzada.</p>
            </div>
          </div>
          <Select value={status} onValueChange={v => setStatus(v as IdeaStatus)}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending_moderation">Pendientes</SelectItem>
              <SelectItem value="approved">Aprobadas</SelectItem>
              <SelectItem value="rejected">Rechazadas</SelectItem>
              <SelectItem value="converted">Convertidas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Sin ideas en este estado.</div>
        ) : (
          <div className="space-y-3">
            {items.map(idea => (
              <div key={idea.id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  {idea.coverImageUrl && (
                    <img src={idea.coverImageUrl} alt="" className="size-16 shrink-0 rounded-md object-cover" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-foreground">{idea.title}</p>
                    {idea.description && <p className="mt-1 text-sm text-muted-foreground max-w-xl">{idea.description}</p>}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {idea.studentName ?? "Estudiante"} · {fmtDateTime(idea.createdAt)}
                      {idea.category && <> · {idea.category}</>}
                      {idea.venueName && <> · {idea.venueName}</>}
                      {idea.suggestedDate && <> · Fecha sugerida: {idea.suggestedDate}</>}
                    </p>
                    {idea.urgency && (
                      <Badge className={`mt-1.5 ${URGENCY_LABEL[idea.urgency].className}`} variant="secondary">
                        {URGENCY_LABEL[idea.urgency].label}
                      </Badge>
                    )}
                  </div>
                  <Badge variant="secondary" className="flex items-center gap-1 shrink-0"><Heart className="size-3" /> {idea.supportCount}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {status === "pending_moderation" && (
                    <>
                      <Button size="sm" onClick={() => approveMut.mutate({ id: idea.id })} disabled={approveMut.isPending}>
                        <Check className="size-3.5 mr-1" /> Aprobar
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => setRejectTarget(idea.id)}>
                        <X className="size-3.5 mr-1" /> Rechazar
                      </Button>
                    </>
                  )}
                  {status === "approved" && (
                    <Button size="sm" onClick={() => { setConvertTarget(idea.id); setConvertType("yes_no"); setConvertOptions(["", ""]); }}>
                      <Sparkles className="size-3.5 mr-1" /> Convertir en propuesta formal
                    </Button>
                  )}
                  {idea.status === "rejected" && idea.rejectionReasonInternal && (
                    <p className="text-xs text-muted-foreground">Motivo interno: {idea.rejectionReasonInternal}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rechazar */}
      <Dialog open={rejectTarget !== null} onOpenChange={o => !o && setRejectTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Rechazar idea</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Motivo interno *</Label><Textarea rows={2} value={reasonInternal} onChange={e => setReasonInternal(e.target.value)} placeholder="Nunca visible para el estudiante" /></div>
            <div><Label>Motivo visible para el estudiante (opcional)</Label><Textarea rows={2} value={reasonStudent} onChange={e => setReasonStudent(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancelar</Button>
            <Button
              className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
              disabled={!reasonInternal.trim() || rejectMut.isPending}
              onClick={() => rejectTarget != null && rejectMut.mutate({ id: rejectTarget, reasonInternal, reasonStudent: reasonStudent || undefined })}
            >
              Rechazar idea
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convertir en propuesta formal */}
      <Dialog open={convertTarget !== null} onOpenChange={o => !o && setConvertTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Convertir en propuesta formal</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Tipo de pregunta</Label>
              <Select value={convertType} onValueChange={v => setConvertType(v as ComunityQuestionType)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(QUESTION_TYPE_LABEL) as [ComunityQuestionType, string][]).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {needsOptions && (
              <div>
                <Label className="mb-2 block">Opciones</Label>
                <div className="space-y-2">
                  {convertOptions.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input value={opt} onChange={e => setConvertOptions(o => o.map((x, j) => j === i ? e.target.value : x))} placeholder={`Opción ${i + 1}`} />
                      {convertOptions.length > 2 && (
                        <button onClick={() => setConvertOptions(o => o.filter((_, j) => j !== i))} className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
                      )}
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setConvertOptions(o => [...o, ""])}><Plus className="size-3.5 mr-1" /> Añadir opción</Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Se crea en borrador — audiencia, timing y gamificación se completan luego en su ficha.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertTarget(null)}>Cancelar</Button>
            <Button
              disabled={convertMut.isPending || (needsOptions && convertOptions.filter(o => o.trim()).length < 2)}
              onClick={() => convertTarget != null && convertMut.mutate({ studentProposalId: convertTarget, questionType: convertType, options: needsOptions ? convertOptions.map(o => o.trim()).filter(Boolean) : undefined })}
            >
              Convertir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
