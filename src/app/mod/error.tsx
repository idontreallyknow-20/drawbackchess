"use client";

// Error boundary for the moderation console.
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed (design system section 8), and so Retry re-fetches only
// this segment instead of the whole app.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="The moderation console could not load"
      detail="A section of the console failed to render. No moderation action was taken."
      back={{ href: "/lobby", label: "Back to lobby" }}
    />
  );
}
