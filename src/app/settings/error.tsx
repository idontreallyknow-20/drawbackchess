"use client";

// Error boundary for /settings.
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed (design system section 8), and so Retry re-renders only
// this segment. The reassurance is the specific one this surface owes: the
// stored preferences are not what broke, so nothing the reader has chosen is
// lost by the page failing to draw.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="Settings could not load"
      detail="The settings page failed to render. Your saved preferences are untouched, and the quick panel in the header still opens them."
      back={{ href: "/lobby", label: "Back to lobby" }}
    />
  );
}
