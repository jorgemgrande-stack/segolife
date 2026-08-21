import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Loader2, CheckCircle2, Coins, MapPin } from "lucide-react";

type QuestionType =
  | "single_choice" | "yes_no" | "percentage_scale" | "scale_1_5"
  | "multiselect" | "ranking" | "attendance_intention" | "me_apunto" | "open_text";

const ATTENDANCE_INTENTION_KEYS = ["definitely", "probably", "maybe", "no"] as const;

/** Cuenta atrás compacta traducida — misma lógica que lib/comunity.ts:timeLeftLabel, versión i18n (Admin sigue usando la fija en español, ver Fase 16). */
function timeLeftLabelI18n(t: TFunction, endsAt: Date | string | null | undefined): string {
  if (!endsAt) return t("comunity.timeLeft.noDeadline");
  const diffMs = new Date(endsAt).getTime() - Date.now();
  if (diffMs <= 0) return t("comunity.timeLeft.closed");
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return t("comunity.timeLeft.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("comunity.timeLeft.hoursMinutes", { hours, minutes: minutes % 60 });
  const days = Math.floor(hours / 24);
  return t("comunity.timeLeft.daysHours", { days, hours: hours % 24 });
}

/**
 * Detalle de una pregunta COMUNITY + votar — /:community/comunity/:id (spec
 * puntos 24-30). Toda la lógica de "¿qué puede ver este estudiante?" ya la
 * resuelve el servidor (getPublicById) — aquí solo se renderiza, nunca se
 * decide visibilidad de resultados en el cliente.
 *
 * Fase 16 (auditoría) — página casi entera en español hardcodeado pese a
 * usar useTranslation solo para 1 string; namespace `comunity.*` propio,
 * nunca los labels fijos de lib/comunity.ts (compartidos con Admin).
 */
export default function ComunityQuestionDetail() {
  const { id } = useParams<{ id: string }>();
  const { slug, community } = useCommunity();
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const proposalId = Number(id);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.community.getPublicById.useQuery({ id: proposalId });

  // SEGOTOKENS REWARD PREVIEW (Fase 10.6) — misma lógica que ComunityHub.tsx:
  // la regla real (COMMUNITY_RESPONSE, scope global) manda, nunca el campo
  // legacy proposal.tokenReward.
  const rewardQ = trpc.tokens.previewMyReward.useQuery(
    { origin: "community_response", communityId: community?.id },
    { enabled: !!community?.id }
  );
  const responseReward = rewardQ.data?.totalGuaranteedTokens ?? 0;

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
          {/* Hallazgo real (2026-08-22, captura del cliente) — la ubicación de la propuesta nunca se mostraba al Student. */}
          {proposal.venueName && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3.5" /> {proposal.venueName}</p>
          )}
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            {isOpen ? <span>⏳ {timeLeftLabelI18n(t, proposal.endsAt)}</span> : <span>{t("comunity.statusClosed")}</span>}
            {responseReward > 0 && (
              <span className="flex items-center gap-1 text-primary"><Coins className="size-3.5" /> +{responseReward} ST</span>
            )}
          </div>
        </div>

        {justResponded && (
          <div className="flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm text-foreground">
            <CheckCircle2 className="size-5 text-primary shrink-0" />
            {t("comunity.thanksForVoting")}
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
          <p className="text-sm text-muted-foreground">{t("comunity.cannotRespondClosed")}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("comunity.alreadyRespondedNoChanges")}</p>
        )}

        {results && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold text-foreground mb-3">{t("comunity.results")}{results.totalResponses > 0 ? ` (${results.totalResponses})` : ""}</p>
            <PublicResults qType={qType} results={results} proposalId={proposalId} />
          </div>
        )}

        <Button variant="ghost" onClick={() => navigate(`/${slug}/comunity`)}>{t("comunity.backToComunity")}</Button>
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
  const { t } = useTranslation();
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
          {pending ? <Loader2 className="size-4 animate-spin" /> : t("comunity.vote")}
        </Button>
      </div>
    );
  }

  if (qType === "yes_no") {
    return (
      <div className="space-y-2">
        <div className="flex gap-3">
          <button className={`flex-1 ${btn(yesNo === "yes")}`} onClick={() => setYesNo("yes")}>{t("comunity.yes")}</button>
          <button className={`flex-1 ${btn(yesNo === "no")}`} onClick={() => setYesNo("no")}>{t("comunity.no")}</button>
        </div>
        <Button className="w-full" disabled={!yesNo || pending} onClick={() => onSubmit({ questionType: qType, value: yesNo })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : t("comunity.vote")}
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
          {pending ? <Loader2 className="size-4 animate-spin" /> : t("comunity.send")}
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
          {pending ? <Loader2 className="size-4 animate-spin" /> : t("comunity.vote")}
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
          {pending ? <Loader2 className="size-4 animate-spin" /> : t("comunity.vote")}
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
            <button aria-label={t("comunity.moveUp")} disabled={i === 0} onClick={() => move(i, -1)} className="p-1 disabled:opacity-30"><ArrowUp className="size-4" /></button>
            <button aria-label={t("comunity.moveDown")} disabled={i === ranked.length - 1} onClick={() => move(i, 1)} className="p-1 disabled:opacity-30"><ArrowDown className="size-4" /></button>
          </div>
        ))}
        <Button className="w-full mt-2" disabled={pending} onClick={() => onSubmit({ questionType: qType, orderedOptionIds: ranked })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : t("comunity.sendOrder")}
        </Button>
      </div>
    );
  }

  if (qType === "attendance_intention") {
    return (
      <div className="space-y-2">
        {ATTENDANCE_INTENTION_KEYS.map(k => (
          <button key={k} className={`w-full text-left ${btn(intention === k)}`} onClick={() => setIntention(k)}>{t(`comunity.attendanceIntention.${k}`)}</button>
        ))}
        <Button className="w-full mt-2" disabled={!intention || pending} onClick={() => onSubmit({ questionType: qType, value: intention })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : t("comunity.vote")}
        </Button>
      </div>
    );
  }

  if (qType === "me_apunto") {
    return (
      <Button className="w-full" size="lg" disabled={!!existing || pending} onClick={() => onSubmit({ questionType: qType })}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : existing ? t("comunity.alreadyJoined") : t("comunity.imIn")}
      </Button>
    );
  }

  // open_text
  return (
    <div className="space-y-2">
      <Textarea rows={4} maxLength={1000} value={openText} onChange={e => setOpenText(e.target.value)} placeholder={t("comunity.responsePlaceholder")} />
      <p className="text-right text-xs text-muted-foreground">{openText.length}/1000</p>
      <Button className="w-full" disabled={!openText.trim() || pending} onClick={() => onSubmit({ questionType: qType, text: openText.trim() })}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : t("comunity.send")}
      </Button>
    </div>
  );
}

// ─── Resultados (vista estudiante — sin acciones de moderación) ────────────

function PublicResults({ qType, results, proposalId }: { qType: QuestionType; results: any; proposalId: number }) {
  const { t } = useTranslation();
  if (results.totalResponses === 0) return <p className="text-sm text-muted-foreground">{t("comunity.noResponsesYet")}</p>;

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
        <div className="flex items-center justify-between text-sm mb-1"><span>{t("comunity.yes")}</span><span>{results.yesNo.yesPercentage}%</span></div>
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
    return <p className="text-sm text-foreground">{t("comunity.average")} <span className="font-semibold">{results.scale15.average}</span> / 5</p>;
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
        {ATTENDANCE_INTENTION_KEYS.map(k => (
          <div key={k} className="flex items-center justify-between text-sm">
            <span>{t(`comunity.attendanceIntention.${k}`)}</span><span className="text-muted-foreground">{b[k] ?? 0}</span>
          </div>
        ))}
      </div>
    );
  }

  if (results.meApunto) {
    return (
      <div className="space-y-2">
        <p className="text-lg font-semibold text-foreground">{t("comunity.countJoining", { count: results.meApunto.count })}</p>
        <RespondentAvatarStack proposalId={proposalId} total={results.meApunto.count} />
      </div>
    );
  }

  if (results.openText) {
    const featured = results.openText.filter((t: any) => t.isFeatured);
    const list = featured.length ? featured : results.openText.slice(0, 10);
    return (
      <div className="space-y-2">
        {list.map((entry: any) => <p key={entry.id} className="text-sm text-foreground rounded-xl bg-secondary px-3 py-2">{entry.text}</p>)}
      </div>
    );
  }

  return null;
}

// ─── Avatar-stack de respondientes (petición del cliente, 2026-08-22) ──────
// "Ana, Bea, Carla y otros 227 más" con avatares superpuestos estilo
// Instagram — hasta 5 directamente en la card, más allá de eso se colapsa en
// un "+N" clicable que abre el listado completo (AllRespondentsDialog).
// Decisión de producto EXPLÍCITA del cliente (confirmada tras plantearle el
// trade-off): se muestra la foto real de otros estudiantes, algo que antes
// de esta feature nunca ocurría (studentPhotoRoutes.ts es deliberadamente
// self/admin-only) — aquí se sirve por una ruta REST nueva y aparte
// (communityRespondentPhotoRoutes.ts) que revalida en cada petición que
// quien mira comparte audiencia con esa propuesta y que sus resultados son
// visibles ahora mismo, nunca la ruta genérica de foto de perfil.

const AVATAR_STACK_LIMIT = 5;

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "");
}

function RespondentAvatar({ proposalId, userId, name, hasAvatar, className }: { proposalId: number; userId: number; name: string | null; hasAvatar: boolean; className?: string }) {
  return (
    <Avatar className={className ?? "size-8 border-2 border-card"}>
      {hasAvatar && <img src={`/api/community/proposals/${proposalId}/respondents/${userId}/photo`} alt="" className="size-full object-cover" />}
      <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

function RespondentAvatarStack({ proposalId, total }: { proposalId: number; total: number }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const { data } = trpc.community.getPublicRespondents.useQuery({ proposalId, limit: AVATAR_STACK_LIMIT, offset: 0 });
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  const extra = total - items.length;
  const names = items.map(r => r.name?.split(" ")[0] ?? t("comunity.someone")).join(", ");

  return (
    <>
      <button type="button" onClick={() => setShowAll(true)} className="flex items-center gap-2 text-left">
        <div className="flex -space-x-2">
          {items.map(r => <RespondentAvatar key={r.userId} proposalId={proposalId} userId={r.userId} name={r.name} hasAvatar={r.hasAvatar} />)}
        </div>
        <p className="text-xs text-muted-foreground">
          {extra > 0 ? t("comunity.respondentsAndMore", { names, count: extra }) : names}
        </p>
      </button>
      <AllRespondentsDialog proposalId={proposalId} total={total} open={showAll} onOpenChange={setShowAll} />
    </>
  );
}

const RESPONDENTS_PAGE_SIZE = 30;

function AllRespondentsDialog({ proposalId, total, open, onOpenChange }: { proposalId: number; total: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const [loadedPages, setLoadedPages] = useState(1);
  const { data, isLoading } = trpc.community.getPublicRespondents.useQuery(
    { proposalId, limit: RESPONDENTS_PAGE_SIZE * loadedPages, offset: 0 },
    { enabled: open }
  );
  const items = data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) setLoadedPages(1); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t("comunity.countJoining", { count: total })}</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="max-h-96 space-y-1 overflow-y-auto">
            {items.map(r => (
              <div key={r.userId} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                <RespondentAvatar proposalId={proposalId} userId={r.userId} name={r.name} hasAvatar={r.hasAvatar} className="size-9" />
                <p className="text-sm text-foreground">{r.name ?? t("comunity.someone")}</p>
              </div>
            ))}
            {items.length < total && (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setLoadedPages(p => p + 1)}>
                {t("comunity.loadMore")}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
