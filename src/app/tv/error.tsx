"use client";

// Error boundary for Nerf TV.
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed (design system section 8), and so Retry re-fetches only
// this segment instead of the whole app.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="Nerf TV could not load"
      detail="The featured game failed to render. The match itself is still being played."
      back={{ href: "/lobby", label: "Back to lobby" }}
    />
  );
}
