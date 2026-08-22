import type { ReactNode } from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * SegolifeBottomSheet — sistema global de bottom sheets del frontend
 * Student (spec "UX móvil: Bottom Sheets globales"), sustituye los pop-ups
 * centrados oscuros (Dialog con `bg-background`, que en tema oscuro se ve
 * negro — confirmado en capturas reales del cliente) por el patrón
 * "nace desde abajo, fondo BLANCO siempre (independiente del tema activo,
 * como Instagram), esquinas superiores redondeadas, grabber".
 *
 * Construido directamente sobre `vaul` (ya era una dependencia instalada y
 * shadcn ya traía `components/ui/drawer.tsx` sin usar en ningún sitio —
 * spec §2 "evitar una dependencia pesada si el proyecto ya dispone de
 * primitivas suficientes": vaul YA resuelve swipe-to-close, backdrop,
 * Escape, focus management, bloqueo de scroll de fondo, y reposicionamiento
 * de inputs cuando aparece el teclado — `repositionInputs`). No se reutiliza
 * el wrapper `components/ui/drawer.tsx` tal cual porque ese fija
 * `bg-background` (sigue el tema) — aquí el blanco es una decisión de
 * producto deliberada, no un token de tema.
 */
export interface SegolifeBottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Contenido fijo abajo (p.ej. composer de comentario) — el resto del contenido hace scroll independiente por encima. */
  stickyFooter?: ReactNode;
  /** Cierra al pulsar el backdrop. @default true */
  closeOnBackdrop?: boolean;
  /** Cierra deslizando hacia abajo. @default true */
  swipeToClose?: boolean;
  /** Grabber horizontal centrado arriba. @default true */
  showHandle?: boolean;
  /** X explícita junto al título. @default true */
  showCloseButton?: boolean;
  contentClassName?: string;
}

export function SegolifeBottomSheet({
  open, onClose, title, children, stickyFooter,
  closeOnBackdrop = true, swipeToClose = true, showHandle = true, showCloseButton = true,
  contentClassName,
}: SegolifeBottomSheetProps) {
  const { t } = useTranslation();
  // vaul expone un único `dismissible` para swipe+backdrop+Escape juntos —
  // el repo no necesita hoy separar ambos comportamientos (todos los
  // consumidores actuales quieren las dos cosas o ninguna); si algún
  // consumidor futuro necesita solo una de las dos, hará falta una versión
  // de vaul/composición más fina (documentado, no resuelto de más).
  const dismissible = closeOnBackdrop && swipeToClose;

  return (
    <DrawerPrimitive.Root
      open={open}
      onOpenChange={v => { if (!v) onClose(); }}
      dismissible={dismissible}
      repositionInputs
    >
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 motion-reduce:transition-none" />
        <DrawerPrimitive.Content
          className={`segolife-sheet-surface fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full flex-col rounded-t-2xl text-neutral-900 shadow-2xl outline-none sm:max-w-lg motion-reduce:transition-none ${contentClassName ?? ""}`}
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {showHandle && (
            <div className="flex shrink-0 justify-center pt-2.5 pb-1" aria-hidden="true">
              <div className="h-1 w-9 rounded-full bg-neutral-300" />
            </div>
          )}
          {(title || showCloseButton) && (
            <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-4 py-3">
              <DrawerPrimitive.Title className="text-base font-semibold text-neutral-900">
                {title ?? ""}
              </DrawerPrimitive.Title>
              {showCloseButton && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t("common.close")}
                  className="-m-2 flex size-9 items-center justify-center rounded-full p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                >
                  <XIcon className="size-5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {children}
          </div>
          {stickyFooter && (
            <div className="shrink-0 border-t border-neutral-100 px-4 py-3">
              {stickyFooter}
            </div>
          )}
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
