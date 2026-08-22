/**
 * EconomyControlCenter.tsx — SEGOLIFE FASE 10.5. Superficie de GOBIERNO
 * sobre los motores económicos ya existentes (Reglas/Campañas/Políticas de
 * canje/Referidos/Marketplace, cada uno con su propio admin ya construido)
 * — esta pantalla explica y orquesta, nunca duplica esos formularios CRUD.
 */
import { useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Coins, TrendingUp, TrendingDown, AlertTriangle, ShieldAlert, Info, ArrowRight, Gift } from "lucide-react";

function fmtEUR(cents: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(cents / 100);
}
function fmtDateTime(d: Date | string) {
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Section({ title, icon: Icon, children }: { title: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
        {Icon && <Icon className="size-3.5" />} {title}
      </p>
      {children}
    </div>
  );
}

const SEVERITY_BADGE: Record<string, { variant: "default" | "outline" | "secondary"; label: string }> = {
  conflict: { variant: "outline", label: "Conflicto" },
  warning: { variant: "secondary", label: "Aviso" },
  not_connected: { variant: "outline", label: "No conectado" },
};

// ─── Resumen: GANAR / GASTAR ────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading } = trpc.tokens.economyGovernanceOverview.useQuery();
  if (isLoading || !data) return <Loader2 className="w-6 h-6 animate-spin text-primary" />;

  const conversion = data.redemptionConversion;

  return (
    <div className="space-y-4">
      <Section title="Valor base" icon={Coins}>
        {conversion ? (
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {conversion.tokensPerUnit} ST = {fmtEUR(conversion.valueCentsPerUnit)}
          </p>
        ) : (
          <p className="text-sm text-amber-600 flex items-center gap-1"><AlertTriangle className="size-4" /> Sin configurar — Universal Spend no puede aplicarse todavía.</p>
        )}
        <p className="text-xs text-muted-foreground">Valor promocional de canje — nunca dinero, saldo bancario ni divisa.</p>
      </Section>

      <Section title="Ganar" icon={TrendingUp}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.earn.map(e => (
            <div key={e.origin} className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">{e.label}</p>
              {e.rule ? (
                <>
                  <p className="text-lg font-bold text-foreground tabular-nums">
                    {e.rule.calcMethod === "fixed" ? `+${e.rule.fixedAmount} ST` : e.rule.calcMethod === "per_euro" ? `${e.rule.rate} ST/€` : e.rule.calcMethod}
                  </p>
                  {e.effectiveReturnPercent != null && <p className="text-xs text-muted-foreground">{e.effectiveReturnPercent.toFixed(1)}% retorno equivalente</p>}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Sin regla activa</p>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Gastar" icon={TrendingDown}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-border p-3">
            <p className="font-medium text-foreground">Entradas / Puerta / Consumiciones</p>
            <p className="text-muted-foreground">{conversion ? "Disponible según política de canje" : "No disponible — falta política"}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="font-medium text-foreground">Marketplace</p>
            <p className="text-muted-foreground">
              {data.marketplace.benefitCount} Benefit(s)
              {data.marketplace.minTokenCost != null && ` · ${data.marketplace.minTokenCost}–${data.marketplace.maxTokenCost} ST`}
            </p>
            <p className="text-xs text-muted-foreground">Precio específico por Benefit — no equivale estrictamente al valor base.</p>
          </div>
        </div>
      </Section>

      <Section title="Campañas y referidos" icon={Gift}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-border p-3">
            <p className="font-medium text-foreground">Campañas activas</p>
            <p className="text-lg font-bold text-foreground tabular-nums">{data.campaignsActiveCount}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="font-medium text-foreground mb-1">Invitaciones</p>
            {data.referralCampaigns.length === 0 ? <p className="text-muted-foreground">Sin campaña activa</p> : (
              data.referralCampaigns.map(c => (
                <p key={c.id} className="text-xs text-muted-foreground">{c.name}: quien invita +{c.inviterRewardTokens} ST · nuevo Student +{c.inviteeRewardTokens} ST <Badge variant="outline" className="ml-1 text-[10px]">{c.status}</Badge></p>
              ))
            )}
          </div>
        </div>
      </Section>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { href: "/admin/tokens/rules", label: "Reglas" },
          { href: "/admin/tokens/campaigns", label: "Campañas" },
          { href: "/admin/tokens/redemption", label: "Canje" },
          { href: "/admin/students/referrals", label: "Referidos" },
          { href: "/admin/benefits", label: "Marketplace" },
        ].map(l => (
          <Link key={l.href} href={l.href} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:border-primary/40 transition-colors">
            {l.label} <ArrowRight className="size-3.5 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Salud / Conflictos ─────────────────────────────────────────────────────

function HealthTab() {
  const { data, isLoading } = trpc.tokens.economyConflicts.useQuery();
  if (isLoading) return <Loader2 className="w-6 h-6 animate-spin text-primary" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground flex items-center gap-2"><ShieldAlert className="size-4 text-emerald-500" /> Sin conflictos ni avisos detectados.</p>;

  return (
    <div className="space-y-2">
      {data.map((c, i) => {
        const s = SEVERITY_BADGE[c.severity] ?? SEVERITY_BADGE.warning;
        return (
          <div key={i} className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Badge variant={s.variant}>{s.label}</Badge>
            <p className="text-sm text-foreground">{c.message}</p>
          </div>
        );
      })}
    </div>
  );
}

// ─── Simulador (Student real) ───────────────────────────────────────────────

// Alcance completo (11 origins) — usado por previewRuleForScope (Fase 10.5,
// sin Student). F60 (saneamiento funcional) — tokens.previewReward ya
// aceptaba solo 9 orígenes (excluía community_response/
// community_proposal_approved, pese a tener reglas reales activas en
// producción); el backend ya se corrigió para aceptar los 11, así que este
// simulador deja de necesitar una lista reducida aparte.
const ORIGINS = ["ticket", "consumption", "attendance", "recurrence", "community_response", "community_proposal_approved", "event", "purchase", "product", "manual", "campaign"] as const;
const PREVIEW_REWARD_ORIGINS = ORIGINS;

function SimulatorTab() {
  const [userId, setUserId] = useState("");
  const [origin, setOrigin] = useState<string>("consumption");
  const [venueId, setVenueId] = useState("");
  const [eventId, setEventId] = useState("");
  const [amountSpent, setAmountSpent] = useState("");
  const [triggered, setTriggered] = useState(false);

  const { data, isLoading, error } = trpc.tokens.previewReward.useQuery(
    { userId: Number(userId), origin: origin as typeof PREVIEW_REWARD_ORIGINS[number], venueId: venueId ? Number(venueId) : undefined, eventId: eventId ? Number(eventId) : undefined, amountSpent: amountSpent ? Number(amountSpent) : undefined },
    { enabled: triggered && !!userId && (PREVIEW_REWARD_ORIGINS as readonly string[]).includes(origin) },
  );

  return (
    <div className="space-y-4">
      <Section title="Simulador de recompensa (Student real)">
        <p className="text-xs text-muted-foreground">Usa la MISMA lógica que una recompensa real (topes/recurrencia incluidos) — nunca escribe nada.</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <Input placeholder="ID de Student" type="number" value={userId} onChange={e => setUserId(e.target.value)} />
          <Select value={origin} onValueChange={setOrigin}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PREVIEW_REWARD_ORIGINS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Venue ID (opcional)" type="number" value={venueId} onChange={e => setVenueId(e.target.value)} />
          {/* F60 — el backend ya distingue venue general vs. evento específico
              al decidir qué regla gana (findApplicableRule); este simulador
              nunca lo pedía, así que no se podía comprobar en pantalla ese
              escenario concreto sin leer código. */}
          <Input placeholder="Evento ID (opcional)" type="number" value={eventId} onChange={e => setEventId(e.target.value)} />
          <Input placeholder="Importe € (si aplica)" type="number" value={amountSpent} onChange={e => setAmountSpent(e.target.value)} />
          <Button disabled={!userId} onClick={() => setTriggered(true)}>Simular</Button>
        </div>
        {isLoading && triggered && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {data && (
          <div className="rounded-lg border border-border p-3 space-y-1 text-sm">
            <p><strong className="text-foreground">{data.eligible ? "Concedería" : "No concedería"}:</strong> {data.breakdown?.final ?? 0} ST</p>
            <p className="text-xs text-muted-foreground">Motivo: {data.reason}</p>
            {data.breakdown && (
              <p className="text-xs text-muted-foreground">
                Base {data.breakdown.base} + recurrencia {data.breakdown.recurrenceBonus}
                {data.breakdown.campaignMultiplier ? ` · campaña ×${data.breakdown.campaignMultiplier}` : ""}
                {data.breakdown.campaignBonus ? ` +${data.breakdown.campaignBonus}` : ""}
                {" "}= {data.breakdown.beforeLimits} (antes de topes) → {data.breakdown.final} final
              </p>
            )}
          </div>
        )}
      </Section>

      <PrecedenceTab />
    </div>
  );
}

function PrecedenceTab() {
  const [origin, setOrigin] = useState<string>("consumption");
  const [venueId, setVenueId] = useState("");
  const [eventId, setEventId] = useState("");
  const { data, isLoading } = trpc.tokens.previewRuleForScope.useQuery({
    direction: "earn", origin: origin as typeof ORIGINS[number],
    venueId: venueId ? Number(venueId) : undefined,
    eventId: eventId ? Number(eventId) : undefined,
  });

  return (
    <Section title="Precedencia de reglas (sin Student)">
      <p className="text-xs text-muted-foreground">¿Qué regla ganaría para este alcance ahora mismo, y por qué no las demás? Prueba un venue y un evento a la vez para ver exactamente cuál gana entre una regla general y una específica.</p>
      <div className="grid grid-cols-3 gap-2">
        <Select value={origin} onValueChange={setOrigin}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{ORIGINS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
        <Input placeholder="Venue ID (opcional)" type="number" value={venueId} onChange={e => setVenueId(e.target.value)} />
        <Input placeholder="Evento ID (opcional)" type="number" value={eventId} onChange={e => setEventId(e.target.value)} />
      </div>
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : data && (
        <div className="text-sm space-y-1">
          <p><strong className="text-foreground">Regla efectiva:</strong> {data.effectiveRule ? `${data.effectiveRule.name} (priority ${data.effectiveRule.priority})` : "Ninguna"}</p>
          {data.candidates.length > 1 && <p className="text-xs text-muted-foreground">Candidatas: {data.candidates.map(c => `${c.name} (p${c.priority})`).join(", ")}</p>}
        </div>
      )}
    </Section>
  );
}

// ─── Cambios / Auditoría ─────────────────────────────────────────────────────

function AuditTab() {
  const { data, isLoading } = trpc.tokens.economyConfigChanges.useQuery({ limit: 100 });
  if (isLoading) return <Loader2 className="w-6 h-6 animate-spin text-primary" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground">Sin cambios de configuración económica todavía.</p>;
  return (
    <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
      {data.map(c => (
        <div key={c.id} className="px-4 py-3 text-sm">
          <p className="text-foreground font-medium">{c.entityType} #{c.entityId} · {c.fieldName}</p>
          <p className="text-xs text-muted-foreground">{c.oldValue ?? "—"} → {c.newValue ?? "—"} {c.reason ? `· ${c.reason}` : ""} · {fmtDateTime(c.createdAt)}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Panel de edición rápida (cambios de alto impacto) ──────────────────────

function QuickEditTab() {
  const utils = trpc.useUtils();
  const { data: overview } = trpc.tokens.economyGovernanceOverview.useQuery();
  const applyRule = trpc.tokens.applyTokenRuleValueChange.useMutation({ onSuccess: () => { utils.tokens.economyGovernanceOverview.invalidate(); utils.tokens.economyConfigChanges.invalidate(); } });
  const applyConversion = trpc.tokens.setGlobalRedemptionConversion.useMutation({ onSuccess: () => { utils.tokens.economyGovernanceOverview.invalidate(); utils.tokens.economyConfigChanges.invalidate(); } });
  const applyReferral = trpc.tokens.setGlobalReferralEconomics.useMutation({ onSuccess: () => { utils.tokens.economyGovernanceOverview.invalidate(); utils.tokens.economyConfigChanges.invalidate(); } });

  const [confirmDialog, setConfirmDialog] = useState<{ label: string; oldValue: string; newValue: string; onConfirm: (reason: string) => void } | null>(null);
  const [reason, setReason] = useState("");

  const [ruleValues, setRuleValues] = useState<Record<number, string>>({});
  const [conversion, setConversion] = useState({ tokensPerUnit: "100", valueCentsPerUnit: "100" });
  const [referral, setReferral] = useState({ inviter: "500", invitee: "250" });

  if (!overview) return <Loader2 className="w-6 h-6 animate-spin text-primary" />;

  return (
    <div className="space-y-4">
      <Section title="Reglas de ganancia">
        <div className="space-y-2">
          {overview.earn.filter(e => e.rule).map(e => {
            const rule = e.rule!;
            const isRate = rule.calcMethod === "per_euro";
            const currentValue = isRate ? rule.rate ?? "0" : String(rule.fixedAmount ?? 0);
            const draft = ruleValues[rule.id] ?? currentValue;
            return (
              <div key={rule.id} className="flex items-center gap-2 text-sm">
                <span className="w-48 text-foreground">{e.label}</span>
                <Input className="w-32" value={draft} onChange={ev => setRuleValues({ ...ruleValues, [rule.id]: ev.target.value })} />
                <span className="text-xs text-muted-foreground">{isRate ? "ST/€" : "ST fijos"}</span>
                <Button size="sm" variant="outline" disabled={draft === currentValue}
                  onClick={() => setConfirmDialog({
                    label: e.label, oldValue: `${currentValue} ${isRate ? "ST/€" : "ST"}`, newValue: `${draft} ${isRate ? "ST/€" : "ST"}`,
                    onConfirm: (r) => applyRule.mutate({ ruleId: rule.id, [isRate ? "rate" : "fixedAmount"]: isRate ? draft : Number(draft), reason: r } as never),
                  })}>
                  Guardar
                </Button>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Valor base de canje">
        <div className="flex items-center gap-2 text-sm">
          <Input className="w-24" type="number" value={conversion.tokensPerUnit} onChange={e => setConversion({ ...conversion, tokensPerUnit: e.target.value })} />
          <span>ST =</span>
          <Input className="w-24" type="number" value={conversion.valueCentsPerUnit} onChange={e => setConversion({ ...conversion, valueCentsPerUnit: e.target.value })} />
          <span>céntimos</span>
          <Button size="sm" variant="outline" onClick={() => setConfirmDialog({
            label: "Valor base de canje",
            oldValue: overview.redemptionConversion ? `${overview.redemptionConversion.tokensPerUnit} ST = ${overview.redemptionConversion.valueCentsPerUnit}c` : "sin configurar",
            newValue: `${conversion.tokensPerUnit} ST = ${conversion.valueCentsPerUnit}c`,
            onConfirm: (r) => applyConversion.mutate({ tokensPerUnit: Number(conversion.tokensPerUnit), valueCentsPerUnit: Number(conversion.valueCentsPerUnit), reason: r }),
          })}>
            Guardar
          </Button>
        </div>
        <p className="text-xs text-amber-600">Cambiar este valor afecta el poder de gasto de TODOS los saldos existentes — nunca reescribe cómo se ganaron.</p>
      </Section>

      <Section title="Invitaciones (Referral Engine)">
        <p className="text-xs text-muted-foreground">Solo aplica si NO hay ya una campaña global activa configurada manualmente en Referidos — condición de conversión: perfil completo (mismo valor por defecto que el creador de campañas).</p>
        <div className="flex items-center gap-2 text-sm">
          <span>Quien invita:</span>
          <Input className="w-24" type="number" value={referral.inviter} onChange={e => setReferral({ ...referral, inviter: e.target.value })} />
          <span>Nuevo Student:</span>
          <Input className="w-24" type="number" value={referral.invitee} onChange={e => setReferral({ ...referral, invitee: e.target.value })} />
          <Button size="sm" variant="outline" onClick={() => setConfirmDialog({
            label: "Economía de invitaciones",
            oldValue: overview.referralCampaigns[0] ? `+${overview.referralCampaigns[0].inviterRewardTokens} / +${overview.referralCampaigns[0].inviteeRewardTokens}` : "sin campaña",
            newValue: `+${referral.inviter} / +${referral.invitee}`,
            onConfirm: (r) => applyReferral.mutate({ inviterRewardTokens: Number(referral.inviter), inviteeRewardTokens: Number(referral.invitee), conversionCondition: "profile_completed", reason: r }),
          })}>
            Guardar
          </Button>
        </div>
      </Section>

      <Dialog open={!!confirmDialog} onOpenChange={(open) => { if (!open) { setConfirmDialog(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirmar cambio económico</DialogTitle></DialogHeader>
          {confirmDialog && (
            <div className="space-y-3">
              <p className="text-sm text-foreground font-medium">{confirmDialog.label}</p>
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{confirmDialog.oldValue}</Badge>
                <ArrowRight className="size-4 text-muted-foreground" />
                <Badge>{confirmDialog.newValue}</Badge>
              </div>
              <p className="text-xs text-muted-foreground flex items-start gap-1"><Info className="size-3.5 shrink-0 mt-0.5" /> Este cambio se aplica solo a operaciones futuras — nunca reescribe el historial ya concedido.</p>
              <div>
                <Label className="text-xs">Motivo (obligatorio)</Label>
                <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Ej. activación economía V1" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmDialog(null); setReason(""); }}>Cancelar</Button>
            <Button disabled={!reason.trim()} onClick={() => { confirmDialog?.onConfirm(reason); setConfirmDialog(null); setReason(""); }}>Confirmar cambio</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function EconomyControlCenter() {
  return (
    <AdminLayout title="Economía SegoTokens">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Coins className="size-6 text-primary" /> Economía SegoTokens</h1>
          <p className="text-sm text-muted-foreground">Cómo se gana, cómo se gasta y qué devuelve el SegoToken — capa de gobierno sobre Reglas/Campañas/Canje/Referidos ya existentes.</p>
        </div>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Resumen</TabsTrigger>
            <TabsTrigger value="health">Salud</TabsTrigger>
            <TabsTrigger value="simulator">Simulador</TabsTrigger>
            <TabsTrigger value="edit">Editar valores</TabsTrigger>
            <TabsTrigger value="audit">Cambios</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4"><OverviewTab /></TabsContent>
          <TabsContent value="health" className="mt-4"><HealthTab /></TabsContent>
          <TabsContent value="simulator" className="mt-4"><SimulatorTab /></TabsContent>
          <TabsContent value="edit" className="mt-4"><QuickEditTab /></TabsContent>
          <TabsContent value="audit" className="mt-4"><AuditTab /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
