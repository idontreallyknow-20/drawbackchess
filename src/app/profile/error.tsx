"use client";

// Error boundary for the profile and its editor.
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed (design system section 8), and so Retry re-fetches only
// this segment instead of the whole app.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="Your profile could not load"
      detail="The profile failed to render. Any settings you had already saved are stored on your account."
      back={{ href: "/lobby", label: "Back to lobby" }}
    />
  );
}
