import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Loader2, ShoppingCart, Minus, Plus, QrCode, X, User, CheckCircle2, Coins,
  Search, Gift, CreditCard, Banknote, Receipt, History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import VenueAppPosHistory from "./VenueAppPosHistory";

/**
 * VenueAppPos.tsx — SEGOLIFE VENUE BAR POS & LIVE COMMERCE TERMINAL (Fase
 * 10.7). Terminal REAL de barra — drinks/comida/merchandising, independiente
 * de si hay un evento activo (spec §39: "Tía Felisa debe poder vender un
 * drink a las 19:00 aunque no exista ningún Evento SEGOLIFE configurado").
 *
 * DISTINTO de "Entradas" (VenueAppSales.tsx, venta de puerta) — nunca el
 * mismo flujo (spec §0). Motor de datos REUTILIZADO tal cual de la Fase 8
 * (nativeCommerceService.ts vía commerce.pos*) — este archivo es solo la
 * capa de presentación táctil/rápida; ninguna tasa/regla se calcula aquí,
 * todo lo económico viene ya resuelto del servidor (SegoTokens, previews,
 * catálogo, stock).
 */

const SCAN_REGION_ID = "segolife-tpv-identity-scan-region";
const BENEFIT_SCAN_REGION_ID = "segolife-tpv-benefit-scan-region";

function euro(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

type IdentifyMode = "idle" | "scanning" | "manual";

function useQrScanner(regionId: string, onDecoded: (text: string) => void) {
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const [mode, setMode] = useState<IdentifyMode>("idle");

  async function stop() {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); scannerRef.current.clear(); } catch { /* ya detenido */ }
      scannerRef.current = null;
    }
  }
  useEffect(() => () => { void stop(); }, []);

  async function start() {
    setMode("scanning");
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(regionId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        (decodedText: string) => { void stop(); onDecoded(decodedText); setMode("idle"); },
        () => { /* frame sin QR */ }
      );
    } catch {
      setMode("manual");
    }
  }

  return { mode, setMode, start, stop };
}

export default function VenueAppPos({ venueId }: { venueId: number }) {
  const [view, setView] = useState<"sell" | "history">("sell");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [identifiedToken, setIdentifiedToken] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [tokensToApply, setTokensToApply] = useState("");
  const [moneyMethod, setMoneyMethod] = useState<"cash" | "card">("cash");
  const [lastSale, setLastSale] = useState<{ totalCents: number; tokensSpent: number; promotionalValueCents: number; moneyDueCents: number; moneyMethod: "cash" | "card"; studentName: string | null; tokensEarned: number | null; transactionId: number | null } | null>(null);
  const [benefitManualToken, setBenefitManualToken] = useState("");

  const identify = useQrScanner(SCAN_REGION_ID, setIdentifiedToken);
  const benefitScan = useQrScanner(BENEFIT_SCAN_REGION_ID, token => { void redeemBenefitMut.mutate({ token, venueId }); });

  const utils = trpc.useUtils();

  const { data: products, isLoading: productsLoading } = trpc.commerce.posProducts.useQuery({ venueId });

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const p of products ?? []) if (p.category) names.add(p.category);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (products ?? []).filter(p => (!category || p.category === category) && (!q || p.name.toLowerCase().includes(q)));
  }, [products, category, search]);

  const { data: identifiedStudent, isFetching: identifying, error: identifyError } = trpc.commerce.posIdentifyStudent.useQuery(
    { token: identifiedToken ?? "" },
    { enabled: !!identifiedToken }
  );

  const cartItems = Object.entries(cart).map(([id, quantity]) => ({ venueProductId: Number(id), quantity }));
  const totalCents = cartItems.reduce((sum, item) => {
    const product = products?.find(p => p.id === item.venueProductId);
    return sum + Math.round(Number(product?.price ?? "0") * 100) * item.quantity;
  }, 0);

  const requestedTokensNum = Number(tokensToApply) || 0;
  const { data: tokenQuote, isFetching: quoting } = trpc.commerce.posQuoteTokenSpend.useQuery(
    { venueId, items: cartItems, identifiedUserId: identifiedStudent?.userId ?? 0, requestedTokens: requestedTokensNum },
    { enabled: !!identifiedStudent && cartItems.length > 0 && requestedTokensNum > 0 }
  );

  const moneyDueCents = tokenQuote?.eligible && requestedTokensNum > 0 ? tokenQuote.moneyDueCents : totalCents;

  // SEGOTOKENS REWARD PREVIEW (Fase 10.6/10.7, spec §11) — SOLO informativo,
  // nunca calculado aquí: reutiliza el mismo read model de previewMyReward,
  // llamado con el userId del Student YA identificado por el staff.
  const { data: rewardPreview } = trpc.commerce.posPreviewReward.useQuery(
    { venueId, identifiedUserId: identifiedStudent?.userId ?? 0, amountSpent: moneyDueCents / 100 },
    { enabled: !!identifiedStudent && cartItems.length > 0 }
  );

  const receiptQ = trpc.commerce.posReceiptItems.useQuery(
    { transactionId: lastSale?.transactionId ?? 0 },
    { enabled: !!lastSale?.transactionId }
  );

  const recordSaleMut = trpc.commerce.posRecordSale.useMutation({
    onSuccess: result => {
      setLastSale({
        totalCents,
        tokensSpent: tokenQuote?.eligible ? tokenQuote.tokensToSpend : 0,
        promotionalValueCents: tokenQuote?.eligible ? tokenQuote.promotionalValueCents : 0,
        moneyDueCents,
        moneyMethod,
        studentName: identifiedStudent?.name ?? null,
        tokensEarned: "tokensEarned" in result ? result.tokensEarned : null,
        transactionId: "transaction" in result ? result.transaction.id : null,
      });
      setCart({});
      setIdentifiedToken(null);
      setTokensToApply("");
    },
    onError: e => toast.error(e.message),
  });

  const redeemBenefitMut = trpc.benefits.staffRedeem.useMutation({
    onSuccess: () => { toast.success("Beneficio canjeado"); void utils.commerce.posIdentifyStudent.invalidate(); },
    onError: e => toast.error(e.message),
  });

  function addToCart(productId: number) {
    setCart(c => ({ ...c, [productId]: (c[productId] ?? 0) + 1 }));
  }
  function setQty(productId: number, delta: number) {
    setCart(c => {
      const next = Math.max(0, (c[productId] ?? 0) + delta);
      const copy = { ...c };
      if (next === 0) delete copy[productId]; else copy[productId] = next;
      return copy;
    });
  }

  // Fase 10.7 (spec §19 "double-tap/network retry safety") — un ref se
  // actualiza SÍNCRONAMENTE, a diferencia de `recordSaleMut.isPending`
  // (estado de React, puede tardar un tick en reflejarse en el botón
  // deshabilitado) — dos taps en el mismo evento nunca disparan dos
  // mutate() con distinta idempotencyKey.
  const submittingRef = useRef(false);

  function handleConfirmSale() {
    if (!cartItems.length) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    recordSaleMut.mutate({
      venueId,
      items: cartItems,
      identifiedUserId: identifiedStudent?.userId ?? null,
      idempotencyKey: `tpv:${venueId}:${crypto.randomUUID()}`,
      tokensToApply: requestedTokensNum > 0 ? requestedTokensNum : undefined,
      identityToken: requestedTokensNum > 0 ? (identifiedToken ?? undefined) : undefined,
      moneyPaymentMethod: moneyMethod,
    }, {
      onSettled: () => { submittingRef.current = false; },
    });
  }

  // ─── Pantalla de confirmación (spec §20) — resultado REAL, nunca repite el preview ──
  if (lastSale) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4 py-10 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle2 className="size-9 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground">VENTA COMPLETADA</h2>
        <p className="text-3xl font-bold tabular-nums text-foreground">{euro(lastSale.totalCents)}</p>

        <div className="w-full max-w-xs space-y-1 rounded-2xl border border-border bg-card p-4 text-sm">
          {lastSale.tokensSpent > 0 && (
            <p className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-muted-foreground"><Coins className="size-4 text-amber-500" /> SegoTokens</span> <span className="font-medium">−{lastSale.tokensSpent} ST ({euro(lastSale.promotionalValueCents)})</span></p>
          )}
          <p className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-muted-foreground">{lastSale.moneyMethod === "card" ? <CreditCard className="size-4" /> : <Banknote className="size-4" />} {lastSale.moneyMethod === "card" ? "Tarjeta" : "Efectivo"}</span>
            <span className="font-medium">{euro(lastSale.moneyDueCents)}</span>
          </p>
          {lastSale.studentName && (
            <p className="flex items-center justify-between border-t border-border pt-1.5"><span className="flex items-center gap-1.5 text-muted-foreground"><User className="size-4" /> Student</span> <span className="font-medium">{lastSale.studentName}</span></p>
          )}
          {!!lastSale.tokensEarned && (
            <p className="flex items-center justify-between font-semibold text-primary"><span className="flex items-center gap-1.5"><Coins className="size-4" /> Ganado</span> <span>+{lastSale.tokensEarned} ST</span></p>
          )}
        </div>

        {receiptQ.data && (
          <div className="w-full max-w-xs space-y-0.5 rounded-2xl border border-dashed border-border p-3 text-left text-xs text-muted-foreground">
            {receiptQ.data.map(item => (
              <p key={item.id} className="flex items-center justify-between"><span>{item.description} × {item.quantity}</span> <span className="tabular-nums">{euro(item.totalAmountCents)}</span></p>
            ))}
          </div>
        )}

        <div className="flex w-full max-w-xs gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={() => setLastSale(null)}>
            Nueva venta
          </Button>
        </div>
      </div>
    );
  }

  if (view === "history") {
    return (
      <div>
        <div className="flex items-center justify-between px-4 pt-4">
          <p className="text-sm font-semibold text-foreground">Historial de ventas</p>
          <Button variant="outline" size="sm" onClick={() => setView("sell")}>Volver a vender</Button>
        </div>
        <VenueAppPosHistory venueId={venueId} />
      </div>
    );
  }

  return (
    <div className="p-4 pb-8 lg:grid lg:grid-cols-[1fr_380px] lg:items-start lg:gap-6 lg:p-6">
      {/* ─── Catálogo ─────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto…" className="pl-9" />
          </div>
          <Button variant="outline" size="icon" onClick={() => setView("history")} aria-label="Historial de ventas"><History className="size-4" /></Button>
        </div>

        {!!categories.length && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <button
              onClick={() => setCategory(null)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${!category ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}
            >
              Todos
            </button>
            {categories.map(c => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${category === c ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {productsLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : !filteredProducts.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Sin productos en este venue todavía.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {filteredProducts.map(p => {
              const qty = cart[p.id] ?? 0;
              const outOfStock = p.stockTracked && !p.allowNegativeStock && (p.currentStockCached ?? 0) <= 0;
              return (
                <button
                  key={p.id}
                  disabled={outOfStock}
                  onClick={() => addToCart(p.id)}
                  className="segolife-card-shadow relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-left transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  {qty > 0 && (
                    <span className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow">{qty}</span>
                  )}
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} loading="lazy" className="h-32 w-full object-cover sm:h-36" />
                  ) : (
                    <div className="h-32 w-full bg-muted sm:h-36" />
                  )}
                  <div className="flex flex-1 flex-col justify-between gap-2 p-3">
                    <p className="line-clamp-2 text-sm font-semibold text-foreground">{p.name}</p>
                    <div className="flex items-end justify-between gap-1">
                      <span className="text-sm font-bold tabular-nums text-foreground">{p.price ? euro(Math.round(Number(p.price) * 100)) : "—"}</span>
                      {outOfStock ? (
                        <Badge variant="secondary" className="text-[10px]">AGOTADO</Badge>
                      ) : p.stockTracked ? (
                        <span className="text-[10px] text-muted-foreground">{p.currentStockCached ?? 0} ud.</span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Carrito / cobro ──────────────────────────────────────────────── */}
      <div className="lg:sticky lg:top-4 mt-5 space-y-3 lg:mt-0">
        <div className="segolife-card-shadow rounded-2xl border border-border bg-card p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground"><ShoppingCart className="size-4" /> Carrito</p>
          {!cartItems.length ? (
            <p className="py-4 text-center text-xs text-muted-foreground">Toca un producto para añadirlo</p>
          ) : (
            <div className="space-y-1.5">
              {cartItems.map(item => {
                const product = products?.find(p => p.id === item.venueProductId);
                if (!product) return null;
                const lineTotal = Math.round(Number(product.price ?? "0") * 100) * item.quantity;
                return (
                  <div key={item.venueProductId} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-foreground">{product.name}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button size="icon" variant="outline" className="size-6" onClick={() => setQty(item.venueProductId, -1)}><Minus className="size-3" /></Button>
                      <span className="w-4 text-center tabular-nums">{item.quantity}</span>
                      <Button size="icon" variant="outline" className="size-6" onClick={() => setQty(item.venueProductId, 1)}><Plus className="size-3" /></Button>
                    </div>
                    <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{euro(lineTotal)}</span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
                <span>Subtotal</span>
                <span className="tabular-nums">{euro(totalCents)}</span>
              </div>
            </div>
          )}
        </div>

        {/* ─── Identificación del Student (spec §6/§7) ───────────────────── */}
        <div className="rounded-2xl border border-dashed border-border p-3.5">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-medium"><User className="size-4" /> Student</span>
            {identifiedToken && <button onClick={() => setIdentifiedToken(null)}><X className="size-4 text-muted-foreground" /></button>}
          </div>
          {identifiedToken ? (
            identifying ? (
              <p className="mt-1 text-xs text-muted-foreground">Identificando…</p>
            ) : identifyError ? (
              <p className="mt-1 text-xs text-destructive">{identifyError.message}</p>
            ) : identifiedStudent ? (
              <div className="mt-2 space-y-1.5">
                <p className="flex items-center gap-1 text-sm font-medium text-emerald-600"><CheckCircle2 className="size-3.5" /> {identifiedStudent.name}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Coins className="size-3.5 text-amber-500" /> {identifiedStudent.walletBalance} ST
                  {identifiedStudent.promotionalValue && <span> ≈ {identifiedStudent.promotionalValue.formatted}</span>}
                </p>
                {identifiedStudent.activeBenefitsCount > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Gift className="size-3.5 text-primary" /> {identifiedStudent.activeBenefitsCount} beneficio(s) disponible(s)
                  </p>
                )}
                {rewardPreview && rewardPreview.totalGuaranteedTokens > 0 && (
                  <p className="rounded-lg bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                    Con esta compra ganará +{rewardPreview.totalGuaranteedTokens} ST
                  </p>
                )}
                {benefitScan.mode === "scanning" ? (
                  <div className="space-y-1.5">
                    <div id={BENEFIT_SCAN_REGION_ID} className="aspect-square w-full overflow-hidden rounded-lg bg-black" />
                    <Button variant="outline" size="sm" className="w-full" onClick={() => { void benefitScan.stop(); benefitScan.setMode("idle"); }}>Cancelar</Button>
                  </div>
                ) : benefitScan.mode === "manual" ? (
                  <div className="flex gap-1.5">
                    <Input autoFocus placeholder="Código del beneficio" value={benefitManualToken} onChange={e => setBenefitManualToken(e.target.value)} />
                    <Button size="sm" disabled={!benefitManualToken.trim() || redeemBenefitMut.isPending} onClick={() => { redeemBenefitMut.mutate({ token: benefitManualToken.trim(), venueId }); setBenefitManualToken(""); benefitScan.setMode("idle"); }}>OK</Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => void benefitScan.start()}>
                    <Gift className="mr-1.5 size-3.5" /> Canjear un Beneficio
                  </Button>
                )}
              </div>
            ) : null
          ) : identify.mode === "scanning" ? (
            <div className="mt-2 space-y-2">
              <div id={SCAN_REGION_ID} className="aspect-square w-full overflow-hidden rounded-lg bg-black" />
              <Button variant="outline" size="sm" className="w-full" onClick={() => { void identify.stop(); identify.setMode("idle"); }}>Cancelar</Button>
            </div>
          ) : identify.mode === "manual" ? (
            <div className="mt-2 flex gap-2">
              <Input autoFocus placeholder="Código de identidad" value={manualToken} onChange={e => setManualToken(e.target.value)} />
              <Button size="sm" disabled={!manualToken.trim()} onClick={() => { setIdentifiedToken(manualToken.trim()); identify.setMode("idle"); }}>OK</Button>
            </div>
          ) : (
            <div className="mt-2 flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => void identify.start()}><QrCode className="mr-1.5 size-3.5" /> Escanear</Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => identify.setMode("manual")}>Manual</Button>
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-muted-foreground">Opcional — la venta funciona sin identificar al Student</p>
        </div>

        {/* ─── SegoTokens (spec §8/§9) ────────────────────────────────────── */}
        {identifiedStudent && cartItems.length > 0 && (
          <div className="rounded-2xl border border-dashed border-border p-3.5">
            <p className="flex items-center gap-1.5 text-sm font-medium"><Coins className="size-4 text-amber-500" /> SegoTokens a aplicar</p>
            <div className="mt-2 flex gap-2">
              <Input type="number" min={0} placeholder="0" value={tokensToApply} onChange={e => setTokensToApply(e.target.value)} />
              <Button variant="outline" size="sm" disabled={!identifiedStudent.walletBalance} onClick={() => setTokensToApply(String(identifiedStudent.walletBalance))}>MAX</Button>
            </div>
            {quoting ? (
              <p className="mt-1.5 text-xs text-muted-foreground">Calculando…</p>
            ) : tokenQuote && !tokenQuote.eligible && requestedTokensNum > 0 ? (
              <p className="mt-1.5 text-xs text-destructive">No hay política de canje activa para este venue</p>
            ) : tokenQuote && tokenQuote.eligible && requestedTokensNum > 0 ? (
              <p className="mt-1.5 text-xs text-muted-foreground">−{tokenQuote.tokensToSpend} ST = <span className="font-medium text-foreground">−{euro(tokenQuote.promotionalValueCents)}</span></p>
            ) : null}
          </div>
        )}

        {/* ─── Método de pago del dinero restante (spec §10) ─────────────── */}
        {moneyDueCents > 0 && (
          <div className="flex gap-2">
            <Button variant={moneyMethod === "cash" ? "default" : "outline"} className="flex-1" size="sm" onClick={() => setMoneyMethod("cash")}>
              <Banknote className="mr-1.5 size-4" /> Efectivo
            </Button>
            <Button variant={moneyMethod === "card" ? "default" : "outline"} className="flex-1" size="sm" onClick={() => setMoneyMethod("card")}>
              <CreditCard className="mr-1.5 size-4" /> Tarjeta
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3 text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums">{euro(moneyDueCents)}</span>
        </div>

        <Button className="h-14 w-full rounded-full text-base font-semibold" disabled={!cartItems.length || recordSaleMut.isPending} onClick={handleConfirmSale}>
          {recordSaleMut.isPending ? <Loader2 className="mr-2 size-5 animate-spin" /> : <Receipt className="mr-2 size-5" />}
          COBRAR
        </Button>
      </div>
    </div>
  );
}
