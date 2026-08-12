import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import {
  ComunityAudienceBuilder, EMPTY_COMUNITY_AUDIENCE, toComunityAudienceDefinition, fromComunityAudienceDefinition,
  type ComunityAudienceForm,
} from "./ComunityAudienceBuilder";
import { QUESTION_TYPE_LABEL, type ComunityQuestionType } from "@/lib/comunity";
import type { CommunityProposal, CommunityOption } from "../../../../../drizzle/schema";

const TYPES_WITH_OPTIONS: ComunityQuestionType[] = ["single_choice", "multiselect", "ranking", "percentage_scale"];

function toLocalInputValue(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface ComunityEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposal: CommunityProposal;
  options: CommunityOption[];
  communityIds: number[];
  responseCount: number;
  onSaved: () => void;
}

/**
 * Edición de una propuesta COMUNITY ya existente — a diferencia del wizard
 * (solo crea, siempre en borrador), este diálogo permite corregir una
 * propuesta en cualquier estado no terminal (spec: "editable incluso una
 * vez publicada"). El backend (community.update) ya bloquea cancelled/
 * converted y protege las opciones si ya hay respuestas — aquí replicamos
 * esa misma condición para no ni mostrar controles que el server rechazaría.
 */
export function ComunityEditDialog({ open, onOpenChange, proposal, options, communityIds, responseCount, onSaved }: ComunityEditDialogProps) {
  const { data: communities } = trpc.communities.list.useQuery();
  const { data: venues } = trpc.venues.publicActive.useQuery({});

  const [title, setTitle] = useState(proposal.title);
  const [description, setDescription] = useState(proposal.description ?? "");
  const [venueId, setVenueId] = useState<string>(proposal.venueId ? String(proposal.venueId) : "");
  const [coverImageUrl, setCoverImageUrl] = useState(proposal.coverImageUrl ?? "");
  const [urgencyType, setUrgencyType] = useState<"flash" | "scheduled">(proposal.urgencyType);
  const [startsAt, setStartsAt] = useState(toLocalInputValue(proposal.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInputValue(proposal.endsAt));
  const [resultsVisibility, setResultsVisibility] = useState(proposal.resultsVisibility);
  const [allowChangeResponse, setAllowChangeResponse] = useState(proposal.allowChangeResponse);
  const [tokenReward, setTokenReward] = useState(proposal.tokenReward != null ? String(proposal.tokenReward) : "");
  const [minSampleSize, setMinSampleSize] = useState(String(proposal.minSampleSize));
  const [optionLabels, setOptionLabels] = useState<string[]>(options.map(o => o.label));
  const [scopeCommunityIds, setScopeCommunityIds] = useState<number[]>(communityIds);
  const [audience, setAudience] = useState<ComunityAudienceForm>(EMPTY_COMUNITY_AUDIENCE);
  const [audienceTouched, setAudienceTouched] = useState(false);

  // Reinicializa el form cada vez que se abre (por si se abrió antes con otra propuesta o los datos refrescaron).
  useEffect(() => {
    if (!open) return;
    setTitle(proposal.title);
    setDescription(proposal.description ?? "");
    setVenueId(proposal.venueId ? String(proposal.venueId) : "");
    setCoverImageUrl(proposal.coverImageUrl ?? "");
    setUrgencyType(proposal.urgencyType);
    setStartsAt(toLocalInputValue(proposal.startsAt));
    setEndsAt(toLocalInputValue(proposal.endsAt));
    setResultsVisibility(proposal.resultsVisibility);
    setAllowChangeResponse(proposal.allowChangeResponse);
    setTokenReward(proposal.tokenReward != null ? String(proposal.tokenReward) : "");
    setMinSampleSize(String(proposal.minSampleSize));
    setOptionLabels(options.map(o => o.label));
    setScopeCommunityIds(communityIds);
    setAudience(fromComunityAudienceDefinition(proposal.audienceDefinition));
    setAudienceTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, proposal.id]);

  const qType = proposal.questionType as ComunityQuestionType;
  const canEditOptions = TYPES_WITH_OPTIONS.includes(qType) && responseCount === 0;
  const cleanOptions = optionLabels.map(o => o.trim()).filter(Boolean);

  const utils = trpc.useUtils();
  const updateMut = trpc.community.update.useMutation({
    onSuccess: () => {
      toast.success("Propuesta actualizada");
      utils.community.getById.invalidate({ id: proposal.id });
      utils.community.list.invalidate();
      onSaved();
      onOpenChange(false);
    },
    onError: e => toast.error(e.message),
  });

  function handleSave() {
    const payload: Parameters<typeof updateMut.mutate>[0] = {
      id: proposal.id,
      title: title.trim(),
      description: description.trim() || null,
      urgencyType,
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
      resultsVisibility,
      allowChangeResponse,
      tokenReward: tokenReward ? Number(tokenReward) : null,
      coverImageUrl: coverImageUrl.trim() || null,
      venueId: venueId ? Number(venueId) : null,
      minSampleSize: Number(minSampleSize) || 5,
      communityIds: scopeCommunityIds,
    };
    // audienceDefinition/options solo se reenvían si el admin tocó ese control —
    // el builder de audiencia solo entiende un subconjunto curado de criterios,
    // así que reenviar sin tocar podría machacar una definición más avanzada.
    if (audienceTouched) payload.audienceDefinition = toComunityAudienceDefinition(audience);
    if (canEditOptions) payload.options = cleanOptions;
    updateMut.mutate(payload);
  }

  const canSave = title.trim().length > 0 && endsAt.trim().length > 0 && (!canEditOptions || cleanOptions.length >= 2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Editar propuesta</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div><Label>Pregunta / título *</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
          <div><Label>Descripción (opcional)</Label><Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} /></div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Venue relacionado</Label>
              <Select value={venueId || "none"} onValueChange={v => setVenueId(v === "none" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Sin venue" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin venue</SelectItem>
                  {(venues ?? []).map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo de pregunta</Label>
              <Input value={QUESTION_TYPE_LABEL[qType]} disabled className="bg-muted" />
              <p className="mt-1 text-xs text-muted-foreground">No editable — cambiar el tipo invalidaría los resultados ya calculados.</p>
            </div>
          </div>

          <div>
            <Label>Imagen de portada — URL (opcional)</Label>
            <Input value={coverImageUrl} onChange={e => setCoverImageUrl(e.target.value)} placeholder="https://…" />
          </div>

          {canEditOptions ? (
            <div>
              <Label className="mb-2 block">Opciones *</Label>
              <div className="space-y-2">
                {optionLabels.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={opt} onChange={e => setOptionLabels(o => o.map((x, j) => j === i ? e.target.value : x))} placeholder={`Opción ${i + 1}`} />
                    {optionLabels.length > 2 && (
                      <button type="button" onClick={() => setOptionLabels(o => o.filter((_, j) => j !== i))} className="p-1.5 text-muted-foreground hover:text-destructive">
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setOptionLabels(o => [...o, ""])}>
                <Plus className="size-3.5 mr-1" /> Añadir opción
              </Button>
              {cleanOptions.length < 2 && <p className="mt-2 text-xs text-destructive">Se necesitan al menos 2 opciones.</p>}
            </div>
          ) : TYPES_WITH_OPTIONS.includes(qType) ? (
            <div>
              <Label className="mb-2 block">Opciones</Label>
              <p className="text-sm text-foreground">{options.map(o => o.label).join(", ")}</p>
              <p className="mt-1 text-xs text-muted-foreground">No editables — ya hay {responseCount} respuesta(s) registrada(s) que dependen de estas opciones.</p>
            </div>
          ) : null}

          <div>
            <Label className="mb-2 block">Urgencia</Label>
            <div className="flex gap-2">
              <Button type="button" variant={urgencyType === "scheduled" ? "default" : "outline"} size="sm" onClick={() => setUrgencyType("scheduled")}>Programada</Button>
              <Button type="button" variant={urgencyType === "flash" ? "default" : "outline"} size="sm" onClick={() => setUrgencyType("flash")}>⚡ Flash</Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Inicio (opcional)</Label><Input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} /></div>
            <div><Label>Cierre *</Label><Input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} /></div>
          </div>

          <div>
            <Label>Visibilidad de resultados para el estudiante</Label>
            <Select value={resultsVisibility} onValueChange={v => setResultsVisibility(v as typeof resultsVisibility)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">Inmediata (siempre visibles)</SelectItem>
                <SelectItem value="after_vote">Tras votar</SelectItem>
                <SelectItem value="after_close">Tras el cierre</SelectItem>
                <SelectItem value="never">Nunca</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allowChangeResponse} onCheckedChange={c => setAllowChangeResponse(c === true)} />
            Permitir cambiar la respuesta mientras esté activa
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Recompensa en SegoTokens (opcional)</Label>
              <Input type="number" min={0} max={200} value={tokenReward} onChange={e => setTokenReward(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>Muestra mínima para comparativas por segmento</Label>
              <Input type="number" min={1} max={50} value={minSampleSize} onChange={e => setMinSampleSize(e.target.value)} />
            </div>
          </div>

          <div className="pt-2 border-t border-border">
            <Label className="mb-2 mt-3 block">Alcance administrativo (qué comunidad gestiona esta propuesta)</Label>
            <div className="flex flex-wrap gap-3">
              {(communities ?? []).map(c => (
                <label key={c.id} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={scopeCommunityIds.includes(c.id)}
                    onCheckedChange={() => setScopeCommunityIds(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-border">
            <Label className="mb-2 mt-3 block">Audiencia (quién puede responder)</Label>
            {proposal.status !== "draft" && proposal.status !== "scheduled" && (
              <p className="mb-2 text-xs text-muted-foreground">Esta propuesta ya publicó su audiencia (snapshot al publicar) — cambiarla aquí no afecta a quién ya puede responder ahora mismo.</p>
            )}
            <ComunityAudienceBuilder value={audience} onChange={v => { setAudience(v); setAudienceTouched(true); }} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!canSave || updateMut.isPending}>
            {updateMut.isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : null} Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
