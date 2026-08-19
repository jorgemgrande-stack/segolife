import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useCommunity } from "@/contexts/CommunityContext";
import { trpc } from "@/lib/trpc";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Vote, Coins, Heart, Loader2, Send, Flame } from "lucide-react";
import { type ComunityQuestionType } from "@/lib/comunity";

/**
 * Hub de COMUNITY — /:community/comunity (spec puntos 22-23). Secciones
 * ACTIVAS/RESPONDIDAS/RESULTADOS/PROPONER como pestañas de una sola pantalla
 * (nunca un formulario administrativo — social y rápido, spec punto 84).
 *
 * Fase 16 (auditoría) — esta página estaba enteramente en español
 * hardcodeado, sin useTranslation en absoluto, pese a que /ie (defaultLocale
 * "en") depende del mismo mecanismo i18n que el resto de la Student App. Usa
 * un namespace `comunity.*` propio (nunca los labels de lib/comunity.ts, que
 * siguen siendo español fijo a propósito — se comparten con las pantallas de
 * Admin, que no son bilingües).
 */
export default function ComunityHub() {
  const { t } = useTranslation();
  const { slug } = useCommunity();

  return (
    <SegolifeAppShell requireAuth title="Comunity">
      <SegolifePageContainer className="space-y-4">
        <div className="flex items-center gap-2">
          <Vote className="size-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Comunity</h1>
        </div>

        <Tabs defaultValue="activas">
          <TabsList className="w-full">
            <TabsTrigger value="activas" className="flex-1">{t("comunity.tabActive")}</TabsTrigger>
            <TabsTrigger value="respondidas" className="flex-1">{t("comunity.tabResponded")}</TabsTrigger>
            <TabsTrigger value="resultados" className="flex-1">{t("comunity.tabResults")}</TabsTrigger>
            <TabsTrigger value="proponer" className="flex-1">{t("comunity.tabPropose")}</TabsTrigger>
          </TabsList>

          <TabsContent value="activas" className="mt-4"><ActivasTab slug={slug!} /></TabsContent>
          <TabsContent value="respondidas" className="mt-4"><RespondidasTab slug={slug!} /></TabsContent>
          <TabsContent value="resultados" className="mt-4"><ResultadosTab slug={slug!} /></TabsContent>
          <TabsContent value="proponer" className="mt-4"><ProponerTab /></TabsContent>
        </Tabs>
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}

/** Traducción de QUESTION_TYPE_LABEL (lib/comunity.ts es español fijo, compartido con Admin). */
function questionTypeLabel(t: TFunction, type: ComunityQuestionType): string {
  return t(`comunity.questionType.${type}`);
}

/** Cuenta atrás compacta traducida — misma lógica que lib/comunity.ts:timeLeftLabel, versión i18n (Admin sigue usando la fija en español). */
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

// ─── ACTIVAS ─────────────────────────────────────────────────────────────

function ActivasTab({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const { community } = useCommunity();
  const { data, isLoading } = trpc.community.myActive.useQuery();
  const utils = trpc.useUtils();
  const respondMut = trpc.community.respond.useMutation({
    onSuccess: () => { toast.success(t("comunity.voteRegistered")); utils.community.myActive.invalidate(); utils.community.myResponded.invalidate(); },
    onError: e => toast.error(e.message),
  });

  // SEGOTOKENS REWARD PREVIEW (Fase 10.6) — la regla COMMUNITY_RESPONSE es
  // global (no varía por propuesta), así que UNA sola previsualización sirve
  // para toda la lista — nunca se usa `proposal.tokenReward` (campo legacy,
  // ver communityResponseService.ts: "el importe YA NO lo decide ese campo",
  // mostrarlo podía ser directamente distinto de lo que se acaba concediendo).
  const rewardQ = trpc.tokens.previewMyReward.useQuery(
    { origin: "community_response", communityId: community?.id },
    { enabled: !!community?.id }
  );
  const responseReward = rewardQ.data?.totalGuaranteedTokens ?? 0;

  if (isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (!data || data.length === 0) {
    return <SegolifeEmptyState icon={<Vote className="size-6" />} title={t("comunity.noActiveQuestions")} description={t("comunity.noActiveQuestionsDescription")} />;
  }

  return (
    <div className="space-y-3">
      {data.map(p => (
        <div key={p.id} className="rounded-2xl border border-border bg-card p-4 segolife-card-shadow">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                {p.urgencyType === "flash" && <span className="text-xs font-bold text-amber-500">⚡ FLASH</span>}
                <p className="font-semibold text-foreground truncate">{p.title}</p>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">⏳ {timeLeftLabelI18n(t, p.endsAt)} · {questionTypeLabel(t, p.questionType as ComunityQuestionType)}</p>
            </div>
            {responseReward > 0 && <span className="flex items-center gap-1 text-xs font-medium text-primary shrink-0"><Coins className="size-3.5" />+{responseReward}</span>}
          </div>

          {/* Respuesta rápida desde la card (spec punto 24) — solo tipos seguros sin abrir detalle */}
          {p.questionType === "yes_no" ? (
            <div className="mt-3 flex gap-2">
              <Button size="sm" className="flex-1" variant="outline" disabled={respondMut.isPending} onClick={() => respondMut.mutate({ proposalId: p.id, payload: { questionType: "yes_no", value: "yes" } })}>{t("comunity.yes")}</Button>
              <Button size="sm" className="flex-1" variant="outline" disabled={respondMut.isPending} onClick={() => respondMut.mutate({ proposalId: p.id, payload: { questionType: "yes_no", value: "no" } })}>{t("comunity.no")}</Button>
            </div>
          ) : p.questionType === "me_apunto" ? (
            <Button size="sm" className="w-full mt-3" disabled={respondMut.isPending} onClick={() => respondMut.mutate({ proposalId: p.id, payload: { questionType: "me_apunto" } })}>{t("comunity.imIn")}</Button>
          ) : (
            <Link href={`/${slug}/comunity/${p.id}`}><Button size="sm" variant="outline" className="w-full mt-3">{t("comunity.respond")}</Button></Link>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── RESPONDIDAS / RESULTADOS ───────────────────────────────────────────────

function RespondidasTab({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = trpc.community.myResponded.useQuery();
  if (isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (!data || data.length === 0) {
    return <SegolifeEmptyState icon={<Vote className="size-6" />} title={t("comunity.notRespondedYet")} />;
  }
  return <ProposalLinkList slug={slug} items={data} />;
}

function ResultadosTab({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = trpc.community.myResponded.useQuery();
  const closed = (data ?? []).filter(p => p.status === "closed");
  if (isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (closed.length === 0) {
    return <SegolifeEmptyState icon={<Vote className="size-6" />} title={t("comunity.noResultsYet")} description={t("comunity.noResultsYetDescription")} />;
  }
  return <ProposalLinkList slug={slug} items={closed} />;
}

function ProposalLinkList({ slug, items }: { slug: string; items: { id: number; title: string; questionType: string; endsAt: Date | string | null; status: string }[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {items.map(p => (
        <Link key={p.id} href={`/${slug}/comunity/${p.id}`} className="block rounded-xl border border-border bg-card px-4 py-3 hover:bg-accent/50">
          <p className="text-sm font-medium text-foreground">{p.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{questionTypeLabel(t, p.questionType as ComunityQuestionType)} · {p.status === "closed" ? t("comunity.statusClosed") : t("comunity.statusActive")}</p>
        </Link>
      ))}
    </div>
  );
}

// ─── PROPONER ────────────────────────────────────────────────────────────

/**
 * Community Proposals (backlog) — el formulario Student se acerca al
 * wizard Admin (ComunityWizard.tsx) SOLO en lo que tiene sentido para un
 * usuario final: venue relacionado y "cuándo te gustaría que fuera"
 * (con presets, misma idea que los FLASH_PRESETS de urgencia del wizard
 * Admin, adaptados a una fecha sugerida en vez de un cierre de votación —
 * una idea de Student no tiene ventana de votación, así que "urgencia" se
 * expresa aquí como la propia fecha sugerida). NUNCA comunidad/scope/
 * audiencia/tipo de pregunta/visibilidad de resultados — esos campos son
 * estructuralmente admin-only (encuestas COMUNITY formales, otra tabla).
 * `venueId`/`suggestedDate` ya existían en el backend (submitProposal,
 * communityStudentProposalDb.ts) sin usarse nunca desde el cliente.
 *
 * Imagen de portada: NO se añade esta noche — el propio wizard Admin no
 * tiene subida real (solo un campo de URL con la instrucción "sube en
 * CMS→Multimedia y pega la URL aquí"), así que no hay ningún patrón de
 * subida pública ya construido y accesible para un Student que reutilizar
 * seguro; construir uno nuevo (endpoint público de subida de imágenes)
 * es superficie de abuso/moderación real que merece una decisión propia,
 * no una mejora de una noche. Documentado como BUSINESS DECISION REQUIRED.
 */
function toDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nextWeekendDate(): string {
  const d = new Date();
  const diff = ((6 - d.getDay()) % 7) || 7; // próximo sábado real, nunca "hoy" si hoy ya es sábado
  d.setDate(d.getDate() + diff);
  return toDateOnly(d);
}
function nextWeekDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return toDateOnly(d);
}

function ProponerTab() {
  const { t } = useTranslation();
  const { community } = useCommunity();
  const utils = trpc.useUtils();
  const { data: myProposals } = trpc.community.myProposals.useQuery();
  const { data: trending } = trpc.community.trending.useQuery(community?.id ? { communityId: community.id } : {});
  const { data: venues } = trpc.venues.publicActive.useQuery(community?.id ? { communityId: community.id } : {});

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [venueId, setVenueId] = useState("");
  const [suggestedDate, setSuggestedDate] = useState("");

  function resetForm() {
    setTitle(""); setDescription(""); setVenueId(""); setSuggestedDate("");
  }

  const submitMut = trpc.community.submitProposal.useMutation({
    onSuccess: () => { toast.success(t("comunity.ideaSubmitted")); resetForm(); utils.community.myProposals.invalidate(); },
    onError: e => toast.error(e.message),
  });

  // SEGOTOKENS REWARD PREVIEW (Fase 10.6) — ENVIAR una idea nunca ha
  // concedido nada (sin regla real para ese momento, comprobado en Fase
  // 10.5), así que aquí NUNCA se muestra una recompensa por enviar. Lo que
  // SÍ es real (producción: regla activa id=9, fixed 200 ST) es que tu idea
  // se APRUEBE — se muestra como CONDICIONAL, nunca junto al botón de envío
  // como si fuera garantizada.
  const approvedRewardQ = trpc.tokens.previewMyReward.useQuery(
    { origin: "community_proposal_approved", communityId: community?.id },
    { enabled: !!community?.id }
  );
  const approvedReward = approvedRewardQ.data?.totalGuaranteedTokens ?? 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <p className="text-sm font-semibold text-foreground">{t("comunity.proposeAPlan")}</p>
        <div><Label>{t("comunity.whatDoYouPropose")}</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("comunity.proposePlaceholder")} maxLength={256} /></div>
        <div><Label>{t("comunity.tellUsMore")}</Label><Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} /></div>

        <div>
          <Label className="mb-1.5 block">{t("comunity.relatedVenue")}</Label>
          <Select value={venueId || "none"} onValueChange={v => setVenueId(v === "none" ? "" : v)}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t("comunity.noVenue")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("comunity.noVenue")}</SelectItem>
              {(venues ?? []).map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="mb-1.5 block">{t("comunity.whenWouldYouLike")}</Label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={suggestedDate === nextWeekendDate() ? "default" : "outline"} size="sm" onClick={() => setSuggestedDate(nextWeekendDate())}>
              {t("comunity.thisWeekend")}
            </Button>
            <Button type="button" variant={suggestedDate === nextWeekDate() ? "default" : "outline"} size="sm" onClick={() => setSuggestedDate(nextWeekDate())}>
              {t("comunity.nextWeek")}
            </Button>
            <Input
              type="date"
              value={suggestedDate}
              onChange={e => setSuggestedDate(e.target.value)}
              min={toDateOnly(new Date())}
              className="h-8 w-auto"
              aria-label={t("comunity.customDate")}
            />
            {suggestedDate && (
              <button type="button" onClick={() => setSuggestedDate("")} className="text-xs text-muted-foreground underline">
                {t("comunity.clearDate")}
              </button>
            )}
          </div>
        </div>

        {approvedReward > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Coins className="size-3.5 shrink-0 text-primary" /> {t("comunity.approvedRewardHint", { amount: approvedReward })}
          </p>
        )}
        <Button
          className="w-full"
          disabled={!title.trim() || !community?.id || submitMut.isPending}
          onClick={() => community?.id && submitMut.mutate({
            communityId: community.id,
            title: title.trim(),
            description: description.trim() || null,
            venueId: venueId ? Number(venueId) : null,
            suggestedDate: suggestedDate || null,
          })}
        >
          {submitMut.isPending ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Send className="size-4 mr-1.5" />} {t("comunity.submitIdea")}
        </Button>
      </div>

      {!!trending?.length && (
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground mb-2"><Flame className="size-4 text-accent" /> {t("comunity.trendingNow")}</p>
          <div className="space-y-2">
            {trending.map(idea => <TrendingIdeaRow key={idea.id} idea={idea} />)}
          </div>
        </div>
      )}

      {!!myProposals?.length && (
        <div>
          <p className="text-sm font-semibold text-foreground mb-2">{t("comunity.yourIdeas")}</p>
          <div className="space-y-2">
            {myProposals.map(idea => (
              <div key={idea.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-sm font-medium text-foreground">{idea.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{ideaStatusLabel(t, idea.status)} · {t("comunity.supportCount", { count: idea.supportCount })}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrendingIdeaRow({ idea }: { idea: { id: number; title: string; supportCount: number } }) {
  const utils = trpc.useUtils();
  const { data: hasSupported } = trpc.community.hasSupported.useQuery({ studentProposalId: idea.id });
  const supportMut = trpc.community.support.useMutation({
    onSuccess: () => { utils.community.hasSupported.invalidate({ studentProposalId: idea.id }); utils.community.trending.invalidate(); },
    onError: e => toast.error(e.message),
  });
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-sm font-medium text-foreground truncate">{idea.title}</p>
      <Button
        size="sm"
        variant={hasSupported ? "default" : "outline"}
        disabled={supportMut.isPending}
        onClick={() => supportMut.mutate({ studentProposalId: idea.id })}
        className="shrink-0"
      >
        <Heart className={`size-3.5 mr-1 ${hasSupported ? "fill-current" : ""}`} /> {idea.supportCount}
      </Button>
    </div>
  );
}

function ideaStatusLabel(t: TFunction, status: string): string {
  const known = ["pending_moderation", "approved", "rejected", "scheduled", "active", "closed", "converted"];
  return known.includes(status) ? t(`comunity.ideaStatus.${status}`) : status;
}
