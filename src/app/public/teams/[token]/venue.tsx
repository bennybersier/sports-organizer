import { MapPin } from "lucide-react";

import type { PublicVenue } from "@/server/services/public-team-service";

/**
 * A hall, linked to a map search so a parent can get directions from the page.
 * The layout's `no-referrer` keeps the share token out of the map provider's logs.
 */
export function Venue({ venue }: { venue: PublicVenue }) {
  const query = [venue.name, venue.address].filter(Boolean).join(", ");
  return (
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
    >
      <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span>
        {venue.name}
        {venue.address ? <span className="text-muted-foreground"> · {venue.address}</span> : null}
      </span>
    </a>
  );
}
