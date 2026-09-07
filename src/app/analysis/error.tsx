"use client";

// Error boundary for the analysis board.
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed (design system section 8), and so Retry re-fetches only
// this segment instead of the whole app.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="The analysis board could not load"
      detail="Something in the board or the engine bridge failed. Any position you had loaded from a URL will come back on retry."
      back={{ href: "/lobby", label: "Back to lobby" }}
    />
  );
}
