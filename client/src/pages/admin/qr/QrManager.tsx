import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { QrCode, Loader2, Printer, ShieldAlert } from "lucide-react";
import { useAdminCommunity } from "@/contexts/AdminCommunityContext";
import { ADMIN_COMMUNITY_FILTER_ALL } from "@shared/segolife/adminCommunityFilter";

const ALL = "__all__";
const NONE = "__none__";

function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL: Record<string, string> = { issued: "Emitido", redeemed: "Canjeado", expired: "Caducado", cancelled: "Cancelado" };
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  issued: "secondary", redeemed: "default", expired: "outline", cancelled: "destructive",
};

// ── Vista imprimible: solo existe en el momento de emisión — el token en
// claro nunca se recupera después (ver consumptionQrService.ts). ──────────
function PrintableQrDialog({ open, onOpenChange, items }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: Array<{ token: string; venueName?: string; productName?: string | null; amountCents?: number | null; expiresAt?: string | Date | null }>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>QR generado{items.length > 1 ? "s" : ""} — imprimir ahora</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Este código solo se muestra una vez por seguridad. Imprímelo o guárdalo ahora — no podrás recuperarlo después.
        </p>
        <div id="qr-print-area" className="grid grid-cols-2 gap-4 py-2">
          {items.map((item, i) => (
            <div key={i} className="flex flex-col items-center gap-2 border border-border rounded-lg p-4 print:break-inside-avoid">
              <QRCodeSVG value={item.token} size={160} level="M" />
              {item.venueName && <p className="text-sm font-medium text-foreground">{item.venueName}</p>}
              {item.productName && <p className="text-xs text-muted-foreground">{item.productName}</p>}
              {item.amountCents != null && <p className="text-xs text-muted-foreground">{(item.amountCents / 100).toFixed(2)} €</p>}
              {item.expiresAt && <p className="text-[10px] text-muted-foreground">Caduca: {fmtDateTime(item.expiresAt)}</p>}
            </div>
          ))}
        </div>
        <Button onClick={() => window.print()} className="w-full">
          <Printer className="w-4 h-4 mr-2" /> Imprimir
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function IssueTab() {
  const { filter: communityFilter } = useAdminCommunity();
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [venueId, setVenueId] = useState<string>(NONE);
  const [productId, setProductId] = useState<string>(NONE);
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [expiresInMinutes, setExpiresInMinutes] = useState<string>(NONE);
  const [printItems, setPrintItems] = useState<Array<{ token: string; venueName?: string; productName?: string | null; amountCents?: number | null; expiresAt?: string | Date | null }>>([]);
  const [printOpen, setPrintOpen] = useState(false);

  const { data: venues } = trpc.venues.publicActive.useQuery({ communityId: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? undefined : communityFilter });
  const { data: products } = trpc.tokens.listVenueProducts.useQuery({ venueId: Number(venueId) }, { enabled: venueId !== NONE });

  const issueMut = trpc.consumptionQr.issue.useMutation({
    onSuccess: (res) => {
      const venue = (venues ?? []).find(v => v.id === Number(venueId));
      const product = (products ?? []).find(p => p.id === Number(productId));
      setPrintItems([{ token: res.publicToken, venueName: venue?.name, productName: product?.name, amountCents: res.qr.amountCents, expiresAt: res.qr.expiresAt }]);
      setPrintOpen(true);
      toast.success("QR emitido");
    },
    onError: e => toast.error(e.message),
  });

  const issueBatchMut = trpc.consumptionQr.issueBatch.useMutation({
    onSuccess: (res) => {
      const venue = (venues ?? []).find(v => v.id === Number(venueId));
      const product = (products ?? []).find(p => p.id === Number(productId));
      setPrintItems(res.qrs.map(q => ({ token: q.publicToken, venueName: venue?.name, productName: product?.name, amountCents: q.qr.amountCents, expiresAt: q.qr.expiresAt })));
      setPrintOpen(true);
      toast.success(`${res.qrs.length} QR emitidos en el lote #${res.batch.id}`);
    },
    onError: e => toast.error(e.message),
  });

  const expiresAtDate = () => {
    if (expiresInMinutes === NONE) return undefined;
    return new Date(Date.now() + Number(expiresInMinutes) * 60 * 1000);
  };

  const handleSubmit = () => {
    if (venueId === NONE) { toast.error("Selecciona un venue"); return; }
    const base = {
      venueId: Number(venueId),
      productId: productId !== NONE ? Number(productId) : undefined,
      amountCents: amount ? Math.round(Number(amount) * 100) : undefined,
      expiresAt: expiresAtDate(),
    };
    if (mode === "single") {
      issueMut.mutate(base);
    } else {
      const qty = Number(quantity);
      if (!qty || qty < 1 || qty > 500) { toast.error("Cantidad entre 1 y 500"); return; }
      issueBatchMut.mutate({ ...base, quantity: qty });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button variant={mode === "single" ? "default" : "outline"} size="sm" onClick={() => setMode("single")}>Individual</Button>
        <Button variant={mode === "batch" ? "default" : "outline"} size="sm" onClick={() => setMode("batch")}>Lote</Button>
      </div>

      <div className="bg-card border border-border rounded-lg p-5 space-y-4 max-w-xl">
        <div>
          <Label>Venue *</Label>
          <Select value={venueId} onValueChange={v => { setVenueId(v); setProductId(NONE); }}>
            <SelectTrigger><SelectValue placeholder="Selecciona un venue" /></SelectTrigger>
            <SelectContent>
              {(venues ?? []).map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Producto (opcional)</Label>
          <Select value={productId} onValueChange={setProductId} disabled={venueId === NONE}>
            <SelectTrigger><SelectValue placeholder="Sin producto" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sin producto</SelectItem>
              {(products ?? []).map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Importe € (opcional)</Label>
            <Input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="18.50" />
          </div>
          {mode === "batch" && (
            <div>
              <Label>Cantidad</Label>
              <Input type="number" min={1} max={500} value={quantity} onChange={e => setQuantity(e.target.value)} />
            </div>
          )}
        </div>
        <div>
          <Label>Caducidad</Label>
          <Select value={expiresInMinutes} onValueChange={setExpiresInMinutes}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sin caducidad</SelectItem>
              <SelectItem value="30">30 minutos</SelectItem>
              <SelectItem value="120">2 horas</SelectItem>
              <SelectItem value="480">8 horas (hasta cierre)</SelectItem>
              <SelectItem value="1440">1 día</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleSubmit} disabled={issueMut.isPending || issueBatchMut.isPending} className="w-full">
          <QrCode className="w-4 h-4 mr-2" /> {mode === "single" ? "Generar QR" : "Generar lote"}
        </Button>
      </div>

      <PrintableQrDialog open={printOpen} onOpenChange={setPrintOpen} items={printItems} />
    </div>
  );
}

function ListTab() {
  const { filter: communityFilter } = useAdminCommunity();
  const [venueId, setVenueId] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const { data: venues } = trpc.venues.publicActive.useQuery({});

  const { data, isLoading, error } = trpc.consumptionQr.list.useQuery({
    communityId: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? "all" : communityFilter,
    venueId: venueId !== ALL ? Number(venueId) : undefined,
    status: status !== ALL ? (status as "issued" | "redeemed" | "expired" | "cancelled") : undefined,
    limit: 100,
    offset: 0,
  });

  const utils = trpc.useUtils();
  const [cancelReason, setCancelReason] = useState<Record<number, string>>({});
  const cancelMut = trpc.consumptionQr.cancel.useMutation({
    onSuccess: () => { utils.consumptionQr.list.invalidate(); toast.success("QR cancelado"); },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center bg-card border border-border rounded-lg p-3">
        <Select value={venueId} onValueChange={setVenueId}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Venue" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los venues</SelectItem>
            {(venues ?? []).map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Cualquier estado</SelectItem>
            <SelectItem value="issued">Emitido</SelectItem>
            <SelectItem value="redeemed">Canjeado</SelectItem>
            <SelectItem value="expired">Caducado</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <div className="py-16 text-center text-sm text-destructive">{error.message}</div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Sin QR que coincidan con los filtros.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Importe</TableHead>
                <TableHead>Emitido</TableHead>
                <TableHead>Caduca</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Canjeado por</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map(qr => (
                <TableRow key={qr.id}>
                  <TableCell className="text-muted-foreground">#{qr.id}</TableCell>
                  <TableCell className="text-foreground">{qr.venueName}</TableCell>
                  <TableCell className="text-muted-foreground">{qr.productName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{qr.amountCents != null ? `${(qr.amountCents / 100).toFixed(2)} €` : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDateTime(qr.issuedAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDateTime(qr.expiresAt)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[qr.status]}>{STATUS_LABEL[qr.status]}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{qr.redeemedByName ?? "—"}</TableCell>
                  <TableCell>
                    {qr.status === "issued" && (
                      <div className="flex items-center gap-1">
                        <Input
                          placeholder="Motivo"
                          className="h-7 w-[110px] text-xs"
                          value={cancelReason[qr.id] ?? ""}
                          onChange={e => setCancelReason(r => ({ ...r, [qr.id]: e.target.value }))}
                        />
                        <Button
                          size="sm" variant="outline" className="h-7"
                          disabled={cancelMut.isPending || !cancelReason[qr.id]?.trim()}
                          onClick={() => cancelMut.mutate({ qrId: qr.id, reason: cancelReason[qr.id] })}
                        >
                          Cancelar
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function BatchesTab() {
  const { filter: communityFilter } = useAdminCommunity();
  const { data: batches, isLoading } = trpc.consumptionQr.listBatches.useQuery({
    communityId: communityFilter === ADMIN_COMMUNITY_FILTER_ALL ? "all" : communityFilter,
  });

  return (
    <div className="bg-card border border-border rounded-lg overflow-x-auto">
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : !batches || batches.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Sin lotes todavía.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Venue</TableHead>
              <TableHead>Cantidad</TableHead>
              <TableHead>Caduca</TableHead>
              <TableHead>Creado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map(b => (
              <TableRow key={b.id}>
                <TableCell className="text-muted-foreground">#{b.id}</TableCell>
                <TableCell className="text-foreground">{b.venueName}</TableCell>
                <TableCell className="text-muted-foreground">{b.quantity}</TableCell>
                <TableCell className="text-muted-foreground">{fmtDateTime(b.expiresAt)}</TableCell>
                <TableCell className="text-muted-foreground">{fmtDateTime(b.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function AttemptsTab() {
  const { data: attempts, isLoading } = trpc.consumptionQr.listAttempts.useQuery({ limit: 100, offset: 0 });
  const suspiciousResults = new Set(["invalid_token", "not_found", "already_redeemed", "rate_limited"]);

  return (
    <div className="bg-card border border-border rounded-lg overflow-x-auto">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-amber-500" />
        <p className="text-sm text-muted-foreground">Registro de auditoría de todos los intentos de canje — éxito y fallo.</p>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : !attempts || attempts.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Sin intentos registrados todavía.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>QR</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attempts.map(a => (
              <TableRow key={a.id} className={suspiciousResults.has(a.result) ? "bg-destructive/5" : undefined}>
                <TableCell className="text-muted-foreground">{fmtDateTime(a.createdAt)}</TableCell>
                <TableCell className="text-muted-foreground">{a.qrId ? `#${a.qrId}` : "—"}</TableCell>
                <TableCell className="text-muted-foreground">{a.userId ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={a.result === "success" ? "default" : suspiciousResults.has(a.result) ? "destructive" : "outline"}>
                    {a.result}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">{a.ipAddress ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export default function QrManager() {
  return (
    <AdminLayout title="QR de consumición">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <QrCode className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">QR de consumición</h2>
            <p className="text-sm text-muted-foreground">Emisión, lotes, canjes y auditoría antifraude.</p>
          </div>
        </div>

        <Tabs defaultValue="generar">
          <TabsList>
            <TabsTrigger value="generar">Generar</TabsTrigger>
            <TabsTrigger value="listado">Listado</TabsTrigger>
            <TabsTrigger value="batches">Batches</TabsTrigger>
            <TabsTrigger value="intentos">Intentos</TabsTrigger>
          </TabsList>
          <TabsContent value="generar"><IssueTab /></TabsContent>
          <TabsContent value="listado"><ListTab /></TabsContent>
          <TabsContent value="batches"><BatchesTab /></TabsContent>
          <TabsContent value="intentos"><AttemptsTab /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
