import { useState } from "react";
import { Link } from "wouter";
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
import { toast } from "sonner";
import { Vote, Coins, Heart, Loader2, Send, Flame } from "lucide-react";
import { timeLeftLabel, QUESTION_TYPE_LABEL, type ComunityQuestionType } from "@/lib/comunity";

/**
 * Hub de COMUNITY — /:community/comunity (spec puntos 22-23). Secciones
 * ACTIVAS/RESPONDIDAS/RESULTADOS/PROPONER como pestañas de una sola pantalla
 * (nunca un formulario administrativo — social y rápido, spec punto 84).
 */
export default function ComunityHub() {
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
            <TabsTrigger value="activas" className="flex-1">Activas</TabsTrigger>
            <TabsTrigger value="respondidas" className="flex-1">Respondidas</TabsTrigger>
            <TabsTrigger value="resultados" className="flex-1">Resultados</TabsTrigger>
            <TabsTrigger value="proponer" className="flex-1">Proponer</TabsTrigger>
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

// ─── ACTIVAS ─────────────────────────────────────────────────────────────

function ActivasTab({ slug }: { slug: string }) {
  const { community } = useCommunity();
  const { data, isLoading } = trpc.community.myActive.useQuery();
  const utils = trpc.useUtils();
  const respondMut = trpc.community.respond.useMutation({
    onSuccess: () => { toast.success("¡Voto registrado!"); utils.community.myActive.invalidate(); utils.community.myResponded.invalidate(); },
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
    return <SegolifeEmptyState icon={<Vote className="size-6" />} title="Sin preguntas activas ahora mismo" description="Vuelve más tarde o propón tú un plan." />;
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
              <p className="text-xs text-muted-foreground mt-0.5">⏳ {timeLeftLabel(p.endsAt)} · {QUESTION_TYPE_LABEL[p.questionType as ComunityQuestionType]}</p>
            </div>
            {responseReward > 0 && <span className="flex items-center gap-1 text-xs font-medium text-primary shrink-0"><Coins className="size-3.5" />+{responseReward}</span>}
          </div>

          {/* Respuesta rápida desde la card (spec punto 24) — solo tipos seguros sin abrir detalle */}
          {p.questionType === "yes_no" ? (
            <div className="mt-3 flex gap-2">
              <Button size="sm" className="flex-1" variant="outline" disabled={respondMut.isPending} onClick={() => respondMut.mutate({ proposalId: p.id, payload: { questionType: "yes_no", value: "yes" } })}>👍 Sí</Button>
              <Button size="sm" className="flex-1" variant="outline" disabled={respondMut.isPending} onClick={() => respondMut.mutate({ proposalId: p.id, payload: { questionType: "yes_no", value: "no" } })}>👎 No</Button>
            </div>
          ) : p.questionType === "me_apunto" ? (
            <Button size="sm" className="w-full mt-3" disabled={respondMut.isPending} onClick={() => respondMut.mutate({ proposalId: p.id, payload: { questionType: "me_apunto" } })}>🙋 Me apunto</Button>
          ) : (
            <Link href={`/${slug}/comunity/${p.id}`}><Button size="sm" variant="outline" className="w-full mt-3">Responder →</Button></Link>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── RESPONDIDAS / RESULTADOS ───────────────────────────────────────────────

function RespondidasTab({ slug }: { slug: string }) {
  const { data, isLoading } = trpc.community.myResponded.useQuery();
  if (isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (!data || data.length === 0) {
    return <SegolifeEmptyState icon={<Vote className="size-6" />} title="Todavía no has respondido nada" />;
  }
  return <ProposalLinkList slug={slug} items={data} />;
}

function ResultadosTab({ slug }: { slug: string }) {
  const { data, isLoading } = trpc.community.myResponded.useQuery();
  const closed = (data ?? []).filter(p => p.status === "closed");
  if (isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (closed.length === 0) {
    return <SegolifeEmptyState icon={<Vote className="size-6" />} title="Sin resultados cerrados todavía" description="Aquí verás los resultados finales de lo que ya has votado." />;
  }
  return <ProposalLinkList slug={slug} items={closed} />;
}

function ProposalLinkList({ slug, items }: { slug: string; items: { id: number; title: string; questionType: string; endsAt: Date | string | null; status: string }[] }) {
  return (
    <div className="space-y-2">
      {items.map(p => (
        <Link key={p.id} href={`/${slug}/comunity/${p.id}`} className="block rounded-xl border border-border bg-card px-4 py-3 hover:bg-accent/50">
          <p className="text-sm font-medium text-foreground">{p.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{QUESTION_TYPE_LABEL[p.questionType as ComunityQuestionType]} · {p.status === "closed" ? "Cerrada" : "Activa"}</p>
        </Link>
      ))}
    </div>
  );
}

// ─── PROPONER ────────────────────────────────────────────────────────────

function ProponerTab() {
  const { community } = useCommunity();
  const utils = trpc.useUtils();
  const { data: myProposals } = trpc.community.myProposals.useQuery();
  const { data: trending } = trpc.community.trending.useQuery(community?.id ? { communityId: community.id } : {});

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const submitMut = trpc.community.submitProposal.useMutation({
    onSuccess: () => { toast.success("Idea enviada — la revisará el equipo antes de publicarla"); setTitle(""); setDescription(""); utils.community.myProposals.invalidate(); },
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
        <p className="text-sm font-semibold text-foreground">Propón un plan</p>
        <div><Label>¿Qué propones? *</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ej: Torneo de pádel entre comunidades" maxLength={256} /></div>
        <div><Label>Cuéntanos más (opcional)</Label><Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} /></div>
        {approvedReward > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Coins className="size-3.5 shrink-0 text-primary" /> Si tu idea se aprueba, ganas +{approvedReward} ST
          </p>
        )}
        <Button
          className="w-full"
          disabled={!title.trim() || !community?.id || submitMut.isPending}
          onClick={() => community?.id && submitMut.mutate({ communityId: community.id, title: title.trim(), description: description.trim() || null })}
        >
          {submitMut.isPending ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Send className="size-4 mr-1.5" />} Enviar idea
        </Button>
      </div>

      {!!trending?.length && (
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground mb-2"><Flame className="size-4 text-accent" /> Tendencia ahora</p>
          <div className="space-y-2">
            {trending.map(idea => <TrendingIdeaRow key={idea.id} idea={idea} />)}
          </div>
        </div>
      )}

      {!!myProposals?.length && (
        <div>
          <p className="text-sm font-semibold text-foreground mb-2">Tus ideas</p>
          <div className="space-y-2">
            {myProposals.map(idea => (
              <div key={idea.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-sm font-medium text-foreground">{idea.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{ideaStatusLabel(idea.status)} · {idea.supportCount} apoyo(s)</p>
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

function ideaStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending_moderation: "En revisión", approved: "Aprobada", rejected: "No aprobada",
    scheduled: "Programada", active: "Activa", closed: "Cerrada", converted: "¡Convertida en pregunta!",
  };
  return labels[status] ?? status;
}
