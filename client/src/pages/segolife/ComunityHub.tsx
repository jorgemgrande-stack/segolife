import { useState, useRef, useEffect } from "react";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Vote, Coins, Heart, Loader2, Send, Flame, ImagePlus, X, Plus, MapPin, MessageCircle, Share2 } from "lucide-react";
import { QUESTION_TYPES_WITH_OPTIONS, type ComunityQuestionType } from "@/lib/comunity";
import { initials, relativeTimeLabel, resultHeadline } from "@/lib/comunitySocial";

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

/**
 * Cuenta atrás compacta traducida — misma lógica que lib/comunity.ts:timeLeftLabel,
 * versión i18n (Admin sigue usando la fija en español). `now` es inyectable
 * (F64) para que ActivasTab pueda hacerla tickear en vivo sin refetch —
 * Date.now() como valor por defecto mantiene el comportamiento anterior.
 */
function timeLeftLabelI18n(t: TFunction, endsAt: Date | string | null | undefined, now: number = Date.now()): string {
  if (!endsAt) return t("comunity.timeLeft.noDeadline");
  const diffMs = new Date(endsAt).getTime() - now;
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

  // F64 (Community FLASH 2.0) — cuenta atrás en viva de verdad, no solo
  // texto estático recalculado en el próximo refetch. 15s de resolución:
  // de sobra para ventanas FLASH de minutos/horas, sin recrear el intervalo
  // en cada render. Al llegar a 0 se refresca el feed una vez — el cierre
  // real siempre lo decide el servidor (isProposalOpenForResponses), esto
  // solo evita que el estudiante vea un botón de voto ya inválido.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const seenExpiredRef = useRef(new Set<number>());
  useEffect(() => {
    if (!data) return;
    const newlyExpired = data.filter(p => p.endsAt && new Date(p.endsAt).getTime() <= now && !seenExpiredRef.current.has(p.id));
    if (newlyExpired.length === 0) return;
    newlyExpired.forEach(p => seenExpiredRef.current.add(p.id));
    utils.community.myActive.invalidate();
  }, [data, now, utils]);
  const respondMut = trpc.community.respond.useMutation({
    onSuccess: () => { toast.success(t("comunity.voteRegistered")); utils.community.myActive.invalidate(); utils.community.myResponded.invalidate(); },
    onError: e => {
      // Bugfix "impedir voto múltiple" — un segundo intento (doble click, dos
      // pestañas, carrera) puede llegar aquí como CONFLICT/ALREADY_RESPONDED
      // real del servidor. Refrescar SIEMPRE el feed: la tarjeta se bloqueará
      // sola con el estado real, sin necesidad de un toast redundante para
      // ese caso concreto. domainCode viene del errorFormatter (server/_core/
      // trpc.ts) — nunca string-matching sobre e.message (siempre en español).
      utils.community.myActive.invalidate();
      const domainCode = (e.data as { domainCode?: string } | undefined)?.domainCode;
      if (domainCode === "ALREADY_RESPONDED") return;
      toast.error(domainCode === "CLOSED" ? t("comunity.participationClosed") : t("comunity.participationError"));
    },
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
      {data.map(p => {
        // F64 — expirada en el propio reloj del cliente (antes de que el
        // invalidate de arriba complete el round-trip): el servidor sigue
        // siendo la única fuente de verdad real (isProposalOpenForResponses),
        // esto solo evita ofrecer un botón que el backend ya rechazaría.
        const clientExpired = p.endsAt != null && new Date(p.endsAt).getTime() <= now;
        return (
        <div key={p.id} className="rounded-2xl border border-border bg-card p-4 segolife-card-shadow">
          {/* Hallazgo real (2026-08-22, captura del cliente): yes_no/me_apunto
              respondían directo desde la card y nunca enlazaban al detalle —
              foto, descripción, ubicación y resultados en vivo (resultsVisibility
              "immediate") solo existían ahí, así que ese estudiante nunca los veía
              aunque ya hubiera respondido. Ahora el bloque de info SIEMPRE enlaza
              al detalle, para cualquier tipo de pregunta. */}
          <Link href={`/${slug}/comunity/${p.id}`} className="block">
            <div className="flex items-start gap-3">
              {p.coverImageUrl && <img src={p.coverImageUrl} alt="" className="size-14 shrink-0 rounded-xl object-cover" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {p.urgencyType === "flash" && (
                        <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                          ⚡ FLASH
                        </span>
                      )}
                      <p className="font-semibold text-foreground truncate">{p.title}</p>
                    </div>
                    {p.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{p.description}</p>}
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      <span>⏳ {timeLeftLabelI18n(t, p.endsAt, now)} · {questionTypeLabel(t, p.questionType as ComunityQuestionType)}</span>
                      {p.venueName && <span className="flex items-center gap-0.5">· <MapPin className="size-3" /> {p.venueName}</span>}
                    </p>
                  </div>
                  {responseReward > 0 && <span className="flex items-center gap-1 text-xs font-medium text-primary shrink-0"><Coins className="size-3.5" />+{responseReward}</span>}
                </div>
              </div>
            </div>
          </Link>

          {/* Respuesta rápida desde la card (spec punto 24) — solo tipos seguros sin abrir detalle.
              Bugfix "impedir voto múltiple" (2026-08-22): `p.locked` viene YA calculado por el
              servidor (myActive, community.ts — misma regla que submitResponse()/
              canStudentRespondAgain, nunca una copia divergente aquí). Una vez bloqueada, la
              tarjeta deja de ser una acción disponible: sin onClick, `disabled` real (no solo
              visual) y `aria-disabled` explícito — nunca se oculta el botón sin informar. */}
          {clientExpired ? (
            <Button size="sm" className="w-full mt-3" variant="secondary" disabled aria-disabled="true">{t("comunity.participationClosed")}</Button>
          ) : p.questionType === "yes_no" ? (
            p.locked ? (
              <Button size="sm" className="w-full mt-3" variant="secondary" disabled aria-disabled="true">{t("comunity.alreadyAnswered")}</Button>
            ) : (
              <div className="mt-3 flex gap-2">
                <Button size="sm" className="flex-1" variant="outline" disabled={respondMut.isPending} onClick={() => respondMut.mutate({ proposalId: p.id, payload: { questionType: "yes_no", value: "yes" } })}>{t("comunity.yes")}</Button>
                <Button size="sm" className="flex-1" variant="outline" disabled={respondMut.isPending} onClick={() => respondMut.mutate({ proposalId: p.id, payload: { questionType: "yes_no", value: "no" } })}>{t("comunity.no")}</Button>
              </div>
            )
          ) : p.questionType === "me_apunto" ? (
            p.locked ? (
              <Button size="sm" className="w-full mt-3" variant="secondary" disabled aria-disabled="true">{t("comunity.alreadyJoined")}</Button>
            ) : (
              <Button size="sm" className="w-full mt-3" disabled={respondMut.isPending} onClick={() => respondMut.mutate({ proposalId: p.id, payload: { questionType: "me_apunto" } })}>{t("comunity.imIn")}</Button>
            )
          ) : (
            <Link href={`/${slug}/comunity/${p.id}`}><Button size="sm" variant="outline" className="w-full mt-3">{t("comunity.respond")}</Button></Link>
          )}
        </div>
        );
      })}
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

/**
 * COM-02 — Community Social Results (spec §5): feed de propuestas
 * finalizadas consumible como contenido social, especialmente en mobile.
 * Reutiliza community.listResultsFeed (mismo conjunto base que myResponded,
 * filtrado server-side a status="closed" — nunca un estado nuevo, spec §4).
 */
function ResultadosTab({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = trpc.community.listResultsFeed.useQuery();
  if (isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (!data || data.length === 0) {
    return <SegolifeEmptyState icon={<Vote className="size-6" />} title={t("comunity.noResultsYet")} description={t("comunity.noResultsYetDescription")} />;
  }
  return (
    <div className="space-y-3">
      {data.map(item => <ResultFeedCard key={item.proposal.id} slug={slug} item={item} />)}
    </div>
  );
}

function ResultFeedCard({ slug, item }: { slug: string; item: {
  proposal: { id: number; title: string; coverImageUrl: string | null; venueName: string | null; endsAt: Date | string | null; questionType: string };
  author: { userId: number; name: string | null; hasAvatar: boolean } | null;
  results: any;
  likeCount: number;
  commentCount: number;
  shareCount: number;
} }) {
  const { t, i18n } = useTranslation();
  const { proposal, author, results } = item;
  const qType = proposal.questionType as ComunityQuestionType;
  const authorName = author?.name ?? t("comunity.social.brandAuthor");
  const headline = resultHeadline(t, qType, results);

  return (
    <Link
      href={`/${slug}/comunity/${proposal.id}`}
      className="segolife-card-shadow block overflow-hidden rounded-2xl bg-card"
    >
      {proposal.coverImageUrl ? (
        <img src={proposal.coverImageUrl} alt="" className="aspect-video w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-gradient-to-br from-primary/20 via-accent/10 to-primary/5 p-4 text-center">
          <p className="line-clamp-2 font-semibold text-foreground">{proposal.title}</p>
        </div>
      )}
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <Avatar className="size-6 shrink-0">
            {author?.hasAvatar && <img src={`/api/community/proposals/${proposal.id}/respondents/${author.userId}/photo`} alt="" className="size-full object-cover" />}
            <AvatarFallback className={author ? "text-[10px]" : "bg-primary text-[10px] font-bold text-primary-foreground"}>
              {author ? initials(author.name) : "S"}
            </AvatarFallback>
          </Avatar>
          <p className="truncate text-xs font-medium text-foreground">{authorName}</p>
          <span className="shrink-0 text-xs text-muted-foreground">· {relativeTimeLabel(proposal.endsAt ?? new Date(), i18n.language)}</span>
        </div>

        <p className="text-sm font-semibold text-foreground">{proposal.title}</p>
        {proposal.venueName && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" /> {proposal.venueName}</p>
        )}
        {headline && <p className="text-sm font-medium text-primary">{headline}</p>}

        <div className="flex items-center gap-4 pt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Heart className="size-3.5" /> {item.likeCount}</span>
          <span className="flex items-center gap-1"><MessageCircle className="size-3.5" /> {item.commentCount}</span>
          <span className="flex items-center gap-1"><Share2 className="size-3.5" /> {item.shareCount}</span>
        </div>
      </div>
    </Link>
  );
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
 * MG-04 — Community Proposals 2.0 (autorización de producto explícita):
 * imagen de portada PÚBLICA (sube vía POST /api/community/proposal-image
 * ANTES de enviar el formulario — mismo criterio REST-multipart que la
 * foto de perfil de MG-03, communityProposalImageService.ts reutiliza el
 * MISMO nivel de validación real con sharp() pero con storagePut PÚBLICO,
 * nunca el storage privado del avatar) y urgencia/preferencia temporal del
 * Student (3 niveles simples, nunca la prioridad administrativa interna de
 * community_proposals.urgencyType — tabla y concepto distintos).
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

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
type ProposalUrgency = "no_rush" | "soon" | "urgent";
const URGENCY_OPTIONS: { value: ProposalUrgency; key: string }[] = [
  { value: "no_rush", key: "comunity.urgencyNoRush" },
  { value: "soon", key: "comunity.urgencySoon" },
  { value: "urgent", key: "comunity.urgencyUrgent" },
];

// MG-05 — Student Proposal Voting Configuration. MISMOS 9 tipos que el
// motor canónico de Admin (comunity.questionType, ver
// server/segolife/community/communityQuestionTypeValidation.ts) — nunca un
// tipo nuevo inventado aquí. "none" es un valor de UI puro (no se envía al
// servidor) que representa "no quiero proponer nada" — proponer
// configuración de voto es siempre opcional para el Student.
const VOTING_TYPE_NONE = "none" as const;
const ALL_QUESTION_TYPES: ComunityQuestionType[] = [
  "single_choice", "yes_no", "percentage_scale", "scale_1_5",
  "multiselect", "ranking", "attendance_intention", "me_apunto", "open_text",
];
const MIN_VOTING_OPTIONS = 2;
const MAX_VOTING_OPTIONS = 20;

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
  const [urgency, setUrgency] = useState<ProposalUrgency | "">("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // MG-05 — configuración de voto propuesta (opcional).
  const [votingType, setVotingType] = useState<ComunityQuestionType | typeof VOTING_TYPE_NONE>(VOTING_TYPE_NONE);
  const [votingOptions, setVotingOptions] = useState<string[]>(["", ""]);
  const votingNeedsOptions = votingType !== VOTING_TYPE_NONE && QUESTION_TYPES_WITH_OPTIONS.includes(votingType);
  const cleanVotingOptions = votingOptions.map(o => o.trim()).filter(Boolean);
  const votingOptionsValid = !votingNeedsOptions || cleanVotingOptions.length >= MIN_VOTING_OPTIONS;

  function resetForm() {
    setTitle(""); setDescription(""); setVenueId(""); setSuggestedDate(""); setUrgency(""); setCoverImageUrl("");
    setVotingType(VOTING_TYPE_NONE); setVotingOptions(["", ""]);
  }

  async function handleImageSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-seleccionar el mismo archivo dos veces seguidas
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) { toast.error(t("comunity.imageInvalidType")); return; }
    if (file.size > MAX_IMAGE_BYTES) { toast.error(t("comunity.imageTooLarge")); return; }

    setImageUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/community/proposal-image", { method: "POST", credentials: "include", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "upload_failed");
      }
      const body = await res.json();
      setCoverImageUrl(body.url);
    } catch {
      toast.error(t("comunity.imageUploadError"));
    } finally {
      setImageUploading(false);
    }
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
          <Label className="mb-1.5 block">{t("comunity.coverImage")}</Label>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp" className="hidden" onChange={handleImageSelected} />
          {coverImageUrl ? (
            <div className="relative inline-block">
              <img src={coverImageUrl} alt="" className="h-28 w-full max-w-xs rounded-xl object-cover" />
              <button
                type="button"
                onClick={() => setCoverImageUrl("")}
                aria-label={t("comunity.removeImage")}
                className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled={imageUploading} onClick={() => fileInputRef.current?.click()}>
              {imageUploading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <ImagePlus className="size-3.5 mr-1.5" />}
              {t("comunity.addImage")}
            </Button>
          )}
        </div>

        <div>
          <Label className="mb-1.5 block">{t("comunity.urgencyLabel")}</Label>
          <div className="flex flex-wrap gap-2">
            {URGENCY_OPTIONS.map(opt => (
              <Button
                key={opt.value}
                type="button"
                variant={urgency === opt.value ? "default" : "outline"}
                size="sm"
                onClick={() => setUrgency(u => u === opt.value ? "" : opt.value)}
              >
                {t(opt.key)}
              </Button>
            ))}
          </div>
        </div>

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

        {/* MG-05 — configuración de voto propuesta (opcional). El Student PROPONE, el Admin decide. */}
        <div>
          <Label className="mb-1.5 block">{t("comunity.votingLabel")}</Label>
          <p className="mb-1.5 text-xs text-muted-foreground">{t("comunity.votingHint")}</p>
          <Select
            value={votingType}
            onValueChange={v => { setVotingType(v as ComunityQuestionType | typeof VOTING_TYPE_NONE); setVotingOptions(["", ""]); }}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={VOTING_TYPE_NONE}>{t("comunity.votingNone")}</SelectItem>
              {ALL_QUESTION_TYPES.map(type => (
                <SelectItem key={type} value={type}>{questionTypeLabel(t, type)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {votingNeedsOptions && (
            <div className="mt-2">
              <Label className="mb-1.5 block text-xs">
                {t(votingType === "percentage_scale" ? "comunity.votingOptionsLabelScale" : "comunity.votingOptionsLabel")}
              </Label>
              <div className="space-y-2">
                {votingOptions.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={opt}
                      onChange={e => setVotingOptions(o => o.map((x, j) => j === i ? e.target.value : x))}
                      placeholder={t("comunity.votingOptionPlaceholder", { n: i + 1 })}
                      maxLength={256}
                    />
                    {votingOptions.length > MIN_VOTING_OPTIONS && (
                      <button
                        type="button"
                        onClick={() => setVotingOptions(o => o.filter((_, j) => j !== i))}
                        aria-label={t("comunity.votingRemoveOption", { n: i + 1 })}
                        className="p-1.5 text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {votingOptions.length < MAX_VOTING_OPTIONS && (
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setVotingOptions(o => [...o, ""])}>
                  <Plus className="size-3.5 mr-1" /> {t("comunity.votingAddOption")}
                </Button>
              )}
              {!votingOptionsValid && <p className="mt-1.5 text-xs text-destructive">{t("comunity.votingMinOptionsError")}</p>}
            </div>
          )}
        </div>

        {approvedReward > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Coins className="size-3.5 shrink-0 text-primary" /> {t("comunity.approvedRewardHint", { amount: approvedReward })}
          </p>
        )}
        <Button
          className="w-full"
          disabled={!title.trim() || !community?.id || submitMut.isPending || imageUploading || !votingOptionsValid}
          onClick={() => community?.id && submitMut.mutate({
            communityId: community.id,
            title: title.trim(),
            description: description.trim() || null,
            venueId: venueId ? Number(venueId) : null,
            suggestedDate: suggestedDate || null,
            coverImageUrl: coverImageUrl || null,
            urgency: urgency || null,
            proposedQuestionType: votingType === VOTING_TYPE_NONE ? undefined : votingType,
            proposedOptions: votingNeedsOptions ? cleanVotingOptions : undefined,
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
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                  {/* Antes solo texto plano — una idea aprobada se veía igual que una en revisión, fácil de leer como "sigue sin resolver". */}
                  <span className={`rounded-full px-1.5 py-0.5 font-medium ${ideaStatusStyle(idea.status)}`}>
                    {ideaStatusLabel(t, idea.status)}
                  </span>
                  <span>· {t("comunity.supportCount", { count: idea.supportCount })}</span>
                  {/* MG-05 §18 — claridad ante todo: solo la línea de resumen, nunca la lista completa de opciones en la tarjeta compacta. */}
                  {idea.proposedQuestionType && <span>· {t("comunity.votingSummary", { type: questionTypeLabel(t, idea.proposedQuestionType as ComunityQuestionType) })}</span>}
                </div>
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

/** Color por status — antes toda idea (aprobada, rechazada, en revisión...) llevaba el mismo texto gris plano, indistinguible a simple vista. */
function ideaStatusStyle(status: string): string {
  switch (status) {
    case "rejected":
      return "bg-destructive/10 text-destructive";
    case "pending_moderation":
    case "closed":
      return "bg-secondary text-muted-foreground";
    case "converted":
      return "bg-accent/15 text-accent";
    case "approved":
    case "scheduled":
    case "active":
    default:
      return "bg-primary/15 text-primary";
  }
}
