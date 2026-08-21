import { useState } from "react";
import { useParams, useLocation } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, GraduationCap, MapPin, Tag as TagIcon,
  StickyNote, Plus, X, Pencil, Trash2, Ticket, CalendarCheck, ShoppingBag,
  QrCode, Coins, Gift, Bell, User, ShieldCheck, ChevronDown, ChevronUp,
  TrendingUp, AlertTriangle, Info, LogIn, History, MessageCircle, Heart, Lightbulb, Archive, Send, UserPlus,
} from "lucide-react";
import type { TimelineEventDTO, TimelineEventType, TimelineCursor } from "@shared/segolife/student360";
import type { StudentDetail as StudentDetailData } from "../../../../../server/db/studentsDb";
import { EditStudentDialog, DeleteStudentDialog, ComunicarDialog, useCommunicateAction } from "./StudentLifecycleDialogs";

// ─── Helpers de presentación ────────────────────────────────────────────────

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function fmtCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "");
}

function Field({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">
        {value === null || value === undefined || value === "" ? <span className="text-muted-foreground/50">—</span> : value}
      </span>
    </div>
  );
}

/** Estado vacío editorial — nunca una fila de ceros ni un string técnico. */
function EmptyState({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center border border-dashed border-border rounded-lg">
      <Icon className="w-6 h-6 text-muted-foreground/50" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="text-xs text-muted-foreground max-w-xs">{description}</p>}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold text-foreground mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Timeline (Activity Aggregator) — presentación ─────────────────────────

const TIMELINE_META: Record<TimelineEventType, { icon: React.ElementType; label: string }> = {
  ticket_purchase: { icon: Ticket, label: "Compra de entrada" },
  ticket_cancelled: { icon: Ticket, label: "Entrada cancelada" },
  ticket_refunded: { icon: Ticket, label: "Entrada reembolsada" },
  event_attendance: { icon: CalendarCheck, label: "Asistencia" },
  consumption_pos: { icon: ShoppingBag, label: "Consumo (TPV)" },
  consumption_qr: { icon: QrCode, label: "Consumo (QR)" },
  token_credit: { icon: Coins, label: "Tokens ganados" },
  token_debit: { icon: Coins, label: "Tokens gastados" },
  benefit_granted: { icon: Gift, label: "Beneficio concedido" },
  benefit_used: { icon: Gift, label: "Beneficio usado" },
  benefit_cancelled: { icon: Gift, label: "Beneficio cancelado" },
  internal_note: { icon: StickyNote, label: "Nota interna" },
  tag_assigned: { icon: TagIcon, label: "Etiqueta" },
  login: { icon: LogIn, label: "Inicio de sesión" },
  admin_action: { icon: ShieldCheck, label: "Acción admin" },
  community_response: { icon: MessageCircle, label: "Respuesta en COMUNITY" },
  community_support: { icon: Heart, label: "Apoyo a una idea" },
  community_proposal_submitted: { icon: Lightbulb, label: "Idea propuesta" },
  communication_email: { icon: Send, label: "Email" },
  referral_registered: { icon: UserPlus, label: "Llegó por invitación" },
  referral_converted: { icon: UserPlus, label: "Invitación convertida" },
};

function TimelineRow({ event }: { event: TimelineEventDTO }) {
  const meta = TIMELINE_META[event.type];
  const Icon = meta?.icon ?? Info;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/60 last:border-0">
      <div className="mt-0.5 w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{event.title}</p>
        {event.description && <p className="text-xs text-muted-foreground truncate">{event.description}</p>}
        <p className="text-[11px] text-muted-foreground mt-0.5">{fmtDateTime(event.occurredAt)}</p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {event.tokens !== null && (
          <Badge variant={event.tokens >= 0 ? "default" : "outline"}>{event.tokens >= 0 ? "+" : ""}{event.tokens} ST</Badge>
        )}
        {event.amountCents !== null && <span className="text-xs text-muted-foreground">{fmtCents(event.amountCents)}</span>}
      </div>
    </div>
  );
}

// ─── Pestaña: Resumen (students360.getSummary) ─────────────────────────────

const SEGMENT_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  nuevo: "secondary", activo: "default", muy_activo: "default", vip: "default",
  en_riesgo: "outline", dormido: "outline", sin_datos: "outline",
};

function SummaryTab({ studentProfileId, onGoToActivity }: { studentProfileId: number; onGoToActivity: () => void }) {
  const { data, isLoading } = trpc.students360.getSummary.useQuery({ studentProfileId });

  if (isLoading) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      {data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map(a => (
            <div key={a.key} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${a.severity === "warning" ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400" : "bg-accent border-border text-foreground"}`}>
              {a.severity === "warning" ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <Info className="w-4 h-4 shrink-0" />}
              {a.message}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Eventos comprados" value={data.kpis.eventsPurchased} />
        <Kpi label="Asistencias" value={data.kpis.eventsAttended} />
        <Kpi label="Gasto total" value={fmtCents(data.kpis.totalSpendCents)} />
        <Kpi label="SegoTokens" value={data.kpis.tokensBalance} sub={`${data.kpis.tokensLifetimeEarned} ganados en total`} />
        <Kpi label="Beneficios disponibles" value={data.kpis.benefitsAvailable} />
        <Kpi label="Beneficios usados" value={data.kpis.benefitsUsed} />
        <Kpi label="Notificaciones sin leer" value={data.kpis.unreadNotifications} />
        <Kpi label="Próximo evento" value={data.nextEvent ? fmtDate(data.nextEvent.startsAt) : "—"} sub={data.nextEvent?.name} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">SegoScore</p>
            <div className="flex items-center gap-2">
              <Badge variant={SEGMENT_VARIANT[data.segment.key] ?? "outline"}>{data.segment.label}</Badge>
              {data.segoScore.score !== null && <span className="text-2xl font-bold text-foreground">{data.segoScore.score}</span>}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{data.segment.reason}</p>
          {data.segoScore.insufficientData ? (
            <EmptyState icon={TrendingUp} title="Datos insuficientes" description="Todavía no hay suficiente histórico para calcular un SegoScore fiable." />
          ) : (
            <div className="space-y-2 pt-1">
              {data.segoScore.dimensions.filter(d => d.available).map(d => (
                <div key={d.key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-foreground">{d.label}</span>
                    <span className="text-muted-foreground">{d.normalizedScore}</span>
                  </div>
                  <Progress value={d.normalizedScore ?? 0} className="h-1.5" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-foreground">Actividad reciente</p>
            <Button variant="ghost" size="sm" onClick={onGoToActivity}>Ver todo</Button>
          </div>
          {data.recentActivity.length === 0 ? (
            <EmptyState icon={History} title="Sin actividad todavía" description="Aquí aparecerá todo lo que este estudiante haga dentro de SEGOLIFE." />
          ) : (
            <div>{data.recentActivity.map(e => <TimelineRow key={e.id} event={e} />)}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Pestaña: Actividad (timeline completo, paginado) ──────────────────────

const TYPE_FILTER_OPTIONS: { value: TimelineEventType; label: string }[] =
  (Object.keys(TIMELINE_META) as TimelineEventType[]).map(k => ({ value: k, label: TIMELINE_META[k].label }));

function ActivityTab({ studentProfileId }: { studentProfileId: number }) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [cursors, setCursors] = useState<TimelineCursor[]>([]);
  const cursor = cursors[cursors.length - 1] ?? null;

  const { data, isLoading } = trpc.students360.getActivity.useQuery({
    studentProfileId,
    types: typeFilter === "all" ? undefined : [typeFilter as TimelineEventType],
    cursor,
    limit: 25,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setCursors([]); }}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {TYPE_FILTER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="bg-card border border-border rounded-lg p-4">
        {isLoading ? (
          <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={History} title="Sin eventos con este filtro" description="Prueba a cambiar el tipo de actividad seleccionado." />
        ) : (
          <>
            <div>{data.items.map(e => <TimelineRow key={e.id} event={e} />)}</div>
            <div className="flex items-center justify-between pt-3">
              <Button variant="outline" size="sm" disabled={cursors.length === 0} onClick={() => setCursors(c => c.slice(0, -1))}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={!data.nextCursor} onClick={() => data.nextCursor && setCursors(c => [...c, data.nextCursor!])}>Siguiente</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Pestaña: Eventos ───────────────────────────────────────────────────────

function EventsTab({ studentProfileId }: { studentProfileId: number }) {
  const { data, isLoading } = trpc.students360.getEvents.useQuery({ studentProfileId });
  if (isLoading) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  const tickets = data?.tickets ?? [];
  const attendance = data?.attendance ?? [];

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm font-semibold text-foreground mb-3">Entradas</p>
        {tickets.length === 0 ? (
          <EmptyState icon={Ticket} title="Sin entradas todavía" description="Solo se muestran compras por checkout nativo de Segolife — las ventas por canal externo solo dejan rastro de asistencia." />
        ) : (
          <div className="space-y-1.5">
            {tickets.map(({ ticket, event }) => (
              <div key={ticket.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <div>
                  <span className="text-foreground">{event?.name ?? "Evento eliminado"}</span>
                  <span className="text-xs text-muted-foreground ml-2">{event ? fmtDate(event.startsAt) : ""}</span>
                </div>
                <Badge variant={ticket.status === "issued" || ticket.status === "used" ? "default" : "outline"}>{ticket.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm font-semibold text-foreground mb-3">Asistencias</p>
        {attendance.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="Sin asistencias registradas" description="La ausencia de asistencia no implica que no fuera al evento — solo que no quedó registrada." />
        ) : (
          <div className="space-y-1.5">
            {attendance.map(({ attendance: a, event, venueName }) => (
              <div key={a.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <div>
                  <span className="text-foreground">{event?.name ?? "Evento"}</span>
                  {venueName && <span className="text-xs text-muted-foreground ml-2">{venueName}</span>}
                </div>
                <span className="text-xs text-muted-foreground">{fmtDateTime(a.occurredAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pestaña: Histórico (SEGOLIFE HISTORICAL STUDENT CLAIM) ────────────────
// Nunca sustituye al directorio de Identidades Históricas (Students →
// Históricos): esto es la vista "ya reclamado, atribuido a este Student"; el
// directorio sigue siendo la vista "sin reclamar / posible / conflicto"
// sobre TODAS las identidades. La Historical Identity de origen nunca se
// borra al reclamar (spec §16-18) — sigue viva y auditable ahí.

function HistoricalTab({ studentProfileId }: { studentProfileId: number }) {
  const { data, isLoading } = trpc.students360.getHistorical.useQuery({ studentProfileId });
  if (isLoading) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  const overview = data?.overview;
  const items = data?.timeline.items ?? [];

  if (!overview?.hasHistory) {
    return (
      <EmptyState
        icon={Archive}
        title="Sin historial Fourvenues reclamado"
        description="Si este Student tiene actividad histórica pendiente de vincular, aparece en el directorio de Identidades Históricas (Students → Históricos), nunca aquí hasta que se reclame."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-foreground">Historial Fourvenues reclamado</p>
          {overview.crossVenue && <Badge variant="outline">Multi-venue</Badge>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Eventos" value={overview.eventsCount} />
          <Field label="Entradas" value={overview.ticketsCount} />
          <Field label="Asistencias" value={overview.attendanceCount} />
          <Field label="Gasto histórico" value={fmtCents(overview.historicalSpendCents)} />
          <Field label="Venues" value={overview.venuesCount} />
          <Field label="Primera actividad" value={fmtDate(overview.firstActivity)} />
          <Field label="Última actividad" value={fmtDate(overview.lastActivity)} />
          <Field label="Reclamado el" value={fmtDate(overview.claimedAt)} />
        </div>
        <p className="text-[11px] text-muted-foreground/70 mt-3">
          Identidad de origen: {overview.identityKey}
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm font-semibold text-foreground mb-3">Línea de tiempo histórica</p>
        {items.length === 0 ? (
          <EmptyState icon={Archive} title="Sin operaciones en esta página" />
        ) : (
          <div className="space-y-1.5">
            {items.map(op => (
              <div key={op.operationId} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <div>
                  <span className="text-foreground">{op.eventName ?? (op.operationType === "attendance" ? "Asistencia" : "Operación")}</span>
                  {op.venueName && <span className="text-xs text-muted-foreground ml-2">{op.venueName}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {op.amountCents !== null && <span className="text-xs text-muted-foreground">{fmtCents(op.amountCents)}</span>}
                  <span className="text-xs text-muted-foreground">{fmtDateTime(op.occurredAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pestaña: Consumo (QR + POS, dos flujos que no se cruzan) ──────────────

function ConsumptionTab({ studentProfileId }: { studentProfileId: number }) {
  const { data, isLoading } = trpc.students360.getConsumption.useQuery({ studentProfileId });
  if (isLoading) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  const qr = data?.qr ?? [];
  const pos = data?.pos ?? [];

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm font-semibold text-foreground mb-3">Canjes QR</p>
        {qr.length === 0 ? (
          <EmptyState icon={QrCode} title="Sin canjes de QR todavía" />
        ) : (
          <div className="space-y-1.5">
            {qr.map(q => (
              <div key={q.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <div>
                  <span className="text-foreground">{q.venueName}{q.productName ? ` · ${q.productName}` : ""}</span>
                  <span className="text-xs text-muted-foreground ml-2">{fmtDateTime(q.redeemedAt)}</span>
                </div>
                <span className="text-xs text-muted-foreground">{fmtCents(q.amountCents)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm font-semibold text-foreground mb-3">Consumo en TPV</p>
        {pos.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="Sin consumo en TPV todavía" />
        ) : (
          <div className="space-y-1.5">
            {pos.map(({ transaction, venueName }) => (
              <div key={transaction.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <div>
                  <span className="text-foreground">{venueName ?? "Venue"}</span>
                  <span className="text-xs text-muted-foreground ml-2">{fmtDateTime(transaction.occurredAt)}</span>
                </div>
                <span className="text-xs text-muted-foreground">{fmtCents(transaction.totalCents)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pestaña: SegoTokens (wallet + ledger + ajuste manual + reversión) ─────

function StudentTokensTab({ userId }: { userId: number }) {
  const utils = trpc.useUtils();
  const [adjustDirection, setAdjustDirection] = useState<"credit" | "debit">("credit");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const { data: wallet, isLoading: loadingWallet } = trpc.tokens.getWallet.useQuery({ userId });
  const { data: ledger, isLoading: loadingLedger } = trpc.tokens.listLedger.useQuery({ userId, limit: 30, offset: 0 });

  const invalidate = () => {
    utils.tokens.getWallet.invalidate({ userId });
    utils.tokens.listLedger.invalidate({ userId, limit: 30, offset: 0 });
  };

  const adjustMut = trpc.tokens.adjustManual.useMutation({
    onSuccess: () => { toast.success("Ajuste aplicado"); setAdjustAmount(""); setAdjustReason(""); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const reverseMut = trpc.tokens.reverseLedger.useMutation({
    onSuccess: () => { toast.success("Movimiento revertido"); invalidate(); },
    onError: e => toast.error(e.message),
  });

  const handleAdjust = () => {
    const amount = Number(adjustAmount);
    if (!amount || amount <= 0) { toast.error("Introduce un importe válido"); return; }
    if (!adjustReason.trim()) { toast.error("El motivo es obligatorio"); return; }
    adjustMut.mutate({ userId, direction: adjustDirection, amount, reason: adjustReason.trim() });
  };

  const handleReverse = (ledgerId: number) => {
    const reason = window.prompt("Motivo de la reversión (obligatorio):");
    if (!reason || !reason.trim()) return;
    reverseMut.mutate({ ledgerId, reason: reason.trim() });
  };

  if (loadingWallet) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Kpi label="Saldo actual" value={wallet?.balance ?? 0} />
        <Kpi label="Ganados (total)" value={<span className="text-emerald-600">{wallet?.lifetimeEarned ?? 0}</span>} />
        <Kpi label="Gastados (total)" value={<span className="text-orange-600">{wallet?.lifetimeSpent ?? 0}</span>} />
      </div>

      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <p className="text-sm font-semibold text-foreground">Ajuste manual</p>
        <div className="flex flex-wrap gap-2 items-end">
          <Select value={adjustDirection} onValueChange={v => setAdjustDirection(v as "credit" | "debit")}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="credit">+ Añadir</SelectItem><SelectItem value="debit">− Restar</SelectItem></SelectContent>
          </Select>
          <Input type="number" min={1} placeholder="Importe" className="w-[100px]" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} />
          <Input placeholder="Motivo (obligatorio)" className="flex-1 min-w-[200px]" value={adjustReason} onChange={e => setAdjustReason(e.target.value)} />
          <Button size="sm" disabled={adjustMut.isPending} onClick={handleAdjust}>Aplicar</Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm font-semibold text-foreground mb-3">Historial de movimientos</p>
        {loadingLedger ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : !ledger || ledger.length === 0 ? (
          <EmptyState icon={Coins} title="Sin movimientos todavía" />
        ) : (
          <div className="space-y-1.5">
            {ledger.map(l => (
              <div key={l.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <div>
                  <span className="text-foreground">{l.reason}</span>
                  <span className="text-xs text-muted-foreground ml-2">{fmtDateTime(l.createdAt)}</span>
                  {l.reversedLedgerId && <Badge variant="outline" className="ml-2 text-[10px]">reversión</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={l.direction === "credit" ? "default" : "outline"}>{l.direction === "credit" ? "+" : "-"}{l.amount}</Badge>
                  {l.sourceType === "manual_adjustment" && !l.reversedLedgerId && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={reverseMut.isPending} onClick={() => handleReverse(l.id)}>Revertir</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pestaña: Benefits ──────────────────────────────────────────────────────

const BENEFIT_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  active: "default", used: "secondary", expired: "outline", cancelled: "outline",
};

function BenefitsTab({ studentProfileId, userId }: { studentProfileId: number; userId: number }) {
  const utils = trpc.useUtils();
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [definitionId, setDefinitionId] = useState<string>("");
  const [grantReason, setGrantReason] = useState("");

  const { data: benefits, isLoading } = trpc.benefits.listGrants.useQuery({ communityId: "all", userId, limit: 50, offset: 0 });
  const { data: definitions } = trpc.benefits.listDefinitions.useQuery();

  const invalidate = () => utils.benefits.listGrants.invalidate({ communityId: "all", userId, limit: 50, offset: 0 });

  const grantMut = trpc.benefits.manualGrant.useMutation({
    onSuccess: () => { toast.success("Beneficio concedido"); setShowGrantForm(false); setDefinitionId(""); setGrantReason(""); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const cancelMut = trpc.benefits.cancelGrant.useMutation({
    onSuccess: () => { toast.success("Beneficio cancelado"); invalidate(); },
    onError: e => toast.error(e.message),
  });

  const handleGrant = () => {
    if (!definitionId) { toast.error("Selecciona un beneficio"); return; }
    if (!grantReason.trim()) { toast.error("El motivo es obligatorio"); return; }
    grantMut.mutate({ userId, benefitDefinitionId: Number(definitionId), validFrom: new Date(), reason: grantReason.trim() });
  };

  const handleCancel = (userBenefitId: number) => {
    const reason = window.prompt("Motivo de la cancelación (obligatorio):");
    if (!reason || !reason.trim()) return;
    cancelMut.mutate({ userBenefitId, reason: reason.trim() });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setShowGrantForm(v => !v)}>
          <Plus className="w-4 h-4 mr-1" /> Conceder beneficio
        </Button>
      </div>

      {showGrantForm && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <Select value={definitionId} onValueChange={setDefinitionId}>
              <SelectTrigger className="w-[240px]"><SelectValue placeholder="Beneficio…" /></SelectTrigger>
              <SelectContent>
                {(definitions ?? []).filter(d => d.active).map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Motivo (obligatorio)" className="flex-1 min-w-[200px]" value={grantReason} onChange={e => setGrantReason(e.target.value)} />
            <Button size="sm" disabled={grantMut.isPending} onClick={handleGrant}>Conceder</Button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-4">
        {isLoading ? (
          <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : !benefits || benefits.items.length === 0 ? (
          <EmptyState icon={Gift} title="Sin beneficios concedidos todavía" />
        ) : (
          <div className="space-y-1.5">
            {benefits.items.map(b => (
              <div key={b.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <div>
                  <span className="text-foreground">{b.definitionName}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {b.sourceVenueName ? `Origen: ${b.sourceVenueName}` : b.sourceType} → {b.destinationVenueName ?? "—"}
                  </span>
                  {b.grantReason && <span className="text-xs text-muted-foreground ml-2 italic">"{b.grantReason}"</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={BENEFIT_STATUS_VARIANT[b.status] ?? "outline"}>{b.status}</Badge>
                  {b.status === "active" && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={cancelMut.isPending} onClick={() => handleCancel(b.id)}>Cancelar</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pestaña: Engagement ────────────────────────────────────────────────────

function SendMessageDialog({ userId, open, onOpenChange }: { userId: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const utils = trpc.useUtils();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [senderKey, setSenderKey] = useState("human");
  const { data: senders } = trpc.engagement.listSenderIdentities.useQuery();

  const sendMut = trpc.engagement.sendManualMessage.useMutation({
    onSuccess: (res) => {
      toast.success(res.hadEmail ? "Mensaje enviado" : "Mensaje registrado (el Student no tiene email)");
      utils.students360.getEngagement.invalidate();
      setSubject(""); setBody(""); onOpenChange(false);
    },
    onError: e => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Enviar mensaje al Student</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Remitente</Label>
            <Select value={senderKey} onValueChange={setSenderKey}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(senders ?? []).map(s => <SelectItem key={s.key} value={s.key}>{s.name} ({s.email})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Asunto</Label><Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Asunto del email" /></div>
          <div><Label>Mensaje</Label><Textarea rows={5} value={body} onChange={e => setBody(e.target.value)} placeholder="Contenido del mensaje…" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={!subject.trim() || !body.trim() || sendMut.isPending}
            onClick={() => sendMut.mutate({ studentUserId: userId, subject: subject.trim(), body: body.trim(), senderKey: senderKey as any, category: "account" })}
          >
            {sendMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EngagementTab({ studentProfileId, userId }: { studentProfileId: number; userId: number }) {
  const { data, isLoading } = trpc.students360.getEngagement.useQuery({ studentProfileId });
  const [sendOpen, setSendOpen] = useState(false);
  const { communicate, checking: communicateChecking, dialogOpen: comunicarOpen, setDialogOpen: setComunicarOpen } = useCommunicateAction(userId);
  if (isLoading) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  const notifications = data?.notifications ?? [];
  const preferences = data?.preferences ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={communicate} disabled={communicateChecking}>
          {communicateChecking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageCircle className="w-4 h-4 mr-2" />} Comunicarse
        </Button>
        <Button size="sm" onClick={() => setSendOpen(true)}><Send className="w-4 h-4 mr-2" /> Enviar mensaje</Button>
      </div>
      <SendMessageDialog userId={userId} open={sendOpen} onOpenChange={setSendOpen} />
      <ComunicarDialog studentUserId={userId} open={comunicarOpen} onOpenChange={setComunicarOpen} />
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm font-semibold text-foreground mb-3">Notificaciones in-app</p>
        <p className="text-xs text-muted-foreground mb-3">
          Único canal con datos reales hoy — email/push/WhatsApp no están activados en la plataforma, no se muestran métricas que no existen (open rate, click rate).
        </p>
        {notifications.length === 0 ? (
          <EmptyState icon={Bell} title="Sin notificaciones todavía" />
        ) : (
          <div className="space-y-1.5">
            {notifications.slice(0, 20).map(n => (
              <div key={n.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <div>
                  <span className="text-foreground">{n.titleEs || n.titleEn}</span>
                  <span className="text-xs text-muted-foreground ml-2">{fmtDateTime(n.createdAt)}</span>
                </div>
                <Badge variant={n.readAt ? "secondary" : "default"}>{n.readAt ? "leída" : "sin leer"}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm font-semibold text-foreground mb-3">Preferencias de comunicación</p>
        {preferences.length === 0 ? (
          <EmptyState icon={Bell} title="Sin preferencias configuradas" description="El estudiante no ha modificado sus preferencias por defecto." />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {preferences.map((p, i) => (
              <Badge key={i} variant={p.enabled ? "default" : "outline"}>{p.category} · {p.channel}: {p.enabled ? "sí" : "no"}</Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pestaña: Perfil (personal + académico + estancia + comunidades + etiquetas) ──

interface ProfileTabProps {
  student: StudentDetailData;
  studentProfileId: number;
  allTags: { id: number; name: string; color: string | null }[];
}

function ProfileTab({ student, studentProfileId, allTags }: ProfileTabProps) {
  const utils = trpc.useUtils();
  const [tagToAdd, setTagToAdd] = useState<string>("");

  const assignTag = trpc.students.assignTag.useMutation({
    onSuccess: () => { setTagToAdd(""); utils.students.getById.invalidate({ id: studentProfileId }); },
    onError: e => toast.error(e.message),
  });
  const unassignTag = trpc.students.unassignTag.useMutation({
    onSuccess: () => utils.students.getById.invalidate({ id: studentProfileId }),
    onError: e => toast.error(e.message),
  });

  const assignedTagIds = new Set(student.tags.map(t => t.id));
  const availableTags = allTags.filter(t => !assignedTagIds.has(t.id));

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Datos personales</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Nombre" value={student.profile.firstName} />
          <Field label="Apellidos" value={student.profile.lastName} />
          <Field label="Email" value={student.user.email} />
          <Field label="Teléfono" value={student.user.phone} />
          <Field label="Fecha de nacimiento" value={student.profile.dateOfBirth} />
          <Field label="Nacionalidad" value={student.profile.nationality} />
          <Field label="País de origen" value={student.profile.countryOfOrigin} />
          <Field label="Idioma preferido" value={student.profile.preferredLocale?.toUpperCase()} />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Datos académicos</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Universidad" value={student.university?.name} />
          <Field label="Programa / grado" value={student.profile.degreeProgram} />
          <Field label="Curso académico" value={student.profile.academicYear} />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Estancia en Segovia</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Fecha de llegada" value={student.profile.arrivalDate} />
          <Field label="Fecha prevista de salida" value={student.profile.expectedDepartureDate} />
          <Field label="Ciudad" value={student.profile.city} />
          <Field label="Código postal" value={student.profile.postalCode} />
          <Field label={<span className="flex items-center gap-1"><MapPin className="w-3 h-3" />Dirección (privada, no pública)</span>} value={student.profile.addressLine} />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Comunidades</p>
        {student.communities.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin comunidades asignadas todavía.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {student.communities.map(c => <Badge key={c.id} variant="secondary" className="text-sm py-1.5 px-3">{c.name} · {c.slug}</Badge>)}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Etiquetas</p>
        <div className="flex flex-wrap gap-2">
          {student.tags.length === 0 && <p className="text-sm text-muted-foreground">Sin etiquetas.</p>}
          {student.tags.map(t => (
            <Badge key={t.id} variant="secondary" className="gap-1 py-1 px-2">
              <TagIcon className="w-3 h-3" style={t.color ? { color: t.color } : undefined} />
              {t.name}
              <button onClick={() => unassignTag.mutate({ studentProfileId, tagId: t.id })} className="ml-1 hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
        {availableTags.length > 0 && (
          <div className="flex items-center gap-2">
            <Select value={tagToAdd} onValueChange={setTagToAdd}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="Añadir etiqueta…" /></SelectTrigger>
              <SelectContent>{availableTags.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={!tagToAdd || assignTag.isPending} onClick={() => assignTag.mutate({ studentProfileId, tagId: Number(tagToAdd) })}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pestaña: Notas internas ────────────────────────────────────────────────

function NotesTab({ studentProfileId }: { studentProfileId: number }) {
  const utils = trpc.useUtils();
  const [newNote, setNewNote] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  const { data: notes } = trpc.students.listNotes.useQuery({ studentProfileId }, { enabled: !!studentProfileId });
  const invalidate = () => utils.students.listNotes.invalidate({ studentProfileId });

  const addNote = trpc.students.addNote.useMutation({
    onSuccess: () => { setNewNote(""); toast.success("Nota añadida"); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const updateNote = trpc.students.updateNote.useMutation({
    onSuccess: () => { setEditingId(null); toast.success("Nota actualizada"); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const deleteNote = trpc.students.deleteNote.useMutation({
    onSuccess: () => { toast.success("Nota eliminada"); invalidate(); },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Añadir una nota interna…"
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && newNote.trim()) addNote.mutate({ studentProfileId, note: newNote.trim() }); }}
        />
        <Button size="sm" disabled={!newNote.trim() || addNote.isPending} onClick={() => addNote.mutate({ studentProfileId, note: newNote.trim() })}>
          <StickyNote className="w-4 h-4" />
        </Button>
      </div>
      <div className="space-y-2">
        {(notes ?? []).length === 0 && <EmptyState icon={StickyNote} title="Sin notas todavía" description="Las notas son privadas — nunca visibles para el propio estudiante." />}
        {(notes ?? []).map(n => (
          <div key={n.id} className="text-sm bg-accent/40 rounded-md p-3">
            {editingId === n.id ? (
              <div className="flex gap-2">
                <Input value={editingText} onChange={e => setEditingText(e.target.value)} className="flex-1" />
                <Button size="sm" onClick={() => updateNote.mutate({ studentProfileId, noteId: n.id, note: editingText.trim() })} disabled={!editingText.trim()}>Guardar</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-foreground flex-1">{n.note}</p>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setEditingId(n.id); setEditingText(n.note); }}><Pencil className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { if (window.confirm("¿Borrar esta nota?")) deleteNote.mutate({ studentProfileId, noteId: n.id }); }}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{fmtDate(n.createdAt)}</p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pestaña: Administración (audit trail + login) ─────────────────────────

function AdminTab({ studentProfileId }: { studentProfileId: number }) {
  const { data, isLoading } = trpc.students360.getAdminActivity.useQuery({ studentProfileId });
  if (isLoading) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  const adminActions = data?.adminActions ?? [];
  const logins = data?.logins ?? [];

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm font-semibold text-foreground mb-3">Acciones administrativas</p>
        <p className="text-xs text-muted-foreground mb-3">
          Ajustes de SegoTokens y Beneficios ya quedan trazados en sus propios módulos (ver pestañas SegoTokens/Benefits) — aquí solo aparecen acciones que no tienen su propio histórico, como cambios de estado.
        </p>
        {adminActions.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Sin acciones administrativas registradas" />
        ) : (
          <div className="space-y-1.5">
            {adminActions.map(a => (
              <div key={a.id} className="text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-foreground">{a.action}{a.beforeValue && a.afterValue ? `: ${a.beforeValue} → ${a.afterValue}` : ""}</span>
                  <span className="text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
                </div>
                {a.reason && <p className="text-xs text-muted-foreground italic mt-0.5">"{a.reason}"</p>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm font-semibold text-foreground mb-3">Histórico de accesos</p>
        <p className="text-xs text-muted-foreground mb-3">Se registra desde esta fase en adelante — no incluye histórico anterior (nunca se fabrica retroactivamente).</p>
        {logins.length === 0 ? (
          <EmptyState icon={LogIn} title="Sin accesos registrados todavía" />
        ) : (
          <div className="space-y-1.5">
            {logins.map(l => (
              <div key={l.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <span className="text-foreground">Inicio de sesión</span>
                <span className="text-xs text-muted-foreground">{fmtDateTime(l.occurredAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Control de cambio de estado (header) — motivo obligatorio ─────────────

function StatusChangeControl({ studentProfileId, currentStatus }: { studentProfileId: number; currentStatus: "active" | "inactive" }) {
  const utils = trpc.useUtils();
  const [pendingStatus, setPendingStatus] = useState<"active" | "inactive" | null>(null);
  const [reason, setReason] = useState("");

  const updateStatus = trpc.students.updateAdminFields.useMutation({
    onSuccess: () => {
      toast.success("Estado actualizado");
      setPendingStatus(null); setReason("");
      utils.students.getById.invalidate({ id: studentProfileId });
      utils.students360.getSummary.invalidate({ studentProfileId });
      utils.students360.getAdminActivity.invalidate({ studentProfileId });
      utils.students.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  if (pendingStatus) {
    return (
      <div className="flex flex-col items-end gap-1.5 bg-accent/60 border border-border rounded-lg p-2.5 w-[220px]">
        <span className="text-[10px] text-muted-foreground">Motivo del cambio a "{pendingStatus === "active" ? "Activo" : "Inactivo"}"</span>
        <Input value={reason} onChange={e => setReason(e.target.value)} className="h-7 text-xs" placeholder="Obligatorio…" autoFocus />
        <div className="flex gap-1.5">
          <Button size="sm" className="h-6 px-2 text-xs" disabled={!reason.trim() || updateStatus.isPending}
            onClick={() => updateStatus.mutate({ studentProfileId, status: pendingStatus, reason: reason.trim() })}>Confirmar</Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setPendingStatus(null); setReason(""); }}>Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Estado</span>
      <Select value={currentStatus} onValueChange={v => setPendingStatus(v as "active" | "inactive")}>
        <SelectTrigger className="w-[130px] h-8"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Activo</SelectItem>
          <SelectItem value="inactive">Inactivo</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Página principal ───────────────────────────────────────────────────────

export default function StudentDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const studentProfileId = Number(params.id);
  const [tab, setTab] = useState("resumen");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: student, isLoading, error } = trpc.students.getById.useQuery({ id: studentProfileId });
  const { data: allTags } = trpc.students.listTags.useQuery();
  // Llamado incondicionalmente (regla de hooks) aunque `student` aún no
  // haya cargado — el botón que usa `communicate` no se renderiza hasta
  // que sí hay datos, así que el placeholder nunca llega a dispararse.
  const { communicate, checking: communicateChecking, dialogOpen: comunicarOpen, setDialogOpen: setComunicarOpen } = useCommunicateAction(student?.profile.userId ?? 0);

  if (isLoading) {
    return (
      <AdminLayout title="Estudiante">
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      </AdminLayout>
    );
  }

  if (error || !student) {
    return (
      <AdminLayout title="Estudiante">
        <div className="py-16 text-center text-sm text-destructive">{error?.message ?? "Estudiante no encontrado"}</div>
      </AdminLayout>
    );
  }

  const fullName = [student.profile.firstName, student.profile.lastName].filter(Boolean).join(" ") || student.user.name;

  return (
    <AdminLayout title="Estudiante">
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/students")} className="gap-1 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Volver al listado
        </Button>

        {/* ── CABECERA ── */}
        <div className="flex flex-col sm:flex-row items-start gap-4 bg-card border border-border rounded-lg p-5">
          <Avatar className="w-16 h-16">
            <AvatarImage src={student.user.avatarUrl ?? undefined} />
            <AvatarFallback className="text-lg">{initials(fullName)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-semibold text-foreground">{fullName || "(sin nombre)"}</h2>
              {!student.profile.profileCompleted && <Badge variant="outline">Perfil incompleto</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{student.user.email ?? "—"}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {student.university && <Badge variant="secondary"><GraduationCap className="w-3 h-3 mr-1" />{student.university.name}</Badge>}
              {student.communities.map(c => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
              {student.profile.nationality && <Badge variant="outline">{student.profile.nationality}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              Alta: {fmtDate(student.profile.createdAt)} · Último acceso: {student.user.lastSignedIn ? fmtDateTime(student.user.lastSignedIn) : "—"}
            </p>
          </div>
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex gap-1 flex-wrap">
              <Button variant="outline" size="sm" onClick={communicate} disabled={communicateChecking} aria-label="Comunicarse con este estudiante" title="Comunicarse">
                {communicateChecking ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <MessageCircle className="w-4 h-4 mr-1.5" />}Comunicarse
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} aria-label="Editar estudiante" title="Editar"><Pencil className="w-4 h-4 mr-1.5" />Editar</Button>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)} aria-label="Borrar estudiante" title="Borrar"><Trash2 className="w-4 h-4 mr-1.5" />Borrar</Button>
            </div>
            <StatusChangeControl studentProfileId={studentProfileId} currentStatus={student.profile.status} />
          </div>
        </div>

        <EditStudentDialog studentProfileId={editOpen ? studentProfileId : null} onClose={() => setEditOpen(false)} />
        <DeleteStudentDialog
          studentProfileId={deleteOpen ? studentProfileId : null}
          onClose={() => setDeleteOpen(false)}
          onSuccess={() => navigate("/admin/students")}
        />
        <ComunicarDialog studentUserId={student.profile.userId} open={comunicarOpen} onOpenChange={setComunicarOpen} />

        <Tabs value={tab} onValueChange={setTab}>
          <div className="overflow-x-auto -mx-1 px-1">
            <TabsList className="flex-nowrap w-max min-w-full">
              <TabsTrigger value="resumen" className="gap-1"><TrendingUp className="w-3.5 h-3.5" />Resumen</TabsTrigger>
              <TabsTrigger value="actividad" className="gap-1"><History className="w-3.5 h-3.5" />Actividad</TabsTrigger>
              <TabsTrigger value="eventos" className="gap-1"><Ticket className="w-3.5 h-3.5" />Eventos</TabsTrigger>
              <TabsTrigger value="consumo" className="gap-1"><ShoppingBag className="w-3.5 h-3.5" />Consumo</TabsTrigger>
              <TabsTrigger value="segotokens" className="gap-1"><Coins className="w-3.5 h-3.5" />SegoTokens</TabsTrigger>
              <TabsTrigger value="benefits" className="gap-1"><Gift className="w-3.5 h-3.5" />Benefits</TabsTrigger>
              <TabsTrigger value="engagement" className="gap-1"><Bell className="w-3.5 h-3.5" />Engagement</TabsTrigger>
              <TabsTrigger value="historico" className="gap-1"><Archive className="w-3.5 h-3.5" />Histórico</TabsTrigger>
              <TabsTrigger value="perfil" className="gap-1"><User className="w-3.5 h-3.5" />Perfil</TabsTrigger>
              <TabsTrigger value="notas" className="gap-1"><StickyNote className="w-3.5 h-3.5" />Notas</TabsTrigger>
              <TabsTrigger value="administracion" className="gap-1"><ShieldCheck className="w-3.5 h-3.5" />Administración</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="resumen"><SummaryTab studentProfileId={studentProfileId} onGoToActivity={() => setTab("actividad")} /></TabsContent>
          <TabsContent value="actividad"><ActivityTab studentProfileId={studentProfileId} /></TabsContent>
          <TabsContent value="eventos"><EventsTab studentProfileId={studentProfileId} /></TabsContent>
          <TabsContent value="consumo"><ConsumptionTab studentProfileId={studentProfileId} /></TabsContent>
          <TabsContent value="segotokens"><StudentTokensTab userId={student.profile.userId} /></TabsContent>
          <TabsContent value="benefits"><BenefitsTab studentProfileId={studentProfileId} userId={student.profile.userId} /></TabsContent>
          <TabsContent value="engagement"><EngagementTab studentProfileId={studentProfileId} userId={student.profile.userId} /></TabsContent>
          <TabsContent value="historico"><HistoricalTab studentProfileId={studentProfileId} /></TabsContent>
          <TabsContent value="perfil"><ProfileTab student={student} studentProfileId={studentProfileId} allTags={allTags ?? []} /></TabsContent>
          <TabsContent value="notas"><NotesTab studentProfileId={studentProfileId} /></TabsContent>
          <TabsContent value="administracion"><AdminTab studentProfileId={studentProfileId} /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
