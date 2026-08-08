import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useCommunity } from "@/contexts/CommunityContext";
import { trpc } from "@/lib/trpc";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, QrCode, Keyboard, CheckCircle2, XCircle, X, ChevronRight } from "lucide-react";

/**
 * Escaneo de QR de consumición — /:community/scan (Fase 6: rediseño visual +
 * mapping de errores humano EN/ES + invalidación de queries tras canje).
 * Mobile-first: cámara si el navegador la soporta, fallback de código manual
 * siempre disponible. Todo lo sensible (venue/producto/importe/reglas) lo
 * resuelve el backend a partir del token escaneado — este componente nunca
 * envía ni calcula nada de negocio, solo el string leído del QR o tecleado.
 */

type ScanState = "idle" | "scanning" | "cameraError" | "submitting" | "result";

interface BenefitUnlocked {
  userBenefitId?: number;
  name: string; nameEn: string | null; nameEs: string | null;
  destinationVenueName: string | null;
}

interface RedeemSuccess {
  breakdown: { base: number; recurrenceBonus: number; campaignMultiplier: number | null; campaignBonus: number | null; final: number };
  balanceAfter: number;
  venueName: string;
  productName: string | null;
  benefitsUnlocked: BenefitUnlocked[];
}

const SCAN_REGION_ID = "segolife-qr-scan-region";
const KNOWN_ERROR_KEYS = new Set([
  "already_redeemed", "expired", "cancelled", "invalid_token", "not_found",
  "venue_inactive", "product_inactive", "community_not_authorized",
  "outside_schedule", "no_rule_found", "rule_limit_exceeded",
]);

export default function StudentScan() {
  const { t, i18n } = useTranslation();
  const { community, slug } = useCommunity();
  const utils = trpc.useUtils();

  const [state, setState] = useState<ScanState>("idle");
  const [manualCode, setManualCode] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [success, setSuccess] = useState<RedeemSuccess | null>(null);
  const [errorKey, setErrorKey] = useState<string>("generic");
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  const redeemMut = trpc.consumptionQr.redeem.useMutation({
    onSuccess: (res) => {
      setSuccess({
        breakdown: res.breakdown, balanceAfter: res.balanceAfter, venueName: res.venueName, productName: res.productName,
        benefitsUnlocked: res.benefitsUnlocked,
      });
      setState("result");
      // Tras un canje: el saldo/historial/beneficios/resumen de Home ya no
      // reflejan la realidad — invalidar en vez de esperar el próximo
      // staleTime (spec Fase 6, punto 42).
      void utils.tokens.getMyWallet.invalidate();
      void utils.tokens.listMyLedger.invalidate();
      void utils.benefits.myBenefits.invalidate();
      void utils.home.getSummary.invalidate();
    },
    onError: (e) => {
      const domainCode = (e.data as { domainCode?: string } | undefined)?.domainCode?.toLowerCase();
      setErrorKey(domainCode && KNOWN_ERROR_KEYS.has(domainCode) ? domainCode : "generic");
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
    setErrorKey("generic");
    setManualCode("");
    setShowManual(false);
    setState("idle");
  };

  return (
    <SegolifeAppShell requireAuth title={t("scan.title")}>
      <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-sm flex-col justify-center px-4 py-8">
        {state === "idle" && (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-secondary">
              <QrCode className="size-10 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("scan.readyTitle")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("scan.readySubtitle")}</p>
              {community?.name && <p className="mt-0.5 text-xs text-muted-foreground">{community.name}</p>}
            </div>
            <div className="space-y-3 pt-2">
              <Button className="h-14 w-full rounded-full text-base segolife-elevated-shadow" onClick={startScanner}>
                <QrCode className="mr-2 size-5" aria-hidden="true" /> {t("scan.scanButton")}
              </Button>
              <Button variant="outline" className="w-full rounded-full" onClick={() => setShowManual(true)}>
                <Keyboard className="mr-2 size-4" aria-hidden="true" /> {t("scan.manualButton")}
              </Button>
              {showManual && (
                <div className="flex gap-2 pt-1">
                  <Input
                    autoFocus
                    placeholder={t("scan.manualPlaceholder")}
                    value={manualCode}
                    onChange={e => setManualCode(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleManualSubmit(); }}
                    className="rounded-full"
                  />
                  <Button onClick={handleManualSubmit} disabled={!manualCode.trim()} className="rounded-full">{t("scan.manualSubmit")}</Button>
                </div>
              )}
            </div>
          </div>
        )}

        {state === "scanning" && (
          <div className="space-y-3">
            <div id={SCAN_REGION_ID} className="w-full overflow-hidden rounded-3xl bg-black aspect-square segolife-elevated-shadow" />
            <p className="text-center text-sm text-muted-foreground">{t("scan.scanning")}</p>
            <Button variant="outline" className="w-full rounded-full" onClick={() => { void stopScanner(); setState("idle"); }}>
              <X className="mr-2 size-4" aria-hidden="true" /> {t("scan.cancel")}
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
                className="rounded-full"
              />
              <Button onClick={handleManualSubmit} disabled={!manualCode.trim()} className="rounded-full">{t("scan.manualSubmit")}</Button>
            </div>
          </div>
        )}

        {state === "submitting" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t("scan.submitting")}</p>
          </div>
        )}

        {state === "result" && success && (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto size-16 text-primary" aria-hidden="true" />
            <div>
              <p className="text-4xl font-bold tabular-nums text-primary">+{success.breakdown.final}</p>
              <p className="text-sm font-medium text-muted-foreground">{t("scan.resultTitle")}</p>
              <p className="mt-2 text-base font-semibold text-foreground">{success.venueName}</p>
              {success.productName && <p className="text-sm text-muted-foreground">{success.productName}</p>}
            </div>
            <div className="segolife-card-shadow space-y-1.5 rounded-2xl bg-card p-4 text-left">
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
                  <Badge variant="secondary">×{success.breakdown.campaignMultiplier}</Badge>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-1.5 text-sm font-semibold">
                <span className="text-foreground">{t("scan.total")}</span>
                <span className="text-primary">{success.breakdown.final}</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("scan.newBalance")}: <span className="font-semibold text-foreground">{success.balanceAfter.toLocaleString(i18n.language)}</span>
            </p>
            {success.benefitsUnlocked.length > 0 && (
              <div className="space-y-2">
                {success.benefitsUnlocked.map((b, i) => (
                  <Link
                    key={i}
                    href={b.userBenefitId ? `/${slug}/benefits/${b.userBenefitId}` : `/${slug}/rewards`}
                    className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/10 p-4 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-accent">{t("benefits.unlockedTitle")}</p>
                      <p className="truncate text-base font-semibold text-foreground">
                        {i18n.language === "en" ? (b.nameEn ?? b.name) : (b.nameEs ?? b.name)}
                      </p>
                      {b.destinationVenueName && <p className="text-sm text-muted-foreground">{b.destinationVenueName}</p>}
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            )}
            <Button className="w-full rounded-full" onClick={reset}>{t("scan.scanAnother")}</Button>
          </div>
        )}

        {state === "result" && !success && (
          <div className="space-y-4 text-center">
            <XCircle className="mx-auto size-16 text-destructive" aria-hidden="true" />
            <div>
              <p className="text-lg font-semibold text-foreground">{t("scan.errorTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t(`scan.errors.${errorKey}`)}</p>
            </div>
            <Button className="w-full rounded-full" onClick={reset}>{t("scan.scanAnother")}</Button>
          </div>
        )}
      </div>
    </SegolifeAppShell>
  );
}
