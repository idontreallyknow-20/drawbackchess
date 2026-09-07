// Regression tests for the bot's activated-card play policy.
//
//   npx tsx scripts/test-ai-activation.ts
//
// WHY THIS EXISTS
//
// The bot chooses a card's targets with `aiCollectPicks`, which ranks each
// candidate square with `aiSquareScore`: an enemy-occupied square scores
// `1000 + value * 20`, an empty one scores its centrality, so roughly nothing.
// That is a reasonable first guess and it is wrong in two ways that a line
// sweep exposes together.
//
// It cannot see what a card catches ALONG THE WAY, so a sweep that eats three
// pawns scores below one that ends on a knight. And it cannot see where the
// card LEAVES the piece it moved, so the bot walks its queen onto a defended
// square to reach the biggest target and hands over nine points for three.
//
// `queens_rampage` measured -13.6 win-rate points for its own holder at tier 7
// because of this. The card is fine. The policy that fires it was not.
//
// That matters beyond one card. `scripts/sim-card-winrate.ts` measures every
// activated card by having this same bot play it, so a policy that plays cards
// badly does not merely lose those games: it corrupts the balance dataset the
// tier ladder is built from, and it does so invisibly, because a card that
// measures badly looks exactly like a card that IS bad.
//
// The fix is `refineLastSquarePick`, which re-picks the last square by
// simulating the activation on a detached copy of the game and scoring the
// resulting position. These tests pin the two properties that matters: it must
// not leave a moved piece hanging, and it must not have simply frozen the
// greedy answer in place.

import {
  UNRESTRICTED_NERF,
  acquireBuff,
  aiChooseBuffActivation,
  enableDraftMode,
  newGame,
} from "../src/engine/game";
import { attackedBy } from "../src/engine/board";
import { SQ, squareName, type Color, type PieceType, type Square } from "../src/engine/types";

let failures = 0;
const pass = (m: string) => console.log(`  ok  ${m}`);
const fail = (m: string) => {
  failures++;
  console.log(`FAIL  ${m}`);
};

const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

/** An empty board with both kings tucked in a corner, plus the buff under test. */
function position(cardId: string, pieces: [number, number, PieceType, Color][]) {
  const g = newGame(UNRESTRICTED_NERF, UNRESTRICTED_NERF);
  enableDraftMode(g, "buff");
  for (let sq = 0; sq < 64; sq++) g.board.pieces[sq] = null;
  g.board.pieces[SQ(0, 0)] = { type: "k", color: "w" };
  g.board.pieces[SQ(7, 7)] = { type: "k", color: "b" };
  for (const [f, r, type, color] of pieces) g.board.pieces[SQ(f, r)] = { type, color };
  g.board.turn = "w";
  acquireBuff(g, "w", cardId);
  return g;
}

/** What the greedy scorer alone would have chosen from a candidate set. */
function greedyPick(g: ReturnType<typeof position>, squares: Square[]): Square {
  let best = squares[0];
  let bestScore = -Infinity;
  for (const sq of squares) {
    const p = g.board.pieces[sq];
    const score = p ? (p.color === "b" ? 1000 : 100) + VALUE[p.type] * 20 : 0;
    if (score > bestScore) {
      bestScore = score;
      best = sq;
    }
  }
  return best;
}

console.log("bot activated-card play policy");

// ---------------------------------------------------------------------------
// 1. Queen's Rampage must not sweep onto a defended square.
//
// The queen sits on d4. Along the fourth rank there is a black knight on g4,
// DEFENDED by a rook on g8, and an empty h4 behind it. Up the d file there are
// three undefended pawns.
//
// Greedy scores g4 at 1060 and everything else near zero, so it takes the
// knight and stands where the rook recaptures: three points won, nine lost.
// ---------------------------------------------------------------------------
{
  const g = position("queens_rampage", [
    [3, 3, "q", "w"],
    [3, 4, "p", "b"],
    [3, 5, "p", "b"],
    [3, 6, "p", "b"],
    [6, 3, "n", "b"],
    [6, 7, "r", "b"],
  ]);

  const choice = aiChooseBuffActivation(g, "w");
  if (!choice) {
    fail("Queen's Rampage: the bot declined to fire on a position full of free material");
  } else {
    const endpoint = choice.picks[choice.picks.length - 1]!.square as Square;
    const greedy = greedyPick(g, [SQ(6, 3), SQ(7, 3), SQ(3, 6)] as Square[]);
    const blackAttacks = attackedBy(g.board, "b");

    if (squareName(greedy) !== "g4") {
      fail(`the greedy control picked ${squareName(greedy)}, expected g4; the setup has drifted`);
    } else if (blackAttacks.has(endpoint)) {
      fail(
        `Queen's Rampage swept to ${squareName(endpoint)}, which black attacks: the queen is lost`,
      );
    } else {
      pass(
        `Queen's Rampage sweeps to ${squareName(endpoint)} instead of the defended ${squareName(greedy)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 2. The refinement must not have simply disabled the card.
//
// The failure mode of a safety check is refusing to ever act. With a knight on
// g4 that nothing defends, taking it is correct and the bot must still do it.
// ---------------------------------------------------------------------------
{
  const g = position("queens_rampage", [
    [3, 3, "q", "w"],
    [6, 3, "n", "b"],
  ]);

  const choice = aiChooseBuffActivation(g, "w");
  if (!choice) {
    fail("Queen's Rampage: refused to take a completely undefended knight");
  } else {
    const endpoint = choice.picks[choice.picks.length - 1]!.square as Square;
    const swept = ["g4", "h4"].includes(squareName(endpoint));
    if (swept) pass(`an undefended knight is still taken (sweep ends on ${squareName(endpoint)})`);
    else fail(`swept to ${squareName(endpoint)}, which does not capture the free knight on g4`);
  }
}

// ---------------------------------------------------------------------------
// 3. A sweep worth firing only for what it catches on the way.
//
// Every candidate endpoint is EMPTY, so the landing-square rule scores the
// whole card at zero and the "offensive cards hold out for a knight's worth"
// gate would refuse to fire it at all. The material is entirely in transit.
// ---------------------------------------------------------------------------
{
  const g = position("queens_rampage", [
    [3, 3, "q", "w"],
    [3, 4, "p", "b"],
    [3, 5, "p", "b"],
    [3, 6, "p", "b"],
  ]);

  const choice = aiChooseBuffActivation(g, "w");
  if (!choice) {
    fail("a sweep down three undefended pawns was refused because the endpoint is empty");
  } else {
    const endpoint = choice.picks[choice.picks.length - 1]!.square as Square;
    pass(`a sweep is fired for the pawns it eats in transit (ends on ${squareName(endpoint)})`);
  }
}

if (failures) {
  console.error(`\n${failures} activation-policy assertion(s) failed`);
  process.exit(1);
}
console.log("bot activation policy: OK");
