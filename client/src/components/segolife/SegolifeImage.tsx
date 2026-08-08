import { useState } from "react";
import { ImageOff } from "lucide-react";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { cn } from "@/lib/utils";

/**
 * Imagen resistente para cards de eventos/venues (Fase 6, punto 36) — ratio
 * fijo (sin layout shift), lazy loading nativo, fallback visual si la URL
 * falla o no existe, sin depender de que cada página reimplemente lo mismo.
 */
export function SegolifeImage({
  src,
  alt,
  ratio = 4 / 3,
  className,
  rounded = "rounded-2xl",
}: {
  src?: string | null;
  alt: string;
  ratio?: number;
  className?: string;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showFallback = !src || failed;

  return (
    <AspectRatio ratio={ratio} className={cn("overflow-hidden bg-muted", rounded, className)}>
      {showFallback ? (
        <div className="flex h-full w-full items-center justify-center bg-secondary/60">
          <ImageOff className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </AspectRatio>
  );
}
