import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ShoppingCart, Minus, Plus, QrCode, X, User, CheckCircle2 } from "lucide-react";

/**
 * POS nativo mínimo — /staff/pos (Fase 8, spec puntos 19-24). NO es un ERP:
 * sin fiscalidad, sin caja, sin factura. Solo registra una venta en
 * EFECTIVO que el propio staff presencia — nunca simula un pago digital
 * (no hay ningún PaymentProvider real conectado). La identificación del
 * estudiante (QR de identidad, distinto de Benefits/Consumption/Ticket) es
 * SIEMPRE opcional: sin ella, la venta sigue siendo válida pero no genera
 * loyalty personal (ver nativeCommerceService.ts).
 */

const SCAN_REGION_ID = "segolife-pos-identity-scan-region";

export default function StaffPos() {
  const { t } = useTranslation();
  const [venueId, setVenueId] = useState<string>("");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [identifiedToken, setIdentifiedToken] = useState<string | null>(null);
  const [identifyMode, setIdentifyMode] = useState<"idle" | "scanning" | "manual">("idle");
  const [manualToken, setManualToken] = useState("");
  const [lastSaleAt, setLastSaleAt] = useState<number | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  const { data: authorized } = trpc.commerce.myAuthorizedVenuesForPos.useQuery();
  const { data: allVenues } = trpc.venues.publicActive.useQuery({}, { enabled: !!authorized?.all });
  const venueOptions = authorized?.all
    ? (allVenues ?? []).map(v => ({ id: v.id, name: v.name }))
    : (allVenues ?? []).filter(v => authorized?.venueIds.includes(v.id)).map(v => ({ id: v.id, name: v.name }));

  const { data: products, isLoading: productsLoading } = trpc.commerce.posProducts.useQuery(
    { venueId: Number(venueId) },
    { enabled: !!venueId }
  );

  const { data: identifiedStudent, isFetching: identifying, error: identifyError } = trpc.commerce.posIdentifyStudent.useQuery(
    { token: identifiedToken ?? "" },
    { enabled: !!identifiedToken }
  );

  const recordSaleMut = trpc.commerce.posRecordSale.useMutation({
    onSuccess: () => {
      toast.success(t("pos.saleRecorded"));
      setCart({});
      setIdentifiedToken(null);
      setLastSaleAt(Date.now());
    },
    onError: e => toast.error(e.message),
  });

  async function stopScanner() {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); scannerRef.current.clear(); } catch { /* ya detenido */ }
      scannerRef.current = null;
    }
  }
  useEffect(() => () => { void stopScanner(); }, []);

  async function startIdentifyScan() {
    setIdentifyMode("scanning");
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(SCAN_REGION_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        (decodedText: string) => { void stopScanner(); setIdentifiedToken(decodedText); setIdentifyMode("idle"); },
        () => { /* frame sin QR */ }
      );
    } catch {
      setIdentifyMode("manual");
    }
  }

  const setQty = (productId: number, delta: number) => {
    setCart(c => {
      const next = Math.max(0, (c[productId] ?? 0) + delta);
      const copy = { ...c };
      if (next === 0) delete copy[productId]; else copy[productId] = next;
      return copy;
    });
  };

  const cartItems = Object.entries(cart).map(([id, quantity]) => ({ venueProductId: Number(id), quantity }));
  const totalCents = cartItems.reduce((sum, item) => {
    const product = products?.find(p => p.id === item.venueProductId);
    return sum + Math.round(Number(product?.price ?? "0") * 100) * item.quantity;
  }, 0);

  const handleRecordSale = () => {
    if (!venueId || !cartItems.length) return;
    recordSaleMut.mutate({
      venueId: Number(venueId),
      items: cartItems,
      identifiedUserId: identifiedStudent?.userId ?? null,
      idempotencyKey: `pos:${venueId}:${crypto.randomUUID()}`,
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-8">
      <div className="mx-auto w-full max-w-sm space-y-5">
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2">
            <ShoppingCart className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-semibold">{t("pos.title")}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t("pos.subtitle")}</p>
        </div>

        <Select value={venueId} onValueChange={v => { setVenueId(v); setCart({}); }}>
          <SelectTrigger><SelectValue placeholder={t("pos.venuePlaceholder")} /></SelectTrigger>
          <SelectContent>
            {venueOptions.map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>

        {venueId && (
          <>
            {productsLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : !products?.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("pos.noProducts")}</p>
            ) : (
              <div className="space-y-1.5">
                {products.map(p => {
                  const qty = cart[p.id] ?? 0;
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.price ? `${Number(p.price).toFixed(2)} €` : "—"}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button size="icon" variant="outline" className="size-7" disabled={qty === 0} onClick={() => setQty(p.id, -1)}><Minus className="size-3.5" /></Button>
                        <span className="w-4 text-center text-sm font-semibold tabular-nums">{qty}</span>
                        <Button size="icon" variant="outline" className="size-7" onClick={() => setQty(p.id, 1)}><Plus className="size-3.5" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="rounded-lg border border-dashed border-border p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 font-medium"><User className="size-4" /> {t("pos.studentLabel")}</span>
                {identifiedToken && <button onClick={() => setIdentifiedToken(null)}><X className="size-4 text-muted-foreground" /></button>}
              </div>
              {identifiedToken ? (
                identifying ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t("common.loading")}</p>
                ) : identifyError ? (
                  <p className="mt-1 text-xs text-destructive">{identifyError.message}</p>
                ) : identifiedStudent ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="size-3.5" /> {identifiedStudent.name}</p>
                ) : null
              ) : identifyMode === "scanning" ? (
                <div className="mt-2 space-y-2">
                  <div id={SCAN_REGION_ID} className="aspect-square w-full overflow-hidden rounded-lg bg-black" />
                  <Button variant="outline" size="sm" className="w-full" onClick={() => { void stopScanner(); setIdentifyMode("idle"); }}>{t("common.back")}</Button>
                </div>
              ) : identifyMode === "manual" ? (
                <div className="mt-2 flex gap-2">
                  <Input autoFocus placeholder={t("pos.identifyManualPlaceholder")} value={manualToken} onChange={e => setManualToken(e.target.value)} />
                  <Button size="sm" disabled={!manualToken.trim()} onClick={() => { setIdentifiedToken(manualToken.trim()); setIdentifyMode("idle"); }}>{t("pos.identifyConfirm")}</Button>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={startIdentifyScan}><QrCode className="mr-1.5 size-3.5" /> {t("pos.identifyScan")}</Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setIdentifyMode("manual")}>{t("pos.identifyManual")}</Button>
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground">{t("pos.studentOptionalNote")}</p>
            </div>

            <div className="flex items-center justify-between border-t border-border pt-3 text-sm font-semibold">
              <span>{t("ticketing.orderTotal")}</span>
              <span className="tabular-nums">{(totalCents / 100).toFixed(2)} €</span>
            </div>

            <Button className="w-full h-12" disabled={!cartItems.length || recordSaleMut.isPending} onClick={handleRecordSale}>
              {recordSaleMut.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {t("pos.recordSaleButton")}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">{t("pos.cashOnlyNote")}</p>
          </>
        )}
      </div>
    </div>
  );
}
