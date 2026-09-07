// Funny set: SUMMONS & REINFORCEMENTS. Most cards grant a piece to your
// crazyhouse-style pocket (grantInventory, a free instant): you draft it now
// and spend a later turn to DROP it, so the summon itself costs no move. The
// rest reuse summonTemp (a rental that expires), lineSweep (a charging piece),
// or a conditional passive modeled on the library's trade_up / insurance
// pattern. The engine's drop generator already refuses to drop a pawn on rank
// 1 or 8, and a king is never bankable.

import { Buff, Mech, Square } from "./shared";
import {
  card,
  summonTemp,
  lineSweep,
  activated,
  emptySquares,
  grantInventory,
  instant,
  mySquares,
  myHalfZone,
  addEffect,
  pawnRankOk,
  KNIGHT_LEAPS,
  ORTHO_DIRS,
  FILE,
  RANK,
  SQ,
  inBoard,
} from "./shared";

/** Cavalry Charge: the ortho line-sweep charge, then a landing shockwave. After
 * the knight lands, every enemy piece (never a king) a knight-leap from the
 * landing square is bonked one square back toward that piece's home rank; a
 * piece that cannot be pushed (edge, blocked, or an illegal pawn square) still
 * takes the impact flash. Pure function of state (fixed leap order, no RNG), so
 * it replays identically on both clients. */
function cavalryCharge(): Mech {
  const base = lineSweep("n", ORTHO_DIRS, 2);
  const charged: Mech = {
    ...base,
    effect: (inst, api, picks) => {
      base.effect?.(inst, api, picks);
      // The charge is a pure function of the board (no dice, no jackpot roll),
      // so there is nothing to reroll on the charge itself: hand the player a
      // draft reroll instead. Smashing the first two enemies stays its ceiling.
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
      const to = picks[1]?.square;
      if (to == null) return;
      const knight = api.board.pieces[to];
      if (!knight || knight.color !== api.me || knight.type !== "n") return;
      const back = api.opp === "w" ? -8 : 8;
      const hit: Square[] = [];
      for (const [df, dr] of KNIGHT_LEAPS) {
        const f = FILE(to) + df, r = RANK(to) + dr;
        if (!inBoard(f, r)) continue;
        const sq = SQ(f, r);
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.opp || p.type === "k") continue;
        const dest = sq + back;
        if (
          dest >= 0 &&
          dest < 64 &&
          !api.board.pieces[dest] &&
          (p.type !== "p" || pawnRankOk(dest))
        ) {
          api.relocate(sq, dest);
          hit.push(dest);
        } else {
          hit.push(sq);
        }
      }
      if (hit.length) addEffect(api, { kind: "bonk", squares: hit, owner: api.me, turns: 1 });
    },
  };
  return charged;
}

export const FUNNY_SUMMONS: Buff[] = [
  card(
    {
      id: "summon_intern",
      icon: "UserPlus",
      name: "Summon Intern",
      description: "The first time your opponent captures one of your pieces, the intern quietly takes over the empty desk: a pawn joins your pocket, to be dropped onto an empty square on a later turn.",
      tier: 2,
      category: "pieces",
      flavor: "They brought their own lanyard.",
      fx: { motif: "rally", pieces: "all", self: true },
    },
    {
      kind: "passive",
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.opp || !move.captured || move.captured === "k") return;
        grantInventory(api, "p", 1);
        inst.spent = true;
      },
      status: () => "intern on standby",
    },
  ),
  card(
    {
      id: "pizza_delivery",
      icon: "Pizza",
      name: "Pizza Delivery",
      description: "The delivery scooter double-parks and the boxes pile up: choose three empty squares; your opponent's pieces cannot move onto them for their next 2 turns.",
      tier: 4,
      category: "tempo",
      flavor: "Thirty minutes or the roadblock is free.",
    },
    activated(
      (_inst, api, picks) =>
        picks.length >= 3
          ? null
          : {
              kind: "square",
              label: `Choose where a pizza stack lands (${picks.length + 1}/3)`,
              squares: emptySquares(api.board).filter(
                (sq) => !picks.some((k) => k.square === sq),
              ),
            },
      (_inst, api, picks) => {
        const squares = picks
          .map((k) => k.square)
          .filter((s): s is Square => s != null);
        if (squares.length) {
          addEffect(api, { kind: "barred", squares, against: api.opp, turns: 2 });
        }
      },
    ),
  ),
  card(
    {
      id: "reinforcements",
      icon: "Users",
      name: "Reinforcements",
      description: "Two pawns march in from the depot right now: place them on empty squares of your back two ranks.",
      tier: 5,
      category: "pieces",
      flavor: "Geronimo. Well, eventually.",
    },
    activated(
      (_inst, api, picks) =>
        picks.length >= 2
          ? null
          : {
              kind: "square",
              label: `Place a reinforcement pawn (${picks.length + 1}/2)`,
              squares: (() => {
                const ranks = api.me === "w" ? [0, 1] : [6, 7];
                return ranks
                  .flatMap((r) => Array.from({ length: 8 }, (_, f) => SQ(f, r)))
                  .filter(
                    (sq) =>
                      !api.board.pieces[sq] &&
                      pawnRankOk(sq) &&
                      !picks.some((k) => k.square === sq),
                  );
              })(),
            },
      (_inst, api, picks) => {
        for (const k of picks) {
          if (k.square != null && !api.board.pieces[k.square] && pawnRankOk(k.square)) {
            api.place(k.square, "p", api.me);
          }
        }
      },
    ),
  ),
  card(
    {
      id: "supply_drop",
      icon: "Package",
      name: "Supply Drop",
      description: "A knight is airlifted into your reserves, and a crate of spares lands with it as a pawn, arriving only after your opponent's next move. Later, spend turns to drop them onto empty squares.",
      tier: 5,
      category: "pieces",
      flavor: "Batteries not included.",
      fx: { motif: "rally", pieces: "all", self: true },
    },
    // Grants a knight (plus a spare pawn) to the crazyhouse-style pocket, but
    // the airlift is delayed: the pocket is filled only after the opponent's
    // next move. Each drop is then a normal turn-consuming move the engine
    // generates.
    {
      kind: "passive",
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.opp) return;
        grantInventory(api, "n", 1);
        grantInventory(api, "p", 1);
        inst.spent = true;
      },
      status: () => "supplies inbound after their next move",
    },
  ),
  card(
    {
      id: "clone_army",
      icon: "CopyPlus",
      name: "Clone Army",
      // Tier 6 (moved up from 5): four pocket pawns is the scaled-up sibling
      // of Second Army (two pawns, tier 4), two clean tiers below it.
      description: "Four photocopier flashes in a row: four new pawns land in your pocket, ready to drop onto empty squares on later turns.",
      tier: 5,
      category: "pieces",
      flavor: "Roll call is going to take a while.",
    },
    instant((_inst, api) => grantInventory(api, "p", 4)),
  ),
  card(
    {
      id: "rent_a_rook",
      icon: "Building2",
      name: "Rent-a-Rook",
      description: "A rook arrives on loan: place it on an empty square in your half. It cannot be captured while on loan, but that loaner protection lapses once it has made two captures, and it drives off after 5 of your turns.",
      tier: 5,
      category: "pieces",
      flavor: "Please return it with a full tank.",
    },
    // The loaner shield now only covers two captures: after the rented rook's
    // second capture its ward is stripped and it can be taken like any piece.
    // Everything else (placement, following, the 5-turn despawn) stays the
    // shared summonTemp behavior.
    (() => {
      const base = summonTemp("r", 5, myHalfZone, { shield: true });
      return {
        ...base,
        onMovePlayed: (inst, move, api) => {
          const sq = inst.state.sq as Square | undefined;
          if (sq != null && move.from === sq && move.color === api.me && move.captured) {
            const caps = ((inst.state.caps as number) ?? 0) + 1;
            inst.state.caps = caps;
            if (caps >= 2) {
              for (const e of api.bs.effects) {
                if (e.kind === "shield" && e.owner === api.me && e.squares) {
                  e.squares = e.squares.filter((s) => s !== sq);
                }
              }
            }
          }
          base.onMovePlayed!(inst, move, api);
        },
      };
    })(),
  ),
  card(
    {
      id: "cavalry_charge",
      icon: "Rabbit",
      name: "Cavalry Charge",
      description: "Charge a knight along a rank or file: it smashes the first two enemy pieces it hits, never kings, then rolls to the far side of them, stopping before the next piece or the edge. Its landing shock shoves every enemy a knight's leap away one square back.",
      tip: "A friendly piece or the enemy king stops the charge, the outcome is fixed, and you also gain a draft reroll.",
      tier: 5,
      category: "attack",
      requires: ["n"],
      flavor: "Sound the bugle.",
    },
    cavalryCharge(),
  ),
  card(
    {
      id: "insurance",
      icon: "Umbrella",
      name: "Insurance",
      description: "The first time your queen is captured, a new knight appears on your queen's starting square (d1 for White, d8 for Black), or on the nearest empty square of that rank if her home is taken. Triggers once.",
      tier: 3,
      category: "pieces",
      flavor: "Read the fine print, they always do.",
      fx: { motif: "ward", pieces: ["q"], self: true },
    },
    {
      kind: "passive",
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.opp || move.captured !== "q") return;
        // Pay out on the home square, or the nearest empty back-rank square if
        // it is taken (ties break toward the a-file, deterministic on every
        // replica).
        const rank = api.me === "w" ? 0 : 7;
        let spot = api.board.pieces[SQ(3, rank)] ? -1 : SQ(3, rank);
        if (spot < 0) {
          let bestD = Infinity;
          for (let f = 0; f < 8; f++) {
            const sq = SQ(f, rank);
            if (api.board.pieces[sq]) continue;
            const d = Math.abs(f - 3);
            if (d < bestD) {
              bestD = d;
              spot = sq;
            }
          }
        }
        if (spot >= 0) api.place(spot, "n", api.me);
        inst.spent = true;
      },
      status: () => "policy active",
    },
  ),
  card(
    {
      id: "blood_pact",
      icon: "Droplets",
      name: "Blood Pact",
      description: "Sign in blood: promote one of your pawns to a queen at once, but another pawn of yours, you choose which, bursts and is lost.",
      tier: 6,
      category: "pieces",
      requires: ["p"],
      flavor: "The wax seal is still warm.",
    },
    // You pick the sacrifice now (it used to burst at random), so the pact
    // never pops a pawn you still needed. With no second pawn there is no
    // second pick and nothing bursts.
    activated(
      (_inst, api, picks) => {
        if (picks.length === 0) {
          return {
            kind: "square",
            label: "Choose the pawn to promote",
            squares: mySquares(api.board, api.me, "p"),
          };
        }
        if (picks.length === 1) {
          const others = mySquares(api.board, api.me, "p").filter(
            (s) => s !== picks[0].square,
          );
          if (!others.length) return null;
          return {
            kind: "square",
            label: "Choose the pawn that bursts",
            squares: others,
          };
        }
        return null;
      },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        api.setPieceType(sq, "q");
        const burst = picks[1]?.square;
        if (burst != null && burst !== sq && api.board.pieces[burst]) {
          api.removePiece(burst);
        }
      },
    ),
  ),
];
