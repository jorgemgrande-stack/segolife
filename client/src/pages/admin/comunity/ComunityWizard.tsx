import { useState } from "react";
import { useLocation } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, Plus, X, Vote } from "lucide-react";
import { ComunityAudienceBuilder, EMPTY_COMUNITY_AUDIENCE, toComunityAudienceDefinition, type ComunityAudienceForm } from "@/components/admin/comunity/ComunityAudienceBuilder";
import { QUESTION_TYPE_LABEL, QUESTION_TYPES_WITH_OPTIONS, type ComunityQuestionType } from "@/lib/comunity";

const STEPS = ["Pregunta", "Tipo de respuesta", "Audiencia", "Timing", "Gamificación", "Revisión", "Publicar"] as const;

const FLASH_PRESETS: { label: string; minutes: number }[] = [
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 hora", minutes: 60 },
  { label: "3 horas", minutes: 180 },
];

function untilTonight(): Date {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d;
}

function toLocalInputValue(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ComunityWizard() {
  const [, navigate] = useLocation();
  const { data: communities } = trpc.communities.list.useQuery();
  const { data: venues } = trpc.venues.publicActive.useQuery({});

  const [step, setStep] = useState(0);

  // Paso 1 — Pregunta
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [venueId, setVenueId] = useState<string>("");
  const [coverImageUrl, setCoverImageUrl] = useState("");

  // Paso 2 — Tipo de respuesta
  const [questionType, setQuestionType] = useState<ComunityQuestionType>("yes_no");
  const [options, setOptions] = useState<string[]>(["", ""]);

  // Paso 3 — Audiencia
  const [scopeCommunityIds, setScopeCommunityIds] = useState<number[]>([]);
  const [audience, setAudience] = useState<ComunityAudienceForm>(EMPTY_COMUNITY_AUDIENCE);

  // Paso 4 — Timing
  const [urgencyType, setUrgencyType] = useState<"flash" | "scheduled">("scheduled");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  // Paso 5 — Gamificación
  const [resultsVisibility, setResultsVisibility] = useState<"immediate" | "after_vote" | "after_close" | "never">("after_vote");
  const [allowChangeResponse, setAllowChangeResponse] = useState(true);
  const [minSampleSize, setMinSampleSize] = useState("5");

  const createMut = trpc.community.create.useMutation({
    onSuccess: res => { toast.success("Propuesta creada como borrador"); navigate(`/admin/comunity/${res.proposal.id}`); },
    onError: e => toast.error(e.message),
  });

  const needsOptions = QUESTION_TYPES_WITH_OPTIONS.includes(questionType);
  const cleanOptions = options.map(o => o.trim()).filter(Boolean);

  function applyFlashPreset(minutes: number) {
    setUrgencyType("flash");
    setStartsAt("");
    setEndsAt(toLocalInputValue(new Date(Date.now() + minutes * 60000)));
  }

  function canAdvance(): boolean {
    if (step === 0) return title.trim().length > 0;
    if (step === 1) return !needsOptions || cleanOptions.length >= 2;
    if (step === 3) return endsAt.trim().length > 0;
    return true;
  }

  function handleCreate() {
    createMut.mutate({
      title: title.trim(),
      description: description.trim() || null,
      questionType,
      urgencyType,
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
      resultsVisibility,
      allowChangeResponse,
      coverImageUrl: coverImageUrl.trim() || null,
      venueId: venueId ? Number(venueId) : null,
      audienceDefinition: toComunityAudienceDefinition(audience),
      minSampleSize: Number(minSampleSize) || 5,
      options: needsOptions ? cleanOptions : undefined,
      communityIds: scopeCommunityIds,
    });
  }

  return (
    <AdminLayout title="Nueva propuesta COMUNITY">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <Vote className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Nueva propuesta COMUNITY</h2>
            <p className="text-sm text-muted-foreground">Paso {step + 1} de {STEPS.length} — {STEPS[step]}</p>
          </div>
        </div>

        {/* Progreso */}
        <div className="flex gap-1">
          {STEPS.map((s, i) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>

        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          {step === 0 && (
            <>
              <div><Label>Pregunta / título *</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="¿Hacemos after party de Tanker en Casanova?" /></div>
              <div><Label>Descripción (opcional)</Label><Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} /></div>
              <div>
                <Label>Venue relacionado (opcional)</Label>
                <Select value={venueId || "none"} onValueChange={v => setVenueId(v === "none" ? "" : v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Sin venue" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin venue</SelectItem>
                    {(venues ?? []).map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Imagen de portada — URL (opcional)</Label>
                <Input value={coverImageUrl} onChange={e => setCoverImageUrl(e.target.value)} placeholder="https://…" />
                <p className="mt-1 text-xs text-muted-foreground">Sube la imagen en CMS → Multimedia y pega aquí la URL.</p>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <Label className="mb-2 block">Tipo de pregunta *</Label>
                <Select value={questionType} onValueChange={v => setQuestionType(v as ComunityQuestionType)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(QUESTION_TYPE_LABEL) as [ComunityQuestionType, string][]).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {needsOptions && (
                <div>
                  <Label className="mb-2 block">Opciones {questionType === "percentage_scale" ? "(criterios a puntuar)" : ""} *</Label>
                  <div className="space-y-2">
                    {options.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input value={opt} onChange={e => setOptions(o => o.map((x, j) => j === i ? e.target.value : x))} placeholder={`Opción ${i + 1}`} />
                        {options.length > 2 && (
                          <button onClick={() => setOptions(o => o.filter((_, j) => j !== i))} className="p-1.5 text-muted-foreground hover:text-destructive">
                            <X className="size-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => setOptions(o => [...o, ""])}>
                    <Plus className="size-3.5 mr-1" /> Añadir opción
                  </Button>
                  {cleanOptions.length < 2 && <p className="mt-2 text-xs text-destructive">Se necesitan al menos 2 opciones.</p>}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <Label className="mb-2 block">Alcance administrativo (qué comunidad gestiona esta propuesta)</Label>
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
                <p className="mt-1 text-xs text-muted-foreground">Sin marcar ninguna = visible/gestionable por cualquier admin con permiso (propuesta global).</p>
              </div>
              <div className="pt-2 border-t border-border">
                <Label className="mb-2 mt-3 block">Audiencia (quién puede responder)</Label>
                <ComunityAudienceBuilder value={audience} onChange={setAudience} />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <Label className="mb-2 block">Urgencia</Label>
                <div className="flex flex-wrap gap-2">
                  {FLASH_PRESETS.map(p => (
                    <Button key={p.label} type="button" variant={urgencyType === "flash" ? "default" : "outline"} size="sm" onClick={() => applyFlashPreset(p.minutes)}>
                      ⚡ {p.label}
                    </Button>
                  ))}
                  <Button type="button" variant={urgencyType === "flash" ? "default" : "outline"} size="sm" onClick={() => { setUrgencyType("flash"); setEndsAt(toLocalInputValue(untilTonight())); }}>
                    ⚡ Hasta esta noche
                  </Button>
                  <Button type="button" variant={urgencyType === "scheduled" ? "default" : "outline"} size="sm" onClick={() => setUrgencyType("scheduled")}>
                    Fecha personalizada
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Inicio (opcional — vacío = inmediato al publicar)</Label>
                  <Input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} disabled={urgencyType === "flash"} />
                </div>
                <div>
                  <Label>Cierre *</Label>
                  <Input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} />
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
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
                  <Label>Recompensa en SegoTokens</Label>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Se concede automáticamente según la política vigente de SegoTokens
                    (regla <span className="font-medium text-foreground">COMMUNITY_RESPONSE</span>) —
                    ya no se configura por propuesta. Ver <a href="/admin/tokens/rules" className="underline">Reglas de SegoTokens</a>.
                  </p>
                </div>
                <div>
                  <Label>Muestra mínima para comparativas por segmento</Label>
                  <Input type="number" min={1} max={50} value={minSampleSize} onChange={e => setMinSampleSize(e.target.value)} />
                </div>
              </div>
            </>
          )}

          {step === 5 && (
            <div className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Pregunta:</span> <span className="font-medium text-foreground">{title || "—"}</span></p>
              <p><span className="text-muted-foreground">Tipo:</span> {QUESTION_TYPE_LABEL[questionType]}</p>
              {needsOptions && <p><span className="text-muted-foreground">Opciones:</span> {cleanOptions.join(", ") || "—"}</p>}
              <p><span className="text-muted-foreground">Venue:</span> {(venues ?? []).find(v => String(v.id) === venueId)?.name ?? "—"}</p>
              <p><span className="text-muted-foreground">Alcance admin:</span> {scopeCommunityIds.length ? (communities ?? []).filter(c => scopeCommunityIds.includes(c.id)).map(c => c.name).join(", ") : "Global"}</p>
              <p><span className="text-muted-foreground">Audiencia:</span> {audience.allStudents ? "Todos los estudiantes" : "Segmentada (ver preview en Audiencia)"}</p>
              <p><span className="text-muted-foreground">Urgencia:</span> {urgencyType === "flash" ? "Flash" : "Programada"}</p>
              <p><span className="text-muted-foreground">Cierre:</span> {endsAt ? new Date(endsAt).toLocaleString("es-ES") : "—"}</p>
              <p><span className="text-muted-foreground">Resultados:</span> {resultsVisibility}</p>
              <p><span className="text-muted-foreground">Recompensa:</span> Según política vigente de SegoTokens (regla COMMUNITY_RESPONSE)</p>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-3 text-sm">
              <p className="text-foreground">La propuesta se creará en estado <span className="font-semibold">borrador</span> — no se notifica a nadie todavía.</p>
              <p className="text-muted-foreground">Desde su ficha (<code>/admin/comunity/:id</code>) podrás revisarla y publicarla cuando quieras, con el permiso <code>community.publish</code>.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>
            <ChevronLeft className="size-4 mr-1" /> Atrás
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))} disabled={!canAdvance()}>
              Siguiente <ChevronRight className="size-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={createMut.isPending}>
              {createMut.isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : null} Crear propuesta
            </Button>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
