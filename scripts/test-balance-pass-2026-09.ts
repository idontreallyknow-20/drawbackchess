// Deterministic checks for the 2026-09 full balance pass (structural batch).
// Run: npx -y tsx scripts/test-balance-pass-2026-09.ts
//
// 1. Tier pins for every card the pass moved or deliberately kept, plus the
//    ladder invariants as code, so the next blanket retier wave cannot
//    silently undo them.
// 2. warp_home is a free action: the warp lands and the turn is still ours.
// 3. hard_reset never does nothing: home square taken => the pawn freezes.
// 4. bishop_archbishop and god_knight still bind and move after the retier.
// 5. fm_boon_lifebloom: the pawn returns to rank 4 under a two-turn shield.

import {
  NerfGame,
  UNRESTRICTED_NERF,
  acquireBuff,
  activateBuff,
  enableDraftMode,
  legalMoves,
  newGame,
  playMove,
} from "../src/engine/game";
import { BUFF_BY_ID } from "../src/engine/buffs/library";
import { moveToUCI } from "../src/engine/board";
import { SQ } from "../src/engine/types";

let failures = 0;
function check(ok: boolean, label: string) {
  if (!ok) {
    failures++;
    console.error("FAIL:", label);
  } else {
    console.log("ok:", label);
  }
}

function freshGame(seed = 42): NerfGame {
  const game = newGame(UNRESTRICTED_NERF, UNRESTRICTED_NERF, seed);
  enableDraftMode(game, seed + 1, { mode: "buff" });
  return game;
}

function play(g: NerfGame, uci: string): NerfGame {
  for (const c of ["w", "b"] as const) {
    const ps = g.buffs?.players[c];
    if (ps?.offer) ps.offer = null;
  }
  const move = legalMoves(g).find((m) => moveToUCI(m) === uci);
  if (!move) throw new Error(`scripted move ${uci} is not legal here`);
  return playMove(g, move);
}

const tier = (id: string) => BUFF_BY_ID[id]?.tier ?? -1;

// --- 1. Tier pins and ladder invariants ---------------------------------------

const PINS: Record<string, number> = {
  bishop_archbishop: 4,
  knight_nightrook: 3,
  camel_knight: 3,
  // Sized to 4 by the 2026-09 targeted sweep (see CARD_HISTORY).
  dragon_pawn: 4,
  cannon: 3,
  phase_rook: 3,
  god_knight: 7,
  dragon_mount: 4,
  wc_black_hole: 3,
  bn4_shepherds_watch: 5,
  hx4_lantern_out: 5,
  hx4_prowlers_bell: 6,
  second_army: 4,
  ov_pet_rock: 1,
  bn4_night_watch: 1,
  ov_sandbags: 2,
  // Deliberate keeps: the anchors the moves were priced against.
  warp_home: 2,
  recall: 2,
  full_rewind: 6,
  hard_reset: 3,
  twin_knights: 4,
  amazon_knight: 6,
  wazir_bishop: 3,
  wazir_rook: 3,
};
for (const [id, t] of Object.entries(PINS)) check(tier(id) === t, `${id} is Tier ${t} (got ${tier(id)})`);

check(tier("bishop_archbishop") >= tier("wazir_bishop") + 1, "a full extra piece-class sits above a one-step add");
check(tier("twin_knights") >= tier("knight_nightrook") + 1, "two upgraded knights sit above one");
check(tier("god_knight") >= tier("amazon_knight") + 1, "a permanent amazon sits above a two-turn one");
check(tier("dragon_mount") === tier("bishop_archbishop"), "the two archbishop builds share a tier");
check(tier("full_rewind") > tier("recall"), "five pieces home sits above one");
check(tier("hx4_prowlers_bell") >= tier("fm_hex_kings_moat") - 1, "the broader landing ban is priced beside King's Moat");
check(tier("bn4_shepherds_watch") > tier("fm_boon_oathstone"), "one more turn of pawn immunity costs a tier");
check(tier("ov_pet_rock") < tier("pawn_shield"), "one turn of pawn cover sits below four");
check(tier("bn4_night_watch") < tier("sidestep_king"), "one turn of king cover sits below three");
check(tier("second_army") <= tier("bodyguard"), "two pocket pawns are not dearer than a pocket knight");

// --- 1b. The material ladder ---------------------------------------------------
//
// A card's tier IS its price, and until the 2026-09 material pass the library
// had a price list for movement grants, shields and durations and none at all
// for the one thing chess has always known how to value. The ladder that grew
// in its absence got CHEAPER per point the more it gave: `wa_conjure_bishop`
// handed over a permanent unconditional bishop for Tier 3 while
// `bn4_cathedral_choir` and `summon_knight` did the identical job at Tier 4,
// and it survived several blanket retier waves because no invariant anywhere
// covered spawn or revival material.
//
// scripts/material-model.ts prices every active card by the material it moves,
// in pawns, at 0.5 TIERS PER PAWN. That rate is not fitted to the win-rate
// sweep (the sweep cannot resolve it: the rungs are about a point apart and
// the per-card error bar is around twelve). It is the straight line through
// the two floors THIS pass already pinned above, and the block below is that
// line as executable assertions.
//
// WHAT THIS COVERS, AND WHAT IT DOES NOT.
//
// Only the cards named below, each with the M the model scored it at, and each
// of those scores read by hand against the card and against the engine. It is
// deliberately NOT "every card must clear its model floor": the parser reads
// about two thirds of the cards in a material effect category and refuses or
// misses the rest, so a blanket rule would enforce the parser's blind spots as
// design rules. It would pin `double_queen` and `bw3_pretender` at Tier 1
// because it cannot read them, and it would pin `wc_lost_and_found` a rung too
// high because it counts one revived piece twice. A card joins this table when
// somebody has read both the card and the parse, and not before.
//
// The floors are FLOORS. A card above its floor is not endorsed here, merely
// not accused, and there are good reasons to sit above one: `queens_rampage`
// carries a minor's worth of material and is Tier 7 for the tempo, not the
// pawns.

/** The floor ladder from scripts/material-model.ts, as (minimum M inclusive,
 *  floor tier), ascending. Kept here as data rather than imported so this
 *  guard states the ladder itself, and a change to the model has to be made
 *  in both places on purpose. */
const MATERIAL_LADDER: readonly { m: number; tier: number }[] = [
  { m: 0.0, tier: 1 }, // under the parser's own resolution
  { m: 0.75, tier: 2 }, // a pawn discounted by a lease, a gate or the odds
  { m: 1.5, tier: 3 }, // a clean permanent pawn
  { m: 2.5, tier: 4 }, // A MINOR, and the anchor: "an extra piece-class is Tier 4"
  { m: 4.5, tier: 5 }, // a rook, at 0.5 tiers per point from that anchor
  { m: 6.5, tier: 6 }, // a rook and a pawn, or two minors
  { m: 8.5, tier: 7 }, // A QUEEN, and the anchor: "amazon-class is Tier 7"
  { m: 12.0, tier: 8 }, // a queen and a rook: the ceiling starts binding here
  { m: 18.0, tier: 9 }, // apex, outside the normal draft
];

function materialFloor(m: number): number {
  let t = 1;
  for (const rung of MATERIAL_LADDER) if (m >= rung.m) t = rung.tier;
  return t;
}

check(
  MATERIAL_LADDER.every(
    (r, i) => i === 0 || (r.m > MATERIAL_LADDER[i - 1].m && r.tier === MATERIAL_LADDER[i - 1].tier + 1),
  ),
  "the material ladder climbs one rung at a time and never doubles back",
);
// The ladder is anchored on the two pins above, so moving either pin without
// moving the ladder fails here rather than silently unfitting the rate.
check(
  materialFloor(3) === tier("bishop_archbishop"),
  `a minor's worth of material (M=3) prices at the extra-piece-class pin, Tier ${tier("bishop_archbishop")}`,
);
check(
  materialFloor(9) === tier("god_knight"),
  `a queen's worth of material (M=9) prices at the amazon-class pin, Tier ${tier("god_knight")}`,
);
check(materialFloor(0.5) === 1 && materialFloor(1) === 2, "a fraction of a pawn buys Tier 1, a whole one Tier 2");

/**
 * Cards whose M the parser scored and a human has checked. `m` is the model's
 * number; `why` is what that number is made of, so a later reader can tell at
 * a glance whether a text change should move the row.
 */
const MATERIAL_FLOORS: { id: string; m: number; why: string }[] = [
  // The 2026-09 material pass moved these eighteen up to their floor.
  { id: "resurrect_queen", m: 9.0, why: "a captured queen back on the board, permanently" },
  { id: "blood_pact", m: 8.0, why: "a pawn crowned on the spot; the pawn it bursts is a point back and does not change the rung" },
  { id: "lich_phylactery", m: 7.2, why: "a whole new queen behind the capture that sets it off" },
  { id: "promote_now", m: 5.2, why: "a crown, discounted for the rank the pawn has to have reached" },
  { id: "second_wind_major", m: 5.0, why: "a captured rook back, unconditional" },
  { id: "ww_recommission", m: 5.0, why: "a captured rook back; the phasing rides on top" },
  { id: "bw3_eleventh_hour", m: 3.25, why: "your best captured piece back, behind the three-piece gate" },
  { id: "bw2_queens_testament", m: 3.12, why: "up to two captured minors, priced at two of the cheaper kind behind a capture gate" },
  { id: "minor_recall", m: 3.0, why: "a captured minor back on the board" },
  { id: "wa_conjure_bishop", m: 3.0, why: "a permanent unconditional bishop; the mirror square says where, not whether" },
  { id: "legendary_forge", m: 2.85, why: "a minor into your pocket, which is Bodyguard's payload exactly" },
  { id: "bn4_matryoshka_surprise", m: 1.52, why: "two pocket pawns behind a capture gate" },
  { id: "bn4_small_consolation", m: 1.52, why: "two pocket pawns; the rooks and queens are the trigger, not the payout" },
  { id: "second_wind", m: 1.0, why: "a captured pawn back on the board, permanently" },
  { id: "bn4_stowaway", m: 0.95, why: "a pocket pawn, five turns late" },
  { id: "ww_field_hospital", m: 0.8, why: "a new pawn on your back rank behind a capture gate" },
  { id: "bn4_understudy", m: 0.76, why: "a pocket pawn behind a capture gate" },
  { id: "summon_intern", m: 0.76, why: "a pocket pawn behind a capture gate" },
  // The cards the ladder is priced AGAINST. They already clear their floors;
  // they are here so a later pass cannot cut the anchor out from under it.
  { id: "bn4_cathedral_choir", m: 3.0, why: "a permanent unconditional bishop: the minor anchor" },
  { id: "summon_knight", m: 3.0, why: "a permanent unconditional knight: the minor anchor" },
  { id: "bodyguard", m: 2.85, why: "a knight into your pocket" },
  { id: "second_army", m: 1.9, why: "two pocket pawns" },
  { id: "bn4_care_package", m: 1.9, why: "a random pocket piece: half a pawn, a quarter a knight, a quarter a bishop" },
  { id: "bn4_militia_call", m: 1.0, why: "one permanent pawn" },
  { id: "bn4_field_stitches", m: 1.0, why: "one captured pawn back, permanently" },
  { id: "mass_resurrect", m: 4.0, why: "four captured pawns back" },
  { id: "bn4_old_guard", m: 6.0, why: "an AND list: a knight and a bishop both come back" },
  { id: "ww_last_reserves", m: 3.9, why: "up to two captured minors, priced at two of the cheaper kind" },
  { id: "roulette", m: 7.8, why: "three enemy pieces off the board; denial counts the same as a gain" },
  { id: "apotheosis", m: 5.7, why: "a pocket queen (8.55) less the minor it spends (2.85)" },
  { id: "queens_rampage", m: 3.9, why: "a line swept clear; the tier is bought by the tempo, not by these points" },
  { id: "phantom_rook", m: 2.0, why: "a rook on a four-turn lease" },
  { id: "ww_mercenary_queen", m: 2.7, why: "a queen on a three-turn lease" },
  { id: "promotion_storm", m: 2.6, why: "two advanced pawns to KNIGHTS, which is two points apiece and not eight" },
  { id: "bw3_heir_apparent", m: 1.6, why: "a pawn to 'that same kind of piece', an unstated target priced at a minor" },
  { id: "wc_pinata", m: 1.6, why: "a random enemy piece off, less the pawn of yours that bursts" },
];

/**
 * Cards the parser is KNOWN to read wrong (they are held out of the model's
 * violation list by name, in KNOWN_MISREAD). Their M here is read off the
 * ENGINE by hand, not off the parse, and the floor still applies: the parser
 * being unable to read a card is not a reason for the card to be free.
 */
const MATERIAL_FLOORS_HAND: { id: string; m: number; why: string }[] = [
  { id: "seance", m: 1.3, why: "removePiece then place('r') on the same square: a rook FOR a minor is worth the difference" },
  { id: "wc_lost_and_found", m: 3.25, why: "['r','b','n','p'].find(revivable) revives exactly ONE piece, not two" },
];

for (const row of [...MATERIAL_FLOORS, ...MATERIAL_FLOORS_HAND]) {
  const floor = materialFloor(row.m);
  check(
    tier(row.id) >= floor,
    `${row.id} is Tier ${floor} or above (M=${row.m}: ${row.why}) (got ${tier(row.id)})`,
  );
}

// The ordering the ladder implies, stated without reference to any M at all,
// so it still binds if every number above turns out to be wrong.
check(tier("resurrect_queen") > tier("second_wind_major"), "a queen back costs more than a rook back");
check(tier("second_wind_major") > tier("minor_recall"), "a rook back costs more than a minor back");
check(tier("minor_recall") > tier("second_wind"), "a minor back costs more than a pawn back");
check(tier("wa_conjure_bishop") === tier("bn4_cathedral_choir"), "two permanent bishops cost the same");
check(tier("wa_conjure_bishop") === tier("summon_knight"), "a minor is a minor whichever piece it is");
check(tier("legendary_forge") === tier("bodyguard"), "the same pocket minor is the same price twice");
check(tier("wa_conjure_bishop") > tier("wa_conjure_scout"), "a permanent bishop costs more than a two-turn knight");
check(tier("bn4_small_consolation") > tier("bn4_militia_call"), "two pawns cost more than one");
check(
  tier("lich_phylactery") >= tier("bn4_cathedral_choir") + 2,
  "a queen is six points more than a minor, and six points is never fewer than two rungs",
);
check(tier("bn4_care_package") >= tier("bn4_militia_call"), "a random minor is not cheaper than a plain pawn");

// --- 1c. The move-grant quarantine --------------------------------------------
//
// The bot's search cannot see buff-granted moves below the root. `negamax` and
// `quiesce` take a bare `BoardState` and call `generateMoves`; only
// `pickAIMove`'s root calls `legalMoves`, which is the only place
// `def.augmentMoves` runs. So the bot plays a move that exists ONLY because of
// a card and then evaluates every follow-up as if it did not hold the card.
// `npm run test:search-buffs` pins that defect; backlog A13 is the fix.
//
// The consequence for THIS file is a measurement one. `scripts/sim-card-winrate.ts`
// measures a card by having that same bot play it, so every move-granting card
// is measured against a search that is wrong about it. The bias is real and it
// has a size: among cards that last a few turns and then expire, each granted
// move the search cannot see costs 1.26 +-0.28 win-rate points (4.5 sigma,
// n=20, r2 0.53), while the same slope is flat for cards spent on the turn
// they fire (0.5 sigma) and for permanent grants (0.4 sigma), which is exactly
// where the defect predicts nothing. See `npm run analyze:search-bias`.
//
// `amazon_army` grants 17 moves over three turns, so about 21 of its measured
// -25 points are the instrument rather than the card.
//
// So these cards' win rates are not evidence for cutting their tier, and this
// table stops a later blanket wave from doing it anyway on numbers that look
// damning and are not. It is a FLOOR, and the asymmetry is deliberate: the bias
// only pushes measurements DOWN, so a card here that still measures well
// measures well despite it and may be raised freely.
//
// RETIRE THIS BLOCK when A13 lands and the family is re-measured. It is a
// quarantine, not a design statement: nothing here is claimed to be correctly
// priced, only to be un-measurable at present.

/** Tier at the time of the round-7 finding, for every move-granting card whose
 *  grant outlives the turn it was played on and which has a win-rate row. */
const MOVE_GRANT_FLOORS: Record<string, number> = {
  bn4_stormcrossing: 6, // 26 moves x 3 turns, measured -8.3
  bn4_dancing_master: 6, // 17 x 2, measured -12.5
  amazon_army: 7, // 17 x 3, measured -25.0
  triple_amazon: 7, // 16 x 2, measured -5.0
  onslaught: 6, // 13 x 3, measured -4.2
  rgb_keyboard: 6, // 13 x permanent, measured 0.0
  berolina_pawns: 4, // 10 x permanent, measured +25.0
  bn4_court_procession: 5, // 10 x 3, measured -4.2
  half_step: 1, // 9 x 2, measured -5.0
  overclock: 3, // 9 x 3, measured -5.0
  twin_knights: 4, // 8 x permanent, measured +25.0
  chimpanzini_bananini: 5, // 8 x permanent, measured +20.8
  spring_pawn: 2, // 5 x 2, measured 0.0
  wa_camel_rider: 2, // 5 x 2, measured -4.2
  bn4_pathfinders: 3, // 4 x 3, measured -12.5
  bishop_polish: 1, // 3 x 2, measured +15.0
  little_leap: 1, // 2 x 2, measured 0.0
  vault: 1, // 2 x 2, measured +5.0
  ov_gravity_flip: 2, // 2 x 2, measured 0.0
  ghost_legion: 5, // 2 x 2, measured 0.0
  ferz_king: 1, // 1 x 2, measured +15.0
  sentinel_pawn: 1, // 1 x 2, measured +10.0
  bn4_crowned_strider: 2, // 1 x 4, measured 0.0
  royal_decree: 4, // 1 x 2, measured 0.0
  royal_ascension: 6, // 1 x permanent, measured +15.0
  eternal_reign: 8, // 1 x permanent, measured +25.0
};

{
  const cut: string[] = [];
  const gone: string[] = [];
  for (const [id, floor] of Object.entries(MOVE_GRANT_FLOORS)) {
    const t = tier(id);
    if (t < 0) gone.push(id);
    else if (t < floor) cut.push(`${id} ${floor} -> ${t}`);
  }
  check(
    gone.length === 0,
    `every quarantined move-grant card still exists${gone.length ? ` (missing: ${gone.join(", ")})` : ""}`,
  );
  check(
    cut.length === 0,
    "no move-granting card was retiered DOWN while the search cannot see it" +
      (cut.length ? ` (${cut.join(", ")}). Raise it back, or land A13 and re-measure first.` : ""),
  );
}

// --- 2. warp_home is a free action -------------------------------------------

{
  let g = freshGame(7);
  g = play(g, "e2e4");
  g = play(g, "e7e5");
  check(BUFF_BY_ID.warp_home.freeAction === true, "warp_home is declared a free action");
  acquireBuff(g, "w", "warp_home", 2);
  const idx = g.buffs!.players.w.buffs.findIndex((b) => b.id === "warp_home");
  const e4 = SQ(4, 3);
  const e2 = SQ(4, 1);
  const ok = activateBuff(g, "w", idx, [{ square: e4 }, { square: e2 }]);
  check(ok === true, "the e4 pawn warps home to e2");
  check(g.board.pieces[e2]?.type === "p" && g.board.pieces[e2]?.color === "w" && !g.board.pieces[e4], "pawn stands on e2 again, e4 empty");
  check(g.board.turn === "w", "the warp did not spend White's turn");
}

{
  // A free action that grants no follow-up move must not arm the chained-move
  // king guard: the activator's regular move this turn may still take the
  // king. 1. e4 f5 2. Qh5+ a6?? leaves the e8 king en prise (this variant
  // never forces the reply); after warping the e4 pawn home, Qxe8 must still
  // be on offer.
  let g = freshGame(8);
  g = play(g, "e2e4");
  g = play(g, "f7f5");
  g = play(g, "d1h5");
  g = play(g, "a7a6");
  const e8 = SQ(4, 7);
  const kingTake = (game: NerfGame) => legalMoves(game).some((m) => m.to === e8 && m.captured === "k");
  check(kingTake(g), "precondition: Qxe8 (king capture) is legal before the warp");
  acquireBuff(g, "w", "warp_home", 2);
  const idx = g.buffs!.players.w.buffs.findIndex((b) => b.id === "warp_home");
  const e4 = SQ(4, 3);
  const e2 = SQ(4, 1);
  check(activateBuff(g, "w", idx, [{ square: e4 }, { square: e2 }]) === true, "the e4 pawn warps home");
  check(g.board.turn === "w", "White still has the move after the warp");
  check(g.buffs!.chainKingGuard !== "w", "the warp did not arm the chained-move king guard");
  check(kingTake(g), "Qxe8 (king capture) is still legal after the warp");
}

// --- 3. hard_reset fallback ------------------------------------------------------

{
  // Home square taken: e7 pawn advanced to e5, bishop parked on e7.
  let g = freshGame(11);
  g = play(g, "e2e4");
  g = play(g, "e7e5");
  g = play(g, "d2d4");
  g = play(g, "f8e7");
  // Instants fire the moment they are acquired.
  acquireBuff(g, "w", "hard_reset", 3);
  const e5 = SQ(4, 4);
  const e7 = SQ(4, 6);
  check(g.board.pieces[e5]?.type === "p" && g.board.pieces[e7]?.type === "b", "home square taken: the pawn stays on e5 (bishop keeps e7)");
  const frozen = (g.buffs?.effects ?? []).some(
    (e) => e.kind === "freeze" && e.sq === e5 && e.owner === "b" && e.turns === 1,
  );
  check(frozen, "the stranded pawn is frozen for one turn instead");
}
{
  // Home square free: the pawn goes back.
  let g = freshGame(12);
  g = play(g, "e2e4");
  g = play(g, "e7e5");
  acquireBuff(g, "w", "hard_reset", 3);
  const e5 = SQ(4, 4);
  const e7 = SQ(4, 6);
  check(g.board.pieces[e7]?.type === "p" && !g.board.pieces[e5], "home square free: the pawn reboots to e7");
}

// --- 4. The retiered upgrades still bind and move -------------------------------

{
  let g = freshGame(21);
  g = play(g, "d2d4");
  g = play(g, "d7d5");
  acquireBuff(g, "w", "bishop_archbishop", 4);
  const idx = g.buffs!.players.w.buffs.findIndex((b) => b.id === "bishop_archbishop");
  const c1 = SQ(2, 0);
  check(activateBuff(g, "w", idx, [{ square: c1 }]) === true, "archbishop binds to c1");
  // Binding spends the turn; Black replies, then the leap must be on offer.
  g = play(g, "g8f6");
  const leap = legalMoves(g).some((m) => m.from === c1 && m.to === SQ(1, 2));
  check(leap, "the c1 bishop leaps like a knight (c1 to b3)");
}
{
  let g = freshGame(22);
  g = play(g, "c2c4");
  g = play(g, "e7e5");
  acquireBuff(g, "w", "god_knight", 7);
  const idx = g.buffs!.players.w.buffs.findIndex((b) => b.id === "god_knight");
  const b1 = SQ(1, 0);
  check(activateBuff(g, "w", idx, [{ square: b1 }]) === true, "god knight binds to b1");
  g = play(g, "g8f6");
  const slide = legalMoves(g).some((m) => m.from === b1 && m.to === SQ(2, 1));
  check(slide, "the b1 knight steps like a queen onto the vacated c2");
}

// --- 5. Lifebloom rework -----------------------------------------------------------

{
  let g = freshGame(31);
  g = play(g, "e2e4");
  g = play(g, "d7d5");
  g = play(g, "e4d5"); // white pawn takes
  g = play(g, "d8d5"); // queen takes back: White has lost a pawn
  acquireBuff(g, "w", "fm_boon_lifebloom", 6);
  const idx = g.buffs!.players.w.buffs.findIndex((b) => b.id === "fm_boon_lifebloom");
  const e4 = SQ(4, 3);
  const ok = activateBuff(g, "w", idx, [{ square: e4 }]);
  check(ok === true, "lifebloom places the pawn on the fourth rank (e4)");
  check(g.board.pieces[e4]?.type === "p" && g.board.pieces[e4]?.color === "w", "a white pawn stands on e4");
  const shielded = (g.buffs?.effects ?? []).some(
    (e) => e.kind === "shield" && e.owner === "w" && Array.isArray(e.squares) && e.squares.includes(e4) && (e.turns ?? 0) >= 1,
  );
  check(shielded, "the returned pawn wears a shield");
}

if (failures > 0) {
  console.error(`\n${failures} balance-pass check(s) failed`);
  process.exit(1);
}
console.log("\nbalance pass 2026-09: OK");
