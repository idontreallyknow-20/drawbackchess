// Does a buff-aware search actually play the card better? (backlog A13)
//
//   npx tsx scripts/sim-search-buff-strength.ts --before <dir> --card amazon_army --pairs 40
//
// PAIRED, like scripts/sim-card-winrate.ts, and for the same reason: the delta
// between two games that share a seed and an opening cancels almost all the
// noise that would otherwise swamp one card's contribution.
//
// What differs between the two arms is NOT whether White holds the card — it
// holds it in both — but whether White's SEARCH can see the moves the card
// grants below the root. Arm "after" is the current engine; arm "before" is a
// copy of src/engine with ai.ts and game.ts reverted to their pre-A13 state.
// Black plays with the current engine in both arms, so the only difference in
// the whole pair is White's searcher.
//
// That is a sharper question than re-running the card's win rate. The card's
// measured -25 points mixes the card's own value with the handicap of holding
// it; this isolates the handicap.
//
// Openings are random and seeded, because at a fixed level `pickAIMove` is
// deterministic: without a varied start every seed would play the identical
// game and the sample would be one game repeated N times. The card is granted
// AFTER the opening, so its three turns are live exactly while the bots are
// the ones choosing.

import { pickAIMove as pickAfter } from "../src/engine/ai";
import {
  UNRESTRICTED_NERF,
  acquireBuff,
  aiActivateBuffs,
  enableDraftMode,
  legalMoves,
  newGame,
  playMove,
} from "../src/engine/game";
import type { NerfGame } from "../src/engine/game";
import { BUFF_BY_ID } from "../src/engine/buffs/library";
import type { Move } from "../src/engine/types";

const args = process.argv.slice(2);
const flag = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BEFORE_DIR = flag("before", "");
const CARD = flag("card", "amazon_army");
const OPPONENT_CARD = flag("opp-card", "cornerstone");
const PAIRS = Number(flag("pairs", "40"));
const SEED0 = Number(flag("seed0", "1"));
const OPENING_PLIES = Number(flag("opening", "8"));
const MAX_PLIES = Number(flag("plies", "240"));
const LEVEL = flag("level", "medium") as "medium" | "hard";
const BUDGET = Number(flag("budget", "700"));

// Frozen clock, exactly as sim-card-winrate.ts freezes it and for the same
// reason: the search aborts on wall time, so under load the same position
// searches to different depths and a "pair" stops being a pair. Frozen, both
// arms run to their configured depth every time and the run is reproducible.
// It also means the depth loss the wider tree causes under a real time budget
// is deliberately NOT part of this measurement — this isolates move quality.
const FROZEN_NOW = Date.now();
Date.now = () => FROZEN_NOW;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The house profile sim-card-winrate.ts measures at (skill 1350): a plain
// depth-3 argmax search with a 5% chance per move of playing something random
// instead. The blunder rate is not decoration here, it is what makes the
// measurement possible. At a fixed level `pickAIMove` is a pure function of
// the position, so two identical searchers facing each other shuffle and draw:
// a first attempt at this drew 4 of 4 by threefold repetition with a delta of
// exactly zero in every pair, which is a fact about mirrored determinism and
// not about the card. Both arms of a pair draw from the same seeded stream, so
// the pairing survives until the two searches genuinely disagree.
const BLUNDER_CHANCE = 0.05;

type Picker = (g: NerfGame, budget: number) => Move | null;

async function loadBefore(): Promise<Picker> {
  if (!BEFORE_DIR) throw new Error("--before <engineDir> is required");
  const ai = await import(`${BEFORE_DIR}/ai.ts`);
  return (g, budget) => ai.pickAIMove(g, LEVEL, budget);
}

const pickerAfter: Picker = (g, budget) => pickAfter(g, LEVEL, budget);

type Outcome = "w" | "b" | "draw" | "unfinished";

/** Read the finished game's winner. A free function, because `playMove`
 *  mutates the game in place and the caller's earlier `if (game.result)` guard
 *  otherwise keeps the field narrowed to `null` for the rest of that scope. */
function outcomeOf(g: NerfGame): Outcome {
  const r = g.result;
  if (!r) return "unfinished";
  return r.winner === "w" ? "w" : r.winner === "b" ? "b" : "draw";
}

/** Replay the same seeded random opening, then hand over to the searchers. */
function setup(seed: number): NerfGame {
  const game = newGame(UNRESTRICTED_NERF, UNRESTRICTED_NERF, seed);
  enableDraftMode(game, seed, { mode: "buff" });
  const rnd = mulberry32(seed * 7919);
  for (let i = 0; i < OPENING_PLIES; i++) {
    const moves = legalMoves(game);
    if (!moves.length || game.result) break;
    playMove(game, moves[Math.floor(rnd() * moves.length)]);
  }
  return game;
}

function playGame(seed: number, whitePicker: Picker): Outcome {
  const game = setup(seed);
  if (game.result) return "unfinished";
  const oppDef = BUFF_BY_ID[OPPONENT_CARD];
  if (oppDef?.implemented) acquireBuff(game, "b", OPPONENT_CARD, oppDef.tier);
  const def = BUFF_BY_ID[CARD];
  if (!def?.implemented) throw new Error(`card not implemented: ${CARD}`);
  acquireBuff(game, "w", CARD, def.tier);

  // The SAME stream in both arms, so a pair stays paired until the two
  // searchers genuinely disagree.
  const rnd = mulberry32(seed * 104729 + 17);
  const random = (max: number) => Math.floor(rnd() * max);

  for (let ply = 0; ply < MAX_PLIES && !game.result; ply++) {
    const mover = game.board.turn;
    try {
      aiActivateBuffs(game, mover);
    } catch {
      /* an activation that throws is not this measurement's problem */
    }
    if (game.result) break;
    if (game.board.turn !== mover) continue;
    let move: Move | null = null;
    try {
      if (random(10_000) < Math.round(BLUNDER_CHANCE * 10_000)) {
        const all = legalMoves(game);
        if (!all.length) break;
        move = all[random(all.length)];
      } else {
        move = mover === "w" ? whitePicker(game, BUDGET) : pickerAfter(game, BUDGET);
      }
    } catch {
      return "unfinished";
    }
    if (!move) break;
    playMove(game, move);
  }
  return outcomeOf(game);
}

/** White's score in a game, on the usual 1 / 0.5 / 0 scale. */
const score = (o: Outcome) => (o === "w" ? 1 : o === "draw" ? 0.5 : 0);

async function main() {
  const pickerBefore = await loadBefore();
  console.log(
    `search-buff strength: ${CARD} at ${LEVEL} (${BUDGET}ms nominal, clock frozen), ` +
      `${PAIRS} pairs, ${OPENING_PLIES} random opening plies\n`,
  );
  console.log("White holds the card in BOTH arms; only its search differs.\n");

  const deltas: number[] = [];
  let voided = 0;
  let wAfter = 0;
  let wBefore = 0;
  let dAfter = 0;
  let dBefore = 0;

  for (let i = 0; i < PAIRS; i++) {
    const seed = SEED0 + i;
    const after = playGame(seed, pickerAfter);
    const before = playGame(seed, pickerBefore);
    if (after === "unfinished" || before === "unfinished") {
      voided++;
      continue;
    }
    if (after === "w") wAfter++;
    if (before === "w") wBefore++;
    if (after === "draw") dAfter++;
    if (before === "draw") dBefore++;
    deltas.push(score(after) - score(before));
    const n = deltas.length;
    const mean = deltas.reduce((a, b) => a + b, 0) / n;
    process.stdout.write(
      `  pair ${String(i + 1).padStart(3)}  after=${after.padEnd(5)} before=${before.padEnd(5)} ` +
        `running delta ${(mean * 100 >= 0 ? "+" : "")}${(mean * 100).toFixed(1)}pt\n`,
    );
  }

  const n = deltas.length;
  if (!n) {
    console.log(`\nno completed pairs (${voided} voided at the ${MAX_PLIES}-ply cap)`);
    return;
  }
  const mean = deltas.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const stderr = Math.sqrt(variance / n);

  console.log(
    `\n${n} completed pairs (${voided} voided at the ${MAX_PLIES}-ply cap)\n` +
      `  buff-aware search  ${wAfter} wins, ${dAfter} draws  (score ${(wAfter + dAfter / 2).toFixed(1)}/${n})\n` +
      `  blind search       ${wBefore} wins, ${dBefore} draws  (score ${(wBefore + dBefore / 2).toFixed(1)}/${n})\n` +
      `\n  delta ${mean * 100 >= 0 ? "+" : ""}${(mean * 100).toFixed(1)} +-${(stderr * 100).toFixed(1)} win-rate points ` +
      `(${(mean / (stderr || 1)).toFixed(1)} sigma)`,
  );
  console.log(
    `\nA positive delta means seeing the granted moves below the root made the ` +
      `card's holder stronger, which is what A13 predicts.`,
  );
}

main();
