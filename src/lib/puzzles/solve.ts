// The one place that decides whether a puzzle's claim is true.
//
// Both the generator (scripts/gen-puzzles.ts) and the route import this, which
// is deliberate: a puzzle is only worth shipping if the code that proved it is
// the code that will judge the player's move. Two implementations of "does this
// force a king capture" would eventually disagree, and the disagreement would
// surface as a puzzle that refuses its own answer.
//
// WHY THE SEARCH LOOKS LIKE THIS
//
// There is no checkmate in this game: the first king capture ends it (see
// checkLossConditions in src/engine/game.ts). So "mate in N" becomes "the hero
// can capture the king within N of their own moves against EVERY defence", and
// that is an AND/OR tree, not a chess-engine evaluation. It is searched
// exhaustively rather than scored, because a puzzle may not be probably right.
//
// The tree is walked over real `NerfGame` states through the real `legalMoves`
// and `playMove`, so every nerf filter, every buff hook, every board effect and
// every loss condition is in force at every node. Nothing about the handicap is
// re-modelled here, which is the only way the answer can be trusted.
//
// Turn order is READ, never assumed. `resolveNoMoves` can hand the turn back to
// the same player when board effects paralyse the other side, and buff cards
// grant extra moves, so a node asks `game.board.turn` instead of alternating.

import { moveToSAN, moveToUCI } from "../../engine/board";
import {
  deserializeGame,
  legalMoves,
  playMove,
  serializeGame,
  type NerfGame,
} from "../../engine/game";
import type { Color, Move } from "../../engine/types";

/** The `GameResult.reason` the engine writes when a king comes off the board
 *  (`checkLossConditions` in src/engine/game.ts). Every puzzle claim is about
 *  THIS ending and no other. */
export const KING_CAPTURE = "king captured";

/**
 * A detached copy of a live game.
 *
 * Round-tripping through the engine's own snapshot format rather than a
 * hand-rolled deep clone means the search can only ever explore states that a
 * shipped puzzle can also be rebuilt from. If a piece of state does not survive
 * serialization, the search never sees it either, so the generator cannot prove
 * a line that the route would then be unable to reproduce.
 */
export function cloneGame(game: NerfGame): NerfGame {
  const copy = deserializeGame(serializeGame(game));
  if (!copy) throw new Error("puzzle search: game did not survive a snapshot round trip");
  return copy;
}

/** Play `move` on a fresh copy, leaving `game` untouched. */
export function afterMove(game: NerfGame, move: Move): NerfGame {
  const next = cloneGame(game);
  const legal = legalMoves(next).find((m) => moveToUCI(m) === moveToUCI(move));
  if (!legal) throw new Error(`puzzle search: ${moveToUCI(move)} is not legal here`);
  playMove(next, legal);
  return next;
}

/** Search budget guard: a node count that stops a pathological position from
 *  hanging the generator or the browser. Exceeding it is reported as "not
 *  proven", never as a win, so the cap can only lose puzzles, never invent one. */
export interface SearchLimit {
  nodes: number;
}

const DEFAULT_NODE_CAP = 400_000;

class NodeCapExceeded extends Error {}

/**
 * Can `hero`, to move, force a king capture within `budget` of their own moves?
 *
 * OR at hero nodes (one winning move is enough), AND at foe nodes (every reply
 * must lose). A node whose game is already decided answers from the result.
 */
function heroForcesWin(
  game: NerfGame,
  hero: Color,
  budget: number,
  limit: { left: number },
): boolean {
  if (limit.left-- <= 0) throw new NodeCapExceeded();
  // A win only counts if it is the win the puzzle promises. Handicaps carry
  // their own loss conditions, so a branch can end with the foe losing to their
  // own rule rather than to a capture; counting that would make "capture the
  // king in two" a claim about something else. Requiring the capture makes the
  // proven statement strictly narrower than the engine's idea of winning.
  if (game.result) return game.result.winner === hero && game.result.reason === KING_CAPTURE;
  const moves = legalMoves(game);
  // No moves and no result should be impossible (playMove resolves it), but a
  // dead end is treated as "not a win" rather than trusted as one.
  if (moves.length === 0) return false;

  if (game.board.turn === hero) {
    if (budget <= 0) return false;
    // Try the moves most likely to end it first, so a proof is found before the
    // node cap is anywhere near. A king capture is an instant answer.
    for (const m of orderHeroMoves(moves)) {
      const next = cloneGame(game);
      playMove(next, m);
      if (heroForcesWin(next, hero, budget - 1, limit)) return true;
    }
    return false;
  }

  for (const m of moves) {
    const next = cloneGame(game);
    playMove(next, m);
    if (!heroForcesWin(next, hero, budget, limit)) return false;
  }
  return true;
}

/** King captures first, then other captures: a forced line is usually found in
 *  the first branch, and finding it early is what keeps the search affordable. */
function orderHeroMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => rankMove(b) - rankMove(a));
}

function rankMove(m: Move): number {
  if (m.captured === "k") return 100;
  if (m.captured) return 10;
  return 0;
}

/**
 * Every move at this node that forces a king capture within `budget` of the
 * mover's own moves, INCLUDING the move itself.
 *
 * This is the uniqueness test. A puzzle is only shipped when this returns
 * exactly one move at every position the solver will be asked to move in, which
 * is a much stronger statement than "the intended move wins": it says every
 * other legal move has been played out and shown to fail.
 *
 * Returns null when the node cap was hit, which means "not proven" — the caller
 * must discard the candidate rather than treat it as a result.
 */
export function winningMoves(
  game: NerfGame,
  budget: number,
  limit: SearchLimit = { nodes: DEFAULT_NODE_CAP },
): Move[] | null {
  const hero = game.board.turn;
  const left = { left: limit.nodes };
  const out: Move[] = [];
  try {
    for (const m of legalMoves(game)) {
      const next = cloneGame(game);
      playMove(next, m);
      if (heroForcesWin(next, hero, budget - 1, left)) out.push(m);
    }
  } catch (err) {
    if (err instanceof NodeCapExceeded) return null;
    throw err;
  }
  return out;
}

/** The smallest N for which the side to move forces a king capture, or null. */
export function shortestWin(
  game: NerfGame,
  maxBudget: number,
  limit?: SearchLimit,
): { moves: number; winners: Move[] } | null {
  for (let n = 1; n <= maxBudget; n++) {
    const winners = winningMoves(game, n, limit);
    if (winners === null) return null;
    if (winners.length > 0) return { moves: n, winners };
  }
  return null;
}

/** One step of a proven line: the unique hero move, then the defence played
 *  back. `foe` is null when the hero move ended the game. */
export interface LineStep {
  hero: Move;
  heroSan: string;
  foe: Move | null;
  foeSan: string | null;
  /** The position after both plies, for the next step. */
  next: NerfGame;
}

/**
 * Walk the proven line, re-checking uniqueness at every hero node.
 *
 * Uniqueness is verified HERE, on the states actually walked, not inferred from
 * the root. A defence is chosen for the foe, and the hero's move in the reply
 * position is then required to be unique again. Any node with zero or two
 * winning moves aborts the whole candidate.
 */
export function buildLine(
  game: NerfGame,
  budget: number,
  limit?: SearchLimit,
): LineStep[] | null {
  const hero = game.board.turn;
  const steps: LineStep[] = [];
  let cur = game;
  let left = budget;

  while (left > 0) {
    if (cur.result) break;
    if (cur.board.turn !== hero) return null; // caller only walks hero-to-move nodes
    const winners = winningMoves(cur, left, limit);
    if (winners === null) return null;
    if (winners.length !== 1) return null;
    const heroMove = winners[0];
    const heroSan = moveToSAN(heroMove, cur.board);
    const afterHero = cloneGame(cur);
    playMove(afterHero, heroMove);

    if (afterHero.result) {
      steps.push({ hero: heroMove, heroSan, foe: null, foeSan: null, next: afterHero });
      return afterHero.result.winner === hero && afterHero.result.reason === KING_CAPTURE
        ? steps
        : null;
    }

    // The game continues: the foe answers. Every reply loses (that is what the
    // search proved), so the one shown is chosen for resistance, not for luck.
    const replies = legalMoves(afterHero);
    if (replies.length === 0) return null;
    if (afterHero.board.turn === hero) {
      // Board effects handed the turn straight back. That is still a hero ply.
      steps.push({ hero: heroMove, heroSan, foe: null, foeSan: null, next: afterHero });
      cur = afterHero;
      left -= 1;
      continue;
    }
    const foeMove = pickDefence(replies);
    const foeSan = moveToSAN(foeMove, afterHero.board);
    const afterFoe = cloneGame(afterHero);
    playMove(afterFoe, foeMove);
    steps.push({ hero: heroMove, heroSan, foe: foeMove, foeSan, next: afterFoe });
    cur = afterFoe;
    left -= 1;
  }

  const end = steps[steps.length - 1]?.next.result;
  return end?.winner === hero && end.reason === KING_CAPTURE ? steps : null;
}

/** The defence shown to the player. Every reply loses; this picks the one that
 *  looks like a try (grab the biggest thing, else move the king, else the first
 *  in a stable order) so the line does not read as the foe cooperating. */
function pickDefence(moves: Move[]): Move {
  const value: Record<string, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };
  return [...moves].sort((a, b) => {
    const ca = a.captured ? (value[a.captured] ?? 0) : 0;
    const cb = b.captured ? (value[b.captured] ?? 0) : 0;
    if (ca !== cb) return cb - ca;
    const ka = a.piece === "k" ? 1 : 0;
    const kb = b.piece === "k" ? 1 : 0;
    if (ka !== kb) return kb - ka;
    return moveToUCI(a).localeCompare(moveToUCI(b));
  })[0];
}

/** Find a legal move by its UCI string, or null. The route's move validator:
 *  a player's click becomes a UCI and is matched against the live legal set, so
 *  a move the handicap forbids is simply absent. */
export function legalByUci(game: NerfGame, uci: string): Move | null {
  return legalMoves(game).find((m) => moveToUCI(m) === uci) ?? null;
}
