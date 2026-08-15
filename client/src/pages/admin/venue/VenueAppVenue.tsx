import { trpc } from "@/lib/trpc";
import { Loader2, MapPin, Phone, Mail, Gift } from "lucide-react";
import { SegolifeImage } from "@/components/segolife/SegolifeImage";

/**
 * VenueAppVenue.tsx — "VENUE" (spec §13, información del venue). Solo
 * lectura, solo lo operativo — nunca los formularios de gestión de
 * venues.ts (crear/editar/categorías/comunidades), esos siguen siendo
 * exclusivos del Admin General.
 */
export default function VenueAppVenue({ venueId, venueName }: { venueId: number; venueName: string }) {
  const detailQ = trpc.venues.getMyVenueById.useQuery({ id: venueId });
  const benefitStatsQ = trpc.benefits.getMyVenueStats.useQuery({ venueId });

  if (detailQ.isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const venue = detailQ.data?.venue;

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      <div className="size-full max-h-48 overflow-hidden rounded-xl">
        <SegolifeImage src={venue?.imageUrl} alt={venueName} ratio={16 / 9} />
      </div>

      <div>
        <h2 className="text-xl font-bold text-foreground">{venueName}</h2>
        {venue?.tagline && <p className="text-sm text-muted-foreground">{venue.tagline}</p>}
      </div>

      <div className="space-y-2 text-sm">
        {venue?.address && (
          <div className="flex items-start gap-2 text-foreground">
            <MapPin className="size-4 text-muted-foreground mt-0.5 shrink-0" /> {venue.address}{venue.city ? `, ${venue.city}` : ""}
          </div>
        )}
        {venue?.phone && (
          <div className="flex items-center gap-2 text-foreground">
            <Phone className="size-4 text-muted-foreground shrink-0" /> {venue.phone}
          </div>
        )}
        {venue?.email && (
          <div className="flex items-center gap-2 text-foreground">
            <Mail className="size-4 text-muted-foreground shrink-0" /> {venue.email}
          </div>
        )}
      </div>

      {benefitStatsQ.data && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <p className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Gift className="size-4" /> Beneficios de este venue</p>
          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-lg font-bold text-foreground tabular-nums">{benefitStatsQ.data.generatedCount}</p>
              <p className="text-xs text-muted-foreground">Generados</p>
            </div>
            <div>
              <p className="text-lg font-bold text-foreground tabular-nums">{benefitStatsQ.data.redeemedCount}</p>
              <p className="text-xs text-muted-foreground">Canjeados</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
