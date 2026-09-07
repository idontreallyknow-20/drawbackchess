// Boon wave 4 (overhaul): 300 new boons for nerf mode's self-relief and
// light-support pool, tiers 38/38/38/38/37/37/37/37. Ids bn4_*.
//
// Composition: roughly a third are category "nerf" relief cards (soften,
// suspend or interact with YOUR OWN nerf via nerf_suspended effects with
// varied durations, triggers and conditions, the boons2/boons3 idiom), and
// two thirds are `boon: true` light general-support cards (small summons,
// tiny revives, one-shot movement gifts, modest shields, scouting, draft
// perks, delayed gifts, gentle cosmetic jokes). Boon-flagged cards also
// appear in buff mode, so their text is mode-agnostic and never mentions
// nerfs; ONLY the category "nerf" cards may talk about your nerf.
//
// Every mechanic rides EXISTING engine rails: ActiveEffect kinds, DraftFlags,
// the BuffApi mutators, augmentMoves / filterOpponentMoves / onMovePlayed,
// the revive pools, the crazyhouse pocket and the clock intent (clock effects
// are deliberately small and rare: time is garnish, never the prize). All
// randomness draws from api.rng inside effect paths only. Kings are never
// removed, frozen or transformed. Tiers 5-8 live in boons4b.ts (imported
// here); library.ts spreads BOON_WAVE4 into ALL_BUFFS.
//
// Import paths are relative (not the "@/" alias): tsconfig.server.json does
// not resolve the alias, and the engine must build for the server tests.

import { isInCheck } from "../board";
import { Buff, BuffApi, BuffInstance, BuffPick, CardFx } from "../buff";
import { Tier } from "../nerf";
import { BoardState, Color, FILE, Move, PieceType, RANK, SQ, Square, inBoard } from "../types";
import {
  ALL_DIRS,
  ORTHO_DIRS,
  activated,
  activatedSimple,
  addEffect,
  addNovel,
  augment,
  emptySquares,
  grantInventory,
  inHalf,
  instant,
  leapMoves,
  markRevived,
  mySquares,
  oppFilter,
  pawnRankOk,
  captureSquare,
  phasingSlideMoves,
  relRank,
  reviveOne,
  revivable,
  relocateMany,
  shieldZone,
  teleportMoves,
  tickTurns,
  timedAugment,
  timedOppFilter,
  turnsLeft,
} from "./helpers";
import {
  advanceablePawns,
  advancePawn,
  attackersOf,
  flashSquares,
  kingSquare,
  pinCosmetic,
  undefendedPieces,
} from "./overhaul/shared";
import { BOON_WAVE4B } from "./boons4b";

// --- Local plumbing ----------------------------------------------------------

type Meta = {
  /** Advice, not a rule (see Buff.tip). */
  tip?: string;
  id: string;
  name: string;
  description: string;
  tier: Tier;
  category: Buff["category"];
  icon?: string;
  flavor?: string;
  fx?: CardFx;
  requires?: PieceType[];
};

type Mech = Partial<Buff> & Pick<Buff, "kind">;

/** Build a wave-4 card. Category "nerf" cards are boons implicitly (isBoon);
 * everything else is stamped `boon: true` so it joins nerf mode's boon pool
 * (and, being mode-agnostic, buff mode's general pool too). */
function card(meta: Meta, mech: Mech): Buff {
  return {
    ...meta,
    ...(meta.category === "nerf" ? {} : { boon: true }),
    implemented: true,
    ...mech,
  };
}

/** Add a nerf_suspended effect for `turns` of `owner`'s turns. */
function susp(api: BuffApi, turns: number, owner?: Color) {
  addEffect(api, { kind: "nerf_suspended", owner: owner ?? api.me, turns });
}

/** Instant: suspend my nerf for `n` turns, with an optional rider. */
function suspendNow(n: number, rider?: (api: BuffApi) => void): Mech {
  return instant((_inst, api) => {
    susp(api, n);
    rider?.(api);
  });
}

/** Free action: suspend my nerf for `n` turns at the moment of my choosing. */
function suspendFree(n: number, rider?: (api: BuffApi) => void): Mech {
  return {
    ...activatedSimple((_inst, api) => {
      susp(api, n);
      rider?.(api);
    }),
    freeAction: true,
  };
}

/** Charge-limited triggered relief: when `when` fires, suspend for `turns`. */
function reliefOn(
  charges: number,
  turns: number,
  when: (move: Move, api: BuffApi) => boolean,
  noun: string,
): Mech {
  return {
    kind: "passive",
    init: (inst) => {
      inst.state.charges = charges;
    },
    onMovePlayed: (inst, move, api) => {
      const left = (inst.state.charges as number) ?? 0;
      if (left <= 0 || !when(move, api)) return;
      susp(api, turns);
      inst.state.charges = left - 1;
      if (left - 1 <= 0) inst.spent = true;
    },
    status: (inst) => `${(inst.state.charges as number) ?? charges} ${noun} left`,
  };
}

/** Unlimited triggered relief: every time `when` fires, suspend for `turns`. */
function reliefEvery(
  turns: number,
  when: (move: Move, api: BuffApi) => boolean,
  note: string,
): Mech {
  return {
    kind: "passive",
    onMovePlayed: (_inst, move, api) => {
      if (when(move, api)) susp(api, turns);
    },
    status: () => note,
  };
}

/** Conditional continuous relief: after each opponent move, if `cond` holds,
 * refresh a `turns`-turn suspension (the underdogs_grit idiom). */
function reliefWhile(cond: (api: BuffApi) => boolean, note: string, turns = 1): Mech {
  return {
    kind: "passive",
    init: (_inst, api) => {
      if (cond(api)) susp(api, turns);
    },
    onMovePlayed: (_inst, move, api) => {
      if (move.color !== api.opp || !cond(api)) return;
      susp(api, turns);
    },
    status: () => note,
  };
}

/** Like reliefWhile, but when `cond` lapses the trailing (final) turn keeps the
 * suspension for one more turn as a movement-only grace: a short_leash rides
 * alongside it (you may move only one square at a time). Added on the
 * opponent's move, neither timer is self-ticked, so turns:1 covers exactly
 * that one final turn. */
function reliefWhileGrace(cond: (api: BuffApi) => boolean, note: string, turns = 1): Mech {
  return {
    kind: "passive",
    init: (inst, api) => {
      const on = cond(api);
      if (on) susp(api, turns);
      inst.state.relieved = on;
    },
    onMovePlayed: (inst, move, api) => {
      if (move.color !== api.opp) return;
      const on = cond(api);
      if (on) {
        susp(api, turns);
      } else if (inst.state.relieved) {
        susp(api, 1);
        addEffect(api, { kind: "short_leash", owner: api.me, turns: 1 });
      }
      inst.state.relieved = on;
    },
    status: () => note,
  };
}

/** Delayed relief: after `delay` of my turns, suspend for `grant` turns. */
function reliefAfter(delay: number, grant: number): Mech {
  return {
    kind: "passive",
    init: (inst) => {
      inst.state.turns = delay;
    },
    onMovePlayed: (inst, move, api) => {
      if (inst.spent || move.color !== api.me) return;
      const t = ((inst.state.turns as number) ?? delay) - 1;
      inst.state.turns = t;
      if (t <= 0) {
        susp(api, grant);
        inst.spent = true;
      }
    },
    status: (inst) => `${(inst.state.turns as number) ?? delay} of your turns until relief`,
  };
}

/** Activated: shield one of my non-king pieces for `turns` (null = forever). */
function shieldOne(turns: number | null, label: string): Mech {
  return activated(
    (_inst, api, picks) =>
      picks.length > 0
        ? null
        : {
            kind: "square",
            label,
            squares: mySquares(api.board, api.me).filter(
              (sq) => api.board.pieces[sq]!.type !== "k",
            ),
          },
    (_inst, api, picks) => {
      const sq = picks[0]?.square;
      if (sq == null) return;
      const p = api.board.pieces[sq];
      if (!p || p.color !== api.me || p.type === "k") return;
      addEffect(api, { kind: "shield", owner: api.me, squares: [sq], turns });
    },
  );
}

/** Squares adjacent to `sq` (chebyshev distance 1). */
function adjSquares(sq: Square): Square[] {
  const out: Square[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const f = FILE(sq) + df, r = RANK(sq) + dr;
      if (inBoard(f, r)) out.push(SQ(f, r));
    }
  }
  return out;
}

/** Non-king piece count for `color`. */
function armySize(board: BoardState, color: Color): number {
  let n = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = board.pieces[sq];
    if (p && p.color === color && p.type !== "k") n++;
  }
  return n;
}

/** First empty square scanning outward from `color`'s home rank (the shared
 * boons2/boons3 auto-placement scan; deterministic pure board read). */
function autoPlace(api: BuffApi, color: Color, type: PieceType): Square | null {
  for (let i = 0; i < 8; i++) {
    const r = color === "w" ? i : 7 - i;
    for (let f = 0; f < 8; f++) {
      const sq = SQ(f, r);
      if (api.board.pieces[sq]) continue;
      if (type === "p" && !pawnRankOk(sq)) continue;
      return sq;
    }
  }
  return null;
}

/** Remove every freeze/walnut binding MY pieces (optionally one square). */
function thawMine(api: BuffApi, sq?: Square) {
  const fx = api.bs.effects;
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i];
    if ((e.kind === "freeze" || e.kind === "walnut") && e.owner === api.me) {
      if (sq == null || e.sq === sq) fx.splice(i, 1);
    }
  }
}

/** My currently frozen (or walnutted) squares. */
function frozenMine(api: BuffApi): Square[] {
  const out: Square[] = [];
  for (const e of api.bs.effects) {
    if ((e.kind === "freeze" || e.kind === "walnut") && e.owner === api.me && e.turns > 0) {
      if (!out.includes(e.sq)) out.push(e.sq);
    }
  }
  return out;
}

/** A castling move (the king's two-file slide). */
function isCastle(m: Move): boolean {
  return m.piece === "k" && Math.abs(FILE(m.to) - FILE(m.from)) === 2;
}

/** The last move the opponent completed (pure history read). */
function lastOppMove(api: BuffApi): Move | null {
  const hist = api.board.history;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].color === api.opp) return hist[i];
  }
  return null;
}

/** Never strand the opponent with zero legal moves. */
function nonEmpty(kept: Move[], all: Move[]): Move[] {
  return kept.length > 0 ? kept : all;
}

/** Rank index of `color`'s Nth rank from its own side (0 = back rank). */
function ownRank(color: Color, n: number): number {
  return color === "w" ? n : 7 - n;
}

const myHalf = (api: BuffApi) => (sq: Square) => inHalf(api.me, sq);

// ---------------------------------------------------------------------------
// Tiers 1-4 (152 cards). Tiers 5-8 live in boons4b.ts.
// ---------------------------------------------------------------------------

const BOON_WAVE4A: Buff[] = [
  // ===== TIER 1 ==============================================================
  // --- relief (13) ---

  card(
    { id: "bn4_morning_stretch", name: "Morning Stretch", tier: 1, category: "nerf", icon: "Sunrise",
      description: "Suspend your nerf for your next turn, and gain 1 draft reroll.",
      flavor: "Crack the knuckles. Reconsider everything." },
    suspendNow(1, (api) => {
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
    }),
  ),
  card(
    { id: "bn4_first_light", name: "First Light", tier: 1, category: "nerf", icon: "Sun",
      description: "The first capture you make suspends your nerf for your next turn.",
      flavor: "One clean cut and the morning opens." },
    reliefOn(1, 1, (m, api) => m.color === api.me && !!m.captured && m.captured !== "k", "dawn"),
  ),
  card(
    { id: "bn4_kind_omen", name: "Kind Omen", tier: 1, category: "nerf", icon: "Bird",
      description: "The first time your opponent captures one of your pieces, your nerf is suspended for your next 2 turns. If that has not happened by your twelfth turn, the unused charge becomes 1 draft reroll instead.",
      flavor: "The sparrow watched the whole thing and disagreed.", fx: { motif: "rally", pieces: "all", self: true } },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 1;
        inst.state.myTurns = 0;
      },
      onMovePlayed: (inst, move, api) => {
        const left = (inst.state.charges as number) ?? 0;
        if (left <= 0) return;
        if (move.color === api.opp && !!move.captured && move.captured !== "k") {
          susp(api, 2);
          inst.state.charges = left - 1;
          inst.spent = true;
          return;
        }
        if (move.color === api.me) {
          const t = ((inst.state.myTurns as number) ?? 0) + 1;
          inst.state.myTurns = t;
          if (t >= 12) {
            api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
            inst.state.charges = left - 1;
            inst.spent = true;
          }
        }
      },
      status: (inst) => `${(inst.state.charges as number) ?? 1} omens left`,
    },
  ),
  card(
    { id: "bn4_pawns_lullaby", name: "Pawn's Lullaby", tier: 2, category: "nerf", icon: "Music",
      description: "The next 2 times you move a pawn, your nerf is suspended for your next turn.",
      flavor: "Small steps, soft song.", requires: ["p"] },
    reliefOn(2, 1, (m, api) => m.color === api.me && m.piece === "p", "verses"),
  ),
  card(
    { id: "bn4_castle_quiet", name: "Castle Quiet", tier: 1, category: "nerf", icon: "Castle",
      description: "When you castle, your nerf is suspended for your next 2 turns.",
      flavor: "Thick walls. Thicker silence." },
    reliefOn(1, 2, (m, api) => m.color === api.me && isCastle(m), "castlings"),
  ),
  card(
    { id: "bn4_two_breaths", name: "Two Breaths", tier: 1, category: "nerf", icon: "Wind",
      description: "Suspend your nerf for your next turn, and again for one more turn after your next 3 turns. On that final turn you may move only one square at a time.",
      flavor: "In. Out. Later: in again." },
    {
      kind: "passive",
      init: (inst, api) => {
        susp(api, 1);
        inst.state.turns = 3;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.me) return;
        const t = ((inst.state.turns as number) ?? 3) - 1;
        inst.state.turns = t;
        if (t <= 0) {
          // The final breath applies only to movement restrictions: the nerf is
          // suspended AND a one-square leash rides that turn. Both are added on
          // your own move, so the same-move tick eats one from each: ask for 2
          // to leave 1, so the suspension and the leash cover the same one turn.
          susp(api, 2);
          addEffect(api, { kind: "short_leash", owner: api.me, turns: 2 });
          inst.spent = true;
        }
      },
      status: (inst) => `${(inst.state.turns as number) ?? 3} turns to the second breath`,
    },
  ),
  card(
    { id: "bn4_quiet_after", name: "The Quiet After", tier: 1, category: "nerf", icon: "CloudRain",
      description: "While your queen is off the board, your nerf is suspended, but the relief applies only to movement restrictions: you may move only one square at a time.",
      flavor: "Grief keeps its own kind of order." },
    {
      // Each turn the queen is gone grants a one-turn suspension whose relief is
      // movement-only: a one-square leash rides alongside it. A leash added on
      // the opponent's move is not self-ticked, so turns:1 covers exactly your
      // following turn, matching the suspension's own timing.
      kind: "passive",
      init: (_inst, api) => {
        if (mySquares(api.board, api.me, "q").length === 0) {
          susp(api, 1);
          addEffect(api, { kind: "short_leash", owner: api.me, turns: 1 });
        }
      },
      onMovePlayed: (_inst, move, api) => {
        if (move.color !== api.opp || mySquares(api.board, api.me, "q").length !== 0) return;
        susp(api, 1);
        addEffect(api, { kind: "short_leash", owner: api.me, turns: 1 });
      },
      status: () => "waiting on the quiet",
    },
  ),
  card(
    { id: "bn4_third_wind", name: "Third Wind", tier: 2, category: "nerf", icon: "Hourglass",
      description: "After your next 6 turns, your nerf is suspended for the 3 turns that follow.",
      flavor: "Not the second wind. The one after, that nobody trains for." },
    reliefAfter(6, 3),
  ),
  card(
    { id: "bn4_small_ritual", name: "Small Ritual", tier: 1, category: "nerf", icon: "Flame",
      description: "The next 3 times you move your king, your nerf is suspended for one of your turns, beginning after your opponent's following move.",
      flavor: "One step, one candle." },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 3;
        inst.state.pending = 0;
      },
      onMovePlayed: (inst, move, api) => {
        // A suspension armed by an earlier king move begins now, after this reply.
        if (move.color === api.opp && ((inst.state.pending as number) ?? 0) > 0) {
          inst.state.pending = (inst.state.pending as number) - 1;
          susp(api, 1);
        }
        // Moving the king arms a suspension that begins after the next reply.
        const left = (inst.state.charges as number) ?? 0;
        if (left > 0 && move.color === api.me && move.piece === "k") {
          inst.state.pending = ((inst.state.pending as number) ?? 0) + 1;
          inst.state.charges = left - 1;
        }
        if (((inst.state.charges as number) ?? 0) <= 0 && ((inst.state.pending as number) ?? 0) <= 0) {
          inst.spent = true;
        }
      },
      status: (inst) => `${(inst.state.charges as number) ?? 3} rites left`,
    },
  ),
  card(
    { id: "bn4_grace_note", name: "Grace Note", tier: 1, category: "nerf", icon: "Feather",
      description: "Free action: suspend your nerf for your next turn, gain 1 draft reroll, and learn the tier of your opponent's next draft offer, used at the moment you choose.",
      flavor: "A tiny ornament, played exactly on time." },
    suspendFree(1, (api) => {
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
      api.mine.flags.seeOppTier = true;
    }),
  ),
  card(
    { id: "bn4_shared_silence", name: "Shared Silence", tier: 1, category: "nerf", icon: "Handshake",
      description: "After your opponent's next move, both players' nerfs are suspended for their following turn.",
      flavor: "Neither of you mentions it. It is nicer that way." },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.delay = 1;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.opp) return;
        const d = (inst.state.delay as number) ?? 1;
        inst.state.delay = d - 1;
        if (d - 1 <= 0) {
          // Suspend both, beginning after this reply. The opponent's own timer
          // ticks on their moves, so it needs turns:2 to survive this one and
          // still cover their following turn (yours is not ticked here).
          susp(api, 1);
          susp(api, 2, api.opp);
          inst.spent = true;
        }
      },
      status: (inst) => (inst.spent ? null : "silence begins after their reply"),
    },
  ),
  card(
    { id: "bn4_check_valve", name: "Check Valve", tier: 1, category: "nerf", icon: "ShieldAlert",
      description: "The next 2 times your king is put in check, your nerf is suspended for one of your turns, beginning after your opponent's following move.",
      flavor: "Pressure goes in. Pressure comes right back out." },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 2;
      },
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.opp) return;
        // A suspension armed on an earlier check begins now, after this reply.
        if (inst.state.pending) {
          inst.state.pending = false;
          susp(api, 1);
        }
        // A fresh check arms a suspension that begins after the NEXT reply.
        const left = (inst.state.charges as number) ?? 0;
        if (left > 0 && isInCheck(api.board, api.me)) {
          inst.state.pending = true;
          inst.state.charges = left - 1;
        }
        if (((inst.state.charges as number) ?? 0) <= 0 && !inst.state.pending) {
          inst.spent = true;
        }
      },
      status: (inst) => `${(inst.state.charges as number) ?? 2} valves left`,
    },
  ),
  card(
    { id: "bn4_promise_of_rest", name: "Promise of Rest", tier: 1, category: "nerf", icon: "Tent",
      description: "The first time one of your pieces crosses into your opponent's half, your nerf is suspended for your next 2 turns and you gain 1 draft reroll.",
      flavor: "March far enough and the load lightens." },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 1;
      },
      onMovePlayed: (inst, move, api) => {
        const left = (inst.state.charges as number) ?? 0;
        if (left <= 0) return;
        if (!(move.color === api.me && inHalf(api.me, move.from) && !inHalf(api.me, move.to))) return;
        susp(api, 2);
        api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
        inst.state.charges = left - 1;
        if (left - 1 <= 0) inst.spent = true;
      },
      status: (inst) => `${(inst.state.charges as number) ?? 1} promises left`,
    },
  ),

  // --- movement (5) ---

  card(
    { id: "bn4_side_shuffle", name: "Side Shuffle", tier: 1, category: "movement", icon: "MoveHorizontal",
      description: "Once, one of your pawns may step one square sideways onto an empty square. The square it lands on lights up until your opponent replies.",
      flavor: "Technically forward, spiritually.", requires: ["p"],
      fx: { motif: "empower", pieces: ["p"], self: true } },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 1;
      },
      augmentMoves: (moves, inst, api) => {
        if (((inst.state.charges as number) ?? 0) <= 0) return;
        const out: Move[] = [];
        for (const from of mySquares(api.board, api.me, "p")) {
          for (const df of [-1, 1]) {
            const f = FILE(from) + df;
            if (!inBoard(f, RANK(from))) continue;
            const to = SQ(f, RANK(from));
            if (!api.board.pieces[to]) out.push(...teleportMoves(api.board, from, [to], inst.id));
          }
        }
        addNovel(moves, out);
      },
      onMovePlayed: (inst, move, api) => {
        if (move.via !== inst.id || !move.color) return;
        // Telegraph the landing square: it stays lit until the opponent replies.
        flashSquares(api, [move.to]);
        const charges = ((inst.state.charges as number) ?? 1) - 1;
        inst.state.charges = charges;
        if (charges <= 0) inst.spent = true;
      },
      status: () => null,
    },
  ),
  card(
    { id: "bn4_tiptoe", name: "Tiptoe", tier: 1, category: "movement", icon: "Footprints",
      description: "Once, your king may move two squares in a straight line, if both squares are empty.",
      flavor: "Shh. He is being stealthy. Everyone can see him.",
      fx: { motif: "empower", pieces: ["k"], self: true } },
    augment((_moves, inst, api) => {
      const ks = kingSquare(api.board, api.me);
      if (ks == null) return [];
      const out: Move[] = [];
      for (const [df, dr] of ALL_DIRS) {
        const f1 = FILE(ks) + df, r1 = RANK(ks) + dr;
        const f2 = FILE(ks) + 2 * df, r2 = RANK(ks) + 2 * dr;
        if (!inBoard(f1, r1) || !inBoard(f2, r2)) continue;
        if (api.board.pieces[SQ(f1, r1)] || api.board.pieces[SQ(f2, r2)]) continue;
        out.push(...teleportMoves(api.board, ks, [SQ(f2, r2)], inst.id));
      }
      return out;
    }, 1),
  ),
  card(
    { id: "bn4_half_step_back", name: "Half Step Back", tier: 2, category: "movement", icon: "Undo2",
      description: "Once, one of your pawns may retreat one square straight back onto an empty square (never onto your back rank).",
      flavor: "Retreat is just an advance that respects itself.", requires: ["p"],
      fx: { motif: "empower", pieces: ["p"], self: true } },
    augment((_moves, inst, api) => {
      const back = api.me === "w" ? -1 : 1;
      const out: Move[] = [];
      for (const from of mySquares(api.board, api.me, "p")) {
        const r = RANK(from) + back;
        if (!inBoard(FILE(from), r)) continue;
        const to = SQ(FILE(from), r);
        if (!api.board.pieces[to] && pawnRankOk(to)) {
          out.push(...teleportMoves(api.board, from, [to], inst.id));
        }
      }
      return out;
    }, 1),
  ),
  card(
    { id: "bn4_knights_errand", name: "Knight's Errand", tier: 1, category: "movement", icon: "Compass",
      description: "Once, one of your knights may move a single square in any direction (capturing allowed).",
      flavor: "Even the cavalry runs small errands.", requires: ["n"],
      fx: { motif: "empower", pieces: ["n"], moveAs: "k", self: true } },
    augment((_moves, inst, api) => {
      const out: Move[] = [];
      for (const from of mySquares(api.board, api.me, "n")) {
        out.push(...leapMoves(api.board, from, ALL_DIRS, inst.id));
      }
      return out;
    }, 1),
  ),
  card(
    { id: "bn4_bishops_stroll", name: "Bishop's Stroll", tier: 1, category: "movement", icon: "Church",
      description: "Once, one of your bishops may step a single square straight up, down, left or right (capturing allowed), changing the color of its world forever.",
      flavor: "The other diagonal, at last.", requires: ["b"],
      fx: { motif: "empower", pieces: ["b"], moveAs: "k", self: true } },
    augment((_moves, inst, api) => {
      const out: Move[] = [];
      for (const from of mySquares(api.board, api.me, "b")) {
        out.push(...leapMoves(api.board, from, ORTHO_DIRS, inst.id));
      }
      return out;
    }, 1),
  ),

  // --- pieces (5) ---

  card(
    { id: "bn4_spare_button", name: "Spare Button", tier: 2, category: "pieces", icon: "CircleDot",
      description: "A pawn slips into your pocket, ready to be dropped onto an empty square on a later turn (the drop spends that turn).",
      flavor: "Every good coat keeps one." },
    instant((_inst, api) => grantInventory(api, "p", 1)),
  ),
  card(
    { id: "bn4_field_stitches", name: "Field Stitches", tier: 2, category: "pieces", icon: "Slice",
      description: "Return one of your captured pawns to an empty square on your second rank.",
      flavor: "Not pretty. Holds." },
    reviveOne(["p"], (api) => (sq) => RANK(sq) === ownRank(api.me, 1)),
  ),
  card(
    { id: "bn4_day_laborer", name: "Day Laborer", tier: 2, category: "pieces", icon: "Hammer",
      description: "Place a pawn on an empty square in your half. It works 5 of your turns, then leaves the board.",
      flavor: "Paid by the hour, gone by dusk." },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose where the laborer stands",
              squares: emptySquares(api.board, (sq) => inHalf(api.me, sq) && pawnRankOk(sq)),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null || api.board.pieces[sq] || !pawnRankOk(sq)) return;
        api.place(sq, "p", api.me);
        addEffect(api, { kind: "timed_loss", owner: api.me, sq, turns: 5, then: "remove" });
      },
    ),
  ),
  card(
    { id: "bn4_understudy", name: "Understudy", tier: 2, category: "pieces", icon: "Drama",
      description: "The first time one of your pawns is captured, a fresh pawn joins your pocket, ready to drop on a later turn.",
      flavor: "Someone always knows the lines.", requires: ["p"], fx: { motif: "ward", pieces: ["p"], self: true } },
    {
      kind: "passive",
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.opp || move.captured !== "p") return;
        grantInventory(api, "p", 1);
        inst.spent = true;
      },
      status: () => "waiting in the wings",
    },
  ),
  card(
    { id: "bn4_parade_polish", name: "Parade Polish", tier: 2, category: "pieces", icon: "Sparkles",
      description: "Gild one of your pieces (your king excepted): it wears the shine for the rest of the game and cannot be captured on your opponent's next turn.",
      flavor: "Morale is 90 percent lacquer." },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the piece to polish",
              squares: mySquares(api.board, api.me).filter(
                (sq) => api.board.pieces[sq]!.type !== "k",
              ),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.me || p.type === "k") return;
        pinCosmetic(api, sq, api.me, "gilded");
        addEffect(api, { kind: "shield", owner: api.me, squares: [sq], turns: 1 });
      },
    ),
  ),

  // --- protection (5) ---

  card(
    { id: "bn4_pocket_shield", name: "Pocket Shield", tier: 2, category: "protection", icon: "Shield",
      description: "One of your pieces (your king excepted) cannot be captured for your opponent's next 2 turns.",
      flavor: "Fits in one hand. Stops one disaster." },
    shieldOne(2, "Choose the piece to shield"),
  ),
  card(
    { id: "bn4_pawn_umbrella", name: "Pawn Umbrella", tier: 1, category: "protection", icon: "Umbrella",
      description: "After your opponent's next move, none of your pawns can be captured on their following turn.",
      flavor: "Light drizzle of bishops expected.", requires: ["p"],
      fx: { motif: "ward", pieces: ["p"], self: true } },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.delay = 1;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.opp) return;
        const d = (inst.state.delay as number) ?? 1;
        if (d > 0) {
          inst.state.delay = d - 1;
          if (d - 1 <= 0) {
            const pawns = mySquares(api.board, api.me, "p");
            if (pawns.length) {
              addEffect(api, { kind: "shield", owner: api.me, squares: pawns, turns: 1 });
            }
            inst.spent = true;
          }
        }
      },
      status: (inst) => (inst.spent ? null : "shield begins after their next move"),
    },
  ),
  card(
    { id: "bn4_doorstop", name: "Doorstop", tier: 1, category: "protection", icon: "DoorClosed",
      description: "Choose an empty square beside your king: no enemy piece may move onto it for 3 turns. When placed, every enemy piece (their king excepted) standing next to that square is stuck for your opponent's next turn.",
      flavor: "The humblest guard in the castle." },
    activated(
      (_inst, api, picks) => {
        if (picks.length > 0) return null;
        const ks = kingSquare(api.board, api.me);
        return {
          kind: "square",
          label: "Choose the doorway to block",
          squares: ks == null ? [] : adjSquares(ks).filter((s) => !api.board.pieces[s]),
        };
      },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null || api.board.pieces[sq]) return;
        addEffect(api, { kind: "barred", squares: [sq], against: api.opp, turns: 3 });
        // First trigger only: the marked square also jams the enemy pieces
        // beside it for the opponent's next turn.
        for (const adj of adjSquares(sq)) {
          const p = api.board.pieces[adj];
          if (p && p.color === api.opp && p.type !== "k") {
            addEffect(api, { kind: "freeze", sq: adj, owner: api.opp, turns: 1, skin: "glue" });
          }
        }
      },
    ),
  ),
  card(
    { id: "bn4_night_watch", name: "Night Watch", tier: 1, category: "protection", icon: "Moon",
      description: "Your king cannot be captured on your opponent's next turn.",
      flavor: "One lantern, one spear, one very long night.",
      fx: { motif: "ward", pieces: ["k"], self: true } },
    instant((_inst, api) => addEffect(api, { kind: "king_safe", owner: api.me, turns: 1 })),
  ),
  card(
    { id: "bn4_garden_fence", name: "Garden Fence", tier: 1, category: "protection", icon: "Fence",
      description: "After your opponent's next move, for their following 2 turns they cannot capture your pawns standing in your half of the board.",
      flavor: "Keep off the cabbages.", requires: ["p"],
      fx: { motif: "ward", pieces: ["p"], self: true } },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.delay = 1;
        inst.state.turns = 2;
      },
      filterOpponentMoves: (moves, inst, api) => {
        if (((inst.state.delay as number) ?? 0) > 0) return moves;
        if (turnsLeft(inst) <= 0) return moves;
        const filtered = moves.filter((m) => {
          const cs = captureSquare(m);
          if (cs == null) return true;
          const p = api.board.pieces[cs];
          return !(p && p.color === api.me && p.type === "p" && inHalf(api.me, cs));
        });
        return filtered.length > 0 ? filtered : moves;
      },
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.opp) return;
        if (((inst.state.delay as number) ?? 0) > 0) {
          inst.state.delay = (inst.state.delay as number) - 1;
          return;
        }
        tickTurns(inst, move, api.opp);
      },
      status: (inst) =>
        ((inst.state.delay as number) ?? 0) > 0
          ? "arming"
          : `${turnsLeft(inst)} of their turns left`,
    },
  ),

  // --- tempo (4) ---

  card(
    { id: "bn4_pinch_of_sand", name: "Pinch of Sand", tier: 1, category: "tempo", icon: "Timer",
      description: "Add 15 seconds to your clock and gain 2 draft rerolls. In untimed games only the rerolls arrive.",
      flavor: "Borrowed from the top half of the hourglass." },
    instant((_inst, api) => {
      api.adjustClock({ addSelfSec: 15 });
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 2;
    }),
  ),
  card(
    { id: "bn4_muddy_boots", name: "Muddy Boots", tier: 1, category: "tempo", icon: "CloudDrizzle",
      description: "Your opponent's pawns cannot advance on their next turn, and every one of their pawns lights up until they reply.",
      flavor: "It rained on exactly half the board.",
      fx: { motif: "slow", pieces: ["p"] } },
    instant((_inst, api) => {
      addEffect(api, { kind: "no_pawn_advance", against: api.opp, turns: 1 });
      flashSquares(api, mySquares(api.board, api.opp, "p"));
    }),
  ),
  card(
    { id: "bn4_shoelace_knot", name: "Shoelace Knot", tier: 1, category: "tempo", icon: "Link",
      description: "Tie one enemy pawn's laces together: it cannot move on your opponent's next turn.",
      flavor: "The oldest trick, still undefeated." },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the enemy pawn to hobble",
              squares: mySquares(api.board, api.opp, "p"),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.opp || p.type !== "p") return;
        addEffect(api, { kind: "freeze", sq, owner: api.opp, turns: 1, skin: "glue" });
      },
    ),
  ),
  card(
    { id: "bn4_stutter_step", name: "Stutter Step", tier: 1, category: "tempo", icon: "Repeat",
      description: "On your opponent's next turn, they cannot move the piece they just moved.",
      flavor: "Lost the rhythm. Never had it, arguably.",
      fx: { motif: "slow", pieces: "all" } },
    timedOppFilter(1, (moves, _inst, api) => {
      const last = lastOppMove(api);
      if (!last) return moves;
      return moves.filter((m) => m.from !== last.to);
    }),
  ),

  // --- info (2) ---

  card(
    // Balance buff 2026-08-04: the old version PUNISHED you for playing it,
    // stripping your own shields off every lit piece; a boon should never cost
    // more than it gives. The survey now patches the worst gap it finds.
    { id: "bn4_hairline_crack", name: "Hairline Crack", tier: 1, category: "info", icon: "SearchCheck",
      description: "Every one of your pieces that no other piece of yours defends lights up until your opponent replies, and the loose stone nearest your king is mortared: it cannot be captured on your opponent's next turn.",
      flavor: "Know where you are thin before someone else does." },
    instant((_inst, api) => {
      const marked = undefendedPieces(api.board, api.me);
      flashSquares(api, marked);
      const ks = kingSquare(api.board, api.me);
      if (ks == null) return;
      // Nearest lit piece to the king (the king itself is the keep, not a
      // loose stone); Chebyshev distance, lowest square index breaking ties.
      const stones = marked.filter((sq) => sq !== ks);
      if (stones.length === 0) return;
      const dist = (sq: Square) =>
        Math.max(Math.abs(FILE(sq) - FILE(ks)), Math.abs(RANK(sq) - RANK(ks)));
      let brace = stones[0];
      for (const sq of stones) if (dist(sq) < dist(brace)) brace = sq;
      addEffect(api, { kind: "shield", owner: api.me, squares: [brace], turns: 1 });
    }),
  ),
  card(
    { id: "bn4_watchmans_lantern", name: "Watchman's Lantern", tier: 1, category: "info", icon: "Lamp",
      description: "Every enemy piece currently aiming at your king lights up until your opponent replies, and you gain 1 draft reroll.",
      flavor: "The light does not stop them. It does spoil the surprise." },
    instant((_inst, api) => {
      const ks = kingSquare(api.board, api.me);
      if (ks != null) flashSquares(api, attackersOf(api.board, api.opp, ks));
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
    }),
  ),

  // --- draft (2) ---

  card(
    // Balance buff 2026-08-04: a reroll that could be repossessed was worse
    // than Watchman's Lantern's plain one in the same tier. The coin now
    // rewards spending instead of punishing holding: use a reroll within the
    // window and it flips back into your hand.
    { id: "bn4_lucky_coin", name: "Lucky Coin", tier: 1, category: "draft", icon: "Coins",
      description: "Gain 1 draft reroll. Spend a reroll within your next two draft offers and the coin lands heads: you gain that reroll back.",
      flavor: "Heads you reroll, tails you reroll." },
    {
      kind: "passive",
      init: (inst, api) => {
        api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
        inst.state.baseline = api.mine.rerollsLeft;
        inst.state.draftsAtGrant = api.mine.draftsTaken;
      },
      onMovePlayed: (inst, _move, api) => {
        if (inst.spent) return;
        if ((api.mine.rerollsLeft ?? 0) < (inst.state.baseline as number)) {
          // A reroll was spent inside the window: heads, it comes back.
          api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
          inst.spent = true;
          return;
        }
        if (api.mine.draftsTaken - (inst.state.draftsAtGrant as number) >= 2) {
          // Window closed unspent: tails, the granted reroll simply stays.
          inst.spent = true;
        }
      },
      status: (inst) => (inst.spent ? null : "heads if you spend a reroll within two drafts"),
    },
  ),
  card(
    { id: "bn4_window_shopping", name: "Window Shopping", tier: 2, category: "draft", icon: "Store",
      description: "See the cards in your opponent's next draft offer.",
      flavor: "Looking is free. Judging is also free." },
    instant((_inst, api) => {
      api.mine.flags.seeOppCards = true;
    }),
  ),

  // --- item (2) ---

  card(
    { id: "bn4_gum_drop", name: "Gum Drop", tier: 1, category: "item", icon: "Candy",
      description: "Drop chewing gum under one enemy knight, bishop, rook or queen: it is stuck fast on your opponent's next turn.",
      flavor: "Five-second rule does not apply to cavalry." },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the piece that steps in it",
              squares: mySquares(api.board, api.opp).filter((sq) => {
                const t = api.board.pieces[sq]!.type;
                return t !== "k" && t !== "p";
              }),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.opp || p.type === "k" || p.type === "p") return;
        addEffect(api, { kind: "freeze", sq, owner: api.opp, turns: 1, skin: "gum" });
      },
    ),
  ),
  card(
    { id: "bn4_paper_crown", name: "Paper Crown", tier: 1, category: "item", icon: "Crown",
      description: "Your king wears a splendid paper crown for the rest of the game (purely decorative), and you gain 1 draft reroll.",
      flavor: "From the finest cereal box in the kingdom." },
    instant((_inst, api) => {
      const ks = kingSquare(api.board, api.me);
      if (ks != null) pinCosmetic(api, ks, api.me, "hat", null, "Paper Crown");
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
    }),
  ),

  // ===== TIER 2 ==============================================================
  // --- relief (13) ---

  card(
    { id: "bn4_steady_hands", name: "Steady Hands", tier: 2, category: "nerf", icon: "Hand",
      description: "Suspend your nerf for your next turn, and none of your pawns can be captured on your opponent's next turn.",
      flavor: "Breathe out before the stitch, not during." },
    suspendNow(1, (api) => {
      const pawns = mySquares(api.board, api.me, "p");
      if (pawns.length) addEffect(api, { kind: "shield", owner: api.me, squares: pawns, turns: 1 });
    }),
  ),
  card(
    { id: "bn4_trophy_rest", name: "Trophy Rest", tier: 2, category: "nerf", icon: "Trophy",
      description: "The next 2 times you capture a knight, bishop, rook or queen, your nerf is suspended for your next turn.",
      flavor: "Big game earns a long sit by the fire.", fx: { motif: "rally", pieces: "all", self: true } },
    reliefOn(
      2, 1,
      (m, api) => m.color === api.me && !!m.captured && m.captured !== "k" && m.captured !== "p",
      "trophies",
    ),
  ),
  card(
    { id: "bn4_dowagers_patience", name: "Dowager's Patience", tier: 2, category: "nerf", icon: "Armchair",
      description: "While your opponent has a queen on the board and you do not, your nerf is suspended, beginning the turn after each of your opponent's moves.",
      flavor: "She has outlasted worse than this." },
    // A one-turn suspension that begins after the opponent replies: unlike the
    // reliefWhile idiom there is no immediate init grant, so the relief only
    // starts once the opponent has moved while the condition holds. Added on
    // their move, the nerf_suspended timer is not self-ticked, so turns:1
    // covers exactly your following turn (refreshed after each of their moves).
    {
      kind: "passive",
      onMovePlayed: (_inst, move, api) => {
        if (move.color !== api.opp) return;
        if (
          mySquares(api.board, api.me, "q").length === 0 &&
          mySquares(api.board, api.opp, "q").length > 0
        ) {
          susp(api, 1);
        }
      },
      status: () => "watching the thrones",
    },
  ),
  card(
    { id: "bn4_measured_breath", name: "Measured Breath", tier: 2, category: "nerf", icon: "Waves",
      description: "Free action: suspend your nerf for your next turn and gain 1 draft reroll, used at the moment you choose.",
      flavor: "Four counts in, four counts out, one better card." },
    suspendFree(1, (api) => {
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
    }),
  ),
  card(
    { id: "bn4_saints_day", name: "Saint's Day", tier: 2, category: "nerf", icon: "CalendarHeart",
      description: "After your next 4 turns, your nerf is suspended for the 4 turns that follow. On the final turn the relief applies only to movement restrictions: you may move only one square at a time.",
      flavor: "The feast is marked on the calendar. The calendar is law." },
    // reliefAfter(4, 4) inlined so the final suspended turn can be made
    // movement-only. After the 4-turn delay the suspension covers the first 3
    // turns in full; a fourth, movement-only turn is added when those run out
    // (nerf_suspended plus a short_leash, both granted on the same own move so
    // the same-move tick leaves each covering exactly that one final turn).
    {
      kind: "passive",
      init: (inst) => {
        inst.state.turns = 4;
        inst.state.phase = "delay";
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.me) return;
        if (inst.state.phase === "delay") {
          const t = ((inst.state.turns as number) ?? 4) - 1;
          inst.state.turns = t;
          if (t <= 0) {
            susp(api, 4);
            inst.state.phase = "relief";
            inst.state.turns = 3;
          }
          return;
        }
        const t = ((inst.state.turns as number) ?? 0) - 1;
        inst.state.turns = t;
        if (t <= 0) {
          susp(api, 2);
          addEffect(api, { kind: "short_leash", owner: api.me, turns: 2 });
          inst.spent = true;
        }
      },
      status: (inst) =>
        inst.state.phase === "delay"
          ? `${(inst.state.turns as number) ?? 4} of your turns until relief`
          : "resting",
    },
  ),
  card(
    { id: "bn4_barter_calm", name: "Bartered Calm", tier: 2, category: "nerf", icon: "Scale",
      description: "After your opponent's next move, your nerf is suspended for your next 4 turns. In exchange, your next draft is skipped.",
      flavor: "Peace, sold by the pound." },
    {
      kind: "passive",
      init: (inst, api) => {
        inst.state.delay = 1;
        api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 1;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.opp) return;
        const d = (inst.state.delay as number) ?? 1;
        inst.state.delay = d - 1;
        if (d - 1 <= 0) {
          susp(api, 4);
          inst.spent = true;
        }
      },
      status: (inst) => (inst.spent ? null : "calm begins after their reply"),
    },
  ),
  card(
    { id: "bn4_knights_vigil", name: "Knight's Vigil", tier: 2, category: "nerf", icon: "Sword",
      description: "The next 3 times you move a knight, your nerf is suspended for one of your turns, beginning after your opponent's following move.",
      flavor: "The horse keeps watch so you can rest.", requires: ["n"] },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 3;
        inst.state.pending = 0;
      },
      onMovePlayed: (inst, move, api) => {
        // A suspension armed by an earlier knight move begins now, after this reply.
        if (move.color === api.opp && ((inst.state.pending as number) ?? 0) > 0) {
          inst.state.pending = (inst.state.pending as number) - 1;
          susp(api, 1);
        }
        // Moving a knight arms a suspension that begins after the next reply.
        const left = (inst.state.charges as number) ?? 0;
        if (left > 0 && move.color === api.me && move.piece === "n") {
          inst.state.pending = ((inst.state.pending as number) ?? 0) + 1;
          inst.state.charges = left - 1;
        }
        if (((inst.state.charges as number) ?? 0) <= 0 && ((inst.state.pending as number) ?? 0) <= 0) {
          inst.spent = true;
        }
      },
      status: (inst) => `${(inst.state.charges as number) ?? 3} vigils left`,
    },
  ),
  card(
    { id: "bn4_over_the_wall", name: "Over the Wall", tier: 3, category: "nerf", icon: "BrickWall",
      description: "The next 2 times one of your pieces reaches your opponent's back two ranks, your nerf is suspended for your next 2 turns.",
      flavor: "The air is better on their side. Less regulation." },
    reliefOn(2, 2, (m, api) => m.color === api.me && relRank(api.me, m.to) >= 7, "climbs"),
  ),
  card(
    { id: "bn4_crowned_calm", name: "Crowned Calm", tier: 1, category: "nerf", icon: "Gem",
      description: "The first time one of your pawns promotes, your nerf is suspended for your next 4 turns.",
      flavor: "Coronations put everything else on hold.", requires: ["p"], fx: { motif: "rally", pieces: "all", self: true } },
    reliefOn(1, 4, (m, api) => m.color === api.me && !!m.promotion, "coronations"),
  ),
  card(
    { id: "bn4_angelus_bell", name: "Angelus Bell", tier: 2, category: "nerf", icon: "Bell",
      description: "Every 5th move you make, the bell tolls: your nerf is suspended for your next turn. Lasts the rest of the game. In exchange, your next 2 drafts are skipped.",
      flavor: "You can set your suffering by it." },
    {
      kind: "passive",
      init: (inst, api) => {
        inst.state.count = 0;
        api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 2;
      },
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.me) return;
        const c = (((inst.state.count as number) ?? 0) + 1) % 5;
        inst.state.count = c;
        if (c === 0) susp(api, 1);
      },
      status: (inst) => `${5 - ((inst.state.count as number) ?? 0)} moves to the bell`,
    },
  ),
  card(
    { id: "bn4_spring_in_the_step", name: "Spring in the Step", tier: 2, category: "nerf", icon: "Rabbit",
      description: "Suspend your nerf for your next 2 turns, and your most advanced pawn immediately steps one square forward if the way is clear. On the second of those turns the relief applies only to movement restrictions: you may move only one square at a time.",
      flavor: "Lighter load, longer stride." },
    {
      kind: "passive",
      init: (_inst, api) => {
        susp(api, 2);
        const fwd = api.me === "w" ? 1 : -1;
        const pawns = mySquares(api.board, api.me, "p")
          .sort((a, b) => relRank(api.me, b) - relRank(api.me, a) || a - b);
        for (const from of pawns) {
          const r = RANK(from) + fwd;
          if (!inBoard(FILE(from), r)) continue;
          const to = SQ(FILE(from), r);
          if (api.board.pieces[to] || !pawnRankOk(to)) continue;
          api.relocate(from, to);
          break;
        }
      },
      onMovePlayed: (inst, move, api) => {
        // On your first suspended turn, arm the second (final) turn to be
        // movement-only: a short_leash added on this own move ticks down to
        // cover exactly your following turn, the second of the two.
        if (inst.spent || move.color !== api.me) return;
        addEffect(api, { kind: "short_leash", owner: api.me, turns: 2 });
        inst.spent = true;
      },
      status: () => null,
    },
  ),
  card(
    { id: "bn4_cold_compress", name: "Cold Compress", tier: 2, category: "nerf", icon: "Snowflake",
      description: "The next 2 times your opponent captures one of your pieces, your nerf is suspended for your next 2 turns, beginning after your opponent's following move.",
      flavor: "For the swelling. There is always swelling.", fx: { motif: "rally", pieces: "all", self: true } },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 2;
        inst.state.pending = 0;
      },
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.opp) return;
        // A suspension armed by an earlier capture begins now, after this reply.
        if (((inst.state.pending as number) ?? 0) > 0) {
          inst.state.pending = (inst.state.pending as number) - 1;
          susp(api, 2);
        }
        // A fresh capture of one of your pieces arms a suspension that begins
        // after the opponent's following move.
        const left = (inst.state.charges as number) ?? 0;
        if (left > 0 && !!move.captured && move.captured !== "k") {
          inst.state.pending = ((inst.state.pending as number) ?? 0) + 1;
          inst.state.charges = left - 1;
        }
        if (((inst.state.charges as number) ?? 0) <= 0 && ((inst.state.pending as number) ?? 0) <= 0) {
          inst.spent = true;
        }
      },
      status: (inst) => `${(inst.state.charges as number) ?? 2} compresses left`,
    },
  ),
  card(
    { id: "bn4_hermits_hour", name: "Hermit's Hour", tier: 3, category: "nerf", icon: "Mountain",
      description: "Spend your turn in retreat: your nerf is suspended for your next 4 turns.",
      flavor: "The cave charges by the hour. Worth it." },
    activatedSimple((_inst, api) => susp(api, 4)),
  ),

  // --- movement (5) ---

  card(
    { id: "bn4_ferry_ticket", name: "Ferry Ticket", tier: 3, category: "movement", icon: "Ship",
      description: "Once, one of your pawns may cross to any empty square on the rank it stands on.",
      flavor: "One passenger. No horses. Horses tip the boat.", requires: ["p"],
      fx: { motif: "empower", pieces: ["p"], self: true } },
    augment((_moves, inst, api) => {
      const out: Move[] = [];
      for (const from of mySquares(api.board, api.me, "p")) {
        const dests: Square[] = [];
        for (let f = 0; f < 8; f++) {
          const to = SQ(f, RANK(from));
          if (to !== from && !api.board.pieces[to]) dests.push(to);
        }
        out.push(...teleportMoves(api.board, from, dests, inst.id));
      }
      return out;
    }, 1),
  ),
  card(
    { id: "bn4_gate_key", name: "Gate Key", tier: 2, category: "movement", icon: "Key",
      description: "Once, one of your rooks may step a single square diagonally (capturing allowed). The square it lands on lights up until your opponent replies.",
      flavor: "Every tower keeps a key to the door it pretends not to have.", requires: ["r"],
      fx: { motif: "empower", pieces: ["r"], moveAs: "b", self: true } },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 1;
      },
      augmentMoves: (moves, inst, api) => {
        if (((inst.state.charges as number) ?? 0) <= 0) return;
        const out: Move[] = [];
        for (const from of mySquares(api.board, api.me, "r")) {
          out.push(...leapMoves(api.board, from, [[1, 1], [1, -1], [-1, 1], [-1, -1]], inst.id));
        }
        addNovel(moves, out);
      },
      onMovePlayed: (inst, move, api) => {
        if (move.via !== inst.id || !move.color) return;
        // Telegraph the landing square before the opponent replies.
        flashSquares(api, [move.to]);
        const charges = ((inst.state.charges as number) ?? 1) - 1;
        inst.state.charges = charges;
        if (charges <= 0) inst.spent = true;
      },
      status: () => null,
    },
  ),
  card(
    { id: "bn4_vaulting_pole", name: "Vaulting Pole", tier: 1, category: "movement", icon: "Wand",
      description: "Once, after your opponent's next move, one of your pawns may vault straight over a piece directly ahead of it, landing on the empty square beyond (never onto the final rank).",
      flavor: "Regulation height. Unregulated courage.", requires: ["p"],
      fx: { motif: "empower", pieces: ["p"], self: true } },
    {
      // The vault is preserved but delayed: it is offered only once the
      // opponent has replied (ready flips on their next move).
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 1;
        inst.state.ready = false;
      },
      augmentMoves: (moves, inst, api) => {
        if (!inst.state.ready || ((inst.state.charges as number) ?? 0) <= 0) return;
        const fwd = api.me === "w" ? 1 : -1;
        const out: Move[] = [];
        for (const from of mySquares(api.board, api.me, "p")) {
          const midR = RANK(from) + fwd, toR = RANK(from) + 2 * fwd;
          if (!inBoard(FILE(from), toR)) continue;
          const mid = SQ(FILE(from), midR), to = SQ(FILE(from), toR);
          if (!api.board.pieces[mid] || api.board.pieces[to] || !pawnRankOk(to)) continue;
          out.push(...teleportMoves(api.board, from, [to], inst.id));
        }
        addNovel(moves, out);
      },
      onMovePlayed: (inst, move, api) => {
        if (move.via === inst.id) {
          const left = ((inst.state.charges as number) ?? 1) - 1;
          inst.state.charges = left;
          if (left <= 0) inst.spent = true;
          return;
        }
        if (move.color === api.opp) inst.state.ready = true;
      },
      status: (inst) => (inst.state.ready ? null : "vault ready after their reply"),
    },
  ),
  card(
    { id: "bn4_royal_stroll", name: "Royal Stroll", tier: 2, category: "movement", icon: "PersonStanding",
      description: "For your next turn, your king may move two squares in a straight line, if both squares are empty.",
      flavor: "Constitutionals are constitutional.",
      fx: { motif: "empower", pieces: ["k"], self: true } },
    timedAugment(1, (_moves, inst, api) => {
      const ks = kingSquare(api.board, api.me);
      if (ks == null) return [];
      const out: Move[] = [];
      for (const [df, dr] of ALL_DIRS) {
        const f1 = FILE(ks) + df, r1 = RANK(ks) + dr;
        const f2 = FILE(ks) + 2 * df, r2 = RANK(ks) + 2 * dr;
        if (!inBoard(f1, r1) || !inBoard(f2, r2)) continue;
        if (api.board.pieces[SQ(f1, r1)] || api.board.pieces[SQ(f2, r2)]) continue;
        out.push(...teleportMoves(api.board, ks, [SQ(f2, r2)], inst.id));
      }
      return out;
    }),
  ),
  card(
    { id: "bn4_wheelbarrow", name: "Wheelbarrow", tier: 1, category: "movement", icon: "ShoppingCart",
      description: "Two of your pieces standing side by side (kings excepted) swap squares. Pawns cannot be wheeled onto a first or last rank.",
      flavor: "Load, lift, deposit. Do not ask who pushes." },
    activated(
      (_inst, api, picks) => {
        const mine = (sq: Square) => {
          const p = api.board.pieces[sq];
          return !!p && p.color === api.me && p.type !== "k";
        };
        const canStand = (sq: Square, t: PieceType) => t !== "p" || pawnRankOk(sq);
        if (picks.length >= 2) return null;
        if (picks.length === 0) {
          return {
            kind: "square",
            label: "Choose the first piece",
            squares: mySquares(api.board, api.me).filter(
              (sq) =>
                mine(sq) &&
                adjSquares(sq).some(
                  (o) =>
                    mine(o) &&
                    canStand(o, api.board.pieces[sq]!.type) &&
                    canStand(sq, api.board.pieces[o]!.type),
                ),
            ),
          };
        }
        const first = picks[0].square!;
        return {
          kind: "square",
          label: "Choose its neighbor to swap with",
          squares: adjSquares(first).filter(
            (o) =>
              mine(o) &&
              canStand(o, api.board.pieces[first]!.type) &&
              canStand(first, api.board.pieces[o]!.type),
          ),
        };
      },
      (_inst, api, picks) => {
        const a = picks[0]?.square, b = picks[1]?.square;
        if (a == null || b == null || a === b) return;
        const pa = api.board.pieces[a], pb = api.board.pieces[b];
        if (!pa || !pb || pa.color !== api.me || pb.color !== api.me) return;
        if (pa.type === "k" || pb.type === "k") return;
        if (pa.type === "p" && !pawnRankOk(b)) return;
        if (pb.type === "p" && !pawnRankOk(a)) return;
        const ta = pa.type;
        api.setPieceType(a, pb.type);
        api.setPieceType(b, ta);
      },
    ),
  ),

  // --- pieces (5) ---

  card(
    { id: "bn4_stowaway", name: "Stowaway", tier: 2, category: "pieces", icon: "Package",
      description: "After your next 5 turns, a pawn is discovered aboard and joins your pocket, ready to drop on a later turn.",
      flavor: "Been in the flour barrel since move two.", fx: { motif: "rally", pieces: "all", self: true } },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.turns = 5;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.me) return;
        const t = ((inst.state.turns as number) ?? 5) - 1;
        inst.state.turns = t;
        if (t <= 0) {
          grantInventory(api, "p", 1);
          inst.spent = true;
        }
      },
      status: (inst) => `${(inst.state.turns as number) ?? 5} turns until discovery`,
    },
  ),
  card(
    { id: "bn4_militia_call", name: "Militia Call", tier: 2, category: "pieces", icon: "Megaphone",
      description: "Place a new pawn on an empty square on your second rank.",
      flavor: "Bring your own pitchfork. Helmet provided." },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Muster the militia pawn",
              squares: emptySquares(api.board, (sq) => RANK(sq) === ownRank(api.me, 1)),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null || api.board.pieces[sq] || !pawnRankOk(sq)) return;
        api.place(sq, "p", api.me);
      },
    ),
  ),
  card(
    { id: "bn4_cobblers_bench", name: "Cobbler's Bench", tier: 3, category: "pieces", icon: "Wrench",
      description: "Return one of your captured pawns to any empty square in your half.",
      flavor: "Resoled, restitched, back on the road." },
    reviveOne(["p"], myHalf),
  ),
  card(
    { id: "bn4_green_recruit", name: "Green Recruit", tier: 3, category: "pieces", icon: "Sprout",
      description: "Place a new pawn on an empty square in your half. It spends its first 2 of your turns rooted in place learning the drills, then serves normally.",
      flavor: "Knows three formations. Two are 'stand still'." },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the training ground",
              squares: emptySquares(api.board, (sq) => inHalf(api.me, sq) && pawnRankOk(sq)),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null || api.board.pieces[sq] || !pawnRankOk(sq)) return;
        api.place(sq, "p", api.me);
        addEffect(api, { kind: "freeze", sq, owner: api.me, turns: 2, skin: "roots" });
      },
    ),
  ),
  card(
    { id: "bn4_promotion_paperwork", name: "Promotion Paperwork", tier: 3, category: "pieces", icon: "FileText",
      description: "The next 2 times one of your pawns reaches your opponent's back two ranks, it cannot be captured on your opponent's next turn while the papers are stamped.",
      flavor: "The bureaucracy protects its own applicants.", requires: ["p"],
      fx: { motif: "ward", pieces: ["p"], self: true } },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 2;
      },
      onMovePlayed: (inst, move, api) => {
        const left = (inst.state.charges as number) ?? 0;
        if (left <= 0 || move.color !== api.me || move.piece !== "p") return;
        if (relRank(api.me, move.to) < 7) return;
        addEffect(api, { kind: "shield", owner: api.me, squares: [move.to], turns: 1 });
        inst.state.charges = left - 1;
        if (left - 1 <= 0) inst.spent = true;
      },
      status: (inst) => `${(inst.state.charges as number) ?? 2} stamps left`,
    },
  ),

  // --- protection (5) ---

  card(
    { id: "bn4_quilted_armor", name: "Quilted Armor", tier: 3, category: "protection", icon: "Shirt",
      description: "One of your pieces (your king excepted) cannot be captured for your opponent's next 3 turns.",
      flavor: "Grandmother-grade protection." },
    shieldOne(3, "Choose the piece to quilt"),
  ),
  card(
    { id: "bn4_hearth_ring", name: "Hearth Ring", tier: 2, category: "protection", icon: "Flame",
      description: "Every one of your pieces standing beside your king cannot be captured for your opponent's next 2 turns.",
      flavor: "Nobody fights well with cold hands.",
      fx: { motif: "ward", pieces: "all", self: true } },
    instant((_inst, api) => {
      const ks = kingSquare(api.board, api.me);
      if (ks == null) return;
      const squares = adjSquares(ks).filter((s) => {
        const p = api.board.pieces[s];
        return !!p && p.color === api.me;
      });
      if (squares.length) addEffect(api, { kind: "shield", owner: api.me, squares, turns: 2 });
    }),
  ),
  card(
    { id: "bn4_boundary_stones", name: "Boundary Stones", tier: 2, category: "protection", icon: "Landmark",
      description: "Mark 2 empty squares in your half: no enemy piece may move onto them for 4 turns.",
      flavor: "Older than the kingdom. Grumpier, too." },
    activated(
      (_inst, api, picks) =>
        picks.length >= 2
          ? null
          : {
              kind: "square",
              label: `Place a boundary stone (${picks.length + 1}/2)`,
              squares: emptySquares(api.board, (sq) => inHalf(api.me, sq)).filter(
                (sq) => !picks.some((k) => k.square === sq),
              ),
            },
      (_inst, api, picks) => {
        const squares = picks
          .map((k) => k.square)
          .filter((s): s is Square => s != null && !api.board.pieces[s]);
        if (squares.length) addEffect(api, { kind: "barred", squares, against: api.opp, turns: 4 });
      },
    ),
  ),
  card(
    { id: "bn4_rook_nest", name: "Rook's Nest", tier: 3, category: "protection", icon: "Home",
      description: "Your rooks cannot be captured for your opponent's next 2 turns.",
      flavor: "Do not disturb. Sticks everywhere.", requires: ["r"],
      fx: { motif: "ward", pieces: ["r"], self: true } },
    shieldZone((api) => mySquares(api.board, api.me, "r"), 2),
  ),
  card(
    { id: "bn4_thorn_hedge", name: "Thorn Hedge", tier: 2, category: "protection", icon: "Flower2",
      description: "For your opponent's next 4 turns, their knights cannot move into your half of the board, except to capture.",
      flavor: "Horses have strong opinions about brambles.",
      fx: { motif: "blindfold", pieces: ["n"] } },
    // The block spares captures: a knight may still take a piece standing in
    // your half, but cannot make a quiet incursion there.
    timedOppFilter(4, (moves, _inst, api) =>
      moves.filter((m) => !(m.piece === "n" && inHalf(api.me, m.to) && !m.captured)),
    ),
  ),

  // --- tempo (4) ---

  card(
    { id: "bn4_egg_timer", name: "Egg Timer", tier: 2, category: "tempo", icon: "Timer",
      description: "Add 20 seconds to your clock, gain 1 draft reroll, and learn the tier of your opponent's next draft offer. In untimed games only the reroll and the reveal apply.",
      flavor: "Soft-boiled decisions take three minutes. You get twenty seconds." },
    instant((_inst, api) => {
      api.adjustClock({ addSelfSec: 20 });
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
      api.mine.flags.seeOppTier = true;
    }),
  ),
  card(
    { id: "bn4_slow_doors", name: "Slow Doors", tier: 2, category: "tempo", icon: "DoorOpen",
      description: "Your opponent's pawns cannot advance for their next 2 turns, though they may still capture.",
      flavor: "After you. No, after you. No, after you.",
      fx: { motif: "slow", pieces: ["p"] } },
    // no_pawn_advance blocks only straight advances; diagonal captures are
    // never in the restricted move set, so the special move cannot capture.
    instant((_inst, api) => addEffect(api, { kind: "no_pawn_advance", against: api.opp, turns: 2 })),
  ),
  card(
    { id: "bn4_sleepy_dust", name: "Sleepy Dust", tier: 2, category: "tempo", icon: "MoonStar",
      description: "Sprinkle sleep over one enemy piece (their king excepted). After your opponent's next move, it dozes through their following turn. If they move the marked piece first, the sleep follows it.",
      flavor: "Straight from the sandman's coat pocket." },
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) =>
        picks.length > 0 || inst.state.sq != null
          ? null
          : {
              kind: "square",
              label: "Choose the piece to lull",
              squares: mySquares(api.board, api.opp).filter(
                (sq) => api.board.pieces[sq]!.type !== "k",
              ),
            },
      effect: (inst, _api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null || inst.state.sq != null) return;
        inst.state.sq = sq;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent) return;
        const sq = inst.state.sq as Square | undefined;
        if (sq == null || move.color !== api.opp) return;
        // The opponent has now made their next move; the sleep lands. If they
        // moved the marked piece, it follows to the new square. turns:2 so the
        // same-move tick (freeze runs on the opponent's turns) leaves exactly
        // their following turn covered.
        const target = move.from === sq ? move.to : sq;
        const p = api.board.pieces[target];
        if (p && p.color === api.opp && p.type !== "k") {
          addEffect(api, { kind: "freeze", sq: target, owner: api.opp, turns: 2, skin: "sleep" });
        }
        inst.spent = true;
      },
      status: (inst) =>
        inst.state.sq == null ? "choose a piece to lull" : "sleep falls after their reply",
    },
  ),
  card(
    { id: "bn4_puddle_freeze", name: "Puddle Freeze", tier: 3, category: "tempo", icon: "CloudSnow",
      description: "Two enemy pawns of your choice are frozen in place for your opponent's next turn.",
      flavor: "Winter came for exactly two squares." },
    activated(
      (_inst, api, picks) =>
        picks.length >= 2
          ? null
          : {
              kind: "square",
              label: `Choose an enemy pawn to ice (${picks.length + 1}/2)`,
              squares: mySquares(api.board, api.opp, "p").filter(
                (sq) => !picks.some((k) => k.square === sq),
              ),
              ...(picks.length > 0 ? { finishable: true } : {}),
            },
      (_inst, api, picks) => {
        for (const k of picks) {
          const sq = k.square;
          if (sq == null) continue;
          const p = api.board.pieces[sq];
          if (!p || p.color !== api.opp || p.type !== "p") continue;
          addEffect(api, { kind: "freeze", sq, owner: api.opp, turns: 1, skin: "ice" });
        }
      },
    ),
  ),

  // --- info (2) ---

  card(
    // Balance buff 2026-08-04: the pure flash showed a competent player what
    // the board already shows. Being spotted now costs the intruders their
    // teeth for one turn.
    { id: "bn4_field_glasses", name: "Field Glasses", tier: 1, category: "info", icon: "Binoculars",
      description: "Every enemy piece currently standing in your half of the board lights up until your opponent replies, and the spotted pieces hold their fire: they cannot capture on that turn.",
      flavor: "Count them twice. They multiply when unobserved." },
    {
      kind: "passive",
      init: (inst, api) => {
        const spotted = mySquares(api.board, api.opp).filter((sq) => inHalf(api.me, sq));
        flashSquares(api, spotted);
        inst.state.sqs = spotted;
        inst.state.turns = 1;
      },
      filterOpponentMoves: (moves, inst) => {
        if (turnsLeft(inst) <= 0) return moves;
        const sqs = (inst.state.sqs as Square[] | undefined) ?? [];
        if (!sqs.length) return moves;
        // Spotted pieces may still move, just not capture. Never strand the
        // opponent with zero moves (the timedOppFilter safety-net idiom).
        const filtered = moves.filter((m) => !(m.captured && sqs.includes(m.from)));
        return filtered.length > 0 ? filtered : moves;
      },
      onMovePlayed: (inst, move, api) => tickTurns(inst, move, api.opp),
      status: (inst) => (turnsLeft(inst) > 0 ? "the spotted pieces hold their fire" : null),
    },
  ),
  card(
    { id: "bn4_ear_to_the_ground", name: "Ear to the Ground", tier: 2, category: "info", icon: "Ear",
      description: "Learn the tier of your opponent's next draft offer, and gain 1 draft reroll. If that draft is already skipped, only the reroll arrives.",
      flavor: "The floorboards gossip terribly." },
    instant((_inst, api) => {
      // Never combine the reveal with a skipped enemy draft: if the opponent's
      // next draft is already blocked there is no offer to read, so keep only
      // the reroll and drop the reveal.
      if ((api.theirs.flags.blockedDrafts ?? 0) === 0) api.mine.flags.seeOppTier = true;
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
    }),
  ),

  // --- draft (2) ---

  card(
    { id: "bn4_coupon_book", name: "Coupon Book", tier: 2, category: "draft", icon: "Ticket",
      description: "Your next draft offer rolls one tier higher. The redemption fee is one of your rerolls, if you have any.",
      flavor: "Some restrictions apply. All restrictions apply." },
    instant((_inst, api) => {
      // The offer is preserved and stays self-only: it lifts your own next
      // draft and never touches the enemy draft. The Math.min cap means the
      // boost never stacks with (combines with) a skipped draft's banked bonus.
      api.mine.flags.bankBonus = Math.min(1, (api.mine.flags.bankBonus ?? 0) + 1);
      api.mine.rerollsLeft = Math.max(0, (api.mine.rerollsLeft ?? 0) - 1);
    }),
  ),
  card(
    { id: "bn4_punch_card", name: "Punch Card", tier: 3, category: "draft", icon: "CreditCard",
      description: "Gain 2 draft rerolls.",
      flavor: "Buy nine rerolls, the tenth regret is free." },
    instant((_inst, api) => {
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 2;
    }),
  ),

  // --- item (2) ---

  card(
    { id: "bn4_warm_soup", name: "Warm Soup", tier: 1, category: "item", icon: "Soup",
      description: "Thaw one of your pieces that is frozen or stuck: it can move again on your next turn.",
      flavor: "Cures frostbite, glue, webs and most opinions." },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : { kind: "square", label: "Choose the piece to warm up", squares: frozenMine(api) },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        thawMine(api, sq);
      },
    ),
  ),
  card(
    { id: "bn4_rubber_duck", name: "Rubber Duck", tier: 2, category: "item", icon: "Bath",
      description: "One of your pieces (your king excepted) becomes delightfully plush for the rest of the game (purely decorative) and cannot be captured for your opponent's next 2 turns.",
      flavor: "Explain your plan to it. It already knows the refutation." },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the piece to squeak",
              squares: mySquares(api.board, api.me).filter(
                (sq) => api.board.pieces[sq]!.type !== "k",
              ),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.me || p.type === "k") return;
        pinCosmetic(api, sq, api.me, "plush");
        addEffect(api, { kind: "shield", owner: api.me, squares: [sq], turns: 2 });
      },
    ),
  ),

  // ===== TIER 3 ==============================================================
  // --- relief (13) ---

  card(
    { id: "bn4_clerical_error", name: "Clerical Error", tier: 4, category: "nerf", icon: "FileX",
      description: "Your handicap's paperwork is misfiled: your nerf is suspended for your next 3 turns, and your next draft shows three cards.",
      flavor: "Stamped, filed, and mercifully lost." },
    suspendNow(3, (api) => {
      api.mine.flags.prepThree = true;
    }),
  ),
  card(
    { id: "bn4_sparring_rhythm", name: "Sparring Rhythm", tier: 3, category: "nerf", icon: "Zap",
      description: "The next 2 times you put your opponent's king in check, your nerf is suspended for your next 2 turns, beginning after your opponent's following move.",
      flavor: "Jab, jab, breathe." },
    {
      // The 2-turn suspension is preserved but begins one opponent move later:
      // a check arms a pending suspension that fires after the reply (the
      // knights_vigil pending idiom).
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 2;
        inst.state.pending = 0;
      },
      onMovePlayed: (inst, move, api) => {
        // A suspension armed by an earlier check begins now, after this reply.
        if (move.color === api.opp && ((inst.state.pending as number) ?? 0) > 0) {
          inst.state.pending = (inst.state.pending as number) - 1;
          susp(api, 2);
        }
        // Putting the opponent's king in check arms a suspension that begins
        // after their following move.
        const left = (inst.state.charges as number) ?? 0;
        if (left > 0 && move.color === api.me && isInCheck(api.board, api.opp)) {
          inst.state.pending = ((inst.state.pending as number) ?? 0) + 1;
          inst.state.charges = left - 1;
        }
        if (((inst.state.charges as number) ?? 0) <= 0 && ((inst.state.pending as number) ?? 0) <= 0) {
          inst.spent = true;
        }
      },
      status: (inst) => `${(inst.state.charges as number) ?? 2} flurries left`,
    },
  ),
  card(
    { id: "bn4_lone_crown", name: "Lone Crown", tier: 3, category: "nerf", icon: "Crown",
      description: "While no piece of yours stands beside your king, your nerf is suspended. When a piece returns to your king's side, one final turn stays suspended but applies only to movement restrictions: you may move only one square at a time.",
      flavor: "Solitude has its privileges.", fx: { motif: "rally", pieces: "all", self: true } },
    reliefWhileGrace((api) => {
      const ks = kingSquare(api.board, api.me);
      if (ks == null) return false;
      return !adjSquares(ks).some((s) => {
        const p = api.board.pieces[s];
        return !!p && p.color === api.me;
      });
    }, "watching the king's company"),
  ),
  card(
    { id: "bn4_forty_winks", name: "Forty Winks", tier: 3, category: "nerf", icon: "BedDouble",
      description: "After your next 3 turns, your nerf is suspended for the 5 turns that follow.",
      flavor: "Do not wake it. It wakes itself, ravenous." },
    reliefAfter(3, 5),
  ),
  card(
    { id: "bn4_bribe_the_clerk", name: "Bribe the Clerk", tier: 3, category: "nerf", icon: "Wallet",
      description: "After your opponent's next move, your nerf is suspended for your next 5 turns. The clerk pockets one of your draft rerolls, if you have any.",
      flavor: "Everything is negotiable before lunch." },
    {
      // The 5-turn duration is preserved but begins after the opponent replies
      // (the bartered_calm delay idiom). The bribe is paid up front on cast.
      kind: "passive",
      init: (inst, api) => {
        inst.state.delay = 1;
        api.mine.rerollsLeft = Math.max(0, (api.mine.rerollsLeft ?? 0) - 1);
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.opp) return;
        const d = (inst.state.delay as number) ?? 1;
        inst.state.delay = d - 1;
        if (d - 1 <= 0) {
          susp(api, 5);
          inst.spent = true;
        }
      },
      status: (inst) => (inst.spent ? null : "the bribe clears after their reply"),
    },
  ),
  card(
    { id: "bn4_pawns_ransom", name: "Pawn's Ransom", tier: 3, category: "nerf", icon: "HandCoins",
      description: "Give up one of your pawns (it is removed and truly lost): your nerf is suspended for your next 6 turns.",
      flavor: "Somebody always pays. Today it is the little one.", requires: ["p"] },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the pawn paid in ransom",
              squares: mySquares(api.board, api.me, "p"),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.me || p.type !== "p") return;
        api.removePiece(sq);
        susp(api, 6);
      },
    ),
  ),
  card(
    { id: "bn4_bread_and_salt", name: "Bread and Salt", tier: 4, category: "nerf", icon: "Wheat",
      description: "The next 3 times your opponent captures one of your pawns, your nerf is suspended for your next 2 turns.",
      flavor: "Hospitality for the grieving, by ancient custom.", requires: ["p"], fx: { motif: "rally", pieces: "all", self: true } },
    reliefOn(3, 2, (m, api) => m.color === api.opp && m.captured === "p", "loaves"),
  ),
  card(
    { id: "bn4_second_skin", name: "Second Skin", tier: 4, category: "nerf", icon: "Layers",
      description: "The next 4 times your opponent captures one of your knights or bishops, your nerf is suspended for your next 2 turns.",
      flavor: "It grows back tougher. That is the whole trick.", fx: { motif: "rally", pieces: "all", self: true } },
    reliefOn(
      4, 2,
      (m, api) => m.color === api.opp && (m.captured === "n" || m.captured === "b"),
      "moltings",
    ),
  ),
  card(
    { id: "bn4_glass_of_water", name: "Glass of Water", tier: 3, category: "nerf", icon: "GlassWater",
      description: "Cleanse one of your pieces of a temporary freeze, seal, or one-square movement restriction, and suspend your nerf for your next turn.",
      flavor: "The oldest medicine. Still on the formulary." },
    instant((_inst, api) => {
      const fx = api.bs.effects;
      // Cleanse one temporary binding on your side: prefer a freeze or walnut
      // holding one of your pieces, else lift a lingering one-square leash.
      let cleansed = false;
      for (let i = 0; i < fx.length; i++) {
        const e = fx[i];
        if ((e.kind === "freeze" || e.kind === "walnut") && e.owner === api.me) {
          fx.splice(i, 1);
          cleansed = true;
          break;
        }
      }
      if (!cleansed) {
        for (let i = 0; i < fx.length; i++) {
          const e = fx[i];
          if (e.kind === "short_leash" && e.owner === api.me) {
            fx.splice(i, 1);
            break;
          }
        }
      }
      susp(api, 1);
    }),
  ),
  card(
    { id: "bn4_bottom_of_the_well", name: "Bottom of the Well", tier: 3, category: "nerf", icon: "ArrowDownCircle",
      description: "While your opponent has at least two more pieces than you (kings aside), your nerf is suspended. Once that gap closes, one final turn stays suspended but applies only to movement restrictions: you may move only one square at a time.",
      flavor: "From down here, the only direction is generous." },
    reliefWhileGrace(
      (api) => armySize(api.board, api.opp) - armySize(api.board, api.me) >= 2,
      "measuring the deficit",
    ),
  ),
  card(
    { id: "bn4_hush_money", name: "Hush Money", tier: 3, category: "nerf", icon: "BadgeDollarSign",
      description: "Your next 2 captures each suspend your nerf for your next turn.",
      flavor: "Paid in full, in silence." },
    reliefOn(2, 1, (m, api) => m.color === api.me && !!m.captured && m.captured !== "k", "payments"),
  ),
  card(
    { id: "bn4_rest_stop", name: "Rest Stop", tier: 3, category: "nerf", icon: "ParkingCircle",
      description: "Suspend your nerf for your next 2 turns, and none of your pieces can be captured on your opponent's next turn.",
      flavor: "Stretch the legs. Count the rooks. All present." },
    suspendNow(2, (api) => {
      addEffect(api, { kind: "shield", owner: api.me, squares: null, turns: 1 });
    }),
  ),
  card(
    { id: "bn4_slipped_collar", name: "Slipped Collar", tier: 2, category: "nerf", icon: "Unlink",
      description: "The first time your opponent captures your queen, your nerf is suspended for your next 8 turns.",
      flavor: "Grief loosens every knot.", requires: ["q"], fx: { motif: "rally", pieces: "all", self: true } },
    reliefOn(1, 8, (m, api) => m.color === api.opp && m.captured === "q", "collars"),
  ),

  // --- movement (5) ---

  card(
    { id: "bn4_dressage", name: "Dressage", tier: 3, category: "movement", icon: "Medal",
      description: "For your next 2 turns, your knights may also step one square diagonally (capturing allowed). Each square a knight steps onto this way lights up until your opponent replies.",
      flavor: "Elegance is a weapon with better posture.", requires: ["n"],
      fx: { motif: "empower", pieces: ["n"], moveAs: "b", self: true } },
    {
      // timedAugment, but the landing square is revealed (lit) until the
      // opponent replies whenever a knight takes the granted diagonal step.
      kind: "passive",
      init: (inst) => {
        inst.state.turns = 2;
      },
      augmentMoves: (moves, inst, api) => {
        if (turnsLeft(inst) <= 0) return;
        const out: Move[] = [];
        for (const from of mySquares(api.board, api.me, "n")) {
          out.push(...leapMoves(api.board, from, [[1, 1], [1, -1], [-1, 1], [-1, -1]], inst.id));
        }
        addNovel(moves, out);
      },
      onMovePlayed: (inst, move, api) => {
        if (move.via === inst.id) flashSquares(api, [move.to]);
        tickTurns(inst, move, api.me);
      },
      status: (inst) => `${turnsLeft(inst)} of your turns left`,
    },
  ),
  card(
    { id: "bn4_over_the_hedge", name: "Over the Hedge", tier: 3, category: "movement", icon: "Shrub",
      description: "After your opponent's next move, lift one of your pieces (your king excepted) over whatever stands in the way, to any empty square within two squares of it. Pawns cannot land on a first or last rank.",
      flavor: "The hedge has opinions. Overrule them." },
    activated(
      (inst, api, picks) => {
        // Delayed: the lift cannot be used until the opponent has replied once.
        if (!inst.state.ready) {
          return picks.length > 0
            ? null
            : { kind: "square", label: "Wait for your opponent's reply", squares: [] };
        }
        if (picks.length >= 2) return null;
        const dests = (from: Square) =>
          adjSquares(from)
            .flatMap((s) => [s, ...adjSquares(s)])
            .filter(
              (s, i, arr) =>
                arr.indexOf(s) === i &&
                s !== from &&
                !api.board.pieces[s] &&
                (api.board.pieces[from]!.type !== "p" || pawnRankOk(s)),
            );
        if (picks.length === 0) {
          return {
            kind: "square",
            label: "Choose the piece to lift",
            squares: mySquares(api.board, api.me).filter(
              (sq) => api.board.pieces[sq]!.type !== "k" && dests(sq).length > 0,
            ),
          };
        }
        return { kind: "square", label: "Choose where it lands", squares: dests(picks[0].square!) };
      },
      (_inst, api, picks) => {
        const from = picks[0]?.square, to = picks[1]?.square;
        if (from == null || to == null || from === to) return;
        const p = api.board.pieces[from];
        if (!p || p.color !== api.me || p.type === "k" || api.board.pieces[to]) return;
        const d = Math.max(Math.abs(FILE(to) - FILE(from)), Math.abs(RANK(to) - RANK(from)));
        if (d > 2) return;
        if (p.type === "p" && !pawnRankOk(to)) return;
        api.relocate(from, to);
      },
      {
        init: (inst) => {
          inst.state.ready = false;
        },
        onMovePlayed: (inst, move, api) => {
          if (move.color === api.opp) inst.state.ready = true;
        },
      },
    ),
  ),
  card(
    { id: "bn4_leapfrog", name: "Leapfrog", tier: 1, category: "movement", icon: "Squirrel",
      description: "Once, one of your pawns may hop diagonally forward over an adjacent piece, landing on the empty square beyond (never onto the final rank).",
      flavor: "A dignified military maneuver, honest.", requires: ["p"],
      fx: { motif: "empower", pieces: ["p"], self: true } },
    augment((_moves, inst, api) => {
      const fwd = api.me === "w" ? 1 : -1;
      const out: Move[] = [];
      for (const from of mySquares(api.board, api.me, "p")) {
        for (const df of [-1, 1]) {
          const mf = FILE(from) + df, mr = RANK(from) + fwd;
          const tf = FILE(from) + 2 * df, tr = RANK(from) + 2 * fwd;
          if (!inBoard(mf, mr) || !inBoard(tf, tr)) continue;
          const mid = SQ(mf, mr), to = SQ(tf, tr);
          if (!api.board.pieces[mid] || api.board.pieces[to] || !pawnRankOk(to)) continue;
          out.push(...teleportMoves(api.board, from, [to], inst.id));
        }
      }
      return out;
    }, 1),
  ),
  card(
    { id: "bn4_forward_banners", name: "Forward Banners", tier: 3, category: "movement", icon: "Flag",
      description: "Up to three of your pawns each immediately advance one square, wherever the square ahead is empty. Every square they step onto lights up until your opponent replies.",
      flavor: "Three flags up. The whole field notices.", requires: ["p"],
      fx: { motif: "rally", pieces: ["p"], self: true } },
    activated(
      (_inst, api, picks) =>
        picks.length >= 3
          ? null
          : {
              kind: "square",
              label: `Choose a pawn to advance (${picks.length + 1}/3)`,
              squares: advanceablePawns(api).filter((sq) => !picks.some((k) => k.square === sq)),
              ...(picks.length > 0 ? { finishable: true } : {}),
            },
      (_inst, api, picks) => {
        const fwd = api.me === "w" ? 1 : -1;
        const dests: Square[] = [];
        for (const k of picks) {
          const from = k.square;
          if (from != null && advancePawn(api, from)) {
            dests.push(SQ(FILE(from), RANK(from) + fwd));
          }
        }
        // Reveal each arrival square: it stays lit until the opponent replies.
        if (dests.length) flashSquares(api, dests);
      },
    ),
  ),
  card(
    { id: "bn4_causeway", name: "Causeway", tier: 3, category: "movement", icon: "Route",
      description: "For your next 2 turns, your rooks may slide straight through your own pieces (never capturing them) to any empty square beyond. Each square a rook lands on this way lights up until your opponent replies.",
      flavor: "The engineers raised the road right over the camp.", requires: ["r"],
      fx: { motif: "empower", pieces: ["r"], moveAs: "r", self: true } },
    {
      // timedAugment, but the landing square is revealed (lit) until the
      // opponent replies whenever a rook takes the granted phasing slide.
      kind: "passive",
      init: (inst) => {
        inst.state.turns = 2;
      },
      augmentMoves: (moves, inst, api) => {
        if (turnsLeft(inst) <= 0) return;
        const out: Move[] = [];
        for (const from of mySquares(api.board, api.me, "r")) {
          out.push(...phasingSlideMoves(api.board, from, ORTHO_DIRS, inst.id, 8));
        }
        addNovel(moves, out);
      },
      onMovePlayed: (inst, move, api) => {
        if (move.via === inst.id) flashSquares(api, [move.to]);
        tickTurns(inst, move, api.me);
      },
      status: (inst) => `${turnsLeft(inst)} of your turns left`,
    },
  ),

  // --- pieces (5) ---

  card(
    { id: "bn4_twin_buttons", name: "Twin Buttons", tier: 4, category: "pieces", icon: "CircleDashed",
      description: "Two pawns slip into your pocket, ready to be dropped onto empty squares on later turns (each drop spends that turn).",
      flavor: "They came off the same coat. They stay together." },
    instant((_inst, api) => grantInventory(api, "p", 2)),
  ),
  card(
    { id: "bn4_florists_trick", name: "Florist's Trick", tier: 3, category: "pieces", icon: "Flower",
      description: "Return one of your captured pawns to an empty square on your fourth rank, already halfway down the road.",
      flavor: "Cut stems root faster than anyone admits." },
    reviveOne(["p"], (api) => (sq) => RANK(sq) === ownRank(api.me, 3)),
  ),
  card(
    { id: "bn4_night_gardener", name: "Night Gardener", tier: 3, category: "pieces", icon: "Leaf",
      description: "The next 2 of your pawns that are captured each return at once to the empty square nearest your home rank.",
      flavor: "What is buried in the evening is up by morning.", requires: ["p"], fx: { motif: "ward", pieces: ["p"], self: true } },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 2;
      },
      onMovePlayed: (inst, move, api) => {
        const left = (inst.state.charges as number) ?? 0;
        if (left <= 0 || move.color !== api.opp || move.captured !== "p") return;
        const sq = autoPlace(api, api.me, "p");
        if (sq == null) return;
        api.place(sq, "p", api.me);
        markRevived(api, "p");
        inst.state.charges = left - 1;
        if (left - 1 <= 0) inst.spent = true;
      },
      status: (inst) => `${(inst.state.charges as number) ?? 2} replantings left`,
    },
  ),
  card(
    { id: "bn4_pawnbrokers_deal", name: "Pawnbroker's Deal", tier: 4, category: "pieces", icon: "Store",
      description: "Hand one of your pawns over the counter (it is removed and truly lost): a knight joins your pocket, ready to drop on a later turn.",
      flavor: "Terrible rates. Wonderful merchandise.", requires: ["p"] },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the pawn to trade in",
              squares: mySquares(api.board, api.me, "p"),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.me || p.type !== "p") return;
        api.removePiece(sq);
        grantInventory(api, "n", 1);
      },
    ),
  ),
  card(
    { id: "bn4_matryoshka_surprise", name: "Matryoshka Surprise", tier: 3, category: "pieces", icon: "Egg",
      description: "Paint one of your pawns as a nesting doll. When it is captured, two smaller pawns pop out into your pocket, ready to drop on later turns.",
      flavor: "There is always one more inside. That is the law of dolls.", requires: ["p"] },
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) =>
        picks.length > 0 || inst.state.sq != null
          ? null
          : {
              kind: "square",
              label: "Choose the doll pawn",
              squares: mySquares(api.board, api.me, "p"),
            },
      effect: (inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null || inst.state.sq != null) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.me || p.type !== "p") return;
        inst.state.sq = sq;
        pinCosmetic(api, sq, api.me, "matryoshka");
      },
      onMovePlayed: (inst, move, api) => {
        const sq = inst.state.sq as Square | undefined;
        if (sq == null || inst.spent) return;
        const died =
          (move.capturedSquare === sq && move.from !== sq) ||
          (move.to === sq && move.from !== sq);
        if (died) {
          grantInventory(api, "p", 2);
          inst.spent = true;
          return;
        }
        if (move.from === sq) inst.state.sq = move.to;
      },
      status: (inst) => {
        const sq = inst.state.sq as Square | undefined;
        return sq == null
          ? "activate to choose the doll"
          : `doll at ${"abcdefgh"[FILE(sq)]}${RANK(sq) + 1}`;
      },
    },
  ),

  // --- protection (5) ---

  card(
    { id: "bn4_visor_down", name: "Visor Down", tier: 3, category: "protection", icon: "HardHat",
      description: "The two squares diagonally ahead of your king are barred to enemy pieces for 4 turns. In exchange, your next draft is skipped.",
      flavor: "Vision narrows. Confidence soars." },
    instant((_inst, api) => {
      const ks = kingSquare(api.board, api.me);
      if (ks != null) {
        const fwd = api.me === "w" ? 1 : -1;
        const squares: Square[] = [];
        for (const df of [-1, 1]) {
          const f = FILE(ks) + df, r = RANK(ks) + fwd;
          if (inBoard(f, r)) squares.push(SQ(f, r));
        }
        if (squares.length) addEffect(api, { kind: "barred", squares, against: api.opp, turns: 4 });
      }
      api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 1;
    }),
  ),
  card(
    { id: "bn4_rampart_watch", name: "Rampart Watch", tier: 3, category: "protection", icon: "TowerControl",
      description: "After your opponent's next move, none of your pieces standing on your second rank can be captured for their following 2 turns.",
      flavor: "The wall walk is staffed and grumbling.",
      fx: { motif: "ward", pieces: "all", self: true } },
    {
      // The payoff is preserved but delayed: the shield lands after the
      // opponent's next move (the pawn_umbrella delay idiom), so it covers
      // their following 2 turns instead of their next 2.
      kind: "passive",
      init: (inst) => {
        inst.state.delay = 1;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.opp) return;
        const d = (inst.state.delay as number) ?? 1;
        inst.state.delay = d - 1;
        if (d - 1 <= 0) {
          const squares = mySquares(api.board, api.me).filter((sq) => RANK(sq) === ownRank(api.me, 1));
          if (squares.length) addEffect(api, { kind: "shield", owner: api.me, squares, turns: 2 });
          inst.spent = true;
        }
      },
      status: (inst) => (inst.spent ? null : "the wall mans after their next move"),
    },
  ),
  card(
    { id: "bn4_royal_taster", name: "Royal Taster", tier: 4, category: "protection", icon: "Utensils",
      description: "Your queen cannot be captured for your opponent's next 2 turns.",
      flavor: "Somebody checks every square before she stands on it.", requires: ["q"],
      fx: { motif: "ward", pieces: ["q"], self: true } },
    shieldZone((api) => mySquares(api.board, api.me, "q"), 2),
  ),
  card(
    { id: "bn4_charm_bracelet", name: "Charm Bracelet", tier: 4, category: "protection", icon: "Link2",
      description: "Two of your pieces of your choice (your king excepted) cannot be captured for your opponent's next 2 turns.",
      flavor: "One charm per catastrophe. Choose the catastrophes." },
    activated(
      (_inst, api, picks) =>
        picks.length >= 2
          ? null
          : {
              kind: "square",
              label: `Choose a piece to charm (${picks.length + 1}/2)`,
              squares: mySquares(api.board, api.me).filter(
                (sq) =>
                  api.board.pieces[sq]!.type !== "k" && !picks.some((k) => k.square === sq),
              ),
              ...(picks.length > 0 ? { finishable: true } : {}),
            },
      (_inst, api, picks) => {
        const squares = picks
          .map((k) => k.square)
          .filter((s): s is Square => {
            if (s == null) return false;
            const p = api.board.pieces[s];
            return !!p && p.color === api.me && p.type !== "k";
          });
        if (squares.length) addEffect(api, { kind: "shield", owner: api.me, squares, turns: 2 });
      },
    ),
  ),
  card(
    { id: "bn4_beetle_shell", name: "Beetle Shell", tier: 3, category: "protection", icon: "Bug",
      description: "Your knights and bishops cannot be captured on your opponent's next turn.",
      flavor: "Chitin: nature's answer to tactics." },
    shieldZone(
      (api) =>
        mySquares(api.board, api.me).filter((sq) => {
          const t = api.board.pieces[sq]!.type;
          return t === "n" || t === "b";
        }),
      1,
    ),
  ),

  // --- tempo (4) ---

  card(
    { id: "bn4_pocket_metronome", name: "Pocket Metronome", tier: 3, category: "tempo", icon: "Music2",
      description: "Add 25 seconds to your clock, gain 1 draft reroll, and learn the tier of your opponent's next draft offer. In untimed games only the reroll and the tier reveal arrive.",
      flavor: "Tick. Tock. Yours now." },
    instant((_inst, api) => {
      api.adjustClock({ addSelfSec: 25 });
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
      api.mine.flags.seeOppTier = true;
    }),
  ),
  card(
    { id: "bn4_cold_snap", name: "Cold Snap", tier: 4, category: "tempo", icon: "ThermometerSnowflake",
      description: "Two enemy pieces of your choice (their king excepted) are frozen for your opponent's next turn.",
      flavor: "Weather report: brief, personal, vindictive." },
    activated(
      (_inst, api, picks) =>
        picks.length >= 2
          ? null
          : {
              kind: "square",
              label: `Choose an enemy piece to freeze (${picks.length + 1}/2)`,
              squares: mySquares(api.board, api.opp).filter(
                (sq) =>
                  api.board.pieces[sq]!.type !== "k" && !picks.some((k) => k.square === sq),
              ),
              ...(picks.length > 0 ? { finishable: true } : {}),
            },
      (_inst, api, picks) => {
        for (const k of picks) {
          const sq = k.square;
          if (sq == null) continue;
          const p = api.board.pieces[sq];
          if (!p || p.color !== api.opp || p.type === "k") continue;
          addEffect(api, { kind: "freeze", sq, owner: api.opp, turns: 1, skin: "ice" });
        }
      },
    ),
  ),
  card(
    { id: "bn4_slow_procession", name: "Slow Procession", tier: 3, category: "tempo", icon: "Snail",
      description: "For your opponent's next 2 turns, their queen cannot move. When it resolves, their queen lights up until they reply.",
      flavor: "Protocol demands she walk behind the banners. All of them.",
      fx: { motif: "jail", pieces: ["q"] } },
    {
      // The jail identity is preserved; the affected piece is revealed before
      // the opponent replies: the queen lights up until their next move.
      kind: "passive",
      init: (inst, api) => {
        inst.state.turns = 2;
        flashSquares(api, mySquares(api.board, api.opp, "q"));
      },
      filterOpponentMoves: (moves, inst) => {
        if (turnsLeft(inst) <= 0) return moves;
        const filtered = moves.filter((m) => m.piece !== "q");
        return filtered.length > 0 ? filtered : moves;
      },
      onMovePlayed: (inst, move, api) => tickTurns(inst, move, api.opp),
      status: (inst) => `${turnsLeft(inst)} of their turns left`,
    },
  ),
  card(
    { id: "bn4_coffee_break", name: "Coffee Break", tier: 3, category: "tempo", icon: "Coffee",
      description: "Your opponent's pawns cannot advance for their next 3 turns.",
      flavor: "The union was very clear about this.",
      fx: { motif: "slow", pieces: ["p"] } },
    instant((_inst, api) => addEffect(api, { kind: "no_pawn_advance", against: api.opp, turns: 3 })),
  ),

  // --- info (2) ---

  card(
    // Balance buff 2026-08-04: a pure flash at tier 3 was the weakest card in
    // its band. The report is now acted on: everything it names as threatened
    // digs in for one turn.
    { id: "bn4_scouts_report", name: "Scout's Report", tier: 3, category: "info", icon: "Map",
      description: "Every enemy piece currently aiming at any of your pieces lights up until your opponent replies, and your threatened pieces dig in: they cannot be captured on that turn.",
      flavor: "Bad news, thoroughly footnoted." },
    instant((_inst, api) => {
      const hot: Square[] = [];
      const threatened: Square[] = [];
      for (const mineSq of mySquares(api.board, api.me)) {
        const aiming = attackersOf(api.board, api.opp, mineSq);
        if (aiming.length > 0) threatened.push(mineSq);
        for (const a of aiming) {
          if (!hot.includes(a)) hot.push(a);
        }
      }
      flashSquares(api, hot);
      if (threatened.length) {
        addEffect(api, { kind: "shield", owner: api.me, squares: threatened, turns: 1 });
      }
    }),
  ),
  card(
    { id: "bn4_over_the_shoulder", name: "Over the Shoulder", tier: 3, category: "info", icon: "Eye",
      description: "See the cards in your opponent's next draft offer, and gain 1 draft reroll. If that draft is already skipped, only the reroll arrives.",
      flavor: "Rude, effective, traditional." },
    instant((_inst, api) => {
      // Never combine the peek with a skipped enemy draft: if the opponent's
      // next draft is already blocked there is no offer to read, so keep only
      // the reroll and drop the peek (the ear_to_the_ground idiom).
      if ((api.theirs.flags.blockedDrafts ?? 0) === 0) api.mine.flags.seeOppCards = true;
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
    }),
  ),

  // --- draft (2) ---

  card(
    { id: "bn4_bakers_dozen", name: "Baker's Dozen", tier: 3, category: "draft", icon: "Croissant",
      description: "Your next draft shows three cards, and you gain 1 draft reroll.",
      flavor: "The thirteenth roll is always the good one." },
    instant((_inst, api) => {
      // The offer is preserved and stays self-only: prepThree lifts your own
      // next draft and never touches the enemy draft, so it can never combine
      // with a skipped enemy draft (the boolean flag cannot stack either).
      api.mine.flags.prepThree = true;
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
    }),
  ),
  card(
    { id: "bn4_trade_secret", name: "Trade Secret", tier: 3, category: "draft", icon: "Lock",
      description: "Your next draft offer is fated to deal tier 4 cards. If it has not been dealt within two of your drafts, the fated offer is reclaimed.",
      flavor: "Ask no questions about the supplier." },
    {
      // The reward is preserved but expires: the forced tier is reclaimed if the
      // fated offer is not dealt within two of your drafts (the Lucky Coin
      // expiry idiom applied to forceTier).
      kind: "passive",
      init: (inst, api) => {
        api.mine.flags.forceTier = 4;
        inst.state.draftsAtGrant = api.mine.draftsTaken;
      },
      onMovePlayed: (inst, _move, api) => {
        if (inst.spent) return;
        // The flag clears itself when the offer is dealt: the reward was used.
        if (api.mine.flags.forceTier !== 4) {
          inst.spent = true;
          return;
        }
        if (api.mine.draftsTaken - (inst.state.draftsAtGrant as number) >= 2) {
          api.mine.flags.forceTier = undefined;
          inst.spent = true;
        }
      },
      status: (inst) => (inst.spent ? null : "the fated offer expires in two drafts"),
    },
  ),

  // --- item (2) ---

  card(
    { id: "bn4_kettle_on", name: "Kettle On", tier: 2, category: "item", icon: "CupSoda",
      description: "Put the kettle on: every one of your frozen or stuck pieces thaws at once.",
      flavor: "Steam solves what strategy cannot." },
    activatedSimple((_inst, api) => thawMine(api)),
  ),
  card(
    { id: "bn4_party_hat", name: "Party Hat", tier: 2, category: "item", icon: "PartyPopper",
      description: "Put a party hat on any piece on the board, forever (purely decorative). If it is one of yours, it cannot be captured for your opponent's next 2 turns: nobody ruins a party.",
      flavor: "Mandatory fun has entered the square." },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose who celebrates",
              squares: [...mySquares(api.board, api.me), ...mySquares(api.board, api.opp)],
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        const p = api.board.pieces[sq];
        if (!p) return;
        pinCosmetic(api, sq, p.color, "hat", null, "Party Hat");
        if (p.color === api.me && p.type !== "k") {
          addEffect(api, { kind: "shield", owner: api.me, squares: [sq], turns: 2 });
        }
      },
    ),
  ),

  // ===== TIER 4 ==============================================================
  // --- relief (12) ---

  card(
    { id: "bn4_open_season", name: "Open Season", tier: 5, category: "nerf", icon: "Crosshair",
      description: "For the rest of the game, every capture you make suspends your nerf for your next turn.",
      flavor: "The license never expires. The geese know." },
    reliefEvery(
      1,
      (m, api) => m.color === api.me && !!m.captured && m.captured !== "k",
      "hunting keeps you free",
    ),
  ),
  card(
    { id: "bn4_paid_leave", name: "Paid Leave", tier: 4, category: "nerf", icon: "Plane",
      description: "Suspend your nerf for your next 6 turns.",
      flavor: "Approved, stamped, and already at the beach." },
    suspendNow(6),
  ),
  card(
    { id: "bn4_kings_indulgence", name: "King's Indulgence", tier: 5, category: "nerf", icon: "ScrollText",
      description: "Free action: suspend your nerf for your next 4 turns, used at the moment you choose.",
      flavor: "Signed in a generous mood. Cash it in a desperate one." },
    suspendFree(4),
  ),
  card(
    { id: "bn4_heavy_price", name: "Heavy Price", tier: 5, category: "nerf", icon: "Anchor",
      description: "For the rest of the game, whenever your opponent captures one of your rooks or queens, your nerf is suspended for your next 4 turns.",
      flavor: "Take something that heavy and the whole board tilts back." },
    reliefEvery(
      4,
      (m, api) => m.color === api.opp && (m.captured === "r" || m.captured === "q"),
      "the scales are watching",
    ),
  ),
  card(
    { id: "bn4_royal_writ", name: "Royal Writ", tier: 5, category: "nerf", icon: "Stamp",
      description: "Suspend your nerf for your next 4 turns, and your king cannot be captured on your opponent's next turn.",
      flavor: "The seal is heavy enough to hide behind." },
    suspendNow(4, (api) => {
      addEffect(api, { kind: "king_safe", owner: api.me, turns: 1 });
    }),
  ),
  card(
    { id: "bn4_harvest_rest", name: "Harvest Rest", tier: 4, category: "nerf", icon: "Tractor",
      description: "After your next 5 turns, your nerf is suspended for the 6 turns that follow. On the final turn the relief applies only to movement restrictions: you may move only one square at a time.",
      flavor: "First the field, then the feast." },
    // reliefAfter(5, 6) inlined so the final suspended turn can be made
    // movement-only (the Saint's Day idiom). After the 5-turn delay the
    // suspension covers the first 5 turns in full; a sixth, movement-only turn
    // is added when those run out (nerf_suspended plus a short_leash, both
    // granted on the same own move so the same-move tick leaves each covering
    // exactly that one final turn).
    {
      kind: "passive",
      init: (inst) => {
        inst.state.turns = 5;
        inst.state.phase = "delay";
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.me) return;
        if (inst.state.phase === "delay") {
          const t = ((inst.state.turns as number) ?? 5) - 1;
          inst.state.turns = t;
          if (t <= 0) {
            susp(api, 6);
            inst.state.phase = "relief";
            inst.state.turns = 5;
          }
          return;
        }
        const t = ((inst.state.turns as number) ?? 0) - 1;
        inst.state.turns = t;
        if (t <= 0) {
          susp(api, 2);
          addEffect(api, { kind: "short_leash", owner: api.me, turns: 2 });
          inst.spent = true;
        }
      },
      status: (inst) =>
        inst.state.phase === "delay"
          ? `${(inst.state.turns as number) ?? 5} of your turns until relief`
          : "resting",
    },
  ),
  card(
    { id: "bn4_furlough", name: "Furlough", tier: 4, category: "nerf", icon: "Backpack",
      description: "Spend your turn signing out: your nerf is suspended for your next 6 turns.",
      flavor: "Leave the shackles at the front desk." },
    activatedSimple((_inst, api) => susp(api, 6)),
  ),
  card(
    { id: "bn4_dragonslayer", name: "Dragonslayer", tier: 3, category: "nerf", icon: "Flame",
      description: "The first time you capture your opponent's queen, your nerf is suspended for your next 8 turns.",
      flavor: "After the dragon, everything else is paperwork.", fx: { motif: "rally", pieces: "all", self: true } },
    reliefOn(1, 8, (m, api) => m.color === api.me && m.captured === "q", "dragons"),
  ),
  card(
    { id: "bn4_worry_beads", name: "Worry Beads", tier: 4, category: "nerf", icon: "Grip",
      description: "Every 3rd move you make, a bead drops: your nerf is suspended for your next turn. Lasts the rest of the game. In exchange, your next 2 drafts are skipped.",
      flavor: "Click. Click. Peace." },
    {
      kind: "passive",
      init: (inst, api) => {
        inst.state.count = 0;
        api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 2;
      },
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.me) return;
        const c = (((inst.state.count as number) ?? 0) + 1) % 3;
        inst.state.count = c;
        if (c === 0) susp(api, 1);
      },
      status: (inst) => `${3 - ((inst.state.count as number) ?? 0)} moves to the next bead`,
    },
  ),
  card(
    { id: "bn4_gentlemens_agreement", name: "Gentlemen's Agreement", tier: 5, category: "nerf", icon: "Handshake",
      description: "Suspend your nerf for your next 5 turns. As a courtesy, your opponent gains 1 draft reroll.",
      flavor: "Scandalously civilized." },
    suspendNow(5, (api) => {
      api.theirs.rerollsLeft = (api.theirs.rerollsLeft ?? 0) + 1;
    }),
  ),
  card(
    { id: "bn4_home_square", name: "Home Square", tier: 4, category: "nerf", icon: "House",
      description: "While your king stands on its starting square, your nerf is suspended, beginning the turn after each of your opponent's moves. Castle or step away, and the comfort ends until he returns.",
      flavor: "There is exactly one chair in the world that fits." },
    // The continuous relief is preserved but begins after the opponent replies:
    // no immediate init grant, so it only starts once the opponent has moved
    // while the king sits home (the dowagers_patience delay idiom). Added on
    // their move, the nerf_suspended timer is not self-ticked, so turns:1 covers
    // exactly your following turn (refreshed after each of their moves).
    {
      kind: "passive",
      onMovePlayed: (_inst, move, api) => {
        if (move.color !== api.opp) return;
        const home = api.me === "w" ? SQ(4, 0) : SQ(4, 7);
        const p = api.board.pieces[home];
        if (!!p && p.color === api.me && p.type === "k") susp(api, 1);
      },
      status: () => "the throne remembers",
    },
  ),
  card(
    { id: "bn4_hold_the_door", name: "Hold the Door", tier: 4, category: "nerf", icon: "DoorClosed",
      description: "The next 2 times an enemy piece reaches your back rank, your nerf is suspended for your next 3 turns.",
      flavor: "They are in the hall. You are suddenly wide awake." },
    reliefOn(2, 3, (m, api) => m.color === api.opp && relRank(api.opp, m.to) === 8, "alarms"),
  ),

  // --- movement (5) ---

  card(
    { id: "bn4_hidden_stair", name: "Hidden Stair", tier: 4, category: "movement", icon: "ArrowDownToLine",
      description: "Once, your king may descend to any empty square on your home rank. In exchange, your next draft is skipped.",
      flavor: "Behind the tapestry. Mind the third step.",
      fx: { motif: "empower", pieces: ["k"], self: true } },
    {
      // augment() inlined so using the descent also skips your next draft.
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 1;
      },
      augmentMoves: (moves, inst, api) => {
        if (((inst.state.charges as number) ?? 0) <= 0) return;
        const ks = kingSquare(api.board, api.me);
        if (ks == null) return;
        const r = api.me === "w" ? 0 : 7;
        const dests: Square[] = [];
        for (let f = 0; f < 8; f++) {
          const s = SQ(f, r);
          if (s !== ks && !api.board.pieces[s]) dests.push(s);
        }
        addNovel(moves, teleportMoves(api.board, ks, dests, inst.id));
      },
      onMovePlayed: (inst, move, api) => {
        if (move.via !== inst.id) return;
        const charges = ((inst.state.charges as number) ?? 1) - 1;
        inst.state.charges = charges;
        api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 1;
        if (charges <= 0) inst.spent = true;
      },
      status: () => null,
    },
  ),
  card(
    { id: "bn4_mountain_pass", name: "Mountain Pass", tier: 4, category: "movement", icon: "MountainSnow",
      description: "For your next 3 turns, your bishops may slide diagonally through one of your own pieces (never capturing it) to squares beyond. The square a bishop lands on this way lights up until your opponent replies.",
      flavor: "The goat path is open. Bishops are surprisingly goat-like.", requires: ["b"],
      fx: { motif: "empower", pieces: ["b"], moveAs: "b", self: true } },
    // timedAugment(3, ...) inlined so the destination is revealed before the
    // opponent replies: a bishop's landing square lights up until their move.
    {
      kind: "passive",
      init: (inst) => {
        inst.state.turns = 3;
      },
      augmentMoves: (moves, inst, api) => {
        if (turnsLeft(inst) <= 0) return;
        const out: Move[] = [];
        for (const from of mySquares(api.board, api.me, "b")) {
          out.push(...phasingSlideMoves(api.board, from, [[1, 1], [1, -1], [-1, 1], [-1, -1]], inst.id, 1));
        }
        addNovel(moves, out);
      },
      onMovePlayed: (inst, move, api) => {
        if (move.via === inst.id) flashSquares(api, [move.to]);
        tickTurns(inst, move, api.me);
      },
      status: (inst) => `${turnsLeft(inst)} of your turns left`,
    },
  ),
  card(
    { id: "bn4_processional", name: "Processional", tier: 4, category: "movement", icon: "Footprints",
      description: "Rearrange the court: move up to 2 of your pieces (your king excepted) to empty squares within your half. Each destination lights up until your opponent replies.",
      flavor: "Everyone one step to the left of destiny, please." },
    (() => {
      // relocateMany inlined via a wrapper so each destination is revealed
      // before the opponent replies: the landing squares light up until their
      // move (the side_shuffle / mountain_pass telegraph idiom).
      const base = relocateMany(2, (api) => emptySquares(api.board, (sq) => inHalf(api.me, sq)));
      const inner = base.effect!;
      return {
        ...base,
        effect: (inst: BuffInstance, api: BuffApi, picks: BuffPick[]) => {
          const dests: Square[] = [];
          for (let i = 1; i < picks.length; i += 2) {
            const sq = picks[i]?.square;
            if (sq != null) dests.push(sq);
          }
          inner(inst, api, picks);
          flashSquares(api, dests);
        },
      };
    })(),
  ),
  card(
    { id: "bn4_scaffold_crane", name: "Scaffold Crane", tier: 4, category: "movement", icon: "Construction",
      description: "Hoist one of your rooks to any empty square on your home rank. In exchange, your next draft is skipped.",
      flavor: "The classic rook lift, with an actual lift.", requires: ["r"] },
    activated(
      (_inst, api, picks) => {
        if (picks.length >= 2) return null;
        const homeEmpty = () => {
          const r = api.me === "w" ? 0 : 7;
          const out: Square[] = [];
          for (let f = 0; f < 8; f++) {
            const s = SQ(f, r);
            if (!api.board.pieces[s]) out.push(s);
          }
          return out;
        };
        if (picks.length === 0) {
          return {
            kind: "square",
            label: "Choose the rook to hoist",
            squares: homeEmpty().length ? mySquares(api.board, api.me, "r") : [],
          };
        }
        return { kind: "square", label: "Choose where it lands", squares: homeEmpty() };
      },
      (_inst, api, picks) => {
        const from = picks[0]?.square, to = picks[1]?.square;
        if (from == null || to == null || from === to) return;
        const p = api.board.pieces[from];
        if (!p || p.color !== api.me || p.type !== "r" || api.board.pieces[to]) return;
        api.relocate(from, to);
        // Skip the next draft once the hoist resolves.
        api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 1;
      },
    ),
  ),
  card(
    { id: "bn4_seven_league_boots", name: "Seven League Boots", tier: 1, category: "movement", icon: "Footprints",
      description: "Once, one of your pawns may stride up to three squares straight forward across empty squares (never onto the final rank). In exchange, your next draft is skipped.",
      flavor: "Sized for giants. Laced for optimists.", requires: ["p"],
      fx: { motif: "empower", pieces: ["p"], self: true } },
    {
      // augment(..., 1) inlined so using the stride also skips your next draft
      // (the hidden_stair idiom).
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 1;
      },
      augmentMoves: (moves, inst, api) => {
        if (((inst.state.charges as number) ?? 0) <= 0) return;
        const fwd = api.me === "w" ? 1 : -1;
        const out: Move[] = [];
        for (const from of mySquares(api.board, api.me, "p")) {
          for (let d = 1; d <= 3; d++) {
            const r = RANK(from) + d * fwd;
            if (!inBoard(FILE(from), r)) break;
            const to = SQ(FILE(from), r);
            if (api.board.pieces[to]) break;
            if (!pawnRankOk(to)) break;
            if (d > 1) out.push(...teleportMoves(api.board, from, [to], inst.id));
          }
        }
        addNovel(moves, out);
      },
      onMovePlayed: (inst, move, api) => {
        if (move.via !== inst.id || !move.color) return;
        const charges = ((inst.state.charges as number) ?? 1) - 1;
        inst.state.charges = charges;
        api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 1;
        if (charges <= 0) inst.spent = true;
      },
      status: () => null,
    },
  ),

  // --- pieces (5) ---

  card(
    { id: "bn4_letters_home", name: "Letters Home", tier: 3, category: "pieces", icon: "Mail",
      description: "After your next 4 turns, the letters arrive: two pawns join your pocket, ready to drop on later turns.",
      flavor: "P.S. We are coming to help. P.P.S. Both of us." },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.turns = 4;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.me) return;
        const t = ((inst.state.turns as number) ?? 4) - 1;
        inst.state.turns = t;
        if (t <= 0) {
          grantInventory(api, "p", 2);
          inst.spent = true;
        }
      },
      status: (inst) => `${(inst.state.turns as number) ?? 4} turns until the post`,
    },
  ),
  card(
    { id: "bn4_field_hospital", name: "Field Hospital", tier: 5, category: "pieces", icon: "Cross",
      description: "Return one of your captured pawns to an empty square in your half. It comes back bandaged: it cannot be captured for your opponent's next 2 turns.",
      flavor: "Discharged with a limp and a grudge." },
    activated(
      (_inst, api, picks) => {
        if (picks.length > 0) return null;
        const can = revivable(api, "p") > 0;
        return {
          kind: "square",
          label: can ? "Choose where the patient returns" : "No captured pawn to treat",
          squares: can
            ? emptySquares(api.board, (sq) => inHalf(api.me, sq) && pawnRankOk(sq))
            : [],
        };
      },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null || revivable(api, "p") <= 0) return;
        if (api.board.pieces[sq] || !pawnRankOk(sq)) return;
        api.place(sq, "p", api.me);
        markRevived(api, "p");
        addEffect(api, { kind: "shield", owner: api.me, squares: [sq], turns: 2 });
      },
    ),
  ),
  card(
    { id: "bn4_small_consolation", name: "Small Consolation", tier: 3, category: "pieces", icon: "Gift",
      description: "The next 2 times your opponent captures one of your rooks or queens, a pawn joins your pocket.",
      flavor: "It is not a rook. It is trying its best.", fx: { motif: "ward", pieces: ["r", "q"], self: true } },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 2;
      },
      onMovePlayed: (inst, move, api) => {
        const left = (inst.state.charges as number) ?? 0;
        if (left <= 0 || move.color !== api.opp) return;
        if (move.captured !== "r" && move.captured !== "q") return;
        grantInventory(api, "p", 1);
        inst.state.charges = left - 1;
        if (left - 1 <= 0) inst.spent = true;
      },
      status: (inst) => `${(inst.state.charges as number) ?? 2} consolations left`,
    },
  ),
  card(
    { id: "bn4_color_guard", name: "Color Guard", tier: 5, category: "pieces", icon: "Flag",
      description: "Place two new pawns on empty squares on your second rank.",
      flavor: "They carry the flag. The flag carries the mood." },
    activated(
      (_inst, api, picks) =>
        picks.length >= 2
          ? null
          : {
              kind: "square",
              label: `Post a guard (${picks.length + 1}/2)`,
              squares: emptySquares(api.board, (sq) => RANK(sq) === ownRank(api.me, 1)).filter(
                (sq) => !picks.some((k) => k.square === sq),
              ),
              ...(picks.length > 0 ? { finishable: true } : {}),
            },
      (_inst, api, picks) => {
        for (const k of picks) {
          const sq = k.square;
          if (sq == null || api.board.pieces[sq] || !pawnRankOk(sq)) continue;
          api.place(sq, "p", api.me);
        }
      },
    ),
  ),
  card(
    { id: "bn4_veterans_return", name: "Veteran's Return", tier: 5, category: "pieces", icon: "Medal",
      description: "Return one of your captured knights or bishops to any empty square in your half.",
      flavor: "The armor still fits. The temper never left." },
    reviveOne(["n", "b"], myHalf),
  ),

  // --- protection (5) ---

  card(
    { id: "bn4_wagon_circle", name: "Wagon Circle", tier: 4, category: "protection", icon: "CircleDot",
      description: "After your opponent's next move, none of your pieces standing on your home rank can be captured for their following 3 turns.",
      flavor: "Round up whatever rolls.",
      fx: { motif: "ward", pieces: "all", self: true } },
    {
      // The payoff is preserved but delayed: the shield lands after the
      // opponent's next move (the pawn_bulwark delay idiom), covering their
      // following 3 turns instead of their next 3.
      kind: "passive",
      init: (inst) => {
        inst.state.delay = 1;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.opp) return;
        const d = (inst.state.delay as number) ?? 1;
        inst.state.delay = d - 1;
        if (d - 1 <= 0) {
          const squares = mySquares(api.board, api.me).filter(
            (sq) => RANK(sq) === ownRank(api.me, 0),
          );
          if (squares.length) {
            addEffect(api, { kind: "shield", owner: api.me, squares, turns: 3 });
          }
          inst.spent = true;
        }
      },
      status: (inst) => (inst.spent ? null : "the circle closes after their next move"),
    },
  ),
  card(
    { id: "bn4_pawn_bulwark", name: "Pawn Bulwark", tier: 4, category: "protection", icon: "BrickWall",
      description: "After your opponent's next move, none of your pawns can be captured for their following 2 turns.",
      flavor: "The little wall holds. The little wall always holds.", requires: ["p"],
      fx: { motif: "ward", pieces: ["p"], self: true } },
    {
      // The payoff is preserved but delayed: the shield lands after the
      // opponent's next move (the pawn_umbrella delay idiom), covering their
      // following 2 turns instead of their next 2.
      kind: "passive",
      init: (inst) => {
        inst.state.delay = 1;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.opp) return;
        const d = (inst.state.delay as number) ?? 1;
        inst.state.delay = d - 1;
        if (d - 1 <= 0) {
          const pawns = mySquares(api.board, api.me, "p");
          if (pawns.length) addEffect(api, { kind: "shield", owner: api.me, squares: pawns, turns: 2 });
          inst.spent = true;
        }
      },
      status: (inst) => (inst.spent ? null : "the wall holds after their next move"),
    },
  ),
  card(
    { id: "bn4_glass_case", name: "Glass Case", tier: 5, category: "protection", icon: "Frame",
      description: "Your queen cannot be captured for your opponent's next 3 turns.",
      flavor: "Museum grade. Do not tap. They always tap.", requires: ["q"],
      fx: { motif: "ward", pieces: ["q"], self: true } },
    shieldZone((api) => mySquares(api.board, api.me, "q"), 3),
  ),
  card(
    { id: "bn4_town_walls", name: "Town Walls", tier: 3, category: "protection", icon: "Castle",
      description: "No enemy piece may move onto your second rank for 2 turns.",
      flavor: "Built in a day, oddly enough." },
    instant((_inst, api) => {
      const r = ownRank(api.me, 1);
      const squares: Square[] = [];
      for (let f = 0; f < 8; f++) squares.push(SQ(f, r));
      addEffect(api, { kind: "barred", squares, against: api.opp, turns: 2 });
    }),
  ),
  card(
    { id: "bn4_bodyguard_detail", name: "Bodyguard Detail", tier: 5, category: "protection", icon: "Users",
      description: "Your king cannot be captured for your opponent's next 2 turns, and every piece of yours standing beside him cannot be captured on their next turn.",
      flavor: "Sunglasses, earpieces, unshakable loyalty.",
      fx: { motif: "ward", pieces: ["k"], self: true } },
    instant((_inst, api) => {
      addEffect(api, { kind: "king_safe", owner: api.me, turns: 2 });
      const ks = kingSquare(api.board, api.me);
      if (ks == null) return;
      const squares = adjSquares(ks).filter((s) => {
        const p = api.board.pieces[s];
        return !!p && p.color === api.me;
      });
      if (squares.length) addEffect(api, { kind: "shield", owner: api.me, squares, turns: 1 });
    }),
  ),

  // --- tempo (4) ---

  card(
    { id: "bn4_hourglass_flip", name: "Hourglass Flip", tier: 2, category: "tempo", icon: "Hourglass",
      description: "Add 30 seconds to your clock. In untimed games it adds nothing.",
      flavor: "Gravity works for whoever turns the glass." },
    instant((_inst, api) => api.adjustClock({ addSelfSec: 30 })),
  ),
  card(
    { id: "bn4_flash_frost", name: "Flash Frost", tier: 3, category: "tempo", icon: "Snowflake",
      description: "One enemy piece of your choice (their king excepted) is frozen solid for your opponent's next 2 turns.",
      flavor: "Personal winter, express delivery." },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the piece to freeze",
              squares: mySquares(api.board, api.opp).filter(
                (sq) => api.board.pieces[sq]!.type !== "k",
              ),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.opp || p.type === "k") return;
        addEffect(api, { kind: "freeze", sq, owner: api.opp, turns: 2, skin: "ice" });
      },
    ),
  ),
  card(
    { id: "bn4_general_strike", name: "General Strike", tier: 4, category: "tempo", icon: "Megaphone",
      description: "For your opponent's next turn, only their king will move, and it cannot capture unless a capture is its only legal move: every other piece is off the job.",
      flavor: "The pawns have demands. The rooks have a drum.",
      fx: { motif: "slow", pieces: "all", king: true } },
    // The king-only identity is preserved; the granted move cannot capture: the
    // opponent's captures are filtered out for that turn (with the standard
    // never-strand fallback if a capture is their only legal move).
    {
      kind: "passive",
      init: (inst, api) => {
        inst.state.turns = 1;
        addEffect(api, { kind: "king_only", against: api.opp, turns: 1 });
      },
      filterOpponentMoves: (moves, inst) => {
        if (turnsLeft(inst) <= 0) return moves;
        const filtered = moves.filter((m) => !m.captured);
        return filtered.length > 0 ? filtered : moves;
      },
      onMovePlayed: (inst, move, api) => tickTurns(inst, move, api.opp),
      status: (inst) => (turnsLeft(inst) > 0 ? "the king works alone, unarmed" : null),
    },
  ),
  card(
    { id: "bn4_tangled_reins", name: "Tangled Reins", tier: 4, category: "tempo", icon: "Cable",
      description: "For your opponent's next 2 turns, their knights cannot capture.",
      flavor: "Somebody braided the cavalry together.",
      fx: { motif: "slow", pieces: ["n"] } },
    // The knight-restriction identity is preserved, but the special move cannot
    // capture: knights may still move for those 2 turns, just not take.
    timedOppFilter(2, (moves) => moves.filter((m) => !(m.piece === "n" && m.captured))),
  ),

  // --- info (3) ---

  card(
    // Balance buff 2026-08-04: a pure flash at tier 3, priced against Punch
    // Card's two flat rerolls in the same band. The map now comes with the
    // planning session attached.
    { id: "bn4_war_room_map", name: "War Room Map", tier: 3, category: "info", icon: "Map",
      description: "Every enemy piece that no other enemy piece defends lights up until your opponent replies, and the planners hand you 2 draft rerolls.",
      flavor: "The pins are red. The mood is optimistic." },
    instant((_inst, api) => {
      flashSquares(api, undefendedPieces(api.board, api.opp));
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 2;
    }),
  ),
  card(
    // Balance buff 2026-08-04: against a blocked draft the card resolved to
    // literally nothing, the only card in the wave that could. The dead branch
    // now pays a consolation reroll.
    { id: "bn4_listening_post", name: "Listening Post", tier: 4, category: "info", icon: "RadioTower",
      description: "See both the cards and the tier of your opponent's next draft offer. If that draft is already skipped, the wire is dead: gain 1 draft reroll instead.",
      flavor: "The wire crackles. The news is specific." },
    instant((_inst, api) => {
      // Never combine the peek with a skipped enemy draft: if the opponent's
      // next draft is already blocked there is no offer to read, so neither the
      // cards nor the tier are revealed (the over_the_shoulder idiom); the
      // holder pockets a reroll for the dead wire instead.
      if ((api.theirs.flags.blockedDrafts ?? 0) === 0) {
        api.mine.flags.seeOppCards = true;
        api.mine.flags.seeOppTier = true;
      } else {
        api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
      }
    }),
  ),
  card(
    // Balance buff 2026-08-04: a pure flash at tier 3. A sense of danger you
    // cannot act on is a headache, so the warning now buys the royals one
    // turn of cover.
    { id: "bn4_danger_sense", name: "Danger Sense", tier: 3, category: "info", icon: "AlertTriangle",
      description: "Every enemy piece currently aiming at your king or your queen lights up until your opponent replies, and both crowns brace: neither can be captured on that turn.",
      flavor: "The hair on the back of the castle stands up." },
    instant((_inst, api) => {
      const hot: Square[] = [];
      const royal = [
        ...mySquares(api.board, api.me, "k"),
        ...mySquares(api.board, api.me, "q"),
      ];
      for (const sq of royal) {
        for (const a of attackersOf(api.board, api.opp, sq)) {
          if (!hot.includes(a)) hot.push(a);
        }
      }
      flashSquares(api, hot);
      addEffect(api, { kind: "king_safe", owner: api.me, turns: 1 });
      const queens = mySquares(api.board, api.me, "q");
      if (queens.length) {
        addEffect(api, { kind: "shield", owner: api.me, squares: queens, turns: 1 });
      }
    }),
  ),

  // --- draft (2) ---

  card(
    { id: "bn4_season_ticket", name: "Season Ticket", tier: 4, category: "draft", icon: "Ticket",
      description: "Gain 2 draft rerolls.",
      flavor: "Front row for every bad deal, with the right to boo." },
    instant((_inst, api) => {
      api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 2;
    }),
  ),
  card(
    { id: "bn4_private_auction", name: "Private Auction", tier: 4, category: "draft", icon: "Gavel",
      description: "Your next draft offer is fated to deal tier 5 cards. If it has not been dealt within two of your drafts, the fated offer is reclaimed.",
      flavor: "Invitation only. You are the invitation." },
    {
      // The reward is preserved but expires: the forced tier is reclaimed if the
      // fated offer is not dealt within two of your drafts (the Lucky Coin
      // expiry idiom applied to forceTier).
      kind: "passive",
      init: (inst, api) => {
        api.mine.flags.forceTier = 5;
        inst.state.draftsAtGrant = api.mine.draftsTaken;
      },
      onMovePlayed: (inst, _move, api) => {
        if (inst.spent) return;
        // The flag clears itself when the offer is dealt: the reward was used.
        if (api.mine.flags.forceTier !== 5) {
          inst.spent = true;
          return;
        }
        if (api.mine.draftsTaken - (inst.state.draftsAtGrant as number) >= 2) {
          api.mine.flags.forceTier = undefined;
          inst.spent = true;
        }
      },
      status: (inst) => (inst.spent ? null : "the fated offer expires in two drafts"),
    },
  ),

  // --- item (2) ---

  card(
    { id: "bn4_care_package", name: "Care Package", tier: 3, category: "item", icon: "Package",
      description: "Open the parcel: at random, either a pawn (half the time), a knight (a quarter), or a bishop (a quarter) joins your pocket, ready to drop on a later turn.",
      flavor: "No return address. Smells faintly of oats." },
    activatedSimple((_inst, api) => {
      const roll = api.rng.int(4);
      grantInventory(api, roll < 2 ? "p" : roll === 2 ? "n" : "b", 1);
    }),
  ),
  card(
    { id: "bn4_confetti_cannon", name: "Confetti Cannon", tier: 2, category: "item", icon: "PartyPopper",
      description: "One of your pieces (your king excepted) puts on sunglasses for the rest of the game (purely decorative) and struts uncapturable through your opponent's next 2 turns.",
      flavor: "Morale is a weapon system." },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the guest of honor",
              squares: mySquares(api.board, api.me).filter(
                (sq) => api.board.pieces[sq]!.type !== "k",
              ),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.me || p.type === "k") return;
        pinCosmetic(api, sq, api.me, "sunglasses");
        addEffect(api, { kind: "shield", owner: api.me, squares: [sq], turns: 2 });
      },
    ),
  ),
];

/** Boon wave 4, all 300 cards: tiers 1-4 here, tiers 5-8 from boons4b.ts. */
export const BOON_WAVE4: Buff[] = [...BOON_WAVE4A, ...BOON_WAVE4B];
