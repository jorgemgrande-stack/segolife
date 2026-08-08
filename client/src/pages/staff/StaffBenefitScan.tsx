import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, QrCode, Keyboard, CheckCircle2, XCircle, X } from "lucide-react";

/**
 * Validación de QR de Benefit en puerta/caja — /staff/benefits/scan.
 * Interfaz NUEVA, explícitamente distinta del escaneo del estudiante
 * (/ie|uva/scan, Fase 3): aquí el STAFF escanea lo que el ESTUDIANTE
 * muestra, flujo inverso. Privacidad en puerta: solo se recibe/renderiza lo
 * que benefits.staffRedeem ya expone (nombre, tipo, estado, vigencia) —
 * nunca email/teléfono/notas/saldo, ver server/routers/benefits.ts.
 */

type ScanState = "idle" | "scanning" | "cameraError" | "submitting" | "result";

interface RedeemSuccess {
  studentName: string;
  benefitName: string;
  benefitType: string;
  validFrom: string | Date;
  validUntil: string | Date | null;
}

const SCAN_REGION_ID = "segolife-benefit-scan-region";

export default function StaffBenefitScan() {
  const { t } = useTranslation();
  const [venueId, setVenueId] = useState<string>("");
  const [state, setState] = useState<ScanState>("idle");
  const [manualCode, setManualCode] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [success, setSuccess] = useState<RedeemSuccess | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  const { data: authorized } = trpc.benefits.myAuthorizedVenues.useQuery();
  const { data: allVenues } = trpc.venues.publicActive.useQuery({}, { enabled: !!authorized?.all });
  const venueOptions = authorized?.all
    ? (allVenues ?? []).map(v => ({ id: v.id, name: v.name }))
    : (allVenues ?? []).filter(v => authorized?.venueIds.includes(v.id)).map(v => ({ id: v.id, name: v.name }));

  const redeemMut = trpc.benefits.staffRedeem.useMutation({
    onSuccess: (res) => {
      setSuccess({ studentName: res.studentName, benefitName: res.benefitName, benefitType: res.benefitType, validFrom: res.validFrom, validUntil: res.validUntil });
      setErrorMessage(null);
      setState("result");
    },
    onError: (e) => {
      setErrorMessage(e.message);
      setSuccess(null);
      setState("result");
    },
  });

  async function stopScanner() {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); scannerRef.current.clear(); } catch { /* ya detenido */ }
      scannerRef.current = null;
    }
  }

  function submit(token: string) {
    if (!venueId) { setErrorMessage(t("staffScan.selectVenueFirst")); setState("result"); return; }
    setState("submitting");
    redeemMut.mutate({ token, venueId: Number(venueId) });
  }

  async function startScanner() {
    if (!venueId) { setErrorMessage(t("staffScan.selectVenueFirst")); setState("result"); return; }
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
            <h1 className="text-xl font-semibold">{t("staffScan.title")}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t("staffScan.subtitle")}</p>
        </div>

        {state === "idle" && (
          <div className="space-y-3">
            <Select value={venueId} onValueChange={setVenueId}>
              <SelectTrigger><SelectValue placeholder={t("staffScan.venuePlaceholder")} /></SelectTrigger>
              <SelectContent>
                {venueOptions.map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button className="w-full h-14 text-base" onClick={startScanner} disabled={!venueId}>
              <QrCode className="w-5 h-5 mr-2" /> {t("staffScan.scanButton")}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setShowManual(true)} disabled={!venueId}>
              <Keyboard className="w-4 h-4 mr-2" /> {t("staffScan.manualButton")}
            </Button>
            {showManual && (
              <div className="flex gap-2 pt-2">
                <Input autoFocus placeholder={t("staffScan.manualPlaceholder")} value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleManualSubmit(); }} />
                <Button onClick={handleManualSubmit} disabled={!manualCode.trim()}>{t("staffScan.manualSubmit")}</Button>
              </div>
            )}
          </div>
        )}

        {state === "scanning" && (
          <div className="space-y-3">
            <div id={SCAN_REGION_ID} className="w-full rounded-lg overflow-hidden bg-black aspect-square" />
            <p className="text-center text-sm text-muted-foreground">{t("staffScan.scanning")}</p>
            <Button variant="outline" className="w-full" onClick={() => { void stopScanner(); setState("idle"); }}>
              <X className="w-4 h-4 mr-2" /> {t("staffScan.cancel")}
            </Button>
          </div>
        )}

        {state === "cameraError" && (
          <div className="space-y-3">
            <p className="text-center text-sm text-destructive">{t("staffScan.cameraError")}</p>
            <div className="flex gap-2">
              <Input autoFocus placeholder={t("staffScan.manualPlaceholder")} value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleManualSubmit(); }} />
              <Button onClick={handleManualSubmit} disabled={!manualCode.trim()}>{t("staffScan.manualSubmit")}</Button>
            </div>
          </div>
        )}

        {state === "submitting" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t("staffScan.submitting")}</p>
          </div>
        )}

        {state === "result" && success && (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
            <div>
              <p className="text-2xl font-bold text-emerald-600">{t("staffScan.validTitle")}</p>
              <p className="text-base text-foreground mt-2">{success.benefitName}</p>
              <p className="text-sm text-muted-foreground">{success.studentName}</p>
            </div>
            <Button className="w-full" onClick={reset}>{t("staffScan.scanAnother")}</Button>
          </div>
        )}

        {state === "result" && errorMessage && (
          <div className="space-y-4 text-center">
            <XCircle className="w-14 h-14 text-destructive mx-auto" />
            <div>
              <p className="text-2xl font-bold text-destructive">{t("staffScan.invalidTitle")}</p>
              <p className="text-sm text-muted-foreground mt-1">{errorMessage}</p>
            </div>
            <Button className="w-full" onClick={reset}>{t("staffScan.scanAnother")}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
