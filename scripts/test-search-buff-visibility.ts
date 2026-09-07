// The bot's search sees buff-granted moves at every ply, not just the root.
//
//   npx tsx scripts/test-search-buff-visibility.ts
//
// WHY THIS EXISTS
//
// `amazon_army` measured -25 win-rate points for its own holder at tier 7. It
// is passive and it only ADDS legal moves: knights borrow bishop slides,
// bishops borrow knight leaps, for three of the owner's turns. A card that
// strictly widens the option set cannot make a position worse, so a large
// negative measurement had to be coming from somewhere other than the card.
//
// It was coming from the search. `negamax` and `quiesce` take a bare
// `BoardState`; only `pickAIMove`'s root called `legalMoves(game)`, and
// `legalMoves` is the only place `def.augmentMoves` runs. So:
//
//   ply 0  legalMoves(game)      knight diagonals present
//   ply 1+ generateMoves(board)  knight diagonals gone
//
// The bot played a move that existed ONLY because of the card, then evaluated
// every follow-up as if the piece were an ordinary knight. It could not see a
// two-move plan that needed the buff twice, could not see the opponent's
// buffed replies at all, and never modelled the three-turn expiry in either
// direction. Its own move was real and its picture of the future was not,
// which is a worse place to be than simply not holding the card.
//
// A13 fixed that: `buildSearchBuffs` prepares both sides' held move-granting
// cards per ply, and `applySearchAugments` runs their hooks at every interior
// node. This file is now a REGRESSION GUARD on that, not a known-issue lock.
// It fails if the search goes blind again, if it starts ignoring expiry, or if
// the wider tree begins costing search depth at the harness's floor budget.
//
// The three things it checks are the three ways the fix can rot:
//
//   1. the card still grants moves, and still only through legalMoves
//   2. the SEARCH sees exactly those moves at an interior node, and stops
//      seeing them on the ply the card expires
//   3. the wider tree still costs no depth at the win-rate harness's budget
//
// Assertion 2 deliberately drives `buildSearchBuffs` + `applySearchAugments`
// rather than `generateMoves`, because those two are literally what `negamax`
// calls (see `genMoves` in ai.ts). An earlier version of this file compared
// `generateMoves(interior)` against `legalMoves(game)` and could therefore
// never report success at all: assertion 1 requires `generateMoves` NOT to
// return granted moves, so the branch that declared victory when it did was
// unreachable by construction.

import {
  UNRESTRICTED_NERF,
  acquireBuff,
  applySearchAugments,
  buildSearchBuffs,
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

// Pinned sizes for this exact position, so the file has teeth: without them
// "the search sees them all" stays true even if the card silently stopped
// granting anything, and the whole file would pass while measuring nothing.
const EXPECT_GRANTED_ROOT = 17;
const EXPECT_GRANTED_PLY2 = 17;
/** `amazon_army` is a three-turn card, so ply 6 is the owner's fourth move. */
const EXPIRES_AT_PLY = 6;

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
// 2. The fix: one ply down, the search is looking at the same move set the
//    real game allows.
//
//    Both sides of this comparison describe the SAME position, two of White's
//    turns into the card's three. `interior` is built the way `negamax` builds
//    it (makeMove on a bare BoardState) and then augmented the way `negamax`
//    augments it; `game` is advanced the way a real game is (playMove on the
//    NerfGame). They have to agree.
// ---------------------------------------------------------------------------
const searchBuffs = buildSearchBuffs(game, 20);

const wq = moveFromUCI(game.board, QUIET_W);
if (!wq) throw new Error(`quiet white move rejected: ${QUIET_W}`);
const afterW = makeMove(game.board, wq);
const bq = moveFromUCI(afterW, QUIET_B);
if (!bq) throw new Error(`quiet black move rejected: ${QUIET_B}`);
const interior = makeMove(afterW, bq);

playMove(game, wq);
playMove(game, bq);

/** Exactly what `genMoves` in ai.ts does at an interior node. */
function searchMovesAt(ply: number): Move[] {
  const moves = generateMoves(interior);
  if (searchBuffs) applySearchAugments(searchBuffs, interior, ply, 0, moves);
  return moves;
}

const searchSees = searchMovesAt(2);
const trulyLegal = legalMoves(game);
const missed = granted(trulyLegal);

console.log(
  `  ply 2: the search generates ${searchSees.length} moves, the game allows ${trulyLegal.length}`,
);
console.log(`        the card is still live (${missed.length} granted moves in the real game)\n`);

const seen = granted(searchSees).length;

if (!searchBuffs) {
  bad(
    "buildSearchBuffs returned null while the holder is holding a move-granting card, " +
      "so the search has no augments to run and is blind below the root again.",
  );
} else if (missed.length !== EXPECT_GRANTED_PLY2) {
  bad(
    `the card granted ${missed.length} moves at ply 2, expected ${EXPECT_GRANTED_PLY2}. ` +
      "Either the three-turn augment now expires early, or the quiet moves stopped " +
      "being quiet, so this position no longer demonstrates anything.",
  );
} else if (seen === missed.length) {
  ok(`the search sees all ${seen} card-granted moves at ply 2: negamax is buff-aware`);
} else if (seen > 0) {
  bad(
    `the search sees only ${seen} of ${missed.length} card-granted moves at ply 2. ` +
      "It used to see all of them, so something has narrowed the augment step.",
  );
} else {
  bad(
    `the search sees NONE of the ${missed.length} card-granted moves at ply 2 ` +
      `(${describe(missed)} ...). This is the original A6/A13 defect returning: the bot ` +
      "plays a move that only exists because of the card, then evaluates every " +
      "follow-up as if it did not have it.",
  );
}

// ---------------------------------------------------------------------------
// 2b. Expiry, which is the other half of being right about the card.
//
//     Applying the augment at every ply would over-value a three-turn card at
//     depth 12 instead of under-valuing it, which is trading one bias for
//     another rather than fixing anything. The side to move at ply p has
//     played p >> 1 of its own moves to get there, so a three-turn card is
//     live at plies 0, 2 and 4 and gone at ply 6.
// ---------------------------------------------------------------------------
const liveThrough = [0, 2, 4].map((p) => granted(searchMovesAt(p)).length);
const afterExpiry = granted(searchMovesAt(EXPIRES_AT_PLY)).length;

console.log(
  `  expiry: granted moves visible at plies 0/2/4 = ${liveThrough.join("/")}, ` +
    `at ply ${EXPIRES_AT_PLY} = ${afterExpiry}\n`,
);

if (liveThrough.some((n) => n !== EXPECT_GRANTED_PLY2)) {
  bad(
    `the card should be live for three of White's moves (plies 0, 2 and 4) but the ` +
      `search saw ${liveThrough.join("/")} granted moves there. Expiry is being applied ` +
      "too early, so the search now under-values the card in a new way.",
  );
} else if (afterExpiry !== 0) {
  bad(
    `the card is spent by ply ${EXPIRES_AT_PLY} (White's fourth move) but the search still ` +
      `offers ${afterExpiry} granted moves there. Applying the augment past its expiry ` +
      "over-values a timed card at depth, which is the opposite bias, not a fix.",
  );
} else {
  ok(
    `the augment expires with the card: live at plies 0/2/4, gone at ply ${EXPIRES_AT_PLY}, ` +
      "so a three-turn card is not searched as a permanent one",
  );
}

// ---------------------------------------------------------------------------
// 3. What the wider tree costs in depth, pinned at its MEASURED size.
//
//    Before A13 the tree was wide only at the root, and a 43% wider root cost
//    zero plies at every level and budget tried. That is no longer true and
//    cannot be: every ply now generates the granted moves, so the branching
//    factor is 1.4x the whole way down and the tree really is ~1.6x the nodes.
//    Measured on a quiet box (scripts/bench-search-buffs.ts, median of 15):
//
//      medium @60ms   depth 3 -> 2   (the floor budget: one ply lost)
//      medium @700ms  depth 3 -> 3   (medium's real budget: nothing lost)
//      hard   @2000ms depth 5 -> 4   (one ply lost)
//      no card held   identical node counts at every level (zero overhead)
//
//    So this asserts the SIZE of the cost rather than pretending it is zero.
//    One ply at the 60ms floor is the known price of no longer being blind;
//    two would be a new regression, and any loss at medium's real 700ms budget
//    would mean the augment step had become far more expensive than measured.
//
//    The 60ms floor only binds when a bot is under 600ms on its clock
//    (`aiBudgetMs` clamps to remainingClock/10), and sim-card-winrate.ts
//    freezes the clock so it always reaches its full depth. The win-rate
//    harness therefore does NOT acquire a depth bias from this.
// ---------------------------------------------------------------------------
const MAX_PLIES_LOST_AT_FLOOR = 1;

const plain = search(false, HARNESS_BUDGET_MS);
const buffed = search(true, HARNESS_BUDGET_MS);
const widening = buffed.rootMoves / plain.rootMoves;
const lost = plain.depth - buffed.depth;

console.log(
  `  at ${HARNESS_BUDGET_MS}ms: ${plain.rootMoves} root moves -> ${buffed.rootMoves} ` +
    `(${((widening - 1) * 100).toFixed(0)}% wider), depth ${plain.depth} -> ${buffed.depth}`,
);

if (buffed.rootMoves <= plain.rootMoves) {
  bad(`${CARD} did not widen the root (${plain.rootMoves} -> ${buffed.rootMoves})`);
} else if (lost > MAX_PLIES_LOST_AT_FLOOR) {
  bad(
    `the wider tree now costs ${lost} plies at the bot's floor budget ` +
      `(${plain.depth} -> ${buffed.depth}), where it cost at most ${MAX_PLIES_LOST_AT_FLOOR}. ` +
      "The per-node augment step has become materially more expensive, and every " +
      "move-granting card is paying for it.",
  );
} else {
  ok(
    `a ${((widening - 1) * 100).toFixed(0)}% wider root at every ply costs ` +
      `${lost} ply at the ${HARNESS_BUDGET_MS}ms floor (depth ${plain.depth} -> ${buffed.depth}), ` +
      `within the measured ${MAX_PLIES_LOST_AT_FLOOR}`,
  );
}

// medium's REAL budget, where the level is capped at maxDepth 3 anyway and the
// extra width has room to be absorbed. A loss here would be a real regression.
const plain700 = search(false, 700);
const buffed700 = search(true, 700);
console.log(
  `  at 700ms: depth ${plain700.depth} -> ${buffed700.depth} (medium's real budget)`,
);
if (buffed700.depth < plain700.depth) {
  bad(
    `the wider tree costs depth at medium's real 700ms budget too ` +
      `(${plain700.depth} -> ${buffed700.depth}). It did not when this was measured, so the ` +
      "augment step has got much more expensive than the ~0% per-node overhead recorded.",
  );
} else {
  ok(`no depth is lost at medium's real 700ms budget (depth ${buffed700.depth})`);
}

if (failures) {
  console.error(`\n${failures} search-visibility assertion(s) failed`);
  process.exit(1);
}
console.log("\nsearch buff visibility: OK");
