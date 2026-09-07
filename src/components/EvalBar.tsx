"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardAnalysis } from "@/engine/ai";
import type { BoardState, Color, Move } from "@/engine/types";
import { acquireEvalWorker, releaseEvalWorker, requestEval } from "@/workers/evalClient";

// ---------------------------------------------------------------------------
// The eval bar, and the one honest thing it is allowed to say.
//
// `analyzeBoard` (engine/ai.ts) searches a bare BoardState. It knows the pieces,
// it knows that the game ends when a king is captured (its terminal test is a
// missing king, not checkmate), and that is the entire list. It does not know
// about nerfs, buffs, pocket drops, walls, frozen squares, or any of the other
// rules that decide most games on this site. A nerf that forbids a player from
// moving their queen does not exist as far as the search is concerned: it will
// happily build a principal variation out of moves that player cannot legally
// make, and then report the result to two significant figures.
//
// So the number is the eval of a DIFFERENT GAME than the one on screen, and the
// dishonesty is not the number's sign, it is its precision. "+2.3" claims to
// have resolved a position to a fifth of a pawn. On a board where a rule is
// live, that claim is not earned.
//
// The rule this file enforces:
//
//   * No rules in play  -> the position really IS plain chess. Show the signed
//     number, smooth bar, best move, depth. This is the analysis board.
//
//   * Any rule in play  -> the reading is an ESTIMATE of the plain-chess
//     skeleton underneath. The bar quantises to seven bands, the readout is a
//     word rather than a number, and the caption names the specific rules the
//     estimate is blind to. A word cannot be over-read the way "+2.3" can.
//
// The second mode deliberately does not hide the bar. Material and king safety
// are real, they survive the rules, and a player reviewing a game is better off
// with a coarse true statement than with nothing. What they must never get is a
// precise false one.
//
// Scheduling: the search runs in a worker (src/workers/evalWorker.ts), so it
// costs the page no frames at all. It still climbs a ladder of budgets, but for
// a different reason than it used to — a rough reading in 15ms and a good one a
// third of a second later beats one reading that arrives late — rather than as
// a way of slicing an unaffordable main-thread block into affordable pieces.
//
// Browsers without workers (and SSR) fall back to the old idle-callback ladder,
// with every rung clamped to MAIN_THREAD_RUNG_CAP_MS so the fallback stays
// frame-safe. It reads a shallower position; that is the price of not having a
// thread to put the work on, and it is paid where it belongs.
//
// Budgets below are TRUE wall times. They used to be halves: negamax aborted at
// `budget * 2`, so this file's old ladder cost about twice what it said and
// /analysis's original `analyzeBoard(board, 300)` was a 601ms block. The abort
// is now the number the caller asked for (see engine/ai.ts).
// ---------------------------------------------------------------------------

/** Lazily loaded so the ~700-line search never lands in a route's first paint.
 *  Only the main-thread fallback needs it; the worker imports its own copy. */
let enginePromise: Promise<typeof import("@/engine/ai")> | null = null;
function loadEngine() {
  if (!enginePromise) enginePromise = import("@/engine/ai");
  return enginePromise;
}

/** One rung of the deepening ladder. `budgetMs` is a hard deadline. */
export type EvalRung = { budgetMs: number; maxDepth: number };

/** No main-thread fallback rung may cost more than this. One frame at 60Hz is
 *  16.7ms; a rung that lands inside a single dropped frame is a cost a viewer
 *  scrubbing a move list will not see. */
const MAIN_THREAD_RUNG_CAP_MS = 24;

// The game surfaces (replay, spectating, a finished match) want a reading that
// tracks the move list as the viewer arrows through it, so the ladder stays
// short and lands its first rung almost immediately.
export const EVAL_LADDER_GAME: EvalRung[] = [
  { budgetMs: 15, maxDepth: 2 },
  { budgetMs: 45, maxDepth: 3 },
  { budgetMs: 120, maxDepth: 5 },
];

// The analysis board wants depth, and off the main thread it can simply have
// it: the last rung is a third of a second of real search, which is more than
// the old `analyzeBoard(board, 300)` ever completed, and costs the page nothing.
export const EVAL_LADDER_ANALYSIS: EvalRung[] = [
  { budgetMs: 15, maxDepth: 2 },
  { budgetMs: 45, maxDepth: 3 },
  { budgetMs: 120, maxDepth: 5 },
  { budgetMs: 350, maxDepth: 8 },
];

/** One position's reading, always tied to the exact board it came from. */
export type BoardEval = {
  board: BoardState;
  /** Centipawns from WHITE's point of view. */
  cpWhite: number;
  /** Deepest fully searched depth, 0 for a terminal position. */
  depth: number;
  best: Move | null;
  /** Wall-clock cost of the pass that produced this reading, in ms. */
  costMs: number;
  /** Where that cost was paid. "main" means this browser has no worker and the
   *  reading is the shallow, frame-safe fallback. */
  thread: "worker" | "main";
  /** The ladder has no rungs left for this position. */
  settled: boolean;
};

/** A king is off the board: the game is already decided and no search is
 *  needed, or meaningful. Returns white-relative centipawns, or null. */
function terminalCp(board: BoardState): number | null {
  let w = false;
  let b = false;
  for (const p of board.pieces) {
    if (p?.type !== "k") continue;
    if (p.color === "w") w = true;
    else b = true;
  }
  if (!w && !b) return 0;
  if (!w) return -100000;
  if (!b) return 100000;
  return null;
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/**
 * Runs the ladder over `board`, one rung per idle callback, publishing each
 * rung's result as it lands. Returns null until the first usable rung arrives
 * and whenever the held reading belongs to a different position: a score
 * searched from the previous board is not a weaker answer here, it is the
 * wrong one, so it is withheld rather than re-signed.
 *
 * `ladder` must be a stable reference (use the exported constants).
 */
export function useBoardEval(
  board: BoardState | null | undefined,
  enabled: boolean,
  ladder: EvalRung[] = EVAL_LADDER_GAME,
): BoardEval | null {
  const [result, setResult] = useState<BoardEval | null>(null);
  // A decided position needs no search, and is derived during render rather
  // than pushed through state: writing it from the effect would cascade a
  // render for a value that is a pure function of the board.
  const decided = board && enabled ? terminalCp(board) : null;

  // The worker is claimed for as long as the bar is mounted and enabled, not
  // per position: a thread started and stopped on every move would pay the
  // engine's parse cost on every move. Held in a ref rather than state so
  // claiming it does not cascade a render; this effect is declared BEFORE the
  // search effect, and React runs a component's effects in declaration order,
  // so the ref is already answered when the search below first reads it.
  const workerRef = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const claimed = acquireEvalWorker();
    workerRef.current = claimed;
    return () => {
      workerRef.current = false;
      if (claimed) releaseEvalWorker();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !board || terminalCp(board) != null) return;

    let cancelled = false;
    let idleId: number | null = null;
    let timerId: number | null = null;
    let rung = 0;
    // Local, because a worker that dies mid-ladder demotes THIS ladder to the
    // main thread without waiting for a remount.
    let onWorker = workerRef.current;
    const w = window as IdleWindow;

    const cancelPending = () => {
      if (idleId != null) w.cancelIdleCallback?.(idleId);
      if (timerId != null) window.clearTimeout(timerId);
      idleId = null;
      timerId = null;
    };

    // depth 0 means the rung's budget expired before a single ply finished, so
    // `scoreCp` is the initialiser and `move` is just the first generated move.
    // Publishing that would paint a confident "level" over an unsearched
    // position. Climb to the next rung instead and stay silent.
    const publish = (r: BoardAnalysis, costMs: number, thread: "worker" | "main") => {
      rung += 1;
      if (r.depth > 0) {
        setResult({
          board,
          cpWhite: r.scoreCp * (board.turn === "w" ? 1 : -1),
          depth: r.depth,
          best: r.move,
          costMs,
          thread,
          settled: rung >= ladder.length,
        });
      }
      if (rung < ladder.length) schedule();
    };

    const workerPass = async () => {
      const step = ladder[rung];
      try {
        const r = await requestEval(board, step.budgetMs, step.maxDepth);
        if (cancelled) return;
        publish({ move: r.move, scoreCp: r.scoreCp, depth: r.depth }, r.costMs, "worker");
      } catch {
        // No thread (or it stopped answering). Finish this ladder on the main
        // thread rather than leaving the bar blank.
        if (cancelled) return;
        onWorker = false;
        schedule();
      }
    };

    const mainPass = async () => {
      const { analyzeBoard } = await loadEngine();
      if (cancelled) return;
      const step = ladder[rung];
      // The budget is a hard deadline now, so this clamp is a real bound on
      // how long the main thread is held, not half of one.
      const budgetMs = Math.min(step.budgetMs, MAIN_THREAD_RUNG_CAP_MS);
      const t0 = performance.now();
      let r: BoardAnalysis;
      try {
        r = analyzeBoard(board, budgetMs, step.maxDepth);
      } catch {
        return;
      }
      const costMs = performance.now() - t0;
      if (cancelled) return;
      publish(r, costMs, "main");
    };

    const schedule = () => {
      // A background tab must not burn CPU on a bar nobody is looking at. This
      // matters MORE with a worker than it did without one: idle callbacks and
      // timers are throttled in a hidden tab, a worker's search loop is not.
      if (typeof document !== "undefined" && document.hidden) {
        const onVisible = () => {
          document.removeEventListener("visibilitychange", onVisible);
          if (!cancelled) schedule();
        };
        document.addEventListener("visibilitychange", onVisible);
        return;
      }
      if (onWorker) {
        // A short beat before the first rung, so arrowing through a move list
        // does not queue one search per keystroke behind the one that matters.
        // Later rungs post straight away: the previous rung has just returned,
        // so the thread is already free and the position is still current.
        if (rung === 0) timerId = window.setTimeout(() => void workerPass(), 16);
        else void workerPass();
        return;
      }
      if (typeof w.requestIdleCallback === "function") {
        idleId = w.requestIdleCallback(() => void mainPass(), { timeout: 400 });
        return;
      }
      timerId = window.setTimeout(() => void mainPass(), 32);
    };

    schedule();
    return () => {
      cancelled = true;
      cancelPending();
    };
  }, [board, enabled, ladder]);

  if (!enabled || !board) return null;
  if (decided != null) {
    return { board, cpWhite: decided, depth: 0, best: null, costMs: 0, thread: "main", settled: true };
  }
  if (!result || result.board !== board) return null;
  return result;
}

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

/** True when the score is a king capture rather than a positional judgement. */
export function isDecisive(cpWhite: number): boolean {
  return cpWhite >= 90000 || cpWhite <= -90000;
}

export function evalPercent(cpWhite: number): number {
  // Sigmoid squash: 0cp = 50%, +400cp is about 73%, a fallen king pins the edge.
  if (cpWhite >= 90000) return 100;
  if (cpWhite <= -90000) return 0;
  return 50 + 50 * (2 / (1 + Math.exp(-cpWhite / 400)) - 1);
}

export function evalLabel(cpWhite: number): string {
  // Not "#". There is no checkmate in this game: you win by capturing the king,
  // so the terminal score means the king falls, and the notation says so.
  if (cpWhite >= 90000) return "+K";
  if (cpWhite <= -90000) return "-K";
  const pawns = cpWhite / 100;
  return (pawns > 0 ? "+" : "") + pawns.toFixed(1);
}

export type EvalBand = {
  /** Fixed bar fill for this band, so the bar cannot imply a precision the
   *  reading does not have. */
  percent: number;
  /** Sentence-case phrase for the readout. */
  text: string;
};

const BAND_EDGES = [600, 200, 70, -70, -200, -600];
const BANDS: EvalBand[] = [
  { percent: 94, text: "White is winning" },
  { percent: 78, text: "White is clearly better" },
  { percent: 62, text: "White is a little better" },
  { percent: 50, text: "Level" },
  { percent: 38, text: "Black is a little better" },
  { percent: 22, text: "Black is clearly better" },
  { percent: 6, text: "Black is winning" },
];

/** The coarse reading: seven bands plus the two decided ones. */
export function evalBand(cpWhite: number): EvalBand {
  if (cpWhite >= 90000) return { percent: 100, text: "White takes the king" };
  if (cpWhite <= -90000) return { percent: 0, text: "Black takes the king" };
  for (let i = 0; i < BAND_EDGES.length; i++) {
    if (cpWhite >= BAND_EDGES[i]) return BANDS[i];
  }
  return BANDS[BANDS.length - 1];
}

/**
 * The sentence that stops the bar from lying. `rules` are short phrases naming
 * what is live on this board that a plain-chess search cannot model; an empty
 * list means the position genuinely is plain chess.
 */
export function describeEvalScope(rules: string[]): string {
  if (rules.length === 0) return "";
  const joined =
    rules.length === 1
      ? rules[0]
      : rules.slice(0, -1).join(", ") + " and " + rules[rules.length - 1];
  return `Plain-chess estimate. The engine cannot see ${joined}, so read it as a band, not a number.`;
}

/** Screen-reader / tooltip sentence for a bar in either mode. */
function evalSpeech(result: BoardEval | null, rules: string[]): string {
  if (!result) return "Position not scored yet.";
  const band = evalBand(result.cpWhite);
  if (rules.length === 0) {
    return `Plain chess: ${band.text}, ${evalLabel(result.cpWhite)} at depth ${result.depth}.`;
  }
  return `${band.text}, as plain chess. ${describeEvalScope(rules)}`;
}

// Piece colours, not theme colours: the bar is a picture of white's share
// against black's, so it must read the same way in every theme.
const TRACK = "#1a1917";
const FILL = "#f2efe6";

// ---------------------------------------------------------------------------
// Vertical bar (the analysis board's classic strip, beside the board)
// ---------------------------------------------------------------------------

export function EvalBar({
  result,
  rules = [],
  orientation = "w",
  className = "",
}: {
  result: BoardEval | null;
  rules?: string[];
  /** Which colour sits at the BOTTOM of the board, so the bar flips with it. */
  orientation?: Color;
  className?: string;
}) {
  const exact = rules.length === 0;
  const cp = result?.cpWhite ?? 0;
  const pct = result ? (exact ? evalPercent(cp) : evalBand(cp).percent) : 50;
  // White's share grows from whichever end white's pieces are on.
  const whiteAtBottom = orientation === "w";
  const fillSide = whiteAtBottom ? "bottom-0" : "top-0";
  const labelSide = whiteAtBottom
    ? cp >= 0
      ? "bottom-0"
      : "top-0"
    : cp >= 0
      ? "top-0"
      : "bottom-0";

  return (
    <div
      role="img"
      aria-label={evalSpeech(result, rules)}
      title={evalSpeech(result, rules)}
      data-eval-cost={result ? Math.round(result.costMs) : undefined}
      data-eval-depth={result ? result.depth : undefined}
      data-eval-thread={result ? result.thread : undefined}
      data-eval-mode={exact ? "exact" : "estimate"}
      className={
        "relative w-6 shrink-0 overflow-hidden border border-[color:var(--edge-strong)] " + className
      }
      style={{ background: TRACK }}
    >
      <div
        className={
          "absolute inset-x-0 " +
          fillSide +
          // An exact reading slides; a banded one steps, and the step is the
          // point. Snapping between seven positions is the visual promise that
          // nothing finer than a band is being claimed.
          (exact ? " transition-[height] duration-300" : " transition-[height] duration-150")
        }
        style={{ height: `${pct}%`, background: FILL }}
      />
      {result && (
        <span
          className={
            "absolute inset-x-0 text-center font-mono text-[12px] leading-4 " +
            labelSide +
            (cp >= 0 ? " text-black" : " text-parchment-100")
          }
        >
          {exact ? evalLabel(cp).replace(/^[+-]/, "") : "≈"}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal strip (the game surfaces: replay, spectate, post-game review)
//
// Horizontal rather than vertical on purpose. The framing sentence is the load
// bearing part of this feature, and a 24px-wide column has nowhere to put it;
// laid out as a row, the bar and the sentence that qualifies it are one object
// and cannot be separated by a layout change.
// ---------------------------------------------------------------------------

export function EvalStrip({
  result,
  rules = [],
  className = "",
}: {
  result: BoardEval | null;
  rules?: string[];
  className?: string;
}) {
  const exact = rules.length === 0;
  const cp = result?.cpWhite ?? 0;
  const pct = result ? (exact ? evalPercent(cp) : evalBand(cp).percent) : 50;
  const scope = describeEvalScope(rules);

  return (
    <div
      className={"mt-2 " + className}
      data-eval-cost={result ? Math.round(result.costMs) : undefined}
      data-eval-depth={result ? result.depth : undefined}
      data-eval-thread={result ? result.thread : undefined}
      data-eval-mode={exact ? "exact" : "estimate"}
    >
      <div
        role="img"
        aria-label={evalSpeech(result, rules)}
        title={evalSpeech(result, rules)}
        className="relative h-2.5 w-full overflow-hidden border border-[color:var(--edge-strong)]"
        style={{ background: TRACK }}
      >
        <div
          className={
            "absolute inset-y-0 left-0 " +
            (exact ? "transition-[width] duration-300" : "transition-[width] duration-150")
          }
          style={{ width: `${pct}%`, background: FILL }}
        />
      </div>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] leading-snug">
        <span className="font-mono text-parchment-100">
          {!result ? "…" : exact ? evalLabel(cp) : "≈"}
        </span>
        <span className="text-parchment-200">
          {result ? evalBand(cp).text : "Reading the position"}
        </span>
        {result && result.depth > 0 && (
          <span className="text-[12px] text-parchment-500">depth {result.depth}</span>
        )}
      </p>
      {scope ? (
        <p className="mt-1 text-[13px] leading-snug text-parchment-400">{scope}</p>
      ) : (
        <p className="mt-1 text-[13px] leading-snug text-parchment-500">
          No rules in play, so the engine is scoring the same game you are looking at.
        </p>
      )}
    </div>
  );
}

/**
 * EvalStrip with the search wired in. Preferred over calling useBoardEval at a
 * page's top level: the hook then lives and dies with the strip, so a surface
 * that only shows the bar sometimes (a match that shows it after the result,
 * say) cannot end up with a conditional hook, and a hidden strip runs nothing.
 */
export function BoardEvalStrip({
  board,
  rules = [],
  enabled = true,
  ladder = EVAL_LADDER_GAME,
  className = "",
}: {
  board: BoardState | null | undefined;
  rules?: string[];
  enabled?: boolean;
  ladder?: EvalRung[];
  className?: string;
}) {
  const result = useBoardEval(board, enabled, ladder);
  return <EvalStrip result={result} rules={rules} className={className} />;
}

// ---------------------------------------------------------------------------
// Naming the rules a board is under
// ---------------------------------------------------------------------------

/** Names that are not handicaps: the buff-mode placeholder, the post-removal
 *  marker, and the id-lookup miss. Listing these as blind spots would be noise. */
const NOT_A_RULE = new Set(["", "no nerf", "unknown", "unshackled", "none"]);

/** Phrase for a nerf that really is a handicap, or null when it is not one. */
export function nerfRulePhrase(
  side: "White" | "Black",
  name: string | null | undefined,
): string | null {
  const n = (name ?? "").trim();
  if (NOT_A_RULE.has(n.toLowerCase())) return null;
  return `${side}'s rule "${n}"`;
}

/**
 * The blind-spot list for one match, in the order a reader cares about.
 *
 * `hidden` matters more than it looks. In nerf mode the handicaps are secret
 * until the game ends or someone reveals, and a bar that stayed silent about
 * them until the reveal would be at its most confident exactly when it knows
 * least. An unrevealed rule is still a rule, and it is still listed.
 */
export function matchRulePhrases(opts: {
  /** Draft mode of the match, when known. */
  mode?: "nerf" | "buff" | null;
  whiteNerf?: string | null;
  blackNerf?: string | null;
  /** Nerf mode, rules not revealed to this viewer yet. */
  hidden?: boolean;
  /** The move list contains at least one inventory drop, so the position is
   *  one plain chess could not have reached. */
  hasDrops?: boolean;
}): string[] {
  const out: string[] = [];
  const w = nerfRulePhrase("White", opts.whiteNerf);
  const b = nerfRulePhrase("Black", opts.blackNerf);
  if (w) out.push(w);
  if (b) out.push(b);
  if (opts.hidden && !w && !b) out.push("the handicaps both players are under, still unrevealed");
  if (opts.mode === "buff") out.push("the cards and pocket drops of a buff-mode game");
  if (opts.hasDrops) out.push("the pieces dropped into this game from a pocket");
  return out;
}
