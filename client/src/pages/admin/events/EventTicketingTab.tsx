import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Ticket, Radio } from "lucide-react";

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
        <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Ticket className="w-4 h-4" /> Ticket Types &amp; Inventory</h3>
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
        <h3 className="text-sm font-semibold mb-2">Orders ({data.orders.length}) · Tickets ({data.tickets.length})</h3>
        {data.orders.length === 0 && <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg py-4 text-center">Sin pedidos todavía — normal sin ninguna integración activada.</p>}
      </section>
    </div>
  );
}
