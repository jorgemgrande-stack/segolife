import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { IdCard, Loader2, RotateCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { SegolifeBottomSheet } from "@/components/segolife/SegolifeBottomSheet";

/**
 * SEGOLIFE — QR universal de identidad del Student. Contenido reutilizado
 * en dos sitios (spec "el estudiante debe poder llegar a su QR rápido"):
 * el botón de acceso rápido en el header (cualquier página, sin navegar) y
 * la sección de Profile (Fase 8) — MISMA fuente, nunca dos implementaciones
 * que puedan divergir visualmente. Mismo token/endpoint que ya usaba el
 * POS (ticketPurchase.myIdentityToken) — ver unifiedCheckinService.ts, el
 * check-in en puerta ya lo acepta.
 */
export function SegolifeIdentityQrContent({ autoLoad = true, variant = "themed" }: { autoLoad?: boolean; variant?: "themed" | "light" }) {
  const { t } = useTranslation();
  const { data, isLoading } = trpc.ticketPurchase.myIdentityToken.useQuery(undefined, { enabled: autoLoad });
  const rotateMut = trpc.ticketPurchase.rotateMyIdentityToken.useMutation({
    onSuccess: () => toast.success(t("profile.identityQrRotated")),
  });
  // `variant="light"` (SegolifeBottomSheet, siempre blanco independientemente
  // del tema) usa colores literales en vez de `text-muted-foreground` — ese
  // token sigue el tema activo y quedaría casi invisible sobre un fondo
  // forzado a blanco en modo oscuro. `variant="themed"` (Profile.tsx, panel
  // en línea que SÍ seguía el tema) no cambia de comportamiento.
  const mutedClass = variant === "light" ? "text-neutral-500" : "text-muted-foreground";

  return (
    <div className="flex flex-col items-center gap-3">
      {isLoading || !data ? (
        <div className="flex size-[200px] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
        </div>
      ) : (
        <>
          <div className="rounded-2xl bg-white p-4"><QRCodeSVG value={data.token} size={200} level="M" /></div>
          <p className={`text-center text-xs ${mutedClass}`}>{t("profile.identityQrDescription")}</p>
          <Button variant="ghost" size="sm" className={`gap-1.5 ${mutedClass}`} disabled={rotateMut.isPending} onClick={() => rotateMut.mutate()}>
            <RotateCw className="size-3.5" aria-hidden="true" /> {t("profile.identityQrRegenerate")}
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * Botón de acceso rápido — mismo tamaño/estilo circular que Bell/Profile
 * del header (spec: "no competir visualmente", icono, no texto). Abre el
 * bottom sheet global (SegolifeBottomSheet, spec "UX móvil: Bottom Sheets
 * globales" — sustituye el Dialog centrado oscuro anterior) en vez de
 * navegar: el Student llega a su QR sin perder dónde estaba (Home, Explore,
 * donde sea) — un toque para verlo, un toque para cerrarlo.
 */
export function SegolifeIdentityQrButton({ size = "size-8" }: { size?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={t("profile.identityQrTitle")}
        className={`flex ${size} items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-colors hover:bg-secondary/70`}
      >
        <IdCard className="size-4" aria-hidden="true" />
      </button>
      <SegolifeBottomSheet open={open} onClose={() => setOpen(false)} title={t("profile.identityQrTitle")}>
        <SegolifeIdentityQrContent autoLoad={open} variant="light" />
      </SegolifeBottomSheet>
    </>
  );
}
