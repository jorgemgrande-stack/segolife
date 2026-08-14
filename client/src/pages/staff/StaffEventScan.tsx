import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, QrCode, Keyboard, CheckCircle2, XCircle, X, Search } from "lucide-react";

/**
 * Check-in nativo de entradas en puerta — /staff/events/scan (Fase 8, spec
 * puntos 11, 15; búsqueda manual añadida en SEGOLIFE — Native Ticket Sales,
 * spec §27). Dominio explícitamente distinto de StudentScan (Fase 3) y de
 * StaffBenefitScan (Fase 4) — mismo patrón visual (html5-qrcode lazy,
 * entrada manual de respaldo) pero NUNCA reutiliza ese flujo. A diferencia
 * de Benefits, aquí no hace falta elegir venue antes de escanear: el venue
 * relevante es el del EVENTO de la propia entrada, el servidor ya comprueba
 * la autorización del staff contra ese venue (ver nativeCheckinService.ts).
 * Solo valida tickets `provider="segolife_native"` — nunca finge un
 * check-in de Fourvenues/Weezevent (esos no exponen individualAttendance
 * de forma segura desde aquí, ver docs/ticketing/native-ticketing.md).
 *
 * BÚSQUEDA POR NOMBRE (spec §27): distinta del "código manual" de arriba —
 * ese sigue exigiendo que el estudiante TENGA el código (aunque sea como
 * texto); esta es para cuando no tiene absolutamente nada que mostrar.
 * Llama a `staffCheckin.checkInById`, EXACTAMENTE el mismo backend de
 * validación que el escaneo — nunca un "marcar asistente" que lo salte.
 */

type ScanState = "idle" | "scanning" | "cameraError" | "submitting" | "result" | "searching";

interface CheckInSuccess {
  studentName: string;
  eventName: string;
}

const SCAN_REGION_ID = "segolife-ticket-scan-region";

export default function StaffEventScan() {
  const { t } = useTranslation();
  const [state, setState] = useState<ScanState>("idle");
  const [manualCode, setManualCode] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [success, setSuccess] = useState<CheckInSuccess | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  const checkInMut = trpc.staffCheckin.checkIn.useMutation({
    onSuccess: res => { setSuccess({ studentName: res.studentName, eventName: res.eventName }); setErrorMessage(null); setState("result"); },
    onError: e => { setErrorMessage(e.message); setSuccess(null); setState("result"); },
  });
  const checkInByIdMut = trpc.staffCheckin.checkInById.useMutation({
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
    checkInMut.mutate({ token });
  }

  async function startScanner() {
    setState("scanning");
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(SCAN_REGION_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        (decodedText: string) => { void stopScanner(); submit(decodedText); },
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
    setSuccess(null); setErrorMessage(null); setManualCode(""); setShowManual(false); setState("idle");
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
            <Button className="w-full h-14 text-base" onClick={startScanner}>
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
                <p className="text-sm text-muted-foreground">{success.studentName} · {success.eventName}</p>
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
