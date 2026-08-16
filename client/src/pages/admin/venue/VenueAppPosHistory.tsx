import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Loader2, ChevronDown, ChevronUp, Coins, Banknote, CreditCard, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

/**
 * VenueAppPosHistory.tsx — SEGOLIFE VENUE BAR POS & LIVE COMMERCE TERMINAL
 * (Fase 10.7, spec §22/§23). Historial de ventas del TPV + reembolso parcial
 * por línea — reutiliza `refundOrchestrator.refundPosSale` (Fase 10, ya
 * existía en el backend SIN ninguna UI que lo llamara, ver auditoría de esta
 * fase) tal cual, nunca reimplementa el cálculo de reembolso aquí.
 *
 * `commerce.refundTransactionLines` es `commerceManageProcedure` a propósito
 * (spec §46/§58: "reembolso es acción admin, nunca de staff/POS puro") — un
 * operador de TPV sin permiso de gestión verá el botón pero el servidor lo
 * rechazará con FORBIDDEN; no se oculta client-side porque quién tiene ese
 * permiso depende de RBAC real, no de un rol fijo.
 */

const PAYMENT_LABEL: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  mixed_cash: "ST + Efectivo",
  mixed_card: "ST + Tarjeta",
  mixed: "ST + Efectivo",
  segotokens: "100% SegoTokens",
};

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmada",
  refunded: "Reembolsada",
  partially_refunded: "Reembolso parcial",
  cancelled: "Cancelada",
  reconciliation_required: "En revisión",
};

function euro(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function RefundPanel({ venueId, transactionId, onDone }: { venueId: number; transactionId: number; onDone: () => void }) {
  const { data: items, isLoading } = trpc.commerce.posReceiptItems.useQuery({ transactionId });
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState("");

  const refundMut = trpc.commerce.refundTransactionLines.useMutation({
    onSuccess: () => {
      toast.success("Reembolso registrado");
      void utils.commerce.listByVenueWithNames.invalidate({ venueId });
      onDone();
    },
    onError: e => toast.error(e.message),
  });

  if (isLoading) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  if (!items?.length) return <p className="text-xs text-muted-foreground">Sin líneas.</p>;

  const lines = Object.entries(selected).filter(([, qty]) => qty > 0).map(([itemId, quantity]) => ({ itemId: Number(itemId), quantity }));

  return (
    <div className="space-y-2.5 rounded-xl border border-dashed border-border p-3">
      {items.map(item => {
        const remaining = item.quantity - (item.refundedQuantity ?? 0);
        if (remaining <= 0) return null;
        return (
          <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{item.description} (quedan {remaining})</span>
            <Input
              type="number" min={0} max={remaining} className="h-7 w-16"
              value={selected[item.id] ?? ""}
              onChange={e => setSelected(s => ({ ...s, [item.id]: Math.min(remaining, Math.max(0, Number(e.target.value) || 0)) }))}
            />
          </div>
        );
      })}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={restock} onCheckedChange={v => setRestock(v === true)} /> Devolver al stock
      </label>
      <Textarea rows={2} placeholder="Motivo del reembolso" value={reason} onChange={e => setReason(e.target.value)} className="text-xs" />
      <Button
        size="sm" variant="destructive" className="w-full"
        disabled={!lines.length || !reason.trim() || refundMut.isPending}
        onClick={() => refundMut.mutate({ transactionId, lines, reason: reason.trim(), restock, idempotencyKey: `pos-refund:${transactionId}:${crypto.randomUUID()}` })}
      >
        {refundMut.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null} Reembolsar líneas seleccionadas
      </Button>
    </div>
  );
}

export default function VenueAppPosHistory({ venueId }: { venueId: number }) {
  const { data: sales, isLoading } = trpc.commerce.listByVenueWithNames.useQuery({ venueId });
  const [expanded, setExpanded] = useState<number | null>(null);

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!sales?.length) return <p className="py-10 text-center text-sm text-muted-foreground">Todavía no hay ventas de TPV en este venue.</p>;

  return (
    <div className="space-y-2 p-4">
      {sales.map(({ transaction: tx, studentName, operatorName }) => {
        const isOpen = expanded === tx.id;
        const canRefund = tx.status === "confirmed" || tx.status === "partially_refunded";
        return (
          <div key={tx.id} className="rounded-2xl border border-border bg-card p-3.5">
            <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setExpanded(isOpen ? null : tx.id)}>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  {new Date(tx.occurredAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                  <Badge variant="secondary" className="text-[10px]">{STATUS_LABEL[tx.status] ?? tx.status}</Badge>
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {tx.paymentMethod === "card" || tx.paymentMethod === "mixed_card" ? <CreditCard className="size-3" /> : tx.paymentMethod === "segotokens" ? <Coins className="size-3" /> : <Banknote className="size-3" />}
                  {PAYMENT_LABEL[tx.paymentMethod ?? ""] ?? "—"}
                  {studentName && <span className="flex items-center gap-0.5"><User className="size-3" /> {studentName}</span>}
                  {operatorName && <span>· {operatorName}</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-bold tabular-nums text-foreground">{euro(tx.totalCents)}</span>
                {isOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
              </div>
            </button>
            {isOpen && (
              <div className="mt-3">
                {canRefund ? (
                  <RefundPanel venueId={venueId} transactionId={tx.id} onDone={() => setExpanded(null)} />
                ) : (
                  <p className="text-xs text-muted-foreground">Esta venta ya no admite más reembolsos.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
