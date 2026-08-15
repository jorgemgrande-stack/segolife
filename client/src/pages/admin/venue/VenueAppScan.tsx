import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, QrCode, Keyboard, CheckCircle2, XCircle, AlertTriangle, X,
  UserCheck, MapPin, CalendarClock, Coins, Gift, Ticket, ArrowLeft,
} from "lucide-react";
import { useQrScanner } from "@/hooks/useQrScanner";

/**
 * VenueAppScan.tsx — "SCAN" (spec §6/§7/§8/§9). SCAN → UNDERSTAND → ACT.
 * Reutiliza EXACTAMENTE el mismo backend que /staff/events/scan
 * (staffCheckin.checkIn/checkInById/linkTicketIdentity) — nunca un segundo
 * motor de check-in. La diferencia real: aquí el venue YA está resuelto por
 * el shell (VenueApp.tsx), así que nunca aparece el paso "elige tu venue" —
 * y tras identificar a un Student por su QR permanente, se compone además
 * la Ficha Operativa (spec §8) usando el MISMO token ya escaneado, nunca un
 * userId en crudo (ver server/routers/venueApp.ts).
 *
 * Colores de resultado (spec §7): GREEN=acceso válido/check-in nuevo,
 * BLUE=Student identificado sin evento vigente (visita de venue), AMBER=ya
 * registrado (duplicado, no es error), RED=no válido, ORANGE=entrada válida
 * pero sin Student vinculado todavía (requiere segundo escaneo).
 */

type ResultKind = "green" | "blue" | "amber" | "red" | "orange";
type ScanState =
  | "idle" | "submitting"
  | "linkingIdentity" | "selectingEvent"
  | "result" | "card" | "scanningBenefit" | "benefitSubmitting" | "benefitResult";

interface ScanResult {
  kind: ResultKind;
  title: string;
  detail?: string | null;
}

const RESULT_STYLE: Record<ResultKind, { icon: typeof CheckCircle2; className: string }> = {
  green: { icon: CheckCircle2, className: "text-emerald-600" },
  blue: { icon: MapPin, className: "text-blue-600" },
  amber: { icon: AlertTriangle, className: "text-amber-600" },
  red: { icon: XCircle, className: "text-destructive" },
  orange: { icon: UserCheck, className: "text-orange-600" },
};

const SCAN_REGION_ID = "segolife-venueapp-scan-region";
const BENEFIT_SCAN_REGION_ID = "segolife-venueapp-benefit-scan-region";

function formatTime(d: string | Date) {
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function VenueAppScan({ venueId }: { venueId: number }) {
  const [state, setState] = useState<ScanState>("idle");
  const [manualCode, setManualCode] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [identityToken, setIdentityToken] = useState<string | null>(null);
  const [pendingTicketId, setPendingTicketId] = useState<number | null>(null);
  const [eventCandidates, setEventCandidates] = useState<Array<{ id: number; name: string; startsAt: string | Date }>>([]);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [benefitResult, setBenefitResult] = useState<ScanResult | null>(null);

  const scanner = useQrScanner(SCAN_REGION_ID);
  const benefitScanner = useQrScanner(BENEFIT_SCAN_REGION_ID);
  const utils = trpc.useUtils();

  const cardQ = trpc.venueApp.studentCard.useQuery(
    { venueId, token: identityToken ?? "" },
    { enabled: state === "card" && !!identityToken }
  );

  const checkInMut = trpc.staffCheckin.checkIn.useMutation({
    onSuccess: res => {
      switch (res.kind) {
        case "ticket_checked_in":
          setResult({ kind: "green", title: "Entrada válida", detail: `${res.studentName} · ${res.eventName}` });
          setState("result");
          return;
        case "identity_checked_in":
          setIdentityToken(pendingToken);
          setResult({ kind: "green", title: "Check-in registrado", detail: res.eventName ? `${res.studentName} · ${res.eventName}` : res.studentName });
          setState("card");
          return;
        case "identity_already_checked_in":
          setIdentityToken(pendingToken);
          setResult({ kind: "amber", title: "Ya estaba registrado", detail: res.eventName ? `${res.studentName} · ${res.eventName}` : res.studentName });
          setState("card");
          return;
        case "visit_recorded":
          setIdentityToken(pendingToken);
          setResult({ kind: "blue", title: "Visita registrada", detail: `${res.studentName} · sin evento vigente ahora mismo` });
          setState("card");
          return;
        case "visit_already_recorded":
          setIdentityToken(pendingToken);
          setResult({ kind: "amber", title: "Visita ya registrada hoy", detail: res.studentName });
          setState("card");
          return;
        case "student_resolution_required":
          setPendingTicketId(res.ticketId);
          setState("linkingIdentity");
          return;
        case "event_resolution_required":
          setEventCandidates(res.candidates);
          setState("selectingEvent");
          return;
        case "unknown_credential":
        default:
          setResult({ kind: "red", title: "Código no reconocido" });
          setState("result");
      }
    },
    onError: e => { setResult({ kind: "red", title: "No válido", detail: e.message }); setState("result"); },
  });

  const checkInByIdMut = trpc.staffCheckin.checkInById.useMutation({
    onSuccess: res => { setResult({ kind: "green", title: "Entrada válida", detail: `${res.studentName} · ${res.eventName}` }); setState("result"); },
    onError: e => { setResult({ kind: "red", title: "No válido", detail: e.message }); setState("result"); },
  });

  const linkIdentityMut = trpc.staffCheckin.linkTicketIdentity.useMutation({
    onSuccess: res => { setResult({ kind: "green", title: "Entrada válida", detail: `${res.studentName} · ${res.eventName}` }); setState("result"); },
    onError: e => { setResult({ kind: "red", title: "No válido", detail: e.message }); setState("result"); },
  });

  const redeemMut = trpc.benefits.staffRedeem.useMutation({
    onSuccess: res => {
      setBenefitResult({ kind: "green", title: "Beneficio canjeado", detail: res.benefitName });
      setState("benefitResult");
      void utils.venueApp.studentCard.invalidate({ venueId, token: identityToken ?? "" });
    },
    onError: e => { setBenefitResult({ kind: "red", title: "No se pudo canjear", detail: e.message }); setState("benefitResult"); },
  });

  function submit(token: string) {
    setState("submitting");
    setPendingToken(token);
    checkInMut.mutate({ token, venueId });
  }

  function submitIdentityLink(token: string) {
    if (pendingTicketId == null) return;
    setState("submitting");
    linkIdentityMut.mutate({ ticketId: pendingTicketId, identityToken: token });
  }

  function submitBenefitScan(token: string) {
    setState("benefitSubmitting");
    redeemMut.mutate({ token, venueId });
  }

  function chooseEvent(eventId: number) {
    if (!pendingToken) return;
    setState("submitting");
    checkInMut.mutate({ token: pendingToken, venueId, eventId });
  }

  function reset() {
    setResult(null); setBenefitResult(null); setManualCode(""); setShowManual(false);
    setIdentityToken(null); setPendingTicketId(null); setEventCandidates([]); setPendingToken(null);
    setState("idle");
  }

  const handleManualSubmit = () => {
    const code = manualCode.trim();
    if (!code) return;
    submit(code);
  };

  return (
    <div className="max-w-sm mx-auto px-4 py-6 space-y-5">
      {state === "idle" && scanner.phase === "idle" && (
        <div className="space-y-3">
          <div className="text-center space-y-1 pb-2">
            <QrCode className="size-8 text-primary mx-auto" />
            <h2 className="text-lg font-semibold text-foreground">Escanear</h2>
            <p className="text-sm text-muted-foreground">QR de entrada nativa o QR permanente del Student</p>
          </div>
          <Button className="w-full h-16 text-base" onClick={() => scanner.start(text => submit(text))}>
            <QrCode className="size-5 mr-2" /> Abrir cámara
          </Button>
          <Button variant="outline" className="w-full" onClick={() => setShowManual(true)}>
            <Keyboard className="size-4 mr-2" /> Introducir código
          </Button>
          {showManual && (
            <div className="flex gap-2 pt-1">
              <Input autoFocus placeholder="Código escaneado" value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleManualSubmit(); }} />
              <Button onClick={handleManualSubmit} disabled={!manualCode.trim()}>OK</Button>
            </div>
          )}
        </div>
      )}

      {state === "idle" && scanner.phase === "scanning" && (
        <div className="space-y-3">
          <div id={SCAN_REGION_ID} className="w-full rounded-xl overflow-hidden bg-black aspect-square" />
          <p className="text-center text-sm text-muted-foreground">Apunta al código QR…</p>
          <Button variant="outline" className="w-full" onClick={() => void scanner.cancel()}>
            <X className="size-4 mr-2" /> Cancelar
          </Button>
        </div>
      )}

      {state === "idle" && scanner.phase === "cameraError" && (
        <div className="space-y-3">
          <p className="text-center text-sm text-destructive">No se pudo acceder a la cámara. Usa el código manual.</p>
          <div className="flex gap-2">
            <Input autoFocus placeholder="Código escaneado" value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleManualSubmit(); }} />
            <Button onClick={handleManualSubmit} disabled={!manualCode.trim()}>OK</Button>
          </div>
        </div>
      )}

      {/* spec §9 — entrada válida pero sin Student vinculado: segundo escaneo del QR permanente. */}
      {state === "linkingIdentity" && scanner.phase !== "scanning" && (
        <div className="space-y-3">
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <UserCheck className="size-10 text-orange-600" />
            <p className="font-semibold text-foreground">Entrada válida, falta identificar al Student</p>
            <p className="text-sm text-muted-foreground">Pide que muestre su QR permanente y escanéalo.</p>
          </div>
          <Button className="w-full h-14 text-base" onClick={() => scanner.start(text => submitIdentityLink(text))}>
            <QrCode className="size-5 mr-2" /> Escanear QR del Student
          </Button>
          {scanner.phase === "cameraError" && (
            <div className="flex gap-2">
              <Input autoFocus placeholder="Código escaneado" value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submitIdentityLink(manualCode.trim()); }} />
              <Button onClick={() => submitIdentityLink(manualCode.trim())} disabled={!manualCode.trim()}>OK</Button>
            </div>
          )}
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={reset}>
            <X className="size-4 mr-2" /> Cancelar
          </Button>
        </div>
      )}

      {state === "linkingIdentity" && scanner.phase === "scanning" && (
        <div className="space-y-3">
          <div id={SCAN_REGION_ID} className="w-full rounded-xl overflow-hidden bg-black aspect-square" />
          <Button variant="outline" className="w-full" onClick={() => void scanner.cancel()}>
            <X className="size-4 mr-2" /> Cancelar
          </Button>
        </div>
      )}

      {/* spec §10/§12 — más de un evento vigente: nunca se adivina. */}
      {state === "selectingEvent" && (
        <div className="space-y-3">
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <CalendarClock className="size-8 text-primary" />
            <p className="font-semibold text-foreground">¿A qué evento pertenece?</p>
          </div>
          <div className="space-y-2">
            {eventCandidates.map(ev => (
              <button key={ev.id} onClick={() => chooseEvent(ev.id)} className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted/40 transition-colors">
                <p className="font-medium text-foreground">{ev.name}</p>
                <p className="text-xs text-muted-foreground">{formatTime(ev.startsAt)}</p>
              </button>
            ))}
          </div>
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={reset}>
            <X className="size-4 mr-2" /> Cancelar
          </Button>
        </div>
      )}

      {(state === "submitting" || state === "benefitSubmitting") && (
        <div className="flex flex-col items-center gap-3 py-16">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Validando…</p>
        </div>
      )}

      {state === "result" && result && (
        <div className="space-y-4">
          <ResultBanner result={result} />
          <Button className="w-full h-12" onClick={reset}>Escanear otro</Button>
        </div>
      )}

      {/* spec §8 — Ficha Operativa mínima, solo alcanzable tras identificar al Student por su propio QR. */}
      {state === "card" && (
        <div className="space-y-4">
          {result && <ResultBanner result={result} compact />}
          {cardQ.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : cardQ.data ? (
            <StudentCard
              card={cardQ.data}
              onRedeem={() => { setBenefitResult(null); benefitScanner.start(text => submitBenefitScan(text)); setState("scanningBenefit"); }}
            />
          ) : null}
          <Button className="w-full h-12" onClick={reset}>Escanear otro</Button>
        </div>
      )}

      {state === "scanningBenefit" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => { void benefitScanner.cancel(); setState("card"); }}><ArrowLeft className="size-4" /></Button>
            <p className="text-sm font-medium text-foreground">Escanea el QR del beneficio</p>
          </div>
          {benefitScanner.phase === "cameraError" ? (
            <div className="flex gap-2">
              <Input autoFocus placeholder="Código escaneado" value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submitBenefitScan(manualCode.trim()); }} />
              <Button onClick={() => submitBenefitScan(manualCode.trim())} disabled={!manualCode.trim()}>OK</Button>
            </div>
          ) : (
            <div id={BENEFIT_SCAN_REGION_ID} className="w-full rounded-xl overflow-hidden bg-black aspect-square" />
          )}
          <Button variant="outline" className="w-full" onClick={() => { void benefitScanner.cancel(); setState("card"); }}>
            <X className="size-4 mr-2" /> Cancelar
          </Button>
        </div>
      )}

      {state === "benefitResult" && benefitResult && (
        <div className="space-y-4">
          <ResultBanner result={benefitResult} />
          <Button className="w-full h-12" onClick={() => setState("card")}>Volver a la ficha</Button>
        </div>
      )}
    </div>
  );
}

function ResultBanner({ result, compact = false }: { result: ScanResult; compact?: boolean }) {
  const { icon: Icon, className } = RESULT_STYLE[result.kind];
  return (
    <div className={`flex flex-col items-center gap-1.5 text-center ${compact ? "py-2" : "py-8"}`}>
      <Icon className={`${compact ? "size-8" : "size-14"} ${className}`} />
      <p className={`font-semibold ${compact ? "text-base" : "text-lg"} text-foreground`}>{result.title}</p>
      {result.detail && <p className="text-sm text-muted-foreground">{result.detail}</p>}
    </div>
  );
}

type StudentCardData = {
  name: string;
  communities: string[];
  checkedInToday: boolean;
  walletBalance: number;
  benefitsHere: Array<{ id: number; name: string; status: string; validUntil: string | Date | null }>;
  recentActivityHere: Array<{ type: string; at: string | Date; label: string | null }>;
};

const ACTIVITY_LABEL: Record<string, string> = {
  event_checkin: "Check-in a evento",
  venue_visit: "Visita al venue",
  benefit_redeemed: "Beneficio canjeado",
};

function StudentCard({ card, onRedeem }: { card: StudentCardData; onRedeem: () => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold text-foreground">{card.name}</p>
          {card.checkedInToday && <span className="text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">Aquí hoy</span>}
        </div>
        {card.communities.length > 0 && (
          <p className="text-sm text-muted-foreground">{card.communities.join(" · ")}</p>
        )}
        <div className="flex items-center gap-1.5 text-sm text-foreground pt-1">
          <Coins className="size-4 text-amber-500" /> {card.walletBalance} SegoTokens
        </div>
      </div>

      {card.benefitsHere.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Gift className="size-4" /> Beneficios en este venue</p>
          {card.benefitsHere.map(b => (
            <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{b.name}</p>
                {b.validUntil && <p className="text-xs text-muted-foreground">Válido hasta {formatTime(b.validUntil)}</p>}
              </div>
              <Button size="sm" onClick={onRedeem}>Canjear</Button>
            </div>
          ))}
        </div>
      )}

      {card.recentActivityHere.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Ticket className="size-4" /> Actividad reciente aquí</p>
          {card.recentActivityHere.map((a, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-sm px-1">
              <span className="text-muted-foreground truncate">{ACTIVITY_LABEL[a.type] ?? a.type}{a.label ? ` · ${a.label}` : ""}</span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatTime(a.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
