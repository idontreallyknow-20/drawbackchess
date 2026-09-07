"use client";

// Error boundary for the house rules and the interactive walkthrough.
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed (design system section 8), and so Retry re-fetches only
// this segment instead of the whole app.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="The tutorial could not load"
      detail="The lesson failed to render. Retrying restarts it at the step you were on."
      back={{ href: "/lobby", label: "Back to lobby" }}
    />
  );
}
