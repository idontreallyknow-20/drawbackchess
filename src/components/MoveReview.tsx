"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { makeMove } from "@/engine/board";
import type { BoardState, Move } from "@/engine/types";
import { evalPercent } from "@/components/EvalBar";

// ---------------------------------------------------------------------------
// Move classification (the lichess pattern: blunder / mistake / inaccuracy /
// good / best), and what it is honestly allowed to claim.
//
// It is built on the same plain-chess search as the eval bar, so it inherits
// the same blind spot: the engine does not know about nerfs, buffs, drops or
// board effects. On the analysis board that blind spot is empty, because the
// analysis board IS plain chess: you move both sides on a bare BoardState with
// no rules attached. That is why classification lives here and not on the game
// surfaces. Deep-linking a nerf game's move list into /analysis strips the
// rules along with everything else, and the page already says so ("this game
// used cards the analysis board cannot replay").
//
// The blind spot that remains is DEPTH. A three-ply search calling a move
// "best" is asserting more than it knows, so the fine grades are gated on the
// depth actually reached at both ends of the move:
//
//   * blunder / mistake need depth >= 2 on both positions
//   * inaccuracy / best need depth >= 3 on both
//   * anything shallower is "unclear", and says so
//
// The scale is a win-percentage delta rather than a raw centipawn delta,
// because losing 100cp when you are already three pawns up is not a mistake and
// losing 100cp from level is. evalPercent is the same sigmoid the bar uses.
// ---------------------------------------------------------------------------

export type MoveClass = "best" | "good" | "inaccuracy" | "mistake" | "blunder" | "unclear";

export type ReviewRow = {
  /** 0-based index into the move list. */
  index: number;
  cls: MoveClass;
  /** Win-percentage the mover gave away, from their own point of view. */
  lossPct: number;
  /** White-relative centipawns after the move. */
  cpWhiteAfter: number;
  /** Shallowest depth used on the two positions the grade compares. */
  depth: number;
};

/** Win chance for `color`, from the white-relative score. */
function winPct(cpWhite: number, color: "w" | "b"): number {
  const w = evalPercent(cpWhite);
  return color === "w" ? w : 100 - w;
}

const BLUNDER_PCT = 18;
const MISTAKE_PCT = 9;
const INACCURACY_PCT = 4;

/**
 * Pure grading step, so the thresholds can be reasoned about (and tested)
 * without a browser or a search.
 *
 * `depth` is the depth reached at BOTH ends of the move, or 0 when the two ends
 * did not reach the same depth. That equality is not a nicety, it is the whole
 * thing: an odd-depth search hands the side to move the last word, so comparing
 * a depth-3 reading against a depth-4 one swings the white-relative score by
 * tens of win-percent for no reason on the board. A first cut of this graded
 * whatever depth each position happened to reach and called six moves of a
 * quiet London System "blunders". Same depth, even, at both ends, or no grade.
 */
export function classifyLoss(
  lossPct: number,
  playedWasBest: boolean,
  depth: number,
): MoveClass {
  if (depth < 2 || depth % 2 !== 0) return "unclear";
  if (lossPct >= BLUNDER_PCT) return "blunder";
  if (lossPct >= MISTAKE_PCT) return "mistake";
  if (lossPct >= INACCURACY_PCT) return "inaccuracy";
  // "Best" is the only grade that claims to know what the ALTERNATIVES were
  // worth, so it needs both agreement with the search and a loss of nothing.
  // At this depth that means "you played the move that wins the tactics", not
  // "no stronger move exists"; the panel says so rather than implying more.
  return playedWasBest && lossPct < 1 ? "best" : "good";
}

export const CLASS_GLYPH: Record<MoveClass, string> = {
  blunder: "??",
  mistake: "?",
  inaccuracy: "?!",
  good: "",
  best: "!",
  unclear: "",
};

// Accent tones for the annotation GLYPHS only. The words beside them stay in
// ordinary text colour, because these accents are chosen for recognition rather
// than for contrast and three of them (the brass especially) do not clear the
// small-text ratio on the light theme's white panels. A "??" in red next to a
// readable "Blunder" says the same thing and stays legible in both themes.
export const CLASS_TONE: Record<MoveClass, string> = {
  blunder: "text-oxblood",
  mistake: "text-coral",
  inaccuracy: "text-brag",
  good: "text-parchment-400",
  best: "text-verdigris",
  unclear: "text-parchment-500",
};

export const CLASS_LABEL: Record<MoveClass, string> = {
  blunder: "Blunder",
  mistake: "Mistake",
  inaccuracy: "Inaccuracy",
  good: "Good",
  best: "Best",
  unclear: "Not judged",
};

export type ReviewState = {
  rows: ReviewRow[];
  /** Positions scored so far, out of `total`. */
  scored: number;
  total: number;
  running: boolean;
  done: boolean;
  /** Slowest single search pass in this run, in ms. */
  worstPassMs: number;
};

const IDLE_REVIEW: ReviewState = {
  rows: [],
  scored: 0,
  total: 0,
  running: false,
  done: false,
  worstPassMs: 0,
};

// Depth 2 with quiescence, one position per idle callback.
//
// The depth is fixed and EVEN on purpose (see classifyLoss). It is 2 rather
// than 4 because of what depth 4 costs: measured over 40 real middlegame
// positions, a budget large enough to actually REACH depth 4 runs 200 to 600ms
// per position, which for a 40-move game is ten seconds of half-second main
// thread blocks. Depth 2 completes on every one of those positions in 6ms
// typical, 40ms worst, so a whole game reviews in about a second with no block
// longer than a dropped frame.
//
// Re-measured after two engine changes that both had a claim on this number
// (round 8 moved buff augmentation inside `genMoves`, making every node more
// expensive; round 9 turned the search's abort from `budget * 2` into a hard
// `budget`, so this 60 now buys half the wall time it used to). It survives
// both, and `scripts/bench-move-review.ts` is the guard that keeps it honest:
// 51 of 51 middlegame positions reach depth 2, p50 11.1ms, p95 29.1ms, worst
// 40.5ms. The budget is not the binding constraint here and never was -- given
// 300ms the same positions still finish in a worst case of 37.6ms, because
// depth 2 simply costs what it costs and the deepening loop stops on its own.
// The margin is 1.5x on this box, so a device that much slower degrades: not
// into a wrong grade, but into "unclear", which is what classifyLoss's guard
// is for.
//
// What depth 2 buys, thanks to the quiescence search underneath it, is the
// resolution of capture sequences: hung pieces, losing trades and a king that
// can be taken. That is what a blunder actually is, most of the time. What it
// does not buy is a judgement about quiet positional moves, which is why the
// panel prints the depth next to the grades instead of hiding it.
const REVIEW_BUDGET_MS = 60;
const REVIEW_TARGET_DEPTH = 2;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/**
 * Scores every position in the line once (N+1 searches for N moves), one per
 * idle callback, then grades each move from the pair of scores around it.
 * Restarting or changing the line cancels the run in flight.
 */
export function useLineReview(startBoard: BoardState, moves: Move[]) {
  // The run is tagged with the exact move array it graded, and a run for any
  // other line is simply not shown. That is what makes a new line reset the
  // panel without an effect writing state: the stale grades are still in the
  // ref, they just no longer match, so nothing renders them.
  const [run, setRun] = useState<{ line: Move[]; state: ReviewState } | null>(null);
  const runId = useRef(0);
  const cancelRef = useRef<(() => void) | null>(null);
  const state = run && run.line === moves ? run.state : IDLE_REVIEW;
  const setState = useCallback(
    (next: ReviewState | ((s: ReviewState) => ReviewState), line: Move[]) => {
      setRun((prev) => ({
        line,
        state:
          typeof next === "function"
            ? next(prev && prev.line === line ? prev.state : IDLE_REVIEW)
            : next,
      }));
    },
    [],
  );

  // A new line stops the search still grading the old one. No state is written
  // here: `state` above already reads as idle the moment `moves` changes.
  useEffect(() => {
    runId.current += 1;
    const cancel = cancelRef.current;
    return () => cancel?.();
  }, [startBoard, moves]);

  const start = useCallback(() => {
    cancelRef.current?.();
    const id = ++runId.current;
    const line = moves;
    if (moves.length === 0) return;

    // Replay once so every position is materialised before any search runs.
    const boards: BoardState[] = [startBoard];
    let b = startBoard;
    for (const m of moves) {
      b = makeMove(b, m);
      boards.push(b);
    }

    const cps: number[] = new Array(boards.length).fill(0);
    const depths: number[] = new Array(boards.length).fill(0);
    const bests: (Move | null)[] = new Array(boards.length).fill(null);
    let i = 0;
    let worst = 0;
    let cancelled = false;
    let idleId: number | null = null;
    let timerId: number | null = null;
    const w = window as IdleWindow;

    setState(
      { rows: [], scored: 0, total: boards.length, running: true, done: false, worstPassMs: 0 },
      line,
    );

    const finish = () => {
      const rows: ReviewRow[] = moves.map((m, k) => {
        const mover = m.color;
        // Unequal depths are not comparable, so they are not compared.
        const depth = depths[k] === depths[k + 1] ? depths[k] : 0;
        const before = winPct(cps[k], mover);
        const after = winPct(cps[k + 1], mover);
        const lossPct = Math.max(0, before - after);
        const best = bests[k];
        const playedWasBest =
          !!best && best.from === m.from && best.to === m.to && best.promotion === m.promotion;
        return {
          index: k,
          cls: classifyLoss(lossPct, playedWasBest, depth),
          lossPct,
          cpWhiteAfter: cps[k + 1],
          depth,
        };
      });
      setState(
        {
          rows,
          scored: boards.length,
          total: boards.length,
          running: false,
          done: true,
          worstPassMs: worst,
        },
        line,
      );
    };

    const pass = async () => {
      const { analyzeBoard } = await import("@/engine/ai");
      if (cancelled || runId.current !== id) return;
      const t0 = performance.now();
      const r = analyzeBoard(boards[i], REVIEW_BUDGET_MS, REVIEW_TARGET_DEPTH);
      worst = Math.max(worst, performance.now() - t0);
      cps[i] = r.scoreCp * (boards[i].turn === "w" ? 1 : -1);
      depths[i] = r.depth;
      bests[i] = r.move;
      i += 1;
      if (cancelled || runId.current !== id) return;
      if (i >= boards.length) {
        finish();
        return;
      }
      setState((s) => ({ ...s, scored: i, worstPassMs: worst }), line);
      schedule();
    };

    const schedule = () => {
      if (typeof w.requestIdleCallback === "function") {
        idleId = w.requestIdleCallback(() => void pass(), { timeout: 300 });
        return;
      }
      timerId = window.setTimeout(() => void pass(), 16);
    };

    cancelRef.current = () => {
      cancelled = true;
      if (idleId != null) w.cancelIdleCallback?.(idleId);
      if (timerId != null) window.clearTimeout(timerId);
    };
    schedule();
  }, [startBoard, moves, setState]);

  const reset = useCallback(() => {
    cancelRef.current?.();
    runId.current += 1;
    setRun(null);
  }, []);

  return { state, start, reset };
}

/** Per-side tallies for the summary line. */
export function reviewTally(rows: ReviewRow[], moves: Move[], color: "w" | "b") {
  const mine = rows.filter((r) => moves[r.index]?.color === color);
  const count = (c: MoveClass) => mine.filter((r) => r.cls === c).length;
  return {
    blunder: count("blunder"),
    mistake: count("mistake"),
    inaccuracy: count("inaccuracy"),
    best: count("best"),
    unclear: count("unclear"),
    total: mine.length,
  };
}

/** The annotation that rides next to a SAN in the move list. */
export function MoveMark({ cls }: { cls: MoveClass | undefined }) {
  if (!cls || !CLASS_GLYPH[cls]) return null;
  return (
    <span
      // Inherits the move list's own size on purpose: a mark set one step
      // larger than the SAN it annotates reads as a separate word.
      className={"ml-0.5 font-mono " + CLASS_TONE[cls]}
      title={CLASS_LABEL[cls]}
      aria-label={CLASS_LABEL[cls]}
    >
      {CLASS_GLYPH[cls]}
    </span>
  );
}
