import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Ticket, Radio, Users, RotateCcw, Ban } from "lucide-react";

const ORDER_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline", awaiting_payment: "secondary", paid: "default", cancelled: "destructive",
  expired: "outline", refunded: "secondary", partially_refunded: "secondary", failed: "destructive",
  reconciliation_required: "destructive",
};

/**
 * EventTicketingTab — tab "Ticketing / Sales" del admin de eventos (Fase 5,
 * spec punto 57). Muestra Ticket Types, Inventory, Sales Channels, Orders,
 * Tickets y Attendance de UN evento. Empty state real si no hay nada
 * configurado todavía (nunca datos inventados) — normal en esta fase, ya
 * que no se siembra ningún canal/tarifa real.
 */
export function EventTicketingTab({ eventId }: { eventId: number }) {
  const { data, isLoading, refetch } = trpc.eventTicketing.getEventTicketingSummary.useQuery({ eventId });
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [externalUrl, setExternalUrl] = useState("");
  const createChannelMut = trpc.eventTicketing.createSalesChannel.useMutation({ onSuccess: () => { refetch(); setShowAddChannel(false); setExternalUrl(""); } });

  const [showAddType, setShowAddType] = useState(false);
  const [typeForm, setTypeForm] = useState({ name: "", priceCents: "", capacity: "" });
  const createTypeMut = trpc.eventTicketing.createTicketType.useMutation({
    onSuccess: () => { refetch(); setShowAddType(false); setTypeForm({ name: "", priceCents: "", capacity: "" }); },
    onError: e => toast.error(e.message),
  });

  const cancelOrderMut = trpc.eventTicketing.cancelOrder.useMutation({
    onSuccess: () => { toast.success("Pedido cancelado"); refetch(); },
    onError: e => toast.error(e.message),
  });
  const refundOrderMut = trpc.eventTicketing.refundOrder.useMutation({
    onSuccess: res => { toast.success(res.reconciliationRequired ? "Requiere revisión manual" : "Reembolsado"); refetch(); },
    onError: e => toast.error(e.message),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><Radio className="w-4 h-4" /> Sales Channels {data.hybrid && <Badge variant="secondary">Hybrid</Badge>}</h3>
          <Button size="sm" variant="outline" onClick={() => setShowAddChannel(v => !v)}>+ Canal</Button>
        </div>
        {showAddChannel && (
          <div className="flex items-center gap-2 mb-3 p-3 border border-dashed border-border rounded-lg">
            <input
              className="flex-1 text-sm border border-border rounded px-2 py-1 bg-background"
              placeholder="https://fourvenues.com/... (external_redirect)"
              value={externalUrl}
              onChange={e => setExternalUrl(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!externalUrl || createChannelMut.isPending}
              onClick={() => createChannelMut.mutate({ eventId, channelType: "manual", salesMode: "external_redirect", externalUrl, isPrimary: data.channels.length === 0 })}
            >
              Guardar
            </Button>
          </div>
        )}
        {data.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-4 text-center">Sin canales de venta configurados — el CTA público muestra "Tickets coming soon".</p>
        ) : (
          <div className="space-y-1.5">
            {data.channels.map(c => (
              <div key={c.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
                <span>{c.channelType} · {c.salesMode}{c.isPrimary ? " · primary" : ""}</span>
                <Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><Ticket className="w-4 h-4" /> Ticket Types &amp; Inventory</h3>
          <Button size="sm" variant="outline" onClick={() => setShowAddType(v => !v)}>+ Tipo de entrada</Button>
        </div>
        {showAddType && (
          <div className="flex flex-wrap items-center gap-2 mb-3 p-3 border border-dashed border-border rounded-lg">
            <input className="flex-1 min-w-[120px] text-sm border border-border rounded px-2 py-1 bg-background" placeholder="Nombre (ej: General)" value={typeForm.name} onChange={e => setTypeForm(f => ({ ...f, name: e.target.value }))} />
            <input className="w-28 text-sm border border-border rounded px-2 py-1 bg-background" placeholder="Precio (€)" value={typeForm.priceCents} onChange={e => setTypeForm(f => ({ ...f, priceCents: e.target.value }))} />
            <input className="w-24 text-sm border border-border rounded px-2 py-1 bg-background" placeholder="Aforo (opc.)" value={typeForm.capacity} onChange={e => setTypeForm(f => ({ ...f, capacity: e.target.value }))} />
            <Button
              size="sm"
              disabled={!typeForm.name || !typeForm.priceCents || createTypeMut.isPending}
              onClick={() => createTypeMut.mutate({
                eventId, name: typeForm.name,
                priceCents: Math.round(Number(typeForm.priceCents) * 100),
                capacity: typeForm.capacity ? Number(typeForm.capacity) : undefined,
              })}
            >
              Guardar
            </Button>
          </div>
        )}
        {data.ticketTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-4 text-center">Sin tipos de entrada creados todavía.</p>
        ) : (
          <div className="space-y-1.5">
            {data.ticketTypes.map(t => {
              const inv = data.inventory.find(i => i.ticketTypeId === t.id);
              return (
                <div key={t.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
                  <span>{t.name} — {(t.priceCents / 100).toFixed(2)} {t.currency}</span>
                  <span className="text-muted-foreground">{inv?.available != null ? `${inv.available} disponibles / ${inv.capacity} aforo` : "sin límite de aforo"}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2">Orders ({data.orders.length})</h3>
        {data.orders.length === 0 ? (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-4 text-center">Sin pedidos todavía.</p>
        ) : (
          <div className="space-y-1.5">
            {data.orders.map(o => (
              <div key={o.id} className="flex items-center justify-between gap-3 text-sm border border-border rounded-lg px-3 py-2">
                <span className="text-muted-foreground">#{o.id} · {o.provider ?? "—"} · {(o.totalCents / 100).toFixed(2)} {o.currency}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={ORDER_STATUS_VARIANT[o.status] ?? "outline"}>{o.status}</Badge>
                  {(o.status === "pending" || o.status === "awaiting_payment") && (
                    <Button size="sm" variant="outline" className="h-7 px-2" disabled={cancelOrderMut.isPending} onClick={() => cancelOrderMut.mutate({ orderId: o.id })}>
                      <Ban className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {o.status === "paid" && (
                    <Button size="sm" variant="outline" className="h-7 px-2" disabled={refundOrderMut.isPending} onClick={() => { const reason = prompt("Motivo del reembolso:"); if (reason) refundOrderMut.mutate({ orderId: o.id, reason }); }}>
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2">Tickets ({data.tickets.length})</h3>
        {data.tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-4 text-center">Sin entradas emitidas todavía.</p>
        ) : (
          <div className="space-y-1.5">
            {data.tickets.map(tk => (
              <div key={tk.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
                <span className="text-muted-foreground">#{tk.id} · {tk.salesChannel} · {tk.provider ?? "—"}</span>
                <Badge variant={tk.status === "used" ? "secondary" : tk.status === "issued" ? "default" : "outline"}>{tk.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Users className="w-4 h-4" /> Attendance</h3>
        <EventAttendanceList eventId={eventId} />
      </section>
    </div>
  );
}

function EventAttendanceList({ eventId }: { eventId: number }) {
  const { data: attendance, isLoading } = trpc.eventTicketing.listEventAttendance.useQuery({ eventId });
  if (isLoading) return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  if (!attendance?.length) return <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-4 text-center">Sin asistencia registrada todavía.</p>;
  return (
    <div className="space-y-1.5">
      {attendance.map(a => (
        <div key={a.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
          <span className="text-muted-foreground">Usuario #{a.userId} · {a.provider}</span>
          <span className="text-xs text-muted-foreground">{new Date(a.occurredAt).toLocaleString("es-ES")}</span>
        </div>
      ))}
    </div>
  );
}
