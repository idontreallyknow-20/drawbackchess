// 404 boundary for one online game.
//
// It renders when notFound() is thrown anywhere under /game/[id]. Today the page
// is a client component that resolves the game over its own socket and paints an
// in-page "this game doesn't exist" state, so this boundary is not on that path
// yet; it is the App Router home for that copy and becomes the boundary the
// moment the game id is resolved server-side (see the handoff note in the round
// report). The words are the shared ones, so the in-page state, this boundary
// and the root 404 for /game/<id>/<anything> all say the same thing.

import { NotFoundPanel } from "@/app/_components/NotFoundPanel";
import { NOT_FOUND_COPY } from "@/app/_components/notFoundCopy";

export default function NotFound() {
  const copy = NOT_FOUND_COPY.game;
  return (
    <NotFoundPanel
      title={copy.title}
      detail={copy.detail}
      action={copy.action}
      secondary={copy.secondary}
    />
  );
}
