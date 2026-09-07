// Boon wave 3 - the 2026-07 top-tier boon expansion. Boons are the rarer,
// stranger, more transformative side of the draft pool: miracles, contracts,
// rare transformations, comeback engines, conditional wards - never just
// bigger numbers. Every card here carries `boon: true` so it joins nerf
// mode's boon/item bucket, plus a normal BuffCategory for codex grouping.
// Spread into ALL_BUFFS by library.ts; ids are all prefixed `bw3_` and must
// not collide with existing cards.
//
// Design notes (mechanics survey, tier ladder, family coverage, cut designs):
// docs/2026-07-17-boon-wave3-design.md. Authoritative brief:
// docs/2026-07-17-wave3-content-map.md. Prior batch idiom: boons2.ts.
//
// Every mechanic below rides EXISTING engine rails only: ActiveEffect kinds,
// DraftFlags, the BuffApi mutators, augmentMoves / filterOpponentMoves /
// onMovePlayed, the revive pools, the crazyhouse pocket and the clock intent.
// No randomness is drawn here at all (every wave-3 boon is a pure read of the
// synced board or a deterministic mutation), so every replica replays the
// identical outcome. Kings are never frozen, walnutted, removed, transformed
// or bound; king safety is only ever the sanctioned `king_safe` effect or an
// added king MOVE (the Cornered King / Bolt Hole precedent), never a capture
// filter (which would break check detection and soft-lock the game).
//
// Import paths are relative (not the "@/" alias): tsconfig.server.json does
// not resolve the alias, and the engine must build for the server tests.

import { isInCheck } from "../board";
import { Buff, BuffApi, CardFx } from "../buff";
import { Tier } from "../nerf";
import { BoardState, Color, FILE, Move, PieceType, RANK, SQ, Square } from "../types";
import {
  KNIGHT_LEAPS,
  ORTHO_DIRS,
  activated,
  activatedSimple,
  addEffect,
  addNovel,
  captureSquare,
  emptySquares,
  explodeAt,
  grantInventory,
  inHalf,
  instant,
  leapMoves,
  markRevived,
  mySquares,
  oppFilter,
  pawnRankOk,
  phasingSlideMoves,
  pieceBound,
  relRank,
  revivable,
  spendOnVia,
  teleportMoves,
  tickTurns,
  trackBoundPiece,
  turnsLeft,
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

/** Build a fully implemented wave-3 boon: `boon: true` is stamped on every
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

/** Keep an opponent-move filter from ever stranding the opponent with zero
 * legal moves (house rule: every filterOpponentMoves path must fall back to a
 * non-empty list). Mirrors the guard baked into `timedOppFilter`. */
function nonEmpty(kept: Move[], all: Move[]): Move[] {
  return kept.length > 0 ? kept : all;
}

// ---------------------------------------------------------------------------
// The cards. Tier spread fills the starved top and mid bands per the wave-3
// prescription: T1:3 T2:4 T3:5 T4:6 T5:6 T6:7 T7:7 T8:6 = 44 new boons.
// Each card names its closest existing neighbours in a comment so a reviewer
// can confirm it is a distinct MECHANIC, not a numeric or defensive re-skin.
// ---------------------------------------------------------------------------

export const BOON_WAVE3: Buff[] = [
  // ===== TIER 1 ==============================================================

  // A single specific-threat legality ward, the minor-piece cousin of Divine
  // Right (pawns cannot take your king). Neighbours: Divine Right, Watchtower
  // (knights barred from your half). Distinct: forbids exactly the knight fork
  // that wins a bishop, forever, and touches nothing else.
  boon(
    {
      id: "bw3_bishops_blessing",
      name: "Bishop's Blessing",
      description:
        "The clergy is above the cavalry's reach: enemy knights can never capture your bishops, for the rest of the game.",
      tier: 2,
      category: "protection",
      icon: "Church",
      flavor: "A horse has no business in the sanctuary.",
      requires: ["b"],
      fx: { motif: "ward", pieces: ["b"], self: true },
    },
    oppFilter((moves) => nonEmpty(moves.filter((m) => !(m.piece === "n" && m.captured === "b")), moves)),
  ),

  // The clock as first blood: your opening strike collects tempo. Neighbours:
  // Highwayman's Toll (3 charges, any capture, 8s). Distinct: a single, larger
  // steal keyed to the FIRST capture only, so it rewards striking first.
  boon(
    {
      id: "bw3_first_blood",
      name: "First Blood",
      description:
        "The first capture you make in the game grants you one draft reroll, and reveals the tier of your opponent's next draft offer.",
      tier: 1,
      category: "tempo",
      icon: "Droplet",
      flavor: "The duel is decided in the first cut, they say. They are usually wrong, but it feels true.",
    },
    {
      kind: "passive",
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.me) return;
        if (!move.captured || move.captured === "k") return;
        api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
        api.mine.flags.seeOppTier = true;
        inst.spent = true;
      },
      status: () => "waiting on first blood",
    },
  ),

  // The only boon that reopens the castling gate as a proactive play (the
  // relief family aside). Neighbours: castling relief cards. Distinct: a plain
  // one-line rights restore, played after you were forced to move your king or
  // rook, so the escape hatch reopens.
  boon(
    {
      id: "bw3_postern_gate",
      name: "Postern Gate",
      description:
        "An old side door swings open in the keep wall: your right to castle on both sides is restored, even if your king or rooks have already moved. Castling, as ever, can never be used to make a capture.",
      tier: 1,
      category: "movement",
      icon: "DoorClosed",
      flavor: "Every castle keeps one door the siege maps never mark.",
    },
    instant((_inst, api) => {
      api.restoreCastling();
    }),
  ),

  // ===== TIER 2 ==============================================================

  // A reactive transformation: lose a minor, and a pawn steps up to wear its
  // rank. Neighbours: Queen's Testament (revives minors from the pool on queen
  // death), Deathless Oath (returns the SAME bound piece). Distinct: no pool
  // and no bound piece - a surviving pawn on the board is promoted in place
  // into the exact minor you just lost, so material holds but structure pays.
  boon(
    {
      id: "bw3_heir_apparent",
      name: "Heir Apparent",
      description:
        "The line of succession is settled in advance: the first time your opponent captures one of your knights or bishops, your pawn nearest your home rank is knighted into that same kind of piece where it stands.",
      tier: 3,
      category: "pieces",
      icon: "Baby",
      flavor: "The squire had been polishing that armor for years.",
      requires: ["p"],
      fx: { motif: "empower", pieces: ["p"], self: true },
    },
    {
      kind: "passive",
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.opp) return;
        if (move.captured !== "n" && move.captured !== "b") return;
        const pawns = mySquares(api.board, api.me, "p");
        if (pawns.length === 0) return;
        let heir = pawns[0];
        for (const sq of pawns) {
          if (relRank(api.me, sq) < relRank(api.me, heir)) heir = sq;
        }
        api.setPieceType(heir, move.captured);
        inst.spent = true;
      },
      status: () => "a squire awaits the call",
    },
  ),

  // Relational pawn protection, not a blanket shield: only pawns standing in a
  // phalanx (a friendly pawn on an adjacent file, same rank) are safe.
  // Neighbours: Eternal Keep (first rank, T8), Diplomatic Immunity (envoy in
  // foreign half). Distinct: the ward is earned by pawn STRUCTURE and breaks
  // the moment the phalanx does.
  boon(
    {
      id: "bw3_shield_wall",
      name: "Shield Wall",
      description:
        "Shoulder to shoulder they cannot be broken: any of your pawns that stands directly beside another of your pawns (on the next file over, same rank) cannot be captured. A lone pawn is on its own.",
      tier: 3,
      category: "protection",
      icon: "Users",
      flavor: "Break the line first. Good luck breaking the line.",
      requires: ["p"],
      fx: { motif: "ward", pieces: ["p"], self: true },
    },
    oppFilter((moves, _inst, api) =>
      nonEmpty(
        moves.filter((m) => {
          const cs = captureSquare(m);
          if (cs == null) return true;
          const p = api.board.pieces[cs];
          if (!p || p.color !== api.me || p.type !== "p") return true;
          const r = RANK(cs), f = FILE(cs);
          const shored = [f - 1, f + 1].some((af) => {
            if (af < 0 || af > 7) return false;
            const q = api.board.pieces[SQ(af, r)];
            return !!q && q.color === api.me && q.type === "p";
          });
          return !shored;
        }),
        moves,
      ),
    ),
  ),

  // Friendly terrain control: seal your own back rank so no enemy piece may
  // ever set foot on it. Neighbours: Eternal Keep (first-rank pieces are
  // UNcapturable), Bunker / wall cards. Distinct: a `barred` wall (the enemy
  // cannot ENTER the rank at all, blocking back-rank infiltration and enemy
  // pawn promotion), not a capture shield. King captures stay exempt engine
  // side, so it can never soft-lock.
  boon(
    {
      id: "bw3_home_guard",
      name: "Home Guard",
      description:
        "The threshold is warded for good: no enemy piece may ever move onto your first rank. Your back rank stays yours, and no enemy pawn can promote on it.",
      tier: 7,
      category: "protection",
      icon: "Fence",
      flavor: "They may take the field. They will not take the hall.",
    },
    instant((_inst, api) => {
      const r = api.me === "w" ? 0 : 7;
      const squares: Square[] = [];
      for (let f = 0; f < 8; f++) squares.push(SQ(f, r));
      addEffect(api, { kind: "barred", squares, against: api.opp, turns: null });
    }),
  ),

  // Positional single-piece ward: whatever friendly piece stands directly in
  // front of your king is untouchable. Neighbours: Divine Right (king vs
  // pawns), Diplomatic Immunity (chosen envoy). Distinct: the ward is a
  // FLOATING relation to the king's front square - move the king or the
  // blocker and the protection moves or lapses with it.
  boon(
    {
      id: "bw3_kings_shield",
      name: "King's Shield",
      description:
        "The king's own shieldbearer never falls first: your piece standing on the square directly in front of your king cannot be captured. Whichever piece holds that square is protected while it stays there.",
      tier: 3,
      category: "protection",
      icon: "ShieldHalf",
      flavor: "Stand there. Do not move. That is the whole job.",
      fx: { motif: "ward", pieces: "all", self: true },
    },
    oppFilter((moves, _inst, api) => {
      const ks = mySquares(api.board, api.me, "k")[0];
      if (ks == null) return moves;
      const fwd = api.me === "w" ? 1 : -1;
      const fr = RANK(ks) + fwd;
      if (fr < 0 || fr > 7) return moves;
      const shieldSq = SQ(FILE(ks), fr);
      const p = api.board.pieces[shieldSq];
      if (!p || p.color !== api.me || p.type === "k") return moves;
      return nonEmpty(moves.filter((m) => captureSquare(m) !== shieldSq), moves);
    }),
  ),

  // ===== TIER 3 ==============================================================

  // A short mobility burst: for two turns your pawns may double-step from any
  // rank, not just their start square. Neighbours: none (the double-step is
  // start-only in the base rules). Distinct: a temporary rule change that lets
  // a whole pawn front lurch forward, non-capturing, never onto the last rank.
  boon(
    {
      id: "bw3_forced_march",
      name: "Forced March",
      description: "For your next 2 turns, any of your pawns may advance two squares in one move from wherever it stands, both squares ahead being empty, not only from its starting rank. It cannot double-step onto the final rank. Each such advance flashes its landing square.",
      tip: "Two turns is enough to break a blockade or race a passed pawn two ranks closer.",
      tier: 3,
      category: "movement",
      icon: "Footprints",
      flavor: "Blisters now. Queens later.",
      requires: ["p"],
      fx: { motif: "rally", pieces: ["p"], self: true },
    },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.turns = 2;
      },
      augmentMoves: (moves, inst, api) => {
        if (turnsLeft(inst) <= 0) return;
        const out: Move[] = [];
        const fwd = api.me === "w" ? 1 : -1;
        for (const from of mySquares(api.board, api.me, "p")) {
          const midr = RANK(from) + fwd, tr = RANK(from) + 2 * fwd;
          if (tr < 0 || tr > 7) continue;
          const to = SQ(FILE(from), tr);
          if (relRank(api.me, to) > 7) continue; // no double-step onto the last rank
          if (api.board.pieces[SQ(FILE(from), midr)] || api.board.pieces[to]) continue;
          out.push({ from, to, piece: "p", color: api.me, via: inst.id } as Move);
        }
        addNovel(moves, out);
      },
      onMovePlayed: (inst, move, api) => {
        // Telegraph: the destination is flagged for the opponent until they reply.
        if (move.via === inst.id && move.color === api.me) {
          addEffect(api, { kind: "strike", squares: [move.to], owner: api.me, turns: 1 });
        }
        tickTurns(inst, move, api.me);
      },
      status: (inst) => `${turnsLeft(inst)} of your turns left`,
    },
  ),

  // A draft cadence bet: gorge on one bumper offer, then fast. Neighbours:
  // Scout (takeBoth + spend a reroll), Ascetic's Bargain (skip now, feast
  // later). Distinct: your NEXT offer shows three cards AND you take all three,
  // paid for by skipping the offer after it.
  boon(
    {
      id: "bw3_double_down",
      name: "Double Down",
      description:
        "Push it all onto the next hand: your next draft shows three cards and you keep all three of them. In return, the draft after that is skipped.",
      tier: 4,
      category: "draft",
      icon: "Layers2",
      flavor: "The house always wins. You are, briefly, the house.",
    },
    instant((_inst, api) => {
      api.mine.flags.prepThree = true;
      api.mine.flags.takeBoth = (api.mine.flags.takeBoth ?? 0) + 1;
      api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 1;
    }),
  ),

  // A comeback aggression grant gated on being BEHIND: only while outnumbered
  // may your pawns strike sideways. Neighbours: Cornered King (king moves as a
  // knight while behind). Distinct: pawns gain a horizontal capture, turning a
  // losing pawn mass into a threat, and it switches off the moment you draw
  // level.
  boon(
    {
      id: "bw3_underdogs_gambit",
      name: "Underdog's Gambit",
      description: "While you have fewer pieces than your opponent, kings aside, your pawns may also capture an enemy piece standing directly beside them, one square left or right. Draw level and they fight like pawns again. It takes hold after your opponent's next move.",
      tip: "A comeback card: it does nothing at all while you are level or ahead.",
      tier: 3,
      category: "movement",
      icon: "Swords",
      flavor: "A cornered pawn bites sideways.",
      requires: ["p"],
      fx: { motif: "empower", pieces: ["p"], self: true },
    },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.armed = false;
      },
      onMovePlayed: (inst, move, api) => {
        // Delay: the payoff wakes only after the opponent has replied once.
        if (!inst.state.armed && move.color === api.opp) inst.state.armed = true;
      },
      augmentMoves: (moves, inst, api) => {
        if (!inst.state.armed) return;
        if (armySize(api.board, api.me) >= armySize(api.board, api.opp)) return;
        const out: Move[] = [];
        for (const from of mySquares(api.board, api.me, "p")) {
          const r = RANK(from), f = FILE(from);
          for (const df of [-1, 1]) {
            const nf = f + df;
            if (nf < 0 || nf > 7) continue;
            const to = SQ(nf, r);
            const t = api.board.pieces[to];
            if (!t || t.color !== api.opp) continue;
            out.push({
              from,
              to,
              piece: "p",
              color: api.me,
              captured: t.type,
              capturedSquare: to,
              via: inst.id,
            } as Move);
          }
        }
        addNovel(moves, out);
      },
    },
  ),

  // A one-shot early promotion to a KNIGHT specifically. Neighbours: Early
  // Coronation (pawns promote to queens in the far third over 3 turns),
  // promote_now / mass_promote_minor. Distinct: a single pawn, mid-board, is
  // knighted the moment you play it - the one promotion you can never reach by
  // normal underpromotion (which only happens on the last rank).
  boon(
    {
      id: "bw3_field_knighting",
      name: "Field Knighting",
      description:
        "Knighted on the battlefield, no cathedral required: choose one of your pawns that has advanced at least to the middle of the board (its fifth rank or beyond) and it becomes a knight where it stands.",
      tier: 3,
      category: "pieces",
      icon: "Award",
      flavor: "Arise, Sir Pawn. Try not to die immediately.",
      requires: ["p"],
    },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the pawn to knight",
              squares: mySquares(api.board, api.me, "p").filter((sq) => relRank(api.me, sq) >= 5),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.me || p.type !== "p") return;
        if (relRank(api.me, sq) < 5) return;
        api.setPieceType(sq, "n");
      },
    ),
  ),

  // Relational protection for the queen: she is untouchable while a knight or
  // bishop of yours stands beside her. Neighbours: Diplomatic Immunity (envoy
  // in foreign half), Divine Right. Distinct: a conditional, positional royal
  // ward that asks you to keep a minor escorting the queen - trade the escort
  // and she is exposed again.
  boon(
    {
      id: "bw3_praetorian",
      name: "Praetorian",
      description:
        "The guard never leaves her side: your queen cannot be captured while at least one of your knights or bishops stands on a square adjacent to her. Cut down her escort and the guard is gone.",
      tier: 4,
      category: "protection",
      icon: "Shield",
      flavor: "Nine of them. One job. They take it personally.",
      requires: ["q"],
      fx: { motif: "ward", pieces: ["q"], self: true },
    },
    oppFilter((moves, _inst, api) =>
      nonEmpty(
        moves.filter((m) => {
          const cs = captureSquare(m);
          if (cs == null) return true;
          const p = api.board.pieces[cs];
          if (!p || p.color !== api.me || p.type !== "q") return true;
          const r = RANK(cs), f = FILE(cs);
          for (let df = -1; df <= 1; df++) {
            for (let dr = -1; dr <= 1; dr++) {
              if (df === 0 && dr === 0) continue;
              const nf = f + df, nr = r + dr;
              if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
              const q = api.board.pieces[SQ(nf, nr)];
              if (q && q.color === api.me && (q.type === "n" || q.type === "b")) return false;
            }
          }
          return true;
        }),
        moves,
      ),
    ),
  ),

  // ===== TIER 4 ==============================================================

  // A behind-gated positional metamorphosis whose REWARD SCALES with the
  // deficit: your spearhead pawn hardens into a knight, or a rook when you are
  // badly outnumbered. Neighbours: Field Knighting (T3: CHOOSE any advanced
  // pawn, unconditional, always a knight), Cornered King (king movement while
  // behind). Distinct from Field Knighting on all three axes: it is
  // behind-GATED, auto-targets your MOST advanced pawn (no choice), and its
  // payoff scales to a rook at a large deficit, so it is a comeback engine
  // rather than a proactive tempo upgrade (balance review: the scaling was
  // added to remove the near-duplication with Field Knighting and to justify
  // the tier gap).
  boon(
    {
      id: "bw3_battlefield_commission",
      name: "Battlefield Commission",
      description: "If you have fewer pieces than your opponent, kings aside, your most advanced pawn is promoted where it stands: to a knight, or to a rook if you are outnumbered by four or more. The new piece cannot move again on your next turn.",
      tip: "Used while you are not behind the commission goes unsigned, so save it.",
      tier: 4,
      category: "pieces",
      icon: "Medal",
      flavor: "War is the fastest career ladder ever built.",
      requires: ["p"],
    },
    activatedSimple((_inst, api) => {
      const mine = armySize(api.board, api.me);
      const theirs = armySize(api.board, api.opp);
      if (mine >= theirs) return;
      const pawns = mySquares(api.board, api.me, "p");
      if (pawns.length === 0) return;
      let tip = pawns[0];
      for (const sq of pawns) {
        if (relRank(api.me, sq) > relRank(api.me, tip)) tip = sq;
      }
      api.setPieceType(tip, theirs - mine >= 4 ? "r" : "n");
      // The fresh commission cannot move again on your next turn. turns:2 so it
      // survives the activation's own tick (passTurnAfterBuff) and expires after
      // your next move.
      addEffect(api, { kind: "freeze", sq: tip, owner: api.me, turns: 2 });
    }),
  ),

  // King-safety footwork that exists only UNDER CHECK. Neighbours: Bolt Hole
  // (king teleports within 2 squares while in check), Cornered King (knight
  // move while behind, permanent). Distinct: while in check your king may leap
  // like a knight to escape, a different escape geometry, twice.
  boon(
    {
      id: "bw3_royal_caper",
      name: "Royal Caper",
      description:
        "A cornered king learns to vault: while your king is in check it may leap like a knight, its landing square flagged for your opponent until they reply. The trick works twice, then the old bones remember their age.",
      tier: 4,
      category: "movement",
      icon: "Rabbit",
      flavor: "Dignity is for kings who are not currently being chased.",
      fx: { motif: "empower", pieces: ["k"], moveAs: "n", self: true },
    },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 2;
      },
      augmentMoves: (moves, inst, api) => {
        if (((inst.state.charges as number) ?? 0) <= 0) return;
        if (!isInCheck(api.board, api.me)) return;
        const ks = mySquares(api.board, api.me, "k")[0];
        if (ks == null) return;
        addNovel(moves, leapMoves(api.board, ks, KNIGHT_LEAPS, inst.id));
      },
      onMovePlayed: (inst, move, api) => {
        // Telegraph: the king's landing square is flagged for the opponent until
        // they reply.
        if (move.via === inst.id && move.color === api.me) {
          addEffect(api, { kind: "strike", squares: [move.to], owner: api.me, turns: 1 });
        }
        spendOnVia(inst, move);
      },
      status: (inst) => `${(inst.state.charges as number) ?? 2} uses left`,
    },
  ),

  // Draft economy tied to the board: each capture buys a reroll. Neighbours:
  // Peek (flat +1 reroll). Distinct: a passive that converts aggression into
  // draft options, up to 3, so it rewards playing on rather than a flat grant.
  boon(
    {
      id: "bw3_plunderers_ledger",
      name: "Plunderer's Ledger",
      description:
        "Every prize is entered in the ledger: each of your next 3 captures earns you one draft reroll to spend whenever you like. The ledger closes after two of your drafts, and any captures not yet cashed in are lost.",
      tier: 4,
      category: "draft",
      icon: "BookMarked",
      flavor: "Loot is just tempo you can carry.",
    },
    {
      kind: "passive",
      init: (inst, api) => {
        inst.state.charges = 3;
        inst.state.draftAt = api.mine.draftsTaken;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent) return;
        // The ledger closes after two of your drafts, forfeiting unclaimed spoils.
        if (api.mine.draftsTaken - ((inst.state.draftAt as number) ?? 0) >= 2) {
          inst.spent = true;
          return;
        }
        const left = (inst.state.charges as number) ?? 0;
        if (left <= 0 || move.color !== api.me) return;
        if (!move.captured || move.captured === "k") return;
        api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
        inst.state.charges = left - 1;
        if (left - 1 <= 0) inst.spent = true;
      },
      status: (inst) => `${(inst.state.charges as number) ?? 3} spoils left`,
    },
  ),

  // A self-favouring clock hook keyed to PROMOTION. Neighbours: Highwayman's
  // Toll (captures), First Blood (first capture). Distinct: the reward fires
  // once, when one of your pawns crowns, so racing a pawn home pays in time as
  // well as material.
  boon(
    {
      id: "bw3_coronation_bonus",
      name: "Coronation Bonus",
      description:
        "The crowning is worth a stolen hour: the first time one of your pawns promotes, you gain 30 seconds on your clock. In untimed games it grants nothing.",
      tier: 2,
      category: "tempo",
      icon: "Crown",
      flavor: "Long live whoever this used to be.",
      requires: ["p"],
    },
    {
      kind: "passive",
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.me || !move.promotion) return;
        api.adjustClock({ addSelfSec: 30 });
        inst.spent = true;
      },
      status: () => "a crown buys an hour",
    },
  ),

  // A comeback trigger keyed to near-annihilation: when your army is reduced to
  // three or fewer, your best fallen piece marches back. Neighbours: Restitution
  // (per outnumbered type), Queen's Testament (on queen death). Distinct: an
  // army-SIZE threshold, so it is the safety net for a collapse rather than a
  // per-type or per-piece trigger.
  boon(
    {
      id: "bw3_eleventh_hour",
      name: "Eleventh Hour",
      description:
        "When the last of the line is nearly spent, help arrives: the first time your non-king pieces number three or fewer, your best captured piece returns to the empty square nearest your home rank.",
      tier: 4,
      category: "pieces",
      icon: "Hourglass",
      flavor: "Reinforcements are always exactly this late.",
      fx: { motif: "rally", pieces: "all", self: true },
    },
    {
      kind: "passive",
      onMovePlayed: (inst, _move, api) => {
        if (inst.spent || armySize(api.board, api.me) > 3) return;
        for (const t of VALUE_ORDER) {
          if (revivable(api, t) <= 0) continue;
          const sq = autoPlaceSquare(api, api.me, t);
          if (sq == null) continue;
          api.place(sq, t, api.me);
          markRevived(api, t);
          inst.spent = true;
          return;
        }
      },
      status: () => "held for the darkest hour",
    },
  ),

  // Friendly terrain: claim one file as a road your pieces cross and the enemy
  // cannot occupy on your side of the board. Neighbours: Home Guard (your whole
  // first rank), barLine hexes. Distinct: a self-flavoured `barred` corridor -
  // the enemy is locked off half of one file so your pieces travel it in
  // safety.
  boon(
    {
      id: "bw3_kings_road",
      name: "King's Road",
      description:
        "One lane on the board is declared yours: choose a file, and for the rest of the game no enemy piece may stand on that file across your own half of the board, save its most advanced square, which stays open. Your pieces travel it freely.",
      tier: 4,
      category: "protection",
      icon: "Milestone",
      flavor: "Tolls, bandits and enemy rooks: strictly prohibited.",
    },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose a file to claim as your road",
              squares: Array.from({ length: 64 }, (_, i) => i),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        const f = FILE(sq);
        const squares: Square[] = [];
        for (let r = 0; r < 8; r++) {
          const s = SQ(f, r);
          if (inHalf(api.me, s)) squares.push(s);
        }
        // Balance: the road is one square shorter, ceding its most advanced
        // square (the largest count above one, reduced by one).
        squares.sort((a, b) => relRank(api.me, a) - relRank(api.me, b));
        if (squares.length > 1) squares.pop();
        addEffect(api, { kind: "barred", squares, against: api.opp, turns: null });
      },
    ),
  ),

  // ===== TIER 5 ==============================================================

  // A transformation with a bleeding cost: a minor is forged up into a rook,
  // paid for by feeding a pawn to the fire. Neighbours: Alchemist's Trade (a
  // minor rises to a queen, paid by DEMOTING another piece to a pawn).
  // Distinct: the rise is only to a rook, and the price is a pawn REMOVED (a
  // real loss), a different cost currency.
  boon(
    {
      id: "bw3_ironwrights_bargain",
      name: "Ironwright's Bargain",
      description:
        "The forge takes iron and gives iron back heavier: one of your knights or bishops is reforged into a rook, and in payment one of your pawns is thrown into the fire and lost. Your next draft is skipped while the forge cools.",
      tier: 3,
      category: "pieces",
      icon: "Hammer",
      flavor: "Steel is only rearranged suffering.",
      requires: ["n", "b"],
    },
    activated(
      (_inst, api, picks) => {
        if (picks.length >= 2) return null;
        if (picks.length === 0) {
          const havePawn = mySquares(api.board, api.me, "p").length > 0;
          return {
            kind: "square",
            label: "Choose the knight or bishop to reforge",
            squares: havePawn
              ? mySquares(api.board, api.me).filter((sq) => {
                  const t = api.board.pieces[sq]!.type;
                  return t === "n" || t === "b";
                })
              : [],
          };
        }
        return {
          kind: "square",
          label: "Choose the pawn fed to the forge",
          squares: mySquares(api.board, api.me, "p"),
        };
      },
      (_inst, api, picks) => {
        const up = picks[0]?.square, pay = picks[1]?.square;
        if (up == null || pay == null || up === pay) return;
        const pu = api.board.pieces[up], pp = api.board.pieces[pay];
        if (!pu || pu.color !== api.me || (pu.type !== "n" && pu.type !== "b")) return;
        if (!pp || pp.color !== api.me || pp.type !== "p") return;
        api.removePiece(pay);
        api.setPieceType(up, "r");
        // In payment, your next draft is skipped.
        api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 1;
      },
    ),
  ),

  // Terrain-crossing movement: one rook permanently phases through your own
  // pieces. Neighbours: Standard Bearer (a pawn slides as a non-capturing
  // queen). Distinct: a rook that ignores friendly blockers, so a jammed back
  // rank suddenly breathes.
  boon(
    {
      id: "bw3_tunnelers",
      name: "Tunnelers",
      description:
        "It digs its own lines: choose one of your rooks, and for the rest of the game it may slide straight through your own pieces to any empty square beyond. The tunneling slide can never capture, friend or foe.",
      tier: 3,
      category: "movement",
      icon: "Pickaxe",
      flavor: "The wall is not a problem. The wall is a suggestion.",
      requires: ["r"],
      fx: { motif: "empower", pieces: ["r"], moveAs: "r", self: true },
    },
    pieceBound("r", "Choose the rook that tunnels", (board, sq, via) =>
      // The special move cannot capture: keep only slides that land on an empty
      // square beyond a friendly screen (the rook's normal moves still capture).
      phasingSlideMoves(board, sq, ORTHO_DIRS, via, 8).filter((m) => !m.captured),
    ),
  ),

  // A self-favouring clock hook keyed to DEEP INFILTRATION. Neighbours:
  // Highwayman's Toll, Coronation Bonus. Distinct: the reward fires the first
  // time any of your pieces reaches the opponent's back two ranks, so pressing
  // into their camp is worth time.
  boon(
    {
      id: "bw3_deep_position",
      name: "Deep Position",
      description:
        "Break into their camp and the clock rewards the incursion: the first time any of your pieces reaches your opponent's back two ranks, you gain 45 seconds. In untimed games it grants nothing.",
      tier: 3,
      category: "tempo",
      icon: "Flag",
      flavor: "Behind their lines, time moves differently. In your favor.",
    },
    {
      kind: "passive",
      onMovePlayed: (inst, move, api) => {
        if (inst.spent || move.color !== api.me) return;
        if (relRank(api.me, move.to) < 7) return;
        api.adjustClock({ addSelfSec: 45 });
        inst.spent = true;
      },
      status: () => "time waits behind their lines",
    },
  ),

  // A comeback economy engine that pays out on YOUR losses. Neighbours:
  // Plunderer's Ledger (rerolls on YOUR captures). Distinct: this fires when
  // the opponent captures your pieces, funding rerolls and a trickle of clock
  // time, so being ground down builds toward a swing.
  boon(
    {
      id: "bw3_martyrs_gift",
      name: "Martyr's Gift",
      description:
        "Every loss leaves you something: each of the next 3 times your opponent captures one of your pieces, you gain a draft reroll and 5 seconds on your clock.",
      tier: 3,
      category: "draft",
      icon: "HeartCrack",
      flavor: "They spent a piece of yours. You spent nothing. Interesting.",
    },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 3;
      },
      onMovePlayed: (inst, move, api) => {
        const left = (inst.state.charges as number) ?? 0;
        if (left <= 0 || move.color !== api.opp) return;
        if (!move.captured || move.captured === "k") return;
        api.mine.rerollsLeft = (api.mine.rerollsLeft ?? 0) + 1;
        api.adjustClock({ addSelfSec: 5 });
        inst.state.charges = left - 1;
        if (left - 1 <= 0) inst.spent = true;
      },
      status: (inst) => `${(inst.state.charges as number) ?? 3} tributes left`,
    },
  ),

  // Relational protection: any piece a pawn of yours defends cannot be taken.
  // Neighbours: Shield Wall (pawns that shore each other), Eternal Keep (first
  // rank). Distinct: the ward extends to WHATEVER a pawn guards - a defended
  // knight, rook, even queen - so it rewards sound pawn structure across the
  // whole army. The king is explicitly excluded so check detection is never
  // disturbed.
  boon(
    {
      id: "bw3_watchword",
      name: "Watchword",
      description: "Up to four of your pieces, your king aside, that are defended by one of your pawns cannot be captured. When more than four qualify, the four most valuable are sheltered.",
      tip: "Removing a piece's pawn drops its shelter, so keep the defending pawns alive.",
      tier: 5,
      category: "protection",
      icon: "Eye",
      flavor: "The humblest sentry, the strongest wall.",
      requires: ["p"],
      fx: { motif: "ward", pieces: "all", self: true },
    },
    oppFilter((moves, _inst, api) => {
      // Gather my pawn-defended non-king pieces (a friendly pawn one rank toward
      // home, diagonally adjacent, could recapture there), then shelter at most
      // the four most valuable of them (value order, then square: deterministic).
      const back = api.me === "w" ? -1 : 1;
      const defended: Square[] = [];
      for (const sq of mySquares(api.board, api.me)) {
        const p = api.board.pieces[sq]!;
        if (p.type === "k") continue;
        const pr = RANK(sq) + back;
        if (pr < 0 || pr > 7) continue;
        let guarded = false;
        for (const df of [-1, 1]) {
          const pf = FILE(sq) + df;
          if (pf < 0 || pf > 7) continue;
          const q = api.board.pieces[SQ(pf, pr)];
          if (q && q.color === api.me && q.type === "p") {
            guarded = true;
            break;
          }
        }
        if (guarded) defended.push(sq);
      }
      defended.sort((a, b) => {
        const va = VALUE_ORDER.indexOf(api.board.pieces[a]!.type);
        const vb = VALUE_ORDER.indexOf(api.board.pieces[b]!.type);
        return va !== vb ? va - vb : a - b;
      });
      const guardedSet = new Set(defended.slice(0, 4));
      return nonEmpty(
        moves.filter((m) => {
          const cs = captureSquare(m);
          return cs == null ? true : !guardedSet.has(cs);
        }),
        moves,
      );
    }),
  ),

  // Friendly terrain plus king safety: consecrate one empty haven the enemy can
  // never occupy, and your king may flee to it whenever in check. Neighbours:
  // Bolt Hole (teleport within 2 while in check), King's Road. Distinct: a
  // single FIXED, pre-claimed refuge that stays empty (barred to the enemy) and
  // is a guaranteed escape square for as long as the game lasts.
  boon(
    {
      id: "bw3_hallowed_ground",
      name: "Hallowed Ground",
      description:
        "Consecrate one empty square in your half: no enemy piece may ever stand on it, and while your king is in check it may step there from anywhere on the board.",
      tier: 5,
      category: "protection",
      icon: "Sparkle",
      flavor: "Draw the circle once. Stand in it forever.",
      fx: { motif: "ward", pieces: ["k"], self: true },
    },
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) =>
        picks.length > 0 || inst.state.sq != null
          ? null
          : {
              kind: "square",
              label: "Consecrate an empty haven in your half",
              squares: emptySquares(api.board, (sq) => inHalf(api.me, sq)),
            },
      effect: (inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null || inst.state.sq != null || api.board.pieces[sq]) return;
        if (!inHalf(api.me, sq)) return;
        inst.state.sq = sq;
        addEffect(api, { kind: "barred", squares: [sq], against: api.opp, turns: null });
      },
      augmentMoves: (moves, inst, api) => {
        const sq = inst.state.sq as Square | undefined;
        if (sq == null || api.board.pieces[sq] || !isInCheck(api.board, api.me)) return;
        const ks = mySquares(api.board, api.me, "k")[0];
        if (ks == null) return;
        addNovel(moves, teleportMoves(api.board, ks, [sq], inst.id));
      },
      status: (inst) => {
        const sq = inst.state.sq as Square | undefined;
        return sq == null
          ? "consecrate a haven"
          : `haven at ${"abcdefgh"[FILE(sq)]}${RANK(sq) + 1}`;
      },
    },
  ),

  // ===== TIER 6 ==============================================================

  // An identity upgrade to a fairy piece: one bishop gains the knight's leap
  // for good, an archbishop. Neighbours: Standard Bearer (pawn gains queen
  // slides), Cornered King (king gains knight when behind). Distinct: a
  // permanent bishop-plus-knight hybrid bound to one chosen bishop.
  boon(
    {
      id: "bw3_second_face",
      name: "Second Face",
      description:
        "It learns a second way to move: choose one of your bishops, and for your opponent's next 4 turns it may also leap like a knight, keeping all of its bishop moves as well. The second face falls away early if your opponent spends a draft reroll.",
      tier: 3,
      category: "movement",
      icon: "Drama",
      flavor: "Priest on the light squares, cavalry everywhere else.",
      requires: ["b"],
      fx: { motif: "empower", pieces: ["b"], moveAs: "n", self: true },
    },
    {
      kind: "activated",
      spendOnUse: false,
      // One activation binds the bishop; from then on it is a timed passive.
      targets: (inst, api, picks) =>
        picks.length > 0 || inst.state.sq != null
          ? null
          : {
              kind: "square",
              label: "Choose the bishop that takes a second face",
              squares: mySquares(api.board, api.me, "b"),
            },
      effect: (inst, api, picks) => {
        if (inst.state.sq != null) return;
        inst.state.sq = picks[0]?.square;
        inst.state.turns = 4; // four of the opponent's turns
        inst.state.oppRerolls = api.theirs.rerollsLeft;
      },
      augmentMoves: (moves, inst, api) => {
        const sq = inst.state.sq as Square | undefined;
        if (sq == null || inst.spent) return;
        const p = api.board.pieces[sq];
        if (!p || p.color !== api.me) return;
        addNovel(moves, leapMoves(api.board, sq, KNIGHT_LEAPS, inst.id));
      },
      onMovePlayed: (inst, move, api) => {
        trackBoundPiece(inst, move, { dieOnPromote: true });
        const sq = inst.state.sq as Square | undefined;
        if (sq == null || inst.spent) return;
        // Ends early if the opponent spends a draft reroll (their count drops).
        const snap = inst.state.oppRerolls as number | undefined;
        if (snap != null && api.theirs.rerollsLeft < snap) {
          inst.spent = true;
          return;
        }
        inst.state.oppRerolls = api.theirs.rerollsLeft;
        // Runs for four of the opponent's turns.
        if (move.color === api.opp) {
          const t = ((inst.state.turns as number) ?? 0) - 1;
          inst.state.turns = t;
          if (t <= 0) inst.spent = true;
        }
      },
      status: (inst) => {
        const sq = inst.state.sq as Square | undefined;
        if (sq == null) return "activate to choose a bishop";
        return `bound to ${"abcdefgh"[FILE(sq)]}${RANK(sq) + 1}, ${(inst.state.turns as number) ?? 4} of their turns left`;
      },
    },
  ),

  // A rescue relocation: gather any one piece to your king's side in a blink.
  // Neighbours: warp/teleport family, Bolt Hole (king itself). Distinct: it
  // moves a piece OTHER than the king to a square touching the king, so it is
  // a rally-to-the-defense rather than a king escape or a generic warp.
  boon(
    {
      id: "bw3_rally_royal",
      name: "Rally to the King",
      description:
        "Call the nearest blade home: teleport any one of your pieces (your king aside) to an empty square directly adjacent to your king.",
      tier: 2,
      category: "movement",
      icon: "Castle",
      flavor: "Form up. Backs to the throne.",
    },
    activated(
      (_inst, api, picks) => {
        if (picks.length >= 2) return null;
        const ks = mySquares(api.board, api.me, "k")[0];
        const adj: Square[] = [];
        if (ks != null) {
          const r = RANK(ks), f = FILE(ks);
          for (let df = -1; df <= 1; df++) {
            for (let dr = -1; dr <= 1; dr++) {
              if (df === 0 && dr === 0) continue;
              const nf = f + df, nr = r + dr;
              if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
              const s = SQ(nf, nr);
              if (!api.board.pieces[s]) adj.push(s);
            }
          }
        }
        if (picks.length === 0) {
          return {
            kind: "square",
            label: "Choose a piece to rally to the king",
            squares:
              adj.length > 0
                ? mySquares(api.board, api.me).filter(
                    (sq) => api.board.pieces[sq]!.type !== "k",
                  )
                : [],
          };
        }
        const from = picks[0].square!;
        const isPawn = api.board.pieces[from]?.type === "p";
        return {
          kind: "square",
          label: "Choose an empty square beside your king",
          squares: adj.filter((s) => !isPawn || pawnRankOk(s)),
        };
      },
      (_inst, api, picks) => {
        const from = picks[0]?.square, to = picks[1]?.square;
        if (from == null || to == null || from === to) return;
        const p = api.board.pieces[from];
        if (!p || p.color !== api.me || p.type === "k") return;
        if (api.board.pieces[to]) return;
        if (p.type === "p" && !pawnRankOk(to)) return;
        api.relocate(from, to);
      },
    ),
  ),

  // A clean draft acquisition: keep both cards of your next offer at the usual
  // tier. Neighbours: Double Down (three cards once, then a skip), Scout (take
  // both, spend a reroll). Distinct: a two-kept-cards grab with no draft skipped
  // and no tier bump. Balance review: the old apex-bank package (two skipped
  // drafts, then a banked apex pull) is replaced by two kept cards at the
  // current tier, so a skipped enemy draft is never combined with a full
  // premium offer.
  boon(
    {
      id: "bw3_futures_market",
      name: "Futures Market",
      description:
        "Take the whole of the next hand: your next draft deals its two cards at the usual tier and you keep both of them, with no draft skipped.",
      tier: 7,
      category: "draft",
      icon: "TrendingUp",
      flavor: "Buy the whole hand outright. No mortgage, no waiting.",
    },
    instant((_inst, api) => {
      // Two kept cards at the current tier: your next offer keeps both of its
      // cards at the usual tier. No enemy draft is skipped and no premium/apex
      // promotion is stacked on top - the two are never combined.
      api.mine.flags.takeBoth = (api.mine.flags.takeBoth ?? 0) + 1;
    }),
  ),

  // An out-of-turn castle that ignores the usual bars (moved king or rook, an
  // intervening check). Neighbours: Postern Gate (rights restore only),
  // kingslide. Distinct: it physically performs the castle now, sliding king
  // and rook, as long as the path between them is empty.
  boon(
    {
      id: "bw3_castle_in_the_storm",
      name: "Castle in the Storm",
      description: "Choose one of your rooks on your king's rank with an empty path to the king and castle toward it at once, king two squares over, rook to the square it passed, even if your king or that rook has already moved. That rook cannot move again on your next turn.",
      tip: "It ignores spent castling rights entirely, so a king caught in the centre can still tuck away.",
      tier: 3,
      category: "movement",
      icon: "Castle",
      flavor: "The masons work fastest when the arrows are already flying.",
    },
    activated(
      (_inst, api, picks) => {
        if (picks.length > 0) return null;
        const ks = mySquares(api.board, api.me, "k")[0];
        if (ks == null) return { kind: "square", label: "No king to castle", squares: [] };
        const kr = RANK(ks), kf = FILE(ks);
        const rooks = mySquares(api.board, api.me, "r").filter((rsq) => {
          if (RANK(rsq) !== kr) return false;
          const dir = Math.sign(FILE(rsq) - kf);
          if (dir === 0) return false;
          for (let f = kf + dir; f !== FILE(rsq); f += dir) {
            if (api.board.pieces[SQ(f, kr)]) return false;
          }
          const ktf = kf + 2 * dir;
          return ktf >= 0 && ktf <= 7;
        });
        return { kind: "square", label: "Choose the rook to castle with", squares: rooks };
      },
      (_inst, api, picks) => {
        const rsq = picks[0]?.square;
        if (rsq == null) return;
        const ks = mySquares(api.board, api.me, "k")[0];
        if (ks == null) return;
        const kr = RANK(ks), kf = FILE(ks);
        const rp = api.board.pieces[rsq];
        if (!rp || rp.color !== api.me || rp.type !== "r" || RANK(rsq) !== kr) return;
        const dir = Math.sign(FILE(rsq) - kf);
        if (dir === 0) return;
        for (let f = kf + dir; f !== FILE(rsq); f += dir) {
          if (api.board.pieces[SQ(f, kr)]) return;
        }
        const ktf = kf + 2 * dir;
        if (ktf < 0 || ktf > 7) return;
        const kto = SQ(ktf, kr), rto = SQ(kf + dir, kr);
        // Move the rook clear first so the king's destination (which can be the
        // rook's old square when the rook is exactly two files away) is empty.
        api.relocate(rsq, rto);
        api.relocate(ks, kto);
        api.restoreCastling();
        // The rook that just castled cannot move again on your next turn (the
        // king is never frozen). turns:2 survives the activation's own tick.
        addEffect(api, { kind: "freeze", sq: rto, owner: api.me, turns: 2 });
      },
    ),
  ),

  // A summoning miracle with a built-in expiry: raise a short-lived pawn wall.
  // Neighbours: Scarecrow (one permanent inert pawn), Shadow Reserve (pocket
  // pieces). Distinct: up to three pawns dropped as a defensive line that
  // crumbles (timed_loss, uncounted) after 4 of your turns, so it buys time,
  // not permanent material.
  boon(
    {
      id: "bw3_last_muster",
      name: "Last Muster",
      description:
        "Call up whoever is left in the village: place up to 3 pawns on empty squares in your half. They hold the line, then disband four of your turns later, vanishing from the board.",
      tier: 4,
      category: "pieces",
      icon: "Users",
      flavor: "Farmhands with pitchforks. For four turns, heroes.",
    },
    activated(
      (_inst, api, picks) => {
        if (picks.length >= 3) return null;
        const taken = picks.map((k) => k.square);
        const squares = emptySquares(
          api.board,
          (sq) => inHalf(api.me, sq) && pawnRankOk(sq),
        ).filter((sq) => !taken.includes(sq));
        return {
          kind: "square",
          label: `Muster a pawn (${picks.length + 1}/3)`,
          squares,
          ...(picks.length > 0 ? { finishable: true } : {}),
        };
      },
      (_inst, api, picks) => {
        for (const k of picks) {
          const sq = k.square;
          if (sq == null || api.board.pieces[sq] || !pawnRankOk(sq)) continue;
          api.place(sq, "p", api.me);
          addEffect(api, { kind: "timed_loss", owner: api.me, sq, turns: 4, then: "remove" });
        }
      },
    ),
  ),

  // High-risk removal that turns a piece into a bomb. Neighbours: the atomic
  // capture family, Blood Duel (name an enemy and your matching piece).
  // Distinct: you sacrifice a chosen piece of your OWN and detonate the square
  // it stood on, clearing the enemies around it - an aimed self-immolation.
  boon(
    {
      id: "bw3_funeral_pyre",
      name: "Funeral Pyre",
      description:
        "Light one of your own and let it take the neighbors with it: choose any of your pieces (your king aside). It is removed, and every enemy piece on a square adjacent to it is destroyed in the blast. Shielded enemies and enemy kings survive.",
      tier: 6,
      category: "attack",
      icon: "Flame",
      flavor: "A soldier's last, loudest opinion.",
    },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the piece to set alight",
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
        explodeAt(api, sq);
      },
    ),
  ),

  // Conditional protection that rewards infiltration: pieces deep in enemy
  // territory become untouchable. Neighbours: Diplomatic Immunity (one envoy in
  // the foreign HALF), Eternal Keep (your first rank). Distinct: immunity is
  // granted to ANY of your pieces standing on the opponent's back two ranks, so
  // pushing pieces into their camp makes them stick. King excluded.
  boon(
    {
      id: "bw3_vantage_point",
      name: "Vantage Point",
      description:
        "Dig in on the heights and they cannot dislodge you: any of your pieces (your king aside) standing on your opponent's back two ranks cannot be captured. Step back off the heights and it is fair game again.",
      tier: 7,
      category: "protection",
      icon: "Mountain",
      flavor: "The high ground was always the whole argument.",
      fx: { motif: "ward", pieces: "all", self: true },
    },
    oppFilter((moves, _inst, api) =>
      nonEmpty(
        moves.filter((m) => {
          const cs = captureSquare(m);
          if (cs == null) return true;
          const p = api.board.pieces[cs];
          if (!p || p.color !== api.me || p.type === "k") return true;
          return relRank(api.me, cs) < 7;
        }),
        moves,
      ),
    ),
  ),

  // ===== TIER 7 ==============================================================

  // An army-wide transformation with no material change: every knight and
  // bishop trades roles. Neighbours: Masquerade (exactly two chosen pieces),
  // Carnival of Masks (random shuffle including rooks and queens).
  //
  // Deliberately distinct from Spectral Retinue (wa_spectral_minors, a Tier 3
  // BUFF-mode instant that performs the bare same knight-for-bishop swap the
  // moment it is drafted). The two share the swap flavour but sit in different
  // draft pools and are separated on three axes so neither is a copy of the
  // other:
  //   - trigger: Spectral Retinue fires instantly on draft; Mummers' Dance is
  //     an activated ability you hold and fire on the turn of your choosing.
  //   - tier / mode: T3 buff vs T7 nerf-mode boon.
  //   - power: Mummers' Dance also MASKS the whole re-tasked minor corps from
  //     capture for the opponent's next turn, so the army-wide re-task can't be
  //     punished mid-costume-change. That protective rider is what earns the
  //     higher tier; the bare swap alone would be a T3 effect.
  boon(
    {
      id: "bw3_mummers_dance",
      name: "Mummers' Dance",
      description: "Every one of your knights becomes a bishop and every one of your bishops becomes a knight, all at once, where they stand. Your material is unchanged, only re-tasked. None of the re-tasked minors can be captured on your opponent's next turn.",
      tip: "Useful when your knights are stuck on open diagonals, or your bishops on a closed board.",
      tier: 4,
      category: "pieces",
      icon: "VenetianMask",
      flavor: "Nobody left the dance as who they arrived.",
      requires: ["n", "b"],
    },
    activatedSimple((_inst, api) => {
      const knights = mySquares(api.board, api.me, "n");
      const bishops = mySquares(api.board, api.me, "b");
      // Pieces swap type in place, so the squares that hold a minor before the
      // swap are exactly the squares that hold the re-tasked minor after it.
      const masked = [...knights, ...bishops];
      for (const sq of knights) api.setPieceType(sq, "b");
      for (const sq of bishops) api.setPieceType(sq, "n");
      // T7 rider: mask the whole re-tasked corps for one enemy turn. turns:1 on
      // a turn-consuming activation is auto-extended to cover the opponent's
      // immediate reply (see game.ts activateBuff), so this reads as exactly
      // "your opponent's next turn".
      if (masked.length) {
        addEffect(api, { kind: "shield", owner: api.me, squares: masked, turns: 1 });
      }
    }),
  ),

  // A one-time defensive miracle bought with your economy. Neighbours: The Long
  // Truce (symmetric, protects the opponent too), Aegis family (shorter blanket
  // shields). Distinct: a one-sided total lockdown of your army AND king for
  // three turns, priced by skipping your next three drafts - a fortress you pay
  // for in the future.
  boon(
    {
      id: "bw3_last_stand",
      name: "Last Stand",
      description: "For the next 3 turns none of your pieces can be captured and your king cannot be taken, but the wall falls the instant one of your pieces makes a capture. Your next 3 drafts are skipped.",
      tip: "Three turns of total safety, paid for up front: use them to untangle, not to attack.",
      tier: 7,
      category: "protection",
      icon: "ShieldPlus",
      flavor: "Hold. Hold. Hold. Worry about tomorrow tomorrow.",
      fx: { motif: "ward", pieces: "all", self: true },
    },
    {
      kind: "passive",
      // Applies the instant its owner acquires it (init runs on acquire, exactly
      // where an instant card's effect would): the shield wall and the draft
      // debt land right now.
      init: (_inst, api) => {
        addEffect(api, { kind: "shield", owner: api.me, squares: null, turns: 3 });
        addEffect(api, { kind: "king_safe", owner: api.me, turns: 3 });
        api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 3;
      },
      onMovePlayed: (inst, move, api) => {
        if (inst.spent) return;
        // The wall falls the moment one of your protected pieces captures: drop
        // the full-army shield and the king ward at once, ending the protection
        // early even though their timers would still cover three turns.
        if (move.color === api.me && move.captured && move.captured !== "k") {
          for (let i = api.bs.effects.length - 1; i >= 0; i--) {
            const e = api.bs.effects[i];
            if (
              (e.kind === "shield" && e.squares === null && e.owner === api.me) ||
              (e.kind === "king_safe" && e.owner === api.me)
            ) {
              api.bs.effects.splice(i, 1);
            }
          }
          inst.spent = true;
        }
      },
      status: (inst) => (inst.spent ? "the wall has fallen" : "the shield wall holds"),
    },
  ),

  // A draft raid that grabs everything for a stretch, then goes hungry.
  // Neighbours: Scout (take both, spend one reroll), Double Down (three cards
  // once). Distinct: you keep every card in your next TWO offers, at the cost
  // of all your rerolls - the widest single acquisition in the pool.
  boon(
    {
      id: "bw3_high_stakes",
      name: "High Stakes",
      description:
        "Sweep the table twice: you keep every card offered in each of your next 2 drafts instead of just one, and one of your drafts is skipped besides. In return you forfeit all of your rerolls, now and forever.",
      tier: 7,
      category: "draft",
      icon: "Dices",
      flavor: "No hedging. No do-overs. Just the whole pot.",
    },
    instant((_inst, api) => {
      api.mine.flags.takeBoth = (api.mine.flags.takeBoth ?? 0) + 2;
      api.mine.rerollsLeft = 0;
      // Balance: one further boon draft is skipped.
      api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 1;
    }),
  ),

  // A comeback miracle that measures the deficit and fills it exactly to
  // parity. Neighbours: Restitution (one revive per outnumbered TYPE), The
  // Great Return (everything, both sides). Distinct: it revives your fallen
  // pieces best-first only until your army equals the opponent's, so it draws
  // you level but never puts you ahead.
  boon(
    {
      id: "bw3_from_the_ashes",
      name: "From the Ashes",
      description:
        "The dead are called back only far enough to make it even: your captured pieces return one at a time to your home rank, strongest first, until your non-king pieces number exactly as many as your opponent's. From ahead or level, nobody rises.",
      tier: 6,
      category: "pieces",
      icon: "Bird",
      flavor: "Balance is restored. No more, no less. The ledger insists.",
    },
    instant((_inst, api) => {
      let safety = 0;
      while (armySize(api.board, api.me) < armySize(api.board, api.opp) && safety < 32) {
        safety++;
        let placed = false;
        for (const t of VALUE_ORDER) {
          if (revivable(api, t) <= 0) continue;
          const sq = autoPlaceSquare(api, api.me, t);
          if (sq == null) continue;
          api.place(sq, t, api.me);
          markRevived(api, t);
          placed = true;
          break;
        }
        if (!placed) break;
      }
    }),
  ),

  // A duel that strips both kings of a bodyguard. Neighbours: Blood Duel (any
  // matching pair anywhere), Blood Price. Distinct: the removal is confined to
  // pieces ADJACENT to the two kings, so it deliberately bares both monarchs at
  // once - a mutual exposure, not a material trade.
  boon(
    {
      id: "bw3_kingsguard_duel",
      name: "Kingsguard Duel",
      description:
        "Honor demands the guards settle it: remove one enemy piece standing beside your opponent's king, and in payment remove one of your own pieces standing beside your king. Both monarchs are left a little more exposed.",
      tier: 5,
      category: "attack",
      icon: "Swords",
      flavor: "The kings watched. Neither offered to take a turn.",
    },
    activated(
      (_inst, api, picks) => {
        const adjOf = (color: Color): Square[] => {
          const kk = mySquares(api.board, color, "k")[0];
          if (kk == null) return [];
          const r = RANK(kk), f = FILE(kk);
          const out: Square[] = [];
          for (let df = -1; df <= 1; df++) {
            for (let dr = -1; dr <= 1; dr++) {
              if (df === 0 && dr === 0) continue;
              const nf = f + df, nr = r + dr;
              if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
              const s = SQ(nf, nr);
              const p = api.board.pieces[s];
              if (p && p.color === color && p.type !== "k") out.push(s);
            }
          }
          return out;
        };
        if (picks.length >= 2) return null;
        if (picks.length === 0) {
          return { kind: "square", label: "Choose the enemy guard to cut down", squares: adjOf(api.opp) };
        }
        return { kind: "square", label: "Choose your own guard to sacrifice", squares: adjOf(api.me) };
      },
      (_inst, api, picks) => {
        const enemy = picks[0]?.square, mine = picks[1]?.square;
        if (enemy == null || mine == null) return;
        const pe = api.board.pieces[enemy], pm = api.board.pieces[mine];
        if (!pe || pe.color !== api.opp || pe.type === "k") return;
        if (!pm || pm.color !== api.me || pm.type === "k") return;
        api.removePiece(enemy);
        api.removePiece(mine);
      },
    ),
  ),

  // A one-shot king rescue: reset the king to the safest empty home-rank
  // square. Neighbours: Bolt Hole (in-check teleport within 2), escape_hatch.
  // Distinct: an instant, deterministic relocation to the home-rank square
  // furthest from any enemy, a full reset button, not a step. Balance review:
  // the one-turn king_safe rider was dropped (protection shortened by its one
  // opponent turn), so it moves the king but grants no immunity.
  boon(
    {
      id: "bw3_kings_sanctuary",
      name: "King's Sanctuary",
      description:
        "Spirit the king home to the quietest corner: your king is moved to the empty square on your home rank that sits furthest from any enemy piece.",
      tier: 6,
      category: "movement",
      icon: "Church",
      flavor: "Sometimes the bravest move is all the way to the back.",
    },
    instant((_inst, api) => {
      const ks = mySquares(api.board, api.me, "k")[0];
      if (ks == null) return;
      const r = api.me === "w" ? 0 : 7;
      const enemies = mySquares(api.board, api.opp);
      let bestSq: Square | null = null;
      let bestScore = -1;
      for (let f = 0; f < 8; f++) {
        const s = SQ(f, r);
        if (api.board.pieces[s] && s !== ks) continue;
        let md = 99;
        for (const esq of enemies) {
          const d = Math.max(Math.abs(FILE(esq) - f), Math.abs(RANK(esq) - r));
          if (d < md) md = d;
        }
        if (md > bestScore) {
          bestScore = md;
          bestSq = s;
        }
      }
      if (bestSq != null && bestSq !== ks) api.relocate(ks, bestSq);
    }),
  ),

  // Self-cost surgical removal at an even exchange. Neighbours: Blood Duel
  // (one-for-one, same kind), Blood Price (feed a piece to the deck). Distinct:
  // you sacrifice ONE of your own minors to remove ONE of the enemy's minors, a
  // targeted minor-for-minor trade at a real cost (balance review: reduced from
  // two enemy removals to one, its repeat use cut by one).
  boon(
    {
      id: "bw3_martyrdom",
      name: "Martyrdom",
      description:
        "One of yours falls so one of theirs must: destroy one of your own knights or bishops, then remove one of your opponent's knights or bishops from the board. Every loss here is real.",
      tier: 3,
      category: "attack",
      icon: "Cross",
      flavor: "A trade the accountants hate and the generals love.",
      requires: ["n", "b"],
    },
    activated(
      (_inst, api, picks) => {
        const myMinor = (sq: Square) => {
          const t = api.board.pieces[sq]?.type;
          return t === "n" || t === "b";
        };
        if (picks.length >= 2) return null;
        if (picks.length === 0) {
          const enemyMinors = mySquares(api.board, api.opp).filter((sq) => {
            const t = api.board.pieces[sq]!.type;
            return t === "n" || t === "b";
          });
          return {
            kind: "square",
            label: "Choose your own knight or bishop to sacrifice",
            squares: enemyMinors.length >= 1 ? mySquares(api.board, api.me).filter(myMinor) : [],
          };
        }
        return {
          kind: "square",
          label: "Choose an enemy knight or bishop to remove",
          squares: mySquares(api.board, api.opp).filter((sq) => {
            const t = api.board.pieces[sq]!.type;
            return t === "n" || t === "b";
          }),
        };
      },
      (_inst, api, picks) => {
        const own = picks[0]?.square, enemy = picks[1]?.square;
        if (own == null || enemy == null) return;
        const po = api.board.pieces[own];
        if (!po || po.color !== api.me || (po.type !== "n" && po.type !== "b")) return;
        const pe = api.board.pieces[enemy];
        if (!pe || pe.color !== api.opp || (pe.type !== "n" && pe.type !== "b")) return;
        api.removePiece(own);
        api.removePiece(enemy);
      },
    ),
  ),

  // ===== TIER 8 ==============================================================

  // A symmetric board-clearing miracle: every minor of BOTH armies is swept
  // away. Neighbours: Blood Duel (one matching pair), the atomic family.
  // Distinct: a total, even purge of all knights and bishops on the board, so
  // it is a great equalizer that favors whichever side is stronger in majors
  // and pawns.
  boon(
    {
      id: "bw3_the_reckoning",
      name: "The Reckoning",
      description:
        "Call in every debt the minor pieces owe: every knight and every bishop on the board, yours and your opponent's alike, is removed at once. Kings, queens, rooks and pawns are untouched.",
      tier: 8,
      category: "attack",
      icon: "Scale",
      flavor: "The horses and the clergy were always going to answer for this.",
    },
    instant((_inst, api) => {
      for (let sq = 0; sq < 64; sq++) {
        const p = api.board.pieces[sq];
        if (p && (p.type === "n" || p.type === "b")) api.removePiece(sq);
      }
    }),
  ),

  // A standing miracle that reverses your next three losses. Neighbours:
  // Deathless Oath (one PRE-BOUND piece, returns once), The Great Return (a
  // single mass revive, both sides). Distinct: an open covenant - the next 3 of
  // your pieces to be captured each march straight back to your home rank, no
  // matter which pieces they turn out to be.
  boon(
    {
      id: "bw3_covenant_of_return",
      name: "Covenant of Return",
      description:
        "Swear the covenant and death loses its next three arguments: the next 3 of your pieces that are captured each return at once to the empty square nearest your home rank.",
      tier: 7,
      category: "pieces",
      icon: "Infinity",
      flavor: "Three times the ferryman rowed back empty.",
    },
    {
      kind: "passive",
      init: (inst) => {
        inst.state.charges = 3;
      },
      onMovePlayed: (inst, move, api) => {
        const left = (inst.state.charges as number) ?? 0;
        if (left <= 0 || move.color !== api.opp) return;
        if (!move.captured || move.captured === "k") return;
        const t = move.captured;
        const sq = autoPlaceSquare(api, api.me, t);
        if (sq == null) return; // no room this time; keep the charge
        api.place(sq, t, api.me);
        markRevived(api, t);
        inst.state.charges = left - 1;
        if (left - 1 <= 0) inst.spent = true;
      },
      status: (inst) => `${(inst.state.charges as number) ?? 3} returns pledged`,
    },
  ),

  // A summoning homecoming paid in drafts. Neighbours: Spoils of War (a
  // captured ENEMY piece defects), Prisoner Exchange (best of each side).
  // Distinct: your own best fallen major AND best fallen minor both return to
  // your home rank, funded by skipping two drafts - a pure own-side recovery.
  boon(
    {
      id: "bw3_the_homecoming",
      name: "The Homecoming",
      description:
        "Your best captured major and best captured minor return to the empty squares nearest your home rank. Your next 2 drafts are skipped.",
      tier: 7,
      category: "pieces",
      icon: "Tent",
      flavor: "They hung up the armor. The armor did not agree.",
    },
    instant((_inst, api) => {
      for (const t of ["q", "r"] as PieceType[]) {
        if (revivable(api, t) > 0) {
          const sq = autoPlaceSquare(api, api.me, t);
          if (sq != null) {
            api.place(sq, t, api.me);
            markRevived(api, t);
          }
          break;
        }
      }
      for (const t of ["b", "n"] as PieceType[]) {
        if (revivable(api, t) > 0) {
          const sq = autoPlaceSquare(api, api.me, t);
          if (sq != null) {
            api.place(sq, t, api.me);
            markRevived(api, t);
          }
          break;
        }
      }
      api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 2;
    }),
  ),

  // A one-shot mass tempo miracle: your whole pawn front lurches forward one
  // rank at once. Neighbours: Forced March (temporary double-step grant).
  // Distinct: an instant, single simultaneous advance of every pawn that can
  // step (never onto the last rank), a sudden phalanx surge, not a movement
  // grant.
  boon(
    {
      id: "bw3_turn_the_tide",
      name: "Turn the Tide",
      description:
        "The whole line surges as one: every one of your pawns that can advance takes one non-capturing step forward at once, into the empty square directly ahead. Pawns whose square ahead is occupied, or that would reach the final rank, hold their ground.",
      tier: 5,
      category: "movement",
      icon: "Waves",
      flavor: "One heartbeat. The whole front moves. The board tilts.",
      requires: ["p"],
      fx: { motif: "rally", pieces: ["p"], self: true },
    },
    instant((_inst, api) => {
      const fwd = api.me === "w" ? 1 : -1;
      const pawns = mySquares(api.board, api.me, "p");
      // Advance the most forward pawns first so a file's chain frees up as it
      // resolves (deterministic: sort by relative rank, descending).
      pawns.sort((a, b) => relRank(api.me, b) - relRank(api.me, a));
      for (const from of pawns) {
        const nr = RANK(from) + fwd;
        if (nr < 0 || nr > 7) continue;
        const to = SQ(FILE(from), nr);
        if (relRank(api.me, to) > 7) continue; // would reach the last rank
        if (api.board.pieces[to]) continue;
        api.relocate(from, to);
      }
    }),
  ),

  // A summoning of NEW material from nothing, at a steep economic price.
  // Neighbours: Shadow Reserve (three pocket pieces, skip two drafts).
  // Distinct: a single fresh queen conjured into your pocket to be dropped on a
  // later turn, paid for by two skipped drafts (balance review: the queen goes
  // to the pocket instead of straight onto the board, two skips not three, and
  // your rerolls are kept).
  boon(
    {
      id: "bw3_pretender",
      name: "Pretender to the Throne",
      description:
        "Crown a claimant waiting in the wings: a brand new queen joins your pocket, ready to be dropped onto an empty square on a later turn (that drop spends the turn). The court is not cheap - your next 2 drafts are skipped.",
      tier: 7,
      category: "pieces",
      icon: "Crown",
      flavor: "Bloodline unverified. Firepower absolutely verified.",
    },
    instant((_inst, api) => {
      // The new queen goes to your pocket (dropped onto an empty square on a
      // later turn, spending that turn), not straight to the board. Skip two
      // drafts; your rerolls are kept.
      grantInventory(api, "q", 1);
      api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 2;
    }),
  ),

  // A geographic purge miracle: clear the invaders from your half and the
  // overextended from theirs. Neighbours: The Reckoning (all minors both
  // sides). Distinct: a symmetric removal keyed to TERRITORY, not piece type -
  // every enemy piece in your half AND every one of yours in their half is
  // swept off. Kings are exempt so it can never end the game outright.
  boon(
    {
      id: "bw3_drive_them_out",
      name: "Drive Them Out",
      description:
        "Clear the homeland and let the invaders regret the crossing: every enemy piece standing in your half of the board is removed, and every one of your own pieces standing in your opponent's half is removed with them. Both kings are spared.",
      tier: 8,
      category: "attack",
      icon: "Wind",
      flavor: "Whoever crossed the river answers to the river.",
    },
    instant((_inst, api) => {
      for (let sq = 0; sq < 64; sq++) {
        const p = api.board.pieces[sq];
        if (!p || p.type === "k") continue;
        if (p.color === api.opp && inHalf(api.me, sq)) api.removePiece(sq);
        else if (p.color === api.me && inHalf(api.opp, sq)) api.removePiece(sq);
      }
    }),
  ),
];
