// The shape of a checked-in puzzle.
//
// A puzzle is a SERIALIZED GAME plus a proven claim about it. The snapshot is
// the engine's own `GameSnapshot`, so the route rebuilds the exact game the
// generator verified — same nerf, same board, same history, same buff state —
// rather than a hand-written FEN that the rules layer would have to re-derive.
// That is the whole reason a puzzle here can be trusted: there is no second
// description of the position that could disagree with the first.
//
// Deliberately kept free of React and of `@/` path aliases so the generator
// script (run under tsx, which walks relative paths) and the browser route
// share one definition.

import type { GameSnapshot } from "../../engine/game";
import type { Color } from "../../engine/types";

/**
 * The three formats that survive the translation out of normal chess.
 *
 * `docs/lichess-parity-2026-09.md` (section 7) is explicit that classic tactics
 * do not transfer: there is no checkmate here and no stable piece value, so a
 * standard puzzle usually has zero solutions or several.
 *
 * king-hunt   Capture the king in N under a named handicap.
 * only-move   Your rule leaves exactly one legal move. Find it.
 * card-choice Two cards are offered. One of them wins on the spot.
 */
export type PuzzleFormat = "king-hunt" | "only-move" | "card-choice";

/** One half-move of the proven line. */
export interface PuzzlePly {
  /** "hero" is the solver; "foe" is the answer the puzzle plays back. */
  by: "hero" | "foe";
  uci: string;
  san: string;
}

/** One of the two cards in a card-choice puzzle. */
export interface PuzzleCard {
  id: string;
  name: string;
  description: string;
  tier: number;
  kind: string;
  /** True for the card that creates the forced king capture. Exactly one. */
  wins: boolean;
}

export interface PuzzleRule {
  id: string;
  name: string;
  description: string;
  tier: number;
}

export interface Puzzle {
  /** Stable id: format code plus a hash of the position. */
  id: string;
  format: PuzzleFormat;
  /** The game the puzzle is played from, rebuilt with `deserializeGame`. */
  snapshot: GameSnapshot;
  /** The side the solver plays. Always the side to move in the snapshot. */
  hero: Color;
  /** The solver's handicap. This is the rule the puzzle is about. */
  rule: PuzzleRule;
  /**
   * The DEFENDER's handicap, when they have one.
   *
   * Present only for rules that are fully described by their own text. A rule
   * that rolls hidden state (a random banned rank, a secret square) is never
   * carried here, because the puzzle has no way to show the solver what it
   * rolled, and a forced win resting on an unreadable constraint is a trick.
   * Absent means the defender plays with no handicap at all.
   */
  foeRule?: PuzzleRule;
  /**
   * How many of the solver's own moves the win takes. 0 for only-move, whose
   * goal is legality rather than a capture.
   */
  movesToWin: number;
  /** The proven line, alternating hero and foe plies. */
  line: PuzzlePly[];
  /** card-choice only: the two offered cards, in display order. */
  cards?: PuzzleCard[];
  /** 1 (gentle) to 5 (nasty). Derived, see `scripts/gen-puzzles.ts`. */
  difficulty: number;
  /** Short descriptive tags shown under the board. */
  tags: string[];
  /**
   * True when the handicap actually removed a move at the puzzle position, so
   * the rule is load-bearing rather than decoration.
   */
  ruleBinding: boolean;
  /**
   * True when a move the handicap forbade would ALSO have won. Without the
   * rule the puzzle would have had two answers, so the rule is what makes the
   * solution unique. The strongest quality signal the generator can compute.
   */
  ruleDecisive: boolean;
}

/** The shipped data file. */
export interface PuzzleFile {
  /** Bumped when the puzzle schema changes; the route rejects anything else. */
  version: number;
  generatedAt: string;
  puzzles: Puzzle[];
}

export const PUZZLE_FILE_VERSION = 1;

/** Where the route fetches the file from (a static asset, no backend). */
export const PUZZLE_DATA_URL = "/puzzle-data/puzzles.json";
