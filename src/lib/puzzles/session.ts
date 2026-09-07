// Local record of what this browser has solved.
//
// There is no account requirement on this route and no server to write to, so
// "solved" lives in localStorage and nowhere else. That is the honest scope: it
// is a convenience for one browser, not a profile statistic, and the UI never
// presents it as a ranking.
//
// It is exposed as a `useSyncExternalStore` source rather than as a plain
// getter called from an effect. Reading browser storage during render would
// disagree with the server-rendered HTML, and reading it in an effect that then
// calls setState is a cascading render (and the rule the linter enforces).
// A subscribe/snapshot pair is the shape React actually wants for "state that
// lives outside React", which is exactly what localStorage is.
//
// Every access is wrapped: private windows, cleared site data and storage-
// blocking settings all throw on read, and a puzzle that cannot remember being
// solved must still be playable.

const SOLVED_KEY = "nc.puzzles.solved.v1";
const STREAK_KEY = "nc.puzzles.streak.v1";
/** Bounded so a long-lived browser cannot grow the entry without limit. */
const MAX_SOLVED = 400;

export interface DailyStreak {
  /** Consecutive days finished, counting today. */
  days: number;
  /** The last daily date key that was solved. */
  last: string;
}

/** Server-render snapshots. Frozen module constants, so they are referentially
 *  stable: `useSyncExternalStore` compares by identity and a fresh object each
 *  call would loop forever. */
const NO_SOLVED: string[] = [];
const NO_STREAK: DailyStreak = { days: 0, last: "" };

const listeners = new Set<() => void>();

function readRaw(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the puzzle still works, it just forgets */
  }
  for (const cb of listeners) cb();
}

export function subscribeSession(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab solving a puzzle counts too.
  if (typeof window !== "undefined") window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onChange);
  };
}

// Parsed snapshots, memoised on the raw string so repeated reads return the
// same object identity until storage actually changes.
let solvedRaw: string | null = null;
let solvedValue: string[] = NO_SOLVED;

export function solvedSnapshot(): string[] {
  const raw = readRaw(SOLVED_KEY);
  if (raw !== solvedRaw) {
    solvedRaw = raw;
    try {
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      solvedValue = Array.isArray(parsed) ? (parsed as string[]) : NO_SOLVED;
    } catch {
      solvedValue = NO_SOLVED;
    }
  }
  return solvedValue;
}

export function solvedServerSnapshot(): string[] {
  return NO_SOLVED;
}

let streakRaw: string | null = null;
let streakValue: DailyStreak = NO_STREAK;

export function streakSnapshot(): DailyStreak {
  const raw = readRaw(STREAK_KEY);
  if (raw !== streakRaw) {
    streakRaw = raw;
    try {
      const parsed = raw ? (JSON.parse(raw) as DailyStreak) : null;
      streakValue =
        parsed && typeof parsed.days === "number" && typeof parsed.last === "string"
          ? parsed
          : NO_STREAK;
    } catch {
      streakValue = NO_STREAK;
    }
  }
  return streakValue;
}

export function streakServerSnapshot(): DailyStreak {
  return NO_STREAK;
}

export function markSolved(id: string): void {
  const list = solvedSnapshot();
  if (list.includes(id)) return;
  writeRaw(SOLVED_KEY, [...list, id].slice(-MAX_SOLVED));
}

/**
 * Record today's daily as solved and return the streak.
 *
 * A streak only extends when the previous solved day was the day before. Any
 * other gap restarts it at one, and re-solving the same day is a no-op, so
 * replaying today cannot inflate the count.
 */
export function recordDaily(dateKey: string, previousDayKey: string): DailyStreak {
  const cur = streakSnapshot();
  if (cur.last === dateKey) return cur;
  const next: DailyStreak = {
    days: cur.last === previousDayKey ? cur.days + 1 : 1,
    last: dateKey,
  };
  writeRaw(STREAK_KEY, next);
  return next;
}
