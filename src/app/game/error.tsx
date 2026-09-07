"use client";

// Error boundary for the match surface (both the local game and an online board).
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed (design system section 8), and so Retry re-fetches only
// this segment instead of the whole app.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="This game could not load"
      detail="The board failed to render. A local game is saved on this device and an online game is held by the server, so retrying picks it back up."
      back={{ href: "/lobby", label: "Back to lobby" }}
    />
  );
}
