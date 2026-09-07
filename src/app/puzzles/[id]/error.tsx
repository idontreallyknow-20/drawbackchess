"use client";

// Error boundary for one puzzle. Scoped separately from /puzzles so a broken
// position on a shared link cannot take the daily down with it.

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="This puzzle could not be set up"
      detail="The stored position failed to rebuild in the browser. Retry reloads it; today's daily puzzle is unaffected."
      back={{ href: "/puzzles", label: "Today's puzzle" }}
    />
  );
}
