import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Loader2, CheckCircle2, Coins } from "lucide-react";
import { ATTENDANCE_INTENTION_LABEL, timeLeftLabel } from "@/lib/comunity";

type QuestionType =
  | "single_choice" | "yes_no" | "percentage_scale" | "scale_1_5"
  | "multiselect" | "ranking" | "attendance_intention" | "me_apunto" | "open_text";

/**
 * Detalle de una pregunta COMUNITY + votar — /:community/comunity/:id (spec
 * puntos 24-30). Toda la lógica de "¿qué puede ver este estudiante?" ya la
 * resuelve el servidor (getPublicById) — aquí solo se renderiza, nunca se
 * decide visibilidad de resultados en el cliente.
 */
export default function ComunityQuestionDetail() {
  const { id } = useParams<{ id: string }>();
  const { slug } = useCommunity();
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const proposalId = Number(id);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.community.getPublicById.useQuery({ id: proposalId });

  const [justResponded, setJustResponded] = useState(false);
  const respondMut = trpc.community.respond.useMutation({
    onSuccess: () => {
      setJustResponded(true);
      utils.community.getPublicById.invalidate({ id: proposalId });
      utils.community.myActive.invalidate();
      utils.community.myResponded.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  if (isLoading || !data) {
    return (
      <SegolifeAppShell requireAuth title="Comunity">
        <SegolifePageContainer><div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div></SegolifePageContainer>
      </SegolifeAppShell>
    );
  }

  const { proposal, options, myResponse, results, isOpen } = data;
  const qType = proposal.questionType as QuestionType;
  const alreadyResponded = !!myResponse;
  const canRespond = isOpen && (!alreadyResponded || proposal.allowChangeResponse);

  return (
    <SegolifeAppShell requireAuth title={proposal.title}>
      <SegolifePageContainer className="space-y-5">
        {proposal.coverImageUrl && (
          <img src={proposal.coverImageUrl} alt="" className="w-full h-40 rounded-2xl object-cover" />
        )}
        <div>
          <h1 className="text-xl font-semibold text-foreground">{proposal.title}</h1>
          {proposal.description && <p className="mt-1 text-sm text-muted-foreground">{proposal.description}</p>}
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            {isOpen ? <span>⏳ {timeLeftLabel(proposal.endsAt)}</span> : <span>Cerrada</span>}
            {!!proposal.tokenReward && (
              <span className="flex items-center gap-1 text-primary"><Coins className="size-3.5" /> +{proposal.tokenReward} ST</span>
            )}
          </div>
        </div>

        {justResponded && (
          <div className="flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm text-foreground">
            <CheckCircle2 className="size-5 text-primary shrink-0" />
            {t("comunity.thanksForVoting", "¡Gracias por participar!")}
          </div>
        )}

        {canRespond ? (
          <VoteForm
            qType={qType}
            options={options}
            existing={myResponse}
            pending={respondMut.isPending}
            onSubmit={payload => respondMut.mutate({ proposalId, payload: payload as never })}
          />
        ) : !isOpen ? (
          <p className="text-sm text-muted-foreground">Esta pregunta ya no admite respuestas.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Ya has respondido y esta pregunta no admite cambios.</p>
        )}

        {results && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold text-foreground mb-3">Resultados{results.totalResponses > 0 ? ` (${results.totalResponses})` : ""}</p>
            <PublicResults qType={qType} results={results} />
          </div>
        )}

        <Button variant="ghost" onClick={() => navigate(`/${slug}/comunity`)}>← Volver a COMUNITY</Button>
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}

// ─── Formulario de voto por tipo ────────────────────────────────────────────

function VoteForm({ qType, options, existing, pending, onSubmit }: {
  qType: QuestionType;
  options: { id: number; label: string; sortOrder: number }[];
  existing: { response: unknown; values: { optionId: number | null; valueText: string | null; valueNumber: number | null }[] } | null;
  pending: boolean;
  onSubmit: (payload: Record<string, unknown> & { questionType: QuestionType }) => void;
}) {
  const [singleChoice, setSingleChoice] = useState<number | null>(existing?.values[0]?.optionId ?? null);
  const [yesNo, setYesNo] = useState<"yes" | "no" | null>((existing?.values[0]?.valueText as "yes" | "no") ?? null);
  const [percentages, setPercentages] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const o of options) init[o.id] = existing?.values.find(v => v.optionId === o.id)?.valueNumber ?? 50;
    return init;
  });
  const [scale, setScale] = useState<number>(existing?.values[0]?.valueNumber ?? 3);
  const [multi, setMulti] = useState<number[]>(existing?.values.map(v => v.optionId).filter((x): x is number => x != null) ?? []);
  const [ranked, setRanked] = useState<number[]>(() => {
    if (existing?.values.length) {
      return [...existing.values].sort((a, b) => (a.valueNumber ?? 0) - (b.valueNumber ?? 0)).map(v => v.optionId!).filter(Boolean);
    }
    return options.map(o => o.id);
  });
  const [intention, setIntention] = useState<string | null>((existing?.values[0]?.valueText as string) ?? null);
  const [openText, setOpenText] = useState<string>(existing?.values[0]?.valueText ?? "");

  const btn = (active: boolean) =>
    `rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-accent"}`;

  if (qType === "single_choice") {
    return (
      <div className="space-y-2">
        {options.map(o => (
          <button key={o.id} className={`w-full text-left ${btn(singleChoice === o.id)}`} onClick={() => setSingleChoice(o.id)}>{o.label}</button>
        ))}
        <Button className="w-full mt-2" disabled={singleChoice == null || pending} onClick={() => onSubmit({ questionType: qType, optionId: singleChoice! })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Votar"}
        </Button>
      </div>
    );
  }

  if (qType === "yes_no") {
    return (
      <div className="space-y-2">
        <div className="flex gap-3">
          <button className={`flex-1 ${btn(yesNo === "yes")}`} onClick={() => setYesNo("yes")}>👍 Sí</button>
          <button className={`flex-1 ${btn(yesNo === "no")}`} onClick={() => setYesNo("no")}>👎 No</button>
        </div>
        <Button className="w-full" disabled={!yesNo || pending} onClick={() => onSubmit({ questionType: qType, value: yesNo })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Votar"}
        </Button>
      </div>
    );
  }

  if (qType === "percentage_scale") {
    return (
      <div className="space-y-5">
        {options.map(o => (
          <div key={o.id}>
            <div className="flex items-center justify-between text-sm mb-1"><span className="text-foreground">{o.label}</span><span className="text-muted-foreground tabular-nums">{percentages[o.id]}</span></div>
            <Slider
              value={[percentages[o.id]]}
              min={0} max={100} step={1}
              aria-label={o.label}
              onValueChange={([v]) => setPercentages(p => ({ ...p, [o.id]: v }))}
            />
          </div>
        ))}
        <Button
          className="w-full"
          disabled={pending}
          onClick={() => onSubmit({ questionType: qType, values: options.map(o => ({ optionId: o.id, value: percentages[o.id] })) })}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Enviar"}
        </Button>
      </div>
    );
  }

  if (qType === "scale_1_5") {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map(v => (
            <button key={v} className={`flex-1 ${btn(scale === v)}`} onClick={() => setScale(v)}>{v}</button>
          ))}
        </div>
        <Button className="w-full" disabled={pending} onClick={() => onSubmit({ questionType: qType, value: scale })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Votar"}
        </Button>
      </div>
    );
  }

  if (qType === "multiselect") {
    return (
      <div className="space-y-2">
        {options.map(o => (
          <button key={o.id} className={`w-full text-left ${btn(multi.includes(o.id))}`} onClick={() => setMulti(m => m.includes(o.id) ? m.filter(x => x !== o.id) : [...m, o.id])}>
            {o.label}
          </button>
        ))}
        <Button className="w-full mt-2" disabled={multi.length === 0 || pending} onClick={() => onSubmit({ questionType: qType, optionIds: multi })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Votar"}
        </Button>
      </div>
    );
  }

  if (qType === "ranking") {
    const labelById = new Map(options.map(o => [o.id, o.label]));
    const move = (idx: number, dir: -1 | 1) => {
      setRanked(r => {
        const next = [...r];
        const j = idx + dir;
        if (j < 0 || j >= next.length) return r;
        [next[idx], next[j]] = [next[j], next[idx]];
        return next;
      });
    };
    return (
      <div className="space-y-2">
        {ranked.map((optId, i) => (
          <div key={optId} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
            <span className="w-5 text-sm font-semibold text-muted-foreground">{i + 1}</span>
            <span className="flex-1 text-sm text-foreground">{labelById.get(optId)}</span>
            <button aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 disabled:opacity-30"><ArrowUp className="size-4" /></button>
            <button aria-label="Bajar" disabled={i === ranked.length - 1} onClick={() => move(i, 1)} className="p-1 disabled:opacity-30"><ArrowDown className="size-4" /></button>
          </div>
        ))}
        <Button className="w-full mt-2" disabled={pending} onClick={() => onSubmit({ questionType: qType, orderedOptionIds: ranked })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Enviar orden"}
        </Button>
      </div>
    );
  }

  if (qType === "attendance_intention") {
    return (
      <div className="space-y-2">
        {(["definitely", "probably", "maybe", "no"] as const).map(k => (
          <button key={k} className={`w-full text-left ${btn(intention === k)}`} onClick={() => setIntention(k)}>{ATTENDANCE_INTENTION_LABEL[k]}</button>
        ))}
        <Button className="w-full mt-2" disabled={!intention || pending} onClick={() => onSubmit({ questionType: qType, value: intention })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Votar"}
        </Button>
      </div>
    );
  }

  if (qType === "me_apunto") {
    return (
      <Button className="w-full" size="lg" disabled={!!existing || pending} onClick={() => onSubmit({ questionType: qType })}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : existing ? "✅ Ya te has apuntado" : "🙋 Me apunto"}
      </Button>
    );
  }

  // open_text
  return (
    <div className="space-y-2">
      <Textarea rows={4} maxLength={1000} value={openText} onChange={e => setOpenText(e.target.value)} placeholder="Escribe tu respuesta…" />
      <p className="text-right text-xs text-muted-foreground">{openText.length}/1000</p>
      <Button className="w-full" disabled={!openText.trim() || pending} onClick={() => onSubmit({ questionType: qType, text: openText.trim() })}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : "Enviar"}
      </Button>
    </div>
  );
}

// ─── Resultados (vista estudiante — sin acciones de moderación) ────────────

function PublicResults({ qType, results }: { qType: QuestionType; results: any }) {
  if (results.totalResponses === 0) return <p className="text-sm text-muted-foreground">Todavía nadie ha respondido.</p>;

  if ((qType === "single_choice" || qType === "multiselect")) {
    const items = results.singleChoice ?? results.multiselect ?? [];
    return (
      <div className="space-y-2">
        {items.map((o: any) => (
          <div key={o.optionId}>
            <div className="flex items-center justify-between text-sm mb-1"><span className="text-foreground">{o.label}</span><span className="text-muted-foreground">{o.percentage}%</span></div>
            <Progress value={o.percentage} className="h-2" />
          </div>
        ))}
      </div>
    );
  }

  if (results.yesNo) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm mb-1"><span>👍 Sí</span><span>{results.yesNo.yesPercentage}%</span></div>
        <Progress value={results.yesNo.yesPercentage} className="h-2" />
      </div>
    );
  }

  if (results.percentageScale) {
    return (
      <div className="space-y-3">
        {results.percentageScale.map((o: any) => (
          <div key={o.optionId}>
            <div className="flex items-center justify-between text-sm mb-1"><span className="text-foreground">{o.label}</span><span className="text-muted-foreground">{o.average}/100</span></div>
            <Progress value={o.average} className="h-2" />
          </div>
        ))}
      </div>
    );
  }

  if (results.scale15) {
    return <p className="text-sm text-foreground">Media: <span className="font-semibold">{results.scale15.average}</span> / 5</p>;
  }

  if (results.ranking) {
    return (
      <ol className="space-y-1 text-sm">
        {results.ranking.map((o: any, i: number) => <li key={o.optionId} className="text-foreground">{i + 1}. {o.label}</li>)}
      </ol>
    );
  }

  if (results.attendanceIntention) {
    const b = results.attendanceIntention.breakdown;
    return (
      <div className="space-y-2">
        {(["definitely", "probably", "maybe", "no"] as const).map(k => (
          <div key={k} className="flex items-center justify-between text-sm">
            <span>{ATTENDANCE_INTENTION_LABEL[k]}</span><span className="text-muted-foreground">{b[k] ?? 0}</span>
          </div>
        ))}
      </div>
    );
  }

  if (results.meApunto) {
    return <p className="text-lg font-semibold text-foreground">{results.meApunto.count} se apuntan</p>;
  }

  if (results.openText) {
    const featured = results.openText.filter((t: any) => t.isFeatured);
    const list = featured.length ? featured : results.openText.slice(0, 10);
    return (
      <div className="space-y-2">
        {list.map((t: any) => <p key={t.id} className="text-sm text-foreground rounded-xl bg-secondary px-3 py-2">{t.text}</p>)}
      </div>
    );
  }

  return null;
}
