"use client";

// Error boundary for the game archive.
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed (design system section 8), and so Retry re-fetches only
// this segment instead of the whole app.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="Your game history could not load"
      detail="The archive failed to render. Your games are stored on the server and are not affected."
      back={{ href: "/lobby", label: "Back to lobby" }}
    />
  );
}
