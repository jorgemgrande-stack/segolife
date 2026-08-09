import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Contenedor de contenido responsive compartido de Segolife (Fase 8.5) —
 * sustituye el patrón repetido `mx-auto max-w-md px-4 py-5` que TODAS las
 * páginas de la app autenticada usaban de forma idéntica (Home, Explore,
 * Rewards, Profile, MyTickets, VenueDetail, EventDetail, etc. — 13 archivos
 * con la misma línea exacta), causante del "app móvil de 448px flotando en
 * una pantalla enorme" en tablet/desktop.
 *
 * <768px: max-w-md IDÉNTICO al actual — mobile es "visual baseline
 * protegida" (spec), cero cambio de píxel.
 * 768-1199px (tablet): más superficie real, pero todavía una sola columna
 * de lectura cómoda.
 * >=1200px (desktop, junto al sidebar fijo): mucho más ancho, csolo lo justo
 * para que el contenido no se sienta perdido, sin llegar a los grids
 * multi-columna bespoke de Explore/Home pública (esos resuelven su propia
 * composición, este componente es solo el ancho/padding base).
 */
export function SegolifePageContainer({ children, className, wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div
      className={cn(
        "mx-auto max-w-md px-4 py-5 md:max-w-2xl md:px-6 md:py-6",
        wide ? "xl:max-w-5xl xl:px-10 xl:py-8" : "xl:max-w-3xl xl:px-10 xl:py-8",
        className
      )}
    >
      {children}
    </div>
  );
}
