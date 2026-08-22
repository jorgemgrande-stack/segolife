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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Loader2, CheckCircle2, Coins, MapPin, Heart, MessageCircle, Share2, X } from "lucide-react";
import { initials, relativeTimeLabel, resultHeadline } from "@/lib/comunitySocial";

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

  // COM-02 — Community Social Results (spec §4/§19): el diseño social se
  // aplica EXACTAMENTE cuando la propuesta está finalizada, reutilizando el
  // lifecycle real (status="closed", mismo criterio que ya filtraba
  // ResultadosTab en ComunityHub.tsx) — nunca un estado nuevo. Una propuesta
  // activa sigue exactamente el flujo de siempre (VoteForm/resultados
  // simples), sin ningún cambio.
  if (proposal.status === "closed") {
    return (
      <SegolifeAppShell requireAuth title={proposal.title}>
        <SegolifePageContainer className="space-y-4">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(`/${slug}/comunity`)}>{t("comunity.backToComunity")}</Button>
          <SocialProposalView
            proposal={proposal}
            author={data.author}
            liked={data.liked}
            likeCount={data.likeCount}
            commentCount={data.commentCount}
            results={results}
            qType={qType}
            proposalId={proposalId}
            slug={slug}
          />
        </SegolifePageContainer>
      </SegolifeAppShell>
    );
  }

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

// ─── COM-02 — Community Social Results ─────────────────────────────────────
// Ficha social de una propuesta FINALIZADA (spec §6): autor, imagen
// protagonista (o fallback de marca si no hay portada, spec §32 — NUNCA una
// foto ficticia), acciones (like/comentarios/compartir), resultado
// destacado (spec §34, generado a partir del `results` REAL ya calculado por
// MG-05 — nunca un algoritmo universal inventado) + el desglose completo
// (PublicResults, reutilizado sin cambios — spec §7, no perder información)
// + preview/acceso a comentarios.

type ProposalAuthor = { userId: number; name: string | null; hasAvatar: boolean } | null;

function SocialProposalView({ proposal, author, liked, likeCount, commentCount, results, qType, proposalId, slug }: {
  proposal: { title: string; description: string | null; coverImageUrl: string | null; venueName: string | null; endsAt: Date | string | null };
  author: ProposalAuthor;
  liked: boolean;
  likeCount: number;
  commentCount: number;
  results: any;
  qType: QuestionType;
  proposalId: number;
  slug: string | null;
}) {
  const { t, i18n } = useTranslation();
  const utils = trpc.useUtils();
  const [commentsOpen, setCommentsOpen] = useState(false);

  const likeMut = trpc.community.toggleLike.useMutation({
    onMutate: async () => {
      await utils.community.getPublicById.cancel({ id: proposalId });
      const prev = utils.community.getPublicById.getData({ id: proposalId });
      if (prev) {
        utils.community.getPublicById.setData({ id: proposalId }, {
          ...prev, liked: !prev.liked, likeCount: prev.liked ? prev.likeCount - 1 : prev.likeCount + 1,
        });
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) utils.community.getPublicById.setData({ id: proposalId }, ctx.prev);
      toast.error(err.message);
    },
    onSettled: () => utils.community.getPublicById.invalidate({ id: proposalId }),
  });

  const headline = resultHeadline(t, qType, results);
  const authorName = author?.name ?? t("comunity.social.brandAuthor");
  const authorSubtitle = author ? relativeTimeLabel(proposal.endsAt ?? new Date(), i18n.language) : t("comunity.social.adminCreated");

  const handleShare = async () => {
    const url = `${window.location.origin}/${slug}/comunity/${proposalId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: proposal.title, url });
      } catch {
        // El usuario canceló el share sheet — no es un error a reportar.
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    toast.success(t("comunity.social.linkCopied"));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar className="size-11">
          {author?.hasAvatar && <img src={`/api/community/proposals/${proposalId}/respondents/${author.userId}/photo`} alt="" className="size-full object-cover" />}
          <AvatarFallback className={author ? "text-sm" : "bg-primary text-primary-foreground text-sm font-bold"}>
            {author ? initials(author.name) : "S"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{authorName}</p>
          <p className="text-xs text-muted-foreground">{authorSubtitle}</p>
        </div>
      </div>

      {proposal.coverImageUrl ? (
        <img src={proposal.coverImageUrl} alt="" className="aspect-square w-full rounded-2xl object-cover sm:aspect-video" loading="lazy" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 via-accent/10 to-primary/5 p-6 text-center sm:aspect-video">
          <p className="text-lg font-bold text-foreground">{proposal.title}</p>
        </div>
      )}

      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={() => likeMut.mutate({ proposalId })}
          disabled={likeMut.isPending}
          className="flex items-center gap-1.5"
          aria-label={t("comunity.social.like")}
          aria-pressed={liked}
        >
          <Heart className={`size-6 ${liked ? "fill-destructive text-destructive" : "text-foreground"}`} />
          {likeCount > 0 && <span className="text-sm tabular-nums text-muted-foreground">{likeCount}</span>}
        </button>
        <button type="button" onClick={() => setCommentsOpen(true)} className="flex items-center gap-1.5" aria-label={t("comunity.social.comments")}>
          <MessageCircle className="size-6 text-foreground" />
          {commentCount > 0 && <span className="text-sm tabular-nums text-muted-foreground">{commentCount}</span>}
        </button>
        <button type="button" onClick={handleShare} className="ml-auto flex items-center gap-1.5" aria-label={t("comunity.social.share")}>
          <Share2 className="size-6 text-foreground" />
        </button>
      </div>

      {headline && <p className="text-lg font-bold text-foreground">{headline}</p>}

      <div>
        <p className="font-semibold text-foreground">{proposal.title}</p>
        {proposal.description && <p className="mt-1 text-sm text-muted-foreground">{proposal.description}</p>}
        {proposal.venueName && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3.5" /> {proposal.venueName}</p>
        )}
      </div>

      {results && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-3 text-sm font-semibold text-foreground">{t("comunity.results")} ({results.totalResponses})</p>
          <PublicResults qType={qType} results={results} proposalId={proposalId} />
        </div>
      )}

      <button type="button" onClick={() => setCommentsOpen(true)} className="text-left text-sm text-muted-foreground hover:text-foreground">
        {commentCount > 0 ? t("comunity.social.viewAllComments", { count: commentCount }) : t("comunity.social.beFirstToComment")}
      </button>

      <CommentsSheet proposalId={proposalId} open={commentsOpen} onOpenChange={setCommentsOpen} />
    </div>
  );
}

// ─── Comentarios (spec §10-23) ──────────────────────────────────────────────

interface CommentAuthorShape { userId: number; name: string | null; hasAvatar: boolean }
interface CommentShape {
  id: number; proposalId: number; content: string; createdAt: Date | string; isOwn: boolean;
  author: CommentAuthorShape; replies: CommentShape[];
}

function CommentsSheet({ proposalId, open, onOpenChange }: { proposalId: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: number; authorName: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const { data, isLoading } = trpc.community.listComments.useQuery({ proposalId, limit: 30, offset: 0 }, { enabled: open });

  const invalidateAll = () => {
    utils.community.listComments.invalidate({ proposalId });
    utils.community.getPublicById.invalidate({ id: proposalId });
  };

  const createMut = trpc.community.createComment.useMutation({
    onSuccess: () => { setContent(""); setReplyTo(null); invalidateAll(); },
    onError: e => toast.error(e.message),
  });
  const deleteMut = trpc.community.deleteComment.useMutation({
    onSuccess: () => { toast.success(t("comunity.social.commentDeleted")); setConfirmDeleteId(null); invalidateAll(); },
    onError: e => toast.error(e.message),
  });

  const items = (data?.items ?? []) as CommentShape[];

  const submit = () => {
    const trimmed = content.trim();
    // Doble-click/doble-submit (spec §14) — createMut.isPending ya bloquea un segundo envío mientras el primero sigue en vuelo.
    if (!trimmed || createMut.isPending) return;
    createMut.mutate({ proposalId, content: trimmed, parentCommentId: replyTo?.id });
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="flex h-[85vh] flex-col p-0 sm:mx-auto sm:max-w-lg">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle>{t("comunity.social.commentsTitle")}{data ? ` (${data.total})` : ""}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
                <MessageCircle className="size-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">{t("comunity.social.noCommentsYet")}</p>
                <p className="text-xs text-muted-foreground">{t("comunity.social.beFirstToComment")}</p>
              </div>
            ) : (
              items.map(c => (
                <div key={c.id} className="space-y-3">
                  <CommentRow comment={c} onReply={() => setReplyTo({ id: c.id, authorName: c.author.name ?? t("comunity.someone") })} onDelete={() => setConfirmDeleteId(c.id)} />
                  {c.replies.map(r => (
                    <div key={r.id} className="ml-9 border-l-2 border-border pl-3">
                      <CommentRow comment={r} onDelete={() => setConfirmDeleteId(r.id)} />
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border p-3">
            {replyTo && (
              <div className="mb-2 flex items-center justify-between rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground">
                <span>{t("comunity.social.reply")}: {replyTo.authorName}</span>
                <button type="button" onClick={() => setReplyTo(null)} aria-label={t("common.cancel")}><X className="size-3.5" /></button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                rows={1}
                value={content}
                onChange={e => setContent(e.target.value)}
                maxLength={1000}
                placeholder={t("comunity.social.writeComment")}
                aria-label={t("comunity.social.writeComment")}
                className="min-h-0 resize-none"
              />
              <Button size="sm" disabled={!content.trim() || createMut.isPending} onClick={submit}>
                {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : t("comunity.social.post")}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={confirmDeleteId != null} onOpenChange={v => !v && setConfirmDeleteId(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>{t("comunity.social.confirmDeleteComment")}</DialogTitle></DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>{t("common.cancel")}</Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => confirmDeleteId != null && deleteMut.mutate({ commentId: confirmDeleteId })}
            >
              {deleteMut.isPending ? <Loader2 className="size-4 animate-spin" /> : t("comunity.social.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CommentRow({ comment, onReply, onDelete }: { comment: CommentShape; onReply?: () => void; onDelete: () => void }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex gap-2.5">
      <Avatar className="size-8 shrink-0">
        {comment.author.hasAvatar && <img src={`/api/community/proposals/${comment.proposalId}/respondents/${comment.author.userId}/photo`} alt="" className="size-full object-cover" />}
        <AvatarFallback className="text-xs">{initials(comment.author.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-semibold text-foreground">{comment.author.name ?? t("comunity.someone")}</span>{" "}
          <span className="text-foreground">{comment.content}</span>
        </p>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{relativeTimeLabel(comment.createdAt, i18n.language)}</span>
          {onReply && <button type="button" onClick={onReply} className="font-medium hover:text-foreground">{t("comunity.social.reply")}</button>}
          {comment.isOwn && <button type="button" onClick={onDelete} className="font-medium hover:text-destructive">{t("comunity.social.delete")}</button>}
        </div>
      </div>
    </div>
  );
}
