// Clock rendering, kept as a pure module so it can be tested headlessly
// (scripts/test-clock-format.ts) without pulling React or the sound layer in
// through ClockPill.

/**
 * Render remaining time for a clock pill.
 *
 * Above 10s: `m:ss`, CEILED — a clock never reads 0:00 while time remains.
 * Below 10s: `0:ss.t` with one decimal, so the last stretch feels urgent.
 *
 * The tenths are FLOORED, not rounded. `toFixed(1)` rounds, so 9999ms rendered
 * "10.0" and the pill showed "0:10.0" immediately after "0:10" — claiming a
 * full ten seconds while already under ten. Flooring also matches the ceil
 * above it in intent (never overstate what is left) and reaches "0:00.0" only
 * at true zero.
 */
export function formatClock(ms: number, tenths: "never" | "low" | "always" = "low"): string {
  const clamped = Math.max(0, ms);
  const showTenths = tenths === "always" ? clamped < 3_600_000 : tenths === "low" && clamped < 10000;
  if (showTenths) {
    const totalTenths = Math.floor(clamped / 100);
    const m = Math.floor(totalTenths / 600);
    const s = Math.floor((totalTenths % 600) / 10);
    const t = totalTenths % 10;
    return `${m}:${s.toString().padStart(2, "0")}.${t}`;
  }
  const totalSec = Math.ceil(clamped / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * When a clock becomes urgent, as a fraction of what it started with.
 *
 * A fixed threshold cannot work across the time controls this site offers.
 * The pill used to turn gold under 30 seconds and red under 10, which is
 * right for 10+0 and nonsense for 1+0: in a bullet game 30 seconds is HALF
 * the clock, so the warning colour was on for most of the game and therefore
 * told the player nothing. In a 15+10 game that same 30 seconds is 3 percent
 * of the clock and arrives far too late to change how anyone plays.
 *
 * Lichess scales the threshold to the time control instead (see
 * `ui/lib/src/game/clock/clockCtrl.ts`, which sets its emergency point to one
 * eighth of the initial time, clamped between 10 and 60 seconds), and the
 * same shape is right here. 1+0 resolves to 10 seconds, 3+2 to 22.5, 10+0 to
 * 60, and everything between lands somewhere sensible.
 *
 * The clamp matters at both ends. Without the floor, a 30 second game would
 * only warn with 3.75 seconds left, well past the point of being actionable.
 * Without the ceiling, a very long clock would sit in its warning state for
 * minutes, which is the same "always on, therefore meaningless" failure in
 * the other direction.
 */
export const EMERG_FRACTION = 1 / 8;
export const EMERG_MIN_MS = 10_000;
export const EMERG_MAX_MS = 60_000;

export function emergencyMs(initialMs: number): number {
  if (!Number.isFinite(initialMs) || initialMs <= 0) return EMERG_MIN_MS;
  return Math.min(EMERG_MAX_MS, Math.max(EMERG_MIN_MS, initialMs * EMERG_FRACTION));
}
