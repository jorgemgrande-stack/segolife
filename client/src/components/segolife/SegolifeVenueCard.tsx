import { Link } from "wouter";
import { SegolifeImage } from "./SegolifeImage";

export interface SegolifeVenueCardData {
  slug: string;
  name: string;
  imageUrl: string | null;
  /** Fase 8.6: foto grande real del venue — `imageUrl` pasó a ser el LOGO. */
  coverImageUrl?: string | null;
  categoryName?: string | null;
}

/** Card de local reutilizada en Home/Explore/Event Detail (spec Fase 6, punto 13). */
export function SegolifeVenueCard({ venue, slug, className }: { venue: SegolifeVenueCardData; slug: string; className?: string }) {
  return (
    <Link href={`/${slug}/venues/${venue.slug}`} className={className}>
      <SegolifeImage src={venue.coverImageUrl ?? venue.imageUrl} alt={venue.name} ratio={1} />
      <div className="mt-2 space-y-0.5">
        <p className="line-clamp-1 text-sm font-semibold text-foreground">{venue.name}</p>
        {venue.categoryName && <p className="text-xs text-muted-foreground">{venue.categoryName}</p>}
      </div>
    </Link>
  );
}
