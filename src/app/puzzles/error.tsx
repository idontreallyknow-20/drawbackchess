"use client";

// Error boundary for the puzzle routes.
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed, and so Retry re-fetches only this segment. The way out
// points at the lobby, which is the site's home base.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="The puzzle could not be set up"
      detail="The position failed to rebuild in the browser. Retrying reloads the puzzle file; if it keeps failing, the daily puzzle will be back tomorrow either way."
      back={{ href: "/lobby", label: "Back to lobby" }}
    />
  );
}
