import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { MapPin, Coins } from "lucide-react";
import { SegolifeImage } from "./SegolifeImage";
import { Badge } from "@/components/ui/badge";

export interface SegolifeEventCardData {
  id?: number;
  slug: string;
  name: string;
  imageUrl: string | null;
  startsAt: string | Date;
  isFeatured: boolean;
  venue: { name: string } | null;
}

/**
 * Card de evento reutilizada en Home/Explore/Venue Detail (spec Fase 6,
 * punto 9) — calidad de plataforma de eventos: cover, día/hora, título,
 * venue, badge si destacado. Sin datos innecesarios en la card misma (los
 * detalles completos viven en Event Detail).
 *
 * `rewardBadge` (Fase 10.6, spec §31) — texto YA FORMATEADO por el llamador
 * vía formatCardRewardBadge() sobre un StudentRewardPreview real (nunca un
 * número calculado aquí) — la card sigue siendo puramente presentacional,
 * no hace ninguna llamada de datos propia (así puede reutilizarse en listas
 * batched sin duplicar queries).
 */
export function SegolifeEventCard({ event, slug, className, rewardBadge }: { event: SegolifeEventCardData; slug: string; className?: string; rewardBadge?: string | null }) {
  const { i18n } = useTranslation();
  const starts = new Date(event.startsAt);
  const day = starts.toLocaleDateString(i18n.language, { weekday: "short", day: "numeric", month: "short" });
  const time = starts.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });

  return (
    <Link href={`/${slug}/events/${event.slug}`} className={className}>
      <div className="relative">
        <SegolifeImage src={event.imageUrl} alt={event.name} ratio={4 / 5} />
        {event.isFeatured && (
          <Badge className="absolute left-2 top-2 bg-accent text-accent-foreground border-none">★</Badge>
        )}
        <div className="absolute inset-x-0 bottom-0 rounded-b-2xl bg-gradient-to-t from-black/70 to-transparent p-2.5 pt-6">
          <p className="text-[11px] font-medium text-white/85">{day} · {time}</p>
        </div>
      </div>
      <div className="mt-2 space-y-0.5">
        <p className="line-clamp-1 text-sm font-semibold text-foreground">{event.name}</p>
        {event.venue && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3" aria-hidden="true" /> {event.venue.name}
          </p>
        )}
        {rewardBadge && (
          <p className="flex items-center gap-1 text-[11px] font-medium text-primary">
            <Coins className="size-3" aria-hidden="true" /> {rewardBadge}
          </p>
        )}
      </div>
    </Link>
  );
}
