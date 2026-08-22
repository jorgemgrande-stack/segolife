import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/**
 * InfoTooltip — F69 (Manuales + ayuda contextual). Ícono (?) reutilizable
 * para explicar un campo admin sin ocupar espacio permanente en el
 * formulario (spec: "tooltips/texto de ayuda mejor que párrafos largos").
 * Primer uso real de un Tooltip interactivo sobre un campo de formulario en
 * todo el admin (confirmado por auditoría: hasta F69, TooltipProvider solo
 * envolvía la app, sin ningún <Tooltip> real sobre un campo). Envuelve el
 * primitivo shadcn ya existente (client/src/components/ui/tooltip.tsx) —
 * nunca un patrón de UI nuevo.
 */
export function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex items-center text-muted-foreground hover:text-foreground" aria-label="Ayuda">
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left">{text}</TooltipContent>
    </Tooltip>
  );
}

/** Label + InfoTooltip en línea — evita repetir el `<div className="flex items-center gap-1">...</div>` en cada campo. */
export function LabelWithInfo({ children, info }: { children: ReactNode; info: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-1">
      <span className="text-sm font-medium leading-none">{children}</span>
      <InfoTooltip text={info} />
    </div>
  );
}
