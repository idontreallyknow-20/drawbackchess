"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MPSession } from "@/lib/multiplayer";

// Non-blocking connection status banner. It floats a pill at the top of the
// screen without covering the board or the page it sits on:
//   - while the connection is down: "Connection lost. Reconnecting… Ns" with a
//     live elapsed-seconds counter;
//   - once it comes back: "Reconnected" for three seconds, then it dismisses
//     itself.
// The confirmation only appears after an actual drop, so the initial connect
// never flashes a spurious "Reconnected". aria-live is polite and the only
// motion (the lost-state dot pulse) is gated behind motion-safe.
//
// Two entry points, one behaviour. The signal source differs by surface, the
// pill does not:
//   <ConnectionBanner session={…} />       a socket, on the game and TV surfaces
//   <PollConnectionBanner healthy={…} />   a repeating poll, on /inbox/[username]
// Anything without a repeating or persistent connection is NOT a customer for
// this: a route that fetches once is owed the error state (§8.3), where the
// recovery is the reader pressing Retry, not a banner narrating a socket.
type Phase = "idle" | "lost" | "reconnected";

/** The coarse states a caller can report, matching MPSession's vocabulary. */
export type ConnectionState = "connected" | "lost" | "reconnecting";

// docs/design-system.md §8.5: "Recovered: silent when fast (<2s), single toast
// when slow." A blip shorter than this resolves straight back to idle without
// ever announcing itself, so a one-tick network hiccup does not cost the reader
// a red pill followed by a green one.
const SILENT_RECOVERY_MS = 2000;

/**
 * The shared phase machine: drop detection, the elapsed-seconds counter, the
 * fast-recovery suppression, and the auto-dismiss. `report` is safe to call on
 * every render pass with the same value; only transitions do anything.
 */
function useConnectionPhase() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const lostAtRef = useRef<number | null>(null);

  const report = useCallback((state: ConnectionState) => {
    if (state === "lost" || state === "reconnecting") {
      setPhase((prev) => {
        if (prev !== "lost") lostAtRef.current = Date.now();
        return "lost";
      });
      return;
    }
    // Only celebrate a reconnect if we had actually dropped, and only if the
    // outage was long enough to have been worth noticing; an initial connect
    // leaves the banner idle.
    setPhase((prev) => {
      if (prev !== "lost") return "idle";
      const down = Date.now() - (lostAtRef.current ?? Date.now());
      return down < SILENT_RECOVERY_MS ? "idle" : "reconnected";
    });
  }, []);

  // Tick the elapsed-seconds counter while the connection is down.
  useEffect(() => {
    if (phase !== "lost") return;
    const tick = () => {
      const start = lostAtRef.current ?? Date.now();
      setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // Auto-dismiss the "Reconnected" confirmation after three seconds. Never a
  // modal, never something the reader has to close (§8.5).
  useEffect(() => {
    if (phase !== "reconnected") return;
    const id = window.setTimeout(() => setPhase("idle"), 3000);
    return () => window.clearTimeout(id);
  }, [phase]);

  return { phase, seconds, report };
}

function BannerPill({ phase, seconds }: { phase: Phase; seconds: number }) {
  if (phase === "idle") return null;
  const lost = phase === "lost";
  return (
    <div
      role="status"
      aria-live="polite"
      // z-[65]: above the draft overlay (z-[55]), which on phones draws an opaque
      // bg-black/70 scrim. A dropped socket DURING a timed draft decision is
      // exactly when this banner matters most, and it was hidden behind it.
      className="pointer-events-none fixed inset-x-0 top-2 z-[65] flex justify-center px-3"
    >
      <div
        className={
          "plate flex max-w-[92vw] items-center gap-2 px-4 py-2 font-display text-xs font-semibold shadow-plate " +
          (lost
            ? "border-oxblood-glow/60 bg-oxblood/20 text-oxblood-glow"
            : "border-verdigris/60 bg-verdigris/20 text-verdigris-glow")
        }
      >
        <span
          aria-hidden
          className={
            "h-2 w-2 shrink-0 rounded-full " +
            (lost ? "bg-oxblood-glow motion-safe:animate-pulse" : "bg-verdigris-glow")
          }
        />
        {lost ? <span>Connection lost. Reconnecting… {seconds}s</span> : <span>Reconnected</span>}
      </div>
    </div>
  );
}

/**
 * Socket-backed banner for the online game and spectator surfaces. Subscribes
 * to the session's coarse connection-state callback (socket lifecycle only,
 * independent of the game frame stream).
 */
export function ConnectionBanner({ session }: { session: MPSession }) {
  const { phase, seconds, report } = useConnectionPhase();
  useEffect(() => session.onConnectionState(report), [session, report]);
  return <BannerPill phase={phase} seconds={seconds} />;
}

/**
 * Poll-backed banner for surfaces whose liveness is a repeating fetch rather
 * than a socket. `healthy` is the caller's own answer to "did my last poll
 * land?", so the page keeps its data on screen while this narrates the gap:
 * the banner exists precisely so live state does not have to be unmounted
 * during a reconnect (§8.4).
 */
export function PollConnectionBanner({ healthy }: { healthy: boolean }) {
  const { phase, seconds, report } = useConnectionPhase();
  useEffect(() => {
    report(healthy ? "connected" : "lost");
  }, [healthy, report]);
  return <BannerPill phase={phase} seconds={seconds} />;
}
