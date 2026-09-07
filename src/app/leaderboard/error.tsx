"use client";

// Error boundary for the standings.
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed (design system section 8), and so Retry re-fetches only
// this segment instead of the whole app.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="The leaderboard could not load"
      detail="The standings failed to render. Ratings are unaffected, so retrying should bring the board straight back."
      back={{ href: "/lobby", label: "Back to lobby" }}
    />
  );
}
