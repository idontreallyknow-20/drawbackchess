// Boon wave 2 — the 2026-07 nerf-mode expansion's boon batch. Boons are the
// rarer, stranger, more transformative side of the draft pool: miracles,
// contracts, rare transformations, comeback engines — never just bigger
// numbers. Every card here carries `boon: true` so it joins nerf mode's
// boon/item bucket, plus a normal BuffCategory for codex grouping.
// Spread into ALL_BUFFS by library.ts; ids must not collide with existing
// cards. Animation flagships live in src/components/effects/boonPlays.tsx.
//
// Design notes (mechanics survey, tier ladder, cut designs):
// docs/2026-07-17-boon-wave2-design.md
//
// Every mechanic below rides EXISTING engine rails only: ActiveEffect kinds,
// DraftFlags, the BuffApi mutators, augmentMoves / filterOpponentMoves /
// onMovePlayed, the revive pools and the crazyhouse pocket. Randomness is
// drawn ONLY from api.rng inside effect hooks (Carnival of Masks), never in
// targets/status, so every replica replays the identical outcome.
//
// Import paths are relative (not the "@/" alias): tsconfig.server.json does
// not resolve the alias, and the engine must build for the server tests.

import { isInCheck } from "../board";
import { Buff, BuffApi, CardFx } from "../buff";
import { Tier } from "../nerf";
import { BoardState, Color, FILE, Move, PieceType, RANK, SQ, Square, inBoard } from "../types";
import {
  ALL_DIRS,
  KNIGHT_LEAPS,
  activated,
  activatedSimple,
  addEffect,
  addNovel,
  augment,
  captureSquare,
  emptySquares,
  grantInventory,
  inHalf,
  instant,
  markRevived,
  mySquares,
  oppFilter,
  pawnRankOk,
  permanentAugment,
  pieceBound,
  relRank,
  revivable,
  slideMoves,
  teleportMoves,
  timedAugment,
  timedOppFilter,
} from "./helpers";

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

/** Build a fully implemented wave-2 boon: `boon: true` is stamped on every
 * card so the whole batch joins nerf mode's boon/item bucket. */
function boon(meta: Meta, mech: Mech): Buff {
  return { ...meta, boon: true, implemented: true, ...mech };
}

/** Non-king piece count for `color` (comeback gates read this). */
function armySize(board: BoardState, color: Color): number {
  let n = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = board.pieces[sq];
    if (p && p.color === color && p.type !== "k") n++;
  }
  return n;
}

/** First empty square scanning outward from `color`'s home rank (files a-h
 * within each rank), skipping squares a pawn may not stand on. Deterministic
 * pure read of the board, so auto-placement replays identically everywhere. */
function autoPlaceSquare(api: BuffApi, color: Color, type: PieceType): Square | null {
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

/** Value order for "best captured piece" style effects. */
const VALUE_ORDER: PieceType[] = ["q", "r", "b", "n", "p"];

/** Best piece type I have captured from the opponent that they have not
 * already revived (their revive pool). Null when nothing qualifies. */
function bestDefector(api: BuffApi): PieceType | null {
  for (const t of VALUE_ORDER) {
    if ((api.capturedByMe[t] ?? 0) - (api.theirs.revived[t] ?? 0) > 0) return t;
  }
  return null;
}

/** The last move the opponent completed, if any (pure history read). */
function lastOppMove(api: BuffApi): Move | null {
  const hist = api.board.history;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].color === api.opp) return hist[i];
  }
  return null;
}

/** Diplomatic Immunity's mechanic: a one-time piece bind whose opponent-move
 * filter only bites while the bound piece stands on FOREIGN soil. Mirrors
 * bindPiece's shape (one bind, tracked square, capture kills the card)
 * without the shield/turn machinery. */
function pieceBoundImmunity(): Mech {
  return {
    kind: "activated",
    spendOnUse: false,
    targets: (inst, api, picks) =>
      picks.length > 0 || inst.state.sq != null
        ? null
        : {
            kind: "square",
            label: "Choose your envoy",
            squares: mySquares(api.board, api.me).filter(
              (sq) => api.board.pieces[sq]!.type !== "k",
            ),
          },
    effect: (inst, api, picks) => {
      const sq = picks[0]?.square;
      if (sq == null || inst.state.sq != null) return;
      const p = api.board.pieces[sq];
      if (!p || p.color !== api.me || p.type === "k") return;
      inst.state.sq = sq;
    },
    filterOpponentMoves: (moves, inst, api) => {
      const sq = inst.state.sq as Square | undefined;
      if (sq == null) return moves;
      const p = api.board.pieces[sq];
      if (!p || p.color !== api.me) return moves;
      // Immunity only on foreign soil (the opponent's half).
      if (inHalf(api.me, sq)) return moves;
      const kept = moves.filter((m) => captureSquare(m) !== sq);
      return kept.length > 0 ? kept : moves;
    },
    onMovePlayed: (inst, move) => {
      const sq = inst.state.sq as Square | undefined;
      if (sq == null) return;
      if (move.capturedSquare === sq && move.from !== sq) {
        inst.spent = true;
        return;
      }
      if (move.from === sq) {
        // Protection ends the moment the envoy itself makes a capture.
        if (move.captured) {
          inst.spent = true;
          return;
        }
        inst.state.sq = move.to;
      } else if (move.to === sq && move.from !== sq) inst.spent = true;
    },
    status: (inst) => {
      const sq = inst.state.sq as Square | undefined;
      return sq == null
        ? "activate to appoint the envoy"
        : `envoy at ${"abcdefgh"[FILE(sq)]}${RANK(sq) + 1}`;
    },
  };
}

// ---------------------------------------------------------------------------
// The cards. Tier spread targets the starved bands:
// T1:2 T2:2 T3:3 T4:4 T5:4 T6:5 T7:4 T8:4 = 28 new boons.
// ---------------------------------------------------------------------------

export const BOON_WAVE2: Buff[] = [
  // ===== TIER 1 ==============================================================

  // The offensive twin of Holy Hell's defensive en-passant ward: a one-shot
  // legality exception that lets a pawn take en passant OUT of turn order.
  boon(
    {
      id: "bw2_ancient_custom",
      name: "Ancient Custom",
      description: "Once, one of your pawns may capture an enemy pawn standing directly beside it en passant, as though it had just double-stepped. That pawn is then rooted and cannot move again on your next turn. Reaching your last rank this way promotes to a queen.",
      tip: "The rooted turn is the price: do not play it into a position where the pawn must run.",
      tier: 1,
      category: "movement",
      icon: "Scroll",
      flavor: "Look it up. Older editions only.",
      requires: ["p"],
      fx: { motif: "empower", pieces: ["p"], self: true },
    },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 1;
      },
      augmentMoves: (moves, inst, api) => {
        if (((inst.state.charges as number) ?? 0) <= 0) return;
        const out: Move[] = [];
        const fwd = api.me === "w" ? 1 : -1;
        for (const from of mySquares(api.board, api.me, "p")) {
          for (const df of [-1, 1]) {
            const bf = FILE(from) + df;
            if (!inBoard(bf, RANK(from))) continue;
            const beside = SQ(bf, RANK(from));
            const victim = api.board.pieces[beside];
            if (!victim || victim.color !== api.opp || victim.type !== "p") continue;
            const tr = RANK(from) + fwd;
            if (!inBoard(bf, tr)) continue;
            const to = SQ(bf, tr);
            if (api.board.pieces[to]) continue;
            out.push({
              from,
              to,
              piece: "p",
              color: api.me,
              captured: "p",
              capturedSquare: beside,
              via: inst.id,
              ...(pawnRankOk(to) ? {} : { promotion: "q" }),
            } as Move);
          }
        }
        addNovel(moves, out);
      },
      // The arrival is rooted for the owner's next turn (a freeze ticks on the
      // owner's own turns), so the pawn that struck cannot move again at once.
      onMovePlayed: (inst, move, api) => {
        if (move.via !== inst.id || !move.color) return;
        addEffect(api, { kind: "freeze", sq: move.to, owner: api.me, turns: 1, skin: "stun" });
        inst.spent = true;
      },
      status: () => null,
    },
  ),

  // Protection from one specific threat, forever: regicide is above a pawn's
  // station. A permanent legality carve-out, not a shield effect.
  boon(
    {
      id: "bw2_divine_right",
      name: "Divine Right",
      description:
        "No peasant may slay a king: enemy pawns can never capture your king, for the rest of the game.",
      tier: 2,
      category: "protection",
      icon: "Crown",
      flavor: "The law is older than the board it stands on.",
      fx: { motif: "ward", pieces: ["k"], self: true },
    },
    oppFilter((moves) => moves.filter((m) => !(m.piece === "p" && m.captured === "k"))),
  ),

  // ===== TIER 2 ==============================================================

  // A summon that is deliberately INERT: a permanent blocker you own, can
  // lose, and can trip over. Distinct from every usable summon in the pool.
  boon(
    {
      id: "bw2_scarecrow",
      name: "Scarecrow",
      description:
        "Prop a scarecrow on an empty square in your half: it stands there as one of your pawns but is rooted and can never move, for the rest of the game. It blocks lines for both sides and can be captured like any pawn.",
      tier: 2,
      category: "protection",
      icon: "Wheat",
      flavor: "It has never once scared anybody. It has stopped several rooks.",
    },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose where the scarecrow stands",
              squares: emptySquares(api.board, (sq) => inHalf(api.me, sq) && pawnRankOk(sq)),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null || api.board.pieces[sq] || !pawnRankOk(sq)) return;
        api.place(sq, "p", api.me);
        addEffect(api, { kind: "freeze", sq, owner: api.me, turns: 999, skin: "roots" });
      },
    ),
  ),

  // Trigger-based protection keyed to CROSSING THE FRONTIER, so it rewards
  // advancing — no other ward in the pool triggers on territory.
  boon(
    {
      id: "bw2_pioneers_banner",
      name: "Pioneer's Banner",
      description:
        "The next 3 times one of your pieces (your king excepted) crosses from your half into your opponent's half, it plants the banner: that piece cannot be captured for your opponent's next turn.",
      tier: 3,
      category: "protection",
      icon: "Flag",
      flavor: "The flag does not make the ground yours. It does confuse everyone for a moment.",
      fx: { motif: "ward", pieces: "all", self: true },
    },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 3;
      },
      onMovePlayed: (inst, move, api) => {
        const left = (inst.state.charges as number) ?? 0;
        if (left <= 0 || move.color !== api.me || move.piece === "k") return;
        if (!inHalf(api.me, move.from) || inHalf(api.me, move.to)) return;
        addEffect(api, { kind: "shield", owner: api.me, squares: [move.to], turns: 1 });
        inst.state.charges = left - 1;
        if (left - 1 <= 0) inst.spent = true;
      },
      status: (inst) => `${(inst.state.charges as number) ?? 3} crossings left`,
    },
  ),

  // ===== TIER 3 ==============================================================

  // Draft asceticism: pay a whole draft now for a fattened one later. Blocked
  // drafts skip rollOffer entirely, so the prep/bank flags survive the fast
  // and land on the NEXT real offer (verified against game.ts / draft.ts).
  boon(
    {
      id: "bw2_ascetics_bargain",
      name: "Ascetic's Bargain",
      description:
        "Take a vow of refusal: your next draft is skipped outright. The draft after that shows three cards to pick from and rolls one tier higher. If it is not claimed within two of your drafts, the vow lapses.",
      tier: 3,
      category: "draft",
      icon: "HandHeart",
      flavor: "Hunger is a seasoning.",
    },
    {
      kind: "passive",
      init: (inst, api) => {
        api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 1;
        api.mine.flags.prepThree = true;
        api.mine.flags.bankBonus = Math.min(1, (api.mine.flags.bankBonus ?? 0) + 1);
        inst.state.baseDrafts = api.mine.draftsTaken;
      },
      // The fattened offer is claimed the moment prepThree is consumed by a real
      // roll; if two of your drafts pass without that happening (both blocked,
      // say), the vow lapses and the banked reward is dropped.
      onMovePlayed: (inst, _move, api) => {
        if (inst.spent) return;
        if (!api.mine.flags.prepThree) {
          inst.spent = true;
          return;
        }
        if (api.mine.draftsTaken - ((inst.state.baseDrafts as number) ?? 0) >= 2) {
          api.mine.flags.prepThree = false;
          api.mine.flags.bankBonus = Math.max(0, (api.mine.flags.bankBonus ?? 0) - 1);
          inst.spent = true;
        }
      },
      status: (inst) => (inst.spent ? "vow spent" : "vow held"),
    },
  ),

  // A strategic exception on the CAPTURE PATTERN itself: repetition is barred.
  // Reads only synced move history, and timedOppFilter's fallback guarantees
  // the opponent always keeps at least one legal move.
  boon(
    {
      id: "bw2_jesters_rule",
      name: "Jester's Rule",
      description:
        "The court demands variety: for your opponent's next 6 turns, they can never capture the same kind of piece their previous move just captured.",
      tier: 4,
      category: "protection",
      icon: "Drama",
      flavor: "Do the bit again and the king stops laughing.",
      fx: { motif: "muzzle", pieces: "all" },
    },
    timedOppFilter(6, (moves, _inst, api) => {
      const last = lastOppMove(api);
      if (!last?.captured) return moves;
      return moves.filter((m) => m.captured !== last.captured);
    }),
  ),

  // A one-shot raider's miracle: capture, then vanish back to where you
  // stood, dodging the recapture entirely. Board mutation via api.relocate.
  boon(
    {
      id: "bw2_hit_and_run",
      name: "Hit and Run",
      description:
        "After your opponent's next move, the next time one of your pieces makes a capture, it strikes and slips straight back to the square it came from, dodging any reprisal. Once.",
      tier: 3,
      category: "attack",
      icon: "Footprints",
      flavor: "Be somewhere else before the echo lands.",
      fx: { motif: "empower", pieces: "all", self: true },
    },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.armed = false;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent) return;
        // Delayed activation: the effect only arms once the opponent has
        // replied at least once after this card was drafted.
        if (!inst.state.armed) {
          if (move.color === api.opp) inst.state.armed = true;
          return;
        }
        if (move.color !== api.me) return;
        if (!move.captured || move.captured === "k") return;
        if (move.from === move.to || api.board.pieces[move.from]) return;
        api.relocate(move.to, move.from);
        inst.spent = true;
      },
      status: (inst) =>
        inst.state.armed ? "waiting on your next capture" : "arming after your opponent replies",
    },
  ),

  // ===== TIER 4 ==============================================================

  // A comeback transformation gated on being BEHIND: the king himself learns
  // to fight only when the army thins. Pure board read, so it never desyncs.
  boon(
    {
      id: "bw2_cornered_king",
      name: "Cornered King",
      description:
        "Desperation teaches strange footwork: once, while you have fewer pieces than your opponent (kings aside), your king may move like a knight.",
      tier: 2,
      category: "movement",
      icon: "Swords",
      flavor: "An old king remembers being a soldier.",
      fx: { motif: "empower", pieces: ["k"], moveAs: "n", self: true },
    },
    augment((_moves, inst, api) => {
      if (armySize(api.board, api.me) >= armySize(api.board, api.opp)) return [];
      const ks = mySquares(api.board, api.me, "k")[0];
      if (ks == null) return [];
      return KNIGHT_LEAPS.flatMap(([df, dr]) => {
        const f = FILE(ks) + df, r = RANK(ks) + dr;
        if (!inBoard(f, r)) return [];
        const to = SQ(f, r);
        const t = api.board.pieces[to];
        if (t && t.color === api.me) return [];
        return [
          {
            from: ks,
            to,
            piece: "k",
            color: api.me,
            ...(t ? { captured: t.type, capturedSquare: to } : {}),
            via: inst.id,
          } as Move,
        ];
      });
    }, 1),
  ),

  // Identity swap, not an upgrade: two of your pieces trade TYPES in place.
  // The material stays identical; only the geometry changes.
  boon(
    {
      id: "bw2_masquerade",
      name: "Masquerade",
      description:
        "Two of your pieces trade masks: choose two of your knights, bishops, rooks or queens of different kinds, and they swap types where they stand. Your material never changes, only where the powers live.",
      tier: 5,
      category: "pieces",
      icon: "VenetianMask",
      flavor: "At midnight nobody swapped back.",
    },
    activated(
      (_inst, api, picks) => {
        const courtly = (sq: Square) => {
          const t = api.board.pieces[sq]?.type;
          return t === "n" || t === "b" || t === "r" || t === "q";
        };
        if (picks.length >= 2) return null;
        if (picks.length === 0) {
          const all = mySquares(api.board, api.me).filter(courtly);
          return {
            kind: "square",
            label: "Choose the first masked piece",
            squares: all.filter((sq) =>
              all.some((o) => o !== sq && api.board.pieces[o]!.type !== api.board.pieces[sq]!.type),
            ),
          };
        }
        const first = picks[0].square!;
        const t0 = api.board.pieces[first]?.type;
        return {
          kind: "square",
          label: "Choose the piece it trades masks with",
          squares: mySquares(api.board, api.me).filter(
            (sq) => sq !== first && courtly(sq) && api.board.pieces[sq]!.type !== t0,
          ),
        };
      },
      (_inst, api, picks) => {
        const a = picks[0]?.square, b = picks[1]?.square;
        if (a == null || b == null || a === b) return;
        const pa = api.board.pieces[a], pb = api.board.pieces[b];
        if (!pa || !pb || pa.color !== api.me || pb.color !== api.me) return;
        const ta = pa.type, tb = pb.type;
        if (ta === tb || ta === "k" || tb === "k" || ta === "p" || tb === "p") return;
        api.setPieceType(a, tb);
        api.setPieceType(b, ta);
      },
    ),
  ),

  // A death-triggered miracle: the queen's will pays out the moment she
  // falls. Auto-placement (no UI) so the hook replays cleanly everywhere.
  boon(
    {
      id: "bw2_queens_testament",
      name: "Queen's Testament",
      description:
        "Her will is already written: the first time your opponent captures your queen, up to two of your captured knights and bishops immediately return to empty squares nearest your home rank.",
      tier: 4,
      category: "pieces",
      icon: "Feather",
      flavor: "She provided for the household.",
      requires: ["q"],
      fx: { motif: "ward", pieces: ["q"], self: true },
    },
    {
      kind: "passive",
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.opp || move.captured !== "q") return;
        let placed = 0;
        for (const t of ["n", "b"] as PieceType[]) {
          while (placed < 2 && revivable(api, t) > 0) {
            const sq = autoPlaceSquare(api, api.me, t);
            if (sq == null) break;
            api.place(sq, t, api.me);
            markRevived(api, t);
            placed++;
          }
        }
        inst.spent = true;
      },
      status: () => "held in trust until your queen falls",
    },
  ),

  // Turn a piece you CAPTURED into a defector on your side — it spends the
  // opponent's revive pool, so the piece truly changes flags.
  boon(
    {
      id: "bw2_spoils_of_war",
      name: "Spoils of War",
      description: "The finest piece you have captured defects to your colours: place it on an empty square on your home rank. It leaves your opponent's revival pool for eighteen of your turns, then rejoins it, and you gain one draft reroll.",
      tip: "Queens defect first, then rooks, bishops, knights, pawns.",
      tier: 6,
      category: "pieces",
      icon: "Handshake",
      flavor: "Everyone has a price. Yours was room and board.",
    },
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) => {
        if (picks.length > 0 || inst.state.type != null) return null;
        const t = bestDefector(api);
        return {
          kind: "square",
          label: t == null ? "No captured enemy piece to recruit" : "Place the defector",
          squares:
            t == null
              ? []
              : emptySquares(
                  api.board,
                  (sq) =>
                    (api.me === "w" ? RANK(sq) === 0 : RANK(sq) === 7) &&
                    (t !== "p" || pawnRankOk(sq)),
                ),
        };
      },
      effect: (inst, api, picks) => {
        const sq = picks[0]?.square;
        const t = bestDefector(api);
        if (sq == null || t == null || api.board.pieces[sq] || inst.state.type != null) return;
        if (t === "p" && !pawnRankOk(sq)) return;
        api.place(sq, t, api.me);
        // Suspend the piece from their revival pool rather than removing it for
        // good; the countdown below returns it after eighteen of your turns.
        api.theirs.revived[t] = (api.theirs.revived[t] ?? 0) + 1;
        inst.state.type = t;
        inst.state.turns = 18;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.state.type == null || inst.spent || move.color !== api.me) return;
        const left = ((inst.state.turns as number) ?? 0) - 1;
        inst.state.turns = left;
        if (left <= 0) {
          const t = inst.state.type as PieceType;
          api.theirs.revived[t] = Math.max(0, (api.theirs.revived[t] ?? 0) - 1);
          api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
          inst.spent = true;
        }
      },
      status: (inst) =>
        inst.state.type == null
          ? "activate to recruit a defector"
          : `suspension: ${(inst.state.turns as number) ?? 18} of your turns left`,
    },
  ),

  // ===== TIER 5 ==============================================================

  // Draft control with a real, bleeding cost: feed a piece to the deck.
  boon(
    {
      id: "bw2_blood_price",
      name: "Blood Price",
      description:
        "The deck feeds on sacrifice: destroy one of your own pieces (your king excepted), and your next draft is fated to offer tier 6 cards.",
      tier: 3,
      category: "draft",
      icon: "FlaskConical",
      flavor: "The cards do not take coin.",
    },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the piece the deck devours",
              squares: mySquares(api.board, api.me).filter(
                (sq) => api.board.pieces[sq]!.type !== "k",
              ),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.me || p.type === "k") return;
        api.removePiece(sq);
        api.mine.flags.forceTier = 6;
      },
    ),
  ),

  // Conditional, geography-keyed immunity: the envoy is untouchable only on
  // FOREIGN soil, so the protection asks you to march it into danger.
  boon(
    {
      id: "bw2_diplomatic_immunity",
      name: "Diplomatic Immunity",
      description:
        "Appoint one of your pieces (your king excepted) as an envoy: it cannot be captured while it stands in your opponent's half of the board, for the rest of the game, but the protection ends the moment the envoy makes a capture. In your own half it is fair game.",
      tier: 5,
      category: "protection",
      icon: "Landmark",
      flavor: "Read the treaty again. Slowly.",
      fx: { motif: "ward", pieces: "all", self: true },
    },
    pieceBoundImmunity(),
  ),

  // A bound piece that cheats death ONCE: it dies, and marches straight back
  // out of the gate. Automatic, and it spends no revive pool — it never fell.
  boon(
    {
      id: "bw2_deathless_oath",
      name: "Deathless Oath",
      description:
        "One of your pieces (your king excepted) swears the oath: the first time it is captured, it instantly returns to the empty square nearest your home rank. One rebirth, then the oath is spent.",
      tier: 5,
      category: "pieces",
      icon: "Sunrise",
      flavor: "Death kept the appointment. The piece did not.",
    },
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) =>
        picks.length > 0 || inst.state.sq != null
          ? null
          : {
              kind: "square",
              label: "Choose the piece that swears the oath",
              squares: mySquares(api.board, api.me).filter(
                (sq) => api.board.pieces[sq]!.type !== "k",
              ),
            },
      effect: (inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null || inst.state.sq != null) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.me || p.type === "k") return;
        inst.state.sq = sq;
        inst.state.type = p.type;
      },
      onMovePlayed: (inst, move, api) => {
        const sq = inst.state.sq as Square | undefined;
        if (sq == null || inst.spent) return;
        const died =
          (move.capturedSquare === sq && move.from !== sq) ||
          (move.to === sq && move.from !== sq);
        if (died) {
          const type = (inst.state.type as PieceType) ?? "p";
          const home = autoPlaceSquare(api, api.me, type);
          if (home != null) api.place(home, type, api.me);
          inst.spent = true;
          return;
        }
        if (move.from === sq) {
          inst.state.sq = move.to;
          if (move.promotion) inst.state.type = move.promotion;
        }
      },
      status: (inst) => {
        const sq = inst.state.sq as Square | undefined;
        return sq == null
          ? "activate to choose the sworn piece"
          : `oath held by ${"abcdefgh"[FILE(sq)]}${RANK(sq) + 1}`;
      },
    },
  ),

  // Cost-paired removal: name the weapon, and both sides draw it. Removing
  // through the api keeps both revive pools honest (each loss is real).
  boon(
    {
      id: "bw2_blood_duel",
      name: "Blood Duel",
      description:
        "Call a duel of equals: choose one enemy knight, bishop or rook, then one of your own pieces of the same kind. Both are removed from the board. Both losses are real and feed both revival pools.",
      tier: 3,
      category: "attack",
      icon: "Axe",
      flavor: "Pistols at dawn, bishops at diagonal.",
    },
    activated(
      (_inst, api, picks) => {
        if (picks.length >= 2) return null;
        if (picks.length === 0) {
          return {
            kind: "square",
            label: "Choose the enemy duelist",
            squares: mySquares(api.board, api.opp).filter((sq) => {
              const t = api.board.pieces[sq]!.type;
              return (
                (t === "n" || t === "b" || t === "r") &&
                mySquares(api.board, api.me, t).length > 0
              );
            }),
          };
        }
        const t = api.board.pieces[picks[0].square!]?.type;
        return {
          kind: "square",
          label: "Choose your own duelist of the same kind",
          squares: t ? mySquares(api.board, api.me, t) : [],
        };
      },
      (_inst, api, picks) => {
        const enemy = picks[0]?.square, mine = picks[1]?.square;
        if (enemy == null || mine == null) return;
        const pe = api.board.pieces[enemy], pm = api.board.pieces[mine];
        if (!pe || !pm || pe.color !== api.opp || pm.color !== api.me) return;
        if (pe.type !== pm.type || pe.type === "k") return;
        api.removePiece(enemy);
        api.removePiece(mine);
      },
    ),
  ),

  // ===== TIER 6 ==============================================================

  // The clock as loot: your blades collect time itself. Rides the
  // ClockRequest rail (server-clamped, no-op untimed, like every clock card).
  boon(
    {
      id: "bw2_highwaymans_toll",
      name: "Highwayman's Toll",
      description:
        "Stand and deliver: your next 3 captures each steal 8 seconds from your opponent's clock and add them to yours. In untimed games the toll collects nothing.",
      tier: 4,
      category: "tempo",
      icon: "Coins",
      flavor: "Your valuables or your tempo. Ideally both.",
    },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 3;
      },
      onMovePlayed: (inst, move, api) => {
        const left = (inst.state.charges as number) ?? 0;
        if (left <= 0 || move.color !== api.me) return;
        if (!move.captured || move.captured === "k") return;
        api.adjustClock({ stealFlatSec: 8, stealCapSec: 8 });
        inst.state.charges = left - 1;
        if (left - 1 <= 0) inst.spent = true;
      },
      status: (inst) => `${(inst.state.charges as number) ?? 3} tolls left`,
    },
  ),

  // A symmetric miracle with a built-in cost: BOTH war camps get their best
  // prisoner back. Play it when your losses outweigh theirs.
  boon(
    {
      id: "bw2_prisoner_exchange",
      name: "Prisoner Exchange",
      description:
        "Envoys meet at the river: your finest captured piece returns to the board, placed on the empty square nearest your home rank (queens first, then rooks, bishops, knights, pawns).",
      tier: 5,
      category: "pieces",
      icon: "Scale",
      flavor: "Both banks watched. Neither waved.",
    },
    instant((_inst, api) => {
      // One fewer piece returns now: only your own finest prisoner comes back;
      // the opponent's is no longer released.
      for (const t of VALUE_ORDER) {
        if (revivable(api, t) > 0) {
          const sq = autoPlaceSquare(api, api.me, t);
          if (sq != null) {
            api.place(sq, t, api.me);
            markRevived(api, t);
          }
          break;
        }
      }
    }),
  ),

  // A promotion-RULE rewrite, not a promotion: for three turns the far third
  // of the board is coronation ground. Rides makeMove's promotion field.
  boon(
    {
      id: "bw2_early_coronation",
      name: "Early Coronation",
      description:
        "The heralds cannot wait, though the coronation is a modest one: once, a pawn move of yours that reaches your opponent's second rank may promote on the spot to a rook, bishop, or knight.",
      tier: 6,
      category: "pieces",
      icon: "Church",
      flavor: "The cathedral came to the pawn.",
      requires: ["p"],
      fx: { motif: "empower", pieces: ["p"], self: true },
    },
    augment((_moves, inst, api) => {
      const out: Move[] = [];
      const fwd = api.me === "w" ? 1 : -1;
      for (const from of mySquares(api.board, api.me, "p")) {
        const tr = RANK(from) + fwd;
        if (tr < 0 || tr > 7) continue;
        for (const df of [-1, 0, 1]) {
          const f = FILE(from) + df;
          if (!inBoard(f, tr)) continue;
          const to = SQ(f, tr);
          // The opponent's second rank only (their back rank is relRank 8).
          if (relRank(api.me, to) !== 7) continue;
          const t = api.board.pieces[to];
          if (df === 0 ? t != null : !t || t.color !== api.opp || t.type === "k") continue;
          for (const promo of ["r", "b", "n"] as PieceType[]) {
            out.push({
              from,
              to,
              piece: "p",
              color: api.me,
              ...(t ? { captured: t.type, capturedSquare: to } : {}),
              promotion: promo,
              via: inst.id,
            } as Move);
          }
        }
      }
      return out;
    }, 1),
  ),

  // A transformation that PAYS for itself in the same breath: one piece
  // rises to a queen, another crumbles to a pawn. Never a free upgrade.
  boon(
    {
      id: "bw2_alchemists_trade",
      name: "Alchemist's Trade",
      description:
        "One of your knights, bishops or rooks becomes a queen. In payment, another of your officers (not on a first or last rank) becomes a pawn.",
      tier: 5,
      category: "pieces",
      icon: "Gem",
      flavor: "Gold from lead, lead from gold. The scales do not care which way.",
    },
    activated(
      (_inst, api, picks) => {
        const risers = mySquares(api.board, api.me).filter((sq) => {
          const t = api.board.pieces[sq]!.type;
          return t === "n" || t === "b" || t === "r";
        });
        const payers = (except: Square | null) =>
          mySquares(api.board, api.me).filter((sq) => {
            if (sq === except || !pawnRankOk(sq)) return false;
            const t = api.board.pieces[sq]!.type;
            return t === "n" || t === "b" || t === "r" || t === "q";
          });
        if (picks.length >= 2) return null;
        if (picks.length === 0) {
          return {
            kind: "square",
            label: "Choose the piece to transmute into a queen",
            squares: risers.filter((sq) => payers(sq).length > 0),
          };
        }
        return {
          kind: "square",
          label: "Choose the piece that pays the price",
          squares: payers(picks[0].square!),
        };
      },
      (_inst, api, picks) => {
        const up = picks[0]?.square, down = picks[1]?.square;
        if (up == null || down == null || up === down) return;
        const pu = api.board.pieces[up], pd = api.board.pieces[down];
        if (!pu || !pd || pu.color !== api.me || pd.color !== api.me) return;
        if (pu.type === "k" || pu.type === "p" || pu.type === "q") return;
        if (pd.type === "k" || pd.type === "p" || !pawnRankOk(down)) return;
        api.setPieceType(up, "q");
        api.setPieceType(down, "p");
      },
    ),
  ),

  // A mover that may never fight: queen's legs, pawn's teeth. Unusual piece
  // behavior with a built-in restriction instead of a timer.
  boon(
    {
      id: "bw2_standard_bearer",
      name: "Standard Bearer",
      description:
        "One of your pawns takes up the army's standard: at most once in every four of your turns it may also move like a queen, up to three squares, but never to capture, and never onto a first or last rank. Its humble pawn captures remain.",
      tier: 6,
      category: "movement",
      icon: "FlagTriangleRight",
      flavor: "It carries the whole army's pride, which is heavy, so no stabbing.",
      requires: ["p"],
      fx: { motif: "empower", pieces: ["p"], moveAs: "q", self: true },
    },
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) =>
        picks.length > 0 || inst.state.sq != null
          ? null
          : {
              kind: "square",
              label: "Choose the pawn that bears the standard",
              squares: mySquares(api.board, api.me, "p"),
            },
      effect: (inst, _api, picks) => {
        if (inst.state.sq != null) return;
        inst.state.sq = picks[0]?.square;
        inst.state.cd = 0;
      },
      augmentMoves: (moves, inst, api) => {
        const sq = inst.state.sq as Square | undefined;
        if (sq == null || ((inst.state.cd as number) ?? 0) > 0) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.me) return;
        addNovel(
          moves,
          slideMoves(api.board, sq, ALL_DIRS, inst.id, 3).filter(
            (m) => !m.captured && pawnRankOk(m.to),
          ),
        );
      },
      onMovePlayed: (inst, move, api) => {
        const sq = inst.state.sq as Square | undefined;
        if (sq == null) return;
        if (move.capturedSquare === sq && move.from !== sq) {
          inst.spent = true;
          return;
        }
        if (move.from === sq) {
          if (move.promotion) {
            inst.spent = true;
            return;
          }
          inst.state.sq = move.to;
        } else if (move.to === sq && move.from !== sq) {
          inst.spent = true;
          return;
        }
        // A standard move starts the four-turn cooldown; your other turns tick
        // it back down, so the queen-step returns on your fourth turn.
        if (move.via === inst.id) inst.state.cd = 3;
        else if (move.color === api.me) {
          const cd = (inst.state.cd as number) ?? 0;
          if (cd > 0) inst.state.cd = cd - 1;
        }
      },
      status: (inst) => {
        const sq = inst.state.sq as Square | undefined;
        if (sq == null) return "activate to choose a pawn";
        const cd = (inst.state.cd as number) ?? 0;
        const name = `${"abcdefgh"[FILE(sq)]}${RANK(sq) + 1}`;
        return cd > 0 ? `standard on ${name}, ready in ${cd}` : `standard on ${name}, ready`;
      },
    },
  ),

  // ===== TIER 7 ==============================================================

  // The only card in the game that touches the PERSISTENT draft lift: every
  // future offer rolls a tier higher, paid for with every reroll you own.
  boon(
    {
      id: "bw2_kingmakers_pact",
      name: "Kingmaker's Pact",
      description:
        "Sign with the power behind every throne: for your opponent's next four turns, every one of your draft offers rolls one tier higher. In exchange you forfeit your draft rerolls now. The pact ends the moment your opponent spends a reroll.",
      tier: 7,
      category: "draft",
      icon: "ScrollText",
      flavor: "The pen was already warm when you picked it up.",
    },
    {
      kind: "passive",
      init: (inst, api) => {
        api.mine.flags.stackBoost = Math.min(3, (api.mine.flags.stackBoost ?? 0) + 1);
        api.mine.rerollsLeft = 0;
        inst.state.turns = 4;
        inst.state.oppRerolls = api.theirs.rerollsLeft;
        inst.state.lifted = true;
      },
      // The lift lasts four of the opponent's turns, and ends early the moment
      // they spend a reroll (their rerollsLeft drops between your reads).
      onMovePlayed: (inst, move, api) => {
        if (!inst.state.lifted) return;
        const end = () => {
          api.mine.flags.stackBoost = Math.max(0, (api.mine.flags.stackBoost ?? 0) - 1);
          inst.state.lifted = false;
          inst.spent = true;
        };
        if (api.theirs.rerollsLeft < ((inst.state.oppRerolls as number) ?? 0)) {
          end();
          return;
        }
        inst.state.oppRerolls = api.theirs.rerollsLeft;
        if (move.color === api.opp) {
          const t = ((inst.state.turns as number) ?? 0) - 1;
          inst.state.turns = t;
          if (t <= 0) end();
        }
      },
      status: (inst) =>
        inst.state.lifted
          ? `higher drafts: ${(inst.state.turns as number) ?? 0} of their turns left`
          : "spent",
    },
  ),

  // A king-safety exception that only exists UNDER FIRE: the bolt-hole opens
  // only while the king stands in check. Deterministic isInCheck gate.
  boon(
    {
      id: "bw2_bolt_hole",
      name: "Bolt Hole",
      description:
        "Old castles keep old secrets: while your king is in check, it, or one other of your pieces, may escape through the walls to any empty square within 2 squares of where the king stands. The passage bears 2 such escapes, then collapses.",
      tier: 5,
      category: "movement",
      icon: "DoorOpen",
      flavor: "Every throne room has a second door. Ask the architect. You can't; he was walled in.",
      fx: { motif: "empower", pieces: ["k"], self: true },
    },
    augment((_moves, inst, api) => {
      if (!isInCheck(api.board, api.me)) return [];
      const ks = mySquares(api.board, api.me, "k")[0];
      if (ks == null) return [];
      const dests: Square[] = [];
      for (let sq = 0; sq < 64; sq++) {
        if (api.board.pieces[sq]) continue;
        const d = Math.max(Math.abs(FILE(sq) - FILE(ks)), Math.abs(RANK(sq) - RANK(ks)));
        if (d >= 1 && d <= 2) dests.push(sq);
      }
      // The king's own escapes, plus one additional piece of yours may slip
      // through the same passage: any non-king piece, to the same destinations
      // (a pawn never onto a first or last rank).
      const out: Move[] = teleportMoves(api.board, ks, dests, inst.id);
      for (const from of mySquares(api.board, api.me)) {
        if (from === ks) continue;
        for (const m of teleportMoves(api.board, from, dests, inst.id)) {
          if (m.piece !== "p" || pawnRankOk(m.to)) out.push(m);
        }
      }
      return out;
    }, 2),
  ),

  // Total chaos, evenly shared across YOUR OWN army: every piece is dealt a
  // new identity from the same bag. Seeded rng in the effect hook only.
  boon(
    {
      id: "bw2_carnival_of_masks",
      name: "Carnival of Masks",
      description: "Every one of your pieces except your king puts on another's mask: their types are shuffled among their squares at random. You keep exactly the same pieces, but nobody is where their powers say they are. Pawns never land on a first or last rank.",
      tip: "Best played from a tangled position, where scrambling your own army costs least.",
      tier: 7,
      category: "pieces",
      icon: "PartyPopper",
      flavor: "The music stopped. Nobody checked their own hat.",
    },
    activatedSimple((_inst, api) => {
      const squares = mySquares(api.board, api.me).filter(
        (sq) => api.board.pieces[sq]!.type !== "k",
      );
      if (squares.length < 2) return;
      const types = squares.map((sq) => api.board.pieces[sq]!.type);
      for (let i = types.length - 1; i > 0; i--) {
        const j = api.rng.int(i + 1);
        [types[i], types[j]] = [types[j], types[i]];
      }
      // Pawn-legality repair: a pawn mask may not land on ranks 1/8. Swap the
      // offending assignment with any legal partner slot; if none exists,
      // that square keeps its original face. Deterministic, order-stable.
      for (let i = 0; i < squares.length; i++) {
        if (types[i] !== "p" || pawnRankOk(squares[i])) continue;
        const j = types.findIndex((t, k) => k !== i && t !== "p" && pawnRankOk(squares[k]));
        if (j >= 0) [types[i], types[j]] = [types[j], types[i]];
        else types[i] = api.board.pieces[squares[i]]!.type;
      }
      squares.forEach((sq, i) => {
        if (api.board.pieces[sq]!.type !== types[i]) api.setPieceType(sq, types[i]);
      });
    }),
  ),

  // A comeback that measures the deficit and repays exactly that: one
  // revived piece for every kind the enemy outnumbers. Useless from ahead.
  boon(
    {
      id: "bw2_restitution",
      name: "Restitution",
      description: "For every kind of piece where your opponent outnumbers you on the board, one of your captured pieces of that kind returns to the empty square nearest your home rank. The most valuable returning piece is rooted and cannot move on your next turn.",
      tip: "Played from ahead it restores nothing, so it is a comeback card only.",
      tier: 7,
      category: "pieces",
      icon: "Landmark",
      flavor: "The court finds in favor of the losing side.",
    },
    instant((_inst, api) => {
      let firstSq: Square | null = null;
      for (const t of VALUE_ORDER) {
        const mine = mySquares(api.board, api.me, t).length;
        const theirs = mySquares(api.board, api.opp, t).length;
        if (theirs <= mine || revivable(api, t) <= 0) continue;
        const sq = autoPlaceSquare(api, api.me, t);
        if (sq == null) continue;
        api.place(sq, t, api.me);
        markRevived(api, t);
        if (firstSq == null) firstSq = sq;
      }
      // The highest-value arrival (VALUE_ORDER runs queen-first) is rooted for
      // your next turn. The engine has no capture-only lock, so a one-turn
      // freeze holds it in place until after your opponent replies.
      if (firstSq != null) {
        addEffect(api, { kind: "freeze", sq: firstSq, owner: api.me, turns: 1, skin: "stone" });
      }
    }),
  ),

  // ===== TIER 8 ==============================================================

  // A legendary strategic pause: NOTHING on either side may be captured. The
  // only symmetric double-army, double-king ward in the game — the cost is
  // that your opponent enjoys it too; your own nerf-relief rider is the edge.
  boon(
    {
      id: "bw2_long_truce",
      name: "The Long Truce",
      description:
        "Heralds cross the field and every blade is lowered: for 2 full turns, no piece on EITHER side can be captured, kings included. While the truce holds you breathe freely: your own nerf is suspended for your next 3 turns.",
      tier: 8,
      category: "tempo",
      icon: "HeartHandshake",
      flavor: "Two armies. One field. For two turns, just weather.",
    },
    instant((_inst, api) => {
      addEffect(api, { kind: "shield", owner: api.me, squares: null, turns: 2 });
      addEffect(api, { kind: "shield", owner: api.opp, squares: null, turns: 2 });
      addEffect(api, { kind: "king_safe", owner: api.me, turns: 2 });
      addEffect(api, { kind: "king_safe", owner: api.opp, turns: 2 });
      addEffect(api, { kind: "nerf_suspended", owner: api.me, turns: 3 });
    }),
  ),

  // The apocalyptic mirror of the revive family: EVERY fallen piece of BOTH
  // armies marches back. Pure comeback engine — the further behind you are,
  // the more of the returning host is yours.
  boon(
    {
      id: "bw2_great_return",
      name: "The Great Return",
      description: "Every captured piece of BOTH sides still owed to the board returns at once, each placed on the empty square nearest its own home rank. Your most valuable returning piece arrives rooted and cannot move on your next turn.",
      tip: "The side that has lost more regains more, so play it when you are behind on material.",
      tier: 8,
      category: "pieces",
      icon: "Sparkles",
      flavor: "The river gave back everything it was ever paid.",
    },
    instant((_inst, api) => {
      let firstSq: Square | null = null;
      for (const t of VALUE_ORDER) {
        while (revivable(api, t) > 0) {
          const sq = autoPlaceSquare(api, api.me, t);
          if (sq == null) break;
          api.place(sq, t, api.me);
          markRevived(api, t);
          if (firstSq == null) firstSq = sq;
        }
      }
      // The highest-value arrival on your side (VALUE_ORDER runs queen-first)
      // cannot capture until the opponent replies. The engine has no
      // capture-only lock, so a one-turn freeze holds it until then.
      if (firstSq != null) {
        addEffect(api, { kind: "freeze", sq: firstSq, owner: api.me, turns: 1, skin: "stone" });
      }
      for (const t of VALUE_ORDER) {
        while ((api.capturedByMe[t] ?? 0) - (api.theirs.revived[t] ?? 0) > 0) {
          const sq = autoPlaceSquare(api, api.opp, t);
          if (sq == null) break;
          api.place(sq, t, api.opp);
          api.theirs.revived[t] = (api.theirs.revived[t] ?? 0) + 1;
        }
      }
    }),
  ),

  // A hidden army bought with your FUTURE: three heavy pocket pieces, paid
  // for with your next two drafts. The biggest pocket grant in the game, and
  // the only one that mortgages the draft track to fund it.
  boon(
    {
      id: "bw2_shadow_reserve",
      name: "Shadow Reserve",
      description: "A knight, a bishop and a rook join your pocket to drop onto empty squares on later turns. Your next 2 drafts are skipped.",
      tip: "You are trading two drafts for three pieces and three turns to place them.",
      tier: 8,
      category: "pieces",
      icon: "Gift",
      flavor: "Everything is available. Nothing is on the shelf.",
    },
    instant((_inst, api) => {
      grantInventory(api, "r", 1);
      grantInventory(api, "b", 1);
      grantInventory(api, "n", 1);
      api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 2;
    }),
  ),

  // A PERMANENT conditional sanctuary: the home rank itself becomes holy
  // ground. The king is excluded, so it defends without ever locking the win.
  boon(
    {
      id: "bw2_eternal_keep",
      name: "The Eternal Keep",
      description: "For your opponent's next 4 turns, your pieces standing on your first rank cannot be captured, your king excepted. The ward ends the moment your king crosses the midline into their half.",
      tip: "Step off the rampart and the stone no longer knows you: keep the king at home to keep it.",
      tier: 5,
      category: "protection",
      icon: "Castle",
      flavor: "The masons built for a season. The season held.",
      fx: { motif: "ward", pieces: "all", self: true },
    },
    timedOppFilter(4, (moves, inst, api) => {
      // The ward ends for good the moment your king crosses the midline into
      // the opponent's half; once ended it never resumes.
      if (inst.state.ended) return moves;
      const kingSq = mySquares(api.board, api.me, "k")[0];
      if (kingSq != null && !inHalf(api.me, kingSq)) {
        inst.state.ended = true;
        return moves;
      }
      return moves.filter((m) => {
        const cs = captureSquare(m);
        if (cs == null) return true;
        const p = api.board.pieces[cs];
        if (!p || p.color !== api.me || p.type === "k") return true;
        return relRank(api.me, cs) !== 1;
      });
    }),
  ),
];
