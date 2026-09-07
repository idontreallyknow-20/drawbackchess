// Purity audit for every `augmentMoves` generator in the buff library.
//
//   npx tsx scripts/audit-augment-purity.ts          # table
//   npx tsx scripts/audit-augment-purity.ts --check   # exit 1 if any impure
//
// WHY
//
// A13 makes the bot's search call `augmentMoves` at interior nodes, tens of
// thousands of times per move instead of once. That is only safe if those
// generators are PURE reads of the board: anything that mutates live state, or
// that walks a persistent RNG stream, would desync the client from the server
// and corrupt real games rather than merely mis-score them.
//
// Static review does not scale here (259 augment call sites across ~1M
// characters of card data), so this probes them dynamically: every card that
// defines `augmentMoves` is acquired into a real game, activated if it needs
// activating, and then its hook is called through an instrumented BuffApi that
// records every mutator call and every RNG draw, against a full before/after
// snapshot of the game.
//
// A card is IMPURE if calling `augmentMoves` does any of:
//   - calls a board mutator (place / removePiece / relocate / setPieceType /
//     setPieceColor / restoreCastling / removeMyNerf / adjustClock)
//   - draws from `api.rng`
//   - changes the board, `inst.state`, `bs` (effects, mutations, flags,
//     historyDiverged, rngState), or the captured pools
//   - returns a different move set on a second identical call

import { newGame, enableDraftMode, acquireBuff, activateBuff, makeBuffApi } from "../src/engine/game";
import { moveFromUCI, generateMoves } from "../src/engine/board";
import { playMove } from "../src/engine/game";
import { ALL_BUFFS } from "../src/engine/buffs/library";
import { UNRESTRICTED_NERF } from "../src/engine/game";
import type { Buff, BuffApi, BuffInstance, BuffPick } from "../src/engine/buff";
import type { Move } from "../src/engine/types";

// Several positions, because a generator that produces nothing in the position
// under test has not really been exercised: a write that only happens on the
// productive path (`inst.state.armed = true` when a move was actually granted)
// stays invisible. Probing the start, a developed middlegame and an open
// position with pawns advanced gets most generators to fire at least once, and
// the report says which ones still never did.
const POSITIONS: Record<string, string[]> = {
  start: [],
  middlegame: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "d2d3", "f8c5", "b1c3", "d7d6"],
  open: [
    "e2e4", "e7e5", "d2d4", "e5d4", "d1d4", "b8c6", "d4e3", "g8f6", "b1c3", "f8b4",
    "c1d2", "e8g8", "e1c1", "d7d5", "e4d5", "f6d5", "c3d5", "d8d5", "e3d5", "b4d2",
  ],
};

function build(moves: string[]) {
  const g = newGame(UNRESTRICTED_NERF, UNRESTRICTED_NERF, 7);
  enableDraftMode(g, 7, { mode: "buff" });
  for (const uci of moves) {
    const m = moveFromUCI(g.board, uci);
    if (!m) throw new Error(`opening move rejected: ${uci}`);
    playMove(g, m);
  }
  return g;
}

/** Everything an augmentMoves hook must not change, as a comparable string. */
function snapshot(game: ReturnType<typeof build>, inst: BuffInstance): string {
  const bs = game.buffs!;
  return JSON.stringify({
    pieces: game.board.pieces,
    turn: game.board.turn,
    castling: game.board.castling,
    ep: game.board.epTarget,
    halfmove: game.board.halfmove,
    fullmove: game.board.fullmove,
    historyLen: game.board.history.length,
    instState: inst.state,
    instSpent: inst.spent ?? false,
    instUsed: inst.usedActivation ?? false,
    effects: bs.effects,
    mutations: bs.mutations ?? 0,
    diverged: bs.historyDiverged ?? false,
    rngState: bs.rngState,
    clockFx: bs.clockFx?.length ?? 0,
    extraMoves: bs.extraMoves,
    skips: bs.skips,
    wFlags: bs.players.w.flags,
    bFlags: bs.players.b.flags,
    wBuffs: bs.players.w.buffs,
    bBuffs: bs.players.b.buffs,
    captured: game.captured,
    result: game.result ?? null,
  });
}

const MUTATORS = [
  "place",
  "removePiece",
  "relocate",
  "setPieceType",
  "setPieceColor",
  "restoreCastling",
  "removeMyNerf",
  "adjustClock",
] as const;

type Log = { mutators: string[]; rngDraws: number };

/** Wrap a BuffApi so every mutator call and RNG draw is recorded. Calls are
 *  forwarded, not blocked, so the snapshot below still sees real damage. */
function instrument(api: BuffApi, log: Log): BuffApi {
  const rng = api.rng;
  const rngProxy = new Proxy(rng, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof v === "function" && (k === "next" || k === "int" || k === "pick" || k === "fork")) {
        return (...args: unknown[]) => {
          log.rngDraws++;
          return (v as (...a: unknown[]) => unknown).apply(t, args);
        };
      }
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  return new Proxy(api, {
    get(t, k, r) {
      if (k === "rng") return rngProxy;
      const v = Reflect.get(t, k, r);
      if (typeof k === "string" && (MUTATORS as readonly string[]).includes(k)) {
        return (...args: unknown[]) => {
          log.mutators.push(k);
          return (v as (...a: unknown[]) => unknown)(...args);
        };
      }
      return v;
    },
  }) as BuffApi;
}

/** Drive an activated card's target sequence, picking the first candidate at
 *  each step, so cards whose augment only wakes after activation get probed. */
function tryActivate(game: ReturnType<typeof build>, def: Buff, inst: BuffInstance): string {
  if (def.kind !== "activated") return "n/a";
  const bs = game.buffs!;
  const idx = bs.players.w.buffs.indexOf(inst);
  if (idx < 0) return "not held";
  const picks: BuffPick[] = [];
  for (let step = 0; step < 6; step++) {
    let t;
    try {
      t = def.targets?.(inst, makeBuffApi(game, "w"), picks) ?? null;
    } catch {
      return "targets threw";
    }
    if (!t) break;
    if (t.kind === "square") {
      if (!t.squares.length) return "no candidates";
      picks.push({ square: t.squares[0] });
    } else {
      if (!t.options.length) return "no candidates";
      picks.push({ buffIndex: t.options[0].index });
    }
  }
  try {
    return activateBuff(game, "w", idx, picks) ? "activated" : "refused";
  } catch (e) {
    return `threw: ${(e as Error).message.slice(0, 40)}`;
  }
}

type Row = {
  id: string;
  kind: string;
  activation: string;
  granted: number;
  mutators: string[];
  rngDraws: number;
  stateChanged: boolean;
  unstable: boolean;
  error: string | null;
  /** Positions in which the generator actually produced a move. A generator
   *  that never fired is UNPROVEN, not proven pure. */
  exercised: number;
};

const rows: Row[] = [];
const withAugment = ALL_BUFFS.filter((b) => !!b.augmentMoves);

for (const def of withAugment) {
  const row: Row = {
    id: def.id,
    kind: def.kind,
    activation: "n/a",
    granted: 0,
    mutators: [],
    rngDraws: 0,
    stateChanged: false,
    unstable: false,
    error: null,
    exercised: 0,
  };
  for (const [posName, line] of Object.entries(POSITIONS)) {
    try {
      const game = build(line);
      acquireBuff(game, "w", def.id, def.tier);
      const inst = game.buffs!.players.w.buffs.find((b) => b.id === def.id);
      if (!inst) {
        row.error ??= "not acquired (unimplemented?)";
        continue;
      }
      const act = tryActivate(game, def, inst);
      if (posName === "middlegame") row.activation = act;
      // Activation may pass the turn; put white back on move so the augment
      // sees its own side, which is what legalMoves would do.
      game.board.turn = "w";

      const log: Log = { mutators: [], rngDraws: 0 };
      const api = instrument(makeBuffApi(game, "w"), log);
      const before = snapshot(game, inst);

      const base = generateMoves(game.board);
      const a: Move[] = base.slice();
      def.augmentMoves!(a, inst, api);
      const after = snapshot(game, inst);

      // Second identical call: a pure generator returns the same set.
      const b: Move[] = base.slice();
      def.augmentMoves!(b, inst, instrument(makeBuffApi(game, "w"), { mutators: [], rngDraws: 0 }));

      const key = (m: Move) => `${m.from}-${m.to}-${m.promotion ?? ""}-${m.via ?? ""}-${m.drop ?? ""}`;
      const granted = a.length - base.length;
      if (granted > 0) row.exercised++;
      row.granted = Math.max(row.granted, granted);
      for (const m of log.mutators) if (!row.mutators.includes(m)) row.mutators.push(m);
      row.rngDraws += log.rngDraws;
      row.stateChanged ||= before !== after;
      row.unstable ||= a.length !== b.length || a.map(key).join("|") !== b.map(key).join("|");
    } catch (e) {
      row.error ??= (e as Error).message.slice(0, 60);
    }
  }
  rows.push(row);
}

const impure = (r: Row) => r.mutators.length > 0 || r.rngDraws > 0 || r.stateChanged || r.unstable;

console.log(`augmentMoves purity audit: ${withAugment.length} cards define the hook\n`);

const pad = (s: string, n: number) => s.padEnd(n);
console.log(
  `${pad("card", 26)}${pad("kind", 10)}${pad("activation", 14)}${pad("grant", 7)}` +
    `${pad("fired", 7)}${pad("mutators", 12)}${pad("rng", 5)}${pad("state", 9)}${pad("stable", 8)}verdict`,
);
console.log("-".repeat(110));
for (const r of rows.sort((x, y) => (impure(x) === impure(y) ? x.id.localeCompare(y.id) : impure(x) ? -1 : 1))) {
  console.log(
    pad(r.id, 26) +
      pad(r.kind, 10) +
      pad(r.activation, 14) +
      pad(String(r.granted), 7) +
      pad(`${r.exercised}/${Object.keys(POSITIONS).length}`, 7) +
      pad(r.mutators.join(",") || "none", 12) +
      pad(String(r.rngDraws), 5) +
      pad(r.stateChanged ? "CHANGED" : "clean", 9) +
      pad(r.unstable ? "NO" : "yes", 8) +
      (r.error ? `ERROR ${r.error}` : impure(r) ? "IMPURE" : r.exercised === 0 ? "pure (never fired)" : "pure"),
  );
}

const bad = rows.filter(impure);
const errored = rows.filter((r) => r.error);
const unfired = rows.filter((r) => !impure(r) && r.exercised === 0);
console.log(`\n${rows.length - bad.length}/${rows.length} pure, ${bad.length} impure, ${errored.length} errored`);
console.log(
  `${rows.length - unfired.length}/${rows.length} actually produced a move in at least one probe position; ` +
    `${unfired.length} never fired, so their productive path is UNPROVEN (not proven pure).`,
);
if (bad.length) console.log(`impure: ${bad.map((r) => r.id).join(", ")}`);
if (errored.length) console.log(`errored: ${errored.map((r) => `${r.id} (${r.error})`).join(", ")}`);

if (process.argv.includes("--check") && bad.length) process.exit(1);
