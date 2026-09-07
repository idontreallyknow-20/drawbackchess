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
      <p className="text-parchment-400">Redirecting…</p>
    </main>
  );
}
