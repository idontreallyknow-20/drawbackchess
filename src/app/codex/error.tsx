"use client";

// Error boundary for the rule library and every card page under it.
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed (design system section 8), and so Retry re-fetches only
// this segment instead of the whole app.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="The codex could not load"
      detail="The rule library failed to render. This is a display problem, not a change to any card."
      back={{ href: "/lobby", label: "Back to lobby" }}
    />
  );
}
