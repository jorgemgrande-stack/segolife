import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, QrCode, Keyboard, CheckCircle2, XCircle, X, Search, UserCheck, Store, CalendarClock } from "lucide-react";

/**
 * Check-in unificado en puerta — /staff/events/scan (Fase 8, spec puntos 11,
 * 15; búsqueda manual §27; SEGOLIFE — STUDENT IDENTITY, UNIVERSAL QR &
 * UNIFIED CHECK-IN). Mismo escáner de siempre — el backend
 * (staffCheckin.checkIn) decide si lo escaneado es una entrada nativa o el
 * QR permanente de identidad del Student, nunca la UI. "Un solo escaneo" es
 * el camino feliz; los estados added abajo (vincular identidad/elegir
 * venue/elegir evento) son fallbacks explícitos, no el flujo por defecto.
 *
 * BÚSQUEDA POR NOMBRE (spec §27): sigue llamando a `checkInById`,
 * EXACTAMENTE el mismo backend de validación que el escaneo — nunca un
 * "marcar asistente" que lo salte.
 */

type ScanState =
  | "idle" | "scanning" | "cameraError" | "submitting" | "result" | "searching"
  | "linkingIdentity" | "selectingVenue" | "selectingEvent";

interface ResultInfo {
  studentName: string;
  eventName?: string | null;
}

const SCAN_REGION_ID = "segolife-ticket-scan-region";

export default function StaffEventScan() {
  const { t } = useTranslation();
  const [state, setState] = useState<ScanState>("idle");
  const [manualCode, setManualCode] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [success, setSuccess] = useState<ResultInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingTicketId, setPendingTicketId] = useState<number | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [pendingVenueId, setPendingVenueId] = useState<number | null>(null);
  const [eventCandidates, setEventCandidates] = useState<Array<{ id: number; name: string; startsAt: string | Date }>>([]);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  const authorizedVenuesQ = trpc.staffCheckin.myAuthorizedVenues.useQuery(undefined, { enabled: state === "selectingVenue" });

  const checkInMut = trpc.staffCheckin.checkIn.useMutation({
    onSuccess: res => {
      switch (res.kind) {
        case "ticket_checked_in":
        case "identity_checked_in":
        case "identity_already_checked_in":
          setSuccess({ studentName: res.studentName, eventName: "eventName" in res ? res.eventName : undefined });
          setErrorMessage(null);
          setState("result");
          return;
        case "student_resolution_required":
          setPendingTicketId(res.ticketId);
          setErrorMessage(null);
          setState("linkingIdentity");
          return;
        case "venue_selection_required":
          setPendingToken(manualCode.trim() || null);
          setState("selectingVenue");
          return;
        case "event_resolution_required":
          setPendingVenueId(res.venueId);
          setEventCandidates(res.candidates);
          setState("selectingEvent");
          return;
        case "unknown_credential":
        default:
          setErrorMessage(t("eventScan.unknownCredential"));
          setSuccess(null);
          setState("result");
      }
    },
    onError: e => { setErrorMessage(e.message); setSuccess(null); setState("result"); },
  });
  const checkInByIdMut = trpc.staffCheckin.checkInById.useMutation({
    onSuccess: res => { setSuccess({ studentName: res.studentName, eventName: res.eventName }); setErrorMessage(null); setState("result"); },
    onError: e => { setErrorMessage(e.message); setSuccess(null); setState("result"); },
  });
  const linkIdentityMut = trpc.staffCheckin.linkTicketIdentity.useMutation({
    onSuccess: res => { setSuccess({ studentName: res.studentName, eventName: res.eventName }); setErrorMessage(null); setState("result"); },
    onError: e => { setErrorMessage(e.message); setSuccess(null); setState("result"); },
  });
  const searchQ = trpc.staffCheckin.searchTickets.useQuery(
    { query: searchQuery.trim() },
    { enabled: state === "searching" && searchQuery.trim().length >= 3 }
  );

  const statusLabel: Record<string, string> = {
    used: t("eventScan.searchStatusUsed"),
    cancelled: t("eventScan.searchStatusCancelled"),
    refunded: t("eventScan.searchStatusRefunded"),
  };

  async function stopScanner() {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); scannerRef.current.clear(); } catch { /* ya detenido */ }
      scannerRef.current = null;
    }
  }

  function submit(token: string) {
    setState("submitting");
    setManualCode(token);
    checkInMut.mutate({ token });
  }

  function submitIdentityLink(identityToken: string) {
    if (pendingTicketId == null) return;
    setState("submitting");
    linkIdentityMut.mutate({ ticketId: pendingTicketId, identityToken });
  }

  async function startScanner(onDecoded: (text: string) => void) {
    setState("scanning");
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(SCAN_REGION_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        (decodedText: string) => { void stopScanner(); onDecoded(decodedText); },
        () => { /* frame sin QR detectado */ }
      );
    } catch {
      setState("cameraError");
    }
  }

  useEffect(() => () => { void stopScanner(); }, []);

  const handleManualSubmit = () => {
    const code = manualCode.trim();
    if (!code) return;
    submit(code);
  };

  const reset = () => {
    setSuccess(null); setErrorMessage(null); setManualCode(""); setShowManual(false);
    setPendingTicketId(null); setPendingToken(null); setPendingVenueId(null); setEventCandidates([]);
    setState("idle");
  };

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-10 flex flex-col items-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2">
            <QrCode className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-semibold">{t("eventScan.title")}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t("eventScan.subtitle")}</p>
        </div>

        {state === "idle" && (
          <div className="space-y-3">
            <Button className="w-full h-14 text-base" onClick={() => startScanner(text => submit(text))}>
              <QrCode className="w-5 h-5 mr-2" /> {t("eventScan.scanButton")}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setShowManual(true)}>
              <Keyboard className="w-4 h-4 mr-2" /> {t("eventScan.manualButton")}
            </Button>
            {showManual && (
              <div className="flex gap-2 pt-2">
                <Input autoFocus placeholder={t("eventScan.manualPlaceholder")} value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleManualSubmit(); }} />
                <Button onClick={handleManualSubmit} disabled={!manualCode.trim()}>{t("eventScan.manualSubmit")}</Button>
              </div>
            )}
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => { setSearchQuery(""); setState("searching"); }}>
              <Search className="w-4 h-4 mr-2" /> {t("eventScan.searchButton")}
            </Button>
          </div>
        )}

        {state === "searching" && (
          <div className="space-y-3">
            <Input
              autoFocus
              placeholder={t("eventScan.searchPlaceholder")}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            <p className="text-center text-xs text-muted-foreground">{t("eventScan.searchHint")}</p>

            {searchQuery.trim().length > 0 && searchQuery.trim().length < 3 && (
              <p className="text-center text-sm text-muted-foreground">{t("eventScan.searchTooShort")}</p>
            )}
            {searchQ.isFetching && (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            )}
            {searchQ.data && searchQ.data.length === 0 && searchQuery.trim().length >= 3 && (
              <p className="text-center text-sm text-muted-foreground py-4">{t("eventScan.searchNoResults")}</p>
            )}
            {searchQ.data && searchQ.data.length > 0 && (
              <div className="space-y-2">
                {searchQ.data.map(r => (
                  <button
                    key={r.ticketId}
                    disabled={r.status !== "issued" || checkInByIdMut.isPending}
                    onClick={() => { setState("submitting"); checkInByIdMut.mutate({ ticketId: r.ticketId }); }}
                    className="w-full text-left rounded-lg border border-border p-3 flex items-center justify-between gap-2 hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{r.studentName}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.eventName}</p>
                    </div>
                    {r.status !== "issued" && (
                      <span className="text-xs shrink-0 text-muted-foreground">{statusLabel[r.status] ?? r.status}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <Button variant="outline" className="w-full" onClick={() => { setSearchQuery(""); setState("idle"); }}>
              <X className="w-4 h-4 mr-2" /> {t("eventScan.cancel")}
            </Button>
          </div>
        )}

        {state === "scanning" && (
          <div className="space-y-3">
            <div id={SCAN_REGION_ID} className="w-full rounded-lg overflow-hidden bg-black aspect-square" />
            <p className="text-center text-sm text-muted-foreground">{t("eventScan.scanning")}</p>
            <Button variant="outline" className="w-full" onClick={() => { void stopScanner(); setState("idle"); }}>
              <X className="w-4 h-4 mr-2" /> {t("eventScan.cancel")}
            </Button>
          </div>
        )}

        {state === "cameraError" && (
          <div className="space-y-3">
            <p className="text-center text-sm text-destructive">{t("eventScan.cameraError")}</p>
            <div className="flex gap-2">
              <Input autoFocus placeholder={t("eventScan.manualPlaceholder")} value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleManualSubmit(); }} />
              <Button onClick={handleManualSubmit} disabled={!manualCode.trim()}>{t("eventScan.manualSubmit")}</Button>
            </div>
          </div>
        )}

        {/* SEGOLIFE — fallback de dos escaneos (spec §9): la entrada es válida pero no tiene Student identificado. */}
        {state === "linkingIdentity" && (
          <div className="space-y-3">
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <UserCheck className="w-10 h-10 text-primary" />
              <p className="font-semibold">{t("eventScan.linkIdentityTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("eventScan.linkIdentityDescription")}</p>
            </div>
            <Button className="w-full h-14 text-base" onClick={() => startScanner(text => submitIdentityLink(text))}>
              <QrCode className="w-5 h-5 mr-2" /> {t("eventScan.scanButton")}
            </Button>
            <div className="flex gap-2">
              <Input autoFocus placeholder={t("eventScan.manualPlaceholder")} value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submitIdentityLink(manualCode.trim()); }} />
              <Button onClick={() => submitIdentityLink(manualCode.trim())} disabled={!manualCode.trim()}>{t("eventScan.manualSubmit")}</Button>
            </div>
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={reset}>
              <X className="w-4 h-4 mr-2" /> {t("eventScan.cancel")}
            </Button>
          </div>
        )}

        {/* SEGOLIFE — staff con más de un local asignado: el QR de identidad necesita saber en cuál se está operando. */}
        {state === "selectingVenue" && (
          <div className="space-y-3">
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <Store className="w-8 h-8 text-primary" />
              <p className="font-semibold">{t("eventScan.selectVenueTitle")}</p>
            </div>
            {authorizedVenuesQ.isLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-2">
                {(authorizedVenuesQ.data?.venueIds ?? []).map(venueId => (
                  <button
                    key={venueId}
                    onClick={() => { if (pendingToken) { setState("submitting"); checkInMut.mutate({ token: pendingToken, venueId }); } }}
                    className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted/40 transition-colors"
                  >
                    {t("eventScan.venueOption", { id: venueId })}
                  </button>
                ))}
              </div>
            )}
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={reset}>
              <X className="w-4 h-4 mr-2" /> {t("eventScan.cancel")}
            </Button>
          </div>
        )}

        {/* SEGOLIFE — más de un evento vigente en este venue: nunca se adivina (spec §10). */}
        {state === "selectingEvent" && (
          <div className="space-y-3">
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <CalendarClock className="w-8 h-8 text-primary" />
              <p className="font-semibold">{t("eventScan.selectEventTitle")}</p>
            </div>
            <div className="space-y-2">
              {eventCandidates.map(ev => (
                <button
                  key={ev.id}
                  onClick={() => {
                    if (pendingToken && pendingVenueId != null) {
                      setState("submitting");
                      checkInMut.mutate({ token: pendingToken, venueId: pendingVenueId, eventId: ev.id });
                    }
                  }}
                  className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted/40 transition-colors"
                >
                  <p className="font-medium">{ev.name}</p>
                  <p className="text-xs text-muted-foreground">{new Date(ev.startsAt).toLocaleString()}</p>
                </button>
              ))}
            </div>
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={reset}>
              <X className="w-4 h-4 mr-2" /> {t("eventScan.cancel")}
            </Button>
          </div>
        )}

        {state === "submitting" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t("eventScan.submitting")}</p>
          </div>
        )}

        {state === "result" && (
          <div className="space-y-4">
            {success ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <CheckCircle2 className="w-14 h-14 text-emerald-500" />
                <p className="text-lg font-semibold">{t("eventScan.validTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {success.studentName}{success.eventName ? ` · ${success.eventName}` : ""}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <XCircle className="w-14 h-14 text-destructive" />
                <p className="text-lg font-semibold">{t("eventScan.invalidTitle")}</p>
                <p className="text-sm text-muted-foreground">{errorMessage}</p>
              </div>
            )}
            <Button className="w-full h-12" onClick={reset}>{t("eventScan.scanAnother")}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
