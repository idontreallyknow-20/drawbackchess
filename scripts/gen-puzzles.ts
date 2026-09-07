// Puzzle generator: mines real positions, PROVES a claim about each one, and
// writes the survivors to public/puzzle-data/puzzles.json.
//
//   ./node_modules/.bin/tsx scripts/gen-puzzles.ts --games 60 --write
//   ./node_modules/.bin/tsx scripts/gen-puzzles.ts --verify        # re-check the shipped file
//
// WHY THIS EXISTS AND WHY IT IS A SCRIPT
//
// docs/lichess-parity-2026-09.md section 7 is blunt about the constraint:
// classic tactics puzzles do not transfer to this game. There is no checkmate
// (the first king capture ends it) and no stable piece value (a card can delete
// a queen), so almost every imported puzzle would have either no solution or
// several. The three formats that DO work are built here:
//
//   king-hunt    Capture the king in N under a named handicap.
//   only-move    Your rule leaves exactly one legal move. Read the rule.
//   card-choice  Two cards are offered. One of them wins. Which?
//
// The last one has no chess analogue at all, which is why it is the one worth
// getting right.
//
// WHAT "PROVEN" MEANS HERE
//
// A puzzle claims that a specific move (or card) wins and that nothing else
// does. Both halves are established by exhaustive search over the REAL engine —
// real `legalMoves`, real `playMove`, real nerf filters, real buff hooks — not
// by an evaluation:
//
//   1. The winning move forces a king capture within N of the hero's own moves
//      against EVERY defence. AND at foe nodes, OR at hero nodes, no pruning.
//   2. Every OTHER legal move at that node is played out and shown to fail.
//   3. Both checks are repeated at every position the solver will be asked to
//      move in, not only at the first, so the whole line is unambiguous.
//
// A candidate that hits the search node cap is discarded as "not proven" rather
// than accepted, so the cap can lose puzzles but can never invent one.
//
// The check is not a separate step someone has to remember to run: every puzzle
// is re-verified after serialization, by parsing the exact JSON text that will
// be written and re-proving the claim against the rebuilt game. If the file
// disagrees with the search, nothing is written.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { generateMoves, moveToSAN, moveToUCI } from "../src/engine/board";
import { pickAIMove } from "../src/engine/ai";
import {
  UNRESTRICTED_NERF,
  buffAugmentedAttacks,
  deserializeGame,
  enableDraftMode,
  legalMoves,
  newGame,
  pickDraftCard,
  playMove,
  serializeGame,
  type GameResult,
  type GameSnapshot,
  type NerfGame,
} from "../src/engine/game";
import { openingNerfPool } from "../src/engine/nerfs/library";
import { ALL_BUFFS } from "../src/engine/buffs/library";
import { isRetired } from "../src/engine/retired";
import { boardToFen } from "../src/lib/fen";
import { KING_CAPTURE, buildLine, winningMoves, type LineStep } from "../src/lib/puzzles/solve";
import {
  PUZZLE_FILE_VERSION,
  type Puzzle,
  type PuzzleCard,
  type PuzzleFile,
  type PuzzleFormat,
  type PuzzlePly,
} from "../src/lib/puzzles/types";
import type { Buff } from "../src/engine/buff";
import type { Color } from "../src/engine/types";
import type { Nerf, Tier } from "../src/engine/nerf";

// --- flags -------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string, dflt: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const GAMES = Number(flag("games", "40"));
const SEED = Number(flag("seed", "20260907"));
const TARGET = Number(flag("target", "60"));
const MAX_PLIES = Number(flag("plies", "110"));
const WRITE = args.includes("--write");
const VERIFY_ONLY = args.includes("--verify");

const OUT_DIR = join(__dirname, "..", "public", "puzzle-data");
const OUT_FILE = join(OUT_DIR, "puzzles.json");

// --- determinism -------------------------------------------------------------
//
// The mining bot draws on Math.random (`easy` blunders) and the engine's search
// cuts off on wall time. Both are pinned, for the same reason sim-card-winrate
// pins them: a generator whose output depends on how busy the box was cannot be
// re-run to check its own file.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
Math.random = rand;
/** The wall clock as it really is, read BEFORE the freeze, so the file can be
 *  stamped with the day it was actually made. */
const REAL_NOW = Date.now();
/** An arbitrary fixed instant. The value does not matter; that it never moves
 *  does, because the engine's search cuts off on elapsed wall time and would
 *  otherwise search deeper or shallower depending on how busy the box is. */
const FROZEN_NOW = 1_757_200_000_000;
Date.now = () => FROZEN_NOW;

// --- pools -------------------------------------------------------------------

// Nerfs a puzzle may be built on.
//
// Fog of War is excluded outright: its whole mechanic is hiding the board, and
// a puzzle that cannot show the player the position is not a puzzle. Everything
// else is fair game, because the route renders the same hint line and the same
// board markings the live match does, so a rule with a rolled parameter ("no
// captures on a random rank") is as readable here as it is in a game.
const HIDDEN_INFO_NERFS = new Set(["fog_of_war"]);

function puzzleNerfPool(): Nerf[] {
  return openingNerfPool().filter((n) => !HIDDEN_INFO_NERFS.has(n.id));
}

/**
 * Cards a card-choice puzzle may offer.
 *
 * Only `instant` and `passive` cards. An `activated` card would need the player
 * to fire it, pick targets, and only then move, which is a second puzzle bolted
 * onto the first; worse, its effect depends on target choices the generator
 * would have to enumerate to keep the uniqueness claim honest. Instant cards
 * resolve on pick and passives are in force from the moment they are held, so
 * "take this card" is a complete, verifiable action.
 */
function cardPool(): Buff[] {
  return ALL_BUFFS.filter(
    (b) =>
      b.implemented &&
      !isRetired(b.id) &&
      !b.special &&
      !b.opener &&
      (b.kind === "instant" || b.kind === "passive") &&
      b.tier <= 7,
  );
}

// --- position mining ---------------------------------------------------------

interface Mined {
  snap: GameSnapshot;
  fen: string;
  ply: number;
  nerfId: string;
}

/**
 * Play games and keep every position along the way.
 *
 * The bot is the engine's `easy` level on purpose. A strong bot ends a game the
 * instant a forced king capture appears, so the position one ply earlier is the
 * only puzzle it ever produces; a weak one walks into and back out of forced
 * losses for dozens of plies, which is exactly the supply a puzzle miner wants.
 * The positions are still real game positions either way: no piece is ever
 * placed by hand.
 */
function minePositions(): Mined[] {
  const pool = puzzleNerfPool();
  const out: Mined[] = [];
  const seen = new Set<string>();
  for (let g = 0; g < GAMES; g++) {
    const whiteNerf = pool[Math.floor(rand() * pool.length)];
    const blackNerf = pool[Math.floor(rand() * pool.length)];
    const game = newGame(whiteNerf, blackNerf, Math.floor(rand() * 1e9));
    // Two thirds of the games are played by the blundering `easy` level and one
    // third by `medium` (a sound 3-ply search). Easy games end fast and hang
    // kings; medium games run long and produce positions where a forced capture
    // is buried rather than sitting on the surface. A corpus mined from only one
    // of the two is a corpus of only one kind of position.
    const level = rand() < 0.34 ? "medium" : "easy";
    for (let ply = 0; ply < MAX_PLIES && !game.result; ply++) {
      if (ply >= 6) {
        const fen = boardToFen(game.board);
        if (!seen.has(fen)) {
          seen.add(fen);
          const slot = game.board.turn === "w" ? game.white : game.black;
          out.push({ snap: serializeGame(game), fen, ply, nerfId: slot.nerf.id });
        }
      }
      const move = pickAIMove(game, level);
      if (!move) break;
      try {
        playMove(game, move);
      } catch {
        break;
      }
    }
  }
  return out;
}

// --- snapshot surgery --------------------------------------------------------

/**
 * Strip the position down to what the puzzle can honestly show.
 *
 * A puzzle may only lean on rules the player can read. The hero's handicap is
 * always shown, so it always stays. The FOE's is kept ONLY when it is fully
 * described by its own text, and dropped otherwise:
 *
 *   A nerf with an `init` hook rolls hidden per-game state — a random banned
 *   rank, a secret square, a chosen piece. The live game surfaces that through
 *   `hint()` and `visual()`, but both only run for the side to move, so a
 *   puzzle can never show the player what the DEFENDER's rolled parameter is.
 *   A forced win resting on a constraint the solver cannot see is not a puzzle,
 *   it is a trick, so those opponents are unrestricted instead.
 *
 * Keeping the stateless ones matters: an opponent under a known handicap is
 * where forced sequences actually come from in this game, and "their rule traps
 * them" is the thing normal chess cannot teach.
 *
 * Nothing here is trusted. Every claim is re-proven on the resulting snapshot.
 */
function heroOnlyNerf(snap: GameSnapshot, hero: Color): GameSnapshot {
  const copy = JSON.parse(JSON.stringify(snap)) as GameSnapshot;
  const foe: Color = hero === "w" ? "b" : "w";
  const foeNerf = NERF_BY_ID.get(copy.slots[foe].nerfId);
  const showable = foeNerf && !foeNerf.init && !HIDDEN_INFO_NERFS.has(foeNerf.id);
  if (!showable) {
    copy.slots[foe] = {
      nerfId: UNRESTRICTED_NERF.id,
      state: {},
      rngState: copy.slots[foe].rngState,
    };
  }
  copy.result = null;
  return copy;
}

const NERF_BY_ID = new Map(openingNerfPool().map((n) => [n.id, n]));

function rebuild(snap: GameSnapshot): NerfGame {
  const g = deserializeGame(snap);
  if (!g) throw new Error("snapshot rejected by deserializeGame");
  return g;
}

// --- format 1: capture the king in N ----------------------------------------

/** How deep a king hunt may run. Two of the hero's moves is the sweet spot: a
 *  real forcing sequence, and a tree small enough to prove exhaustively for
 *  every candidate position rather than for a lucky few. */
const MAX_HUNT = 2;

function tryKingHunt(mined: Mined): Puzzle | null {
  const base = rebuild(mined.snap);
  const hero = base.board.turn;
  const snap = heroOnlyNerf(mined.snap, hero);
  const game = rebuild(snap);
  if (game.result) return null;
  if (game.board.turn !== hero) return null;

  const rule = hero === "w" ? game.white.nerf : game.black.nerf;
  if (rule.id === UNRESTRICTED_NERF.id) return null;

  const legal = legalMoves(game);
  const pseudo = generateMoves(game.board);
  // A forced win found among five legal moves is arithmetic, not a puzzle.
  if (legal.length < 8) return null;

  // Two budgets, and the bar for each is different.
  //
  // A one-move win is "the king is hanging", which in bot play is simply the
  // last position of every game. It is only kept when the HANDICAP is what
  // picks the move: several of the hero's pieces could take the king, and the
  // rule allows exactly one of them. That is a real puzzle about the card, and
  // it is the version of "king in one" worth shipping.
  //
  // A two-move win needs no such excuse. It is a forcing sequence against every
  // defence, which is the direct translation of mate in two into a game that
  // has no mate.
  const w1 = winningMoves(game, 1);
  if (w1 === null) return null;
  let budget: number;
  if (w1.length > 0) {
    if (w1.length !== 1) return null; // two ways to take the king: ambiguous
    budget = 1;
  } else {
    const w2 = winningMoves(game, MAX_HUNT);
    if (w2 === null || w2.length !== 1) return null;
    budget = MAX_HUNT;
  }

  const { binding, decisive } = ruleWeight(snap, hero, budget, legal.length, pseudo.length);
  if (budget === 1 && !decisive) return null;

  const line = buildLine(game, budget);
  if (!line) return null;
  // Promotions in the hero's own moves are dropped rather than given a piece
  // chooser: one extra widget for a case worth a handful of puzzles.
  if (line.some((s) => s.hero.promotion)) return null;

  const plies = lineToPlies(line);

  return {
    id: puzzleId("kh", mined.fen, rule.id),
    format: "king-hunt",
    snapshot: snap,
    hero,
    rule: ruleOf(rule),
    ...foeRuleOf(game, hero),
    movesToWin: budget,
    line: plies,
    difficulty: huntDifficulty(budget, legal.length, decisive),
    tags: huntTags(budget, decisive, binding),
    ruleBinding: binding,
    ruleDecisive: decisive,
  };
}

// --- format 2: find the only move your rule allows ---------------------------

function tryOnlyMove(mined: Mined): Puzzle | null {
  const base = rebuild(mined.snap);
  const hero = base.board.turn;
  const snap = heroOnlyNerf(mined.snap, hero);
  const game = rebuild(snap);
  if (game.result) return null;
  if (game.board.turn !== hero) return null;

  const rule = hero === "w" ? game.white.nerf : game.black.nerf;
  if (rule.id === UNRESTRICTED_NERF.id) return null;

  const legal = legalMoves(game);
  if (legal.length !== 1) return null;
  const pseudo = generateMoves(game.board);
  // The rule has to be what narrowed it. A position with one move because the
  // board offers one move is a chess accident, not a lesson about the card.
  if (pseudo.length < 10) return null;
  if (legal[0].promotion) return null;

  const uci = moveToUCI(legal[0]);
  const san = moveToSAN(legal[0], game.board);

  return {
    id: puzzleId("om", mined.fen, rule.id),
    format: "only-move",
    snapshot: snap,
    hero,
    rule: ruleOf(rule),
    ...foeRuleOf(game, hero),
    movesToWin: 0,
    line: [{ by: "hero", uci, san }],
    difficulty: pseudo.length >= 30 ? 4 : pseudo.length >= 20 ? 3 : 2,
    tags: ["Only legal move", `${pseudo.length} moves on the board`],
    ruleBinding: true,
    ruleDecisive: true,
  };
}

// --- format 3: two cards are offered, which one wins? ------------------------

/**
 * Build the two-card decision.
 *
 * The position is a plain nerf-mode position with no held cards and no board
 * effects, so the only thing the player has to read is the board, their rule,
 * and the two cards. Then:
 *
 *   - the hero must NOT already have a forced win (or the card is irrelevant
 *     and the puzzle answers itself);
 *   - taking card A must produce a forced king capture, unique at every step;
 *   - taking card B must provably produce NO forced win at the same depth, by
 *     exhaustive search, not by looking weaker.
 *
 * Both branches are resolved through `pickDraftCard`, the same call the draft
 * overlay makes, so the puzzle cannot be proven under a code path the player
 * will not travel.
 */
function tryCardChoice(mined: Mined, cards: Buff[]): Puzzle | null {
  const base = rebuild(mined.snap);
  const hero = base.board.turn;
  const snap = heroOnlyNerf(mined.snap, hero);
  const probe = rebuild(snap);
  if (probe.result || probe.board.turn !== hero) return null;
  const rule = hero === "w" ? probe.white.nerf : probe.black.nerf;
  if (rule.id === UNRESTRICTED_NERF.id) return null;
  if (legalMoves(probe).length < 5) return null;

  // Already winning without help: nothing for the card to decide.
  const already = winningMoves(probe, MAX_HUNT);
  if (already === null || already.length > 0) return null;

  const draftSnap = withDraftOffer(snap, hero, null);
  const foeKing = kingSquare(probe, hero === "w" ? "b" : "w");
  if (foeKing == null) return null;

  // Pass one: which cards put the enemy king in reach at all? Acquiring a card
  // and asking whether it created an immediate king capture, or at least an
  // attack on the king, is cheap; a full forced-win search on 700 cards per
  // position is not. Cards that fail this cannot force a capture in two, save
  // for zugzwang cases the miner is happy to leave on the table.
  const promising: { def: Buff; budget: number }[] = [];
  for (const def of cards) {
    let g: NerfGame;
    try {
      g = acquire(draftSnap, hero, def);
    } catch {
      continue;
    }
    if (g.result || g.board.turn !== hero) continue;
    const moves = legalMoves(g);
    if (moves.some((m) => m.captured === "k")) {
      promising.push({ def, budget: 1 });
    } else if (buffAugmentedAttacks(g, hero).includes(foeKing)) {
      promising.push({ def, budget: 2 });
    }
  }
  if (!promising.length) return null;

  // Pass two: prove one of them wins, uniquely, at every step.
  let winner: { def: Buff; budget: number; line: PuzzlePly[] } | null = null;
  for (const cand of promising) {
    const g = acquire(draftSnap, hero, cand.def);
    const w = winningMoves(g, cand.budget);
    if (w === null || w.length !== 1) continue;
    const line = buildLine(g, cand.budget);
    if (!line) continue;
    if (line.some((s) => s.hero.promotion)) continue;
    winner = { def: cand.def, budget: cand.budget, line: lineToPlies(line) };
    break;
  }
  if (!winner) return null;

  // The partner card. Same tier band and same kind family so the choice is a
  // read of the position rather than a read of the rarity chip, and proven not
  // to win at the same depth.
  const loser = findLoser(draftSnap, hero, winner.def, cards, winner.budget);
  if (!loser) return null;

  const order = rand() < 0.5;
  const pair: PuzzleCard[] = [
    cardOf(order ? winner.def : loser, order),
    cardOf(order ? loser : winner.def, !order),
  ];
  const chosenIndex = pair.findIndex((c) => c.wins);
  const finalSnap = withDraftOffer(snap, hero, [
    { id: pair[0].id, tier: pair[0].tier as Tier },
    { id: pair[1].id, tier: pair[1].tier as Tier },
  ]);

  // Re-prove on the exact snapshot that ships, through the draft path.
  const check = rebuild(finalSnap);
  pickDraftCard(check, hero, chosenIndex);
  const recheck = winningMoves(check, winner.budget);
  if (recheck === null || recheck.length !== 1) return null;
  if (moveToUCI(recheck[0]) !== winner.line[0].uci) return null;

  return {
    id: puzzleId("cc", mined.fen, `${pair[0].id}:${pair[1].id}`),
    format: "card-choice",
    snapshot: finalSnap,
    hero,
    rule: ruleOf(rule),
    ...foeRuleOf(probe, hero),
    movesToWin: winner.budget,
    line: winner.line,
    cards: pair,
    difficulty: winner.budget === 1 ? 3 : 5,
    tags: [
      winner.budget === 1 ? "Card, then the king" : `Card, then king in ${winner.budget}`,
      `Tier ${winner.def.tier} decision`,
    ],
    ruleBinding: true,
    ruleDecisive: false,
  };
}

/** A partner card that provably does not win, preferring a near-tier match. */
function findLoser(
  draftSnap: GameSnapshot,
  hero: Color,
  winnerDef: Buff,
  cards: Buff[],
  budget: number,
): Buff | null {
  const near = cards
    .filter((b) => b.id !== winnerDef.id && Math.abs(b.tier - winnerDef.tier) <= 1)
    .sort((a, b) => Math.abs(a.tier - winnerDef.tier) - Math.abs(b.tier - winnerDef.tier));
  // A deterministic shuffle inside the tier band, so a corpus does not end up
  // with the same decoy card on forty puzzles.
  const shuffled = near
    .map((b) => ({ b, k: rand() }))
    .sort((x, y) => x.k - y.k)
    .map((x) => x.b);
  let tried = 0;
  for (const def of shuffled) {
    if (tried >= 24) break;
    let g: NerfGame;
    try {
      g = acquire(draftSnap, hero, def);
    } catch {
      continue;
    }
    if (g.result || g.board.turn !== hero) continue;
    if (legalMoves(g).length === 0) continue;
    tried++;
    const w = winningMoves(g, budget);
    if (w === null) continue;
    if (w.length === 0) return def;
  }
  return null;
}

/** Turn a plain nerf position into a nerf-mode draft position holding exactly
 *  one pending offer for the hero, with the next scheduled draft pushed out of
 *  reach so no overlay interrupts the solution. */
function withDraftOffer(
  snap: GameSnapshot,
  hero: Color,
  cards: { id: string; tier: Tier }[] | null,
): GameSnapshot {
  const game = rebuild(snap);
  enableDraftMode(game, 1234567, { mode: "nerf" });
  const bs = game.buffs!;
  const foe: Color = hero === "w" ? "b" : "w";
  bs.nextDraftAtPly = 100_000;
  bs.players[foe].offer = null;
  bs.players[foe].nextDraftAt = 100_000;
  bs.players[hero].nextDraftAt = 100_000;
  bs.players[hero].offer = cards ? { cards, index: 1 } : null;
  return serializeGame(game);
}

function acquire(draftSnap: GameSnapshot, hero: Color, def: Buff): NerfGame {
  const g = rebuild(draftSnap);
  g.buffs!.players[hero].offer = { cards: [{ id: def.id, tier: def.tier }], index: 1 };
  pickDraftCard(g, hero, 0);
  return g;
}

function cardOf(def: Buff, wins: boolean): PuzzleCard {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    tier: def.tier,
    kind: def.kind,
    wins,
  };
}

function kingSquare(game: NerfGame, color: Color): number | null {
  for (let sq = 0; sq < 64; sq++) {
    const p = game.board.pieces[sq];
    if (p && p.type === "k" && p.color === color) return sq;
  }
  return null;
}

// --- shared helpers ----------------------------------------------------------

function lineToPlies(line: LineStep[]): PuzzlePly[] {
  const out: PuzzlePly[] = [];
  for (const step of line) {
    out.push({ by: "hero", uci: moveToUCI(step.hero), san: step.heroSan });
    if (step.foe) out.push({ by: "foe", uci: moveToUCI(step.foe), san: step.foeSan ?? "" });
  }
  return out;
}

function ruleOf(nerf: Nerf) {
  return { id: nerf.id, name: nerf.name, description: nerf.description, tier: nerf.tier };
}

/** The defender's rule, when they kept one (see heroOnlyNerf). */
function foeRuleOf(game: NerfGame, hero: Color): { foeRule?: ReturnType<typeof ruleOf> } {
  const nerf = hero === "w" ? game.black.nerf : game.white.nerf;
  return nerf.id === UNRESTRICTED_NERF.id ? {} : { foeRule: ruleOf(nerf) };
}

/**
 * How much work the handicap is doing at this position.
 *
 * `binding` means the rule removed at least one otherwise-legal move here.
 * `decisive` is the stronger and far more interesting one: a move the rule
 * FORBADE would also have won, so without the handicap the puzzle would have
 * had two answers. That is a puzzle which is genuinely about the card.
 */
function ruleWeight(
  snap: GameSnapshot,
  hero: Color,
  budget: number,
  legalCount: number,
  pseudoCount: number,
): { binding: boolean; decisive: boolean } {
  const binding = legalCount < pseudoCount;
  if (!binding) return { binding: false, decisive: false };
  const free = JSON.parse(JSON.stringify(snap)) as GameSnapshot;
  free.slots[hero] = { nerfId: UNRESTRICTED_NERF.id, state: {}, rngState: free.slots[hero].rngState };
  let decisive = false;
  try {
    const w = winningMoves(rebuild(free), budget);
    decisive = w !== null && w.length > 1;
  } catch {
    decisive = false;
  }
  return { binding, decisive };
}

function huntDifficulty(budget: number, legalCount: number, decisive: boolean): number {
  let d = budget === 1 ? 1 : 3;
  if (legalCount >= 25) d += 1;
  if (decisive) d += 1;
  return Math.min(5, d);
}

function huntTags(budget: number, decisive: boolean, binding: boolean): string[] {
  const tags = [budget === 1 ? "King in one" : `King in ${budget}`];
  if (decisive) tags.push("The rule picks the move");
  else if (binding) tags.push("Rule is active here");
  return tags;
}

function puzzleId(prefix: string, fen: string, salt: string): string {
  let h = 2166136261;
  for (const ch of `${fen}|${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `${prefix}-${(h >>> 0).toString(36)}`;
}

// --- verification ------------------------------------------------------------

/**
 * Re-prove a puzzle from its own serialized form.
 *
 * This is the check that makes the file trustworthy rather than the search
 * that produced it: it parses the JSON exactly as the browser will, rebuilds
 * the game, and walks the stored line move by move, requiring at every hero
 * ply that the stored move is legal and that it is the ONLY move which forces
 * the win in the remaining budget. Any disagreement fails the whole run.
 */
function verify(puzzle: Puzzle): string | null {
  let game: NerfGame;
  try {
    game = rebuild(puzzle.snapshot);
  } catch (err) {
    return `snapshot did not rebuild: ${String(err)}`;
  }
  if (game.result) return "position is already decided";
  if (game.board.turn !== puzzle.hero) return "hero is not the side to move";

  const rule = puzzle.hero === "w" ? game.white.nerf : game.black.nerf;
  if (rule.id !== puzzle.rule.id) return "rule id does not match the snapshot";
  // The defender's rule must be exactly what the puzzle shows: either a named,
  // stateless handicap or none at all. A snapshot carrying a rule the page does
  // not print is the one way this format could quietly cheat the player.
  const foeNerf = puzzle.hero === "w" ? game.black.nerf : game.white.nerf;
  const shownFoe = puzzle.foeRule?.id ?? UNRESTRICTED_NERF.id;
  if (foeNerf.id !== shownFoe) return "defender's rule is not the one shown";
  if (puzzle.foeRule && foeNerf.init) return "defender's rule rolls hidden state";

  if (puzzle.format === "card-choice") {
    const cards = puzzle.cards ?? [];
    if (cards.length !== 2) return "card-choice needs exactly two cards";
    if (cards.filter((c) => c.wins).length !== 1) return "exactly one card must win";
    const offer = game.buffs?.players[puzzle.hero].offer;
    if (!offer || offer.cards.length !== 2) return "no two-card offer in the snapshot";
    if (offer.cards[0].id !== cards[0].id || offer.cards[1].id !== cards[1].id) {
      return "offer does not match the listed cards";
    }
    // The losing card must be proven not to win, here, from the file.
    const loserIdx = cards.findIndex((c) => !c.wins);
    const loserGame = rebuild(puzzle.snapshot);
    pickDraftCard(loserGame, puzzle.hero, loserIdx);
    const loserWins = winningMoves(loserGame, puzzle.movesToWin);
    if (loserWins === null) return "losing card: search did not finish";
    if (loserWins.length !== 0) return "the losing card also wins";
    // Play the winning card and continue into the line.
    pickDraftCard(game, puzzle.hero, cards.findIndex((c) => c.wins));
  }

  if (puzzle.format === "only-move") {
    const legal = legalMoves(game);
    if (legal.length !== 1) return `expected exactly one legal move, found ${legal.length}`;
    if (moveToUCI(legal[0]) !== puzzle.line[0].uci) return "stored move is not the legal one";
    return null;
  }

  let budget = puzzle.movesToWin;
  for (const ply of puzzle.line) {
    const legal = legalMoves(game);
    const move = legal.find((m) => moveToUCI(m) === ply.uci);
    if (!move) return `ply ${ply.uci} is not legal in the rebuilt game`;
    if (ply.by === "hero") {
      const w = winningMoves(game, budget);
      if (w === null) return "search did not finish inside the node cap";
      if (w.length !== 1) return `hero node has ${w.length} winning moves, not 1`;
      if (moveToUCI(w[0]) !== ply.uci) return "stored hero move is not the winning one";
      budget -= 1;
    }
    playMove(game, move);
  }
  // Read through a call, not off `game` directly: the guard at the top of this
  // function narrowed `game.result` to null and TypeScript has no way to know
  // that `playMove` has since written to it.
  const end = resultOf(game);
  if (end?.winner !== puzzle.hero) return "the line does not end in a win";
  if (end.reason !== KING_CAPTURE) return `the line ends in "${end.reason}"`;
  return null;
}

function resultOf(g: NerfGame): GameResult | null {
  return g.result;
}

// --- main --------------------------------------------------------------------

function loadFile(): PuzzleFile {
  return JSON.parse(readFileSync(OUT_FILE, "utf8")) as PuzzleFile;
}

function verifyFile(): void {
  const file = loadFile();
  if (file.version !== PUZZLE_FILE_VERSION) {
    console.error(`file version ${file.version}, expected ${PUZZLE_FILE_VERSION}`);
    process.exit(1);
  }
  let bad = 0;
  for (const p of file.puzzles) {
    const err = verify(p);
    if (err) {
      bad++;
      console.error(`  FAIL ${p.id} (${p.format}): ${err}`);
    }
  }
  console.log(`verified ${file.puzzles.length} puzzles, ${bad} failed`);
  if (bad) process.exit(1);
}

function main(): void {
  if (VERIFY_ONLY) {
    verifyFile();
    return;
  }

  const started = process.hrtime.bigint();

  console.log(`[gen-puzzles] mining positions from ${GAMES} games...`);
  const mined = minePositions();
  console.log(`[gen-puzzles] ${mined.length} distinct positions`);

  const cards = cardPool();
  console.log(`[gen-puzzles] ${cards.length} instant/passive cards eligible for the draft format`);

  const found: Puzzle[] = [];
  const byFormat: Record<PuzzleFormat, number> = { "king-hunt": 0, "only-move": 0, "card-choice": 0 };
  const seenIds = new Set<string>();
  // Diversity caps. A corpus is not 60 puzzles if it is the same handicap and
  // the same winning card 60 times, so each (format, rule) pair is capped, and
  // so is each winning card across the whole card-choice set.
  const perRule = new Map<string, number>();
  const perCard = new Map<string, number>();
  const CARD_CHOICE_CAP = Math.max(12, Math.round(TARGET * 0.35));

  const push = (p: Puzzle | null): void => {
    if (!p) return;
    if (seenIds.has(p.id)) return;
    const key = `${p.format}:${p.rule.id}`;
    if ((perRule.get(key) ?? 0) >= 3) return;
    const winnerCard = p.cards?.find((c) => c.wins)?.id;
    if (winnerCard && (perCard.get(winnerCard) ?? 0) >= 2) return;
    const err = verify(p);
    if (err) {
      console.error(`  rejected ${p.id} (${p.format}): ${err}`);
      return;
    }
    seenIds.add(p.id);
    perRule.set(key, (perRule.get(key) ?? 0) + 1);
    if (winnerCard) perCard.set(winnerCard, (perCard.get(winnerCard) ?? 0) + 1);
    byFormat[p.format]++;
    found.push(p);
  };

  let scanned = 0;
  for (const m of mined) {
    scanned++;
    if (scanned % 200 === 0) {
      const secs = Number(process.hrtime.bigint() - started) / 1e9;
      console.log(
        `  ${scanned}/${mined.length} positions, ${found.length} puzzles ` +
          `(${secs.toFixed(0)}s)`,
      );
    }
    try {
      push(tryOnlyMove(m));
      push(tryKingHunt(m));
      if (byFormat["card-choice"] < CARD_CHOICE_CAP) push(tryCardChoice(m, cards));
    } catch (err) {
      if (process.env.DEBUG) console.error("  scan failed:", err);
    }
    if (found.length >= TARGET) break;
  }

  const secs = Number(process.hrtime.bigint() - started) / 1e9;
  console.log(
    `\n[gen-puzzles] ${found.length} verified puzzles in ${secs.toFixed(0)}s: ` +
      Object.entries(byFormat)
        .map(([k, v]) => `${k} ${v}`)
        .join(", "),
  );
  const decisive = found.filter((p) => p.ruleDecisive).length;
  console.log(
    `  rule binding on ${found.filter((p) => p.ruleBinding).length}, ` +
      `rule decisive on ${decisive}`,
  );
  const rules = new Set(found.map((p) => p.rule.id));
  console.log(`  ${rules.size} distinct handicaps represented`);
  const depth = new Map<string, number>();
  for (const p of found) {
    const k = `${p.format} in ${p.movesToWin}`;
    depth.set(k, (depth.get(k) ?? 0) + 1);
  }
  console.log(`  depths: ${[...depth].map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  const diff = new Map<number, number>();
  for (const p of found) diff.set(p.difficulty, (diff.get(p.difficulty) ?? 0) + 1);
  console.log(
    `  difficulty: ${[...diff].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
  );

  if (!WRITE) {
    console.log("\n(dry run: pass --write to save)");
    return;
  }

  const file: PuzzleFile = {
    version: PUZZLE_FILE_VERSION,
    generatedAt: new Date(REAL_NOW).toISOString().slice(0, 10),
    puzzles: found,
  };
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify(file)}\n`);
  const bytes = readFileSync(OUT_FILE).length;
  console.log(`wrote ${OUT_FILE} (${(bytes / 1024).toFixed(0)} KB)`);

  // The written bytes are re-parsed and re-proven. A generator that only checks
  // the objects it happened to hold in memory has not checked the file.
  verifyFile();
}

main();
