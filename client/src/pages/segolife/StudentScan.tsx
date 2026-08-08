import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCommunity } from "@/contexts/CommunityContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, QrCode, Keyboard, CheckCircle2, XCircle, X } from "lucide-react";

/**
 * Escaneo de QR de consumición — /ie/scan, /uva/scan (un único componente,
 * mismo patrón que CommunityHome/StudentProfile). Mobile-first: cámara si el
 * navegador la soporta, fallback de código manual siempre disponible. Todo
 * lo sensible (venue/producto/importe/reglas) lo resuelve el backend a
 * partir del token escaneado — este componente nunca envía ni calcula nada
 * de negocio, solo el string leído del QR o tecleado por el estudiante.
 */

type ScanState = "idle" | "scanning" | "cameraError" | "submitting" | "result";

interface BenefitUnlocked {
  name: string; nameEn: string | null; nameEs: string | null;
  destinationVenueName: string | null;
}

interface RedeemSuccess {
  breakdown: { base: number; recurrenceBonus: number; campaignMultiplier: number | null; campaignBonus: number | null; final: number };
  balanceAfter: number;
  venueName: string;
  productName: string | null;
  /** Fase 4 — [] si este canje no desbloqueó ningún Benefit (caso normal). */
  benefitsUnlocked: BenefitUnlocked[];
}

const SCAN_REGION_ID = "segolife-qr-scan-region";

export default function StudentScan() {
  const { t, i18n } = useTranslation();
  const { community } = useCommunity();

  const [state, setState] = useState<ScanState>("idle");
  const [manualCode, setManualCode] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [success, setSuccess] = useState<RedeemSuccess | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  const redeemMut = trpc.consumptionQr.redeem.useMutation({
    onSuccess: (res) => {
      setSuccess({
        breakdown: res.breakdown, balanceAfter: res.balanceAfter, venueName: res.venueName, productName: res.productName,
        benefitsUnlocked: res.benefitsUnlocked,
      });
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
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // el scanner puede ya estar detenido — no es un error real para el usuario
      }
      scannerRef.current = null;
    }
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
        (decodedText: string) => {
          void stopScanner();
          setState("submitting");
          redeemMut.mutate({ token: decodedText });
        },
        () => { /* frame sin QR detectado — normal, se ignora */ }
      );
    } catch {
      setState("cameraError");
    }
  }

  useEffect(() => {
    return () => { void stopScanner(); };
  }, []);

  const handleManualSubmit = () => {
    const code = manualCode.trim();
    if (!code) return;
    setState("submitting");
    redeemMut.mutate({ token: code });
  };

  const reset = () => {
    setSuccess(null);
    setErrorMessage(null);
    setManualCode("");
    setShowManual(false);
    setState("idle");
  };

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-10 flex flex-col items-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2">
            <QrCode className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-semibold">{t("scan.title")}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t("scan.subtitle")}</p>
          {community?.name && <p className="text-xs text-muted-foreground">{community.name}</p>}
        </div>

        {state === "idle" && (
          <div className="space-y-3">
            <Button className="w-full h-14 text-base" onClick={startScanner}>
              <QrCode className="w-5 h-5 mr-2" /> {t("scan.scanButton")}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setShowManual(true)}>
              <Keyboard className="w-4 h-4 mr-2" /> {t("scan.manualButton")}
            </Button>
            {showManual && (
              <div className="flex gap-2 pt-2">
                <Input
                  autoFocus
                  placeholder={t("scan.manualPlaceholder")}
                  value={manualCode}
                  onChange={e => setManualCode(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleManualSubmit(); }}
                />
                <Button onClick={handleManualSubmit} disabled={!manualCode.trim()}>{t("scan.manualSubmit")}</Button>
              </div>
            )}
          </div>
        )}

        {state === "scanning" && (
          <div className="space-y-3">
            <div id={SCAN_REGION_ID} className="w-full rounded-lg overflow-hidden bg-black aspect-square" />
            <p className="text-center text-sm text-muted-foreground">{t("scan.scanning")}</p>
            <Button variant="outline" className="w-full" onClick={() => { void stopScanner(); setState("idle"); }}>
              <X className="w-4 h-4 mr-2" /> {t("scan.cancel")}
            </Button>
          </div>
        )}

        {state === "cameraError" && (
          <div className="space-y-3">
            <p className="text-center text-sm text-destructive">{t("scan.cameraError")}</p>
            <div className="flex gap-2">
              <Input
                autoFocus
                placeholder={t("scan.manualPlaceholder")}
                value={manualCode}
                onChange={e => setManualCode(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleManualSubmit(); }}
              />
              <Button onClick={handleManualSubmit} disabled={!manualCode.trim()}>{t("scan.manualSubmit")}</Button>
            </div>
          </div>
        )}

        {state === "submitting" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t("scan.submitting")}</p>
          </div>
        )}

        {state === "result" && success && (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
            <div>
              <p className="text-3xl font-bold text-emerald-600">+{success.breakdown.final} SegoTokens</p>
              <p className="text-base text-foreground mt-1">{success.venueName}</p>
              {success.productName && <p className="text-sm text-muted-foreground">{success.productName}</p>}
            </div>
            <div className="bg-card border border-border rounded-lg p-4 text-left space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("scan.base")}</span>
                <span className="text-foreground">{success.breakdown.base}</span>
              </div>
              {success.breakdown.recurrenceBonus > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("scan.recurrenceBonus")}</span>
                  <span className="text-foreground">+{success.breakdown.recurrenceBonus}</span>
                </div>
              )}
              {success.breakdown.campaignMultiplier != null && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("scan.campaignApplied")}</span>
                  <Badge variant="secondary">x{success.breakdown.campaignMultiplier}</Badge>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold pt-1.5 border-t border-border">
                <span className="text-foreground">{t("scan.total")}</span>
                <span className="text-emerald-600">{success.breakdown.final}</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("scan.newBalance")}: <span className="font-semibold text-foreground">{success.balanceAfter.toLocaleString()}</span>
            </p>
            {success.benefitsUnlocked.length > 0 && (
              <div className="space-y-2">
                {success.benefitsUnlocked.map((b, i) => (
                  <div key={i} className="bg-primary/10 border border-primary/30 rounded-lg p-4 text-center space-y-1">
                    <p className="text-xs font-semibold tracking-widest text-primary uppercase">{t("benefits.unlockedTitle")}</p>
                    <p className="text-base font-semibold text-foreground">
                      {i18n.language === "en" ? (b.nameEn ?? b.name) : (b.nameEs ?? b.name)}
                    </p>
                    {b.destinationVenueName && <p className="text-sm text-muted-foreground">{b.destinationVenueName}</p>}
                  </div>
                ))}
              </div>
            )}
            <Button className="w-full" onClick={reset}>{t("scan.scanAnother")}</Button>
          </div>
        )}

        {state === "result" && errorMessage && (
          <div className="space-y-4 text-center">
            <XCircle className="w-14 h-14 text-destructive mx-auto" />
            <div>
              <p className="text-lg font-semibold text-foreground">{t("scan.errorTitle")}</p>
              <p className="text-sm text-muted-foreground mt-1">{errorMessage}</p>
            </div>
            <Button className="w-full" onClick={reset}>{t("scan.scanAnother")}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
