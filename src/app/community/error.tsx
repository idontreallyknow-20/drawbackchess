"use client";

// Error boundary for the community hub.
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed (design system section 8), and so Retry re-fetches only
// this segment instead of the whole app.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="Community could not load"
      detail="The community hub failed to render. Players and clubs are still there; the page just could not draw them."
      back={{ href: "/lobby", label: "Back to lobby" }}
    />
  );
}
