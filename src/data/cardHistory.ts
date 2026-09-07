// Editorial history for the codex card pages: when each card entered the
// game, plus curated per-card balance notes. Server-safe pure data (no React,
// no client APIs) so the card routes render it statically as crawlable HTML.
//
// Two layers:
// - WAVES: one "added" event per shipping wave, dated from the git history of
//   the card barrels and the PR numbers in docs/CHANGELOG.md. Every card maps
//   to a wave via resolveWave, so every page has at least one history line.
// - CARD_HISTORY: hand-curated per-card events (tier moves, reworks) keyed
//   "buff:<id>" / "nerf:<id>". Starts sparse; grows as balance changes ship.
//
// Runtime moderator changes (card_overrides edits) are NOT here: those are
// recorded in the card_override_history table and merged in client-side by
// the CardInsights panel.

import { BALANCE_WAVE_2026_07_22 } from "./balanceWave1";
import { isBoon, type Buff } from "@/engine/buff";
import type { Nerf } from "@/engine/nerf";
import { buffCollection } from "@/lib/cardCollections";
import { EXPANDED_NERFS } from "@/engine/nerfs/expanded";
import { WILD_NERFS } from "@/engine/nerfs/wild";

export interface CardHistoryEvent {
  /** ISO date, ET calendar day (matching docs/CHANGELOG.md). */
  date: string;
  kind: "added" | "retier" | "rework" | "reword" | "disabled" | "enabled";
  /** One human sentence, rendered verbatim on the card page. */
  note: string;
  pr?: number;
}

// --- Waves --------------------------------------------------------------------

type WaveId =
  | "nerf-core"
  | "nerf-expanded"
  | "nerf-wild"
  | "buff-core"
  | "hex"
  | "boon"
  | "fantasy"
  | "funny"
  | "wild"
  | "mystic"
  | "apex";

const WAVES: Record<WaveId, CardHistoryEvent> = {
  "nerf-core": {
    date: "2026-05-14",
    kind: "added",
    note: "Part of the original nerf library Nerf Chess launched with.",
  },
  "nerf-expanded": {
    date: "2026-07-05",
    kind: "added",
    note: "Added in the expanded-nerfs wave: 82 new handicaps across all eight tiers.",
    pr: 144,
  },
  "nerf-wild": {
    date: "2026-07-07",
    kind: "added",
    note: "Added with the Wild expansion nerfs.",
  },
  "buff-core": {
    date: "2026-07-04",
    kind: "added",
    note: "Part of the original buff library that shipped with Buff mode and the draft system.",
  },
  hex: {
    date: "2026-07-05",
    kind: "added",
    note: "Added in the opponent-hex wave: the first curses you cast on the other player.",
    pr: 140,
  },
  boon: {
    date: "2026-07-05",
    kind: "added",
    note: "Added in the nerf-relief boon wave, growing the relief pool from 25 to 52 cards.",
    pr: 142,
  },
  fantasy: {
    date: "2026-07-06",
    kind: "added",
    note: "Added with the Fantasy collection.",
  },
  funny: {
    date: "2026-07-06",
    kind: "added",
    note: "Added with the Funny / meta collection.",
  },
  wild: {
    date: "2026-07-07",
    kind: "added",
    note: "Added with the Wild collection: elemental, warfare, arcane, and chaos cards.",
  },
  mystic: {
    date: "2026-07-10",
    kind: "added",
    note: "Added with the Mystic collection: prophecy, star signs, tarot, and spirit cards.",
  },
  apex: {
    date: "2026-07-07",
    kind: "added",
    note: "Added with the apex and mythic bands: cards never drafted normally, won only through a gamble or a top-tier bank.",
  },
};

const EXPANDED_NERF_IDS = new Set(EXPANDED_NERFS.map((n) => n.id));
const WILD_NERF_IDS = new Set(WILD_NERFS.map((n) => n.id));

function buffWave(b: Buff): WaveId {
  // Tier 9-10 cards shipped as their own band regardless of theme.
  if (b.tier >= 9) return "apex";
  const collection = buffCollection(b);
  if (collection === "Fantasy") return "fantasy";
  if (collection === "Mystic") return "mystic";
  if (collection === "Wild") return "wild";
  if (collection === "Funny") return "funny";
  if (b.category === "hex") return "hex";
  if (isBoon(b)) return "boon";
  return "buff-core";
}

function nerfWave(n: Nerf): WaveId {
  if (WILD_NERF_IDS.has(n.id)) return "nerf-wild";
  if (EXPANDED_NERF_IDS.has(n.id)) return "nerf-expanded";
  return "nerf-core";
}

// --- Curated per-card events ---------------------------------------------------

/** Hand-written balance notes, key "buff:<id>" | "nerf:<id>". Append here when
 * a card is retiered, reworked, or reworded in code, with the changelog date
 * and PR. Keep each note one sentence; the page renders them as a timeline. */
export const CARD_HISTORY: Record<string, CardHistoryEvent[]> = {
  // --- 2026-09-07 material pass: every card that hands over, brings back or
  // takes away MATERIAL is now priced by how much of it, at half a tier per
  // pawn, anchored on the two floors the structural pass already pinned (an
  // extra piece-class is Tier 4, an amazon-class upgrade is Tier 7). The
  // library had a price list for movement, shields and durations and none at
  // all for pieces, so the ladder got cheaper per point the more it gave.
  // scripts/material-model.ts scores each card; the ladder is pinned as
  // assertions in scripts/test-balance-pass-2026-09.ts.
  "buff:promote_now": [
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 3 to Tier 5 on the 2026-09 material pass: crowning a pawn is eight points of material, and Double Queen already charges Tier 5 for the same crown from anywhere on the board." },
  ],
  "buff:second_wind_major": [
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 3 to Tier 5 on the 2026-09 material pass: a rook back on the board is five points of material, two rungs above the minor that Tier 4 buys." },
  ],
  "buff:resurrect_queen": [
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 6 to Tier 7 on the 2026-09 material pass: a queen back is nine points, which is what the amazon-class anchor at Tier 7 costs for the same nine." },
  ],
  "buff:lich_phylactery": [
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 5 to Tier 6 on the 2026-09 material pass: a whole new queen on her home square, behind nothing but the capture that sets it off." },
  ],
  "buff:ww_recommission": [
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 4 to Tier 5 on the 2026-09 material pass: a captured rook returns, and the phasing it comes back with rides on top of the five points." },
  ],
  "buff:bw3_eleventh_hour": [
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 3 to Tier 4 on the 2026-09 material pass: your best captured piece returns; even discounted for the three-piece gate that clears a minor, and a minor is Tier 4." },
  ],
  "buff:bw2_queens_testament": [
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 3 to Tier 4 on the 2026-09 material pass: up to two captured minors come back, which beats a minor even priced at two of the cheaper kind behind the queen-capture gate." },
  ],
  "buff:minor_recall": [
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 3 to Tier 4 on the 2026-09 material pass: a captured minor back on the board is the same three points as Cathedral Choir and Summon Knight, which both sit at Tier 4." },
  ],
  "buff:wa_conjure_bishop": [
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 3 to Tier 4 on the 2026-09 material pass: a permanent unconditional bishop, the card Cathedral Choir already is at Tier 4. The mirror square says where the bishop lands, not whether it arrives." },
  ],
  "buff:second_wind": [
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 1 to Tier 2 on the 2026-09 material pass: a captured pawn back on the board for good, level with Militia Call." },
  ],
  "buff:ww_field_hospital": [
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 1 to Tier 2 on the 2026-09 material pass: a new pawn on your back rank the first time a knight of yours is taken." },
  ],
  "buff:bn4_understudy": [
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 1 to Tier 2 on the 2026-09 material pass: a pocket pawn, and the capture that pays for it is one you were going to suffer anyway." },
  ],
  "buff:summon_intern": [
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 1 to Tier 2 on the 2026-09 material pass: a pocket pawn behind a capture gate, priced with Understudy, which pays out the same pawn." },
  ],
  // --- 2026-09-05 full balance pass, lens batch: every active card checked
  // against its family for dominance ladders, twins priced apart, permanent
  // upgrades under temporary anchors, riderless one-shot defence, and text
  // that did not match the effect. Tiers live in scripts/hand-audit.json.
  "buff:bn4_militia_call": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:emotional_support_pawn": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_stowaway": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 1 to Tier 2 on the 2026-09 material pass: a pawn is a pawn even five turns late, and a pawn that arrives in your pocket is priced at Tier 2." },
  ],
  "buff:supply_drop": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_letters_home": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_small_consolation": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 2 to Tier 3 on the 2026-09 material pass: two pocket pawns, where one is worth Tier 2. The rooks and queens in the text are the trigger, not the payout." },
  ],
  "buff:bn4_matryoshka_surprise": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 2 to Tier 3 on the 2026-09 material pass: two pocket pawns behind a capture gate, level with Small Consolation, which pays the same two." },
  ],
  "buff:ov_trojan_pawn": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wa_conjure_scout": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:legendary_forge": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 3 to Tier 4 on the 2026-09 material pass: a minor into your pocket is Bodyguard's payload exactly, and Bodyguard is Tier 4. The sweep measured this card at -16.7 points, but that is one standard error on twelve pairs, and the identical payload measured +15.0 on the same harness." },
  ],
  "buff:bn4_florists_trick": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_night_gardener": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_second_spring": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_endless_militia": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw3_last_muster": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_winter_garrison": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_clay_colossus": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:smurf_account": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:pay_to_win": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wc_double_trouble": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:la_vaca_saturno_saturnita": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:necromancer": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_ancestral_audience": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw2_prisoner_exchange": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:resurrect": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw2_spoils_of_war": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw2_deathless_oath": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_life_insurance": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:mind_dominion": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:mind_control": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:mind_empire": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw3_pretender": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 7 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:blood_pact": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-07", kind: "retier", note: "Moved from Tier 5 to Tier 6 on the 2026-09 material pass: a pawn crowned on the spot is eight points of material, and the second pawn it bursts pays back one of them." },
  ],
  "buff:wc_deal_with_the_devil": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-06", kind: "retier", note: "Moved from Tier 4 to Tier 5 on the 2026-09 targeted sweep (12 paired games per card): it resolved at +59 points, above every tier-4 pieces card." },
  ],
  "buff:bn4_ascension_small": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-06", kind: "retier", note: "Moved from Tier 6 to Tier 7 on the 2026-09 targeted sweep (12 paired games per card): it resolved at +46 points, above every tier-6 pieces card." },
  ],
  "buff:bw2_alchemists_trade": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:queen_storm": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 7 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_house_of_banners": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_changeling_child": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw3_mummers_dance": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_retraining": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw3_ironwrights_bargain": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_promotion_jubilee": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:loyal_pawn": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 1 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:bw3_heir_apparent": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 1 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:comet_shard": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:gm_hardship_jackpot": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:gm_seven_cases": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_milkmans_round": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:warp_field": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:bw3_turn_the_tide": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:rgb_keyboard": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_templar_vows": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw3_second_face": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_gryphon_rider": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:chimpanzini_bananini": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_falconers_glove": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ww_dragoons": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wa_arcane_conduit": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw2_cornered_king": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_crowned_strider": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_kings_leap_year": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_kings_own_wings": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_queens_gambol": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_pathfinders": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wa_camel_rider": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_dancing_master": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:amazon_army": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 7 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:onslaught": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:overclock_major": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_regency_council": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_feng_shui_plot": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_gravity_flip": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_world_serpent": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_court_procession": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_stormcrossing": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw3_tunnelers": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:dragon_form": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:excalibur": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:onearmmuscleupismydream": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:age_of_heroes": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 7 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:cr_oh_no_my_queen": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wc_berserk_pawn": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:godslayer_knight": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 8 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wc_yeet": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:fey_step": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw3_rally_royal": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:muscle_up": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ley_line": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:we_undertow": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:warp_storm": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_worldgate": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_marshals_baton": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw2_bolt_hole": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw3_kings_sanctuary": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:mirror_of_souls": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-06", kind: "retier", note: "Moved from Tier 4 to Tier 5 on the 2026-09 targeted sweep (12 paired games per card): it resolved at +50 points, above every tier-4 movement card." },
  ],
  "buff:warp_sovereign": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:rubiks_cube": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw3_castle_in_the_storm": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_seven_league_boots": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_leapfrog": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_vaulting_pole": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw3_home_guard": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 7 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ww_shieldbearers": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:decoy": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_hearth_ring": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_bottled_courage": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:starlight_ward": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bulwark": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bubble_wrap": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:fortress": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:shieldmaiden": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:main_character": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_plot_armor": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_kings_champion": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ww_high_ground": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:we_verdant_shield": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_growth_ring": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ironclad": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:iron_wall": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw2_eternal_keep": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_winter_palace": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_beetle_shell": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_griffins_brood": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_shieldmaidens": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:absolute_aegis": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 7 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_saints_procession": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:gossamer_veil": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:frigo_camelo": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:we_stoneskin": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_heralds_truce": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_warding_circle": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_wall_of_faith": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:we_mountain_range": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:moai_head": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:bn4_town_walls": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:sundering": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_paperwork_avalanche": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:duelist": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_sting_of_the_wasp": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:cr_stalling_bishop": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wa_quicken": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_kettle_on": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_warm_soup": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:time_rewind": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wa_stolen_hours": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:gm_heads_or_tails": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 1 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wc_juggling_act": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:blitzkrieg": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:endless_turn": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:check_out_our_socials": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_deja_vu": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_lightning_rod": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_triumphal_arch": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_chess_boxing": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_time_heist": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:snap_freeze": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_flash_frost": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wa_chrono_siphon": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wa_arrest_time": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wa_time_stop": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wc_slip_on_ice": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_mod_powers": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_glacier_calving": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_frozen_moat": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:landlord": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wc_tar_pit": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wa_stone_pawns": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:wc_quicksand_patch": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:ov_midas_gauntlet": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ballerina_cappuccina": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_monks_of_the_fifth_bell": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_managers_challenge": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:purge": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw3_martyrdom": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw2_blood_duel": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw3_kingsguard_duel": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:chain_lightning": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ww_armored_breakthrough": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:dragons_breath": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 7 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:queens_rampage": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 7 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ww_spearhead": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ww_bayonet_charge": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:we_flame_lance": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:geometry_dash": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:giants_maul": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wa_void_rift": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wc_haunted_house": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:void_realm": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:atomic_captures": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 8 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:total_atomic": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 7 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:purge_realm": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ban_hammer": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 7 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_wizard_duel": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:gm_river_card": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_olympus_voicemail": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:siege_rook": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_confetti_cannon": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_party_hat": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_crown_of_masks": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_wind_up_knight": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_genie_lamp": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_cornucopia": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:gm_wheel_of_the_cosmos": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_care_package": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:trampoline": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_insider_trading": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_checkmate_rehearsal": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_wallhack_goggles": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_weather_balloon": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_prophecy_engine": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:op_sampler_platter": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 1 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_private_gallery": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_cartographers_vault": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bw2_blood_price": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:bn4_harvest_and_fallow": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:all_in": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_season_pass": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_patch_notes": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:gm_double_down_draft": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ov_dev_console": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_plush_cavalry": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_caught_mid_stride": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_rusted_battlements": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_overslept_officers": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_widows_veil": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_banquet_of_dust": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_ash_veil": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_no_doubling": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_crown_of_lead": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:burned_dispatches": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:empty_handed": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:dead_letter": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_iron_portcullis": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_pebble_in_the_shoe": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:sahur": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_hundred_year_nap": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_kraken_arms": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_lead_rain": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_stone_rain": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_reapers_due": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_narcolepsy": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_kings_ransom": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hw3_kings_guard": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_silken_net": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_thunderhead": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_haunted_gallery": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_frozen_harbor": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_hearth_frost": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_frozen_reserves": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_no_quarter": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_dead_march": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_burden_of_command": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_burned_keep": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_wall_of_teeth": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_velvet_rope": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_severed_lines": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_iron_ring": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_sealed_meridian": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_tidal_wall": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:leaden_limbs": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 7 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_mitred_blinders": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_castle_of_sand": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:crown_and_castle": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_brittle_arsenal": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_stone_garden": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_rusted_crown": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:queen_of_stone": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_gilded_cage": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_clay_hooves": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_honey_spill": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:statue_garden": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:serpent_brood": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:stone_curse": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_gorgons_court": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_gargoyle_perch": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:salted_earth": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_famine_year": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:iron_furrow": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_frost_heave": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_cold_reception": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_moat_diggers": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_beartrap_cache": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_river_watch": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_paddock_fence": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_grooms_leash": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_wagon_ruts": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:seized_axles": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_hollow_fanfare": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_hunters_moon": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_tribute_demand": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_ashen_bread": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_spiders_parlor": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 6 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hw2_crown_of_thorns": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 8 to Tier 7 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_poachers_snare": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 7 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_undertow": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_gale_warning": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hw3_hydra_hex": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:royal_handicap": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hw3_no_retreat": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 1 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_cobweb_corners": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_will_o_wisps": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 1 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_drawn_curtain": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_reined_back": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_moth_eaten_gloves": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_the_quarrel": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_wet_powder": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:ironbound_rook": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:chains_of_binding": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:wc_shy_pieces": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 5 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_skittish_mounts": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 3 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:gm_rigged_raffle": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_toad_pond": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_leaking_boats": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:hx4_borrowed_ladder": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 2 in the 2026-09 full pass: priced against the cards in its own family that do the same job." },
  ],
  "buff:chess_diff": [
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:skibidi_flush": [
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:bw2_shadow_reserve": [
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:hw2_pauper_crown": [
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:bw3_the_homecoming": [
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:grand_conjunction": [
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:divine_reckoning": [
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:bee_swarm_simulator": [
    { date: "2026-09-05", kind: "reword", note: "Text rewritten to say plainly what the effect does; the rule itself did not change." },
  ],
  "buff:nerf_this": [
    { date: "2026-09-05", kind: "disabled", note: "Retired: its condition (an opponent with two queens) never fires in a normal game." },
  ],
  "buff:bn4_midas_charter": [
    { date: "2026-09-05", kind: "disabled", note: "Retired: the boost window closed before any draft could land in it, so the card was a pure two-draft loss." },
  ],
  "buff:checkmate_immunity": [
    { date: "2026-09-05", kind: "disabled", note: "Retired: the ward was spent by the very move that gave check, so it never protected anything." },
  ],
  "buff:clone_army": [
    { date: "2026-09-05", kind: "disabled", note: "Retired into Second Army: the same two pocket pawns." },
  ],
  "buff:rook_chancellor": [
    { date: "2026-09-05", kind: "disabled", note: "Stays retired into Bishop to Archbishop, now that the bishop is priced at Tier 4 too." },
  ],
  // --- 2026-09-05 full balance pass, structural batch: dominance ladders,
  // twins priced apart, permanent upgrades under the temporary anchors, and
  // one-shot defensive cards with no rider. Win-rate sizing follows.
  "buff:bishop_archbishop": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 4: a permanent, unconditional extra piece-class was priced under a one-step add (Wazir Bishop, Tier 3); its retired twin Rook to Chancellor was hand-priced at 4." },
  ],
  "buff:knight_nightrook": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 3: a permanent rook slide on one knight; Twin Knights (both knights) sits at 4." },
  ],
  "buff:camel_knight": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 3: a permanent extra leap is priced like the other permanent one-step adds." },
  ],
  "buff:dragon_pawn": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 3: a knight that can still promote outclasses the conditional Vanguard promotion at 2." },
    { date: "2026-09-06", kind: "retier", note: "Moved from Tier 3 to Tier 4 on the 2026-09 targeted sweep (12 paired games per card): it resolved at +42 points, above every tier-3 movement card, so the pin from the structural pass moves with it." },
  ],
  "buff:cannon": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 3: permanent capture-by-screen on a rook is a permanent upgrade, priced with the others." },
  ],
  "buff:phase_rook": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 3: permanent phasing is a permanent upgrade, priced with the others." },
  ],
  "buff:god_knight": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 7: a permanent amazon sat below the two-turn amazons (Amazon Knight, Tier 6)." },
  ],
  "buff:dragon_mount": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 4: a knight with a permanent diagonal slide is an archbishop built from the other side, so it matches Bishop to Archbishop." },
  ],
  "buff:wc_black_hole": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 3, level with Void Rift, the same permanent trap square." },
  ],
  "buff:bn4_shepherds_watch": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5: Oathstone (Tier 4) is the same pawn immunity for one turn less." },
  ],
  "buff:hx4_lantern_out": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 6 to Tier 5: a two-turn capture ban in their own half, next to Withered Hands (three turns, whole board) at 7." },
  ],
  "buff:hx4_prowlers_bell": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 4 to Tier 6: three turns of no landing anywhere in your half strictly contains King's Moat (Tier 7)." },
  ],
  "buff:second_army": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 5 to Tier 4: two pocket pawns beside Bodyguard (a pocket knight) at 4 and Spare Button (one pawn) at 2." },
  ],
  "buff:ov_pet_rock": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 1: one pawn safe for one turn, where Pawn Shield gives four turns at 2." },
  ],
  "buff:bn4_night_watch": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 2 to Tier 1: one turn of king cover, where Decoy gives three turns plus a piece at 2." },
  ],
  "buff:ov_sandbags": [
    { date: "2026-09-05", kind: "retier", note: "Moved from Tier 3 to Tier 2: two pawns for one turn, level with Pawn Shield." },
  ],
  "buff:warp_home": [
    { date: "2026-09-05", kind: "rework", note: "The warp no longer spends your turn. Recall at the same tier already reaches any back-two-ranks square, so the precise return-to-post needed the timing to be worth a pick. The example sentence is gone." },
  ],
  "buff:hard_reset": [
    { date: "2026-09-05", kind: "rework", note: "When the pawn's home square is taken the card used to do nothing; it now freezes that pawn for a turn instead." },
  ],
  "buff:fm_boon_lifebloom": [
    { date: "2026-09-05", kind: "rework", note: "The pawn returns to your fourth rank and cannot be captured for the opponent's next two turns. It read identically to Field Stitches (Tier 2) and weaker than Florist's Trick (Tier 4)." },
  ],
  // --- 2026-08-04 weak-card buff pass: ~30 underpowered buffs, boons and
  // items lifted to their tier, one card at a time. No retiers, no nerfs.
  "buff:extra_glance": [
    { date: "2026-08-04", kind: "rework", note: "The glance now also grants a draft reroll; the reveal alone was the weakest card in tier 1." },
  ],
  "buff:ferz_king": [
    { date: "2026-08-04", kind: "rework", note: "The diagonal king hop can now be used twice per game instead of once." },
  ],
  "buff:half_step": [
    { date: "2026-08-04", kind: "rework", note: "Two uses instead of one, matching the rest of the tier-1 movement pairs." },
  ],
  "buff:vault": [
    { date: "2026-08-04", kind: "rework", note: "The rook now vaults its pawn twice instead of once." },
  ],
  "buff:nudge": [
    { date: "2026-08-04", kind: "rework", note: "The reroll surcharge is gone; a one-square pawn push is small enough to be free." },
  ],
  "buff:quick_glance": [
    { date: "2026-08-04", kind: "rework", note: "When the opponent has no reroll to lose you now gain one instead, so the card can no longer do nothing." },
  ],
  "buff:cornerstone": [
    { date: "2026-08-04", kind: "rework", note: "The ward now covers rooks anywhere on your back rank, not just the two starting corners." },
  ],
  "buff:castle_early": [
    { date: "2026-08-04", kind: "rework", note: "The text now admits the card always restored rook rights too, and the castle it re-opens lands with one turn of king cover." },
  ],
  "buff:spring_pawn": [
    { date: "2026-08-04", kind: "rework", note: "Two sideways springs instead of one; a single hop was worse than Tempo Shuffle a tier below." },
  ],
  "buff:vanguard": [
    { date: "2026-08-04", kind: "rework", note: "Knighting now works from the 5th rank, where a pawn can actually stand when a tier-2 draft lands." },
  ],
  "buff:sidestep_king": [
    { date: "2026-08-04", kind: "rework", note: "King safety extended from one turn to three; one turn at tier 3 lost to Decoy at tier 2." },
  ],
  "buff:screen": [
    { date: "2026-08-04", kind: "rework", note: "The adjacency ward now lasts six of your turns instead of three, paying for its condition." },
  ],
  "buff:shielded_advance": [
    { date: "2026-08-04", kind: "rework", note: "The enemy-half escort now lasts six of your turns instead of three." },
  ],
  "buff:trade_up": [
    { date: "2026-08-04", kind: "rework", note: "The consolation pawn now arrives for each of your next two lost minor pieces, not just the first." },
  ],
  "buff:pin_breaker": [
    { date: "2026-08-04", kind: "rework", note: "The escaping piece now lands warded for two turns; breaking free into a capture was no escape." },
  ],
  "buff:iron_bishop": [
    { date: "2026-08-04", kind: "rework", note: "The iron now turns knights as well as pawns; pawn-proofing alone was tier-1 sized at tier 4." },
  ],
  "buff:walnut_shell": [
    { date: "2026-08-04", kind: "rework", note: "With nothing frozen the shell can now be eaten for a draft reroll, so it is never a dead card." },
  ],
  "buff:firecracker": [
    { date: "2026-08-04", kind: "rework", note: "The startled piece now also loses its next move; a plain one-square shove was Nudge at four times the price." },
  ],
  "buff:bn4_hairline_crack": [
    { date: "2026-08-04", kind: "rework", note: "No longer strips your own shields; the survey now braces the lit piece nearest your king for a turn instead." },
  ],
  "buff:bn4_field_glasses": [
    { date: "2026-08-04", kind: "rework", note: "Spotted pieces now hold their fire for one turn; the flash alone told a decent player nothing new." },
  ],
  "buff:bn4_scouts_report": [
    { date: "2026-08-04", kind: "rework", note: "Your threatened pieces now dig in for one turn on top of the reveal." },
  ],
  "buff:bn4_war_room_map": [
    { date: "2026-08-04", kind: "rework", note: "The map now comes with 2 draft rerolls; a bare flash was priced against Punch Card in the same band." },
  ],
  "buff:bn4_danger_sense": [
    { date: "2026-08-04", kind: "rework", note: "The warning now covers the king and queen for one turn instead of only pointing at the danger." },
  ],
  "buff:bn4_listening_post": [
    { date: "2026-08-04", kind: "rework", note: "A dead wire now pays 1 draft reroll; against a blocked draft the card used to resolve to nothing." },
  ],
  "buff:bn4_lucky_coin": [
    { date: "2026-08-04", kind: "rework", note: "The coin no longer repossesses an unspent reroll; instead, spending one within two drafts flips it back into your hand." },
  ],
  "buff:bn4_augurs_flight": [
    { date: "2026-08-04", kind: "rework", note: "The birds now shelter every piece they circle for one turn instead of only naming them." },
  ],
  "buff:bn4_border_survey": [
    { date: "2026-08-04", kind: "rework", note: "The surveyed squares are now staked against enemy entry for one turn on top of the reveal." },
  ],
  "buff:bn4_lighthouse_beam": [
    { date: "2026-08-04", kind: "rework", note: "The glare now freezes the enemy piece deepest into your half for one turn; a tier-5 card should touch the board." },
  ],
  "buff:bn4_auditors_ledger": [
    { date: "2026-08-04", kind: "rework", note: "The audit now shields your undefended pieces for a turn and pays a reroll, pricing it beside Raven's Court." },
  ],
};

// --- Lookup ---------------------------------------------------------------------

/** The full editorial timeline for a card: its wave-introduction event plus
 * any generated balance-wave events and curated events, oldest first. Never
 * empty. */
export function historyFor(kind: "buff" | "nerf", card: Buff | Nerf): CardHistoryEvent[] {
  const wave = kind === "buff" ? buffWave(card as Buff) : nerfWave(card as Nerf);
  const key = `${kind}:${card.id}`;
  const balance = BALANCE_WAVE_2026_07_22[key] ?? [];
  const curated = CARD_HISTORY[key] ?? [];
  return [WAVES[wave], ...balance, ...curated].sort((a, b) => a.date.localeCompare(b.date));
}
