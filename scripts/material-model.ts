// Price every active card by the MATERIAL it moves, and report the cards whose
// tier sits below what that material is worth.
//
//   ./node_modules/.bin/tsx scripts/material-model.ts            # the report
//   ./node_modules/.bin/tsx scripts/material-model.ts --json     # docs/material-model.json
//   ./node_modules/.bin/tsx scripts/material-model.ts --check    # exit 1 on any violation
//
// WHY THIS EXISTS
//
// A card's tier IS its price, and the library has never had a price list for
// the one thing chess has always known how to value: material. Every other
// pricing floor in docs/overhaul-checklist.md covers movement grants, shields
// and durations. Nothing covers a card that hands you a piece, and the result
// is a ladder that gets CHEAPER per point the more it gives:
//
//   +1 pawn   t1-t3      1.0 to 3.0 tiers per point
//   +3 minor  t2-t4      0.7 to 1.3 tiers per point
//   +5 rook   t4-t6      0.8 to 1.2 tiers per point
//   +9 queen  t5-t7      0.6 to 0.8 tiers per point
//
// That is backwards. Material compounds: a queen is worth more than nine pawns
// because it is nine pawns' worth of force on one square that moves every turn.
// A sublinear ladder therefore prices the strongest effects in the game at a
// discount, and the library shows it. `wa_conjure_bishop` grants a permanent
// unconditional bishop for tier 3 while `bn4_cathedral_choir` and
// `summon_knight` do the same job at tier 4. `bn4_care_package` is tier 3 and
// measures +41.7 win-rate points, the same band as the measured tier 6 and 7
// cards.
//
// This script is the missing price list. It does not change any tier. It reads
// the card text, scores the material, checks the resulting ladder against the
// measured win-rate sweep, and prints who is underpriced.
//
// NERFS ARE SCORED WITH THE SIGN FLIPPED. A nerf is a handicap and its tier
// means how bad the handicap is, so a nerf that costs its holder a bishop is
// three points of SEVERITY rather than minus three of gain. That is what lets
// one ladder price both pools.
//
// WHAT THE NUMBERS MEAN
//
// M is EFFECTIVE MATERIAL in pawns, on the standard chess scale from
// src/lib/material.ts (p=1 n=3 b=3 r=5 q=9). It is a sum over every material
// term the parser can find in the card's own description:
//
//   M = SUM over terms of  value x count x permanence x conditionality
//
//   permanence     permanent 1.0
//                  temporary for N turns  min(1, N/10)   (ten turns is most of
//                    a bot game, so a ten-turn piece is priced as a real one)
//                  pocket / drop 0.95     (a piece you still have to spend a
//                    turn placing, and which the opponent can play around)
//   conditionality unconditional 1.0
//                  gated on a capture 0.8
//                  gated on a board state 0.65
//                  random: the stated odds, as an expectation over branches
//                    (Care Package: 0.5x1 + 0.25x3 + 0.25x3 = 2.0)
//
// Material GAINED by the holder and material DENIED to the opponent both count
// POSITIVE: a hex that destroys a bishop is worth the same three points as a
// card that conjures one. Material the holder SPENDS counts negative, so a
// card that trades a knight for a knight scores zero rather than three.
//
// WHAT THE PARSER WILL AND WILL NOT CLAIM
//
// The text is prose, not data, so the extractor is deliberately timid. It
// UNDER-COUNTS wherever the reading is not forced, and every card it cannot
// read is printed in the UNPARSED list at the end rather than quietly scored
// zero. That list is the honest coverage number: a card sitting in a material
// effect category with M = 0 is a hole in this model, not a finding about the
// card. Two specific choices are worth naming because they cut the other way
// from what the words suggest:
//
//   A PLACEMENT CONSTRAINT IS NOT A CONDITION. "on an empty square in your
//   half", "the empty square nearest your home rank", "whose mirror square is
//   empty" all describe WHERE the piece lands, not WHETHER it arrives. Those
//   score 1.0. Only a guard on arrival ("only if", "if that square is still
//   empty", "while there is room", "up to N") drops to 0.65.
//
//   A TRIGGER CLAUSE IS NOT AN EFFECT. "The next 2 times your opponent
//   captures one of your rooks or queens, a pawn joins your pocket" moves one
//   pawn, not a rook and a queen. Subordinate clauses are stripped before any
//   term is scored, and are read only for the conditionality multiplier and
//   for a repeat count.
//
// Board-wide quantifiers ("every enemy pawn") have no count in the text, so
// they are scored from a documented expected-survivor table and reported in
// their own ESTIMATED bucket, separate from the terms read straight off the
// page.
//
// DELAYED AND CONDITIONAL REMOVAL, AND WHY IT NEEDED FOUR FIXES (round 9).
//
// The largest hole this model had was cards whose piece nouns sit in one
// clause and whose removing verb sits in a later one, with an anaphor in
// between: "Mark up to three enemy knights, bishops, or pawns; after your
// opponent's next move, lightning falls and removes EACH MARKED PIECE that
// still stands." Eighteen cards measured above +30 win-rate points at M = 0,
// and fourteen of them were material this parser could not read.
//
// They did not fail for one reason, and the `pending` / `carried` machinery
// already covered more of them than it looked. The four things actually wrong
// were small and separate, and each is named at its definition:
//
//   1. A QUALIFIER COUNTED AS AN ANTECEDENT. "Mark two enemy pieces of any
//      type below queen" has one noun group and one phantom one, the
//      two-candidate guard fired on the phantom, and the sentence parked
//      nothing (`qualifier`, in the mention loop).
//   2. AN ANAPHOR WEARING A NOUN. "each marked piece" is "it" spelled out, but
//      the pronoun rule tested `!hasNoun` and threw the clause away
//      (ANAPHOR_NOUN).
//   3. A CLASS UPGRADE WITH ITS SUBJECT A SENTENCE BACK. "it becomes a queen
//      where it stands" is a TRANSFORM, worth the difference, and the
//      antecedent had to survive one more sentence to reach it
//      (ANAPHOR_UPGRADE, and the pending-forwarding branch).
//   4. MISSING WORDS. "destroying", "crush", "dragged off", "drops in",
//      "become" as a bridge in TRANSFORM, "adjacent" as a modifier, and "your
//      next N captures" as both a gate and a repeat count.
//
// One shape stays unreadable and is NOT guessed at. Where the passive verb
// sits more than 45 characters past its subject, behind an exclusion and a
// locative ("every enemy piece EXCEPT THE KING STANDING ON OR NEXT TO THAT
// SQUARE is blown off the board", `hw3_time_bomb`), the after-window never
// reaches the verb. Widening that window to 60 was tried and measured: it does
// not reach these two cards anyway, it moves six unrelated cards, and it
// pushes `blood_pact` above its own tier on a verb it should not have bound.
// So the window stands and those cards stay in the UNPARSED list, which is
// where a card the parser cannot read honestly belongs.
//
// AND A CARD THE PARSER READS WRONG IS HELD OUT BY NAME. KNOWN_MISREAD lists
// the cards whose M has been checked against the engine and found wrong, with
// the line of the buff that settles it and the parser fix that would retire
// the entry. Those rows are printed in their own section instead of in
// VIOLATIONS, because a floor computed from a number we know is wrong is not a
// finding. Holding a card out is not a defence of its tier.
//
// THE POCKET DISCOUNT: ASKED, MEASURED, AND THE ANSWER IS NO (round 7).
//
// A pocketed piece is priced here at 0.95 of the same piece on the board, on
// the reasoning that you still have to spend a turn placing it. The argument
// AGAINST that discount is good: in this engine a drop lands on ANY empty
// square on the whole board, it is appended AFTER every nerf and effect filter
// so no handicap can stop it, and it counts as a legal move for stalemate
// resolution. A knight in the pocket can appear on a fork square with no travel
// and nothing able to prevent it, which sounds worth MORE than the same knight
// standing in your own half, not five percent less.
//
// It looked settled by one row: `bn4_care_package` (a random pocket minor,
// M=1.90) measures +41.7 +-14.9, 2.8 sigma, the strongest small card in the
// sweep. So the whole pocket family was measured instead of that one card.
//
//   pocket, residual against own tier      +1.1pt   n=13
//   non-pocket carrying material           +7.3pt   n=71
//   difference                             -6.3 +-5.0pt   (1.3 sigma)
//
// The family measures slightly BELOW the rest of the material cards, not above,
// and cannot resolve either way. `bn4_care_package` is the top of a
// thirteen-card spread that runs down to `legendary_forge` at -16.7. Those two
// carry the same payload class and sit 58 points apart on 12 pairs each: that
// is the error bar, exactly as round 1 found for `legendary_forge` against
// `bodyguard`.
//
// So the multiplier stays at 0.95. The mechanical argument may still be right
// and the sweep simply cannot see a 5% difference at this sample size, but a
// change on one row would have been generalising from the largest number in a
// noisy column, which is the failure mode this whole file exists to avoid.
//
// WHERE THE LADDER COMES FROM
//
// The floor is fitted to the measured sweep (docs/card-winrate*.json), and the
// fitting is done three ways because the first two do not work. The report
// prints all three, so that is visible rather than hidden.
//
//   1. TWO SEPARATE LINES. delta ~ a + b x tier over the whole measured
//      library, and delta ~ c + d x M over the material cards. b comes out
//      near 1.76 win-rate points and d near 1.70. Dividing them is
//      meaningless: the tier slope is measured over a population that is
//      mostly inert at every tier and the material slope over one that is
//      almost never inert, so the ratio describes the two populations rather
//      than the exchange rate.
//
//   2. ONE JOINT LINE. delta ~ a + b x tier + d x M, inverse-variance
//      weighted, both coefficients from the same rows. The tier coefficient
//      collapses to about 0.44 while material takes 1.55, which is 3.6 tiers
//      per pawn and prices a queen at tier 33. That is collinearity plus a
//      tier signal far below the per-card error bar, not a finding.
//
//   3. TWO EMPIRICAL CURVES, WHICH IS WHAT THE LADDER USES. The weighted mean
//      delta of each rung, made monotone, against the weighted mean delta of
//      each band of material. No functional form assumed, and no dividing one
//      noisy slope by another.
//
// Curve 3, as the sweep stood when this was written:
//
//   rung       t1 -0.0  t2 +0.3  t3 +1.0  t4 +1.2  t5 +3.2  t6 +3.2  t7 +5.5
//              so one rung of price is worth about 0.93 win-rate points
//   material   none +0.9 (337 cards)   up to a pawn +2.8 (15)
//              a pawn to a minor +8.6 (12)   a minor +5.2 (18)
//              a rook +4.2 (9)   a queen or more +40.6 (4)
//
// What that DOES establish is a direction and a bound: every band of material
// measures above the cards that carry none, and by more win rate than the
// ladder charges rungs for. A minor's worth of material measures +4.3 over the
// baseline, which at 0.93 points a rung is 4.7 rungs of power for the 3 rungs
// the ladder charges.
//
// What it does NOT establish is the rate itself. The bands hold nine to
// eighteen measured cards each against a per-card error bar around twelve
// points, so their ordering among themselves is noise: the pawn-to-minor band
// out-measuring the rook band is a sampling accident. Nobody should read
// "+8.6 for two points of material" as a price.
//
// So the ladder is anchored STRUCTURALLY and bounded by the data. The anchors
// are the pricing floors the 2026-09 balance pass already established and
// pinned in scripts/test-balance-pass-2026-09.ts:
//
//   an extra piece-class is tier 4     ->  M = 3 (a minor)  is tier 4
//   an amazon-class upgrade is tier 7  ->  M = 9 (a queen)  is tier 7
//
// A straight line through those two points is 0.5 tiers per point of material.
// That is the rate the library already charges for ABILITIES worth that much
// material; this script does nothing more than extend it to the cards that
// hand over the material itself. The measured curve says the rate is, if
// anything, too cheap, which is the direction a floor should err in.
//
// THE LADDER, AND WHY EACH BREAKPOINT SITS WHERE IT DOES
//
//   M < 0.75   tier 1   under the parser's own resolution. A fraction of a
//                       pawn behind a coin flip buys nothing
//   M >= 0.75  tier 2   a pawn discounted by a lease, a gate or the odds
//   M >= 1.5   tier 3   a clean permanent pawn
//   M >= 2.5   tier 4   A MINOR, and the anchor. bn4_cathedral_choir and
//                       summon_knight already sit here for exactly this;
//                       wa_conjure_bishop does the same job one rung lower
//   M >= 4.5   tier 5   a rook, at 0.5 tiers per point from the minor anchor
//   M >= 6.5   tier 6   a rook and a pawn, or two minors
//   M >= 8.5   tier 7   A QUEEN, and the second anchor
//   M >= 12    tier 8   a queen and a rook: the top of the draft ladder, and
//                       where the CEILING starts doing the work instead of the
//                       rate. At 0.5 tiers per point a queen and a rook would
//                       price at 9.5, and there is no such rung to sell
//   M >= 18    tier 9   apex, which is outside the normal draft entirely
//
// The low band deliberately sits one rung under the anchored line, which puts
// M = 1 at tier 3 where the ladder says tier 2, because a fraction of a pawn
// is exactly where a text parser is least sure of itself and a floor should
// never be the aggressive reading.
//
// WHAT THIS IS NOT
//
// It is not a full power model. A card can be worth tier 7 for reasons that
// have nothing to do with material, and this says nothing about those cards:
// the floor is a FLOOR. A card above its floor is not endorsed by this script,
// it is merely not accused. And --check is not wired into any guard yet, on
// purpose: the model gets read and argued with before it gets enforced.

import fs from "node:fs";
import path from "node:path";
import { isRetired } from "../src/engine/retired";

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");

const WRITE_JSON = process.argv.includes("--json");
const CHECK = process.argv.includes("--check");

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** The scale from src/lib/material.ts, which is what the game already shows a
 *  player in the captured-material strip. Kings are worth nothing here because
 *  no card in the library adds or removes one. */
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/**
 * An untyped "piece" in card text.
 *
 * 2.6 is the mean value of a non-king piece in the starting array
 * ((8x1 + 2x3 + 2x3 + 2x5 + 9) / 15). Using the MEAN rather than the median
 * (which is 1, a pawn) is the one place this model rounds up, and it does so
 * because card text that says "piece" without a type almost always means the
 * player picks, and a player does not pick a pawn.
 */
const GENERIC_PIECE = 2.6;

/** "your best/strongest/finest captured piece". Could be a queen; priced as a
 *  rook, because by the time a card like this fires the queen is usually still
 *  on the board and the best thing in the graveyard is a rook or a minor. */
const BEST_PIECE = 5;

/**
 * Expected survivors for a board-wide quantifier, since "every enemy pawn"
 * carries no count. Taken at the point a mid-tier card actually fires (roughly
 * move 25 in the sweep's games), not at the start of the game. Every term
 * scored from this table is flagged `estimated`.
 */
const BOARD_WIDE: Record<string, number> = { p: 6, n: 1.5, b: 1.5, r: 1.5, q: 1, "?": 4 };

/** A board-wide quantifier with a LOCAL scope ("every enemy piece beside it")
 *  is not board-wide at all. */
const LOCAL_SCOPE = 1.5;

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/**
 * The tier floor as a monotonic step over M. Read the justification for each
 * rung in the header; the numbers cited here are printed by the fit on every
 * run so they can be checked rather than trusted.
 *
 * Entries are (minimum M inclusive, floor tier), ascending.
 */
const FLOOR_LADDER: { m: number; tier: number }[] = [
  { m: 0.0, tier: 1 }, // under the parser's own resolution
  { m: 0.75, tier: 2 }, // a pawn discounted by a lease, a gate or the odds
  { m: 1.5, tier: 3 }, // a clean permanent pawn
  { m: 2.5, tier: 4 }, // A MINOR. The anchor: "extra piece-class is tier 4"
  { m: 4.5, tier: 5 }, // a rook, at 0.5 tiers per point from that anchor
  { m: 6.5, tier: 6 }, // a rook and a pawn, or two minors
  { m: 8.5, tier: 7 }, // A QUEEN. The anchor: "amazon-class is tier 7"
  { m: 12.0, tier: 8 }, // a queen and a rook: the ceiling starts binding here
  { m: 18.0, tier: 9 }, // apex, outside the normal draft
];

function floorTier(m: number): number {
  let t = 1;
  for (const rung of FLOOR_LADDER) if (m >= rung.m) t = rung.tier;
  return t;
}

// ---------------------------------------------------------------------------
// Extraction
//
// The parser is a two-stage scanner rather than a grammar. Stage one finds
// every piece noun in the card's own text; stage two decides, for each one,
// whether the card makes it ARRIVE, makes it LEAVE, or merely mentions it.
// Everything else (counts, odds, durations, gates) hangs off that decision.
//
// The rules below are all reactions to a specific card that the naive version
// read wrong, and each is named at its definition, because the only way to
// trust a text parser is to be able to see what it refused to do.
// ---------------------------------------------------------------------------

/** Possessive forms are excluded: "your bishop's reflection" names a square,
 *  not a bishop that arrives. */
const NOUN_SRC =
  "(?:pawns?|knights?|bishops?|rooks?|queens?|minor pieces?|minors?|major pieces?|majors?|pieces?)(?!['’]s)";
const MENTION = new RegExp(`\\b${NOUN_SRC}\\b`, "g");

/** A fresh scanner for the replacement post-pass. `MENTION` is a global regex
 *  the parser drives statefully with `lastIndex`, so borrowing it mid-parse
 *  would move a cursor somebody else is holding. */
const NOUN_SCAN = new RegExp(`\\b(${NOUN_SRC})\\b`, "g");

/** "X ... and Y returns IN ITS PLACE" is a transform written the long way
 *  round: the card is worth Y minus X, not Y. */
const REPLACEMENT = /\b(?:in its place|in place of|in their place|replacing it|takes its place)\b/;

/** A copy is worth whatever it copies. `clone` ("place an exact copy on an
 *  empty square beside it") and `wc_double_trouble` ("place its exact twin")
 *  spawn a whole piece and never name one, so the noun scanner alone scored
 *  both at zero. */
const COPY_MENTION = /\b(?:copy|copies|twin|twins|duplicate|double)\b/g;

/** The pronoun a follow-on clause uses for a piece the previous clause named. */
const PRONOUN_SUBJECT = /\b(?:it|they|them|both|that piece|the piece|the marked piece)\b/;

/**
 * A piece-class UPGRADE IN PLACE whose subject is that pronoun: "it becomes a
 * queen where it stands", "they become queens". The piece is already on the
 * board, so the card is worth the DIFFERENCE and not the target.
 *
 * Anchored at the pronoun rather than allowed to float, and the gap to the
 * verb is short, because the whole point is that this clause names no source
 * of its own. Where the source IS named in the same breath, TRANSFORM has
 * already taken it.
 */
const ANAPHOR_UPGRADE = new RegExp(
  `\\b(?:it|they|them|both|that piece|the piece|each|every)\\b[^.]{0,20}?` +
    `\\b(?:becomes?|become|turns? into|is now|are now)\\s+(?:a |an )?(${NOUN_SRC})\\b`,
);

/**
 * Changing sides, as opposed to arriving or leaving.
 *
 * Every other term in this model is one-sided, and the header says a gain and
 * a denial are worth the same. A defection is BOTH at once on the same piece,
 * so it moves twice the material: their army is one piece lighter and yours is
 * one piece heavier. Used only where the card also says whose side the piece
 * ends up on (see the `loaned` test), because "the winner steals a random
 * enemy pawn, which walks across and defects" (`gm_river_card`) can defect to
 * either player.
 *
 * A bare "to your side" is deliberately NOT enough. `hw3_exiles_mark` says
 * "every move it makes must carry it CLOSER TO YOUR SIDE", which is a movement
 * rule about a piece that then crumbles to dust, and reading that as a
 * defection paid the holder twice for a piece he never owns. Only a verb of
 * changing allegiance counts.
 */
const DEFECTION =
  /\b(?:defects?|defected|defection|turns? its coat|changes? sides?|joins? your (?:side|army|colou?rs?)|comes? over to your (?:side|colou?rs?))\b/;

/**
 * An explicit BACK-REFERENCE: a noun phrase whose modifier says an earlier
 * clause already named this piece.
 *
 * "Mark up to three enemy knights, bishops, or pawns; after your opponent's
 * next move, lightning falls and removes EACH MARKED PIECE that still stands"
 * (`lightning_strike`) is the same anaphor as "it is removed", but it wears a
 * noun, so the `!hasNoun` test in the pronoun rule threw the clause out and the
 * card scored nothing at all.
 *
 * Only markers that can ONLY be back-references are listed. A piece is
 * "marked", "chosen" or "condemned" because some earlier clause marked, chose
 * or condemned it. "the enemy pawn" is deliberately NOT here: a card may
 * introduce an enemy pawn it has never mentioned before, and binding that to a
 * previous sentence would be a guess.
 */
const ANAPHOR_NOUN = new RegExp(
  `\\b(?:each|every|the|those|these|both|any|all)\\s+(?:of\\s+(?:the|those|them)\\s+)?` +
    `(?:still\\s+|remaining\\s+|surviving\\s+)?(?:marked|chosen|condemned|named|selected|targeted)\\s+` +
    `(?:${NOUN_SRC})\\b`,
  "g",
);

/** Comma-separated clauses of a sentence, blanks dropped. Blanked-out trigger
 *  clauses (see effectText) survive as whitespace and fall out here. */
const clausesOf = (text: string): string[] => text.split(/,\s+/).filter((c) => c.trim());

/** Does this fragment name a piece of its own? Both scanners carry /g, so
 *  lastIndex is reset before each test or the answer depends on call order. */
function hasNoun(text: string): boolean {
  MENTION.lastIndex = 0;
  COPY_MENTION.lastIndex = 0;
  return MENTION.test(text) || COPY_MENTION.test(text);
}

/**
 * A clause that names no piece of its own: every noun in it is a
 * back-reference to one an earlier clause already named. This is the same
 * statement as `!hasNoun(c) && PRONOUN_SUBJECT.test(c)`, made about a clause
 * that says "each marked piece" instead of "it".
 */
function isAnaphoricClause(text: string): boolean {
  ANAPHOR_NOUN.lastIndex = 0;
  if (!ANAPHOR_NOUN.test(text)) return false;
  ANAPHOR_NOUN.lastIndex = 0;
  return !hasNoun(text.replace(ANAPHOR_NOUN, " "));
}

function nounKey(word: string): string {
  const s = word.toLowerCase();
  if (s.startsWith("pawn")) return "p";
  if (s.startsWith("knight")) return "n";
  if (s.startsWith("bishop")) return "b";
  if (s.startsWith("rook")) return "r";
  if (s.startsWith("queen")) return "q";
  if (s.startsWith("minor")) return "n";
  if (s.startsWith("major")) return "r";
  return "?";
}

function nounValue(word: string): number {
  const k = nounKey(word);
  return k === "?" ? GENERIC_PIECE : PIECE_VALUE[k];
}

/**
 * The piece ARRIVES for somebody.
 *
 * Bare "land", "drop", "slip", "rise" and "serve" were all in this list once
 * and all had to come out: "she freezes where she lands" and "every piece they
 * move must land on the opposite colour" are movement rules, not spawns, and
 * they were pricing a hex at nine points of queen. Where those verbs really do
 * mean arrival the card says where ("into your pocket"), so the anchored form
 * is used instead of the bare one.
 *
 * "gain" is likewise anchored: "gains one longer 3-by-1 camel leap" gains an
 * ability, not a knight, so "gain" only counts when a count follows it.
 */
const GAIN: RegExp[] = [
  /\bappears?\b/,
  /\barrives?\b/,
  /\bmaterialis|\bmaterializ/,
  /\bjoins?\b/,
  /\brejoins?\b/,
  /\b(?:is|are) placed\b/,
  /\bplaces?\b|\bplacing\b/,
  /\bsummons?\b/,
  /\bconjures?\b/,
  /\bspawns?\b/,
  /\badds?\b/,
  /\breturns?\b|\breturned\b/,
  /\brevives?\b|\brevive\b/,
  /\bresurrect/,
  /\brestores?\b|\brestored\b/,
  /\bbrings?\b|\bbrought\b/,
  /\bcomes? back\b/,
  /\bsprouts?\b/,
  /\bpops? out\b/,
  /\breforged\b/,
  /\brecommission/,
  /\b(?:into|in|to) your (?:pocket|reserves|hand)\b/,
  /\bfights? (?:for|beside|as|like)\b/,
  /\bserves? as\b/,
  /\breports? for duty\b/,
  /\bmarch(?:es)? in\b/,
  /\btake control of\b/,
  /\bdefects?\b|\bturns its coat\b/,
  /\b(?:hires?|conscripts?|recruits?)\b/,
  // "a fresh rook DROPS IN there" (`smurf_account`). Bare "drop" is banned
  // above because it is also what a piece does when it lands on a square; the
  // phrasal "drops in" only ever means arrival, and is the anchored form the
  // note above asks for.
  /\bdrops? in\b/,
  /\b(?:is|are|was|were) raised\b/,
  /\braises?\s+(?:a|an)\b/,
  /\btakes? (?:the|an?|over) (?:nearest|empty|open|free|vacated)\b/,
  /\bconverts?\b/,
  /\bto your (?:side|colou?r)\b/,
  /\bhatch(?:es)?\b/,
  /\bborrows?\b/,
  /\bback onto\b|\bback to the board\b/,
  /\bsplits? in two\b/,
];

/** The piece LEAVES the board. "captured" is last on purpose: it is also the
 *  adjective in "one of your captured pawns", and GAIN wins any tie. */
const DENY: RegExp[] = [
  /\bremoves?\b|\bremoved\b|\bremoving\b|\bremove\b/,
  // "destroying" was missing while "removing" was present, and a participle is
  // how half the blast cards say it: "detonate one square in every direction,
  // DESTROYING up to two adjacent enemy pieces" (`total_atomic`).
  /\bdestroys?\b|\bdestroyed\b|\bdestroy\b|\bdestroying\b/,
  /\berased?\b|\bobliterated?\b/,
  /\bbanish(?:es|ed)?\b/,
  /\bbanned\b/,
  /\bblown off\b|\bswept off\b|\btaken? off the board\b/,
  // ANCHORED, because bare "dragged" is the library's usual word for a SHOVE:
  // `we_riptide` drags a piece "one square back toward its home rank" and
  // `magnetism` drags one "up to two squares toward that knight". Only
  // "dragged off" and "dragged below" take it away (`hw3_doomed_vow`,
  // `ov_leviathan_below`).
  /\bdragged (?:off|below)\b/,
  // `giants_maul` and `ov_cloud_serpent` are the only two cards that crush
  // anything, and both mean the piece is gone.
  /\bcrush(?:es|ed)?\b/,
  // "it leaves the board for a higher plane" (Apotheosis) is a removal, and
  // the only five cards in the library that say "leaves the board" all mean
  // it literally. The EXPIRY table above reads the LEASE form of the same
  // words ("then leaves the board after 6 of your turns") before this list is
  // ever consulted, so a timed piece is still priced as a lease, not a cost.
  /\bleaves? the board\b/,
  /\bconsumed\b|\bdevours?\b|\bdevoured\b/,
  /\bwinks? out\b|\bvanish(?:es)?\b/,
  /\bkills?\b|\bkilled\b/,
  /\bclears?\b/,
  /\bpurges?\b/,
  /\brots away\b/,
  /\b(?:is|are) (?:captured|lost)\b/,
  /\bsacrific\w*\b/,
  /\bknocked off\b/,
  /\bcut down\b|\bsmites?\b/,
  /\bfeeds?\b/,
];

const hits = (set: RegExp[], text: string): boolean => set.some((re) => re.test(text));

/** Every arrival verb except "return", so a card can be asked whether anything
 *  OTHER than a return put the piece there. */
const GAIN_WITHOUT_RETURN = GAIN.filter((re) => !/return/.test(re.source));

/**
 * Blank the phrases where "place" is a noun rather than the verb "to place".
 *
 * "Choose any two of your own pieces; they swap places" was reading as two free
 * pieces, and every swap and teleport card in the library said the same thing.
 */
const dePlace = (t: string): string =>
  t
    .replace(
      /\b(?:swaps?|swapped|trades?|traded|changes?|changed|exchanges?|switch(?:es|ed)?)\s+(?:places|squares|positions|masks|sides|forms)\b/g,
      " ",
    )
    .replace(/\b(?:in|to|from) (?:its|their|his|her|the) place\b/g, " ")
    .replace(/\btakes? (?:its|their|his|her) place\b/g, " ");

const OPP_WORDS = /\b(enemy|their|theirs|opponent|opposing|hostile|they)\b/;
const SELF_WORDS = /\b(your|yours)\b/;

/**
 * Subordinators that open a clause describing WHEN, not WHAT.
 *
 * "The next 2 times your opponent captures one of your rooks or queens, a pawn
 * joins your pocket" moves one pawn. Without this the parser read the trigger
 * as the payout and priced the card at a rook plus a queen.
 */
const TRIGGER_OPENER =
  /^(?:and |then |but |or |even )?(?:when|whenever|while|if|unless|until|after|before|once|each time|every time|the first time|the next \d+ times?|the (?:first|next) (?:\d+|one|two|three|four|five) (?:of|times)|should|as soon as|provided|as long as|on the turn|in \d+ (?:of your )?turns?)\b/;

const COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  another: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  both: 2,
};

/** Words that may sit between a quantifier and its noun. */
/** "adjacent" is a SCOPE adjective, not a gate: "destroying up to two ADJACENT
 *  enemy pieces" says where the two are, not whether they are there, and
 *  leaving it off this list cost the whole blast family its count. */
const MODIFIER =
  "(?:new|fresh|spare|extra|second|smaller|larger|random|captured|fallen|lost|dead|slain|enemy|surviving|remaining|other|chosen|clockwork|golden|best|strongest|finest|highest-value|heaviest|weakest|own|more|additional|small|big|good|exact|identical|tiny|little|adjacent|neighbouring|neighboring|of|your|their|its|his|her|them|the|opponent's|opponents)";

const QUANT = new RegExp(
  `\\b(up to (?:\\d+|one|two|three|four|five)|\\d+|a|an|any|one|another|two|three|four|five|six|seven|eight|nine|ten|both|every|each|all)\\s+(?:${MODIFIER}\\s+){0,3}$`,
);

/** New material is always introduced indefinitely ("a knight", "two pawns",
 *  "up to three"), or is a named revival ("your captured rook"). A bare plural
 *  with no quantifier ("Knights that arrive later gain none") is talking about
 *  pieces that already exist, so it cannot be a gain. */
const REVIVAL_ADJ = new RegExp(`\\b(?:captured|fallen|lost|dead|slain)\\s+(?:${MODIFIER}\\s+){0,2}$`);

/** A noun behind one of these is a type QUALIFIER on some other noun, not a
 *  piece the card moves: "every enemy piece other than a pawn or king",
 *  "an enemy piece of equal or greater value", "any type below queen". */
/**
 * A movement simile is not a piece. "for your next 3 turns it also moves like a
 * queen" widens a pawn's moves; it does not put a queen on the board, and
 * reading it as one priced Berserk Pawn at a whole queen.
 *
 * "fights as a bishop" is deliberately NOT on this list. That one really does
 * add a body to the board, which is why the verb matters and not the simile.
 */
const MOVEMENT_SIMILE =
  /\b(?:moves?|move|slides?|steps?|jumps?|leaps?|travels?|glides?|springs?|strides?|marches)\s+(?:also\s+|now\s+|still\s+)?(?:like|as)\s+(?:a|an)\s*$/;

const QUALIFIER_LEAD =
  /\b(?:other than|except|excepting|besides|apart from|instead of|rather than|below|above|greater than|less than|smaller than|larger than|worth more than|of equal|aside from|not a|never a|no)\s+(?:a |an |the )?$/;

/**
 * A verb standing BEFORE its noun has to govern it directly, so only counting
 * and describing words may sit between the two. A whitelist rather than a
 * blacklist, because "gains one longer 3-by-1 camel leap" and "place a new
 * pawn" differ only in what the gap contains, and listing what is allowed is
 * the shorter and safer of the two lists.
 */
const GAP_ALLOWED =
  /^(?:\s|,|\(|\)|-|\d+|\b(?:a|an|the|any|one|another|two|three|four|five|six|seven|eight|nine|ten|both|every|each|all|up|to|of|in|on|at|into|onto|and|or|but|back|most|new|fresh|spare|extra|second|smaller|larger|random|captured|fallen|lost|dead|slain|enemy|surviving|remaining|other|chosen|clockwork|golden|tiny|adjacent|neighbouring|neighboring|best|strongest|finest|highest-value|heaviest|weakest|own|more|additional|small|big|good|exact|identical|your|their|its|his|her|them|it|opponent's|opponents)\b)*$/;

/**
 * A verb standing AFTER its noun takes it as the subject ("a pawn joins your
 * pocket"), so the gap may carry a little scenery, but not a competing verb.
 * "captured" is on the list because "the next 2 of your pawns that are
 * captured each return" is a trigger wearing an effect's clothes.
 */
const GAP_DISQUALIFY =
  /\b(?:move|moves|moving|moved|capture|captures|capturing|captured|leap|leaps|jump|jumps|slide|slides|step|steps|promote|promotes|freeze|freezes|frozen|attack|attacks|may|can|must|cannot|might|would|should)\b/;

/** Odds words. Percentages are handled separately. */
const ODDS_WORDS: [RegExp, number][] = [
  [/half the time/g, 0.5],
  [/a quarter/g, 0.25],
  [/a third/g, 1 / 3],
  [/a fifth/g, 0.2],
  [/one in (?:two|2)\b/g, 0.5],
  [/one in (?:three|3)\b/g, 1 / 3],
  [/one in (?:four|4)\b/g, 0.25],
];

/** "Twelve equal segments", "equal odds each": a branch list whose odds are
 *  stated only as a total. Enumerating those branches from prose is guesswork,
 *  so the card is refused outright and printed in the unparsed list. */
const AMBIGUOUS_ODDS =
  /\bequal (?:odds|segments|chance|chances|parts|slices)\b|\bjackpot\b|\btails\b|\bflip a coin\b|\breels?\b|\bmatch (?:all|two|none|three)\b|\bparlay\b|\bdealer\b|\bcroupier\b|\bland (?:red|black|the green)\b/;

interface OddsToken {
  at: number;
  p: number;
}

function oddsTokens(text: string): OddsToken[] {
  const out: OddsToken[] = [];
  const pct = /(\d{1,3})%/g;
  let m: RegExpExecArray | null;
  while ((m = pct.exec(text))) out.push({ at: m.index, p: Number(m[1]) / 100 });
  for (const [re, p] of ODDS_WORDS) {
    re.lastIndex = 0;
    while ((m = re.exec(text))) out.push({ at: m.index, p });
  }
  return out.sort((a, b) => a.at - b.at);
}

interface Term {
  /** The noun as it appeared, or a short label for a derived term. */
  noun: string;
  /** Pawns per unit, before any multiplier. */
  value: number;
  count: number;
  /** +1 material for the holder, -1 material the holder spends. */
  sign: number;
  permanence: number;
  conditionality: number;
  /** value x count x sign x permanence x conditionality. */
  m: number;
  /** True when the count or the value came from a table rather than the text. */
  estimated: boolean;
  note: string;
}

/** An unscored noun group parked for the next sentence's anaphor to bind to.
 *  Named rather than inlined because it is now both read from and written back
 *  into `pending`, and an anonymous shape makes that circular to infer. */
interface Pending {
  value: number;
  count: number;
  side: "self" | "opp";
  estimated: boolean;
  /** The group was introduced by an "up to N", so the cap has to survive the
   *  hop to the next sentence. */
  upTo: boolean;
}

/**
 * Hand a parked antecedent on to the next sentence unchanged.
 *
 * A copy through a function with a DECLARED return type, rather than the
 * obvious `pending = carried`: assigning the carried value straight back makes
 * the parked type depend on itself around the sentence loop, and the compiler
 * resolves that circle by narrowing both ends to `never`.
 */
const forwarded = (p: Pending): Pending => ({ ...p });

interface Parse {
  terms: Term[];
  m: number;
  estimated: boolean;
  /** Set when the card was refused rather than scored. */
  refused: string | null;
  notes: string[];
}

/** Split into sentences on strong punctuation, keeping absolute offsets so an
 *  odds token found anywhere in the description can still be matched to a term
 *  by distance. */
function sentences(text: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let at = 0;
  for (const part of text.split(/([.;:]\s+)/)) {
    if (/^[.;:]\s+$/.test(part)) {
      at += part.length;
      continue;
    }
    if (part.trim()) out.push({ text: part, at });
    at += part.length;
  }
  return out;
}

/**
 * Delay phrases with a definite end. "After your opponent's next move a rook
 * appears there" is one clause, and blanking the whole of it loses the rook;
 * blanking exactly the delay leaves the effect standing.
 */
const DELAY_PHRASE = [
  /^(?:and |then |but )?(?:after|before|once|when)\s+(?:your |their |the )?opponent'?s?\s+(?:next\s+)?(?:move|reply|turn|moves|replies)\b/,
  /^(?:and |then |but )?after\s+(?:your|their)\s+next\s+\d+\s+turns?\b/,
  /^(?:and |then |but )?in\s+\d+\s+of\s+(?:your|their)\s+turns\b/,
  /^(?:and |then |but )?after\s+(?:your|their)\s+opponent\s+replies\b/,
];

/**
 * Blank out the subordinate clauses of a sentence, preserving offsets so the
 * odds and the mention positions still line up with the original text.
 *
 * A sentence with several clauses can afford to lose a whole subordinate one.
 * A sentence with only one cannot, because then the effect and its timing are
 * the same clause and blanking it throws away the card.
 */
function effectText(sentence: string): string {
  const parts = sentence.split(/(,\s+)/);
  const clauses = parts.filter((p) => !/^,\s+$/.test(p) && p.trim());
  if (clauses.length <= 1) {
    const lower = sentence.toLowerCase();
    for (const re of DELAY_PHRASE) {
      const m = re.exec(lower);
      if (m) return " ".repeat(m[0].length) + sentence.slice(m[0].length);
    }
    return sentence;
  }
  let out = "";
  for (const p of parts) {
    if (/^,\s+$/.test(p)) {
      out += p;
      continue;
    }
    out += TRIGGER_OPENER.test(p.trim().toLowerCase()) ? " ".repeat(p.length) : p;
  }
  return out;
}

type Link = "and" | "or" | null;

/**
 * Is the gap between two adjacent mentions just list punctuation?
 *
 * Returns which kind of list it is, because the two kinds mean opposite
 * things. "a knight AND a bishop return" is six points of material; "a knight
 * OR a bishop returns" is one piece and the card does not say which, so it is
 * priced at the cheaper one.
 */
function listLink(gap: string): Link {
  if (
    !/^[\s,]*(?:\([^)]*\))?[\s,]*(?:or|and|nor|each|either|any)?[\s,]*(?:\([^)]*\))?[\s,]*(?:a|an|one|two|three|\d+)?\s*(?:new |fresh |spare |extra |smaller |random |captured |fallen |best |your |their |of your |of their |own )*$/.test(
      gap,
    )
  ) {
    return null;
  }
  return /\b(?:or|nor|either|each|any)\b/.test(gap) ? "or" : "and";
}

/**
 * The piece GOES AWAY again, which is what turns a duration into a lease.
 *
 * The departure verb is reached by "then" OR by "and": "a rook appears there
 * and vanishes after 4 of your turns" is the same four-turn lease as "then
 * vanishes", and reading only the "then" form priced Phantom Rook's four-turn
 * rook as a permanent one. "rides off" is here for the same reason (Mercenary
 * Queen: a three-turn queen who "rides off with her pay" was scored at a whole
 * permanent queen, two rungs above what the card does).
 */
const EXPIRY =
  /\b((?:then|and) (?:leaves|fades|dissolves|drifts|scampers|winds down|returns|walks back|vanishes|disappears|expires|rides back|rides off|goes home)|leaves? the board after|drift away|fades? (?:away|back)|winds down|scampers back|crumbles? to dust|honks? off|turns? to dust|is dismissed)\b/;

const DURATION =
  /\b(?:for |after |works |lasts? |fights for )?(?:your |their |its |his |her )?(?:opponent's )?(?:next )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:of (?:your|their|its) )?turns?\b/;

const POCKET =
  /\b(pocket|reserves|ready to (?:be )?drop|to be dropped|drop(?:ped)? (?:it|them) onto|spend a later turn to drop|airlifted)\b/;

function durationIn(text: string): number | null {
  const m = DURATION.exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : COUNT_WORDS[m[1]];
  return Number.isFinite(n) ? n : null;
}

/**
 * How long the material stays.
 *
 * A duration only shortens a piece's life when the card also says the piece
 * GOES AWAY. Without that guard `bn4_field_hospital` ("Return one of your
 * captured pawns... it cannot be captured for your opponent's next 2 turns")
 * reads its shield window as the pawn's lifespan and prices a permanent pawn
 * at 0.2, which is the opposite of what the card does.
 */
function permanenceFor(sentence: string, whole: string): { v: number; note: string } {
  let v = 1;
  let note = "permanent";
  const expirySentence = EXPIRY.test(sentence)
    ? sentence
    : (sentences(whole).find((s) => EXPIRY.test(s.text.toLowerCase()))?.text ?? null);
  if (expirySentence) {
    const n = durationIn(expirySentence.toLowerCase()) ?? durationIn(sentence.toLowerCase());
    if (n != null) {
      v = Math.min(1, n / 10);
      note = `temporary ${n} turns`;
    }
  }
  if ((POCKET.test(sentence) || POCKET.test(whole)) && 0.95 < v) {
    v = 0.95;
    note = "pocket";
  }
  return { v, note };
}

const CAPTURE_GATE = [
  /\bthe (?:first|next) (?:\d+ |one |two |three |four |five )?times?\b[^.]{0,70}captur/,
  /\bthe first time\b[^.]{0,70}captur/,
  /\bwhen(?:ever)?\b[^.]{0,60}(?:is|are) captured\b/,
  /\bwhen(?:ever)?\b[^.]{0,40}captur\w+\b/,
  /\byour next capture\b/,
  // "YOUR NEXT THREE CAPTURES each detonate..." (`total_atomic`,
  // `detonation_field`, `we_ball_lightning`): the whole payout waits on the
  // holder making a capture, which is the same gate the singular form names.
  /\b(?:each of )?your next (?:\d+|one|two|three|four|five) captures\b/,
  /\beach time (?:you|they|your opponent)\b[^.]{0,40}captur/,
  /\bthe next \d+ (?:enemy )?\w+ you capture\b/,
  /\bif you capture\b/,
  /\bafter (?:you|your \w+) captur/,
];

const STATE_GATE = [
  /\bonly if\b/,
  /\bif (?:that|the|its|this|their|your|his|her) \w+ is still (?:empty|free|there|standing)\b/,
  /\bif one is free\b/,
  /\bif (?:there is|it has) (?:room|space)\b/,
  /\bwhile there is room\b/,
  /\bif (?:you|they|your opponent) (?:have|has|hold)\b/,
  /\bif (?:they|you) have no\b/,
  /\bwhere your opponent outnumbers\b/,
  /\bnumber (?:\d+|one|two|three|four|five) or fewer\b/,
  /\bonly when\b/,
  /\bif able\b/,
  /\bif possible\b/,
  /\bhas no (?:minor|rook|bishop|knight|queen)\b/,
  /\bif (?:it|they) (?:is|are) still\b/,
  /\bmust first\b/,
  /\bthat (?:have|has) reached\b/,
  /\bon (?:your|their|the) (?:fourth|4th|fifth|5th|sixth|6th|seventh|7th) rank\b/,
];

function conditionalityFor(whole: string): { v: number; note: string } {
  if (STATE_GATE.some((re) => re.test(whole))) return { v: 0.65, note: "board-state gate" };
  if (CAPTURE_GATE.some((re) => re.test(whole))) return { v: 0.8, note: "capture gate" };
  return { v: 1, note: "unconditional" };
}

/**
 * How many pieces a quantifier in `before` definitely names.
 *
 * Only a stated number counts: "up to three", "every", "all" and "each" all
 * return 1, because a transform priced off a hedge or a board-wide sweep would
 * be a guess, and this model's rule is to take the low reading where the text
 * does not force one.
 */
function definiteCount(before: string): number {
  const q = QUANT.exec(before);
  if (!q) return 1;
  const token = q[1];
  if (/^up to /.test(token)) return 1;
  const n = /^\d+$/.test(token) ? Number(token) : COUNT_WORDS[token];
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/**
 * "the next 3 of your pieces that are captured each return" pays out 3 times.
 *
 * "Your next three captures EACH detonate" is the same claim in the second
 * person, and the engines agree: `total_atomic` and `detonation_field` both
 * open with `inst.state.charges = 3` and spend one per capture. Scoring one
 * blast for a card that buys three was a third of the card.
 */
const REPEAT = [
  /\bthe (?:next|first) (\d+|two|three|four|five)\s+(?:times|of your|of their)\b/,
  /\b(?:each of )?your next (\d+|two|three|four|five) captures\b/,
];

function repeatFor(whole: string): number {
  for (const re of REPEAT) {
    const m = re.exec(whole);
    if (!m) continue;
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : COUNT_WORDS[m[1]];
    if (Number.isFinite(n) && n > 1) return n;
  }
  return 1;
}

/**
 * "One of your knights or bishops is reforged into a rook."
 *
 * A transform is a NET change, not two events. Scoring the source and the
 * target separately turned Ironwright's Bargain (a minor becomes a rook, for
 * the price of a pawn) into eight points of new material instead of two.
 *
 * "become" joins "into", "as" and "to" as a bridge, because half the library
 * writes the same event with no preposition at all: "any two of your pieces,
 * king aside, BECOME QUEENS" (`reality_warp`) and "one of your knights,
 * bishops or rooks BECOMES A QUEEN" (`bw2_alchemists_trade`) are the identical
 * shape to "is reforged into a rook", and both scored nothing.
 */
const TRANSFORM = new RegExp(
  `\\b(${NOUN_SRC})\\b[^.]{0,24}?\\b(?:is|are|becomes?|turns?|grows?|reshapes?|sheds? its \\w+ and becomes?)?\\s*` +
    `(?:reforged|remade|transformed|reborn|refit|upgraded|promoted|knighted)?\\s*(?:into|as|to|becomes?|become)\\s+` +
    `(?:a |an )?(${NOUN_SRC})\\b`,
  "g",
);

/** Promotion is material: a pawn that becomes a queen is worth eight more
 *  pawns than it was. Only a GRANT counts, and only the holder's own. */
const PROMOTION_VERB =
  /\b(?:promotes?|promoted|promote|knighted|is crowned|are crowned)\b/;
const PROMOTION_DENIED =
  /\b(?:cannot|can(?:no|')t|may not|must not|never|no longer|only)\s+promot|\bpromotions? (?:is|are) (?:forbidden|blocked|denied|barred)\b|\bheld back\b|\barrives? (?:exhausted|as a)\b/;

function promotionTerms(effWhole: string, kind: string): Term[] {
  if (kind === "nerf") return []; // a handicap never hands its owner a crown
  const m = PROMOTION_VERB.exec(effWhole);
  if (!m) return [];
  if (PROMOTION_DENIED.test(effWhole)) return [];
  const subject = effWhole
    .slice(Math.max(0, m.index - 60), m.index)
    .replace(/(?:after |before )?your opponent'?s? (?:next )?(?:move|turn|reply|replies)/g, " ");
  if (!SELF_WORDS.test(effWhole.slice(Math.max(0, m.index - 70), m.index + 70))) return [];
  if (/\b(?:they|their|opponent|enemy)\b/.test(subject)) return [];
  // Something has to be BEING promoted. "Reaching your last rank this way
  // promotes to a queen" is the ordinary rule restated for an unusual capture,
  // not a card that hands out a crown, and it was pricing a tier 1 en passant
  // card at eight points.
  const around = effWhole.slice(Math.max(0, m.index - 40), m.index + 45);
  if (!/\b(?:pawns?|it)\b/.test(around)) return [];
  // The target may be plural. "All pawns on your 5th rank or beyond promote to
  // knights" named its target perfectly clearly, and a singular-only pattern
  // missed it, fell through to the queen default, and priced a board of
  // knights at four queens.
  const target =
    /\b(?:to|into|becomes?|becoming|crowned|knighted as) (?:a |an )?(queen|rook|bishop|knight)s?\b/.exec(
      effWhole,
    );
  // An UNSTATED target is priced at the cheapest promotion the game allows, not
  // at a queen. Heir Apparent promotes "into that same kind of piece" as the
  // minor that was just captured, and the queen default read a minor's worth of
  // upgrade as eight points and demanded two rungs for it. The whole parser
  // under-counts where the reading is not forced, and a FLOOR especially must.
  const key = target ? nounKey(target[1]) : "n";
  const gained = PIECE_VALUE[key] - PIECE_VALUE.p;
  const countM = /\b(two|three|four|all|every|each) (?:of your )?pawns?\b/.exec(effWhole);
  let count = 1;
  let estimated = !target;
  if (countM) {
    const word = countM[1];
    if (COUNT_WORDS[word]) count = COUNT_WORDS[word];
    else {
      // "All pawns on your 5th rank or beyond promote": a board-wide promotion
      // is bounded by the pawns that are actually far enough up the board, and
      // that is two of the eight, not all of them.
      count = /\b(?:fifth|5th|sixth|6th|seventh|7th) rank\b/.test(effWhole) ? 2 : BOARD_WIDE.p;
      estimated = true;
    }
  }
  return [
    {
      noun: `promotion to ${target ? target[1] : "a minor"}`,
      value: gained,
      count,
      sign: 1,
      permanence: 1,
      conditionality: 1,
      m: gained * count,
      estimated,
      note: target ? "promotion" : "promotion (target unstated, priced at a minor)",
    },
  ];
}

interface Mention {
  word: string;
  at: number;
  verdict: 1 | -1 | 0;
  value: number;
  count: number;
  estimated: boolean;
  side: "self" | "opp";
  note: string;
  group: number;
}

function parseCard(description: string, kind: string): Parse {
  const whole = description.toLowerCase();
  const notes: string[] = [];
  if (AMBIGUOUS_ODDS.test(whole) && !/\d%/.test(whole)) {
    return { terms: [], m: 0, estimated: false, refused: "branch odds stated only in total", notes };
  }
  const cond = conditionalityFor(whole);
  const repeat = repeatFor(whole);
  const odds = oddsTokens(whole);
  const terms: Term[] = [];
  let estimated = false;
  /** A nerf is a handicap, so its material flows the other way: a nerf that
   *  costs its holder a bishop is three points of SEVERITY, and its tier means
   *  how bad the handicap is. Flipping the sign here is what lets one ladder
   *  price both pools. */
  const bias = kind === "nerf" ? -1 : 1;
  let effWhole = "";
  /** What a bare "copy" or "twin" is worth: the last real piece named. */
  let lastPieceValue = GENERIC_PIECE;
  /** "promote one of your pawns to a queen" is ONE event. Scored as a transform
   *  and again as a promotion it was two, and Blood Pact came out at sixteen
   *  points, more material than the card has pawns to spend. */
  let sawTransform = false;
  /**
   * The last sentence's unscored noun group, kept so the NEXT sentence can
   * resolve a pronoun against it. "Carve one unmoved enemy pawn... It is
   * removed." puts the piece in one sentence and the verb in the other, and
   * without this the parser sees a noun with no verb followed by a verb with
   * no noun, and scores nothing.
   *
   * It expires after exactly one sentence. An antecedent two sentences back is
   * not an antecedent: Golden Touch names two enemy pieces, then says of a
   * DIFFERENT piece a sentence later that "it is lost", and a pending that
   * survived the gap bound the wrong pronoun to the right noun and scored the
   * card off a coincidence. Better to leave the card in the UNPARSED list.
   *
   * `upTo` travels with it for the same reason the collapsed or-list carries
   * its cap into `emit`: "Mark UP TO three enemy knights, bishops, or pawns"
   * and "Mark two enemy pieces" are not the same claim, and a pending that
   * dropped the cap charged `lightning_strike` for three certain pawns.
   */
  let pending: Pending | null = null;

  for (const s of sentences(description)) {
    // Whatever the PREVIOUS sentence parked; anything parked below is for the
    // next one round only.
    const carried: Pending | null = pending;
    pending = null;
    /** How many terms stood before this sentence, so "this sentence scored
     *  nothing" can be asked of the clause-level branches below as well as of
     *  the group loop. */
    const termsBefore = terms.length;
    const raw = s.text.toLowerCase();
    const eff = effectText(raw);
    effWhole += `${eff} `;
    const perm = permanenceFor(raw, whole);

    const mentions: Mention[] = [];
    MENTION.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = MENTION.exec(eff))) {
      mentions.push({
        word: mm[0],
        at: mm.index,
        verdict: 0,
        value: nounValue(mm[0]),
        count: 1,
        estimated: false,
        side: "self",
        note: "",
        group: -1,
      });
    }
    COPY_MENTION.lastIndex = 0;
    while ((mm = COPY_MENTION.exec(eff))) {
      mentions.push({
        word: mm[0],
        at: mm.index,
        verdict: 0,
        value: lastPieceValue,
        count: 1,
        estimated: lastPieceValue === GENERIC_PIECE,
        side: "self",
        note: "copy of the named piece",
        group: -1,
      });
    }
    mentions.sort((a, b) => a.at - b.at);
    for (const men of mentions) {
      if (!/^(?:copy|copies|twin|twins|duplicate|double)$/.test(men.word)) lastPieceValue = men.value;
    }

    // A parenthetical GLOSS explains the noun in front of it. "your best
    // captured minor (a bishop, or else a knight)" is one piece, and reading it
    // as three priced Relief Column at fourteen points instead of eight.
    const consumed = new Set<number>();
    for (const paren of eff.matchAll(/\(([^)]*)\)/g)) {
      const from = paren.index ?? 0;
      const to = from + paren[0].length;
      if (!mentions.some((x) => x.at < from)) continue;
      for (const men of mentions) if (men.at > from && men.at < to) consumed.add(men.at);
    }

    // Drop the transform pairs, and score them as a net change.
    TRANSFORM.lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = TRANSFORM.exec(eff))) {
      const from = mentions.find((x) => x.at === tm!.index);
      const to = mentions.find((x) => x.at === tm!.index + tm![0].length - tm![2].length);
      if (!from || !to || from === to) continue;
      consumed.add(from.at);
      consumed.add(to.at);
      sawTransform = true;
      const net = nounValue(to.word) - nounValue(from.word);
      // A transform can run more than once. "Promote TWO pawns to queens"
      // (`twin_queens`, engine `promotePawns(2, 5, "q")`) and "any TWO of your
      // pieces, king aside, become queens" (`reality_warp`) each change two
      // pieces, and pricing the pair at one was half the card. The quantifier
      // is read off the source noun by the same QUANT the mention loop uses
      // (which has not run yet at this point, so it is run here), and only a
      // DEFINITE count raises it: "up to three", "every" and "all" are exactly
      // the readings this parser is least sure of, and a floor should take the
      // low one.
      const count = definiteCount(dePlace(eff.slice(Math.max(0, from.at - 45), from.at)));
      // A net of zero is still a PARSE. Recording it keeps a knight-for-bishop
      // swap out of the unparsed list, where it would read as a coverage hole
      // instead of as the honest answer that the card moves no material.
      const m = bias * net * count * perm.v * cond.v;
      terms.push({
        noun: `${from.word} -> ${to.word}`,
        value: net,
        count,
        sign: Math.sign(net) || 1,
        permanence: perm.v,
        conditionality: cond.v,
        m,
        estimated: false,
        note: `transform / ${perm.note} / ${cond.note}`,
      });
    }

    /**
     * Mentions that turned out to be QUALIFIERS on some other noun rather than
     * pieces the card moves ("any type BELOW QUEEN", "moves like A QUEEN").
     *
     * They are tracked instead of merely skipped because a qualifier must not
     * count as a candidate ANTECEDENT either. `mass_mind_control` ("Mark two
     * enemy pieces of any type below queen. After your opponent's next move,
     * any of them still in place defect to your side") had its one real noun
     * group joined by a phantom "queen" group, the two-candidate guard fired,
     * and the sentence parked nothing for the next sentence's "them" to bind
     * to. The guard is right and stays; the second candidate was never real.
     */
    const qualifier = new Set<number>();

    for (const men of mentions) {
      if (consumed.has(men.at)) continue;
      const rawBefore = eff.slice(Math.max(0, men.at - 45), men.at);
      const before = dePlace(rawBefore);
      const after = dePlace(eff.slice(men.at + men.word.length, men.at + men.word.length + 45));
      if (QUALIFIER_LEAD.test(before) || MOVEMENT_SIMILE.test(before)) {
        qualifier.add(men.at);
        continue;
      }

      // A verb BEFORE the noun must govern it directly ("place a new pawn"),
      // so only quantifiers and adjectives may sit between the two.
      const beforeVerb = hits(GAIN, before)
        ? "gain"
        : /\bgains?\s+(?:a|an|one|two|three|four|\d+)\b/.test(before)
          ? "gain"
          : hits(DENY, before)
            ? "deny"
            : null;
      let verdict: 1 | -1 | 0 = 0;
      if (beforeVerb) {
        const lastVerbEnd = lastVerbPosition(before, beforeVerb === "gain" ? GAIN : DENY);
        const gap = lastVerbEnd == null ? before : before.slice(lastVerbEnd);
        if (GAP_ALLOWED.test(gap)) verdict = beforeVerb === "gain" ? 1 : -1;
      }
      if (verdict === 0) {
        // A verb AFTER the noun takes it as its subject ("a pawn joins your
        // pocket"), and the gap between the two is allowed to carry a little
        // scenery as long as it carries no competing verb.
        const afterVerb = hits(GAIN, after) ? "gain" : hits(DENY, after) ? "deny" : null;
        if (afterVerb) {
          const firstVerbAt = firstVerbPosition(after, afterVerb === "gain" ? GAIN : DENY);
          const gap = firstVerbAt == null ? after : after.slice(0, firstVerbAt);
          // A gap that ends in a conjunction is still the same subject, but
          // ONLY when what follows the conjunction is itself passive: "one of
          // your own pawns bursts in the mess AND IS LOST too" is a cost the
          // card charges, while "choose one of your queens AND REMOVE up to
          // four enemy pieces" is an active verb with its own object, and
          // taking the conjunction alone as license read that one as the
          // holder throwing away his own queen.
          const acrossConjunction =
            /\b(?:and|but|then)\s*$/.test(gap) &&
            /^(?:is|are|was|were)\b/.test(after.slice(firstVerbAt ?? 0).trimStart());
          const passive =
            gap.length <= 3 || /\b(?:is|are|was|were|becomes?)\b/.test(gap) || acrossConjunction;
          if (!GAP_DISQUALIFY.test(gap) && (afterVerb === "gain" || passive)) {
            verdict = afterVerb === "gain" ? 1 : -1;
          }
        }
      }
      men.verdict = verdict;

      // "your opponent's rook" contains both markers, so the enemy marker is
      // checked first. With no marker at all the default follows the verb: a
      // card that hands out material hands it to its holder, and a card that
      // removes material without saying whose is removing theirs.
      const near = before.slice(-32);
      // A sacrifice is always the holder's own, whatever the possessives say.
      // "Sacrifice one pawn to clear all pieces" names no owner, and the
      // fallback for a removal is the enemy, so the price of the card was being
      // counted as a gain.
      if (/\b(?:sacrific\w*|give up|gives up|spend|spends)\b/.test(near)) {
        men.side = "self";
      } else
      men.side = OPP_WORDS.test(near)
        ? "opp"
        : SELF_WORDS.test(near)
          ? "self"
          : men.verdict === -1
            ? "opp"
            : "self";

      const q = QUANT.exec(before);
      if (q) {
        const token = q[1];
        if (/^up to /.test(token)) {
          const n = token.slice(6);
          men.count = /^\d+$/.test(n) ? Number(n) : (COUNT_WORDS[n] ?? 1);
          men.note = "up to";
        } else if (token === "every" || token === "all" || token === "each") {
          const local =
            /\b(adjacent|beside|next to|around|within one square|in its path|on that line|on it|neighbou?rs?|(?:from|on|down|along) (?:its|that|a|the) (?:file|rank|diagonal|line))\b/.test(
              raw,
            );
          men.count = local ? LOCAL_SCOPE : (BOARD_WIDE[nounKey(men.word)] ?? BOARD_WIDE["?"]);
          men.estimated = true;
          men.note = local ? "board-wide (local scope)" : "board-wide";
        } else if (/^\d+$/.test(token)) {
          men.count = Number(token);
        } else {
          men.count = COUNT_WORDS[token] ?? 1;
        }
      }
      // New material is introduced indefinitely, or is named as a revival. A
      // bare plural is talking about pieces that are already on the board.
      if (men.verdict === 1 && !q && !REVIVAL_ADJ.test(before)) men.verdict = 0;
      // A RETURN is only material when the piece was GONE. Recall ("Return one
      // piece to any empty square in your back two ranks") repositions a piece
      // the holder still owns, and reading it as a revival invented a piece out
      // of a teleport, for Recall, Mass Recall and Minor Recall alike.
      const window = `${before}${eff.slice(men.at, men.at + men.word.length + 45)}`;
      if (
        men.verdict === 1 &&
        /\breturn/.test(window) &&
        !/\b(?:captured|fallen|lost|dead|slain|graveyard)\b|\bto the board\b/.test(raw) &&
        !hits(GAIN_WITHOUT_RETURN, window)
      ) {
        men.verdict = 0;
      }

      if (nounKey(men.word) === "?" && /\b(best|strongest|finest|highest-value|heaviest)\b/.test(before)) {
        men.value = BEST_PIECE;
        men.note = men.note ? `${men.note}, best-of` : "best-of";
      }
    }

    // Group adjacent mentions joined by list punctuation, and let a group share
    // the verb of its last member.
    let group = 0;
    const links: Link[] = [];
    for (let i = 0; i < mentions.length; i++) {
      if (i === 0) {
        mentions[i].group = group;
        continue;
      }
      const gap = eff.slice(mentions[i - 1].at + mentions[i - 1].word.length, mentions[i].at);
      const link = consumed.has(mentions[i - 1].at) || consumed.has(mentions[i].at) ? null : listLink(gap);
      if (link) {
        links[group] = links[group] === "or" ? "or" : link;
        mentions[i].group = group;
      } else {
        group++;
        mentions[i].group = group;
      }
    }

    // A PIECE-CLASS UPGRADE IN PLACE, with its subject a sentence back.
    //
    // "Choose one of your knights or bishops. After your opponent's next move,
    // it ascends: it becomes a queen where it stands." (`bn4_ascension_small`,
    // and the engine agrees: `api.setPieceType(sq, "q")`.) No body arrives —
    // the one already standing there changes class — so this is a TRANSFORM
    // whose source sits in an earlier sentence, and it is worth the DIFFERENCE
    // exactly as "one of your knights is reforged into a rook" is. Scoring the
    // queen instead would charge the card nine points for six points of work.
    //
    // The target mention is marked consumed so the group loop below cannot
    // bill for the same queen a second time.
    const upgrade = carried ? ANAPHOR_UPGRADE.exec(eff) : null;
    if (upgrade && carried) {
      const target = upgrade[1];
      const at = upgrade.index + upgrade[0].length - target.length;
      for (const men of mentions) if (men.at === at) consumed.add(men.at);
      const net = nounValue(target) - carried.value;
      const sign = carried.side === "opp" ? -1 : 1;
      const m = bias * sign * net * carried.count * perm.v * cond.v;
      if (carried.estimated) estimated = true;
      terms.push({
        noun: `(anaphor) -> ${target}`,
        value: net,
        count: carried.count,
        sign,
        permanence: perm.v,
        conditionality: cond.v,
        m,
        estimated: carried.estimated,
        note: `class upgrade in place, bound to the previous sentence / ${perm.note} / ${cond.note}`,
      });
    }

    // A CLAUSE with no noun of its own, a verb, and a pronoun subject is
    // finishing the previous sentence's thought.
    //
    // Scoped to the clause rather than to the whole sentence, because a card
    // can finish one thought and start another in the same breath. Apotheosis
    // ("Raise one of your knights, bishops, or rooks to godhood: it leaves the
    // board for a higher plane, and a queen joins your pocket") spends a minor
    // in the first clause and gains a queen in the second; the sentence-level
    // test saw the queen, refused the sentence outright, and scored the card
    // at a free queen with no cost at all. A sentence with no nouns anywhere
    // is still one clause with no nouns, so the older reading is unchanged.
    //
    // A clause whose only nouns are BACK-REFERENCES ("removes each marked
    // piece that still stands") is the same clause with the pronoun spelled
    // out, and counts too. See ANAPHOR_NOUN for why only unambiguous markers
    // qualify.
    const pronounClause =
      carried && !upgrade
        ? clausesOf(eff).find(
            (c) => (!hasNoun(c) && PRONOUN_SUBJECT.test(c)) || isAnaphoricClause(c),
          )
        : null;
    if (pronounClause && carried) {
      const cleaned = dePlace(pronounClause);
      const verb = hits(GAIN, cleaned) ? 1 : hits(DENY, cleaned) ? -1 : 0;
      if (verb !== 0) {
        const loaned =
          /\b(?:for you|to your side|to your colou?r|joins your|under your control|take control|is yours|fights? for)\b/.test(
            whole,
          );
        const sign =
          verb === 1
            ? carried.side === "opp" && !loaned
              ? -1
              : 1
            : carried.side === "opp"
              ? 1
              : -1;
        // A DEFECTION is worth TWICE the piece. Every other term in this model
        // is one-sided: a spawn adds to your army, a removal subtracts from
        // theirs, and the header says both count the same POSITIVE amount.
        // "any of them still in place defect to your side for the game"
        // (`mass_mind_control`; the engine is `api.setPieceColor(sq, api.me)`)
        // does BOTH to the same piece, so it moves two pieces' worth of
        // material across the gap between the armies.
        //
        // Confined to a piece that was the OPPONENT'S and that the card says
        // changes sides. `bw2_spoils_of_war` also says "defects", but of a
        // piece already in your own graveyard, so its `carried.side` is self
        // and it stays priced at one body.
        const defection = verb === 1 && carried.side === "opp" && loaned && DEFECTION.test(cleaned);
        const cap = carried.upTo ? 0.65 : 1;
        const c = cond.v * cap;
        const m = bias * sign * carried.value * carried.count * (defection ? 2 : 1) * perm.v * c;
        if (carried.estimated) estimated = true;
        terms.push({
          noun: "(pronoun)",
          value: carried.value,
          count: carried.count * (defection ? 2 : 1),
          sign,
          permanence: perm.v,
          conditionality: c,
          m,
          estimated: carried.estimated,
          note: [
            "bound to the previous sentence",
            carried.upTo ? "up to" : "",
            defection ? "defection, worth double" : "",
            perm.note,
            cond.note,
          ]
            .filter(Boolean)
            .join(" / "),
        });
      }
    }

    let scoredHere = 0;
    for (let g = 0; g <= group; g++) {
      const members = mentions.filter((x) => x.group === g && !consumed.has(x.at));
      if (!members.length) continue;
      const verdict = members.find((x) => x.verdict !== 0)?.verdict ?? 0;
      if (verdict === 0) continue;
      scoredHere++;
      /**
       * An "up to N" in front of a list CAPS THE WHOLE LIST, and it caps it
       * whichever conjunction the list uses.
       *
       * "up to two of your captured knights and bishops immediately return"
       * (Queen's Testament) returns TWO pieces, not two knights and a bishop,
       * and scoring the members separately bought the card a second rung it
       * had not earned. So a capped list is priced the same way an "or" list
       * is: N of the cheapest thing on it.
       */
      const capped = members.some((x) => x.note.startsWith("up to"));
      const alternatives = (links[g] === "or" || capped) && members.length > 1;

      // Odds attach per member, by nearest stated probability.
      const probOf = (men: Mention): number => {
        if (!odds.length) return 1;
        const absAt = s.at + men.at;
        let best: OddsToken | null = null;
        for (const o of odds) {
          if (Math.abs(o.at - absAt) > 80) continue;
          if (!best || Math.abs(o.at - absAt) < Math.abs(best.at - absAt)) best = o;
        }
        return best ? best.p : 1;
      };

      const emit = (value: number, count: number, men: Mention, note: string, prob: number): void => {
        const arrives = verdict === 1;
        // GAIN of your own piece is material for you. GAIN of an enemy piece is
        // only yours if the card says it fights for you; otherwise the card is
        // handing THEM material, which is a cost. DENY of an enemy piece is
        // worth as much as gaining one; DENY of your own is the card's price.
        const loaned = /\b(?:for you|to your side|to your colou?r|joins your|under your control|take control|is yours|fights? for)\b/.test(
          whole,
        );
        const sign = arrives ? (men.side === "opp" && !loaned ? -1 : 1) : men.side === "opp" ? 1 : -1;
        const upTo = note.startsWith("up to") ? 0.65 : 1;
        const c = cond.v * upTo * prob;
        const rep = repeat > 1 && sign > 0 ? repeat : 1;
        const m = bias * sign * value * count * rep * perm.v * c;
        if (men.estimated) estimated = true;
        terms.push({
          noun: men.word,
          value,
          count: count * rep,
          sign,
          permanence: perm.v,
          conditionality: c,
          m,
          estimated: men.estimated,
          note: [note, prob !== 1 ? `${Math.round(prob * 100)}% branch` : "", perm.note, cond.note]
            .filter(Boolean)
            .join(" / "),
        });
      };

      if (!alternatives) {
        for (const men of members) emit(men.value, men.count, men, men.note, probOf(men));
        continue;
      }
      // "a pawn (half the time), a knight (a quarter), or a bishop (a quarter)"
      // is ONE piece. With odds on every branch that is an expectation; without
      // them the card does not say which, so it is priced at the cheapest.
      const probs = members.map(probOf);
      const head = members.reduce((a, b) => (a.value <= b.value ? a : b));
      const count = Math.max(...members.map((x) => x.count));
      // The cap has to be carried into the collapsed term, or it is lost: emit
      // reads it back off the front of the note. Last Reserves ("up to two of
      // your captured knights or bishops return") was scored at two full
      // minors with no discount for the "up to" at all.
      const cap = capped ? "up to, " : "";
      if (probs.every((p) => p !== 1)) {
        const ev = members.reduce((acc, men, i) => acc + men.value * probs[i], 0);
        emit(ev, count, head, `${cap}${members.length}-way odds`, 1);
      } else {
        emit(head.value, count, head, `${cap}${members.length}-way choice, priced at the cheapest`, 1);
      }
    }

    // Park an unscored noun group for the NEXT sentence's pronoun, and for
    // that sentence only (pending was cleared at the top of this loop). Only
    // when the sentence has exactly one group and scored nothing, so a card
    // with two candidate antecedents never guesses between them. Qualifiers
    // ("of any type below queen") are not candidates and are left out of the
    // count, or the guard fires on a group that names no piece.
    const live = mentions.filter((x) => !consumed.has(x.at) && !qualifier.has(x.at));
    const unscored = [...new Set(live.map((x) => x.group))];
    if (!scoredHere && unscored.length === 1) {
      const members = live.filter((x) => x.group === unscored[0]);
      const head = members.reduce((a, b) => (a.value <= b.value ? a : b));
      pending = {
        value: head.value,
        count: Math.max(...members.map((x) => x.count)),
        side: head.side,
        estimated: head.estimated,
        upTo: members.some((x) => x.note.startsWith("up to")),
      };
    } else if (
      // A sentence that does nothing but RE-NAME the antecedent hands it on.
      // `bn4_ascension_small` reads "Choose one of your knights or bishops.
      // After your opponent's next move, it ascends: it becomes a queen where
      // it stands." The middle sentence resolves the pronoun and scores
      // nothing, because "ascends" is not a verb this model bills for, and
      // dropping the antecedent there left the upgrade in the third sentence
      // with nothing to subtract.
      //
      // The one-sentence expiry is otherwise untouched, and this is why Golden
      // Touch still refuses: forwarding needs a sentence with NO noun of its
      // own, nothing scored, and a pronoun standing in the antecedent's place.
      // "The price of greed" names no piece but has no pronoun either, so it
      // still consumes the pending and the "it is lost" a sentence later still
      // has nothing to bind to.
      carried &&
      !scoredHere &&
      !live.length &&
      terms.length === termsBefore &&
      PRONOUN_SUBJECT.test(eff)
    ) {
      pending = forwarded(carried);
    }
  }

  for (const t of sawTransform ? [] : promotionTerms(effWhole, kind)) {
    const perm = permanenceFor(whole, whole);
    t.permanence = perm.v;
    t.conditionality = cond.v;
    t.m = bias * t.value * t.count * perm.v * cond.v;
    if (t.estimated) estimated = true;
    terms.push(t);
  }

  // --- Two post-passes, each retiring a KNOWN_MISREAD hold-out ------------

  // 1. A REPLACEMENT is a transform written the long way round.
  //
  // "Send one of your knights or bishops across to the other side, and one of
  // your captured rooks returns IN ITS PLACE" (`seance`) is worth the
  // DIFFERENCE, 5 - 3, not the rook. The parser read the minor as scenery
  // because "send across to the other side" is not a verb it bills for, and
  // charged the full rook.
  //
  // Deliberately narrow: it fires only when the replacement phrase is present,
  // exactly one term was scored, and the sentence carrying that phrase names a
  // second, CHEAPER piece that nothing scored. Two candidate antecedents and
  // it does nothing, on the same principle as the `pending` logic above: a
  // card with an ambiguous referent should be held out, not guessed at.
  if (REPLACEMENT.test(whole) && terms.length === 1 && terms[0].sign > 0) {
    const sentence = sentences(whole).find((x) => REPLACEMENT.test(x.text.toLowerCase()));
    if (sentence) {
      const spent = [...sentence.text.toLowerCase().matchAll(NOUN_SCAN)]
        .map((mm) => ({ word: mm[1], value: nounValue(mm[1]) }))
        .filter((x) => x.value > 0 && x.value < terms[0].value);
      const cheapest = spent.length
        ? spent.reduce((a, b) => (a.value <= b.value ? a : b))
        : null;
      if (cheapest && new Set(spent.map((x) => x.value)).size === 1) {
        const t = terms[0];
        terms.push({
          noun: cheapest.word,
          value: cheapest.value,
          count: 1,
          sign: -1,
          permanence: t.permanence,
          conditionality: t.conditionality,
          m: -bias * cheapest.value * t.permanence * t.conditionality,
          estimated: t.estimated,
          note: "replaced, so the card is worth the difference",
        });
        notes.push(`replacement: minus the ${cheapest.word} it spends`);
      }
    }
  }

  // 2. A LATER SENTENCE RE-DESCRIBING THE SAME PIECE IS A GLOSS.
  //
  // `wc_lost_and_found` says "a captured piece other than the queen will
  // return" and then "The heaviest lost piece comes back first". That is one
  // piece described twice, and the parser scored both (2.6 + 3.25). The engine
  // revives exactly one: `['r','b','n','p'].find(revivable)`.
  //
  // The tell is that one of the two carries `best-of`, which is the parser's
  // own mark for "this sentence tells me WHICH one", i.e. it is a refinement
  // of an earlier claim rather than a second claim. So when two terms share a
  // noun, a count and a sign and one is a best-of, the best-of wins and the
  // generic one goes.
  const bestOf = terms.filter((t) => t.note.includes("best-of"));
  for (const b of bestOf) {
    const dupe = terms.find(
      (t) => t !== b && !t.note.includes("best-of") && t.noun === b.noun && t.count === b.count && t.sign === b.sign,
    );
    if (dupe) {
      terms.splice(terms.indexOf(dupe), 1);
      notes.push(`gloss: "${dupe.noun}" described twice, scored once`);
    }
  }

  if (repeat > 1) notes.push(`repeats ${repeat}x`);
  if (cond.v !== 1) notes.push(cond.note);
  const m = terms.reduce((s, t) => s + t.m, 0);
  return { terms, m, estimated, refused: null, notes };
}

/** End offset of the LAST verb match in `text`, so the gap to the noun can be
 *  measured from the verb rather than from the start of the window. */
function lastVerbPosition(text: string, set: RegExp[]): number | null {
  let best: number | null = null;
  for (const re of set) {
    const g = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text))) {
      const end = m.index + m[0].length;
      if (best == null || end > best) best = end;
    }
  }
  return best;
}

/** Start offset of the FIRST verb match in `text`. */
function firstVerbPosition(text: string, set: RegExp[]): number | null {
  let best: number | null = null;
  for (const re of set) {
    const m = re.exec(text);
    if (m && (best == null || m.index < best)) best = m.index;
  }
  return best;
}

// ---------------------------------------------------------------------------
// The library, and the measured rows
// ---------------------------------------------------------------------------

interface RegistryCard {
  id: string;
  name: string;
  kind: string;
  category: string;
  effectCategory: string;
  tier: number;
  mechanic: string;
  description: string;
}

interface WinRow {
  id: string;
  tier: number;
  delta: number;
  stderr: number;
  firedPairs: number;
  category: string;
}

/**
 * Every sweep output in docs/, newest file wins on a collision.
 *
 * Deliberately laxer than report-card-winrate.ts, which refuses to merge runs
 * with different settings. Here the rows are a REGRESSION SAMPLE, not a per
 * card verdict: a card measured at 10 paired games and one measured at 12 are
 * both honest estimates of the same quantity, and dropping either would throw
 * away sample for no gain in the fit. The shard files are also being written
 * while this runs, so a partial file is normal and is read as far as it goes.
 */
function loadWinRows(): { rows: WinRow[]; files: string[] } {
  const files = fs
    .readdirSync(DOCS)
    .filter((f) => /^card-winrate[.\w-]*\.json$/.test(f))
    .sort();
  const byId = new Map<string, WinRow>();
  const used: string[] = [];
  for (const f of files) {
    let parsed: { rows?: WinRow[] };
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(DOCS, f), "utf8")) as { rows?: WinRow[] };
    } catch {
      continue; // a shard caught mid-write
    }
    if (!parsed.rows?.length) continue;
    used.push(`${f} (${parsed.rows.length})`);
    for (const r of parsed.rows) byId.set(r.id, r);
  }
  return { rows: [...byId.values()], files: used };
}

interface Fit {
  a: number;
  b: number;
  r2: number;
  n: number;
}

/**
 * The measured power of each rung, made monotone.
 *
 * This is the ladder's own claim about itself, checked: the mean win-rate
 * delta of the fired cards priced at each tier. It is a far more robust
 * statement than the slope of a line through the same points, because it makes
 * no assumption that the rungs are evenly spaced (they are not) and it is not
 * dragged around by the saturation at the top, where a +50-point card and a
 * +59-point card are both simply "winning".
 *
 * The running maximum is applied because a FLOOR has to be monotone: if tier 5
 * happens to measure below tier 4 in this sample, a card worth tier 4's power
 * still cannot be allowed to fall through to a cheaper rung.
 */
function powerByTier(rows: { tier: number; delta: number; w: number }[]): (number | null)[] {
  const out: (number | null)[] = new Array(11).fill(null);
  for (let t = 1; t <= 10; t++) {
    const at = rows.filter((r) => r.tier === t);
    if (at.length < 4) continue;
    const wsum = at.reduce((s, r) => s + r.w, 0);
    out[t] = at.reduce((s, r) => s + r.w * r.delta, 0) / wsum;
  }
  let run = -Infinity;
  for (let t = 1; t <= 10; t++) {
    if (out[t] == null) continue;
    run = Math.max(run, out[t] as number);
    out[t] = run;
  }
  return out;
}

/** The buckets the material curve is measured in. Boundaries sit on the piece
 *  values themselves (a pawn, a minor, a rook, a queen) so a bucket means
 *  something a designer can name. */
const M_BUCKETS: { lo: number; hi: number; label: string }[] = [
  { lo: 0, hi: 0.0001, label: "no material" },
  { lo: 0.0001, hi: 1.5, label: "up to a pawn" },
  { lo: 1.5, hi: 2.5, label: "a pawn to a minor" },
  { lo: 2.5, hi: 4.5, label: "a minor" },
  { lo: 4.5, hi: 6.5, label: "a rook" },
  { lo: 6.5, hi: 8.5, label: "a rook and a minor" },
  { lo: 8.5, hi: 1e9, label: "a queen or more" },
];

interface JointFit {
  a: number;
  /** Win-rate points bought by one tier, holding material fixed. */
  bTier: number;
  /** Win-rate points bought by one pawn of material, holding tier fixed. */
  bM: number;
  r2: number;
  n: number;
}

/**
 * Weighted least squares on delta ~ a + bTier x tier + bM x M.
 *
 * The two SEPARATE fits below cannot be divided to get an exchange rate, and
 * the first version of this script did exactly that and got 1.1 tiers per
 * pawn, which extrapolates a queen to tier 13. The reason is population: the
 * tier slope is measured over the whole library, most of which is inert at any
 * tier, so it comes out flat; the material slope is measured over material
 * cards, almost none of which are inert. Estimating both coefficients on the
 * SAME rows, each holding the other fixed, is the comparison the ladder needs.
 *
 * Rows are weighted by 1 / (stderr^2 + 25). The floor of 25 (five win-rate
 * points) stops a card whose handful of pairs happened to agree from carrying
 * the fit on a standard error that its sample never earned.
 */
function jointFit(pts: { tier: number; m: number; y: number; w: number }[]): JointFit {
  const n = pts.length;
  if (n < 8) return { a: 0, bTier: 0, bM: 0, r2: 0, n };
  // Normal equations for [1, tier, M].
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const rhs = [0, 0, 0];
  for (const p of pts) {
    const x = [1, p.tier, p.m];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i][j] += p.w * x[i] * x[j];
      rhs[i] += p.w * x[i] * p.y;
    }
  }
  // Gaussian elimination with partial pivoting on a 3x3.
  const M = A.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return { a: 0, bTier: 0, bM: 0, r2: 0, n };
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  const [a, bTier, bM] = [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  const wSum = pts.reduce((acc, p) => acc + p.w, 0);
  const yBar = pts.reduce((acc, p) => acc + p.w * p.y, 0) / wSum;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of pts) {
    const pred = a + bTier * p.tier + bM * p.m;
    ssRes += p.w * (p.y - pred) ** 2;
    ssTot += p.w * (p.y - yBar) ** 2;
  }
  return { a, bTier, bM, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot, n };
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function linfit(pts: { x: number; y: number }[]): Fit {
  const n = pts.length;
  if (n < 3) return { a: 0, b: 0, r2: 0, n };
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { a, b, r2, n };
}

// ---------------------------------------------------------------------------
// A fixed set of hand-checked parses.
//
// The regexes are the whole model, so they get a test that runs on every
// invocation rather than a promise in a comment. Each entry is a card whose
// material a human read off the page; a mismatch prints loudly at the top of
// the report. Chosen to cover one case of each mechanism: a plain spawn, a
// pocket spawn, a leased piece, a random parcel, a capture gate, a trigger
// clause that must NOT be scored, a revival, a denial, and a self-cost trade.
// ---------------------------------------------------------------------------

const PARSE_EXPECTATIONS: { id: string; m: number; why: string }[] = [
  { id: "bn4_cathedral_choir", m: 3.0, why: "permanent unconditional bishop" },
  { id: "summon_knight", m: 3.0, why: "permanent unconditional knight" },
  { id: "wa_conjure_bishop", m: 3.0, why: "a mirror square is a placement rule, not a gate" },
  { id: "bn4_care_package", m: 1.9, why: "(0.5x1 + 0.25x3 + 0.25x3) x 0.95 pocket" },
  { id: "bodyguard", m: 2.85, why: "knight in the pocket, 3 x 0.95" },
  { id: "second_army", m: 1.9, why: "two pocket pawns, 2 x 0.95" },
  { id: "bn4_militia_call", m: 1.0, why: "one permanent pawn" },
  { id: "bn4_small_consolation", m: 1.52, why: "the rooks and queens are the TRIGGER, not the payout" },
  { id: "wa_conjure_scout", m: 0.6, why: "a knight on a two-turn lease" },
  { id: "bn4_day_laborer", m: 0.5, why: "a pawn on a five-turn lease" },
  { id: "bn4_field_stitches", m: 1.0, why: "one pawn back, permanently" },
  { id: "mass_resurrect", m: 4.0, why: "four pawns back" },
  { id: "resurrect_queen", m: 9.0, why: "a queen back" },
  {
    id: "we_conflagration",
    m: 2.0,
    why: "'two enemy pieces, each a pawn, knight, or bishop' is an OR list, so it is priced at two pawns",
  },
  { id: "bn4_old_guard", m: 6.0, why: "an AND list: a knight and a bishop both come back" },
  { id: "ctrl_z", m: 1.0, why: "an OR list of pawn, knight, bishop, priced at the pawn" },
  { id: "ov_whittle", m: 1.0, why: "the pawn is in one sentence and 'It is removed' in the next" },
  { id: "clone", m: 1.0, why: "'an exact copy' of a pawn is a pawn" },
  { id: "bn4_retraining", m: 0.0, why: "knight to bishop is a transform that nets nothing" },
  { id: "hw3_wrong_foot", m: 0.0, why: "'every piece they move must land on' is a movement rule, not a spawn" },
  { id: "bn4_field_hospital", m: 1.0, why: "the two-turn shield is not the pawn's lifespan" },
  { id: "apotheosis", m: 5.7, why: "a pocket queen (8.55) MINUS the minor it spends (2.85), not a free queen" },
  // The two round-8 parser fixes, pinned rather than held out.
  { id: "seance", m: 1.3, why: "a REPLACEMENT: the rook returns in the minor's place, so (5 - 3) x 0.65 gate" },
  { id: "wc_lost_and_found", m: 3.25, why: "a GLOSS: 'the heaviest lost piece comes back first' re-describes the one piece already scored, it is not a second body" },
  { id: "wc_sacrificial_bishop", m: 0.0, why: "a bishop fed to the volcano for a minor: the trade nets nothing" },
  { id: "promotion_storm", m: 2.6, why: "'promote to knights' names its target: two pawns to minors, not to queens" },
  { id: "bw3_heir_apparent", m: 1.6, why: "'that same kind of piece' is unstated, so it is priced at a minor" },
  { id: "ww_mercenary_queen", m: 2.7, why: "a queen who 'rides off with her pay' after 3 turns is a lease, not a queen" },
  { id: "phantom_rook", m: 2.0, why: "'appears there and vanishes after 4 of your turns' is a four-turn lease" },
  { id: "bw2_queens_testament", m: 3.12, why: "'up to two of your knights and bishops' is TWO pieces, not two and one" },
  { id: "ww_last_reserves", m: 3.9, why: "the 'up to' discount has to survive the or-list it caps" },
  { id: "wc_pinata", m: 1.6, why: "the enemy piece knocked off, less the pawn that bursts and is lost" },
  { id: "queens_apocalypse", m: 6.76, why: "the queen is the subject of 'choose', not of the 'and remove' that follows" },
  { id: "cs_roulette", m: 0.0, why: "red / black / green zero is a branch list with no odds on any branch: refused" },
  // The round-9 pass on DELAYED AND CONDITIONAL REMOVAL (backlog A14). Every
  // row below was read off the card AND out of the buff before it was pinned.
  { id: "lightning_strike", m: 1.95, why: "'each marked piece' is the anaphor 'it' wearing a noun: up to 3 marked n/b/p, priced at the pawn, 3 x 1 x 0.65" },
  { id: "mass_mind_control", m: 10.4, why: "a DEFECTION (api.setPieceColor(sq, api.me)) moves the piece across, so two enemy pieces are worth 2 x 2.6 x 2" },
  { id: "hw3_doomed_vow", m: 2.6, why: "'it is dragged off the board' a sentence after 'condemn one enemy piece': one generic piece" },
  { id: "bn4_ascension_small", m: 6.0, why: "'it becomes a queen where it stands' upgrades the minor already there (api.setPieceType(sq,'q')): 9 - 3, not 9" },
  { id: "fm_sunforge", m: 1.3, why: "the same upgrade one class down (setPieceType 'n'): (3 - 1) x 0.65 for the 5th-rank gate" },
  { id: "reality_warp", m: 12.8, why: "'any two of your pieces, king aside, become queens' is a transform written without a preposition, twice over" },
  { id: "philosophers_stone", m: 24.0, why: "transformOwn(3, ['p'], 'q'): three pawns, so three times 9 - 1" },
  { id: "twin_queens", m: 10.4, why: "promotePawns(2, 5, 'q') promotes TWO pawns; the transform count was pinned at one and lost half the card" },
  { id: "smurf_account", m: 5.0, why: "'a fresh rook drops in there' is an arrival; a permanent rook" },
  { id: "giants_maul", m: 3.0, why: "the maul removes exactly one enemy n/b/r (one api.removePiece), priced at the cheapest; the freeze is not material" },
  { id: "ov_cloud_serpent", m: 1.0, why: "'it may crush one enemy pawn' is one removePiece; the barred rank is not material" },
  { id: "ov_thunderstorm", m: 1.0, why: "3 strikes at a random square, each removing an enemy pawn if one stands there" },
  { id: "total_atomic", m: 8.11, why: "charges = 3, each blast up to two adjacent: 2.6 x 2 x 3 x 0.65 up-to x 0.8 capture gate" },
  { id: "detonation_field", m: 6.24, why: "charges = 3, one adjacent piece each: 2.6 x 3 x 0.8 capture gate" },
  { id: "we_ball_lightning", m: 4.16, why: "captureExplosion({ beside: true, charges: 2 }): the repeat has to survive, 2.6 x 2 x 0.8" },
];

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** Effect categories whose whole job is moving material. A card sitting here
 *  that this model scores at zero is a hole in the parser, and is printed. */
const MATERIAL_EFFECT_CATEGORIES = new Set([
  "instant-piece-spawn",
  "mass-army-spawn",
  "piece-revival",
  "instant-piece-removal",
  "conditional-piece-removal",
  "mass-removal",
  "piece-mind-control",
  "promotion-grant",
  "forced-sacrifice",
]);

/** The coarse authored categories that claim to be about pieces and killing. */
const MATERIAL_CATEGORIES = new Set(["pieces", "attack"]);

/**
 * Cards whose M is KNOWN to be wrong, checked against the engine rather than
 * against the card text, with what the code actually does.
 *
 * These are held out of the violation list, because a floor computed from a
 * number we know is wrong is not a finding, it is an accusation. They are
 * printed in their own section instead, so holding them out cannot be
 * mistaken for the parser having got them right. Each entry names the fix that
 * would retire it: a card leaves this list when the parser can read it, not
 * when somebody gets tired of seeing it.
 *
 * The bar for adding a row here is the engine, not an opinion: every entry
 * below cites the line of the buff that settles it.
 */
const KNOWN_MISREAD: Record<string, { real: number; why: string }> = {
  // Both original entries were retired in round 8 when the parser learned the
  // two shapes that produced them. `seance` was a REPLACEMENT ("X ... and Y
  // returns in its place"), which is a transform written the long way round
  // and worth the difference; `wc_lost_and_found` was a GLOSS (a later
  // sentence re-describing the piece an earlier one already scored). Both now
  // score their hand-checked value and are pinned in PARSE_EXPECTATIONS
  // instead, which is a stronger statement than being held out: a hold-out
  // says "we know this is wrong", a pin says "we know this is right".
  //
  // Empty is the goal state, not an oversight. A card belongs here only while
  // its M has been checked against the engine and found wrong, with the line
  // of the buff that settles it and the parser fix that would retire it.
  //
  // One row came back in round 9. Teaching TRANSFORM the bare "becomes" bridge
  // (for `reality_warp`) also let this card parse, and it parses HIGH.
  bw2_alchemists_trade: {
    real: 4,
    why:
      "The card is a TRADE and the parser can only read half of it. `api.setPieceType(up, \"q\")` raises a " +
      "knight, bishop or rook to a queen, and `api.setPieceType(down, \"p\")` drops a second officer to a pawn: " +
      "cheapest reading +6 then -2, so +4, and the parser scores the +6 alone. The price is invisible because " +
      "the second sentence spends 'another of your OFFICERS', and 'officer' is not a piece noun. Retired by " +
      "teaching NOUN_SRC the collective nouns (officer, minor already there, major already there), at which " +
      "point the REPLACEMENT post-pass should also be able to see it.",
  },
};

interface Scored {
  id: string;
  name: string;
  tier: number;
  category: string;
  effectCategory: string;
  mechanic: string;
  kind: string;
  description: string;
  m: number;
  floor: number;
  gap: number;
  estimated: boolean;
  refused: string | null;
  terms: Term[];
  notes: string[];
  delta: number | null;
  stderr: number | null;
}

function main(): void {
  const registry = JSON.parse(fs.readFileSync(path.join(DOCS, "card-registry.json"), "utf8")) as {
    cards: RegistryCard[];
  };
  const active = registry.cards.filter((c) => !isRetired(c.id));
  const { rows, files } = loadWinRows();
  const byId = new Map(rows.map((r) => [r.id, r]));

  const scored: Scored[] = active.map((c) => {
    const p = parseCard(c.description ?? "", c.kind);
    const m = Math.max(0, Number(p.m.toFixed(3)));
    const floor = floorTier(m);
    const w = byId.get(c.id);
    return {
      id: c.id,
      name: c.name,
      tier: c.tier,
      category: c.category,
      effectCategory: c.effectCategory,
      mechanic: c.mechanic,
      kind: c.kind,
      description: c.description,
      m,
      floor,
      gap: floor - c.tier,
      estimated: p.estimated,
      refused: p.refused,
      terms: p.terms,
      notes: p.notes,
      delta: w && w.firedPairs > 0 ? w.delta : null,
      stderr: w && w.firedPairs > 0 ? w.stderr : null,
    };
  });
  const byIdScored = new Map(scored.map((s) => [s.id, s]));

  console.log(
    `[material-model] ${active.length} active cards, ${scored.filter((s) => s.m > 0).length} carry material; ` +
      `win-rate rows from ${files.length ? files.join(", ") : "none found"}`,
  );

  // --- Parse self-check -----------------------------------------------------
  let parseFails = 0;
  const checkLines: string[] = [];
  for (const e of PARSE_EXPECTATIONS) {
    const s = byIdScored.get(e.id);
    if (!s) {
      parseFails++;
      checkLines.push(`  MISSING  ${e.id} (retired or renamed)`);
      continue;
    }
    const ok = Math.abs(s.m - e.m) < 0.05;
    if (!ok) parseFails++;
    if (!ok) checkLines.push(`  WRONG    ${e.id}  expected M=${e.m}, got M=${s.m}  (${e.why})`);
  }
  console.log(
    `\n=== PARSE SELF-CHECK ===\n${PARSE_EXPECTATIONS.length - parseFails}/${PARSE_EXPECTATIONS.length} ` +
      "hand-read cards match the extractor.",
  );
  for (const l of checkLines) console.log(l);

  // --- The fit --------------------------------------------------------------
  const measured = scored.filter((s) => s.delta != null);
  const tierFit = linfit(measured.map((s) => ({ x: s.tier, y: s.delta as number })));
  const withMaterial = measured.filter((s) => s.m > 0);
  const matFit = linfit(withMaterial.map((s) => ({ x: s.m, y: s.delta as number })));

  const joint = jointFit(
    measured.map((s) => ({
      tier: s.tier,
      m: s.m,
      y: s.delta as number,
      w: 1 / ((s.stderr ?? 10) ** 2 + 25),
    })),
  );

  console.log("\n=== THE FIT ===");
  console.log("  Three fits are printed, in increasing order of how much they should be trusted. The ladder is");
  console.log("  built on the third; the first two are here so the reason for that choice is on the page.");
  console.log("\n  1. two single-variable fits. They cannot be divided to get an exchange rate: the tier slope is");
  console.log("     measured over the whole library, most of which is inert at any tier, and the material slope");
  console.log("     over material cards, almost none of which are.");
  console.log(
    `    delta = ${tierFit.a.toFixed(2)} + ${tierFit.b.toFixed(2)} x tier   ` +
      `(n=${tierFit.n}, R2=${tierFit.r2.toFixed(3)}, whole measured library)`,
  );
  console.log(
    `    delta = ${matFit.a.toFixed(2)} + ${matFit.b.toFixed(2)} x M      ` +
      `(n=${matFit.n}, R2=${matFit.r2.toFixed(3)}, material cards only)`,
  );
  console.log("\n  2. both terms on the same rows, inverse-variance weighted:");
  console.log(
    `    delta = ${joint.a.toFixed(2)} + ${joint.bTier.toFixed(2)} x tier + ${joint.bM.toFixed(2)} x M   ` +
      `(n=${joint.n}, R2=${joint.r2.toFixed(3)})`,
  );
  if (joint.bTier > 0.01 && joint.bM > 0) {
    console.log(
      `    Taken at face value that is ${(joint.bM / joint.bTier).toFixed(2)} tiers per pawn, which prices a queen at ` +
        `t${(1 + (joint.bM / joint.bTier) * 9).toFixed(0)}.\n` +
        "    DO NOT USE IT. The tier coefficient collapses because tier and material are collinear in this\n" +
        "    sample and the tier signal is far smaller than the per-card error bar, so the regression hands\n" +
        "    material the credit for both. The ladder is built on the binned matching below instead, which\n" +
        "    assumes no functional form and does not divide one noisy slope by another.",
    );
  } else {
    console.log("    the joint fit has no usable slope in this sample.");
  }

  // The matching the ladder is actually built on. Two empirical curves, no
  // functional form assumed: what each RUNG measures, and what each amount of
  // MATERIAL measures. A card carrying M points of material has already earned
  // the power of the cheapest rung that measures at least as much, and that
  // rung is its floor.
  const wRows = measured.map((s) => ({
    tier: s.tier,
    m: s.m,
    delta: s.delta as number,
    w: 1 / ((s.stderr ?? 10) ** 2 + 25),
  }));
  const rung = powerByTier(wRows);
  console.log("\n  3. THE ONE THE LADDER USES. Two empirical curves, no functional form assumed.");
  console.log("\n  measured power of each rung (weighted mean delta, made monotone):");
  for (let t = 1; t <= 10; t++) {
    if (rung[t] == null) continue;
    const n = wRows.filter((r) => r.tier === t).length;
    console.log(`    t${String(t).padEnd(2)} ${(rung[t] as number) >= 0 ? "+" : ""}${(rung[t] as number).toFixed(1)}pt  (${n} cards)`);
  }
  const rungSpan = (() => {
    const present = [...Array(11).keys()].filter((t) => t >= 1 && rung[t] != null);
    if (present.length < 2) return null;
    const lo = present[0];
    const hi = present[present.length - 1];
    return {
      lo,
      hi,
      perRung: ((rung[hi] as number) - (rung[lo] as number)) / (hi - lo),
    };
  })();
  if (rungSpan) {
    console.log(
      `    one rung is worth about ${rungSpan.perRung.toFixed(2)} win-rate points ` +
        `(t${rungSpan.lo} to t${rungSpan.hi} spans ${((rung[rungSpan.hi] as number) - (rung[rungSpan.lo] as number)).toFixed(1)} points over ${rungSpan.hi - rungSpan.lo} rungs).`,
    );
  }

  const baseline = (() => {
    const at = wRows.filter((r) => r.m === 0);
    const wsum = at.reduce((s, r) => s + r.w, 0);
    return wsum ? at.reduce((s, r) => s + r.w * r.delta, 0) / wsum : 0;
  })();
  console.log(
    `\n  measured power of each amount of material, as EXCESS over the ${wRows.filter((r) => r.m === 0).length} measured cards that` +
      `\n  carry none (baseline ${baseline >= 0 ? "+" : ""}${baseline.toFixed(1)}pt). The last two columns are the point:`,
  );
  console.log("    bucket                 M range      mean   excess   rungs earned   ladder charges");
  for (const b of M_BUCKETS) {
    if (b.hi <= 0.0002) continue;
    const at = wRows.filter((r) => r.m >= b.lo && r.m < b.hi);
    const range = `${b.lo.toFixed(1)}-${b.hi > 100 ? "up " : b.hi.toFixed(1)}`.padEnd(9);
    if (at.length < 3) {
      console.log(`    ${b.label.padEnd(22)} ${range}    (${at.length} measured, too few to place)`);
      continue;
    }
    const wsum = at.reduce((s, r) => s + r.w, 0);
    const mean = at.reduce((s, r) => s + r.w * r.delta, 0) / wsum;
    const excess = mean - baseline;
    const earned = rungSpan && rungSpan.perRung > 0 ? excess / rungSpan.perRung : NaN;
    const mid = Math.max(b.lo, Math.min(b.hi - 0.01, (b.lo + Math.min(b.hi, b.lo + 4)) / 2));
    const charged = floorTier(mid) - 1;
    console.log(
      `    ${b.label.padEnd(22)} ${range} ${(mean >= 0 ? "+" : "") + mean.toFixed(1)}pt  ` +
        `${(excess >= 0 ? "+" : "") + excess.toFixed(1)}pt   ` +
        `${Number.isFinite(earned) ? earned.toFixed(1).padStart(5) : "    ?"} rungs   ` +
        `${String(charged).padStart(5)} rungs  (n=${at.length})`,
    );
  }
  console.log(
    "\n  WHAT THE DATA CAN AND CANNOT SAY. It cannot pin the exchange rate: the rungs are only about a\n" +
      "  point apart, the per-card error bar is around twelve, and the material buckets hold nine to\n" +
      "  eighteen cards each, so their ordering among themselves is noise (the pawn-to-minor bucket\n" +
      "  outmeasuring the rook bucket is a sampling accident, not a finding). What it says robustly is\n" +
      "  a DIRECTION and a BOUND: every material bucket measures above the cards that carry none, by\n" +
      "  more win rate than the ladder charges rungs for. The ladder below is therefore built on the\n" +
      "  structural anchors, and the data is used to confirm that those anchors are, if anything,\n" +
      "  still on the cheap side of what the sim measures.",
  );

  // Residuals of the joint fit: which cards the material story does NOT
  // explain. Reported because a model that only prints its own agreements is
  // not a model.
  if (joint.n >= 8) {
    const resid = measured
      .filter((s) => s.m > 0)
      .map((s) => ({ s, r: (s.delta as number) - (joint.a + joint.bTier * s.tier + joint.bM * s.m) }))
      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    const rms = Math.sqrt(resid.reduce((acc, x) => acc + x.r * x.r, 0) / Math.max(1, resid.length));
    console.log(`\n  residual RMS ${rms.toFixed(1)} win-rate points over ${resid.length} measured material cards,`);
    console.log(
      `  against a median per-card error bar of +-${median(measured.map((s) => s.stderr ?? 0)).toFixed(1)} points: ` +
        "most of the scatter is measurement, not model.",
    );
    console.log("  worst residuals (the material story does not explain these):");
    for (const x of resid.slice(0, 10)) {
      console.log(
        `    ${x.r >= 0 ? "+" : ""}${x.r.toFixed(1)}  M=${x.s.m.toFixed(2)}  t${x.s.tier}  ` +
          `${(x.s.delta as number) >= 0 ? "+" : ""}${(x.s.delta as number).toFixed(1)}pt  ${x.s.id}`,
      );
    }
  }

  // --- Violations -----------------------------------------------------------
  const violations = scored
    .filter((s) => s.gap > 0 && !KNOWN_MISREAD[s.id])
    .sort((a, b) => b.gap - a.gap || b.m - a.m);

  const misread = scored.filter((s) => KNOWN_MISREAD[s.id]);
  if (misread.length) {
    console.log(`\n=== HELD OUT: KNOWN MISREADS (${misread.length}) ===`);
    console.log("Scored, but checked against the engine and found wrong. Not accused, and not endorsed.");
    for (const s of misread) {
      const k = KNOWN_MISREAD[s.id];
      console.log(
        `  ${s.id.padEnd(22)} t${s.tier}  parser M=${s.m.toFixed(2)} (floor t${s.floor}), ` +
          `really M=${k.real.toFixed(2)} (floor t${floorTier(k.real)})`,
      );
      console.log(`    ${k.why}`);
    }
  }

  console.log(`\n=== VIOLATIONS (${violations.length}) ===`);
  console.log("Cards priced below the material they move. Worst first.");
  for (const v of violations) {
    const meas = v.delta != null ? `  [${v.delta >= 0 ? "+" : ""}${v.delta.toFixed(1)}pt +-${(v.stderr ?? 0).toFixed(1)}]` : "";
    console.log(
      `  ${v.id.padEnd(30)} ${v.name.padEnd(26)} t${v.tier} -> t${v.floor}  M=${v.m.toFixed(2)}` +
        `${v.estimated ? "*" : " "}${meas}`,
    );
  }

  console.log("\n  by size of the violation:");
  for (let g = 1; g <= 9; g++) {
    const n = violations.filter((v) => v.gap === g).length;
    if (n) console.log(`    ${String(n).padStart(4)} cards are ${g} tier${g > 1 ? "s" : ""} under their floor`);
  }
  console.log("\n  by effect category:");
  const catCount = new Map<string, number>();
  for (const v of violations) catCount.set(v.effectCategory, (catCount.get(v.effectCategory) ?? 0) + 1);
  for (const [c, n] of [...catCount].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${c}`);
  }

  // --- Coverage -------------------------------------------------------------
  //
  // Two circles, reported separately because they mean different things. The
  // inner one is the effect categories whose whole job is moving material, and
  // a zero there is a straight bug in the parser. The outer one is the coarse
  // authored categories "pieces" and "attack", which also hold shoves, swaps,
  // permissions and freezes, so a zero there is usually the honest answer.
  const inner = scored.filter((s) => MATERIAL_EFFECT_CATEGORIES.has(s.effectCategory));
  const outer = scored.filter(
    (s) => !MATERIAL_EFFECT_CATEGORIES.has(s.effectCategory) && MATERIAL_CATEGORIES.has(s.category),
  );
  // Blank means the parser produced NO TERM AT ALL. A card whose terms cancel
  // to zero (a knight traded for a bishop) was read correctly and is not a gap.
  const isBlank = (c: Scored): boolean => c.terms.length === 0;
  const innerBlank = inner.filter(isBlank);
  const outerBlank = outer.filter(isBlank);
  const refused = scored.filter((c) => c.refused);

  console.log("\n=== UNPARSED ===");
  console.log(
    `  ${innerBlank.length} of ${inner.length} cards in a MATERIAL effect category scored zero and produced no term ` +
      `(${(100 * (1 - innerBlank.length / Math.max(1, inner.length))).toFixed(0)}% coverage).`,
  );
  console.log(
    `  ${outerBlank.length} of ${outer.length} more sit in the coarse "pieces" or "attack" category without a ` +
      "material effect category;\n  most of those move no material at all, so they are counted but not listed.",
  );
  console.log(
    `  ${refused.length} cards were REFUSED outright rather than guessed at.\n` +
      "  Every line below is a hole in the model, not a finding about the card. Fix a regex or add the case",
  );
  console.log("  before trusting a floor for any of them.\n");
  for (const u of innerBlank) {
    console.log(
      `  t${u.tier} ${u.id.padEnd(30)} [${u.effectCategory}]${u.refused ? ` REFUSED (${u.refused})` : ""} ` +
        `${u.description.slice(0, 92)}`,
    );
  }
  const byCatBlank = new Map<string, number>();
  for (const u of innerBlank) byCatBlank.set(u.effectCategory, (byCatBlank.get(u.effectCategory) ?? 0) + 1);
  console.log("\n  the gap by effect category (blank / total):");
  for (const c of MATERIAL_EFFECT_CATEGORIES) {
    const tot = inner.filter((x) => x.effectCategory === c).length;
    if (!tot) continue;
    console.log(`    ${String(byCatBlank.get(c) ?? 0).padStart(4)} / ${String(tot).padEnd(4)} ${c}`);
  }
  const estimatedCards = scored.filter((c) => c.estimated && c.m > 0);
  console.log(
    `\n  ${estimatedCards.length} scored cards used an ESTIMATED count (marked * in the violation list): a ` +
      "board-wide quantifier\n  with no number in the text, an untyped piece, or a promotion with no named target.",
  );

  // --- Model versus measurement --------------------------------------------
  // The two ways this model can be wrong, both worth printing: a card the model
  // calls cheap that the sim says is strong, and a card the model calls
  // expensive that the sim says does nothing.
  const resolved = measured.filter((s) => Math.abs(s.delta as number) > 2 * (s.stderr ?? 1e9));
  const bigDelta = resolved
    .filter((s) => (s.delta as number) > 25 && s.m < 2)
    .sort((a, b) => (b.delta as number) - (a.delta as number));
  const bigM = resolved
    .filter((s) => s.m >= 4 && (s.delta as number) < 5)
    .sort((a, b) => b.m - a.m);
  console.log("\n=== MODEL VERSUS MEASUREMENT ===");
  console.log(`  strong in the sim, near-zero material here (${bigDelta.length}): the model is blind to these.`);
  for (const s of bigDelta.slice(0, 12)) {
    console.log(
      `    +${(s.delta as number).toFixed(1)}pt +-${(s.stderr ?? 0).toFixed(1)}  M=${s.m.toFixed(2)}  t${s.tier}  ${s.id}  (${s.effectCategory})`,
    );
  }
  console.log(`  heavy material, flat in the sim (${bigM.length}): the model may be over-counting these.`);
  for (const s of bigM.slice(0, 12)) {
    console.log(
      `    ${(s.delta as number) >= 0 ? "+" : ""}${(s.delta as number).toFixed(1)}pt +-${(s.stderr ?? 0).toFixed(1)}  M=${s.m.toFixed(2)}  t${s.tier}  ${s.id}  (${s.effectCategory})`,
    );
  }

  if (WRITE_JSON) {
    const out = path.join(DOCS, "material-model.json");
    fs.writeFileSync(
      out,
      `${JSON.stringify(
        {
          generated: "scripts/material-model.ts",
          pieceValues: PIECE_VALUE,
          genericPiece: GENERIC_PIECE,
          boardWide: BOARD_WIDE,
          ladder: FLOOR_LADDER,
          fit: {
            sources: files,
            tierOnly: tierFit,
            materialOnly: matFit,
            joint,
            rungPower: rung,
            materialBuckets: M_BUCKETS.map((b) => {
              const at = wRows.filter((r) => r.m >= b.lo && r.m < b.hi);
              const wsum = at.reduce((acc, r) => acc + r.w, 0);
              return {
                ...b,
                n: at.length,
                mean: wsum ? at.reduce((acc, r) => acc + r.w * r.delta, 0) / wsum : null,
              };
            }),
          },
          cards: scored.map((s) => ({
            id: s.id,
            name: s.name,
            tier: s.tier,
            floor: s.floor,
            gap: s.gap,
            m: s.m,
            estimated: s.estimated,
            category: s.category,
            effectCategory: s.effectCategory,
            mechanic: s.mechanic,
            refused: s.refused,
            delta: s.delta,
            stderr: s.stderr,
            terms: s.terms,
            notes: s.notes,
            description: s.description,
          })),
        },
        null,
        1,
      )}\n`,
    );
    console.log(`\nwrote ${out}`);
  }

  if (CHECK) {
    if (violations.length) {
      console.error(
        `\n[material-model] FAIL: ${violations.length} cards are priced below their material floor.`,
      );
      process.exit(1);
    }
    console.log("\n[material-model] ok: every card clears its material floor.");
  }
}

main();
