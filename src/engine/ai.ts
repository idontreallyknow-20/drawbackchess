import { findKing, generateMoves, makeMove } from "./board";
import {
  NerfGame,
  SearchBuffs,
  applySearchAugments,
  buildSearchBuffs,
  legalMoves,
  markAugmentSpent,
} from "./game";
import { triggersOwnNerfLoss } from "./moveSafety";
import { BoardState, Color, Move, PieceType } from "./types";

// A move is self-losing if it trips our own nerf's checkLoss on the resulting board.
const isSelfLosing = triggersOwnNerfLoss;

const VAL: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

// Piece-square tables — white's perspective, indexed by sq (rank 0 = white's back rank).
// Black uses `sq ^ 56` to mirror vertically. Values adapted from Chess Programming
// Wiki's simplified evaluation function.
const PST: Record<PieceType, number[]> = {
  p: [
       0,   0,   0,   0,   0,   0,   0,   0,
       5,  10,  10, -20, -20,  10,  10,   5,
       5,  -5, -10,   0,   0, -10,  -5,   5,
       0,   0,   0,  20,  20,   0,   0,   0,
       5,   5,  10,  25,  25,  10,   5,   5,
      10,  10,  20,  30,  30,  20,  10,  10,
      50,  50,  50,  50,  50,  50,  50,  50,
       0,   0,   0,   0,   0,   0,   0,   0,
  ],
  n: [
     -50, -40, -30, -30, -30, -30, -40, -50,
     -40, -20,   0,   5,   5,   0, -20, -40,
     -30,   5,  10,  15,  15,  10,   5, -30,
     -30,   0,  15,  20,  20,  15,   0, -30,
     -30,   5,  15,  20,  20,  15,   5, -30,
     -30,   0,  10,  15,  15,  10,   0, -30,
     -40, -20,   0,   0,   0,   0, -20, -40,
     -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
     -20, -10, -10, -10, -10, -10, -10, -20,
     -10,   5,   0,   0,   0,   0,   5, -10,
     -10,  10,  10,  10,  10,  10,  10, -10,
     -10,   0,  10,  10,  10,  10,   0, -10,
     -10,   5,   5,  10,  10,   5,   5, -10,
     -10,   0,   5,  10,  10,   5,   0, -10,
     -10,   0,   0,   0,   0,   0,   0, -10,
     -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
       0,   0,   0,   5,   5,   0,   0,   0,
      -5,   0,   0,   0,   0,   0,   0,  -5,
      -5,   0,   0,   0,   0,   0,   0,  -5,
      -5,   0,   0,   0,   0,   0,   0,  -5,
      -5,   0,   0,   0,   0,   0,   0,  -5,
      -5,   0,   0,   0,   0,   0,   0,  -5,
       5,  10,  10,  10,  10,  10,  10,   5,
       0,   0,   0,   0,   0,   0,   0,   0,
  ],
  q: [
     -20, -10, -10,  -5,  -5, -10, -10, -20,
     -10,   0,   5,   0,   0,   0,   0, -10,
     -10,   5,   5,   5,   5,   5,   0, -10,
       0,   0,   5,   5,   5,   5,   0,  -5,
      -5,   0,   5,   5,   5,   5,   0,  -5,
     -10,   0,   5,   5,   5,   5,   0, -10,
     -10,   0,   0,   0,   0,   0,   0, -10,
     -20, -10, -10,  -5,  -5, -10, -10, -20,
  ],
  k: [
      20,  30,  10,   0,   0,  10,  30,  20,
      20,  20,   0,   0,   0,   0,  20,  20,
     -10, -20, -20, -20, -20, -20, -20, -10,
     -20, -30, -30, -40, -40, -30, -30, -20,
     -30, -40, -40, -50, -50, -40, -40, -30,
     -30, -40, -40, -50, -50, -40, -40, -30,
     -30, -40, -40, -50, -50, -40, -40, -30,
     -30, -40, -40, -50, -50, -40, -40, -30,
  ],
};

// Extended terms (hard only): bishop pair and doubled-pawn structure. Cheap
// enough to compute inside the same board scan, and enough to give the hard
// bot visibly better piece-trade and pawn-structure judgement.
const BISHOP_PAIR_BONUS = 40;
const DOUBLED_PAWN_PENALTY = 18;

function evaluate(board: BoardState, me: Color, extended = false): number {
  let score = 0;
  let wBishops = 0;
  let bBishops = 0;
  // Pawn counts per file, white in [0..7], black in [8..15].
  const pawnFiles = extended ? new Uint8Array(16) : null;
  for (let sq = 0; sq < 64; sq++) {
    const p = board.pieces[sq];
    if (!p) continue;
    const idx = p.color === "w" ? sq : sq ^ 56;
    const v = VAL[p.type] + PST[p.type][idx];
    score += p.color === me ? v : -v;
    if (extended) {
      if (p.type === "b") {
        if (p.color === "w") wBishops++;
        else bBishops++;
      } else if (p.type === "p") {
        pawnFiles![(p.color === "w" ? 0 : 8) + (sq & 7)]++;
      }
    }
  }
  if (extended) {
    let bonus = 0;
    if (wBishops >= 2) bonus += me === "w" ? BISHOP_PAIR_BONUS : -BISHOP_PAIR_BONUS;
    if (bBishops >= 2) bonus += me === "b" ? BISHOP_PAIR_BONUS : -BISHOP_PAIR_BONUS;
    for (let f = 0; f < 8; f++) {
      const wExtra = Math.max(0, pawnFiles![f] - 1);
      const bExtra = Math.max(0, pawnFiles![8 + f] - 1);
      bonus -= (me === "w" ? wExtra - bExtra : bExtra - wExtra) * DOUBLED_PAWN_PENALTY;
    }
    score += bonus;
  }
  return score;
}

function sameMove(a: Move, b: Move): boolean {
  return a.from === b.from && a.to === b.to && (a.promotion ?? null) === (b.promotion ?? null);
}

// Per-search ordering memory. Killer moves are quiet moves that caused a beta
// cutoff at the same ply; the history table counts cutoffs per from/to square
// pair. Both make alpha-beta prune far more of the tree within the same time
// budget, which is where most of the engine's strength comes from.
type SearchState = {
  killers: (Move | null)[][];
  history: Int32Array;
  // Whether leaf evaluation uses the extended terms (hard only).
  extended: boolean;
  // Node-count abort: the wall-clock budget check below is USELESS on
  // Cloudflare Workers, where Date.now() is frozen during synchronous compute
  // — a search there never observes time passing and runs to full depth,
  // which is exactly the Durable Object exceededCpu blowup of 2026-07-08/-10.
  // The node cap is the platform-independent backstop: sized from the time
  // budget (NODES_PER_MS) so on ordinary runtimes the clock check still fires
  // first and playing strength is unchanged.
  nodes: number;
  nodeCap: number;
  // Move-granting buffs held at the root, prepared per ply so interior nodes
  // see the same augmented move set legalMoves produces (backlog A13). Null
  // whenever nobody holds such a card, which is the common case and keeps the
  // pre-existing search path byte-for-byte unchanged.
  buffs: SearchBuffs | null;
};

// Rough search throughput used to convert a time budget into a node cap.
// Measured 2026-07-10 on hard-level midgame searches: ~450 nodes/ms median
// (317-727 across 30 samples), so 1000 deliberately overshoots ~2x — on any
// runtime with a working clock the clock net in negamax fires first and
// playing strength is unchanged; the node cap only bites where the clock is
// frozen. Precision does not matter, only the order of magnitude.
//
// The cap is deliberately UNCHANGED by the 2026-09 hard-deadline fix: for any
// given budget it allows exactly the node count it always did, so the frozen-
// clock (Durable Object) path behaves identically and nothing about the
// backstop is loosened. What changed is its margin over the clock. Before, the
// clock aborted at 2x budget and the cap at 2000 nodes per ms-of-budget, so the
// cap bit first only above ~1000 nodes/ms; now the clock aborts at 1x budget,
// so it bites first below ~2000 nodes/ms — an even wider margin, in the safe
// direction. On a frozen clock the cap still contains a runaway search to
// 2000 nodes per ms-of-budget, i.e. ~4.4x the budget's worth of real CPU at the
// measured 450 nodes/ms. Tightening THAT is a separate, strength-affecting
// change to the house tiers' local fallback and does not belong in a fix whose
// whole point is that the numbers should stop moving on their own.
const NODES_PER_MS = 1000;

function newSearchState(extended: boolean, budgetMs = 0, buffs: SearchBuffs | null = null): SearchState {
  return {
    killers: [],
    history: new Int32Array(64 * 64),
    extended,
    nodes: 0,
    nodeCap: budgetMs > 0 ? budgetMs * 2 * NODES_PER_MS : 0,
    buffs,
  };
}

// Quiescence depth, and therefore how far past `maxDepth` a granted move can
// still turn up. The per-ply augment table has to cover both.
const QUIESCE_DEPTH = 6;

// Interior move generation. Identical to `generateMoves` unless the side to
// move holds a move-granting card, in which case it also runs that card's
// `augmentMoves` hook, which is the whole point of A13.
function genMoves(board: BoardState, state: SearchState, ply: number, spentMask: number): Move[] {
  const moves = generateMoves(board);
  if (state.buffs) applySearchAugments(state.buffs, board, ply, spentMask, moves);
  return moves;
}

// A granted move consumes its card's charge for the rest of THIS line only.
function childMask(state: SearchState, ply: number, m: Move, spentMask: number): number {
  return state.buffs ? markAugmentSpent(state.buffs, ply, m, spentMask) : spentMask;
}

// MVV-LVA for captures (most valuable victim taken by least valuable attacker
// first), then killers, then quiet moves by history score. An optional
// priority move (the PV move from the previous iteration) sorts before all.
function orderMoves(moves: Move[], priority?: Move | null, state?: SearchState, ply?: number): Move[] {
  const killers = state && ply != null ? state.killers[ply] : undefined;
  const scored = moves.map((m) => {
    let s = 0;
    if (m.captured) s = 1_000_000 + VAL[m.captured] * 10 - VAL[m.piece];
    else if (killers?.[0] && sameMove(m, killers[0])) s = 900_000;
    else if (killers?.[1] && sameMove(m, killers[1])) s = 800_000;
    else if (state) s = state.history[m.from * 64 + m.to];
    if (m.promotion) s += VAL[m.promotion];
    if (priority && sameMove(m, priority)) s += 100_000_000;
    return { m, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.m);
}

function recordCutoff(state: SearchState, ply: number, m: Move, depth: number) {
  if (m.captured) return;
  state.history[m.from * 64 + m.to] += depth * depth;
  const killers = (state.killers[ply] ??= [null, null]);
  if (!killers[0] || !sameMove(m, killers[0])) {
    killers[1] = killers[0];
    killers[0] = m;
  }
}

export type AILevel = "easy" | "medium" | "hard";

// Per-difficulty playing profile. The three levels are deliberately far
// apart so the difference is obvious within a few games:
// - easy:   one-ply greedy with heavy evaluation noise plus outright random
//           moves — grabs free material sometimes, but regularly overlooks
//           captures and walks into simple tactics. Beginner level.
// - medium: shallow but sound alpha-beta (3 plies + quiescence) — plays
//           solid moves, sees basic tactics, avoids hanging pieces outright,
//           misses deeper combinations. Casual-player level.
// - hard:   deep iterative-deepening search with a richer evaluation and no
//           noise — finds multi-move tactics consistently.
type LevelProfile = {
  maxDepth: number;
  // Search time budget; iterative deepening stops at the cap depth or when
  // the budget runs out, whichever comes first.
  budgetMs: number;
  // Uniform noise (centipawns) added to easy's one-ply evaluation. Not used
  // by the searching levels: root moves pruned by alpha-beta return inexact
  // bounds, so noising those scores would randomly promote refuted moves.
  rootNoise: number;
  // Chance to ignore the search entirely and play a random (non-self-losing)
  // legal move.
  blunderChance: number;
  // Extended evaluation terms (bishop pair, pawn structure).
  extendedEval: boolean;
};

// `budgetMs` here is WALL TIME the search may spend, and since 2026-09 that is
// the truth rather than half of it: negamax used to abort at `budget * 2`, so
// medium's old 700 really cost 1400ms and hard's old 2000 really cost 4000ms.
// These numbers are doubled from those old nominals for exactly that reason —
// the practice bot thinks for the same length of time it always did, the label
// on the tin now matches the tin. Do not read the doubling as a strength buff;
// reverting it would be a strength CUT.
const LEVELS: Record<AILevel, LevelProfile> = {
  easy: { maxDepth: 1, budgetMs: 0, rootNoise: 120, blunderChance: 0.22, extendedEval: false },
  medium: { maxDepth: 3, budgetMs: 1400, rootNoise: 0, blunderChance: 0, extendedEval: false },
  hard: { maxDepth: 12, budgetMs: 4000, rootNoise: 0, blunderChance: 0, extendedEval: true },
};

// The search shape a level runs at by default (depth + whether leaf eval uses
// the extended terms). Exposed so the house-bot layer can resolve a weakening
// profile's omitted maxDepth/extendedEval against the true level defaults
// without duplicating (and drifting from) the LEVELS table.
export function defaultSearchShape(level: AILevel): { maxDepth: number; extendedEval: boolean } {
  return { maxDepth: LEVELS[level].maxDepth, extendedEval: LEVELS[level].extendedEval };
}

// Search budget for a level, capped to a slice of the bot's remaining clock
// so the bot spends time like a human player and can never think its whole
// bank away in fast time controls.
//
// That sentence is now true as written. It was not before: the returned number
// was a budget the search was allowed to double, so a bot at the 60ms floor in
// a 1+0 game spent 120ms of a clock it did not have, and every clamp here was
// half as tight as it read. `budgetMs` is a hard wall-clock deadline in the
// search (see negamax), so a tenth of the remaining clock is a tenth of the
// remaining clock.
export function aiBudgetMs(level: AILevel, remainingClockMs?: number): number {
  const base = LEVELS[level].budgetMs;
  if (remainingClockMs == null) return base;
  // `base || 300` covers easy, whose profile budget is 0 because it never
  // searches; the value only reaches a caller's bookkeeping, not a search.
  return Math.max(60, Math.min(base || 300, remainingClockMs / 10));
}

// Move-quality weakening for the house bots. Applied ONLY when a caller passes
// a `weaken` block whose sampling is actually active (topK > 1, or a non-zero
// temperature/noise); with topK:1, temperatureCp:0 and evalNoiseCp:0 the search
// takes the identical argmax path it took before this existed, so the unchanged
// house tiers are provably unaffected. See docs/bot-weakening-spec.md. The point
// is a *human-shaped* handicap (inaccuracies, the occasional 2nd/3rd-best move)
// rather than a time-starved-but-flawless engine, which is why the lever is
// move choice, not search time.
export type WeakenParams = {
  // Search shape (override LEVELS defaults for this move).
  maxDepth: number;
  extendedEval: boolean;
  // Sample from the top `topK` root moves (1 = always the best move).
  topK: number;
  // Softmax temperature over root scores, centipawns (0 = argmax among the
  // survivors, no random spread).
  temperatureCp: number;
  // Only root moves within this centipawn margin of the best are candidates.
  sampleWindowCp: number;
  // Uniform +-noise (centipawns) added to each root score before sampling, so
  // positional judgement gets fuzzed without ever promoting a move the search
  // sees as outright losing (that floor is enforced separately).
  evalNoiseCp: number;
};

export type WeakenOptions = {
  params: WeakenParams;
  // Caller-supplied RNG (int in [0, max)), same one the house code threads
  // everywhere so weakened move choice stays testable/deterministic under seed.
  random: (max: number) => number;
};

// A root move a full-window search scored. Distinct from the argmax root loop,
// which narrows alpha across moves and so returns inexact bounds for all but
// the best — those bounds are unsafe to sample from (they can rank a refuted
// move above a sound one), which is why sampling needs this separate pass.
type RankedRootMove = { move: Move; scoreCp: number };

// `overrideBudgetMs` caps the search time regardless of level, used by the
// game server's house players so a bot-vs-bot move never blocks the (single
// threaded) Durable Object long enough to stall live sockets or the lobby,
// and by the client so the bot's thinking never exceeds its remaining clock.
// It is a HARD wall-clock deadline: the search returns within it (give or take
// the cost of one node), not within twice it. On a runtime whose clock is
// frozen mid-compute — Cloudflare Workers, i.e. the DO's local fallback — the
// node cap is what bounds the search instead; see NODES_PER_MS.
// `weaken` (house bots only) degrades move CHOICE for a realistic handicap;
// see WeakenParams.
/**
 * Diagnostics an interested caller can ask for. Optional and write-only, so
 * nothing about the search changes when it is absent.
 *
 * `depth` exists because "the bot played worse while holding this card" and
 * "the card is bad" look identical from a win rate, and the difference is
 * whether the search got shallower. A card that widens the legal move set
 * buys fewer plies out of a fixed time budget, and the win-rate harness runs
 * at a 60ms budget, so that is not a hypothetical.
 */
export interface SearchStats {
  /** The deepest ply the search actually completed, not the depth it aimed at. */
  depth: number;
  /** Root moves considered, which is the branching factor being paid for. */
  rootMoves: number;
  /**
   * Nodes visited across every deepening iteration. Depth alone cannot tell a
   * search that got cheaper from one that got shallower at the same budget,
   * which is the question A13's per-node augment step has to answer.
   */
  nodes?: number;
}

export function pickAIMove(
  game: NerfGame,
  level: AILevel,
  overrideBudgetMs?: number,
  weaken?: WeakenOptions,
  stats?: SearchStats,
): Move | null {
  const all = legalMoves(game);
  if (!all.length) return null;
  const safe = all.filter((m) => !isSelfLosing(game, m));
  const moves = safe.length ? safe : all;
  if (stats) {
    stats.rootMoves = moves.length;
    stats.depth = 0;
    stats.nodes = 0;
  }

  const me = game.board.turn;
  const cfg = LEVELS[level];

  if (cfg.blunderChance > 0 && Math.random() < cfg.blunderChance) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  if (level === "easy") {
    // Greedy one-ply search: take the move with the best immediate evaluation,
    // with heavy noise. No lookahead, so it still walks into tactics. Weakening
    // never targets easy (it is already the weakest profile).
    let best: Move | null = null;
    let bestScore = -Infinity;
    for (const m of moves) {
      const score = evaluate(makeMove(game.board, m), me) + Math.random() * cfg.rootNoise;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best ?? moves[0];
  }

  const opp: Color = me === "w" ? "b" : "w";
  const budget = overrideBudgetMs ?? cfg.budgetMs;
  const maxDepth = weaken?.params.maxDepth ?? cfg.maxDepth;
  const extended = weaken?.params.extendedEval ?? cfg.extendedEval;

  // Sampling is only worth its extra cost (a full-window root pass) when it can
  // actually change the choice. Otherwise fall through to the identical argmax
  // search that predates weakening.
  const p = weaken?.params;
  const sampling = !!p && (p.topK > 1 || p.temperatureCp > 0 || p.evalNoiseCp > 0);

  // The root already sees granted moves (legalMoves ran the augments above);
  // this is what lets every node BELOW the root see them too.
  const searchBuffs = buildSearchBuffs(game, maxDepth + QUIESCE_DEPTH + 1);

  if (sampling && weaken) {
    const ranked = rankedRoot(game, moves, opp, maxDepth, budget, extended, searchBuffs);
    return sampleWeakened(ranked, weaken.params, weaken.random);
  }

  const start = Date.now();
  const state = newSearchState(extended, budget, searchBuffs);

  let bestMove: Move | null = null;

  // Iterative deepening: search depth 1, 2, 3, ... up to maxDepth. The best move
  // from each completed depth is the first one tried at the next depth, which
  // dramatically improves alpha-beta cutoffs.
  for (let d = 1; d <= maxDepth; d++) {
    let depthBest: Move | null = null;
    let depthBestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;
    let timedOut = false;

    for (const m of orderMoves(moves, bestMove, state, 0)) {
      const nb = makeMove(game.board, m);
      const score = -negamax(
        nb, d - 1, -beta, -alpha, opp, start, budget, state, 1,
        childMask(state, 0, m, 0),
      );
      if (Number.isNaN(score)) {
        timedOut = true;
        break;
      }
      if (score > depthBestScore) {
        depthBestScore = score;
        depthBest = m;
      }
      if (score > alpha) alpha = score;
    }

    if (!timedOut && depthBest) {
      bestMove = depthBest;
      if (stats) stats.depth = d;
    }

    // A timed-out depth means the budget (clock or node cap) is spent; going
    // deeper would only burn more nodes to time out again immediately.
    if (timedOut) break;
    // After depth 1 has run, respect the time budget.
    if (d >= 1 && Date.now() - start > budget) break;
  }

  if (stats) stats.nodes = state.nodes;
  return bestMove ?? moves[0];
}

// Iterative-deepening root search that scores EVERY root move with a full
// window (alpha stays -Inf across root moves) so the returned scores are
// directly comparable and safe to sample from. Interior nodes still narrow and
// prune normally as alpha rises within each subtree; only the root-level
// narrowing that produces inexact bounds is dropped. Costs roughly 2-4x the
// argmax search at equal depth — fine at the shallow depths weakened tiers use,
// and the node cap remains the frozen-clock backstop. Returns the ranked list
// (best first) from the deepest fully completed depth.
function rankedRoot(
  game: NerfGame,
  moves: Move[],
  opp: Color,
  maxDepth: number,
  budget: number,
  extended: boolean,
  searchBuffs: SearchBuffs | null = null,
): RankedRootMove[] {
  const start = Date.now();
  const state = newSearchState(extended, budget, searchBuffs);
  let ranked: RankedRootMove[] = moves.map((move) => ({ move, scoreCp: 0 }));
  let priority: Move | null = null;

  for (let d = 1; d <= maxDepth; d++) {
    const scored: RankedRootMove[] = [];
    let timedOut = false;
    for (const m of orderMoves(moves, priority, state, 0)) {
      const nb = makeMove(game.board, m);
      // Full window (-Inf, +Inf): no root-level alpha narrowing, so each move
      // gets an exact score rather than a bound.
      const score = -negamax(
        nb, d - 1, -Infinity, Infinity, opp, start, budget, state, 1,
        childMask(state, 0, m, 0),
      );
      if (Number.isNaN(score)) {
        timedOut = true;
        break;
      }
      scored.push({ move: m, scoreCp: score });
    }
    if (!timedOut && scored.length) {
      scored.sort((a, b) => b.scoreCp - a.scoreCp);
      ranked = scored;
      priority = scored[0].move; // best-so-far first at the next depth
    }
    if (timedOut) break;
    if (Date.now() - start > budget) break;
  }
  return ranked;
}

// Pick a weakened move from ranked root scores: fuzz each score by uniform
// noise, keep those within the window of the best, cap to topK, then softmax-
// sample by temperature. A candidate the search scores as outright losing
// (mate-range) is never chosen while a non-losing move exists, so a weakened
// bot plays inaccuracies and the odd second-best move but not one-move suicides
// the search already saw.
const MATE_SCORE = 50000;

function sampleWeakened(ranked: RankedRootMove[], p: WeakenParams, random: (max: number) => number): Move {
  if (!ranked.length) throw new Error("sampleWeakened: no moves");
  const rawBest = ranked[0].scoreCp; // ranked is best-first from rankedRoot
  const noised = ranked.map((r) => ({
    move: r.move,
    raw: r.scoreCp,
    s: r.scoreCp + (p.evalNoiseCp > 0 ? random(2 * p.evalNoiseCp + 1) - p.evalNoiseCp : 0),
  }));

  // Window on the (noised) score, mate-floor on the true score.
  let cands = noised.filter((c) => c.s >= rawBest - p.sampleWindowCp);
  if (rawBest > -MATE_SCORE) {
    const safe = cands.filter((c) => c.raw > -MATE_SCORE);
    if (safe.length) cands = safe;
  }
  if (!cands.length) cands = [noised[0]];

  cands.sort((a, b) => b.s - a.s);
  cands = cands.slice(0, Math.max(1, p.topK));

  if (p.temperatureCp <= 0 || cands.length === 1) return cands[0].move;

  const top = cands[0].s;
  const weights = cands.map((c) => Math.exp((c.s - top) / p.temperatureCp));
  const sum = weights.reduce((a, b) => a + b, 0);
  // random(max) is an int RNG; build a [0,1) float from a large draw.
  let roll = (random(1_000_000) / 1_000_000) * sum;
  for (let i = 0; i < cands.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return cands[i].move;
  }
  return cands[cands.length - 1].move;
}

export interface BoardAnalysis {
  /** Best move found, or null if the side to move has no moves. */
  move: Move | null;
  /** Score in centipawns from the side to move's perspective. */
  scoreCp: number;
  /** Deepest fully-searched depth. */
  depth: number;
}

// Plain-chess analysis for the analysis board: same iterative-deepening
// negamax as the hard bot, but over a bare BoardState (no nerfs) and
// returning the score alongside the move so callers can drive an eval bar.
//
// `budgetMs` is a hard wall-clock deadline (see negamax). It used to be a
// number the search doubled, which is why `analyzeBoard(board, 300)` on
// /analysis was a measured 601ms main-thread block; a caller that wants 600ms
// of search now writes 600.
export function analyzeBoard(board: BoardState, budgetMs = 300, maxDepth = 10): BoardAnalysis {
  const moves = generateMoves(board);
  const me = board.turn;
  if (!moves.length) return { move: null, scoreCp: 0, depth: 0 };

  const opp: Color = me === "w" ? "b" : "w";
  const start = Date.now();
  const state = newSearchState(true, budgetMs);
  let bestMove: Move | null = null;
  let bestScore = 0;
  let completed = 0;

  for (let d = 1; d <= maxDepth; d++) {
    let depthBest: Move | null = null;
    let depthBestScore = -Infinity;
    let alpha = -Infinity;
    let timedOut = false;
    for (const m of orderMoves(moves, bestMove, state, 0)) {
      const nb = makeMove(board, m);
      const score = -negamax(nb, d - 1, -Infinity, -alpha, opp, start, budgetMs, state, 1);
      if (Number.isNaN(score)) {
        timedOut = true;
        break;
      }
      if (score > depthBestScore) {
        depthBestScore = score;
        depthBest = m;
      }
      if (score > alpha) alpha = score;
    }
    if (!timedOut && depthBest) {
      bestMove = depthBest;
      bestScore = depthBestScore;
      completed = d;
    }
    if (timedOut) break;
    if (Date.now() - start > budgetMs) break;
  }

  return { move: bestMove ?? moves[0], scoreCp: bestScore, depth: completed };
}

// NaN survives negation unchanged, so a timed-out subtree is detectable at
// every level of the negamax recursion with a single isNaN check.
const TIMEOUT_SENTINEL = Number.NaN;

function negamax(
  board: BoardState,
  depth: number,
  alpha: number,
  beta: number,
  side: Color,
  start: number,
  budget: number,
  state: SearchState,
  ply: number,
  spentMask = 0,
): number {
  // Node cap first: on Workers the clock check below never fires (Date.now()
  // is frozen during synchronous compute), so this is the only abort there.
  // Counted unconditionally (the cap test is unchanged) so `SearchStats.nodes`
  // is meaningful even for an uncapped search.
  state.nodes++;
  if (state.nodeCap > 0 && state.nodes > state.nodeCap) return TIMEOUT_SENTINEL;
  // `budget` is a HARD deadline: the search may not spend more wall-clock time
  // than the caller asked for. It used to abort at `budget * 2`, which — since
  // the deepening loops only check the clock BETWEEN depths — let a depth that
  // started a millisecond under the budget run to twice it. Measured, that was
  // not an edge case: at every budget the median search landed near the 2x
  // abort and `analyzeBoard(board, 300)` cost 601ms.
  //
  // The 2x also silently falsified every promise built on this number, and
  // there are several: aiBudgetMs's "can never think its whole bank away"
  // clamp, the house tiers' margin under the engine service's 3000ms timeout,
  // and the DO-safe search ceiling. One tight deadline makes all of them true
  // at once.
  //
  // The argument for the old headroom was that aborting mid-depth throws the
  // whole depth away. Measured over 27 midgame positions (scripts/
  // bench-search-deadline.ts), it buys nothing: at an equal WALL CEILING the
  // hard deadline reaches exactly the same depth (asked 700/abort 1400 ->
  // depth 4.8 avg, max 6; asked 1400/abort 1400 -> depth 4.8 avg, max 6), it
  // just reaches it with a wall time the caller can predict. Callers who want
  // the deeper search now ask for the bigger number, and get charged for it
  // honestly.
  if (budget > 0 && Date.now() - start > budget) return TIMEOUT_SENTINEL;

  // Terminal king captures score from the side to move's perspective (like
  // quiesce below). Scoring them relative to the search root inverted the
  // signs whenever the engine played black, poisoning every deep search.
  const wk = findKing(board, "w");
  const bk = findKing(board, "b");
  if (wk == null) return side === "w" ? -100000 : 100000;
  if (bk == null) return side === "b" ? -100000 : 100000;
  if (depth === 0) return quiesce(board, alpha, beta, side, QUIESCE_DEPTH, state, ply, spentMask);

  const moves = orderMoves(genMoves(board, state, ply, spentMask), null, state, ply);
  const opp: Color = side === "w" ? "b" : "w";
  let best = -Infinity;
  for (const m of moves) {
    const nb = makeMove(board, m);
    const v = -negamax(
      nb, depth - 1, -beta, -alpha, opp, start, budget, state, ply + 1,
      childMask(state, ply, m, spentMask),
    );
    if (Number.isNaN(v)) return TIMEOUT_SENTINEL;
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      recordCutoff(state, ply, m, depth);
      break;
    }
  }
  if (best === -Infinity) return evaluate(board, side, state.extended);
  return best;
}

// Quiescence search: only consider captures so the leaf eval isn't called on a
// position where the side to move can immediately win/lose major material.
// Counts against the same node cap as negamax; an over-cap subtree returns the
// NaN sentinel, which propagates up the negamax recursion like any timeout.
function quiesce(
  board: BoardState,
  alpha: number,
  beta: number,
  side: Color,
  depth: number,
  state: SearchState,
  ply: number,
  spentMask: number,
): number {
  state.nodes++;
  if (state.nodeCap > 0 && state.nodes > state.nodeCap) return TIMEOUT_SENTINEL;
  const wk = findKing(board, "w");
  const bk = findKing(board, "b");
  if (wk == null) return side === "w" ? -100000 : 100000;
  if (bk == null) return side === "b" ? -100000 : 100000;

  const standPat = evaluate(board, side, state.extended);
  if (standPat >= beta) return beta;
  if (alpha < standPat) alpha = standPat;
  if (depth === 0) return alpha;

  // A buff-granted move can be a capture, so the augment step belongs here too
  // or the quiescence search still resolves the position as if the card were
  // not held.
  const captures = orderMoves(genMoves(board, state, ply, spentMask).filter((m) => m.captured));
  const opp: Color = side === "w" ? "b" : "w";
  for (const m of captures) {
    const nb = makeMove(board, m);
    const score = -quiesce(
      nb, -beta, -alpha, opp, depth - 1, state, ply + 1,
      childMask(state, ply, m, spentMask),
    );
    if (Number.isNaN(score)) return TIMEOUT_SENTINEL;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}
