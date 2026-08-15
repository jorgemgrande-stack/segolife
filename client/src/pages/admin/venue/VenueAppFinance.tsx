/**
 * VenueAppFinance.tsx — SEGOLIFE FASE 10 (spec §41/§53). Stock y Caja
 * operativos del PROPIO venue — nunca expone configuración fiscal/comercial
 * global (spec §5/§116, "no exponer internals del motor de impuestos").
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, Package, Wallet, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function centsToEuro(cents: number | null | undefined) {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function StockSection({ venueId }: { venueId: number }) {
  const utils = trpc.useUtils();
  const { data: products, isLoading } = trpc.stock.listProducts.useQuery({ venueId });
  const waste = trpc.stock.recordWaste.useMutation({ onSuccess: () => utils.stock.listProducts.invalidate() });
  const [form, setForm] = useState<Record<number, string>>({});

  if (isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (!products?.length) return <p className="text-sm text-muted-foreground px-1">Ningún producto de este venue lleva control de stock todavía.</p>;

  return (
    <div className="space-y-2">
      {products.map(p => (
        <div key={p.id} className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-foreground truncate">{p.name}</p>
            <p className="text-xs text-muted-foreground">Stock: <strong className="text-foreground">{p.currentStockCached ?? 0}</strong>{p.lowStockThreshold != null && (p.currentStockCached ?? 0) <= p.lowStockThreshold && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-600"><AlertTriangle className="size-3" /> Bajo</span>
            )}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Input type="number" className="w-16 h-9" placeholder="Ud." value={form[p.id] ?? ""} onChange={e => setForm({ ...form, [p.id]: e.target.value })} />
            <Button size="sm" variant="outline" disabled={!form[p.id] || waste.isPending}
              onClick={() => waste.mutate({ venueId, venueProductId: p.id, quantity: Number(form[p.id]), reason: "Merma registrada desde Venue App" }, { onSuccess: () => setForm({ ...form, [p.id]: "" }) })}>
              Merma
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function CashSection({ venueId }: { venueId: number }) {
  const utils = trpc.useUtils();
  const { data: current, isLoading } = trpc.cash.currentSession.useQuery({ venueId });
  const open = trpc.cash.openSession.useMutation({ onSuccess: () => utils.cash.currentSession.invalidate() });
  const close = trpc.cash.closeSession.useMutation({ onSuccess: () => utils.cash.currentSession.invalidate() });
  const [openingCash, setOpeningCash] = useState("");
  const [countedCash, setCountedCash] = useState("");

  if (isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;

  if (!current) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <p className="text-sm text-muted-foreground">Sin sesión de caja abierta.</p>
        <div className="flex gap-2">
          <Input type="number" placeholder="Fondo de apertura (€)" value={openingCash} onChange={e => setOpeningCash(e.target.value)} />
          <Button disabled={open.isPending} onClick={() => open.mutate({ venueId, openingCashCents: Math.round(Number(openingCash || "0") * 100) })}>Abrir caja</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <p>Apertura: <strong>{centsToEuro(current.session.openingCashCents)}</strong></p>
        <p>Esperado: <strong>{centsToEuro(current.expectedCashCents)}</strong></p>
      </div>
      <div className="flex gap-2">
        <Input type="number" placeholder="Efectivo contado (€)" value={countedCash} onChange={e => setCountedCash(e.target.value)} />
        <Button disabled={!countedCash || close.isPending} onClick={() => close.mutate({ venueId, sessionId: current.session.id, countedCashCents: Math.round(Number(countedCash) * 100) })}>Cerrar caja</Button>
      </div>
    </div>
  );
}

export default function VenueAppFinance({ venueId }: { venueId: number }) {
  const [tab, setTab] = useState<"stock" | "cash">("cash");
  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2">
        <Button variant={tab === "cash" ? "default" : "outline"} size="sm" onClick={() => setTab("cash")}><Wallet className="size-4 mr-1" /> Caja</Button>
        <Button variant={tab === "stock" ? "default" : "outline"} size="sm" onClick={() => setTab("stock")}><Package className="size-4 mr-1" /> Stock</Button>
      </div>
      {tab === "cash" ? <CashSection venueId={venueId} /> : <StockSection venueId={venueId} />}
    </div>
  );
}
