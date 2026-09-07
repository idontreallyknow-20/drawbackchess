// Fantasy set: HEROES & LEGENDS. Songs of named champions: a dragonslayer's
// single killing stroke (removeEnemies), the knights of the round table riding
// to your banner (grantInventory), a shieldmaiden's guard (shield), the call to
// adventure that widens your next draft (draft flags), a giant's maul swung
// down a file (lineSweep), a riddle in the dark that wastes the enemy's turn
// (skipOpponent), a valkyrie carrying your fallen champion home (reviveOne),
// the hero who holds the bridge (king_safe), a pawn with a sling (charged
// augment), a dragon broken to the saddle (pieceBound), the legendary forge
// (transformOwn), and a closing age of heroes (timedAugment). Every card
// reuses an existing primitive; kings are never removed or frozen, and
// movement grants only ever widen a move list, so nothing can soft-lock.

import { Buff } from "./shared";
import {
  card,
  activated,
  addEffect,
  augment,
  grantInventory,
  instant,
  lineSweep,
  mySquares,
  myHalfZone,
  pawnRankOk,
  pieceBound,
  removeEnemies,
  reviveOne,
  skipOpponent,
  slideMoves,
  transformOwn,
  ALL_DIRS,
  DIAG_DIRS,
  ORTHO_DIRS,
  FILE,
  RANK,
  SQ,
  type BoardState,
  type Square,
  type Mech,
} from "./shared";

// Balance pass: wrap a charge-limited move augment so that PLAYING one of its
// granted moves also consumes the caster's next unused reroll, if any. The base
// charge bookkeeping (spendOnVia) is preserved.
function consumesRerollOnUse(base: Mech): Mech {
  const inner = base.onMovePlayed;
  return {
    ...base,
    onMovePlayed: (inst, move, api) => {
      if (move.via === inst.id && move.color === api.me) {
        api.mine.rerollsLeft = Math.max(0, (api.mine.rerollsLeft ?? 0) - 1);
      }
      inner?.(inst, move, api);
    },
  };
}

// Does a piece standing on `from` attack `kingSq` by standard movement, given
// the current board occupancy? Used by Shieldmaiden to detect the guarded piece
// giving check (attacking the enemy king). Discovered attacks by other pieces
// are not considered; only the piece on `from` itself.
function attacksKing(board: BoardState, from: Square, kingSq: Square): boolean {
  const p = board.pieces[from];
  if (!p || from === kingSq) return false;
  const df = FILE(kingSq) - FILE(from), dr = RANK(kingSq) - RANK(from);
  const adf = Math.abs(df), adr = Math.abs(dr);
  switch (p.type) {
    case "n":
      return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
    case "k":
      return adf <= 1 && adr <= 1;
    case "p":
      return adr === (p.color === "w" ? 1 : -1) && adf === 1;
    case "b":
      if (adf !== adr) return false;
      break;
    case "r":
      if (df !== 0 && dr !== 0) return false;
      break;
    case "q":
      if (adf !== adr && df !== 0 && dr !== 0) return false;
      break;
    default:
      return false;
  }
  // Slider: the ray from `from` to the king must be unobstructed.
  const sf = Math.sign(df), sr = Math.sign(dr);
  let f = FILE(from) + sf, r = RANK(from) + sr;
  while (SQ(f, r) !== kingSq) {
    if (board.pieces[SQ(f, r)]) return false;
    f += sf;
    r += sr;
  }
  return true;
}

export const FANTASY_LEGENDS: Buff[] = [
  card(
    {
      id: "dragonslayer",
      name: "Dragonslayer",
      description:
        "The old blade remembers its work: name one enemy rook or queen and it is slain where it stands. Using it consumes your next unused reroll, if you have one.",
      tier: 7,
      category: "attack",
      flavor: "Every scale has a seam. The sword knows where.",
    },
    // Balance pass: the killing stroke also consumes your next unused reroll.
    (() => {
      const base = removeEnemies(1, ["r", "q"]);
      return {
        ...base,
        effect: (inst, api, picks) => {
          base.effect?.(inst, api, picks);
          api.mine.rerollsLeft = Math.max(0, (api.mine.rerollsLeft ?? 0) - 1);
        },
      };
    })(),
  ),
  card(
    {
      id: "round_table",
      name: "The Round Table",
      description:
        "One sworn knight answers your call and waits in your pocket: spend a later turn to drop it onto any empty square.",
      tier: 5,
      category: "pieces",
      flavor: "No head of the table, no end to the oath.",
    },
    instant((_inst, api) => {
      grantInventory(api, "n", 1);
    }),
  ),
  card(
    {
      id: "shieldmaiden",
      name: "Shieldmaiden",
      description:
        "A shieldmaiden plants herself before one of your pieces: it cannot be captured for your opponent's next 3 turns, but the instant that piece moves to attack the enemy king, her guard shatters and the protection ends.",
      tier: 2,
      category: "protection",
      flavor: "Her shield arm has never once come back empty.",
      fx: { motif: "ward", pieces: "all", self: true },
    },
    // Balance pass: keep the full 3-turn shield, but the guarded piece cannot
    // give check while shielded. The engine offers no own-move filter, so this
    // is enforced as a penalty: if the guarded piece moves to a square from
    // which it attacks the enemy king, the shield is removed at once.
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) =>
        picks.length > 0 || inst.state.sq != null
          ? null
          : {
              kind: "square",
              label: "Choose the piece she guards",
              squares: mySquares(api.board, api.me).filter(
                (sq) => api.board.pieces[sq]!.type !== "k",
              ),
            },
      effect: (inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null || inst.state.sq != null) return;
        inst.state.sq = sq;
        inst.state.turns = 3;
        addEffect(api, { kind: "shield", owner: api.me, squares: [sq], turns: 3 });
      },
      onMovePlayed: (inst, move, api) => {
        const sq = inst.state.sq as Square | undefined;
        if (sq == null) return;
        // Guarded piece captured or overrun: the guard is over.
        if (move.capturedSquare === sq && move.from !== sq) {
          inst.spent = true;
          inst.state.sq = undefined;
          return;
        }
        if (move.to === sq && move.from !== sq) {
          inst.spent = true;
          inst.state.sq = undefined;
          return;
        }
        // Guarded piece moved: if it now attacks the enemy king, shatter the
        // shield (value-matched by the guarded square, which the engine keeps
        // following the piece) and retire the card.
        if (move.from === sq && move.color === api.me) {
          inst.state.sq = move.to;
          const kingSq = mySquares(api.board, api.opp, "k")[0];
          if (kingSq != null && attacksKing(api.board, move.to, kingSq)) {
            api.bs.effects = api.bs.effects.filter(
              (e) =>
                !(
                  e.kind === "shield" &&
                  e.owner === api.me &&
                  e.squares != null &&
                  e.squares.length === 1 &&
                  (e.squares[0] === move.to || e.squares[0] === move.from)
                ),
            );
            inst.spent = true;
            inst.state.sq = undefined;
          }
          return;
        }
        // Tick the guard window on the opponent's turns, matching the shield.
        if (move.color !== api.opp) return;
        const left = ((inst.state.turns as number) ?? 0) - 1;
        inst.state.turns = left;
        if (left <= 0) {
          inst.spent = true;
          inst.state.sq = undefined;
        }
      },
      status: (inst) =>
        inst.state.sq == null
          ? "activate to guard a piece"
          : `guarding, ${(inst.state.turns as number) ?? 0} of their turns left`,
    },
  ),
  card(
    {
      id: "heros_journey",
      name: "Hero's Journey",
      description:
        "The call to adventure rings out: your next draft shows three cards to pick from, and your bank offer improves by one tier.",
      tier: 5,
      category: "draft",
      flavor: "Refuse the call once, and the story sends a bigger horn.",
    },
    instant((_inst, api) => {
      api.mine.flags.prepThree = true;
      api.mine.flags.bankBonus = Math.min(1, (api.mine.flags.bankBonus ?? 0) + 1);
    }),
  ),
  card(
    {
      id: "giants_maul",
      name: "Giant's Maul",
      description:
        "The maul comes down once: crush one enemy knight, bishop, or rook, and the shock leaves every enemy piece beside it (kings aside) frozen for 1 of their turns.",
      tier: 6,
      category: "attack",
      flavor: "Subtlety is for people who cannot lift the hammer.",
    },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose where the maul comes down",
              squares: mySquares(api.board, api.opp).filter((sq) => {
                const t = api.board.pieces[sq]!.type;
                return t === "n" || t === "b" || t === "r";
              }),
            },
      (_inst, api, picks) => {
        const c = picks[0]?.square;
        if (c == null) return;
        const p = api.board.pieces[c];
        if (!p || p.color !== api.opp || p.type === "k" || p.type === "q" || p.type === "p") return;
        api.removePiece(c);
        for (const [df, dr] of ALL_DIRS) {
          const f = FILE(c) + df, r = RANK(c) + dr;
          if (f < 0 || f > 7 || r < 0 || r > 7) continue;
          const sq = f + r * 8;
          const t = api.board.pieces[sq];
          if (t && t.color === api.opp && t.type !== "k") {
            addEffect(api, { kind: "freeze", sq, owner: api.opp, turns: 1 });
          }
        }
      },
    ),
  ),
  card(
    {
      id: "riddle_game",
      name: "Riddle Game",
      description:
        "You wager the deck itself on a dangerous game: your opponent's next two drafts are skipped, but so is your own next one.",
      tier: 5,
      category: "draft",
      flavor: "What have I got in my pocket?",
    },
    instant((_inst, api) => {
      api.theirs.flags.blockedDrafts = (api.theirs.flags.blockedDrafts ?? 0) + 2;
      api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 1;
    }),
  ),
  card(
    {
      id: "valkyrie",
      name: "Valkyrie",
      description: "For your opponent's next 3 turns, any knight, bishop, or rook of yours they capture is carried home to your pocket instead of being lost for good. Drop it back onto an empty square on a later turn. In exchange, you skip your next draft.",
      tip: "It turns three turns of trades into free repositioning, so invite the trades.",
      tier: 6,
      category: "pieces",
      flavor: "Not this one. This one still has work to do.",
      fx: { motif: "ward", pieces: ["n", "b", "r"], self: true },
    },
    {
      kind: "passive",
      init: (inst, api) => {
        inst.state.turns = 3;
        // Balance pass: riding beside your army costs you your next draft.
        api.mine.flags.blockedDrafts = (api.mine.flags.blockedDrafts ?? 0) + 1;
      },
      onMovePlayed: (inst, move, api) => {
        if (move.color !== api.opp) return;
        if (
          move.captured === "n" ||
          move.captured === "b" ||
          move.captured === "r"
        ) {
          grantInventory(api, move.captured, 1);
        }
        const t = ((inst.state.turns as number) ?? 0) - 1;
        inst.state.turns = t;
        if (t <= 0) inst.spent = true;
      },
      status: (inst) => `${(inst.state.turns as number) ?? 0} of their turns left`,
    },
  ),
  card(
    {
      id: "hold_the_bridge",
      name: "Hold the Bridge",
      description:
        "One hero plants their feet: choose one of your knights, bishops, or rooks. It cannot be captured for your opponent's next 2 turns, but it stands its ground and cannot move for those turns either.",
      tier: 4,
      category: "protection",
      requires: ["n", "b", "r"],
      flavor: "The bridge is narrow and so is your chance.",
      fx: { motif: "ward", pieces: ["n", "b", "r"], self: true },
    },
    activated(
      (_inst, api, picks) =>
        picks.length > 0
          ? null
          : {
              kind: "square",
              label: "Choose the piece that holds the bridge",
              squares: mySquares(api.board, api.me).filter((sq) => {
                const t = api.board.pieces[sq]!.type;
                return t === "n" || t === "b" || t === "r";
              }),
            },
      (_inst, api, picks) => {
        const sq = picks[0]?.square;
        if (sq == null) return;
        // Balance pass: immunity shortened by one opponent turn (3 to 2); the
        // matching hold (freeze) tracks it so the piece is protected exactly as
        // long as it is rooted.
        addEffect(api, { kind: "shield", owner: api.me, squares: [sq], turns: 2 });
        addEffect(api, { kind: "freeze", sq, owner: api.me, turns: 2 });
      },
    ),
  ),
  card(
    {
      id: "giant_slayer",
      name: "Giant Slayer",
      description:
        "Your pawns carry slings and know the soft spots: twice this game, one of your pawns may capture an enemy piece on any square directly beside it. Each such capture consumes your next unused reroll, if you have one.",
      tier: 4,
      category: "attack",
      requires: ["p"],
      flavor: "The bigger they come, the better the target.",
      fx: { motif: "empower", pieces: ["p"], self: true },
    },
    consumesRerollOnUse(
      augment(
        (_m, inst, api) =>
          mySquares(api.board, api.me, "p").flatMap((sq) =>
            slideMoves(api.board, sq, ALL_DIRS, inst.id, 1).filter(
              (mv) => mv.captured && pawnRankOk(mv.to),
            ),
          ),
        2,
      ),
    ),
  ),
  card(
    {
      id: "dragon_mount",
      name: "Dragon Mount",
      description:
        "One of your knights breaks a young dragon to the saddle: for the game it may also slide any distance diagonally, though the dragon's glide cannot capture.",
      tier: 4,
      category: "movement",
      requires: ["n"],
      flavor: "The hard part is not the taming. It is the dismount.",
      fx: { motif: "empower", pieces: ["n"], moveAs: "b", self: true },
    },
    // Balance pass: the granted diagonal glide cannot capture (its normal
    // knight moves still can); captures are dropped from the added move set.
    pieceBound("n", "Choose the knight that takes the saddle", (board, sq, via) =>
      slideMoves(board, sq, DIAG_DIRS, via).filter((m) => !m.captured),
    ),
  ),
  card(
    {
      id: "legendary_forge",
      name: "Legendary Forge",
      description:
        "The forge mends what war broke: one of your captured knights or bishops is reforged and returns to your pocket. Spend a later turn to drop it onto any empty square.",
      tier: 4,
      category: "pieces",
      flavor: "Iron remembers every shape it has ever worn.",
    },
    {
      ...activated(
        (_inst, api, picks) => {
          if (picks.length > 0) return null;
          const type = (["n", "b"] as const).find(
            (t) => (api.capturedFromMe[t] ?? 0) - (api.mine.revived[t] ?? 0) > 0,
          );
          // The single pick is a confirmation beat at the throne: the forge
          // only lights when there is something to reforge.
          return {
            kind: "square",
            label: "Light the forge (choose your king)",
            squares: type == null ? [] : mySquares(api.board, api.me, "k"),
          };
        },
        (_inst, api, picks) => {
          if (picks[0]?.square == null) return;
          const type = (["n", "b"] as const).find(
            (t) => (api.capturedFromMe[t] ?? 0) - (api.mine.revived[t] ?? 0) > 0,
          );
          if (type == null) return;
          grantInventory(api, type, 1);
          api.mine.revived[type] = (api.mine.revived[type] ?? 0) + 1;
        },
      ),
    },
  ),
  card(
    {
      id: "age_of_heroes",
      name: "Age of Heroes",
      description:
        "The old songs come true for three champions: choose one of your knights, one bishop, and one rook. Until each next moves it may also move like a queen, a single stroke apiece.",
      tier: 7,
      category: "movement",
      flavor: "For one bright hour, everyone is the chosen one.",
      fx: { motif: "rally", pieces: ["n", "b", "r"], self: true },
    },
    // Balance pass: no longer a 2-turn blanket. You crown exactly one knight,
    // one bishop, and one rook; each gains queen movement for its next move
    // only, the gift spent the moment that piece moves (taken or not).
    {
      kind: "activated",
      spendOnUse: false,
      targets: (inst, api, picks) => {
        if (inst.state.sqs != null) return null;
        const names: Record<string, string> = { n: "knight", b: "bishop", r: "rook" };
        const pickedTypes = new Set(picks.map((k) => api.board.pieces[k.square!]?.type));
        const next = (["n", "b", "r"] as const).find(
          (t) => !pickedTypes.has(t) && mySquares(api.board, api.me, t).length > 0,
        );
        if (next == null) return null;
        return {
          kind: "square",
          label: `Choose the ${names[next]} to crown`,
          squares: mySquares(api.board, api.me, next).filter(
            (sq) => !picks.some((k) => k.square === sq),
          ),
          ...(picks.length > 0 ? { finishable: true } : {}),
        };
      },
      effect: (inst, _api, picks) => {
        if (inst.state.sqs != null) return;
        inst.state.sqs = picks.map((k) => k.square).filter((s): s is Square => s != null);
      },
      augmentMoves: (moves, inst, api) => {
        const sqs = inst.state.sqs as Square[] | undefined;
        if (!sqs || sqs.length === 0) return;
        for (const sq of sqs) {
          const p = api.board.pieces[sq];
          if (!p || p.color !== api.me) continue;
          for (const e of slideMoves(api.board, sq, ALL_DIRS, inst.id)) {
            if (!moves.some((m) => m.from === e.from && m.to === e.to)) moves.push(e);
          }
        }
      },
      onMovePlayed: (inst, move, api) => {
        const sqs = inst.state.sqs as Square[] | undefined;
        if (!sqs || sqs.length === 0) return;
        let next = sqs;
        if (move.color === api.me && sqs.includes(move.from)) {
          // A crowned piece moved: its single stroke is spent.
          next = sqs.filter((s) => s !== move.from);
        } else if (sqs.includes(move.to) && move.from !== move.to) {
          // A crowned piece was captured or overrun: drop it.
          next = sqs.filter((s) => s !== move.to);
        }
        inst.state.sqs = next;
        if (next.length === 0) inst.spent = true;
      },
      status: (inst) => {
        const sqs = inst.state.sqs as Square[] | undefined;
        return sqs == null
          ? "activate to crown three champions"
          : sqs.length === 0
            ? "the age has passed"
            : `${sqs.length} champion${sqs.length === 1 ? "" : "s"} still crowned`;
      },
    },
  ),
];
