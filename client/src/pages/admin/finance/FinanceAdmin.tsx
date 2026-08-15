/**
 * FinanceAdmin.tsx — SEGOLIFE FASE 10 (spec §26/§80/§115/§117). "Finanzas /
 * Control" — Facturación, Stock, Caja y Liquidaciones. GLOBAL_ADMIN
 * exclusivamente (Venue App tiene su propia superficie operativa acotada a
 * stock/caja del propio venue — ver VenueAppFinance.tsx).
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

function centsToEuro(cents: number | null | undefined) {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function fmtDateTime(d: string | Date) {
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

// ─── Facturación ────────────────────────────────────────────────────────────

function EntitiesPanel() {
  const utils = trpc.useUtils();
  const { data: entities, isLoading } = trpc.fiscal.listEntities.useQuery();
  const upsert = trpc.fiscal.upsertEntity.useMutation({ onSuccess: () => utils.fiscal.listEntities.invalidate() });
  const [form, setForm] = useState({ legalName: "", taxId: "", tradeName: "", fiscalAddress: "" });

  return (
    <Section title="Entidades comerciales (vendedores)">
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Nombre legal</TableHead><TableHead>Nombre comercial</TableHead><TableHead>CIF/NIF</TableHead><TableHead>Activa</TableHead></TableRow></TableHeader>
          <TableBody>
            {(entities ?? []).map(e => (
              <TableRow key={e.id}>
                <TableCell>{e.legalName}</TableCell><TableCell>{e.tradeName ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{e.taxId}</TableCell>
                <TableCell><Badge variant={e.active ? "default" : "outline"}>{e.active ? "Sí" : "No"}</Badge></TableCell>
              </TableRow>
            ))}
            {!entities?.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-sm">Sin entidades configuradas todavía.</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-border">
        <Input placeholder="Nombre legal" value={form.legalName} onChange={e => setForm({ ...form, legalName: e.target.value })} />
        <Input placeholder="Nombre comercial" value={form.tradeName} onChange={e => setForm({ ...form, tradeName: e.target.value })} />
        <Input placeholder="CIF/NIF" value={form.taxId} onChange={e => setForm({ ...form, taxId: e.target.value })} />
        <Input placeholder="Dirección fiscal" value={form.fiscalAddress} onChange={e => setForm({ ...form, fiscalAddress: e.target.value })} />
        <Button
          disabled={!form.legalName || !form.taxId || upsert.isPending}
          onClick={() => upsert.mutate({ legalName: form.legalName, taxId: form.taxId, tradeName: form.tradeName || null, fiscalAddress: form.fiscalAddress || null }, { onSuccess: () => setForm({ legalName: "", taxId: "", tradeName: "", fiscalAddress: "" }) })}
        >
          Crear entidad
        </Button>
      </div>
    </Section>
  );
}

function VenueSellerPanel() {
  const { data: venuesResult } = trpc.venues.list.useQuery({});
  const venues = venuesResult?.items;
  const { data: entities } = trpc.fiscal.listEntities.useQuery();
  const [venueId, setVenueId] = useState<string>("");
  const { data: config } = trpc.fiscal.getVenueSellerConfig.useQuery({ venueId: Number(venueId) }, { enabled: !!venueId });
  const utils = trpc.useUtils();
  const set = trpc.fiscal.setVenueSellerConfig.useMutation({ onSuccess: () => utils.fiscal.getVenueSellerConfig.invalidate() });
  const [sellerEntityId, setSellerEntityId] = useState<string>("");

  return (
    <Section title="Vendedor por venue">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <Select value={venueId} onValueChange={setVenueId}>
          <SelectTrigger><SelectValue placeholder="Selecciona un venue" /></SelectTrigger>
          <SelectContent>{(venues ?? []).map((v: { id: number; name: string }) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={sellerEntityId} onValueChange={setSellerEntityId} disabled={!venueId}>
          <SelectTrigger><SelectValue placeholder="Entidad vendedora" /></SelectTrigger>
          <SelectContent>{(entities ?? []).map(e => <SelectItem key={e.id} value={String(e.id)}>{e.legalName}</SelectItem>)}</SelectContent>
        </Select>
        <Button disabled={!venueId || !sellerEntityId || set.isPending} onClick={() => set.mutate({ venueId: Number(venueId), sellerEntityId: Number(sellerEntityId) })}>
          Asignar vendedor
        </Button>
      </div>
      {venueId && (
        <p className="text-xs text-muted-foreground">
          Configuración actual: {config ? `entidad #${config.sellerEntityId}${config.collectorEntityId ? ` (cobra #${config.collectorEntityId})` : " (cobra ella misma)"}` : "sin configurar todavía"}
        </p>
      )}
    </Section>
  );
}

function TaxRatesPanel() {
  const utils = trpc.useUtils();
  const { data: rates, isLoading } = trpc.fiscal.listTaxRates.useQuery();
  const upsert = trpc.fiscal.upsertTaxRate.useMutation({ onSuccess: () => utils.fiscal.listTaxRates.invalidate() });
  const [form, setForm] = useState({ name: "", percent: "" });

  return (
    <Section title="Tipos de IVA">
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Tipo</TableHead><TableHead>País</TableHead></TableRow></TableHeader>
          <TableBody>
            {(rates ?? []).map(r => (
              <TableRow key={r.id}><TableCell>{r.name}</TableCell><TableCell>{(r.rateBasisPoints / 100).toFixed(2)}%</TableCell><TableCell>{r.country}</TableCell></TableRow>
            ))}
            {!rates?.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground text-sm">Sin tipos de IVA configurados todavía.</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
        <Input placeholder="Nombre (ej. IVA General)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <Input placeholder="% (ej. 21)" type="number" step="0.01" value={form.percent} onChange={e => setForm({ ...form, percent: e.target.value })} />
        <Button
          disabled={!form.name || !form.percent || upsert.isPending}
          onClick={() => upsert.mutate({ name: form.name, rateBasisPoints: Math.round(Number(form.percent) * 100) }, { onSuccess: () => setForm({ name: "", percent: "" }) })}
        >
          Crear tipo
        </Button>
      </div>
    </Section>
  );
}

function SeriesPanel() {
  const { data: entities } = trpc.fiscal.listEntities.useQuery();
  const utils = trpc.useUtils();
  const { data: series, isLoading } = trpc.fiscal.listSeries.useQuery({});
  const upsert = trpc.fiscal.upsertSeries.useMutation({ onSuccess: () => utils.fiscal.listSeries.invalidate() });
  const [form, setForm] = useState({ sellerEntityId: "", documentType: "invoice" as "invoice" | "credit_note", code: "" });

  return (
    <Section title="Series de facturación">
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Tipo</TableHead><TableHead>Entidad</TableHead></TableRow></TableHeader>
          <TableBody>
            {(series ?? []).map(s => (
              <TableRow key={s.id}><TableCell className="font-mono">{s.code}</TableCell><TableCell>{s.documentType === "invoice" ? "Factura" : "Abono"}</TableCell><TableCell>{entities?.find(e => e.id === s.sellerEntityId)?.legalName ?? s.sellerEntityId}</TableCell></TableRow>
            ))}
            {!series?.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground text-sm">Sin series configuradas todavía.</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}
      <div className="grid grid-cols-4 gap-2 pt-2 border-t border-border">
        <Select value={form.sellerEntityId} onValueChange={v => setForm({ ...form, sellerEntityId: v })}>
          <SelectTrigger><SelectValue placeholder="Entidad" /></SelectTrigger>
          <SelectContent>{(entities ?? []).map(e => <SelectItem key={e.id} value={String(e.id)}>{e.legalName}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={form.documentType} onValueChange={v => setForm({ ...form, documentType: v as "invoice" | "credit_note" })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="invoice">Factura</SelectItem><SelectItem value="credit_note">Abono</SelectItem></SelectContent>
        </Select>
        <Input placeholder="Código (ej. SEG)" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
        <Button
          disabled={!form.sellerEntityId || !form.code || upsert.isPending}
          onClick={() => upsert.mutate({ sellerEntityId: Number(form.sellerEntityId), documentType: form.documentType, code: form.code }, { onSuccess: () => setForm({ ...form, code: "" }) })}
        >
          Crear serie
        </Button>
      </div>
    </Section>
  );
}

function DocumentsPanel() {
  const { data: documents, isLoading } = trpc.fiscal.listDocuments.useQuery({});
  return (
    <Section title="Facturas y abonos emitidos">
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Número</TableHead><TableHead>Tipo</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">IVA</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {(documents ?? []).map(d => (
              <TableRow key={d.id}>
                <TableCell className="font-mono text-xs">{d.documentNumber}</TableCell>
                <TableCell><Badge variant="outline">{d.documentType === "invoice" ? "Factura" : "Abono"}</Badge></TableCell>
                <TableCell className="text-xs">{fmtDateTime(d.issueDate)}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">{centsToEuro(d.taxBaseCents)}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">{centsToEuro(d.taxAmountCents)}</TableCell>
                <TableCell className="text-right tabular-nums text-xs font-semibold">{centsToEuro(d.totalCents)}</TableCell>
              </TableRow>
            ))}
            {!documents?.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground text-sm">Sin documentos emitidos todavía.</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

function IssueInvoicePanel() {
  const { data: allSeries } = trpc.fiscal.listSeries.useQuery({});
  const series = allSeries?.filter(s => s.documentType === "invoice");
  const utils = trpc.useUtils();
  const issue = trpc.fiscal.issueInvoice.useMutation({ onSuccess: () => { utils.fiscal.listDocuments.invalidate(); setResult("Factura emitida correctamente."); } });
  const [form, setForm] = useState({ sourceType: "commerce_transaction" as "commerce_transaction" | "ticket_order", sourceId: "", seriesId: "" });
  const [result, setResult] = useState<string | null>(null);

  return (
    <Section title="Emitir factura desde una venta">
      <p className="text-xs text-muted-foreground">Introduce el ID de la venta nativa (commerce_transaction o ticket_order) desde su detalle en Ventas y Operaciones.</p>
      <div className="grid grid-cols-4 gap-2">
        <Select value={form.sourceType} onValueChange={v => setForm({ ...form, sourceType: v as "commerce_transaction" | "ticket_order" })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="commerce_transaction">Venta POS</SelectItem><SelectItem value="ticket_order">Pedido de entradas</SelectItem></SelectContent>
        </Select>
        <Input placeholder="ID de la venta" type="number" value={form.sourceId} onChange={e => setForm({ ...form, sourceId: e.target.value })} />
        <Select value={form.seriesId} onValueChange={v => setForm({ ...form, seriesId: v })}>
          <SelectTrigger><SelectValue placeholder="Serie" /></SelectTrigger>
          <SelectContent>{(series ?? []).map(s => <SelectItem key={s.id} value={String(s.id)}>{s.code}</SelectItem>)}</SelectContent>
        </Select>
        <Button
          disabled={!form.sourceId || !form.seriesId || issue.isPending}
          onClick={() => { setResult(null); issue.mutate({ sourceType: form.sourceType, sourceId: Number(form.sourceId), seriesId: Number(form.seriesId) }); }}
        >
          Emitir factura
        </Button>
      </div>
      {issue.error && <p className="text-sm text-destructive">{issue.error.message}</p>}
      {result && <p className="text-sm text-green-600">{result}</p>}
    </Section>
  );
}

function FacturacionTab() {
  return (
    <div className="space-y-4">
      <EntitiesPanel />
      <VenueSellerPanel />
      <TaxRatesPanel />
      <SeriesPanel />
      <IssueInvoicePanel />
      <DocumentsPanel />
    </div>
  );
}

// ─── Stock ──────────────────────────────────────────────────────────────────

function StockTab() {
  const { data: venuesResult } = trpc.venues.list.useQuery({});
  const venues = venuesResult?.items;
  const [venueId, setVenueId] = useState<string>("");
  const utils = trpc.useUtils();
  const { data: products, isLoading } = trpc.stock.listProducts.useQuery({ venueId: Number(venueId) }, { enabled: !!venueId });
  const { data: lowStock } = trpc.stock.lowStock.useQuery({ venueId: Number(venueId) }, { enabled: !!venueId });
  const waste = trpc.stock.recordWaste.useMutation({ onSuccess: () => utils.stock.listProducts.invalidate() });
  const adjust = trpc.stock.recordAdjustment.useMutation({ onSuccess: () => utils.stock.listProducts.invalidate() });
  const [form, setForm] = useState<Record<number, { qty: string; reason: string }>>({});

  return (
    <div className="space-y-4">
      <Select value={venueId} onValueChange={setVenueId}>
        <SelectTrigger className="w-64"><SelectValue placeholder="Selecciona un venue" /></SelectTrigger>
        <SelectContent>{(venues ?? []).map((v: { id: number; name: string }) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
      </Select>

      {!venueId ? <p className="text-sm text-muted-foreground">Selecciona un venue para ver su stock.</p> : isLoading ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
        <>
          {!!lowStock?.length && (
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-800 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Stock bajo: {lowStock.map(p => p.name).join(", ")}</p>
            </div>
          )}
          <Table>
            <TableHeader><TableRow><TableHead>Producto</TableHead><TableHead className="text-right">Stock actual</TableHead><TableHead>Cantidad</TableHead><TableHead>Motivo</TableHead><TableHead>Acciones</TableHead></TableRow></TableHeader>
            <TableBody>
              {(products ?? []).map(p => {
                const f = form[p.id] ?? { qty: "", reason: "" };
                return (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{p.currentStockCached ?? 0}</TableCell>
                    <TableCell><Input className="w-20" type="number" value={f.qty} onChange={e => setForm({ ...form, [p.id]: { ...f, qty: e.target.value } })} /></TableCell>
                    <TableCell><Input className="w-40" placeholder="Motivo" value={f.reason} onChange={e => setForm({ ...form, [p.id]: { ...f, reason: e.target.value } })} /></TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="sm" variant="outline" disabled={!f.qty || !f.reason || waste.isPending}
                        onClick={() => waste.mutate({ venueId: Number(venueId), venueProductId: p.id, quantity: Number(f.qty), reason: f.reason })}>Merma</Button>
                      <Button size="sm" variant="outline" disabled={!f.qty || !f.reason || adjust.isPending}
                        onClick={() => adjust.mutate({ venueId: Number(venueId), venueProductId: p.id, delta: Number(f.qty), reason: f.reason })}>Ajuste +</Button>
                      <Button size="sm" variant="outline" disabled={!f.qty || !f.reason || adjust.isPending}
                        onClick={() => adjust.mutate({ venueId: Number(venueId), venueProductId: p.id, delta: -Number(f.qty), reason: f.reason })}>Ajuste −</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!products?.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-sm">Ningún producto de este venue lleva control de stock todavía (configúralo en Productos SegoTokens).</TableCell></TableRow>}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}

// ─── Caja ───────────────────────────────────────────────────────────────────

function CashTab() {
  const { data: venuesResult } = trpc.venues.list.useQuery({});
  const venues = venuesResult?.items;
  const [venueId, setVenueId] = useState<string>("");
  const utils = trpc.useUtils();
  const { data: current, isLoading } = trpc.cash.currentSession.useQuery({ venueId: Number(venueId) }, { enabled: !!venueId });
  const { data: history } = trpc.cash.history.useQuery({ venueId: Number(venueId) }, { enabled: !!venueId });
  const open = trpc.cash.openSession.useMutation({ onSuccess: () => utils.cash.currentSession.invalidate() });
  const close = trpc.cash.closeSession.useMutation({ onSuccess: () => { utils.cash.currentSession.invalidate(); utils.cash.history.invalidate(); } });
  const [openingCash, setOpeningCash] = useState("");
  const [countedCash, setCountedCash] = useState("");

  return (
    <div className="space-y-4">
      <Select value={venueId} onValueChange={setVenueId}>
        <SelectTrigger className="w-64"><SelectValue placeholder="Selecciona un venue" /></SelectTrigger>
        <SelectContent>{(venues ?? []).map((v: { id: number; name: string }) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
      </Select>

      {!venueId ? <p className="text-sm text-muted-foreground">Selecciona un venue.</p> : isLoading ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
        <Section title={current ? "Sesión de caja abierta" : "Sin sesión de caja abierta"}>
          {current ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <p>Apertura: <strong>{centsToEuro(current.session.openingCashCents)}</strong></p>
                <p>Ventas en efectivo: <strong>{centsToEuro(current.salesCashCents)}</strong></p>
                <p>Devoluciones: <strong>−{centsToEuro(current.refundsCashCents)}</strong></p>
                <p>Efectivo esperado: <strong>{centsToEuro(current.expectedCashCents)}</strong></p>
              </div>
              <div className="flex gap-2 items-end pt-2 border-t border-border">
                <div><Label className="text-xs">Efectivo contado</Label><Input type="number" value={countedCash} onChange={e => setCountedCash(e.target.value)} className="w-40" /></div>
                <Button disabled={!countedCash || close.isPending} onClick={() => close.mutate({ venueId: Number(venueId), sessionId: current.session.id, countedCashCents: Math.round(Number(countedCash) * 100) })}>
                  Cerrar caja
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 items-end">
              <div><Label className="text-xs">Fondo de apertura</Label><Input type="number" value={openingCash} onChange={e => setOpeningCash(e.target.value)} className="w-40" /></div>
              <Button disabled={open.isPending} onClick={() => open.mutate({ venueId: Number(venueId), openingCashCents: Math.round(Number(openingCash || "0") * 100) })}>
                Abrir caja
              </Button>
            </div>
          )}
        </Section>
      )}

      {!!venueId && !!history?.length && (
        <Section title="Historial de cierres">
          <Table>
            <TableHeader><TableRow><TableHead>Apertura</TableHead><TableHead>Cierre</TableHead><TableHead className="text-right">Esperado</TableHead><TableHead className="text-right">Contado</TableHead><TableHead className="text-right">Diferencia</TableHead></TableRow></TableHeader>
            <TableBody>
              {history.filter(s => s.status === "closed").map(s => (
                <TableRow key={s.id}>
                  <TableCell className="text-xs">{fmtDateTime(s.openedAt)}</TableCell>
                  <TableCell className="text-xs">{s.closedAt ? fmtDateTime(s.closedAt) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{centsToEuro(s.expectedCashCents)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{centsToEuro(s.countedCashCents)}</TableCell>
                  <TableCell className={`text-right tabular-nums text-xs font-semibold ${(s.differenceCents ?? 0) < 0 ? "text-destructive" : ""}`}>{centsToEuro(s.differenceCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </div>
  );
}

// ─── Liquidaciones ──────────────────────────────────────────────────────────

function SettlementsTab() {
  const { data: venuesResult } = trpc.venues.list.useQuery({});
  const venues = venuesResult?.items;
  const [venueId, setVenueId] = useState<string>("");
  const utils = trpc.useUtils();
  const { data: agreement } = trpc.venueSettlements.resolveAgreement.useQuery({ venueId: Number(venueId) }, { enabled: !!venueId });
  const upsertAgreement = trpc.venueSettlements.upsertAgreement.useMutation({ onSuccess: () => utils.venueSettlements.resolveAgreement.invalidate() });
  const { data: settlements } = trpc.venueSettlements.list.useQuery({ venueId: venueId ? Number(venueId) : undefined });
  const calculate = trpc.venueSettlements.calculate.useMutation({ onSuccess: () => utils.venueSettlements.list.invalidate() });
  const approve = trpc.venueSettlements.approve.useMutation({ onSuccess: () => utils.venueSettlements.list.invalidate() });
  const markPaid = trpc.venueSettlements.markPaid.useMutation({ onSuccess: () => utils.venueSettlements.list.invalidate() });

  const [commissionPercent, setCommissionPercent] = useState("");
  const today = new Date();
  const [periodStart, setPeriodStart] = useState(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(today.toISOString().slice(0, 10));

  return (
    <div className="space-y-4">
      <Select value={venueId} onValueChange={setVenueId}>
        <SelectTrigger className="w-64"><SelectValue placeholder="Selecciona un venue" /></SelectTrigger>
        <SelectContent>{(venues ?? []).map((v: { id: number; name: string }) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
      </Select>

      {!!venueId && (
        <Section title="Acuerdo comercial">
          <p className="text-xs text-muted-foreground">
            {agreement ? `Comisión: ${(agreement.commissionBasisPoints / 100).toFixed(2)}% (${agreement.commissionModel})` : "Sin acuerdo configurado — se asumirá comisión 0."}
          </p>
          <div className="flex gap-2 items-end">
            <div><Label className="text-xs">Comisión plataforma (%)</Label><Input type="number" step="0.01" value={commissionPercent} onChange={e => setCommissionPercent(e.target.value)} className="w-32" /></div>
            <Button disabled={!commissionPercent || upsertAgreement.isPending} onClick={() => upsertAgreement.mutate({ venueId: Number(venueId), commissionModel: "platform_commission_percent", commissionBasisPoints: Math.round(Number(commissionPercent) * 100) })}>
              Guardar acuerdo
            </Button>
          </div>
        </Section>
      )}

      {!!venueId && (
        <Section title="Calcular liquidación">
          <div className="flex gap-2 items-end">
            <div><Label className="text-xs">Desde</Label><Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} /></div>
            <div><Label className="text-xs">Hasta</Label><Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} /></div>
            <Button disabled={calculate.isPending} onClick={() => calculate.mutate({ venueId: Number(venueId), periodStart: new Date(periodStart + "T00:00:00"), periodEnd: new Date(periodEnd + "T23:59:59") })}>
              Calcular
            </Button>
          </div>
          {calculate.error && <p className="text-sm text-destructive">{calculate.error.message}</p>}
        </Section>
      )}

      <Section title="Liquidaciones">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Periodo</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Bruto</TableHead><TableHead className="text-right">Comisión</TableHead><TableHead className="text-right">A pagar al venue</TableHead><TableHead>Acciones</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {(settlements ?? []).map(s => (
              <TableRow key={s.id}>
                <TableCell className="text-xs">{new Date(s.periodStart).toLocaleDateString("es-ES")} – {new Date(s.periodEnd).toLocaleDateString("es-ES")}</TableCell>
                <TableCell><Badge variant="outline">{s.status}</Badge></TableCell>
                <TableCell className="text-right tabular-nums text-xs">{centsToEuro(s.grossSalesCents)}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">{centsToEuro(s.commissionCents)}</TableCell>
                <TableCell className={`text-right tabular-nums text-xs font-semibold ${s.netPayableToVenueCents < 0 ? "text-destructive" : ""}`}>{centsToEuro(s.netPayableToVenueCents)}</TableCell>
                <TableCell className="flex gap-1">
                  {s.status === "calculated" && <Button size="sm" variant="outline" onClick={() => approve.mutate({ settlementId: s.id })}>Aprobar</Button>}
                  {s.status === "approved" && <Button size="sm" variant="outline" onClick={() => markPaid.mutate({ settlementId: s.id })}>Marcar pagada</Button>}
                </TableCell>
              </TableRow>
            ))}
            {!settlements?.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground text-sm">Sin liquidaciones todavía.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Section>
    </div>
  );
}

export default function FinanceAdmin() {
  return (
    <AdminLayout title="Finanzas / Control">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Finanzas / Control</h1>
          <p className="text-sm text-muted-foreground">Facturación, stock, caja y liquidaciones — capa financiera sobre Ventas y Operaciones.</p>
        </div>
        <Tabs defaultValue="facturacion">
          <TabsList>
            <TabsTrigger value="facturacion">Facturación</TabsTrigger>
            <TabsTrigger value="stock">Stock</TabsTrigger>
            <TabsTrigger value="caja">Caja</TabsTrigger>
            <TabsTrigger value="liquidaciones">Liquidaciones</TabsTrigger>
          </TabsList>
          <TabsContent value="facturacion" className="mt-4"><FacturacionTab /></TabsContent>
          <TabsContent value="stock" className="mt-4"><StockTab /></TabsContent>
          <TabsContent value="caja" className="mt-4"><CashTab /></TabsContent>
          <TabsContent value="liquidaciones" className="mt-4"><SettlementsTab /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
