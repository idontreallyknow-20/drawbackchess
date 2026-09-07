"use client";

import { useEffect, useRef, useState } from "react";
import { emergencyMs, formatClock } from "@/lib/clockFormat";
import { LOW_TIME_MOTION_MS, releaseLowTime, reportLowTime } from "@/lib/lowTimeMotion";
import { useSettingsValue } from "@/lib/useSettingsValue";
import { playLowTime, playUrgentTick } from "@/lib/sounds";

// Shared across every ClockPill instance so the duplicated mobile/desktop
// copies of the same clock never double-play a warning within one tick.
let lastClockWarnAt = 0;
function warnClockOnce(play: () => void) {
  const now = Date.now();
  if (now - lastClockWarnAt < 900) return;
  lastClockWarnAt = now;
  play();
}

// Lives in a pure module so the boundary behaviour is unit-testable without
// React; re-exported here because this is where callers expect to find it.
export { formatClock } from "@/lib/clockFormat";

export { emergencyMs } from "@/lib/clockFormat";

export function ClockPill({
  ms,
  active,
  compact = false,
  startDelayMs = 0,
  warnLowTime = false,
  draftRunning = false,
  seat = null,
  ended = false,
  initialMs,
}: {
  ms: number;
  active: boolean;
  compact?: boolean;
  startDelayMs?: number;
  /** The time control's starting time, used to scale the urgency thresholds
   *  (see `emergencyMs`). Optional: when a caller does not pass it the pill
   *  falls back to the first `ms` it was ever handed, which IS the initial
   *  time for anyone who was present at the start of the game. A spectator
   *  who joins mid-game gets a smaller base and so a slightly later warning,
   *  which is the safe direction to be wrong in for someone who is not
   *  playing. */
  initialMs?: number;
  /** Engine color of the seat this pill times, stamped as data-clock-seat so
   * the clock-raid overlay can find and aim at the on-screen pill. Mobile and
   * desktop copies share the seat; the overlay picks whichever is visible. */
  seat?: "w" | "b" | null;
  // When true, this clock belongs to the local player: play a low-time warning
  // as it ticks past 10s, and an urgent tick past 5s. Fires once per crossing
  // and re-arms only if time climbs back above the threshold (increment).
  warnLowTime?: boolean;
  // An unresolved draft is charging this clock (the free pick window ended):
  // a small DRAFT tag rides inside the pill so the reason the clock is
  // running is visible right where the player watches the time.
  draftRunning?: boolean;
  // The game is over: release the low-time animation hold so the result
  // screen animates normally even though this clock still reads under 20s.
  ended?: boolean;
}) {
  const [displayMs, setDisplayMs] = useState(ms);
  const lowFiredRef = useRef(false);
  const urgentFiredRef = useRef(false);
  // First value ever seen, kept as the fallback base for the urgency scale
  // when the caller does not name the time control. Captured once at mount
  // rather than tracked as a running maximum: an increment pushes `ms` above
  // the starting time, so a maximum would creep upward all game and slowly
  // widen the warning band.
  const [firstMs] = useState(ms);
  const emergMs = emergencyMs(initialMs ?? firstMs);
  // First-move grace: milliseconds of free time left before this clock
  // actually starts charging (startDelayMs counting down to zero).
  const [graceMs, setGraceMs] = useState(() => (active ? startDelayMs : 0));

  // Snap the display back to the authoritative clock values whenever they
  // change (adjust during render), leaving the effect to run the tick loop.
  // `base` is the figure the tick loop counts down from. When only `active`
  // flips (a draft pause and its resume, same banked ms) the display freezes
  // where it stood and resumes from there: snapping to the banked value would
  // hand back the seconds already spent this turn, which the game clock still
  // charges, so the pill would read ahead of the real flag.
  const [base, setBase] = useState(ms);
  const [prevSync, setPrevSync] = useState({ ms, active, startDelayMs });
  if (prevSync.ms !== ms || prevSync.startDelayMs !== startDelayMs) {
    setPrevSync({ ms, active, startDelayMs });
    setBase(ms);
    setDisplayMs(ms);
    setGraceMs(active ? startDelayMs : 0);
  } else if (prevSync.active !== active) {
    setPrevSync({ ms, active, startDelayMs });
    setBase(displayMs);
    setGraceMs(active ? startDelayMs : 0);
  }

  useEffect(() => {
    if (!active) return;

    const startedAt = performance.now();
    let raf = 0;
    let timer = 0;

    const update = () => {
      const now = performance.now();
      const elapsed = Math.max(0, now - startedAt - startDelayMs);
      const remaining = Math.max(0, base - elapsed);
      const grace = Math.max(0, startDelayMs - (now - startedAt));
      setDisplayMs(remaining);
      setGraceMs(grace);

      // Low-time warnings only for the local player's own running clock, and
      // never while the first-move grace timer is still shielding it. The two
      // thresholds ride the same time-control-relative scale as the colours,
      // so in a bullet game the first warning is not shouting from move one.
      if (warnLowTime && grace <= 0) {
        if (remaining > emergMs) lowFiredRef.current = false;
        else if (!lowFiredRef.current) {
          lowFiredRef.current = true;
          warnClockOnce(playLowTime);
        }
        const urgentAt = emergMs / 2;
        if (remaining > urgentAt) urgentFiredRef.current = false;
        else if (remaining > 0 && !urgentFiredRef.current) {
          urgentFiredRef.current = true;
          warnClockOnce(playUrgentTick);
        }
      }
    };

    const tick = () => {
      update();
      // Cadence keys off the time LEFT, not the `ms` prop. The prop is the last
      // authoritative value and deliberately does not change per tick (the pill
      // self-interpolates via rAF, so the game view is not repainted every
      // frame) — so keying on it meant a player thinking from 60s down to 2s
      // kept the 250ms cadence the whole way, and the sub-10s tenths display
      // advanced in visible 0.25s jumps.
      const remaining = Math.max(0, base - Math.max(0, performance.now() - startedAt - startDelayMs));
      timer = window.setTimeout(tick, remaining < 10000 ? 100 : 250);
    };

    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [active, base, startDelayMs, warnLowTime, emergMs]);

  // Low-time animation hold: while this seat's clock reads under 20s every
  // animation stands down (src/lib/lowTimeMotion.ts), for either seat, and
  // returns once both clocks are back above the line. Keyed by seat so the
  // mobile and desktop copies of one pill agree; released on unmount.
  useEffect(() => {
    if (!seat) return;
    reportLowTime(seat, !ended && displayMs < LOW_TIME_MOTION_MS);
  }, [seat, ended, displayMs]);
  useEffect(() => {
    if (!seat) return;
    return () => releaseLowTime(seat);
  }, [seat]);

  // Urgency ramp, scaled to the time control (see `emergencyMs`): the clock
  // tints gold at twice the emergency point and oxblood at the point itself.
  // Border stays 2px across every active tier so switching urgency never
  // shifts layout; the countdown text is always tabular-nums so digits never
  // jitter.
  const { clockTenths: tenths } = useSettingsValue();
  const low = displayMs < emergMs * 2;
  const critical = displayMs < emergMs;
  return (
    <div
      data-clock-seat={seat ?? undefined}
      className={
        "plate flex items-center justify-center transition " +
        (compact ? "shrink-0 px-2.5 py-1 sm:px-3 sm:py-1.5 " : "p-4 ") +
        (active
          ? critical
            ? "border-oxblood-glow bg-oxblood/25"
            : "border-gold bg-gold/10"
          // Idle clocks stay clearly readable; the accent border and fill on
          // the running clock (not heavy dimming) marks whose turn it is.
          : "opacity-80")
      }
    >
      <span
        className={
          "font-mono tabular-nums font-bold tracking-wide " +
          (compact ? "text-[26px] leading-none sm:text-xl sm:leading-normal " : "text-4xl ") +
          (critical
            ? "text-oxblood-glow"
            : low
            ? "text-gold-leaf"
            : "text-parchment")
        }
      >
        {/* The separator blinks while the clock is actually running.
            Lichess does this and it reads as decoration there; here it
            carries real information, because this clock genuinely stops. A
            draft pauses it, the first-move grace shields it, and a paused
            clock and a running one otherwise look identical for the whole
            second between digit changes. A player glancing down needs to know
            whether their time is going.

            Split rather than restyled so `formatClock` keeps returning one
            plain string (scripts/test-clock-format.ts asserts on it). The
            colon stays in the accessible text rather than being aria-hidden:
            hiding it would leave a screen reader reading "205" for 2:05.
            Ambient loops are otherwise banned by design-system.md section 6;
            clock urgency is the sanctioned exception. */}
        {(() => {
          const text = formatClock(displayMs, tenths);
          const at = text.indexOf(":");
          if (at < 0 || !active || graceMs > 0) return text;
          return (
            <>
              {text.slice(0, at)}
              <span className="clock-sep">:</span>
              {text.slice(at + 1)}
            </>
          );
        })()}
      </span>
      {draftRunning && (
        <span
          title="Your draft is unresolved and this clock is running"
          aria-label="Draft unresolved: this clock is running"
          className={
            "shrink-0 border border-oxblood-glow/60 bg-oxblood/20 font-display font-bold text-oxblood-glow " +
            (compact ? "ml-1.5 px-1 text-[12px]" : "ml-2 px-1.5 text-[12px]")
          }
        >
          Draft
        </span>
      )}
      {active && graceMs > 0 && (
        <span
          role="timer"
          aria-label={`Free time: ${Math.ceil(graceMs / 1000)} seconds until the clock starts`}
          title="Free time before your clock starts"
          className={
            "font-mono tabular-nums text-gold-leaf " +
            (compact ? "ml-1.5 text-[12px]" : "ml-2 text-sm")
          }
        >
          +{Math.ceil(graceMs / 1000)}
        </span>
      )}
    </div>
  );
}
