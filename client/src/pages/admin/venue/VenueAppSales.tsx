import { useState, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, DoorOpen, QrCode, Coins, CheckCircle2, X, ArrowLeft, Ticket } from "lucide-react";
import { useQrScanner } from "@/hooks/useQrScanner";

/**
 * VenueAppSales.tsx — SEGOLIFE COMMERCE CORE (Fase 9, spec §44-45). Venta de
 * puerta desde Venue App: elegir evento en curso → tipo de entrada de
 * puerta → identificar Student (opcional) → aplicar SegoTokens (opcional) →
 * confirmar. Reutiliza el MISMO hook de escaneo que VenueAppScan.tsx, nunca
 * un segundo motor de cámara/QR.
 */

const SCAN_REGION_ID = "segolife-venueapp-sales-scan-region";

type Step = "pick" | "identify" | "confirm" | "tokenWait" | "submitting" | "success";

interface DoorTicketType { id: number; name: string; priceCents: number }
interface EventGroup { event: { id: number; name: string }; ticketTypes: DoorTicketType[] }
interface TokenReservationInfo { tokensReserved: number; promotionalValueCents: number; moneyDueCents: number; grossAmountCents: number }

function centsToEuro(cents: number) {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

export default function VenueAppSales({ venueId }: { venueId: number }) {
  const [step, setStep] = useState<Step>("pick");
  const [eventId, setEventId] = useState<number | null>(null);
  const [ticketTypeId, setTicketTypeId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [identifiedUserId, setIdentifiedUserId] = useState<number | null>(null);
  const [identityToken, setIdentityToken] = useState<string | null>(null);
  const [studentName, setStudentName] = useState<string | null>(null);
  const [tokensToApply, setTokensToApply] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [successInfo, setSuccessInfo] = useState<{ ticketCount: number } | null>(null);
  const [pendingIdentifyToken, setPendingIdentifyToken] = useState<string | null>(null);
  const [tokenRequestId, setTokenRequestId] = useState<number | null>(null);
  const [tokenReservation, setTokenReservation] = useState<TokenReservationInfo | null>(null);

  const scanner = useQrScanner(SCAN_REGION_ID);
  const utils = trpc.useUtils();

  const typesQ = trpc.commerce.doorEntryTicketTypes.useQuery({ venueId });
  const groups = (typesQ.data ?? []) as EventGroup[];
  const selectedGroup = groups.find(g => g.event.id === eventId) ?? null;
  const selectedType = selectedGroup?.ticketTypes.find(t => t.id === ticketTypeId) ?? null;

  const requestedTokensNum = Number(tokensToApply) || 0;

  const quoteQ = trpc.commerce.quoteDoorEntry.useQuery(
    { venueId, eventId: eventId!, ticketTypeId: ticketTypeId!, quantity, identifiedUserId: identifiedUserId ?? undefined, requestedTokens: requestedTokensNum },
    { enabled: step === "confirm" && !!eventId && !!ticketTypeId }
  );

  const identifyQ = trpc.commerce.posIdentifyStudent.useQuery(
    { token: pendingIdentifyToken ?? "" },
    { enabled: !!pendingIdentifyToken }
  );

  useEffect(() => {
    if (!pendingIdentifyToken) return;
    if (identifyQ.data) {
      setIdentifiedUserId(identifyQ.data.userId);
      setStudentName(identifyQ.data.name);
      setStep("confirm");
    } else if (identifyQ.error) {
      toast.error(identifyQ.error.message);
      setPendingIdentifyToken(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifyQ.data, identifyQ.error]);

  const recordMut = trpc.commerce.recordDoorSale.useMutation({
    onSuccess: (res) => {
      setSuccessInfo({ ticketCount: res.tickets.length });
      setStep("success");
      void utils.commerce.doorEntryTicketTypes.invalidate();
    },
    onError: e => { toast.error(e.message); setStep(tokenRequestId ? "tokenWait" : "confirm"); },
  });

  const requestTokenMut = trpc.commerce.doorRequestTokenPayment.useMutation({
    onSuccess: (res) => {
      setTokenRequestId(res.requestId);
      setTokenReservation(res.reservation);
      setStep("tokenWait");
    },
    onError: e => toast.error(e.message),
  });

  const cancelTokenMut = trpc.commerce.cancelTokenPaymentRequest.useMutation({
    onSuccess: () => {
      setTokenRequestId(null);
      setTokenReservation(null);
      setStep("confirm");
    },
    onError: e => toast.error(e.message),
  });

  const statusQ = trpc.commerce.getTokenPaymentRequestStatus.useQuery(
    { requestId: tokenRequestId ?? 0 },
    {
      enabled: !!tokenRequestId && step === "tokenWait",
      refetchInterval: query => (query.state.data?.status === "pending" ? 3000 : false),
    }
  );
  const tokenStatus = statusQ.data?.status;

  useEffect(() => {
    if (statusQ.data) setTokenReservation(statusQ.data.reservation);
  }, [statusQ.data]);

  useEffect(() => {
    if (tokenStatus === "confirmed" && statusQ.data?.reservation.moneyDueCents === 0 && tokenRequestId) {
      finalizeSale(tokenRequestId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenStatus]);

  function reset() {
    setStep("pick"); setEventId(null); setTicketTypeId(null); setQuantity(1);
    setIdentifiedUserId(null); setIdentityToken(null); setStudentName(null);
    setTokensToApply(""); setManualCode(""); setSuccessInfo(null);
    setTokenRequestId(null); setTokenReservation(null);
  }

  function submitIdentity(token: string) {
    setIdentityToken(token);
    setPendingIdentifyToken(token);
  }

  function finalizeSale(confirmedTokenRequestId?: number) {
    if (!eventId || !ticketTypeId) return;
    setStep("submitting");
    recordMut.mutate({
      venueId, eventId, ticketTypeId, quantity,
      identifiedUserId: identifiedUserId ?? undefined,
      idempotencyKey: `door:${venueId}:${eventId}:${ticketTypeId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      confirmedTokenRequestId,
    });
  }

  function requestTokenPayment() {
    if (!eventId || !ticketTypeId || !identifiedUserId || !identityToken || requestedTokensNum <= 0) return;
    requestTokenMut.mutate({
      venueId, eventId, ticketTypeId, quantity,
      identifiedUserId,
      requestedTokens: requestedTokensNum,
      identityToken,
      idempotencyKey: `doortok:${venueId}:${eventId}:${ticketTypeId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    });
  }

  if (typesQ.isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  if (step === "success" && successInfo) {
    return (
      <div className="max-w-sm mx-auto px-4 py-10 space-y-4 text-center">
        <CheckCircle2 className="size-14 text-emerald-600 mx-auto" />
        <p className="text-lg font-semibold text-foreground">Venta registrada</p>
        <p className="text-sm text-muted-foreground">{successInfo.ticketCount} entrada{successInfo.ticketCount !== 1 ? "s" : ""} admitida{successInfo.ticketCount !== 1 ? "s" : ""}{studentName ? ` · ${studentName}` : ""}</p>
        <Button className="w-full h-12" onClick={reset}>Nueva venta</Button>
      </div>
    );
  }

  if (!groups.length) {
    return (
      <div className="max-w-sm mx-auto px-4 py-16 text-center space-y-2">
        <DoorOpen className="size-8 text-muted-foreground mx-auto" />
        <p className="font-medium text-foreground">Sin entradas de puerta disponibles</p>
        <p className="text-sm text-muted-foreground">No hay ningún evento en curso con un tipo de entrada marcado como "venta en puerta".</p>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto px-4 py-6 space-y-5">
      {step === "pick" && (
        <div className="space-y-4">
          <div className="text-center space-y-1 pb-1">
            <DoorOpen className="size-8 text-primary mx-auto" />
            <h2 className="text-lg font-semibold text-foreground">Venta de puerta</h2>
          </div>
          {groups.map(g => (
            <div key={g.event.id} className="space-y-2">
              <p className="text-sm font-semibold text-foreground">{g.event.name}</p>
              {g.ticketTypes.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setEventId(g.event.id); setTicketTypeId(t.id); setStep("identify"); }}
                  className="w-full flex items-center justify-between rounded-xl border border-border bg-card p-4 hover:bg-muted/40 transition-colors"
                >
                  <span className="font-medium text-foreground">{t.name}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{centsToEuro(t.priceCents)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {step === "identify" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={reset}><ArrowLeft className="size-4" /></Button>
            <p className="text-sm font-medium text-foreground">{selectedType?.name} · {selectedType ? centsToEuro(selectedType.priceCents) : ""}</p>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cantidad</label>
            <Input type="number" min={1} max={10} value={quantity} onChange={e => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
          </div>
          {scanner.phase === "scanning" ? (
            <div className="space-y-3">
              <div id={SCAN_REGION_ID} className="w-full rounded-xl overflow-hidden bg-black aspect-square" />
              <Button variant="outline" className="w-full" onClick={() => void scanner.cancel()}><X className="size-4 mr-2" /> Cancelar</Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Button className="w-full h-14" onClick={() => scanner.start(text => submitIdentity(text))}>
                <QrCode className="size-5 mr-2" /> Escanear QR del Student
              </Button>
              <div className="flex gap-2">
                <Input placeholder="Código manual" value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && manualCode.trim()) submitIdentity(manualCode.trim()); }} />
                <Button variant="outline" disabled={!manualCode.trim() || identifyQ.isFetching} onClick={() => submitIdentity(manualCode.trim())}>OK</Button>
              </div>
              <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setStep("confirm")}>
                Continuar sin identificar (anónimo)
              </Button>
            </div>
          )}
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setStep("identify")}><ArrowLeft className="size-4" /></Button>
            <p className="text-sm font-medium text-foreground">Confirmar venta</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm text-foreground"><Ticket className="size-4" /> {quantity} × {selectedType?.name}</div>
            {studentName && <p className="text-sm text-muted-foreground">{studentName}</p>}
            <p className="text-lg font-semibold text-foreground tabular-nums">
              {quoteQ.data ? centsToEuro(quoteQ.data.grossAmountCents) : selectedType ? centsToEuro(selectedType.priceCents * quantity) : "—"}
            </p>
          </div>

          {identifiedUserId && quoteQ.data?.tokenQuote?.eligible && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Coins className="size-3.5" /> SegoTokens a aplicar (opcional, máx. {quoteQ.data.tokenQuote.maxRedeemableTokens})</label>
              <Input type="number" min={0} max={quoteQ.data.tokenQuote.maxRedeemableTokens} value={tokensToApply} onChange={e => setTokensToApply(e.target.value)} placeholder="0" />
              {quoteQ.data.tokenQuote.tokensToSpend > 0 && (
                <p className="text-xs text-muted-foreground">Queda por cobrar: {centsToEuro(quoteQ.data.tokenQuote.moneyDueCents)}</p>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">Cobro en efectivo/tarjeta física confirmado por ti — sin pasarela online.</p>
          <Button
            className="w-full h-12"
            disabled={requestTokenMut.isPending || recordMut.isPending}
            onClick={requestedTokensNum > 0 ? requestTokenPayment : () => finalizeSale(undefined)}
          >
            {requestTokenMut.isPending
              ? <Loader2 className="size-4 animate-spin" />
              : requestedTokensNum > 0 ? "Solicitar pago con SegoTokens" : "Confirmar venta y admitir"}
          </Button>
        </div>
      )}

      {step === "tokenWait" && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-foreground text-center">Pago con SegoTokens</p>
          <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-center">
            {tokenStatus === "confirmed" ? (
              <>
                <CheckCircle2 className="size-8 text-emerald-600 mx-auto" />
                <p className="text-sm font-medium text-foreground">✓ SegoTokens confirmados</p>
                {tokenReservation && (
                  <p className="text-xs text-muted-foreground">−{tokenReservation.tokensReserved} ST ({centsToEuro(tokenReservation.promotionalValueCents)})</p>
                )}
                {tokenReservation && tokenReservation.moneyDueCents > 0 && (
                  <p className="text-xs text-muted-foreground">Queda por cobrar: {centsToEuro(tokenReservation.moneyDueCents)}</p>
                )}
              </>
            ) : tokenStatus === "rejected" ? (
              <>
                <X className="size-8 text-destructive mx-auto" />
                <p className="text-sm font-medium text-foreground">El Student ha rechazado la solicitud</p>
              </>
            ) : tokenStatus === "expired" ? (
              <>
                <X className="size-8 text-destructive mx-auto" />
                <p className="text-sm font-medium text-foreground">La solicitud ha caducado</p>
              </>
            ) : tokenStatus === "cancelled" ? (
              <>
                <X className="size-8 text-muted-foreground mx-auto" />
                <p className="text-sm font-medium text-foreground">Solicitud cancelada</p>
              </>
            ) : (
              <>
                <Loader2 className="size-8 animate-spin text-primary mx-auto" />
                <p className="text-sm font-medium text-foreground">Esperando confirmación del Student…</p>
              </>
            )}
          </div>

          {tokenStatus === "confirmed" && (tokenReservation?.moneyDueCents ?? 0) > 0 && (
            <Button className="w-full h-12" disabled={recordMut.isPending} onClick={() => finalizeSale(tokenRequestId ?? undefined)}>
              {recordMut.isPending ? <Loader2 className="size-4 animate-spin" /> : "Confirmar venta y admitir"}
            </Button>
          )}

          {(tokenStatus === "rejected" || tokenStatus === "expired" || tokenStatus === "cancelled") && (
            <div className="space-y-2">
              <Button className="w-full h-12" onClick={() => { setTokenRequestId(null); setTokenReservation(null); setStep("confirm"); }}>
                Reintentar
              </Button>
              <Button variant="outline" className="w-full h-12" onClick={() => { setTokensToApply(""); setTokenRequestId(null); setTokenReservation(null); finalizeSale(undefined); }}>
                Vender sin SegoTokens
              </Button>
            </div>
          )}

          {(tokenStatus === undefined || tokenStatus === "pending" || tokenStatus === "confirmed") && (
            <Button
              variant="outline"
              className="w-full h-12"
              disabled={cancelTokenMut.isPending}
              onClick={() => tokenRequestId && cancelTokenMut.mutate({ requestId: tokenRequestId })}
            >
              {cancelTokenMut.isPending ? <Loader2 className="size-4 animate-spin" /> : "Cancelar solicitud"}
            </Button>
          )}
        </div>
      )}

      {step === "submitting" && (
        <div className="flex flex-col items-center gap-3 py-16">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Registrando venta…</p>
        </div>
      )}
    </div>
  );
}
