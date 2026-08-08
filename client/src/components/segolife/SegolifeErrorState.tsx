import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";

/**
 * Tratamiento visual unificado de error — nunca se muestra un stack trace ni
 * un mensaje crudo de tRPC (spec Fase 6, punto 29). `onRetry` es opcional
 * (algunas vistas solo necesitan el mensaje, p.ej. dentro de un detalle).
 */
export function SegolifeErrorState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <Empty className="border-none py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive size-14 rounded-2xl">
          <AlertTriangle className="size-6" />
        </EmptyMedia>
        <EmptyTitle>{t("common.errorTitle")}</EmptyTitle>
        <EmptyDescription>{t("common.errorDescription")}</EmptyDescription>
      </EmptyHeader>
      {onRetry && (
        <EmptyContent>
          <Button onClick={onRetry} variant="outline" className="rounded-full px-6">{t("common.tryAgain")}</Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
