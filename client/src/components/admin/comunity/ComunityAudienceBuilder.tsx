import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Users } from "lucide-react";

/**
 * Constructor de audiencia de COMUNITY — spec puntos 9-11. REUSE del mismo
 * `audienceEngine.resolveAudience()` que ya usa Engagement (nunca un motor
 * de segmentación paralelo), a través de `community.previewAudience`. Es un
 * componente propio (no el `AudienceFilterBuilder` de Engagement) porque
 * COMUNITY necesita el interruptor "Todos los estudiantes" (spec punto 9:
 * "TODOS" es un target válido) que Engagement no expone — mismo criterio de
 * subconjunto curado que ya adoptó ese componente ("no sobrecargar un primer
 * builder usable").
 */
export interface ComunityAudienceForm {
  allStudents: boolean;
  communityIds: number[];
  tagIds: number[];
  tokensBalanceMin: string;
  tokensBalanceMax: string;
  academicYear: string;
  profileComplete: string; // "" | "true" | "false"
  createdAfter: string;
  createdBefore: string;
}

export const EMPTY_COMUNITY_AUDIENCE: ComunityAudienceForm = {
  allStudents: false, communityIds: [], tagIds: [],
  tokensBalanceMin: "", tokensBalanceMax: "", academicYear: "",
  profileComplete: "", createdAfter: "", createdBefore: "",
};

export function toComunityAudienceDefinition(form: ComunityAudienceForm) {
  return {
    allStudents: form.allStudents || undefined,
    communityIds: form.communityIds.length ? form.communityIds : undefined,
    tagIds: form.tagIds.length ? form.tagIds : undefined,
    tokensBalanceMin: form.tokensBalanceMin ? Number(form.tokensBalanceMin) : undefined,
    tokensBalanceMax: form.tokensBalanceMax ? Number(form.tokensBalanceMax) : undefined,
    academicYear: form.academicYear || undefined,
    profileComplete: form.profileComplete ? form.profileComplete === "true" : undefined,
    createdAfter: form.createdAfter || undefined,
    createdBefore: form.createdBefore || undefined,
  };
}

/** Inverso de toComunityAudienceDefinition — reconstruye el form desde una audienceDefinition guardada (para editar propuestas existentes). Best-effort: solo entiende el subconjunto curado que expone este builder; si la definición trae criterios avanzados (venueActivity/eventAttended/benefitOwnership, no expuestos aquí) esos campos no se representan, así que el caller NO debe reenviar audienceDefinition a menos que el admin haya tocado explícitamente este builder. */
export function fromComunityAudienceDefinition(def: Record<string, unknown> | null | undefined): ComunityAudienceForm {
  if (!def) return EMPTY_COMUNITY_AUDIENCE;
  return {
    allStudents: def.allStudents === true,
    communityIds: Array.isArray(def.communityIds) ? (def.communityIds as number[]) : [],
    tagIds: Array.isArray(def.tagIds) ? (def.tagIds as number[]) : [],
    tokensBalanceMin: typeof def.tokensBalanceMin === "number" ? String(def.tokensBalanceMin) : "",
    tokensBalanceMax: typeof def.tokensBalanceMax === "number" ? String(def.tokensBalanceMax) : "",
    academicYear: typeof def.academicYear === "string" ? def.academicYear : "",
    profileComplete: def.profileComplete === true ? "true" : def.profileComplete === false ? "false" : "",
    createdAfter: typeof def.createdAfter === "string" ? def.createdAfter : "",
    createdBefore: typeof def.createdBefore === "string" ? def.createdBefore : "",
  };
}

function hasAnyFilter(form: ComunityAudienceForm): boolean {
  if (form.allStudents) return true;
  const def = toComunityAudienceDefinition(form);
  return Object.entries(def).some(([k, v]) => k !== "allStudents" && v !== undefined);
}

export function ComunityAudienceBuilder({ value, onChange }: { value: ComunityAudienceForm; onChange: (v: ComunityAudienceForm) => void }) {
  const { data: communities } = trpc.communities.list.useQuery();
  const { data: tags } = trpc.students.listTags.useQuery();

  const definition = toComunityAudienceDefinition(value);
  const { data: preview, isFetching: previewLoading } = trpc.community.previewAudience.useQuery(
    { audienceDefinition: definition },
    { enabled: hasAnyFilter(value) }
  );

  const set = <K extends keyof ComunityAudienceForm>(k: K, v: ComunityAudienceForm[K]) => onChange({ ...value, [k]: v });
  const toggleId = (list: number[], id: number) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm font-medium">
        <Checkbox
          checked={value.allStudents}
          onCheckedChange={c => set("allStudents", c === true)}
        />
        Todos los estudiantes (ignora el resto de filtros)
      </label>

      <div className={value.allStudents ? "pointer-events-none opacity-40" : ""}>
        <div>
          <Label className="mb-2 block">Comunidad</Label>
          <div className="flex flex-wrap gap-3">
            {(communities ?? []).map(c => (
              <label key={c.id} className="flex items-center gap-1.5 text-sm">
                <Checkbox checked={value.communityIds.includes(c.id)} onCheckedChange={() => set("communityIds", toggleId(value.communityIds, c.id))} />
                {c.name}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <Label className="mb-2 block">Etiquetas</Label>
          <div className="flex flex-wrap gap-3">
            {(tags ?? []).map(t => (
              <label key={t.id} className="flex items-center gap-1.5 text-sm">
                <Checkbox checked={value.tagIds.includes(t.id)} onCheckedChange={() => set("tagIds", toggleId(value.tagIds, t.id))} />
                {t.name}
              </label>
            ))}
            {(!tags || tags.length === 0) && <p className="text-xs text-muted-foreground">Sin etiquetas creadas todavía.</p>}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div><Label>SegoTokens — mínimo</Label><Input type="number" value={value.tokensBalanceMin} onChange={e => set("tokensBalanceMin", e.target.value)} /></div>
          <div><Label>SegoTokens — máximo</Label><Input type="number" value={value.tokensBalanceMax} onChange={e => set("tokensBalanceMax", e.target.value)} /></div>
          <div><Label>Año académico</Label><Input value={value.academicYear} onChange={e => set("academicYear", e.target.value)} placeholder="2025-2026" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Alta desde</Label><Input type="date" value={value.createdAfter} onChange={e => set("createdAfter", e.target.value)} /></div>
            <div><Label>Alta hasta</Label><Input type="date" value={value.createdBefore} onChange={e => set("createdBefore", e.target.value)} /></div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {!hasAnyFilter(value) ? (
          <span className="text-sm text-muted-foreground">Sin filtros = sin audiencia. Marca "Todos los estudiantes" o añade al menos un filtro.</span>
        ) : previewLoading ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Calculando…</span>
        ) : (
          <span className="text-sm text-foreground">
            <span className="font-semibold">{preview?.total ?? 0} estudiante(s)</span> estimados
            {!!preview?.byCommunity.length && (
              <span className="text-muted-foreground"> · {preview.byCommunity.map(c => `${c.communityName}: ${c.count}`).join(" · ")}</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
