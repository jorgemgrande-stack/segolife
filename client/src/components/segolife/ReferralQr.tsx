import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegolifeBottomSheet } from "@/components/segolife/SegolifeBottomSheet";

/**
 * ReferralQr — SEGOLIFE REFERRAL & INVITE REWARDS ENGINE (Fase 8, spec §4
 * CRÍTICO): QR de INVITACIÓN, nunca la credencial de identidad del propio
 * Student (ver SegolifeIdentityQr.tsx — "ESTE SOY YO" vs "ÚNETE A SEGOLIFE
 * POR MI INVITACIÓN" son cosas distintas, misma plantilla de Dialog/QR
 * reutilizada solo como scaffolding visual, dato codificado totalmente
 * distinto). Codifica `inviteLink` (la URL pública `/invite/:code`), nunca
 * el token de identidad.
 */
export function ReferralQrButton({ inviteLink }: { inviteLink: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Share2 className="size-4" aria-hidden="true" /> {t("inviteFriends.qrButton")}
      </Button>
      <SegolifeBottomSheet open={open} onClose={() => setOpen(false)} title={t("inviteFriends.qrTitle")}>
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-2xl bg-white p-4"><QRCodeSVG value={inviteLink} size={200} level="M" /></div>
          <p className="text-center text-xs text-neutral-500">{t("inviteFriends.qrSubtitle")}</p>
        </div>
      </SegolifeBottomSheet>
    </>
  );
}
