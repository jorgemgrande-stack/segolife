import { useEffect, useRef, useState } from "react";

export type QrScannerPhase = "idle" | "scanning" | "cameraError";

/**
 * Ciclo de vida compartido del escáner QR (html5-qrcode) — extraído de
 * StaffEventScan.tsx (spec VENUE & PARTNER APP §6/§28: "reuse/consolidate
 * the Phase 4 scanner", nunca un segundo motor de escaneo paralelo). Mismo
 * comportamiento exacto: cámara trasera, debounce por frame único (para el
 * primer QR detectado, nunca reintentos automáticos silenciosos), limpieza
 * en unmount.
 */
export function useQrScanner(regionId: string) {
  const [phase, setPhase] = useState<QrScannerPhase>("idle");
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  async function stop() {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); scannerRef.current.clear(); } catch { /* ya detenido */ }
      scannerRef.current = null;
    }
  }

  async function start(onDecoded: (text: string) => void) {
    setPhase("scanning");
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(regionId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        (decodedText: string) => { void stop(); onDecoded(decodedText); },
        () => { /* frame sin QR detectado */ }
      );
    } catch {
      setPhase("cameraError");
    }
  }

  async function cancel() {
    await stop();
    setPhase("idle");
  }

  useEffect(() => () => { void stop(); }, []);

  return { phase, start, cancel };
}
