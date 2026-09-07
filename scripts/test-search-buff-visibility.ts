// The bot's search sees buff-granted moves at the root and nowhere else.
//
//   npx tsx scripts/test-search-buff-visibility.ts
//
// WHY THIS EXISTS
//
// `amazon_army` measured -25 win-rate points for its own holder at tier 7. It
// is passive and it only ADDS legal moves: knights borrow bishop slides,
// bishops borrow knight leaps, for three of the owner's turns. A card that
// strictly widens the option set cannot make a position worse, so a large
// negative measurement has to be coming from somewhere other than the card.
//
// THE HYPOTHESIS THAT WAS WRONG
//
// The first guess was the measuring instrument: `scripts/sim-card-winrate.ts`
// plays at a small time budget, iterative deepening against a wider tree
// completes fewer plies in the same time, and a shallower search plays worse.
// The card would then be charged for a weaker search.
//
// That is measurable, so it was measured. `pickAIMove` now reports the depth
// it actually completed (`SearchStats`), and the answer is no:
//
//   medium @60ms   depth without 3, with 3     (root moves 40 -> 57)
//   medium @700ms  depth without 3, with 3
//   hard   @60ms   depth without 3, with 3
//   hard   @700ms  depth without 4, with 4
//
// A 43% wider root costs zero plies at every level and budget tried. Alpha-beta
// with move ordering absorbs the extra width, and `medium` is capped at
// maxDepth 3 anyway. The hypothesis is dead; assertion 3 below keeps it dead.
//
// WHAT IS ACTUALLY WRONG
//
// `negamax` takes a bare `BoardState`, not the `NerfGame`. Only the root calls
// `legalMoves(game)`, which is the function that runs `def.augmentMoves` for
// every held buff. Every interior node calls `generateMoves(board)`, which
// knows nothing about buffs, so:
//
//   ply 0  legalMoves(game)      knight diagonals present
//   ply 1+ generateMoves(board)  knight diagonals gone
//
// The bot therefore plays a move that exists ONLY because of the card, and
// then evaluates every follow-up as if the piece were an ordinary knight. It
// cannot see a two-move plan that needs the buff twice, it cannot see the
// opponent's buffed replies at all, and it never models the three-turn expiry
// in either direction. Its own move is real and its picture of the future is
// not, which is a worse position to be in than simply not having the card.
//
// That is a bug in the engine, not in the balance data, and it applies to
// every move-granting buff in the library, not just this one.
//
// WHY IT IS NOT FIXED HERE
//
// The obvious fix is to give `negamax` a board-bound augment closure and call
// it per node. Three things make that its own round rather than a footnote to
// this one:
//
//   - `makeBuffApi` captures `game.board` by value, so a per-node augment
//     means either rebuilding a ~20-closure api object per node or mutating a
//     shared one. The first is too slow for a hot path; the second is a
//     lifetime hazard.
//   - Not every `augmentMoves` generator is board-pure. Any one that touches
//     `api.rng` would advance the game's RNG stream once per searched node,
//     which is precisely the class of bug `test:desync`, `test:snapshot` and
//     `test:spectator-sync` exist to catch, and it would corrupt live games
//     rather than merely mis-score them.
//   - Applying the augment at every ply ignores expiry, so a 12-ply `hard`
//     search would over-value a three-turn card instead of under-valuing it.
//     Swapping one bias for the other is not obviously progress.
//
// So this file is a known-issue lock. It states the defect, pins its exact
// size in a fixed position, and keeps the refuted depth hypothesis refuted.
// See `docs/ralph-backlog.md` A6 for the fix's design sketch.

import {
  UNRESTRICTED_NERF,
  acquireBuff,
  enableDraftMode,
  legalMoves,
  newGame,
  playMove,
} from "../src/engine/game";
import { generateMoves, makeMove, moveFromUCI } from "../src/engine/board";
import { pickAIMove, type SearchStats } from "../src/engine/ai";
import { BUFF_BY_ID } from "../src/engine/buffs/library";
import { squareName, type Move } from "../src/engine/types";

/** A quiet developed middlegame: both sides out, nothing hanging, no forcing
 *  line to distort the search. */
const OPENING = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "d2d3", "f8c5", "b1c3", "d7d6"];

const CARD = "amazon_army";
/** Two quiet rook-pawn moves that touch neither knight nor bishop, so the only
 *  thing that changes between the root and the interior node is whose turn it
 *  is and whether anyone is still looking at the buff. */
const QUIET_W = "a2a3";
const QUIET_B = "a7a6";
/** The floor `aiBudgetMs` clamps to, i.e. the fastest the bot ever thinks. */
const HARNESS_BUDGET_MS = 60;
/** Repeats, because one 60ms search is mostly scheduling noise. */
const REPEATS = 9;

// Pinned sizes for this exact position. They are here so the test has teeth
// while the defect is unfixed: without them "the search sees none of them"
// stays true even if the card silently stopped granting anything, and the
// whole file would pass while measuring nothing.
const EXPECT_GRANTED_ROOT = 17;
const EXPECT_GRANTED_PLY2 = 17;

function build(withCard: boolean) {
  const g = newGame(UNRESTRICTED_NERF, UNRESTRICTED_NERF, 7);
  enableDraftMode(g, 7, { mode: "buff" });
  for (const uci of OPENING) {
    const m = moveFromUCI(g.board, uci);
    if (!m) throw new Error(`opening move rejected: ${uci}`);
    playMove(g, m);
  }
  if (withCard) acquireBuff(g, "w", CARD, BUFF_BY_ID[CARD]!.tier);
  return g;
}

const granted = (moves: Move[]) => moves.filter((m) => m.via === CARD);
const describe = (moves: Move[]) =>
  moves
    .slice(0, 4)
    .map((m) => `${squareName(m.from)}${squareName(m.to)}`)
    .join(" ");

/** Median, not mean: one descheduled run should not move the answer. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function search(withCard: boolean, budgetMs: number) {
  const depths: number[] = [];
  let rootMoves = 0;
  for (let i = 0; i < REPEATS; i++) {
    const g = build(withCard);
    const stats: SearchStats = { depth: 0, rootMoves: 0 };
    pickAIMove(g, "medium", budgetMs, undefined, stats);
    depths.push(stats.depth);
    rootMoves = stats.rootMoves;
  }
  return { rootMoves, depth: median(depths) };
}

let failures = 0;
const ok = (m: string) => console.log(`  ok  ${m}`);
const bad = (m: string) => {
  failures++;
  console.log(`FAIL  ${m}`);
};

console.log(`what the search can see of ${CARD}\n`);

// ---------------------------------------------------------------------------
// 1. The premise: the card grants moves, and it grants them at the root.
// ---------------------------------------------------------------------------
const game = build(true);
const rootLegal = legalMoves(game);
const rootPlain = generateMoves(game.board);
const rootGranted = granted(rootLegal);

console.log(`  root: ${rootPlain.length} plain moves, ${rootLegal.length} legal moves`);
console.log(`        ${rootGranted.length} of them granted by the card (${describe(rootGranted)} ...)\n`);

if (rootGranted.length !== EXPECT_GRANTED_ROOT) {
  bad(
    `${CARD} granted ${rootGranted.length} moves at the root, expected ${EXPECT_GRANTED_ROOT}. ` +
      "The card, the opening or the move generator has changed, so every number below " +
      "is about a different position than the one this test was written against.",
  );
} else if (granted(rootPlain).length) {
  bad("generateMoves already returns card-granted moves, so this test is measuring nothing");
} else {
  ok(`the card grants ${rootGranted.length} moves, and only legalMoves() produces them`);
}

// ---------------------------------------------------------------------------
// 2. The defect: one ply down, the search is looking at a board where those
//    moves do not exist, while the real game still has every one of them.
//
//    Both sides of this comparison describe the SAME position, two of White's
//    turns into the card's three. `interior` is built the way `negamax` builds
//    it (makeMove on a bare BoardState); `game` is advanced the way a real
//    game is (playMove on the NerfGame). Only one of them is right.
// ---------------------------------------------------------------------------
const wq = moveFromUCI(game.board, QUIET_W);
if (!wq) throw new Error(`quiet white move rejected: ${QUIET_W}`);
const afterW = makeMove(game.board, wq);
const bq = moveFromUCI(afterW, QUIET_B);
if (!bq) throw new Error(`quiet black move rejected: ${QUIET_B}`);
const interior = makeMove(afterW, bq);

playMove(game, wq);
playMove(game, bq);

const searchSees = generateMoves(interior);
const trulyLegal = legalMoves(game);
const missed = granted(trulyLegal);

console.log(
  `  ply 2: the search generates ${searchSees.length} moves, the game allows ${trulyLegal.length}`,
);
console.log(`        the card is still live (${missed.length} granted moves the search cannot see)\n`);

const seen = granted(searchSees).length;

if (missed.length !== EXPECT_GRANTED_PLY2) {
  bad(
    `the card granted ${missed.length} moves at ply 2, expected ${EXPECT_GRANTED_PLY2}. ` +
      "Either the three-turn augment now expires early, or the quiet moves stopped " +
      "being quiet, so this position no longer demonstrates anything.",
  );
} else if (seen === missed.length) {
  ok(
    `the search sees all ${seen} card-granted moves at ply 2: negamax is buff-aware now. ` +
      "Delete this file, drop A6 from the backlog, and RE-MEASURE every move-granting " +
      "card, because their win rates were all taken against a blind search.",
  );
} else if (seen > 0) {
  ok(
    `the search sees ${seen} of ${missed.length} card-granted moves at ply 2, so the ` +
      "blindness is being fixed but is not gone. Finish it before trusting any win " +
      "rate for a move-granting card.",
  );
} else {
  // The known issue. Stated, not failed: see WHY IT IS NOT FIXED HERE above.
  ok(
    `KNOWN DEFECT held at its documented size: negamax searches a bare BoardState, so ` +
      `all ${missed.length} card-granted moves vanish below the root (${describe(missed)} ...). ` +
      "The bot plays a move that only exists because of the card, then evaluates every " +
      "follow-up as if it did not have it. Backlog A6.",
  );
}

// ---------------------------------------------------------------------------
// 3. The refuted hypothesis, kept as an assertion so it stays refuted.
//
//    If the wider tree ever DOES start costing depth, the win-rate harness
//    acquires a second, independent bias against move-granting cards and the
//    balance data has to be re-read. Better to be told.
// ---------------------------------------------------------------------------
const plain = search(false, HARNESS_BUDGET_MS);
const buffed = search(true, HARNESS_BUDGET_MS);
const widening = buffed.rootMoves / plain.rootMoves;

console.log(
  `  at ${HARNESS_BUDGET_MS}ms: ${plain.rootMoves} root moves -> ${buffed.rootMoves} ` +
    `(${((widening - 1) * 100).toFixed(0)}% wider), depth ${plain.depth} -> ${buffed.depth}`,
);

if (buffed.rootMoves <= plain.rootMoves) {
  bad(`${CARD} did not widen the root (${plain.rootMoves} -> ${buffed.rootMoves})`);
} else if (buffed.depth < plain.depth) {
  bad(
    `the wider tree now costs depth (${plain.depth} -> ${buffed.depth}) at the bot's ` +
      "floor budget. It did not when this was written, so the win-rate harness has " +
      "gained a search-depth bias against every move-granting card.",
  );
} else {
  ok(
    `a ${((widening - 1) * 100).toFixed(0)}% wider root still completes ` +
      `depth ${buffed.depth}, so the card costs no search depth`,
  );
}

if (failures) {
  console.error(`\n${failures} search-visibility assertion(s) failed`);
  process.exit(1);
}
console.log("\nsearch buff visibility: OK");
