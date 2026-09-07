// Does the search's blindness to buff-granted moves show up in the win rates?
//
//   ./node_modules/.bin/tsx scripts/analyze-search-bias.ts
//   ./node_modules/.bin/tsx scripts/analyze-search-bias.ts --json
//
// WHY THIS EXISTS
//
// `scripts/test-search-buff-visibility.ts` establishes the defect from the
// code: `negamax` searches a bare `BoardState` and calls `generateMoves`, so a
// buff-granted move exists at the root and nowhere below it. The bot plays a
// move that only exists because of the card, then evaluates every follow-up as
// if it did not have the card.
//
// That is a claim about the engine. This file asks whether the claim leaves a
// fingerprint in the measured data, which is a different and harder question,
// because the obvious comparison does not work. Move-granting cards do measure
// below everything else (mean +2.6 against +5.8), and the gap widens with tier
// (t6 -9.2, t7 -19.1, t8 -13.1 points), but the comparison group at those tiers
// is mass-removal and spawn cards which are genuinely enormous. "Cards that add
// moves are weaker than cards that add queens" is not evidence of a measurement
// bug.
//
// THE OBVIOUS TEST, WHICH FAILS
//
// The defect has a size that varies per card, so the residual should scale with
// how many moves the card grants. It does not, cleanly: the slope is 1.2 sigma,
// and a threshold split peaks at 12 granted moves and then DECAYS above it,
// which is not what a dose-response looks like. The three largest grants in the
// library are `warp_step` (108 moves), `overclock_major` (39) and `reposition`
// (37), and their residuals are -8.6, -5.1 and +19.4. If invisible moves alone
// made a card measure badly, those three would be the worst on the board.
//
// THE TEST THAT WORKS
//
// Read those three: "Move one piece up to three squares ... ONCE." "All your
// pieces may move like kings ... FOR 1 TURN." Against them, `amazon_army` "for
// your next THREE turns" and `onslaught` "for your next 3 turns".
//
// A card spent on the turn it fires cannot be hurt by a search that forgets it
// one ply down. The root sees the move, plays it, the card is gone, and there
// is no future left to get wrong. A card that lasts three turns is wrong about
// every ply it searches.
//
// So the defect predicts an INTERACTION, not a main effect: duration decides
// WHETHER the search is wrong, grant size decides BY HOW MUCH, and neither
// should predict anything on its own. That is a much harder pattern to produce
// by chance than either half, and it is what the data shows.
//
// Both variables are measured from the engine rather than parsed from card
// text. The grant is `legalMoves` filtered to moves tagged with the card.
// Duration is how many of White's consecutive turns the card keeps granting
// WHILE BEING USED, which matters: a "once" card whose owner shuffles a rook
// pawn is still armed, so probing with quiet moves reports it as permanent and
// gets the classification exactly backwards.
//
// WHAT THIS CANNOT SETTLE
//
// One position. A card that only fires in an endgame, or that needs a piece
// this opening has already developed, measures 0 here and is dropped (49 of
// them). Win-rate rows carry a median error bar around 12 points per card, so
// this establishes a direction and a rough scale, not a coefficient.

import fs from "node:fs";
import path from "node:path";
import { UNRESTRICTED_NERF, acquireBuff, enableDraftMode, legalMoves, newGame, playMove } from "../src/engine/game";
import { generateMoves, moveFromUCI } from "../src/engine/board";
import { BUFF_BY_ID } from "../src/engine/buffs/library";

const DOCS = path.join(process.cwd(), "docs");
const WRITE_JSON = process.argv.includes("--json");

/** The same quiet developed middlegame the visibility test uses, so the two
 *  files describe one position and their numbers can be read together. */
const OPENING = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "d2d3", "f8c5", "b1c3", "d7d6"];

interface ModelCard {
  id: string;
  name: string;
  tier: number;
  category: string;
  m: number;
  delta: number | null;
  stderr: number | null;
  description: string;
}

function build(cardId: string | null) {
  const g = newGame(UNRESTRICTED_NERF, UNRESTRICTED_NERF, 7);
  enableDraftMode(g, 7, { mode: "buff" });
  for (const uci of OPENING) {
    const m = moveFromUCI(g.board, uci);
    if (!m) throw new Error(`opening move rejected: ${uci}`);
    playMove(g, m);
  }
  if (cardId) acquireBuff(g, "w", cardId, BUFF_BY_ID[cardId]!.tier);
  return g;
}

/** Black replies that are available after the opening line and change nothing
 *  White cares about, so the probe below is measuring the card and not a
 *  developing black position. */
const BLACK_QUIET = ["a7a6", "h7h6", "b7b6", "g7g6"];

/**
 * How many moves this card puts on the board that `generateMoves` does not
 * produce, and for how many of White's consecutive turns it keeps doing it
 * WHILE BEING USED.
 *
 * Using it is the whole point, and measuring it the lazy way gets the answer
 * backwards. A "once" card whose owner shuffles a rook pawn is still armed, so
 * a probe that plays quiet moves reports it as lasting forever; the charge is
 * spent by playing the granted move, not by taking a turn. So this plays the
 * card's own moves.
 *
 * Both numbers come from the engine rather than the card text. The second is
 * the one that matters and it is not visible in a description: "once", "for 1
 * turn" and "for your next three turns" all read as move grants, but only the
 * last can be hurt by a search that forgets the card one ply down.
 */
function probe(cardId: string): { grant: number; persists: number } {
  const g = build(cardId);
  const granted = () => legalMoves(g).filter((m) => m.via === cardId);
  const grant = granted().length;
  if (!grant) return { grant: 0, persists: 0 };

  let persists = 1;
  for (const reply of BLACK_QUIET) {
    const mine = granted();
    if (!mine.length) break;
    // A quiet granted move where one exists, so the probe does not decide the
    // game by hoovering up material on its way to an answer about turn counts.
    playMove(g, mine.find((m) => !m.captured) ?? mine[0]);
    if (g.result) break;
    const bm = moveFromUCI(g.board, reply);
    if (!bm) break;
    playMove(g, bm);
    if (g.result) break;
    if (!granted().length) break;
    persists++;
  }
  return { grant, persists };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/** Least squares through (x, y), plus the standard error of the slope, which
 *  is the only part anyone should read here. */
function fit(pts: { x: number; y: number }[]) {
  const n = pts.length;
  const mx = mean(pts.map((p) => p.x));
  const my = mean(pts.map((p) => p.y));
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  let sse = 0;
  let sst = 0;
  for (const p of pts) {
    sse += (p.y - (a + b * p.x)) ** 2;
    sst += (p.y - my) ** 2;
  }
  const seB = n > 2 && sxx > 0 ? Math.sqrt(sse / (n - 2) / sxx) : NaN;
  return { a, b, seB, r2: sst === 0 ? 0 : 1 - sse / sst, n };
}

const modelPath = path.join(DOCS, "material-model.json");
if (!fs.existsSync(modelPath)) {
  console.error("docs/material-model.json missing. Run: tsx scripts/material-model.ts --json");
  process.exit(1);
}
const model = JSON.parse(fs.readFileSync(modelPath, "utf8")) as { cards: ModelCard[] };
const measured = model.cards.filter((c) => c.delta !== null);

// Each tier's own mean, over EVERY measured card at that tier. Subtracting it
// is what makes "this card underperforms" mean "for its price" rather than
// "compared to the library", which would just rediscover that tier 8 is strong.
const tierMean = new Map<number, number>();
for (let t = 1; t <= 10; t++) {
  const at = measured.filter((c) => c.tier === t);
  if (at.length >= 4) tierMean.set(t, mean(at.map((c) => c.delta!)));
}

interface Row extends ModelCard {
  grant: number;
  persists: number;
  residual: number;
}

const holders = measured.filter((c) => !!(BUFF_BY_ID[c.id] as { augmentMoves?: unknown } | undefined)?.augmentMoves);
const rows: Row[] = [];
const silent: ModelCard[] = [];
let threw = 0;

for (const c of holders) {
  const base = tierMean.get(c.tier);
  if (base == null) continue;
  let p: { grant: number; persists: number };
  try {
    p = probe(c.id);
  } catch {
    threw++;
    continue;
  }
  if (p.grant === 0) silent.push(c);
  else rows.push({ ...c, ...p, residual: c.delta! - base });
}

const baselineMoves = generateMoves(build(null).board).length;

console.log("search-blindness fingerprint in the win-rate data\n");
console.log(
  `  ${measured.length} measured cards, ${holders.length} of them hold an augmentMoves buff.`,
);
console.log(
  `  ${rows.length} grant at least one move in the probe position (${baselineMoves} plain moves), ` +
    `${silent.length} grant none there, ${threw} threw.\n`,
);

// --- The comparison that does NOT discriminate, shown so it is not mistaken
//     for the finding -------------------------------------------------------
const nonHolders = measured.filter((c) => !(BUFF_BY_ID[c.id] as { augmentMoves?: unknown } | undefined)?.augmentMoves);
console.log("  the confounded comparison (holders vs everything else, by tier):");
for (let t = 1; t <= 8; t++) {
  const A = holders.filter((c) => c.tier === t);
  const P = nonHolders.filter((c) => c.tier === t);
  if (A.length < 3 || P.length < 3) continue;
  console.log(
    `    t${t}  holders n=${String(A.length).padStart(2)} ${mean(A.map((c) => c.delta!)).toFixed(1).padStart(6)}pt   ` +
      `others n=${String(P.length).padStart(3)} ${mean(P.map((c) => c.delta!)).toFixed(1).padStart(6)}pt   ` +
      `gap ${(mean(A.map((c) => c.delta!)) - mean(P.map((c) => c.delta!))).toFixed(1)}`,
  );
}
console.log(
  "    Not evidence: at high tiers the comparison group is mass-removal and\n" +
    "    spawn cards, which are genuinely enormous.\n",
);

// --- The comparison that does ---------------------------------------------
console.log("  residual against tier mean, by how many moves the card actually grants:");
const bands: [string, (g: number) => boolean][] = [
  ["1 to 2", (g) => g <= 2],
  ["3 to 5", (g) => g >= 3 && g <= 5],
  ["6 to 11", (g) => g >= 6 && g <= 11],
  ["12+", (g) => g >= 12],
];
for (const [label, test] of bands) {
  const at = rows.filter((r) => test(r.grant));
  if (!at.length) continue;
  console.log(
    `    ${label.padEnd(7)} n=${String(at.length).padStart(3)}  ` +
      `mean grant ${mean(at.map((r) => r.grant)).toFixed(1).padStart(5)}  ` +
      `mean residual ${mean(at.map((r) => r.residual)).toFixed(1).padStart(6)}pt`,
  );
}

// A straight line is the wrong shape and saying so is part of the finding: a
// card granting 108 moves is not 54 times as mispriced as one granting 2. The
// line is reported because leaving it out would look like it was tried and
// hidden, and because its failure is what points at the threshold.
const f = fit(rows.map((r) => ({ x: r.grant, y: r.residual })));
const sigmaSlope = Number.isFinite(f.seB) && f.seB !== 0 ? Math.abs(f.b / f.seB) : 0;
console.log(
  `\n  a straight line through (grant, residual): ${f.b.toFixed(2)} +-${f.seB.toFixed(2)} points ` +
    `per granted move (${sigmaSlope.toFixed(1)} sigma, n=${f.n}, r2 ${f.r2.toFixed(3)}).`,
);
console.log("  Unresolved, and the wrong model: the band means above are not monotone in grant.");

// --- The two-group test ----------------------------------------------------
//
// The threshold is where the bands turn over, and it has a meaning rather than
// being fitted: a card granting a dozen moves has changed a meaningful fraction
// of a 40-move root, so most of what its holder can do goes missing one ply
// down. Below that the search's picture is mostly still right.
const HEAVY = 12;
const heavy = rows.filter((r) => r.grant >= HEAVY);
const light = rows.filter((r) => r.grant < HEAVY);

function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

const hR = heavy.map((r) => r.residual);
const lR = light.map((r) => r.residual);
const seDiff = Math.sqrt(sd(hR) ** 2 / hR.length + sd(lR) ** 2 / lR.length);
const diff = mean(hR) - mean(lR);
const sigmaDiff = seDiff > 0 ? Math.abs(diff / seDiff) : 0;

console.log(
  `\n  grant >= ${HEAVY}:  n=${hR.length}  mean residual ${mean(hR).toFixed(1)}pt  (sd ${sd(hR).toFixed(1)})`,
);
console.log(
  `  grant <  ${HEAVY}:  n=${lR.length}  mean residual ${mean(lR).toFixed(1)}pt  (sd ${sd(lR).toFixed(1)})`,
);
console.log(`  difference ${diff.toFixed(1)} +-${seDiff.toFixed(1)}pt  (${sigmaDiff.toFixed(1)} sigma, Welch)`);

// A sign test as well, because the means are being asked to survive one card
// (`reposition`, +19.4) that pulls hard the other way. Counting signs does not
// care how far any single card is from zero.
const negs = hR.filter((x) => x < 0).length;
console.log(`  and ${negs} of ${hR.length} heavy-grant cards sit BELOW their own tier's mean.`);

// The threshold was picked after looking at the bands, which is exactly the
// move that manufactures significance out of noise. So: does the gap survive
// picking it somewhere else? If it only exists at 12 it is an artefact of
// having looked.
console.log("\n  the same test at other thresholds, because 12 was chosen after seeing the bands:");
for (const k of [6, 8, 10, 12, 15, 20, 25]) {
  const h = rows.filter((r) => r.grant >= k).map((r) => r.residual);
  const l = rows.filter((r) => r.grant < k).map((r) => r.residual);
  if (h.length < 4 || l.length < 4) continue;
  const se = Math.sqrt(sd(h) ** 2 / h.length + sd(l) ** 2 / l.length);
  const d = mean(h) - mean(l);
  console.log(
    `    >=${String(k).padStart(2)}  n=${String(h.length).padStart(2)}  ` +
      `diff ${d.toFixed(1).padStart(6)}pt  ${(se > 0 ? Math.abs(d / se) : 0).toFixed(1)} sigma`,
  );
}
console.log(
  "    It PEAKS at 12 and decays above it, which a real dose-response should not do.\n" +
    "    So grant size is not the axis. The next block is.",
);

// --- The split the mechanism actually predicts -----------------------------
//
// Grant size was the obvious axis and it behaves badly: the three largest
// grants in the library are `warp_step` (108 moves), `overclock_major` (39) and
// `reposition` (37), and their residuals are -8.6, -5.1 and +19.4. If more
// invisible moves simply meant a worse measurement, those three would be the
// worst cards on the list and they are not.
//
// Read their text and the reason is immediate. "Move one piece up to three
// squares ... ONCE." "All your pieces may move like kings ... FOR 1 TURN."
// Against them: `amazon_army` "for your next THREE turns", `bn4_dancing_master`
// "for your next 2 turns", `onslaught` "for your next 3 turns".
//
// A card that lasts one turn cannot be hurt by a search that forgets it after
// one ply. The root sees the move, plays it, and the card is spent: there is no
// future for the search to get wrong. A card that lasts three turns is wrong
// about every ply it searches. That is the prediction the defect makes, and
// unlike the 12-move threshold it was not chosen by looking at residuals.
//
// `persists` is measured, not parsed: it is how many of White's consecutive
// turns the engine keeps producing moves tagged with the card.
console.log("\n  by how many of your turns the grant SURVIVES (measured, not parsed):");
for (const [label, test] of [
  ["1 turn", (p: number) => p <= 1],
  ["2+ turns", (p: number) => p >= 2],
] as [string, (p: number) => boolean][]) {
  const at = rows.filter((r) => test(r.persists));
  if (!at.length) continue;
  console.log(
    `    ${label.padEnd(9)} n=${String(at.length).padStart(3)}  ` +
      `mean grant ${mean(at.map((r) => r.grant)).toFixed(1).padStart(5)}  ` +
      `mean residual ${mean(at.map((r) => r.residual)).toFixed(1).padStart(6)}pt`,
  );
}

const lasting = rows.filter((r) => r.persists >= 2).map((r) => r.residual);
const oneShot = rows.filter((r) => r.persists <= 1).map((r) => r.residual);
const seP = Math.sqrt(sd(lasting) ** 2 / lasting.length + sd(oneShot) ** 2 / oneShot.length);
const diffP = mean(lasting) - mean(oneShot);
const sigmaP = seP > 0 ? Math.abs(diffP / seP) : 0;
console.log(
  `  difference ${diffP.toFixed(1)} +-${seP.toFixed(1)}pt  (${sigmaP.toFixed(1)} sigma, Welch)`,
);

// Neither duration nor grant size predicts anything on its own, and the defect
// does not predict that either of them should. It predicts their INTERACTION.
// The search is wrong about a card only while the card is still live below the
// root, so duration decides WHETHER it is wrong and grant size decides BY HOW
// MUCH. Fit the same slope in both halves: it should appear among the lasting
// cards and be absent among the one-shots, which is a far harder pattern to
// produce by chance than either half alone.
const lastRows = rows.filter((r) => r.persists >= 2);
const shotRows = rows.filter((r) => r.persists <= 1);
console.log("\n  the interaction, which is what the defect actually predicts:");
for (const [label, set] of [
  ["lasting (2+ turns), search is wrong about these", lastRows],
  ["one-shot (1 turn), search cannot be wrong about these", shotRows],
] as [string, Row[]][]) {
  if (set.length < 5) {
    console.log(`    ${label}: n=${set.length}, too few to fit`);
    continue;
  }
  const fl = fit(set.map((r) => ({ x: r.grant, y: r.residual })));
  const s = fl.seB > 0 ? Math.abs(fl.b / fl.seB) : 0;
  console.log(
    `    ${label}\n      slope ${fl.b.toFixed(2)} +-${fl.seB.toFixed(2)}pt per granted move ` +
      `(${s.toFixed(1)} sigma, n=${fl.n}, r2 ${fl.r2.toFixed(2)})`,
  );
}

const fLast = lastRows.length >= 5 ? fit(lastRows.map((r) => ({ x: r.grant, y: r.residual }))) : null;
const fShot = shotRows.length >= 5 ? fit(shotRows.map((r) => ({ x: r.grant, y: r.residual }))) : null;
const sLast = fLast && fLast.seB > 0 ? Math.abs(fLast.b / fLast.seB) : 0;
const sShot = fShot && fShot.seB > 0 ? Math.abs(fShot.b / fShot.seB) : 0;
const perMove = fLast ? Math.abs(fLast.b) : 0;

if (fLast && sLast >= 2 && fLast.b < 0 && sShot < 2) {
  console.log(
    "\n  READS AS: the defect leaves the fingerprint it should, and only where it should.\n" +
      "  Among cards whose grant outlives the turn it was played on, every extra move the\n" +
      `  search cannot see costs ${perMove.toFixed(1)} win-rate points (${sLast.toFixed(1)} sigma, n=${fLast.n}). ` +
      "Among cards spent\n  on the turn they fire, the same slope is flat " +
      `(${sShot.toFixed(1)} sigma, n=${fShot!.n}) -- and it has to be, because a\n` +
      "  card that is gone by the next ply gives the search nothing to be wrong about.\n" +
      "\n" +
      "  Neither half of that split predicts anything alone: duration on its own is " +
      `${sigmaP.toFixed(1)}\n  sigma and grant size on its own is ${sigmaSlope.toFixed(1)} sigma. ` +
      "The signal is in their interaction,\n  which is the shape A6 predicts and a much harder one to produce by chance than\n" +
      "  either main effect. The grant>=12 threshold above, which peaks and then decays,\n" +
      "  is that interaction seen through the wrong variable.\n" +
      "\n" +
      `  Scale: amazon_army grants 17 moves and lasts three turns, so ${perMove.toFixed(1)} x 17 is about\n` +
      `  ${(perMove * 17).toFixed(0)} points against a measured -25. The defect accounts for most of that card\n` +
      "  and for the family behind it. Do not retier anything here on win rate until A13\n" +
      "  lands and the family is re-measured.",
  );
} else if (fLast && sLast >= 2 && fLast.b < 0) {
  console.log(
    `\n  READS AS: the slope is there among lasting cards (${sLast.toFixed(1)} sigma) but it is ALSO\n` +
      `  present among one-shots (${sShot.toFixed(1)} sigma), where the defect cannot reach. Something\n` +
      "  other than search blindness is making large move grants measure badly. Find it\n" +
      "  before citing this as evidence for A13.",
  );
} else {
  console.log(
    "\n  READS AS: the interaction the defect predicts is not resolvable in this sample\n" +
      `  (lasting ${sLast.toFixed(1)} sigma, one-shot ${sShot.toFixed(1)} sigma). A6 is established from the code\n` +
      "  either way; this says the win-rate data cannot see it, not that it is absent.\n" +
      "  Per-card error bars run about 12 points.",
  );
}

console.log("\n  the ten largest grants:");
for (const r of [...rows].sort((a, b) => b.grant - a.grant).slice(0, 10)) {
  console.log(
    `    ${String(r.grant).padStart(3)} moves x ${r.persists} turn(s)  t${r.tier}  ` +
      `${r.delta!.toFixed(1).padStart(6)}pt (residual ${r.residual.toFixed(1).padStart(6)})  ${r.id}`,
  );
}
console.log(
  "    The three largest grants are all spent on the turn they fire, which is why\n" +
    "    grant size alone looked like it had no dose-response.",
);

if (silent.length) {
  console.log(
    `\n  ${silent.length} holders grant nothing in this position and are excluded. They are not\n` +
      "  necessarily inert: a card needing a piece this opening has developed, or an\n" +
      "  endgame, or an activation, measures 0 here. Examples: " +
      silent.slice(0, 6).map((c) => c.id).join(", "),
  );
}

if (WRITE_JSON) {
  const out = path.join(DOCS, "search-bias.json");
  fs.writeFileSync(
    out,
    `${JSON.stringify(
      {
        generated: new Date().toISOString(),
        position: OPENING,
        baselineMoves,
        slope: { b: f.b, se: f.seB, sigma: sigmaSlope, r2: f.r2, n: f.n },
        heavyGrant: {
          threshold: HEAVY,
          n: hR.length,
          meanResidual: mean(hR),
          otherN: lR.length,
          otherMeanResidual: mean(lR),
          diff,
          se: seDiff,
          sigma: sigmaDiff,
          belowTierMean: negs,
        },
        interaction: {
          lasting: fLast && { slope: fLast.b, se: fLast.seB, sigma: sLast, r2: fLast.r2, n: fLast.n },
          oneShot: fShot && { slope: fShot.b, se: fShot.seB, sigma: sShot, r2: fShot.r2, n: fShot.n },
          durationMainEffect: { diff: diffP, se: seP, sigma: sigmaP },
        },
        rows: rows.map((r) => ({
          id: r.id,
          tier: r.tier,
          grant: r.grant,
          persists: r.persists,
          delta: r.delta,
          residual: r.residual,
        })),
        silent: silent.map((c) => c.id),
      },
      null,
      1,
    )}\n`,
  );
  console.log(`\nwrote ${out}`);
}
