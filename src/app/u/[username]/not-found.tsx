// 404 boundary for a player profile.
//
// It renders when notFound() is thrown anywhere under /u/[username]. Today the
// page is a client component that fetches the profile itself and paints its own
// "Player not found" state, so this boundary is not on that path yet; it is the
// App Router home for that copy and becomes the boundary the moment the profile
// resolves server-side (see the handoff note in the round report). The words are
// the shared ones, so the in-page state, this boundary and the root 404 for
// /u/<name>/<anything> all say the same thing.

import { NotFoundPanel } from "@/app/_components/NotFoundPanel";
import { NOT_FOUND_COPY } from "@/app/_components/notFoundCopy";

export default function NotFound() {
  const copy = NOT_FOUND_COPY.player;
  return (
    <NotFoundPanel
      title={copy.title}
      detail={copy.detail}
      action={copy.action}
      secondary={copy.secondary}
    />
  );
}
