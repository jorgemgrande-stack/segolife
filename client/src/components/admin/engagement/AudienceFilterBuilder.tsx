import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Users } from "lucide-react";

export interface AudienceDefinitionForm {
  communityIds: number[];
  tagIds: number[];
  tokensBalanceMin: string;
  tokensBalanceMax: string;
  benefitStatus: string; // "" | active | used | expired | cancelled
  academicYear: string;
  profileComplete: string; // "" | true | false
  createdAfter: string;
  createdBefore: string;
}

export const EMPTY_AUDIENCE_FORM: AudienceDefinitionForm = {
  communityIds: [], tagIds: [], tokensBalanceMin: "", tokensBalanceMax: "",
  benefitStatus: "", academicYear: "", profileComplete: "", createdAfter: "", createdBefore: "",
};

/** Convierte el form de UI a la forma que espera resolveAudiencePreview/createCampaign — omite claves vacías (spec: sin filtros = sin audiencia, nunca "todos"). */
export function toAudienceDefinition(form: AudienceDefinitionForm) {
  return {
    communityIds: form.communityIds.length ? form.communityIds : undefined,
    tagIds: form.tagIds.length ? form.tagIds : undefined,
    tokensBalanceMin: form.tokensBalanceMin ? Number(form.tokensBalanceMin) : undefined,
    tokensBalanceMax: form.tokensBalanceMax ? Number(form.tokensBalanceMax) : undefined,
    benefitOwnership: form.benefitStatus ? { status: form.benefitStatus as "active" | "used" | "expired" | "cancelled" } : undefined,
    academicYear: form.academicYear || undefined,
    profileComplete: form.profileComplete ? form.profileComplete === "true" : undefined,
    createdAfter: form.createdAfter || undefined,
    createdBefore: form.createdBefore || undefined,
  };
}

function hasAnyFilter(form: AudienceDefinitionForm): boolean {
  return Object.values(toAudienceDefinition(form)).some(v => v !== undefined);
}

/**
 * Constructor de audiencia reutilizado por el wizard de campañas y por la
 * página standalone de Audiencia (Fase 7, spec puntos 18-22, 69). Solo
 * expone los filtros de mayor valor (comunidad, etiquetas, SegoTokens,
 * beneficio, año académico, perfil completo, fecha de alta) — venue
 * activity / event attended existen en el backend (audienceEngine.ts) pero
 * no se exponen aquí todavía, para no sobrecargar un primer builder usable.
 */
export function AudienceFilterBuilder({ value, onChange }: { value: AudienceDefinitionForm; onChange: (v: AudienceDefinitionForm) => void }) {
  const { data: communities } = trpc.communities.list.useQuery();
  const { data: tags } = trpc.students.listTags.useQuery();

  const definition = toAudienceDefinition(value);
  const { data: preview, isFetching: previewLoading } = trpc.engagement.resolveAudiencePreview.useQuery(definition, {
    enabled: hasAnyFilter(value),
  });

  const set = <K extends keyof AudienceDefinitionForm>(k: K, v: AudienceDefinitionForm[K]) => onChange({ ...value, [k]: v });

  const toggleId = (list: number[], id: number) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  return (
    <div className="space-y-4">
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

      <div>
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

      <div className="grid grid-cols-2 gap-4">
        <div><Label>SegoTokens — mínimo</Label><Input type="number" value={value.tokensBalanceMin} onChange={e => set("tokensBalanceMin", e.target.value)} /></div>
        <div><Label>SegoTokens — máximo</Label><Input type="number" value={value.tokensBalanceMax} onChange={e => set("tokensBalanceMax", e.target.value)} /></div>
        <div>
          <Label>Estado de beneficio</Label>
          <Select value={value.benefitStatus || "any"} onValueChange={v => set("benefitStatus", v === "any" ? "" : v)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Cualquiera</SelectItem>
              <SelectItem value="active">Activo</SelectItem>
              <SelectItem value="used">Usado</SelectItem>
              <SelectItem value="expired">Caducado</SelectItem>
              <SelectItem value="cancelled">Cancelado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Perfil completo</Label>
          <Select value={value.profileComplete || "any"} onValueChange={v => set("profileComplete", v === "any" ? "" : v)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Cualquiera</SelectItem>
              <SelectItem value="true">Sí</SelectItem>
              <SelectItem value="false">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Año académico</Label><Input value={value.academicYear} onChange={e => set("academicYear", e.target.value)} placeholder="2025-2026" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Alta desde</Label><Input type="date" value={value.createdAfter} onChange={e => set("createdAfter", e.target.value)} /></div>
          <div><Label>Alta hasta</Label><Input type="date" value={value.createdBefore} onChange={e => set("createdBefore", e.target.value)} /></div>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <Users className="size-4 text-muted-foreground" aria-hidden="true" />
        {!hasAnyFilter(value) ? (
          <span className="text-sm text-muted-foreground">Sin filtros = sin audiencia. Añade al menos un filtro para ver una estimación.</span>
        ) : previewLoading ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Calculando…</span>
        ) : (
          <span className="text-sm font-medium text-foreground">{preview?.count ?? 0} usuario(s) coinciden con estos filtros</span>
        )}
      </div>
    </div>
  );
}
