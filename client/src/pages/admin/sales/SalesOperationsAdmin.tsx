/**
 * SalesOperationsAdmin.tsx — SEGOLIFE COMMERCE CORE (Fase 9, spec §28/§78-79).
 * "Ventas y Operaciones" — nueva superficie admin que sustituye al CRM
 * legacy de turismo como hogar conceptual de la visibilidad comercial de
 * SEGOLIFE. Overview / Ventas / Operación diaria / Calendario / Devoluciones
 * — solo lectura sobre salesReadModel.ts/dailyOperationsService.ts.
 */
import { useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, TrendingUp, Coins, ShoppingBag, Undo2, Store, CalendarDays } from "lucide-react";

function centsToEuro(cents: number) {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function fmtDateTime(d: string | Date) {
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

function Kpi({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon: React.ElementType }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-full bg-secondary text-primary shrink-0">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold text-foreground">{value}</p>
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { SEGOLIFE: "SEGOLIFE", FOURVENUES: "Fourvenues" };
const TYPE_LABEL: Record<string, string> = { event_ticket: "Entrada", door_entry: "Puerta", venue_product: "Consumición", paymentless_evidence: "Evidencia externa" };

function OverviewTab() {
  const [days, setDays] = useState(7);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const { data, isLoading } = trpc.salesOperations.overview.useQuery({ from, to });

  if (isLoading || !data) return <Loader2 className="w-6 h-6 animate-spin text-primary" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        {[1, 7, 30].map(d => (
          <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${days === d ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
            {d === 1 ? "Hoy" : `${d}d`}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Ventas brutas" value={centsToEuro(data.grossSalesCents)} icon={TrendingUp} />
        <Kpi label="Pedidos" value={data.ordersCount} icon={ShoppingBag} />
        <Kpi label="Devoluciones" value={data.refundsCount} icon={Undo2} />
        <Kpi label="SEGOLIFE / Fourvenues" value={`${centsToEuro(data.bySource.SEGOLIFE)} / ${centsToEuro(data.bySource.FOURVENUES)}`} icon={Coins} />
      </div>
      {data.byVenue.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Por venue</p>
          <Table>
            <TableHeader><TableRow><TableHead>Venue</TableHead><TableHead className="text-right">Ventas brutas</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.byVenue.map(v => (
                <TableRow key={v.venueId}><TableCell>{v.venueName}</TableCell><TableCell className="text-right tabular-nums">{centsToEuro(v.grossCents)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Ventas brutas = SegoTokens promocionales incluidos (no dinero necesariamente cobrado). No es BI final — ver Fase 12.</p>
    </div>
  );
}

function SalesTab() {
  const [source, setSource] = useState<string>("all");
  const { data, isLoading } = trpc.salesOperations.listSales.useQuery({ source: source === "all" ? undefined : (source as "SEGOLIFE" | "FOURVENUES"), limit: 100 });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las fuentes</SelectItem>
            <SelectItem value="SEGOLIFE">SEGOLIFE</SelectItem>
            <SelectItem value="FOURVENUES">Fourvenues</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isLoading ? <Loader2 className="w-6 h-6 animate-spin text-primary" /> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Referencia</TableHead><TableHead>Fecha</TableHead><TableHead>Venue</TableHead><TableHead>Evento</TableHead>
              <TableHead>Student</TableHead><TableHead>Tipo</TableHead><TableHead>Fuente</TableHead>
              <TableHead className="text-right">Bruto</TableHead><TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.items ?? []).map(r => (
              <TableRow key={r.id} className={r.isPaymentlessEvidence ? "opacity-60" : ""}>
                <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                <TableCell className="text-xs">{fmtDateTime(r.occurredAt)}</TableCell>
                <TableCell className="text-xs">{r.venueName ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.eventName ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.studentName ?? "—"}</TableCell>
                <TableCell className="text-xs">{TYPE_LABEL[r.type] ?? r.type}</TableCell>
                <TableCell className="text-xs">{SOURCE_LABEL[r.source]}{r.channel ? ` · ${r.channel}` : ""}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">{r.isPaymentlessEvidence ? `~${centsToEuro(r.grossAmountCents)}` : centsToEuro(r.grossAmountCents)}</TableCell>
                <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">Filas atenuadas = evidencia Fourvenues sin pedido real (venta en puerta externa histórica) — nunca se cuenta como dinero cobrado.</p>
    </div>
  );
}

function DailyOperationsTab() {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const { data, isLoading } = trpc.salesOperations.dailyOperations.useQuery({ date: new Date(date + "T12:00:00") });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-44" />
      </div>
      {isLoading || !data ? <Loader2 className="w-6 h-6 animate-spin text-primary" /> : (
        <>
          <p className="text-sm text-muted-foreground">Día operativo (corte 06:00): <strong className="text-foreground">{data.operationalDate}</strong></p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Eventos" value={data.eventsCount} icon={CalendarDays} />
            <Kpi label="Ventas" value={data.ticketsSold} icon={ShoppingBag} />
            <Kpi label="Check-ins" value={data.checkInsTotal} icon={TrendingUp} />
            <Kpi label="Students únicos" value={data.uniqueStudents} icon={Store} />
            <Kpi label="Visitas de venue" value={data.venueVisitsCount} icon={Store} />
            <Kpi label="Beneficios canjeados" value={data.benefitsRedeemed} icon={Coins} />
            <Kpi label="Devoluciones" value={data.refundsCount} icon={Undo2} />
            <Kpi label="Ventas brutas" value={centsToEuro(data.sales.grossSalesCents)} icon={TrendingUp} />
          </div>
          <p className="text-xs text-muted-foreground">SEGOLIFE: {centsToEuro(data.segolifeSalesCents)} · Fourvenues: {centsToEuro(data.fourvenuesSalesCents)}</p>
        </>
      )}
    </div>
  );
}

function CalendarTab() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const fromDate = monthStart.toISOString().slice(0, 10);
  const toDate = monthEnd.toISOString().slice(0, 10);
  const { data, isLoading } = trpc.salesOperations.operationalCalendar.useQuery({ fromDate, toDate });

  if (isLoading) return <Loader2 className="w-6 h-6 animate-spin text-primary" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground">Sin eventos este mes.</p>;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {data.map(d => (
        <div key={d.date} className="bg-card border border-border rounded-lg p-3">
          <p className="text-xs font-semibold text-foreground">{fmtDate(d.date)}</p>
          <p className="text-xs text-muted-foreground">{d.eventsCount} evento{d.eventsCount !== 1 ? "s" : ""}</p>
          <p className="text-sm font-medium text-foreground tabular-nums">{centsToEuro(d.grossSalesCents)}</p>
        </div>
      ))}
    </div>
  );
}

function RefundsTab() {
  const { data, isLoading } = trpc.salesOperations.listRefunds.useQuery({ limit: 100 });
  if (isLoading) return <Loader2 className="w-6 h-6 animate-spin text-primary" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Referencia</TableHead><TableHead>Venue</TableHead><TableHead>Evento</TableHead><TableHead>Student</TableHead>
          <TableHead className="text-right">Importe</TableHead><TableHead>ST restaurados</TableHead><TableHead>Estado dinero</TableHead>
          <TableHead>Parcial</TableHead><TableHead>Motivo</TableHead><TableHead>Fecha</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(data ?? []).map(r => (
          <TableRow key={r.id}>
            <TableCell className="font-mono text-xs">{r.reference}</TableCell>
            <TableCell className="text-xs">{r.venueName ?? "—"}</TableCell>
            <TableCell className="text-xs">{r.eventName ?? "—"}</TableCell>
            <TableCell className="text-xs">{r.studentName ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums text-xs">{centsToEuro(r.amountCents)}</TableCell>
            <TableCell className="text-xs">{r.tokensRestored}</TableCell>
            <TableCell><Badge variant={r.moneyRefundStatus === "completed" ? "default" : "outline"}>{r.moneyRefundStatus === "completed" ? "Devuelto" : "Sin proveedor"}</Badge></TableCell>
            <TableCell className="text-xs">{r.partial ? "Sí" : "No"}</TableCell>
            <TableCell className="text-xs max-w-[200px] truncate">{r.reason}</TableCell>
            <TableCell className="text-xs">{fmtDateTime(r.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function SalesOperationsAdmin() {
  return (
    <AdminLayout title="Ventas y Operaciones">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ventas y Operaciones</h1>
          <p className="text-sm text-muted-foreground">
            Visibilidad unificada de ventas nativas y Fourvenues — entradas, puerta, POS de venue. Configuración de eventos sigue en{" "}
            <Link href="/admin/events" className="text-primary underline">Eventos</Link>.
          </p>
        </div>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="sales">Ventas</TabsTrigger>
            <TabsTrigger value="daily">Operación diaria</TabsTrigger>
            <TabsTrigger value="calendar">Calendario</TabsTrigger>
            <TabsTrigger value="refunds">Devoluciones</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4"><OverviewTab /></TabsContent>
          <TabsContent value="sales" className="mt-4"><SalesTab /></TabsContent>
          <TabsContent value="daily" className="mt-4"><DailyOperationsTab /></TabsContent>
          <TabsContent value="calendar" className="mt-4"><CalendarTab /></TabsContent>
          <TabsContent value="refunds" className="mt-4"><RefundsTab /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
