// Boundary tests for the clock pill's time rendering (src/lib/clockFormat.ts).
//
//   npx tsx scripts/test-clock-format.ts
//
// The bug being locked out: the sub-10s branch used toFixed(1), which ROUNDS.
// At 9999ms that produced "10.0", so a clock counting down read
//   0:11 -> 0:10 -> 0:10.0 -> 0:09.9
// showing ten seconds twice, the second time while already under ten.

import {
  EMERG_MAX_MS,
  EMERG_MIN_MS,
  emergencyMs,
  formatClock,
} from "../src/lib/clockFormat";

let failures = 0;
function eq(ms: number, want: string, why = "") {
  const got = formatClock(ms);
  if (got === want) {
    console.log(`  ok  ${String(ms).padStart(7)}ms -> ${got}${why ? "   (" + why + ")" : ""}`);
  } else {
    failures++;
    console.log(`FAIL  ${String(ms).padStart(7)}ms -> ${got}, want ${want}${why ? "   (" + why + ")" : ""}`);
  }
}

console.log("clock formatting");

// The 10s boundary: the regression lived here.
eq(10_001, "0:11", "above 10s ceils");
eq(10_000, "0:10", "exactly 10s");
eq(9_999, "0:09.9", "just under 10s must NOT read 10.0");
eq(9_990, "0:09.9");
eq(9_950, "0:09.9", "flooring, not rounding");
eq(9_900, "0:09.9");

// Tenths never round up into a value the player does not have.
eq(5_099, "0:05.0");
eq(5_000, "0:05.0");
eq(999, "0:00.9", "under a second never reads 1.0");
eq(100, "0:00.1");
eq(1, "0:00.0");
eq(0, "0:00.0", "zero");
eq(-500, "0:00.0", "negative clamps to zero");

// Minute rollover, still ceiled so a clock never reads 0:00 with time left.
eq(60_000, "1:00");
eq(59_999, "1:00");
eq(59_001, "1:00");
eq(59_000, "0:59");
eq(600_000, "10:00");

// Monotonic: as time decreases the rendered string must never read HIGHER.
// This is what actually broke — 0:10 followed by 0:10.0.
{
  const seen: string[] = [];
  for (let ms = 12_000; ms >= 0; ms -= 17) seen.push(formatClock(ms));
  let bad = "";
  for (let i = 1; i < seen.length; i++) {
    if (seen[i] === seen[i - 1]) continue;
    const a = parseSeconds(seen[i - 1]);
    const b = parseSeconds(seen[i]);
    if (b > a) {
      bad = `${seen[i - 1]} -> ${seen[i]}`;
      break;
    }
  }
  if (bad) {
    failures++;
    console.log(`FAIL  countdown went UP: ${bad}`);
  } else {
    console.log("  ok  a descending clock never renders a larger value");
  }
}

// ---------------------------------------------------------------------------
// The urgency threshold (emergencyMs).
//
// The bug being locked out here is the opposite of a rounding error: a FIXED
// threshold. The pill used to warn under 30 seconds whatever the time control,
// which in a 1+0 game is half the clock. A warning that is on for half the
// game is not a warning, and in a 15+10 game the same 30 seconds is 3 percent
// of the clock and arrives too late to act on. The threshold now scales with
// the time control, so these assertions are about the SHAPE of that scale:
// monotone, clamped at both ends, and never nonsense on bad input.
// ---------------------------------------------------------------------------
console.log("\nclock urgency threshold");

function emerg(initialMs: number, wantMs: number, why: string) {
  const got = emergencyMs(initialMs);
  if (Math.abs(got - wantMs) < 1) {
    console.log(`  ok  ${String(initialMs).padStart(7)}ms start -> warn at ${got}ms   (${why})`);
  } else {
    failures++;
    console.log(
      `FAIL  ${String(initialMs).padStart(7)}ms start -> warn at ${got}ms, want ${wantMs}ms   (${why})`,
    );
  }
}

// The real time controls the lobby offers.
emerg(60_000, 10_000, "1+0 bullet: one eighth is 7.5s, so the floor binds");
emerg(180_000, 22_500, "3+2 blitz: one eighth, inside both clamps");
emerg(300_000, 37_500, "5+0 blitz");
emerg(600_000, 60_000, "10+0 rapid: one eighth is 75s, so the ceiling binds");
emerg(900_000, 60_000, "15+10: still at the ceiling");

// The clamps, at their exact boundaries.
emerg(EMERG_MIN_MS * 8, EMERG_MIN_MS, "exactly at the floor");
emerg(EMERG_MAX_MS * 8, EMERG_MAX_MS, "exactly at the ceiling");
emerg(1_000, EMERG_MIN_MS, "absurdly short clock still gets the floor");

// Bad input must not produce a threshold of zero, which would silently
// disable every warning and every urgency colour for that clock.
for (const bad of [0, -1, NaN, Infinity]) {
  const got = emergencyMs(bad);
  if (got === EMERG_MIN_MS) {
    console.log(`  ok  ${String(bad).padStart(7)} start -> falls back to the floor`);
  } else {
    failures++;
    console.log(`FAIL  ${String(bad)} start -> ${got}, want the ${EMERG_MIN_MS}ms floor`);
  }
}

// Monotone: a longer clock never warns EARLIER than a shorter one.
{
  let prev = -1;
  let bad = "";
  for (let initial = 10_000; initial <= 1_800_000; initial += 10_000) {
    const got = emergencyMs(initial);
    if (got < prev) bad = `${initial}ms warns at ${got}ms, below the previous ${prev}ms`;
    prev = got;
  }
  if (bad) {
    failures++;
    console.log(`FAIL  threshold is not monotone: ${bad}`);
  } else {
    console.log("  ok  a longer clock never warns earlier than a shorter one");
  }
}

// The warning must always leave real time to act in, and must never exceed
// the clock it is warning about (which would mean warning from move one).
{
  let bad = "";
  for (let initial = 10_000; initial <= 1_800_000; initial += 5_000) {
    const got = emergencyMs(initial);
    if (got > initial) bad = `${initial}ms clock warns at ${got}ms, before the game starts`;
  }
  if (bad) {
    failures++;
    console.log(`FAIL  ${bad}`);
  } else {
    console.log("  ok  the warning point never exceeds the clock it warns about");
  }
}

function parseSeconds(label: string): number {
  const [m, rest] = label.split(":");
  return Number(m) * 60 + Number(rest);
}

if (failures) {
  console.error(`\n${failures} clock-format assertion(s) failed`);
  process.exit(1);
}
console.log("clock formatting: OK");
