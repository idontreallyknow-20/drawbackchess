"use client";

// Error boundary for the sign-in and registration form.
//
// Scoped here rather than left to the root boundary so the message can name
// what actually failed (design system section 8), and so Retry re-fetches only
// this segment instead of the whole app.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="Sign in could not load"
      detail="The form failed to render. No account details were submitted."
      back={{ href: "/", label: "Back to the home page" }}
    />
  );
}
