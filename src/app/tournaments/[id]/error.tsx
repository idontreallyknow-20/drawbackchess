"use client";

// Error boundary for ONE tournament.
//
// The parent /tournaments boundary already existed and says "Tournaments could
// not load", which is the directory's sentence: on an event page it tells the
// reader the wrong thing failed and offers no way back to the list they came
// from. Scoped here so the message names the event and the way out is the
// directory rather than the lobby (design system section 8).

import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      {...props}
      title="This tournament could not load"
      detail="The event page failed to render. The tournament itself is running, and if you had joined you are still entered."
      back={{ href: "/tournaments", label: "All tournaments" }}
    />
  );
}
