// Which puzzle is today's, with no backend involved.
//
// There is no game server behind this route and no Durable Object to ask, so
// "the daily puzzle" has to be a pure function of the date and the corpus. Two
// properties matter and both are load-bearing:
//
//   Everyone sees the same one. The date is read in UTC, not local time, so a
//   player in Auckland and a player in Los Angeles are on the same puzzle at
//   the same instant and can talk about it. A local date would silently split
//   the community into two puzzles for most of the day.
//
//   The corpus is walked, not sampled. Picking `hash(date) % count` repeats
//   puzzles long before it has shown them all (the birthday problem bites at
//   around the square root of the corpus). Stepping by a fixed stride that is
//   coprime with the count visits every puzzle exactly once before any repeat,
//   so a 60-puzzle corpus lasts 60 days rather than "usually a couple of weeks".
//
// Regenerating the corpus changes `count` and therefore reshuffles which puzzle
// lands on which day. That is deliberate and harmless: nothing stores yesterday.

import type { Puzzle } from "./types";

/** The date the daily counter starts from, so puzzle numbers read as 1, 2, 3. */
const EPOCH_DAY = Date.UTC(2026, 8, 1) / 86_400_000; // 2026-09-01

/** Today in UTC as `YYYY-MM-DD`. */
export function utcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` to a whole number of days, or null when it is not a date. */
export function dayNumber(key: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const ms = Date.parse(`${key}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

/** The human-facing puzzle number for a date: day one is 2026-09-01. */
export function puzzleNumber(key: string): number {
  const day = dayNumber(key);
  return day == null ? 1 : Math.max(1, day - EPOCH_DAY + 1);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * A stride coprime with `count`, so repeated stepping is a full permutation.
 *
 * Starting near the golden ratio of the count spreads consecutive days far
 * apart in the file, which matters because the corpus is written in mining
 * order: neighbouring entries often come from the same game, and a stride of 1
 * would serve a week of near-identical positions.
 */
function strideFor(count: number): number {
  if (count <= 2) return 1;
  let s = Math.max(1, Math.round(count * 0.618));
  for (let i = 0; i < count; i++) {
    const cand = ((s + i - 1) % (count - 1)) + 1;
    if (gcd(cand, count) === 1) return cand;
  }
  return 1;
}

/** Index into the corpus for a given UTC date key. */
export function dailyIndex(key: string, count: number): number {
  if (count <= 0) return 0;
  const day = dayNumber(key) ?? EPOCH_DAY;
  const offset = day - EPOCH_DAY;
  const stride = strideFor(count);
  return ((offset * stride) % count + count) % count;
}

/** The puzzle for a date, or null when the corpus is empty. */
export function dailyPuzzle(puzzles: Puzzle[], key: string): Puzzle | null {
  if (!puzzles.length) return null;
  return puzzles[dailyIndex(key, puzzles.length)];
}

/** Yesterday's key, for the "previous day" archive link. */
export function shiftDay(key: string, delta: number): string {
  const day = dayNumber(key);
  if (day == null) return key;
  return new Date((day + delta) * 86_400_000).toISOString().slice(0, 10);
}

/** A readable date for the header ("7 September 2026"). */
export function readableDate(key: string): string {
  const day = dayNumber(key);
  if (day == null) return key;
  return new Date(day * 86_400_000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
