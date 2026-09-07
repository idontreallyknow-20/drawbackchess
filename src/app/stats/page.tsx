"use client";

// /stats no longer hosts the site-wide numbers (those moved to the moderation
// area at /mod/stats). It now sends players to their own numbers: the profile's
// Statistics section. Signed-in visitors land straight on their profile;
// signed-out visitors have no personal statistics, so they are routed through
// sign-in with `next=/stats`, which lands them on their own numbers the moment
// they authenticate rather than dead-ending on an unrelated wall.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchMe } from "@/lib/authClient";

export default function StatsRedirect() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      router.replace(me ? `/u/${encodeURIComponent(me.username)}` : "/login?next=/stats");
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="min-h-screen grid place-items-center">
      {/* A redirect shim still renders for a beat, and often longer than a
          beat on a slow connection while fetchMe resolves. Without a heading
          the route cannot be identified by anyone arriving with a screen
          reader, and the sweep counts it as a route with no h1, which it is. */}
      <h1 className="sr-only">Your statistics</h1>
      <p className="text-parchment-400" role="status">
        Redirecting…
      </p>
    </main>
  );
}
