"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// "Play a Friend" now lives inside the lobby's Friends tab, so /friend is just
// a thin redirect to /lobby?tab=friends. Shared join links (?code=...), direct
// challenges (?challenge=...), and mode links (?mode=...) are preserved so the
// Friends tab can pick up where the old page left off (auto-opening the join
// flow when a code is present).
export default function FriendRedirect() {
  const router = useRouter();
  useEffect(() => {
    let target = "/lobby?tab=friends";
    try {
      const search = new URLSearchParams(window.location.search);
      const out = new URLSearchParams();
      out.set("tab", "friends");
      const code = search.get("code");
      const challenge = search.get("challenge");
      const mode = search.get("mode");
      if (code) out.set("code", code);
      if (challenge) out.set("challenge", challenge);
      if (mode) out.set("mode", mode);
      target = `/lobby?${out.toString()}`;
    } catch {}
    router.replace(target);
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="text-[12px] text-parchment-400">Opening the lobby…</div>
    </main>
  );
}
