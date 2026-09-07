"use client";

// Error boundary for the trophy wall.
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed (design system section 8), and so Retry re-fetches only
// this segment instead of the whole app.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="Achievements could not load"
      detail="The trophy wall failed to render. Your unlocks are stored on your account, so nothing here is lost."
      back={{ href: "/lobby", label: "Back to lobby" }}
    />
  );
}
