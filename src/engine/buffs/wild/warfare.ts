// Wild set: WARFARE & TACTICS. A batch of soldierly power cards built ENTIRELY
// from primitives that already live in the engine: charges that cut a line
// (lineSweep), reinforcements and rentals (placePieces / summonTemp), permanent
// veteran upgrades on a single piece (pieceBound / bindPiece), army-wide grants
// (permanentAugment / timedAugment), sieges and sealed ground (barLine /
// voidSquares), bodyguards and shield walls (shieldArmy / shield zones), and
// ambushes (freeze / convertEnemies / removeEnemies). Every movement grant only
// ever WIDENS a move list, every opponent effect is partial or targeted, and no
// king is ever frozen, converted, or removed, so nothing here can soft-lock a
// turn. This file is self-contained: it imports shared helpers from
// ../helpers and keeps local copies of the summon / convert patterns (exactly as
// the fantasy and funny sets do in their own shared.ts).

import { Buff, BuffApi, BuffCategory, BuffInstance, CardFx } from "../../buff";
import { Tier } from "../../nerf";
import { FILE, Move, PieceType, RANK, SQ, Square, inBoard } from "../../types";
import {
  ALL_DIRS,
  pawnRankOk,
  DIAG_DIRS,
  KNIGHT_LEAPS,
  ORTHO_DIRS,
  activated,
  addEffect,
  addNovel,
  augment,
  bindCandidates,
  bindPiece,
  captureSquare,
  emptySquares,
  explodeAt,
  grantInventory,
  inHalf,
  instant,
  leapMoves,
  lineSweep,
  markRevived,
  mySquares,
  permanentAugment,
  phasingSlideMoves,
  pieceBound,
  placePieces,
  relRank,
  removeEnemies,
  revivable,
  reviveOne,
  shieldArmy,
  slideMoves,
  timedAugment,
  trackBoundPiece,
} from "../helpers";

type Mech = Partial<Buff> & Pick<Buff, "kind">;

type WarfareMeta = {
  id: string;
  name: string;
  description: string;
  tier: Tier;
  category: BuffCategory;
  flavor?: string;
  boon?: boolean;
  fx?: CardFx;
  /** Per-card lucide-react icon name; overrides the category glyph. */
  icon?: string;
  /** Piece types the caster must own on the board for this card to be offered
   * (dead-draft guard). Omit for cards that work regardless of your pieces. */
  requires?: PieceType[];
};

/** Build a fully implemented card. Mirrors library.ts's private `def`. */
function card(meta: WarfareMeta, mech: Mech): Buff {
  return { ...meta, implemented: true, ...mech };
}

// --- Destination zones -------------------------------------------------------
const myHalfZone = (api: BuffApi) => (sq: Square) => inHalf(api.me, sq);
const oppHalfZone = (api: BuffApi) => (sq: Square) => inHalf(api.opp, sq);
const backRankZone = (api: BuffApi) => (sq: Square) =>
  RANK(sq) === (api.me === "w" ? 0 : 7);
const kingAdjacentZone = (api: BuffApi) => {
  const k = mySquares(api.board, api.me, "k")[0];
  return (sq: Square) => {
    if (k == null) return false;
    const df = Math.abs(FILE(sq) - FILE(k)), dr = Math.abs(RANK(sq) - RANK(k));
    return df <= 1 && dr <= 1 && sq !== k;
  };
};
const backRankDest = (api: BuffApi, _from: Square) => {
  const r = api.me === "w" ? 0 : 7;
  return Array.from({ length: 8 }, (_, f) => SQ(f, r));
};

// --- Local copy of the summon-a-rental pattern (see funny/shared.ts). A fresh
// piece is placed, follows its own moves, and is quietly removed after `turns`
// of the owner's turns via an uncounted removePiece so nothing enters the
// revive pool. Only non-pawns, so there is never a promotion edge to track. ----
function summonTemp(
  type: Exclude<PieceType, "p" | "k">,
  turns: number,
  zone: (api: BuffApi) => (sq: Square) => boolean,
): Mech {
  return {
    kind: "activated",
    spendOnUse: false,
    targets: (inst, api, picks) =>
      picks.length > 0 || inst.state.sq != null
        ? null
        : {
            kind: "square",
            label: "Choose where your reinforcement lands",
            squares: emptySquares(api.board, zone(api)),
          },
    effect: (inst, api, picks) => {
      const sq = picks[0]?.square;
      if (sq == null || inst.state.sq != null) return;
      api.place(sq, type, api.me);
      inst.state.sq = sq;
      inst.state.turns = turns;
    },
    onMovePlayed: (inst, move, api) => {
      const sq = inst.state.sq as Square | undefined;
      if (sq == null) return;
      if (move.capturedSquare === sq && move.from !== sq) {
        inst.spent = true;
        inst.state.sq = undefined;
        return;
      }
      if (move.from === sq) {
        inst.state.sq = move.to;
      } else if (move.to === sq && move.from !== sq) {
        inst.spent = true;
        inst.state.sq = undefined;
        return;
      }
      if (move.color !== api.me) return;
      const left = ((inst.state.turns as number) ?? 0) - 1;
      inst.state.turns = left;
      if (left <= 0) {
        const cur = inst.state.sq as Square | undefined;
        if (cur != null && api.board.pieces[cur]) api.removePiece(cur, { uncounted: true });
        inst.spent = true;
        inst.state.sq = undefined;
      }
    },
    status: (inst) =>
      inst.state.sq == null
        ? "activate to summon"
        : `reinforcement withdraws in ${(inst.state.turns as number) ?? 0} of your turns`,
  };
}

// --- Local copy of convertEnemies (see fantasy/shared.ts): take control of
// `count` enemy pieces of the given types. Kings are never offered. ------------
function convertEnemies(count: number, types: PieceType[], label: string): Mech {
  return activated(
    (_inst, api, picks) =>
      picks.length >= count
        ? null
        : {
            kind: "square",
            label: count > 1 ? `${label} (${picks.length + 1}/${count})` : label,
            squares: mySquares(api.board, api.opp).filter((sq) => {
              const p = api.board.pieces[sq]!;
              return types.includes(p.type) && !picks.some((k) => k.square === sq);
            }),
          },
    (_inst, api, picks) => {
      for (const k of picks) if (k.square != null) api.setPieceColor(k.square, api.me);
    },
  );
}

// --- Instant: freeze every enemy piece of the given types for `turns` of their
// turns. Kings are never frozen. (Same shape as fantasy/shared.ts's walnutAll,
// but with a freeze effect instead of a walnut.) ------------------------------
function freezeTypedAll(types: PieceType[], turns: number): Mech {
  return instant((_inst, api) => {
    for (const sq of mySquares(api.board, api.opp)) {
      const t = api.board.pieces[sq]!.type;
      if (t === "k" || !types.includes(t)) continue;
      addEffect(api, { kind: "freeze", sq, owner: api.opp, turns });
    }
  });
}

// --- Activated: freeze up to `count` targeted enemy non-king pieces, each for
// `turns` of their turns. --------------------------------------------------
function freezeMany(count: number, turns: number, label: string): Mech {
  return activated(
    (_inst, api, picks) =>
      picks.length >= count
        ? null
        : {
            kind: "square",
            label: count > 1 ? `${label} (${picks.length + 1}/${count})` : label,
            squares: mySquares(api.board, api.opp).filter(
              (sq) =>
                api.board.pieces[sq]!.type !== "k" && !picks.some((k) => k.square === sq),
            ),
            ...(picks.length > 0 ? { finishable: true } : {}),
          },
    (_inst, api, picks) => {
      for (const k of picks) {
        if (k.square != null) {
          addEffect(api, { kind: "freeze", sq: k.square, owner: api.opp, turns });
        }
      }
    },
  );
}

// --- Every one of my pawns that can capture the enemy piece directly ahead of
// it, expanding promotions on the last rank. Used by Field Fortification. -----
function forwardCaptureGen(inst: BuffInstance, api: BuffApi): Move[] {
  const out: Move[] = [];
  const fwd = api.me === "w" ? 8 : -8;
  for (const from of mySquares(api.board, api.me, "p")) {
    const to = from + fwd;
    if (to < 0 || to > 63) continue;
    const t = api.board.pieces[to];
    if (!t || t.color !== api.opp) continue;
    if (relRank(api.me, to) === 8) {
      for (const promo of ["q", "r", "b", "n"] as PieceType[]) {
        out.push({
          from, to, piece: "p", color: api.me,
          captured: t.type, capturedSquare: to, via: inst.id, promotion: promo,
        });
      }
    } else {
      out.push({
        from, to, piece: "p", color: api.me,
        captured: t.type, capturedSquare: to, via: inst.id,
      });
    }
  }
  return out;
}

/** lineSweep, but the squares the ray CLEARS stay barred to the opponent for
 * `barTurns` of their turns: a breakthrough that holds the lane. Same ray rules
 * as helpers.lineSweep (friendly pieces and kings block it). */
function sweepThenBar(
  type: PieceType,
  dirs: readonly (readonly [number, number])[],
  maxCaptures: number | null,
  barTurns: number,
): Mech {
  const dests = (api: BuffApi, from: Square): Square[] => {
    const out: Square[] = [];
    for (const [df, dr] of dirs) {
      let f = FILE(from) + df, r = RANK(from) + dr, swept = 0;
      while (inBoard(f, r)) {
        const sq = SQ(f, r);
        const p = api.board.pieces[sq];
        if (!p) {
          if (swept > 0) out.push(sq);
        } else {
          if (p.color === api.me || p.type === "k") break;
          swept++;
          if (maxCaptures != null && swept > maxCaptures) break;
          out.push(sq);
        }
        f += df; r += dr;
      }
    }
    return out;
  };
  return activated(
    (_inst, api, picks) => {
      if (picks.length >= 2) return null;
      if (picks.length === 0) {
        return {
          kind: "square",
          label: "Choose the attacking rook",
          squares: mySquares(api.board, api.me, type).filter((sq) => dests(api, sq).length > 0),
        };
      }
      return { kind: "square", label: "Choose where the drive ends", squares: dests(api, picks[0].square!) };
    },
    (_inst, api, picks) => {
      const from = picks[0]?.square, to = picks[1]?.square;
      if (from == null || to == null || from === to) return;
      const df = Math.sign(FILE(to) - FILE(from)), dr = Math.sign(RANK(to) - RANK(from));
      let f = FILE(from) + df, r = RANK(from) + dr;
      const cleared: Square[] = [];
      while (inBoard(f, r)) {
        const sq = SQ(f, r);
        const p = api.board.pieces[sq];
        if (p && p.color === api.opp && p.type !== "k") {
          api.removePiece(sq);
          cleared.push(sq);
        }
        if (sq === to) break;
        f += df; r += dr;
      }
      if (!api.board.pieces[to]) api.relocate(from, to);
      // Bar the squares the drive punched through (the rook's own landing is
      // occupied, so barring it would be a no-op; drop it from the trail).
      const trail = cleared.filter((sq) => sq !== to);
      if (trail.length) {
        addEffect(api, { kind: "barred", squares: trail, against: api.opp, turns: barTurns });
      }
    },
  );
}

/** Like voidSquares, but the first enemy piece (never a king) to step onto a
 * mine is destroyed ALONG WITH every enemy piece on the squares around it (a
 * claymore blast; kings and shielded pieces survive). Mines stay armed for the
 * game. */
function claymoreSquares(count: number): Mech {
  return {
    kind: "activated",
    spendOnUse: false,
    targets: (inst, api, picks) =>
      picks.length >= count || inst.state.squares != null
        ? null
        : {
            kind: "square",
            label:
              count > 1 ? `Choose a mine square (${picks.length + 1}/${count})` : "Choose the mine square",
            squares: emptySquares(api.board).filter((sq) => !picks.some((k) => k.square === sq)),
          },
    effect: (inst, _api, picks) => {
      if (inst.state.squares != null) return;
      inst.state.squares = picks.map((k) => k.square).filter((s): s is Square => s != null);
    },
    onMovePlayed: (inst, move, api) => {
      const squares = inst.state.squares as Square[] | undefined;
      if (!squares?.length) return;
      if (move.color === api.opp && squares.includes(move.to) && move.piece !== "k") {
        explodeAt(api, move.to);
        api.removePiece(move.to);
      }
    },
    status: (inst) => {
      const squares = inst.state.squares as Square[] | undefined;
      if (!squares?.length) return "activate to place";
      const names = squares.map((sq) => `${"abcdefgh"[FILE(sq)]}${RANK(sq) + 1}`).join(", ");
      return `mines armed at ${names}`;
    },
  };
}

/** True when my piece on `from` attacks the opponent's king by its normal
 * movement (i.e. gives check): pawns by their capture diagonals, sliders
 * blocked by any intervening piece. Pure board geometry, read inside a move
 * filter only. */
function givesCheck(api: BuffApi, from: Square): boolean {
  const king = mySquares(api.board, api.opp, "k")[0];
  if (king == null) return false;
  const p = api.board.pieces[from];
  if (!p) return false;
  const df = FILE(king) - FILE(from), dr = RANK(king) - RANK(from);
  const adf = Math.abs(df), adr = Math.abs(dr);
  switch (p.type) {
    case "p":
      return dr === (p.color === "w" ? 1 : -1) && adf === 1;
    case "n":
      return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
    case "k":
      return adf <= 1 && adr <= 1;
    case "b":
      if (adf !== adr) return false;
      break;
    case "r":
      if (df !== 0 && dr !== 0) return false;
      break;
    case "q":
      if (adf !== adr && df !== 0 && dr !== 0) return false;
      break;
  }
  const sf = Math.sign(df), sr = Math.sign(dr);
  let f = FILE(from) + sf, r = RANK(from) + sr;
  while (inBoard(f, r) && SQ(f, r) !== king) {
    if (api.board.pieces[SQ(f, r)]) return false;
    f += sf; r += sr;
  }
  return true;
}

export const WILD_WARFARE: Buff[] = [
  // -------------------------------------------------------------------------
  // REINFORCEMENTS: bring more soldiers to the field.
  // -------------------------------------------------------------------------
  card(
    {
      id: "ww_reclaim_the_fallen",
      name: "Reclaim the Fallen",
      description: "Battlefield salvage: the next 2 enemy pawns you capture are pressed into service, joining your pocket to be dropped onto empty squares on later turns.",
      tier: 2,
      category: "pieces",
      flavor: "No body left behind. Especially not a useful one.",
      fx: { motif: "rally", pieces: "all", self: true },
    },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 2;
      },
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.me || move.captured !== "p") return;
        const left = (inst.state.charges as number) ?? 0;
        if (left <= 0) return;
        grantInventory(api, "p", 1);
        inst.state.charges = left - 1;
        if (left - 1 <= 0) inst.spent = true;
      },
      status: (inst) => `${(inst.state.charges as number) ?? 2} salvage claims left`,
    },
  ),
  card(
    {
      id: "ww_last_reserves",
      name: "Last Reserves",
      description: "Commit everything: pick empty squares on your back rank; after your opponent's next move, up to two of your captured knights or bishops return to them, once.",
      tier: 4,
      category: "pieces",
      flavor: "Pull the veterans off the bench. All of them.",
    },
    // Overhaul balance pass: the reserves no longer march up the instant you
    // call them; they arrive only after your opponent has replied.
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) => {
        if (inst.state.armed || picks.length >= 2) return null;
        const pool =
          ((api.capturedFromMe.n ?? 0) - (api.mine.revived.n ?? 0)) +
          ((api.capturedFromMe.b ?? 0) - (api.mine.revived.b ?? 0));
        if (pool - picks.length <= 0) return null;
        const rank = api.me === "w" ? 0 : 7;
        const squares = Array.from({ length: 8 }, (_, f) => SQ(f, rank)).filter(
          (sq) => !api.board.pieces[sq] && !picks.some((k) => k.square === sq),
        );
        if (!squares.length) return null;
        return {
          kind: "square",
          label: `Choose where a reserve returns (${picks.length + 1}/2)`,
          squares,
          ...(picks.length > 0 ? { finishable: true } : {}),
        };
      },
      effect: (inst, _api, picks) => {
        if (inst.state.armed) return;
        inst.state.armed = true;
        inst.state.squares = picks.map((k) => k.square).filter((s): s is Square => s != null);
      },
      onMovePlayed: (inst, move, api) => {
        if (!inst.state.armed || move.color !== api.opp) return;
        const squares = (inst.state.squares as Square[] | undefined) ?? [];
        for (const sq of squares) {
          if (api.board.pieces[sq]) continue;
          const type = (["n", "b"] as const).find(
            (t) => (api.capturedFromMe[t] ?? 0) - (api.mine.revived[t] ?? 0) > 0,
          );
          if (type == null) break;
          api.place(sq, type, api.me);
          markRevived(api, type);
        }
        inst.spent = true;
        inst.state.squares = undefined;
      },
      status: (inst) =>
        inst.state.armed
          ? "the reserves march up after your opponent's reply"
          : "activate to call up reserves",
    },
  ),
  card(
    {
      id: "ww_recommission",
      name: "Recommission",
      description: "Return one of your captured rooks to an empty square on your back rank. For the rest of the game the refitted rook may pass through one friendly piece on each move, landing only on an empty square (it cannot capture on a phased move).",
      tier: 5,
      category: "pieces",
      flavor: "Back into service, and it phases through its own ranks now.",
    },
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) => {
        if (picks.length > 0 || inst.state.sq != null) return null;
        if (revivable(api, "r") <= 0) return { kind: "square", label: "No rook to recommission", squares: [] };
        return { kind: "square", label: "Choose where the rook returns", squares: emptySquares(api.board, backRankZone(api)) };
      },
      effect: (inst, api, picks) => {
        if (inst.state.sq != null) return;
        const sq = picks[0]?.square;
        if (sq == null || revivable(api, "r") <= 0 || api.board.pieces[sq]) return;
        api.place(sq, "r", api.me);
        markRevived(api, "r");
        inst.state.sq = sq;
      },
      augmentMoves: (moves, inst, api) => {
        const sq = inst.state.sq as Square | undefined;
        if (sq == null) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.me || p.type !== "r") return;
        // Overhaul balance pass: the phased move may no longer capture.
        addNovel(moves, phasingSlideMoves(api.board, sq, ORTHO_DIRS, inst.id, 1).filter((m) => !m.captured));
      },
      onMovePlayed: (inst, move) => trackBoundPiece(inst, move),
      status: (inst) => {
        const sq = inst.state.sq as Square | undefined;
        return sq == null
          ? "activate to recommission a rook"
          : `refitted rook at ${"abcdefgh"[FILE(sq)]}${RANK(sq) + 1}`;
      },
    },
  ),
  card(
    {
      // Tier 4 (moved up from 3): Summon Knight (tier 3) plus a free pawn
      // advance is strictly more than the plain summon, so it prices a tier up.
      id: "ww_outriders",
      name: "Outriders",
      description: "Place a new knight on any empty square in your half, then up to two different pawns each advance one square behind it.",
      tier: 5,
      category: "pieces",
      flavor: "Cavalry ahead, infantry a step behind.",
    },
    // Overhaul balance pass: the old rider (one pawn step) left this a
    // near-copy of Summon Knight (tier 3). The outriders now escort the whole
    // line: up to TWO different pawns step up, a real development surge that
    // earns the tier gap while staying strictly-not-worse.
    {
      kind: "activated",
      spendOnUse: true,
      targets: (_inst, api, picks) => {
        if (picks.length === 0) {
          return { kind: "square", label: "Place your new knight", squares: emptySquares(api.board, myHalfZone(api)) };
        }
        if (picks.length <= 2) {
          const fwd = api.me === "w" ? 8 : -8;
          const taken = new Set(picks.slice(1).map((p) => p.square));
          const advancers = mySquares(api.board, api.me, "p").filter((sq) => {
            const to = sq + fwd;
            return (
              to >= 0 && to < 64 && !api.board.pieces[to] && pawnRankOk(to) &&
              to !== picks[0].square && !taken.has(sq) && !taken.has(to as Square)
            );
          });
          if (advancers.length === 0) return null;
          return {
            kind: "square",
            label: picks.length === 1 ? "Advance a pawn one square" : "Advance a second pawn, or finish",
            squares: advancers,
            finishable: true,
          };
        }
        return null;
      },
      effect: (_inst, api, picks) => {
        const knightSq = picks[0]?.square;
        if (knightSq != null && !api.board.pieces[knightSq]) api.place(knightSq, "n", api.me);
        const fwd = api.me === "w" ? 8 : -8;
        for (const pick of picks.slice(1, 3)) {
          const pawnSq = pick?.square;
          if (
            pawnSq != null &&
            api.board.pieces[pawnSq]?.type === "p" &&
            api.board.pieces[pawnSq]?.color === api.me
          ) {
            const to = pawnSq + fwd;
            if (to >= 0 && to < 64 && !api.board.pieces[to] && pawnRankOk(to)) api.relocate(pawnSq, to);
          }
        }
      },
    },
  ),
  card(
    {
      id: "ww_sapper_team",
      name: "Sapper Team",
      description: "The sappers surface behind their lines: place a new pawn on an empty square in your opponent's half of the board.",
      tier: 4,
      category: "pieces",
      flavor: "They dig the tunnels no one else will.",
    },
    placePieces(["p"], oppHalfZone),
  ),
  card(
    {
      id: "ww_muster_the_ranks",
      name: "Muster the Ranks",
      description: "The trumpet sounds and the whole line steps off: every one of your pawns with an empty square ahead advances one square. Pawns one step from the last rank hold their ground.",
      tier: 5,
      category: "movement",
      requires: ["p"],
      flavor: "The muster roll fills out fast.",
    },
    // Overhaul balance pass: the special move cannot capture. The advance is a
    // straight one-square step that only ever lands on an EMPTY square ahead
    // (the pawn never moves diagonally and never onto an occupied square), so
    // it can never capture by construction.
    instant((_inst, api) => {
      const fwd = api.me === "w" ? 8 : -8;
      // March the far ranks first so a pawn never blocks the one behind it.
      const pawns = mySquares(api.board, api.me, "p").sort(
        (a, b) => relRank(api.me, b) - relRank(api.me, a) || a - b,
      );
      for (const sq of pawns) {
        const to = sq + fwd;
        if (to < 0 || to > 63) continue;
        // Only an empty square ahead: this step never captures.
        if (!api.board.pieces[to] && pawnRankOk(to)) api.relocate(sq, to);
      }
    }),
  ),
  card(
    {
      id: "ww_combined_arms",
      name: "Combined Arms",
      description: "Armor learns from cavalry: for your next 3 turns, your rooks may also leap like knights.",
      tier: 6,
      category: "movement",
      requires: ["r"],
      flavor: "Armor and cavalry, moving as one.",
      fx: { motif: "empower", pieces: ["r"], moveAs: "n", self: true },
    },
    timedAugment(3, (_m, inst, api) =>
      mySquares(api.board, api.me, "r").flatMap((sq) =>
        leapMoves(api.board, sq, KNIGHT_LEAPS, inst.id),
      ),
    ),
  ),
  card(
    {
      id: "ww_shieldbearers",
      name: "Shieldbearers",
      description: "After your opponent's next move, while at least one of your pawns stands on a square beside your king, your king cannot be captured, for the rest of the game.",
      tier: 6,
      category: "protection",
      requires: ["p"],
      flavor: "Close ranks around the crown.",
      fx: { motif: "ward", pieces: ["k"], self: true },
    },
    // Overhaul balance pass: the immunity is shortened by one opponent turn, so
    // it does not switch on until after your opponent's next move.
    {
      kind: "passive",
      filterOpponentMoves: (moves, inst, api) => {
        if (!inst.state.started) return moves;
        const k = mySquares(api.board, api.me, "k")[0];
        if (k == null) return moves;
        let guarded = false;
        for (const [df, dr] of ALL_DIRS) {
          const f = FILE(k) + df, r = RANK(k) + dr;
          if (!inBoard(f, r)) continue;
          const p = api.board.pieces[SQ(f, r)];
          if (p && p.color === api.me && p.type === "p") {
            guarded = true;
            break;
          }
        }
        if (!guarded) return moves;
        const kept = moves.filter((m) => m.to !== k);
        // Safety net: never strand the opponent with zero moves.
        return kept.length > 0 ? kept : moves;
      },
      onMovePlayed: (inst, move, api) => {
        if (!inst.state.started && move.color === api.opp) inst.state.started = true;
      },
    },
  ),
  card(
    {
      // Not just a doubled Sapper Team (T3, the clean one-pawn drop): the
      // paratroopers DIG IN on landing. Both pawns are uncapturable for one
      // full turn, so they cannot simply be swatted before they act.
      id: "ww_paratroopers",
      icon: "Send",
      name: "Paratroopers",
      description: "Mark two empty squares in your opponent's half, once. After your opponent's next move a new pawn drops onto each square that is still empty: they dig in where they land, and neither can be captured for 1 full turn.",
      tier: 5,
      category: "pieces",
      flavor: "They land behind the lines and start filling sandbags.",
    },
    // Overhaul balance pass: the drop no longer lands the instant you call it in.
    // You mark the drop zones now; the paratroopers only touch down after your
    // opponent has replied once.
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) => {
        if (inst.state.armed || picks.length >= 2) return null;
        const squares = emptySquares(api.board, oppHalfZone(api)).filter(
          (sq) => pawnRankOk(sq) && !picks.some((k) => k.square === sq),
        );
        if (!squares.length) return null;
        return {
          kind: "square",
          label: `Mark a drop zone (${picks.length + 1}/2)`,
          squares,
          ...(picks.length > 0 ? { finishable: true } : {}),
        };
      },
      effect: (inst, _api, picks) => {
        if (inst.state.armed) return;
        inst.state.armed = true;
        inst.state.squares = picks.map((k) => k.square).filter((s): s is Square => s != null);
      },
      onMovePlayed: (inst, move, api) => {
        if (!inst.state.armed || move.color !== api.opp) return;
        const squares = (inst.state.squares as Square[] | undefined) ?? [];
        const landed: Square[] = [];
        for (const sq of squares) {
          if (!api.board.pieces[sq] && pawnRankOk(sq)) {
            api.place(sq, "p", api.me);
            landed.push(sq);
          }
        }
        if (landed.length) {
          addEffect(api, { kind: "shield", owner: api.me, squares: landed, turns: 1 });
        }
        inst.spent = true;
        inst.state.squares = undefined;
      },
      status: (inst) =>
        inst.state.armed
          ? "the drop lands after your opponent's reply"
          : "activate to mark drop zones",
    },
  ),
  card(
    {
      id: "ww_forward_outpost",
      name: "Forward Outpost",
      description: "Place a new rook on any empty square in your own half, once.",
      tier: 6,
      category: "pieces",
      flavor: "Plant the flag on ground you already hold.",
    },
    // Overhaul balance pass: the rook now musters in your OWN half rather than
    // being parachuted deep into the enemy's. It crosses the midline under its
    // own power on a later turn (by which point it has survived an opponent
    // reply), so no deep-strike the moment it appears.
    placePieces(["r"], myHalfZone),
  ),
  card(
    {
      id: "ww_bridgehead",
      name: "Bridgehead",
      description: "Place a new knight on an empty square in your half and a new pawn on an empty square on your fourth rank or lower, once.",
      tier: 6,
      category: "pieces",
      flavor: "Hold the near bank and build from it.",
    },
    // Overhaul balance pass: the reinforcements now form up on your own side of
    // the river. The knight spawns anywhere in your half and the pawn no higher
    // than your fourth rank, so neither can strike the moment it lands (they can
    // only reach the enemy after advancing on a later turn, past an opponent
    // reply).
    {
      kind: "activated",
      spendOnUse: true,
      targets: (_inst, api, picks) => {
        if (picks.length === 0) {
          return {
            kind: "square",
            label: "Place your new knight",
            squares: emptySquares(api.board, myHalfZone(api)),
          };
        }
        if (picks.length === 1) {
          return {
            kind: "square",
            label: "Place your new pawn on your fourth rank or lower",
            squares: emptySquares(
              api.board,
              (sq) => relRank(api.me, sq) <= 4 && pawnRankOk(sq),
            ).filter((sq) => sq !== picks[0].square),
          };
        }
        return null;
      },
      effect: (_inst, api, picks) => {
        const knightSq = picks[0]?.square;
        if (knightSq != null && !api.board.pieces[knightSq]) api.place(knightSq, "n", api.me);
        const pawnSq = picks[1]?.square;
        if (
          pawnSq != null &&
          !api.board.pieces[pawnSq] &&
          relRank(api.me, pawnSq) <= 4 &&
          pawnRankOk(pawnSq)
        ) {
          api.place(pawnSq, "p", api.me);
        }
      },
    },
  ),
  card(
    {
      id: "ww_forward_observer",
      name: "Forward Observer",
      description: "The observer calls in indirect fire: for your next turn, your rooks may capture an enemy piece along a rank or file even when exactly one piece stands in the way. The blocker is unharmed; the rook lands on its target.",
      tier: 4,
      category: "attack",
      requires: ["r"],
      flavor: "Eyes on the far ridge, shells over the hill.",
      fx: { motif: "empower", pieces: ["r"], self: true },
    },
    // Overhaul balance pass: the longest duration is shortened by one of your
    // turns (2 -> 1).
    timedAugment(1, (_m, inst, api) => {
      const out: Move[] = [];
      for (const from of mySquares(api.board, api.me, "r")) {
        for (const [df, dr] of ORTHO_DIRS) {
          let f = FILE(from) + df, r = RANK(from) + dr, passed = 0;
          while (inBoard(f, r)) {
            const to = SQ(f, r);
            const t = api.board.pieces[to];
            if (t) {
              if (passed === 0) {
                passed = 1;
              } else {
                if (t.color === api.opp) {
                  out.push({
                    from,
                    to,
                    piece: "r",
                    color: api.me,
                    captured: t.type,
                    capturedSquare: to,
                    via: inst.id,
                  });
                }
                break;
              }
            }
            f += df;
            r += dr;
          }
        }
      }
      return out;
    }),
  ),
  card(
    {
      id: "ww_reserve_cavalry",
      name: "Reserve Cavalry",
      description: "The reserve waits for the line to break: the first time your opponent captures one of your pieces, a knight rides in on the empty back-rank square nearest your king's file.",
      tier: 3,
      category: "pieces",
      flavor: "Held back for exactly this moment.",
      fx: { motif: "rally", pieces: "all", self: true },
    },
    {
      kind: "passive",
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.opp || !move.captured || move.captured === "k") return;
        const rank = api.me === "w" ? 0 : 7;
        const kf = (() => {
          const k = mySquares(api.board, api.me, "k")[0];
          return k == null ? 4 : FILE(k);
        })();
        let spot = -1, bestD = Infinity;
        for (let f = 0; f < 8; f++) {
          const sq = SQ(f, rank);
          if (api.board.pieces[sq]) continue;
          const d = Math.abs(f - kf);
          if (d < bestD) {
            bestD = d;
            spot = sq;
          }
        }
        if (spot >= 0) api.place(spot, "n", api.me);
        inst.spent = true;
      },
      status: () => "the reserve waits for the line to break",
    },
  ),
  card(
    {
      id: "ww_mercenary_queen",
      name: "Mercenary Queen",
      description: "Hire a sellsword who fights as a queen for 3 of your turns, then rides off with her pay.",
      tier: 6,
      category: "pieces",
      flavor: "Loyalty runs exactly as long as the contract.",
    },
    summonTemp("q", 3, myHalfZone),
  ),
  card(
    {
      id: "ww_field_hospital",
      icon: "Cross",
      name: "Field Hospital",
      description: "The first time your opponent captures one of your knights, a new pawn is raised on an empty square of your back rank.",
      tier: 2,
      category: "pieces",
      flavor: "For every rider lost, a recruit patched up and sent forward.",
      fx: { motif: "ward", pieces: ["n"], self: true },
    },
    {
      kind: "passive",
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.opp || move.captured !== "n") return;
        const r = api.me === "w" ? 0 : 7;
        const spot = Array.from({ length: 8 }, (_, f) => SQ(f, r)).find(
          (sq) => !api.board.pieces[sq],
        );
        if (spot != null) api.place(spot, "p", api.me);
        inst.spent = true;
      },
      status: () => "triage standing by",
    },
  ),

  // -------------------------------------------------------------------------
  // CHARGES & BOMBARDMENT: break the enemy line.
  // -------------------------------------------------------------------------
  card(
    {
      id: "ww_bayonet_charge",
      name: "Bayonet Charge",
      description: "One of your bishops charges diagonally, capturing the first enemy piece in its path and landing just beyond, once.",
      tier: 4,
      category: "attack",
      requires: ["b"],
      flavor: "Fix bayonets and do not stop.",
    },
    lineSweep("b", DIAG_DIRS, 1),
  ),
  card(
    {
      id: "ww_spearhead",
      name: "Spearhead",
      description: "One of your rooks drives in a straight line, capturing the first enemy piece in its path and stopping. The squares it punches through stay barred to your opponent for their next 2 turns.",
      tier: 4,
      category: "attack",
      requires: ["r"],
      flavor: "Punch a hole and hold it open.",
      fx: { motif: "blindfold" },
    },
    // Overhaul balance pass: of the two equal largest counts (up-to-two
    // captures, two barred turns) the capture count is reduced by one (2 -> 1).
    sweepThenBar("r", ORTHO_DIRS, 1, 2),
  ),
  card(
    {
      id: "ww_armored_breakthrough",
      name: "Armored Breakthrough",
      description: "One of your bishops spearheads the drive: it sweeps along one diagonal, capturing every enemy piece on it, and stops where the drive ends. Friendly pieces and enemy kings block the drive, once.",
      tier: 6,
      category: "attack",
      requires: ["b"],
      flavor: "Nothing in this lane survives the advance.",
    },
    lineSweep("b", DIAG_DIRS, null),
  ),
  card(
    {
      id: "ww_bombardment",
      icon: "Crosshair",
      name: "Bombardment",
      // Tier 4 (moved up from 3): two pawns of guaranteed material is the
      // doubled sibling of Cinder Strike (one pawn, tier 2).
      description: "Remove two enemy pawns you name from the board, once.",
      tier: 5,
      category: "attack",
      flavor: "Soften the trenches before the push.",
    },
    removeEnemies(2, ["p"]),
  ),
  card(
    {
      id: "ww_counter_battery",
      icon: "Target",
      name: "Counter Battery Fire",
      description: "Remove one enemy rook or bishop you name from the board, once.",
      tier: 6,
      category: "attack",
      flavor: "Silence their guns first.",
    },
    removeEnemies(1, ["r", "b"]),
  ),
  card(
    {
      id: "ww_demolition_charge",
      name: "Demolition Charge",
      description: "Rig one of your pieces with charges: each of its next two captures also destroys the enemy's least valuable piece standing next to the capture square (ties break toward the lower square). Kings are never caught in the blast.",
      tier: 5,
      category: "attack",
      flavor: "It goes off exactly where you point it.",
    },
    // Overhaul balance pass: the rig no longer clears the whole neighbourhood
    // for the game. It carries two charges, and each detonation takes only ONE
    // adjacent enemy non-king. The defender would keep their best, so the
    // deterministic loss is their least valuable adjacent piece (ties toward
    // the lower square).
    (() => {
      const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
      return {
        kind: "activated",
        spendOnUse: false,
        targets: (inst, api, picks) =>
          picks.length > 0 || inst.state.sq != null
            ? null
            : {
                kind: "square",
                label: "Choose the piece to rig with charges",
                squares: bindCandidates()(api),
              },
        effect: (inst, _api, picks) => {
          if (inst.state.sq != null) return;
          inst.state.sq = picks[0]?.square;
          inst.state.charges = 2;
        },
        onMovePlayed: (inst, move, api) => {
          const sq = inst.state.sq as Square | undefined;
          if (sq == null) return;
          if (
            move.from === sq &&
            move.color === api.me &&
            move.captured &&
            move.captured !== "k" &&
            ((inst.state.charges as number) ?? 0) > 0
          ) {
            const center = captureSquare(move) ?? move.to;
            const candidates: Square[] = [];
            for (const [df, dr] of ALL_DIRS) {
              const f = FILE(center) + df, r = RANK(center) + dr;
              if (!inBoard(f, r)) continue;
              const asq = SQ(f, r);
              const p = api.board.pieces[asq];
              if (p && p.color === api.opp && p.type !== "k") candidates.push(asq);
            }
            if (candidates.length) {
              const victim = candidates.reduce((best, s) => {
                const vs = VALUE[api.board.pieces[s]!.type];
                const vb = VALUE[api.board.pieces[best]!.type];
                return vs < vb || (vs === vb && s < best) ? s : best;
              });
              api.removePiece(victim);
            }
            const left = ((inst.state.charges as number) ?? 0) - 1;
            inst.state.charges = left;
            if (left <= 0) {
              inst.spent = true;
              inst.state.sq = undefined;
              return;
            }
          }
          trackBoundPiece(inst, move);
        },
        status: (inst) => {
          const sq = inst.state.sq as Square | undefined;
          if (sq == null) return "activate to rig a piece";
          return `rigged at ${"abcdefgh"[FILE(sq)]}${RANK(sq) + 1}, ${(inst.state.charges as number) ?? 0} charges left`;
        },
      };
    })(),
  ),

  // -------------------------------------------------------------------------
  // VETERAN UPGRADES: one piece is trained into something more (for the game).
  // -------------------------------------------------------------------------
  card(
    {
      id: "ww_dragoons",
      name: "Dragoons",
      description: "One of your knights trains to vault the line: it may also jump exactly two squares straight in any direction, over anything, for the game.",
      tier: 3,
      category: "movement",
      requires: ["n"],
      flavor: "Ride to the fight, vault the wall to win it.",
      fx: { motif: "empower", pieces: ["n"], moveAs: "n", self: true },
    },
    pieceBound("n", "Choose the knight to train as dragoons", (board, sq, via) =>
      leapMoves(board, sq, [[2, 0], [-2, 0], [0, 2], [0, -2]], via),
    ),
  ),
  card(
    {
      id: "ww_pikemen",
      name: "Pikemen",
      description: "One of your pawns may also move and capture one square sideways, for the game.",
      tier: 3,
      category: "movement",
      requires: ["p"],
      flavor: "The hedge of pikes points every way at once.",
      fx: { motif: "empower", pieces: ["p"], self: true },
    },
    pieceBound("p", "Choose the pawn to arm with a pike", (board, sq, via) =>
      slideMoves(board, sq, [[1, 0], [-1, 0]], via, 1),
    ),
  ),
  card(
    {
      id: "ww_war_wagon",
      name: "War Wagon",
      description: "One of your bishops may also move, without capturing, up to two squares straight in any direction, for the game.",
      tier: 3,
      category: "movement",
      requires: ["b"],
      flavor: "A rolling fort with a blade on top.",
      fx: { motif: "empower", pieces: ["b"], moveAs: "r", self: true },
    },
    // Overhaul balance pass: the added straight move may no longer capture.
    pieceBound("b", "Choose the bishop to mount on a war wagon", (board, sq, via) =>
      slideMoves(board, sq, ORTHO_DIRS, via, 2).filter((m) => !m.captured),
    ),
  ),
  card(
    {
      id: "ww_command_tent",
      icon: "Tent",
      name: "Command Tent",
      description: "Your king may also leap like a knight to an empty square, without capturing, for the game.",
      tier: 4,
      category: "movement",
      flavor: "The general is never quite where they left him.",
      fx: { motif: "empower", pieces: ["k"], moveAs: "n", self: true },
    },
    // Overhaul balance pass: the knight leaps may no longer capture.
    pieceBound("k", "Confirm your king takes command", (board, sq, via) =>
      leapMoves(board, sq, KNIGHT_LEAPS, via).filter((m) => !m.captured),
    ),
  ),
  card(
    {
      id: "ww_phalanx_advance",
      name: "Phalanx Advance",
      description: "Shields lock across the front: enemy pawns can never capture your pawns, save your single most advanced pawn (furthest forward, ties toward the a-file) whenever more than one of your pawns stands. For the rest of the game.",
      tier: 3,
      category: "protection",
      requires: ["p"],
      flavor: "Shields locked, the whole line moves together.",
      fx: { motif: "ward", pieces: ["p"], self: true },
    },
    // Overhaul balance pass: the permanent shield now covers one fewer pawn
    // (minimum one still covered): your single most advanced pawn is left
    // exposed while you hold more than one pawn.
    {
      kind: "passive",
      filterOpponentMoves: (moves, _inst, api) => {
        const pawns = mySquares(api.board, api.me, "p");
        // The one unprotected pawn: most advanced, ties toward the a-file. Only
        // when at least two pawns stand (never drop protection below one pawn).
        let exposed: Square | null = null;
        if (pawns.length >= 2) {
          exposed = pawns.reduce((best, sq) => {
            const rs = relRank(api.me, sq), rb = relRank(api.me, best);
            return rs > rb || (rs === rb && sq < best) ? sq : best;
          });
        }
        const kept = moves.filter((m) => {
          if (m.piece !== "p") return true;
          const cap = captureSquare(m);
          if (cap == null) return true;
          const target = api.board.pieces[cap];
          if (!(target && target.color === api.me && target.type === "p")) return true;
          // The exposed pawn may still be captured; every other pawn is shielded.
          return cap === exposed;
        });
        // Safety net: never strand the opponent with zero moves.
        return kept.length > 0 ? kept : moves;
      },
    },
  ),

  // -------------------------------------------------------------------------
  // ARMY-WIDE DRILLS: grants across a whole piece type.
  // -------------------------------------------------------------------------
  card(
    {
      id: "ww_flanking_knights",
      name: "Flanking Knights",
      description: "Both of your knights may also step one square in any direction like a king, without capturing, for the game.",
      tier: 4,
      category: "movement",
      requires: ["n"],
      flavor: "Hit them from two sides at once.",
      fx: { motif: "empower", pieces: ["n"], moveAs: "k", self: true },
    },
    // Overhaul balance pass: the added king-steps may no longer capture.
    permanentAugment((_m, inst, api) =>
      mySquares(api.board, api.me, "n").flatMap((sq) =>
        slideMoves(api.board, sq, ALL_DIRS, inst.id, 1).filter((m) => !m.captured),
      ),
    ),
  ),
  card(
    {
      id: "ww_field_fortification",
      name: "Field Fortification",
      description: "After your opponent's next move, your pawns may also capture the enemy piece directly ahead of them, for the rest of the game.",
      tier: 4,
      category: "movement",
      requires: ["p"],
      flavor: "Dug in and biting back.",
      fx: { motif: "empower", pieces: ["p"], self: true },
    },
    // Overhaul balance pass: the permanent grant cannot be shortened, so its
    // start is delayed instead: the forward capture only switches on after your
    // opponent has replied once.
    {
      kind: "passive",
      augmentMoves: (moves, inst, api) => {
        if (!inst.state.started) return;
        addNovel(moves, forwardCaptureGen(inst, api));
      },
      onMovePlayed: (inst, move, api) => {
        if (!inst.state.started && move.color === api.opp) inst.state.started = true;
      },
    },
  ),
  card(
    {
      id: "ww_flank_march",
      name: "Flank March",
      description: "For up to your next 3 turns, each of your bishops may also step one square straight in any direction. This ends the first turn you play without taking one of those steps.",
      tier: 3,
      category: "movement",
      requires: ["b"],
      flavor: "Off the diagonal and around the wing.",
      fx: { motif: "empower", pieces: ["b"], moveAs: "k", self: true },
    },
    // Overhaul balance pass: the granted step is unchanged, but the window now
    // burns out the first of your turns you play without taking one of these
    // steps (a wasted turn spends the charge just as a failed attempt would).
    {
      kind: "passive",
      init: (inst) => {
        inst.state.turns = 3;
      },
      augmentMoves: (moves, inst, api) => {
        if (((inst.state.turns as number) ?? 0) <= 0) return;
        addNovel(
          moves,
          mySquares(api.board, api.me, "b").flatMap((sq) =>
            slideMoves(api.board, sq, ORTHO_DIRS, inst.id, 1),
          ),
        );
      },
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.me) return;
        if (move.via === inst.id) {
          const t = ((inst.state.turns as number) ?? 0) - 1;
          inst.state.turns = t;
          if (t <= 0) inst.spent = true;
        } else {
          inst.spent = true;
        }
      },
      status: (inst) => `${(inst.state.turns as number) ?? 0} of your turns left`,
    },
  ),
  card(
    {
      id: "ww_pontoon_bridge",
      name: "Pontoon Bridge",
      description: "One of your rooks, bishops, or queens may pass through up to two of your own pieces on its move, landing only on an empty square, once.",
      tier: 3,
      category: "movement",
      requires: ["r", "b", "q"],
      flavor: "Lay the planks, cross your own crowd.",
      fx: { motif: "empower", pieces: ["r", "b", "q"], self: true },
    },
    // Overhaul balance pass: the single-use crossing may no longer end on a
    // capture; the phased move can only settle on an empty square.
    augment((_m, inst, api) => {
      const out: Move[] = [];
      for (const sq of mySquares(api.board, api.me)) {
        const t = api.board.pieces[sq]!.type;
        const dirs = t === "r" ? ORTHO_DIRS : t === "b" ? DIAG_DIRS : t === "q" ? ALL_DIRS : null;
        if (dirs) {
          out.push(...phasingSlideMoves(api.board, sq, dirs, inst.id, 2).filter((m) => !m.captured));
        }
      }
      return out;
    }),
  ),

  // -------------------------------------------------------------------------
  // MANEUVER: reposition your own line, shove the enemy's.
  // -------------------------------------------------------------------------
  card(
    {
      id: "ww_regroup_lines",
      name: "Regroup the Lines",
      description: "Sound the recall: every one of your pieces standing in the enemy half falls back one square toward home, wherever the square behind it is free.",
      tier: 3,
      category: "movement",
      flavor: "Fall back, re-form, hold.",
    },
    instant((_inst, api) => {
      const back = api.me === "w" ? -8 : 8;
      // Pull back the pieces nearest home first so space opens up behind the
      // ones deeper in (deterministic order on every replica).
      const mine = mySquares(api.board, api.me)
        .filter((sq) => inHalf(api.opp, sq) && api.board.pieces[sq]!.type !== "k")
        .sort((a, b) => relRank(api.me, a) - relRank(api.me, b) || a - b);
      for (const sq of mine) {
        const to = sq + back;
        if (to < 0 || to > 63) continue;
        const p = api.board.pieces[sq]!;
        if (!api.board.pieces[to] && (p.type !== "p" || pawnRankOk(to))) {
          api.relocate(sq, to);
        }
      }
    }),
  ),
  card(
    {
      id: "ww_forced_retreat",
      name: "Forced Retreat",
      description: "Mark one enemy piece, a king aside: after your opponent's next move it is pushed one square directly away from your king, if that square is empty, once. Kings cannot be pushed.",
      tier: 3,
      category: "tempo",
      flavor: "Give ground, general's orders.",
    },
    // Overhaul balance pass: the payoff is unchanged, but the push no longer
    // lands the instant you mark the target: it waits until after your
    // opponent has replied (the marked piece is followed if they move it).
    (() => {
      const destOf = (api: BuffApi, sq: Square): Square | null => {
        const k = mySquares(api.board, api.me, "k")[0];
        if (k == null) return null;
        const df = Math.sign(FILE(sq) - FILE(k)), dr = Math.sign(RANK(sq) - RANK(k));
        if (df === 0 && dr === 0) return null;
        const f = FILE(sq) + df, r = RANK(sq) + dr;
        if (!inBoard(f, r)) return null;
        const to = SQ(f, r);
        if (api.board.pieces[to]) return null;
        // Never push an enemy pawn onto a rank a pawn may not stand on.
        if (api.board.pieces[sq]?.type === "p" && !pawnRankOk(to)) return null;
        return to;
      };
      return {
        kind: "activated",
        spendOnUse: false,
        targets: (inst, api, picks) =>
          picks.length > 0 || inst.state.armed
            ? null
            : {
                kind: "square",
                label: "Choose the enemy piece to push back",
                squares: mySquares(api.board, api.opp).filter(
                  (sq) => api.board.pieces[sq]!.type !== "k" && destOf(api, sq) != null,
                ),
              },
        effect: (inst, _api, picks) => {
          if (inst.state.armed) return;
          const from = picks[0]?.square;
          if (from == null) return;
          inst.state.armed = true;
          inst.state.sq = from;
        },
        onMovePlayed: (inst, move, api) => {
          if (!inst.state.armed || inst.state.sq == null) return;
          // The marked piece may be captured or moved before the push lands.
          if (move.capturedSquare === inst.state.sq && move.from !== inst.state.sq) {
            inst.spent = true;
            inst.state.sq = undefined;
            return;
          }
          if (move.from === inst.state.sq) inst.state.sq = move.to;
          if (move.color !== api.opp) return;
          const from = inst.state.sq as Square;
          const to = destOf(api, from);
          if (to != null) api.relocate(from, to);
          inst.spent = true;
          inst.state.sq = undefined;
        },
        status: (inst) =>
          inst.state.armed
            ? "the push lands after your opponent's reply"
            : "activate to mark an enemy piece",
      };
    })(),
  ),

  // -------------------------------------------------------------------------
  // FORTIFICATIONS & DEFENSE: shields, walls, bodyguards.
  // -------------------------------------------------------------------------
  card(
    {
      id: "ww_form_square",
      name: "Form Square",
      description: "Pick any square: your pieces standing on it or any of the up-to-eight squares around it, your king aside, cannot be captured for your opponent's next turn.",
      tier: 5,
      category: "protection",
      flavor: "Backs together, blades out.",
    },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the center of the square formation",
              squares: Array.from({ length: 64 }, (_, i) => i),
            },
      (_inst, api, picks) => {
        const c = picks[0]?.square;
        if (c == null) return;
        const squares: Square[] = [c];
        for (const [df, dr] of ALL_DIRS) {
          const f = FILE(c) + df, r = RANK(c) + dr;
          if (inBoard(f, r)) squares.push(SQ(f, r));
        }
        // Overhaul balance pass: the immunity is shortened by one opponent turn
        // (2 -> 1).
        addEffect(api, { kind: "shield", owner: api.me, squares, turns: 1 });
      },
    ),
  ),
  card(
    {
      id: "ww_dug_in_defense",
      name: "Dug-In Defense",
      description: "Dig four foxholes: choose up to four of your pieces; they cannot be captured for your opponent's next 3 turns.",
      tier: 7,
      category: "protection",
      flavor: "Foxholes enough to weather anything.",
      fx: { motif: "ward", pieces: "all", self: true },
    },
    // Overhaul balance pass: the same 3-turn dig now shelters up to FOUR chosen
    // pieces (was three).
    activated(
      (_inst, api, picks) =>
        picks.length >= 4
          ? null
          : {
              kind: "square",
              label: `Choose a piece to dig in (${picks.length + 1}/4)`,
              squares: mySquares(api.board, api.me).filter(
                (sq) =>
                  api.board.pieces[sq]!.type !== "k" && !picks.some((k) => k.square === sq),
              ),
              ...(picks.length > 0 ? { finishable: true } : {}),
            },
      (_inst, api, picks) => {
        const squares = picks
          .map((k) => k.square)
          .filter((s): s is Square => s != null);
        if (squares.length) {
          addEffect(api, { kind: "shield", owner: api.me, squares, turns: 3 });
        }
      },
    ),
  ),
  card(
    {
      id: "ww_iron_bulwark",
      name: "Iron Bulwark",
      description: "Choose one of your pieces, your king aside: while it stands in your half it cannot be captured, and enemy pieces standing next to it cannot capture at all.",
      tier: 7,
      category: "protection",
      flavor: "Hold your own ground and nobody gets a swing in.",
      fx: { motif: "ward", self: true },
    },
    bindPiece("Choose the piece to make a bulwark", bindCandidates(), {
      filterOpp: (moves, sq, api) => {
        if (!inHalf(api.me, sq)) return moves;
        const kept = moves.filter((m) => {
          if (captureSquare(m) === sq) return false;
          if (m.captured) {
            const d = Math.max(Math.abs(FILE(m.from) - FILE(sq)), Math.abs(RANK(m.from) - RANK(sq)));
            if (d === 1) return false;
          }
          return true;
        });
        return kept.length > 0 ? kept : moves;
      },
    }),
  ),
  card(
    {
      id: "ww_praetorian_guard",
      name: "Praetorian Guard",
      description: "Choose one of your pieces: for your next 4 turns it cannot be captured and may also step one square in any direction like a king.",
      tier: 6,
      category: "protection",
      flavor: "Sworn to the last, and quick about it.",
      fx: { motif: "ward", moveAs: "k", self: true },
    },
    bindPiece("Choose the piece the guard protects", bindCandidates(), {
      turns: 4,
      gen: (board, sq, via) => slideMoves(board, sq, ALL_DIRS, via, 1),
      filterOpp: (moves, sq) => moves.filter((m) => captureSquare(m) !== sq),
    }),
  ),
  card(
    {
      id: "ww_high_ground",
      name: "High Ground",
      description: "Choose one of your pieces: for the game it cannot be captured while it stands in your opponent's half, but its shield drops on any turn it is giving check to the enemy king.",
      tier: 5,
      category: "protection",
      flavor: "They have to climb to reach you, and they will not.",
      fx: { motif: "ward", self: true },
    },
    // Overhaul balance pass: the protected piece cannot give check from behind
    // an untouchable shield. A buff cannot forbid the owner's own moves, so the
    // enforceable reading is the mirror: whenever the piece is giving check, its
    // invulnerability lapses for that turn and the opponent may capture the
    // checker to answer the check.
    bindPiece("Choose the piece that takes the high ground", bindCandidates(), {
      filterOpp: (moves, sq, api) =>
        inHalf(api.opp, sq) && !givesCheck(api, sq)
          ? moves.filter((m) => captureSquare(m) !== sq)
          : moves,
    }),
  ),

  // -------------------------------------------------------------------------
  // SIEGE & SEALED GROUND: deny the enemy the map.
  // -------------------------------------------------------------------------
  card(
    {
      id: "ww_double_trench",
      name: "Double Trench",
      description: "Pick two files: your opponent cannot move onto either file for their next 2 turns, and any enemy piece standing on those files cannot capture in that time. Committing the trench spends the card even if it catches nothing.",
      tier: 6,
      category: "protection",
      flavor: "Two lines of wire, and the guns behind them jam.",
      fx: { motif: "blindfold" },
    },
    // Overhaul balance pass: a failed or wasted attempt still spends the charge.
    // This card has no failable granted MOVE (activation is always legal: any
    // two files can be chosen), so per the directive's fallback the single use
    // is committal, the moment the files are set the card is used up and can
    // never be re-aimed, whether or not the trenches ever trap a piece.
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) =>
        picks.length >= 2 || inst.state.files != null
          ? null
          : {
              kind: "square",
              label: `Pick any square on a file to trench (${picks.length + 1}/2)`,
              squares: Array.from({ length: 64 }, (_, i) => i).filter(
                (sq) => !picks.some((k) => k.square != null && FILE(k.square) === FILE(sq)),
              ),
            },
      effect: (inst, api, picks) => {
        if (inst.state.files != null) return;
        const files = picks
          .map((k) => k.square)
          .filter((s): s is Square => s != null)
          .map((sq) => FILE(sq));
        inst.state.files = files;
        inst.state.turns = 2;
        for (const file of files) {
          const squares: Square[] = [];
          for (let r = 0; r < 8; r++) squares.push(SQ(file, r));
          addEffect(api, { kind: "barred", squares, against: api.opp, turns: 2 });
        }
      },
      filterOpponentMoves: (moves, inst) => {
        const files = inst.state.files as number[] | undefined;
        if (!files?.length || ((inst.state.turns as number) ?? 0) <= 0) return moves;
        const kept = moves.filter((m) => !(m.captured && files.includes(FILE(m.from))));
        return kept.length > 0 ? kept : moves;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.state.files == null || move.color !== api.opp) return;
        const left = ((inst.state.turns as number) ?? 0) - 1;
        inst.state.turns = left;
        if (left <= 0) inst.spent = true;
      },
      status: (inst) =>
        inst.state.files == null
          ? "activate to dig the trenches"
          : `trenches hold, ${(inst.state.turns as number) ?? 0} of their turns left`,
    },
  ),
  card(
    {
      id: "ww_claymore_line",
      name: "Claymore Line",
      description: "Mark two empty squares: the first enemy piece to step onto either one, a king aside, is destroyed along with every enemy piece on the squares around it. The mines stay armed for the game.",
      tier: 5,
      category: "protection",
      flavor: "Front toward enemy.",
      fx: { motif: "blindfold" },
    },
    claymoreSquares(2),
  ),

  // -------------------------------------------------------------------------
  // AMBUSH & SUPPRESSION: freeze, convert, retaliate.
  // -------------------------------------------------------------------------
  card(
    {
      id: "ww_suppressive_fire",
      name: "Suppressive Fire",
      description: "After your opponent's next move, every one of their knights is pinned down for their next 2 turns, and so is every enemy pawn standing directly beside one.",
      tier: 4,
      category: "tempo",
      flavor: "Keep their heads down, and their diggers too.",
      fx: { motif: "jail", pieces: ["n", "p"] },
    },
    // Overhaul balance pass: the pin-down no longer lands the moment the card
    // is played; it triggers only after your opponent has replied once.
    {
      kind: "passive",
      onMovePlayed: (inst, move, api) => {
        if (inst.state.fired || move.color !== api.opp) return;
        const knights = mySquares(api.board, api.opp, "n");
        const frozen = new Set<Square>();
        for (const sq of knights) {
          addEffect(api, { kind: "freeze", sq, owner: api.opp, turns: 2 });
          frozen.add(sq);
        }
        for (const ksq of knights) {
          for (const [df, dr] of ORTHO_DIRS) {
            const f = FILE(ksq) + df, r = RANK(ksq) + dr;
            if (!inBoard(f, r)) continue;
            const asq = SQ(f, r);
            const p = api.board.pieces[asq];
            if (p && p.color === api.opp && p.type === "p" && !frozen.has(asq)) {
              addEffect(api, { kind: "freeze", sq: asq, owner: api.opp, turns: 2 });
              frozen.add(asq);
            }
          }
        }
        inst.state.fired = true;
        inst.spent = true;
      },
      status: (inst) =>
        inst.state.fired ? "suppression laid down" : "fire falls after your opponent's reply",
    },
  ),
  card(
    {
      id: "ww_pincer_movement",
      name: "Pincer Movement",
      description: "Close both jaws at once: every enemy piece except a king caught directly between two of your pieces (left and right, above and below, or across a diagonal) is pinned and frozen for 2 of their turns.",
      tier: 6,
      category: "tempo",
      flavor: "Close both jaws at the same time.",
      fx: { motif: "jail" },
    },
    instant((_inst, api) => {
      const axes: [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]];
      for (const sq of mySquares(api.board, api.opp)) {
        if (api.board.pieces[sq]!.type === "k") continue;
        let pinched = false;
        for (const [df, dr] of axes) {
          const f1 = FILE(sq) + df, r1 = RANK(sq) + dr;
          const f2 = FILE(sq) - df, r2 = RANK(sq) - dr;
          if (!inBoard(f1, r1) || !inBoard(f2, r2)) continue;
          const a = api.board.pieces[SQ(f1, r1)];
          const b = api.board.pieces[SQ(f2, r2)];
          if (a && b && a.color === api.me && b.color === api.me) {
            pinched = true;
            break;
          }
        }
        if (pinched) addEffect(api, { kind: "freeze", sq, owner: api.opp, turns: 2 });
      }
    }),
  ),
  card(
    {
      id: "ww_counter_charge",
      name: "Counter Charge",
      description: "The first time your opponent captures one of your pieces, the capturing piece is frozen in place for its next 2 turns.",
      tier: 3,
      category: "tempo",
      flavor: "Take one of ours and you stop where you stand.",
      fx: { motif: "jail" },
    },
    {
      kind: "passive",
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.opp || !move.captured || move.captured === "k") return;
        const at = move.to;
        const p = api.board.pieces[at];
        if (p && p.color === api.opp && p.type !== "k") {
          addEffect(api, { kind: "freeze", sq: at, owner: api.opp, turns: 3 });
        }
        inst.spent = true;
      },
      status: () => "braced for their attack",
    },
  ),
  card(
    {
      id: "ww_defectors",
      name: "Defectors",
      description: "Mark one enemy pawn or knight: after your opponent's next move it turns to your side for the rest of the game, once. Kings cannot be swayed.",
      tier: 4,
      category: "pieces",
      flavor: "Better pay, warmer tent.",
    },
    // Overhaul balance pass: the defection no longer resolves the moment you
    // mark the piece; it crosses over only after your opponent has replied (the
    // marked piece is followed if they move it first).
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) =>
        picks.length > 0 || inst.state.armed
          ? null
          : {
              kind: "square",
              label: "Choose the enemy piece to win over",
              squares: mySquares(api.board, api.opp).filter((sq) => {
                const t = api.board.pieces[sq]!.type;
                return t === "p" || t === "n";
              }),
            },
      effect: (inst, _api, picks) => {
        if (inst.state.armed) return;
        const sq = picks[0]?.square;
        if (sq == null) return;
        inst.state.armed = true;
        inst.state.sq = sq;
      },
      onMovePlayed: (inst, move, api) => {
        if (!inst.state.armed || inst.state.sq == null) return;
        if (move.capturedSquare === inst.state.sq && move.from !== inst.state.sq) {
          inst.spent = true;
          inst.state.sq = undefined;
          return;
        }
        if (move.from === inst.state.sq) inst.state.sq = move.to;
        if (move.color !== api.opp) return;
        const sq = inst.state.sq as Square;
        const p = api.board.pieces[sq];
        if (p && p.color === api.opp && p.type !== "k") api.setPieceColor(sq, api.me);
        inst.spent = true;
        inst.state.sq = undefined;
      },
      status: (inst) =>
        inst.state.armed
          ? "the defector crosses over after your opponent's reply"
          : "activate to choose an enemy piece",
    },
  ),
  card(
    {
      id: "ww_mass_defection",
      name: "Mass Defection",
      // Tier 5 (moved up from 4): converting two pawns is a four-point swing,
      // the doubled sibling of Piece Steal (one pawn, tier 3).
      description: "Mark two enemy pawns: after your opponent's next move they turn to your side for the rest of the game, once.",
      tier: 5,
      category: "pieces",
      flavor: "Word spreads down the whole trench.",
    },
    // Overhaul balance pass: the conversion is permanent (no timed duration to
    // shorten), so the directive's other lever applies, the pawns no longer
    // switch the instant you name them. You mark them now and they cross over
    // only after your opponent has replied (each marked pawn is followed if it
    // moves first, and dropped if it is captured before the switch), mirroring
    // this file's Defectors card.
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) =>
        picks.length >= 2 || inst.state.armed
          ? null
          : {
              kind: "square",
              label: `Choose an enemy pawn to win over (${picks.length + 1}/2)`,
              squares: mySquares(api.board, api.opp).filter(
                (sq) =>
                  api.board.pieces[sq]!.type === "p" && !picks.some((k) => k.square === sq),
              ),
              ...(picks.length > 0 ? { finishable: true } : {}),
            },
      effect: (inst, _api, picks) => {
        if (inst.state.armed) return;
        inst.state.armed = true;
        inst.state.squares = picks.map((k) => k.square).filter((s): s is Square => s != null);
      },
      onMovePlayed: (inst, move, api) => {
        if (!inst.state.armed) return;
        let squares = (inst.state.squares as Square[] | undefined) ?? [];
        // A marked pawn may be captured or moved before the switch lands.
        squares = squares
          .filter((s) => !(move.capturedSquare === s && move.from !== s))
          .map((s) => (move.from === s ? move.to : s));
        inst.state.squares = squares;
        if (move.color !== api.opp) return;
        for (const sq of squares) {
          const p = api.board.pieces[sq];
          if (p && p.color === api.opp && p.type !== "k") api.setPieceColor(sq, api.me);
        }
        inst.spent = true;
        inst.state.squares = undefined;
      },
      status: (inst) =>
        inst.state.armed
          ? "the defectors cross over after your opponent's reply"
          : "activate to choose enemy pawns",
    },
  ),
  card(
    {
      id: "ww_relentless_assault",
      name: "Relentless Assault",
      description: "Each of your next two capturing moves immediately grants you an extra move. You cannot capture the king on a bonus move: your opponent replies first. Once both bonus moves are spent, you skip your next draft.",
      tier: 5,
      category: "tempo",
      flavor: "Do not let them set their feet.",
      fx: { motif: "rally", pieces: "all", self: true },
    },
    // Overhaul balance pass: every bonus move is preserved, but the tempo burst
    // now costs you tempo in the draft, once the sequence resolves you skip your
    // next draft (self blockedDrafts +1).
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 2;
      },
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.me || !move.captured || move.captured === "k") return;
        const left = ((inst.state.charges as number) ?? 0) - 1;
        inst.state.charges = left;
        api.bs.extraMoves[api.me] += 1;
        if (left <= 0) {
          api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 1;
          inst.spent = true;
        }
      },
      status: (inst) => `${(inst.state.charges as number) ?? 2} follow-up assaults left`,
    },
  ),
];
