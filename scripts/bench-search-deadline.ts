// A16: what does a search budget actually cost, and what does it buy?
//
//   npx tsx scripts/bench-search-deadline.ts [--budgets 60,700,2000] [--level hard]
//
// `negamax`'s abort fires at `budget * HARD` and the iterative-deepening loop
// refuses to START a new depth once `elapsed > budget * SOFT`. Today those are
// HARD=2, SOFT=1, so a depth that begins at 0.99*budget runs to 2*budget and
// every caller's "budget" is a number the search is allowed to double.
//
// The argument FOR that headroom is real: a depth aborted half-way is thrown
// away entirely, so a hard deadline can burn most of the budget and return the
// previous depth's move. This script measures whether that trade is worth
// anything, by running the SAME positions through variant engines that differ
// only in those two multipliers. The comparison that matters is at equal WALL
// CEILING: cur@B and tight@2B may both spend at most 2B, so whichever reaches
// more depth in that ceiling is the better use of the same real time.
//
// Variants are generated as patched copies of src/engine/ai.ts under
// scripts/.bench-deadline/ so the measurement never depends on the working
// tree being mid-edit. Both sides are the same code with two constants moved.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const AI_SRC = join(ROOT, "src/engine/ai.ts");
// Per-process so two concurrent runs (a long 2000ms row alongside a quick
// re-check) cannot delete each other's generated engines mid-import.
const TMP = join(HERE, `.bench-deadline-${process.pid}`);

// --- variant generation -----------------------------------------------------

type Variant = { name: string; soft: number; hard: number };

function patchAi(source: string, v: Variant): string {
  let out = source;
  const subs: [RegExp, string][] = [
    // negamax's node-level abort
    [
      /if \(budget > 0 && Date\.now\(\) - start > budget \* 2\)/,
      `if (budget > 0 && Date.now() - start > budget * ${v.hard})`,
    ],
    // ...or the already-fixed form, so this script keeps working after the fix
    [
      /if \(budget > 0 && Date\.now\(\) - start > budget\)/,
      `if (budget > 0 && Date.now() - start > budget * ${v.hard})`,
    ],
    // pickAIMove's inter-depth check
    [
      /if \(d >= 1 && Date\.now\(\) - start > budget\)/,
      `if (d >= 1 && Date.now() - start > budget * ${v.soft})`,
    ],
    // rankedRoot's inter-depth check
    [/if \(Date\.now\(\) - start > budget\) break;/, `if (Date.now() - start > budget * ${v.soft}) break;`],
    // analyzeBoard's inter-depth check
    [
      /if \(Date\.now\(\) - start > budgetMs\) break;/,
      `if (Date.now() - start > budgetMs * ${v.soft}) break;`,
    ],
  ];
  let hits = 0;
  for (const [re, rep] of subs) {
    if (re.test(out)) {
      hits++;
      out = out.replace(re, rep);
    }
  }
  // 1 hard check (one of the two accepted forms) + 3 soft checks.
  if (hits !== 4) throw new Error(`patchAi: expected 4 deadline checks in ai.ts, patched ${hits}`);
  // Relative engine imports move one directory deeper.
  out = out.replace(/from "\.\/([a-zA-Z]+)"/g, 'from "../../../src/engine/$1"');
  return out;
}

function buildVariant(v: Variant): string {
  const dir = join(TMP, v.name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "ai.ts");
  writeFileSync(file, patchAi(readFileSync(AI_SRC, "utf8"), v));
  return file;
}

// --- positions --------------------------------------------------------------

// Two real openings played out far enough to reach genuine middlegames, where
// the branching factor is high and the deepening loop actually has to choose.
const LINES: string[][] = [
  // Italian, main line
  "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d4 e5d4 c3d4 c5b4 c1d2 b4d2 b1d2 d7d5 e4d5 f6d5 d1b3 c6e7 e1g1 e8g8 f1e1 c7c6"
    .split(" "),
  // Queen's Gambit Declined
  "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 h7h6 g5h4 b7b6 c4d5 f6d5 h4e7 d8e7 c3d5 e6d5 a1c1 c8e6 f1d3 c7c5"
    .split(" "),
  // Sicilian Najdorf
  "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5 d4b3 f8e7 f2f3 e8g8 d1d2 b8c6 e1c1 c8e6 g2g4 b7b5 g4g5 f6d7"
    .split(" "),
];

// Sample from ply 8 onward: the first few plies are book-shallow and finish
// every depth instantly, which would dilute the measurement with noise.
const FIRST_PLY = 8;
const STRIDE = 2;

// A NerfGame carries live nerf objects (with methods), so it is not
// structured-cloneable. Positions are therefore held as replay recipes and
// rebuilt from the shared src/engine/game module before every measurement,
// which also guarantees each sample starts from an identical, unmutated game.
type Position = { label: string; build: () => unknown };

async function buildPositions(): Promise<Position[]> {
  const game = await import("../src/engine/game");
  const board = await import("../src/engine/board");
  const out: Position[] = [];
  const replay = (li: number, plies: number) => {
    let g = game.newGame(game.UNRESTRICTED_NERF, game.UNRESTRICTED_NERF, 7 + li);
    for (let i = 0; i < plies; i++) {
      const mv = board.moveFromUCI(g.board, LINES[li][i]);
      if (!mv) throw new Error(`line ${li}: illegal uci ${LINES[li][i]} at ply ${i}`);
      g = game.playMove(g, mv);
    }
    return g;
  };
  for (let li = 0; li < LINES.length; li++) {
    for (let n = FIRST_PLY; n <= LINES[li].length; n += STRIDE) {
      replay(li, n); // validate the line once, up front
      out.push({ label: `L${li}p${n}`, build: () => replay(li, n) });
    }
  }
  return out;
}

// --- measurement ------------------------------------------------------------

type Sample = { ms: number; depth: number; nodes: number };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};
const r1 = (x: number) => Math.round(x * 10) / 10;

async function run(
  file: string,
  positions: Position[],
  level: string,
  budget: number,
  repeats: number,
): Promise<Sample[]> {
  const mod = await import(file);
  const samples: Sample[] = [];
  for (const p of positions) {
    for (let r = 0; r < repeats; r++) {
      const g = p.build();
      const stats = { depth: 0, rootMoves: 0, nodes: 0 };
      const t0 = process.hrtime.bigint();
      mod.pickAIMove(g, level, budget, undefined, stats);
      const t1 = process.hrtime.bigint();
      samples.push({ ms: Number(t1 - t0) / 1e6, depth: stats.depth, nodes: stats.nodes ?? 0 });
    }
  }
  return samples;
}

function report(tag: string, budget: number, s: Sample[]) {
  const ms = s.map((x) => x.ms);
  const d = s.map((x) => x.depth);
  // "over" means meaningfully over, not over by the abort's own granularity:
  // the deadline is checked per node, so landing a percent past it is exact.
  const over = ms.filter((x) => x > budget * 1.05).length;
  console.log(
    `  ${tag.padEnd(22)} wall mean ${String(r1(mean(ms))).padStart(7)}ms  p95 ${String(
      r1(pct(ms, 0.95)),
    ).padStart(7)}ms  max ${String(r1(Math.max(...ms))).padStart(7)}ms  ` +
      `(${r1(Math.max(...ms) / budget)}x asked)  depth mean ${r1(mean(d))} min ${Math.min(
        ...d,
      )} max ${Math.max(...d)}  ` +
      // depth 0 means not even one ply finished, so the caller gets an
      // unsearched move. A tighter deadline must not push searches into it.
      `unsearched ${d.filter((x) => x === 0).length}  over-asked ${over}/${ms.length}`,
  );
}

// --- the frozen-clock (Cloudflare Workers) path ------------------------------
//
// On Workers, Date.now() does not advance during synchronous compute, so the
// deadline check in negamax NEVER fires and the node cap is the only thing that
// ends the search. That is what the DO's local house-bot fallback runs on, and
// it is the abort the 2026-07-08/-10 exceededCpu incidents were about.
//
// This mode stubs Date.now the way the win-rate harness already does, times the
// search with process.hrtime (which the stub cannot touch), and prints nodes +
// wall for both variants. The two must be IDENTICAL: the hard-deadline fix
// changes only the clock check, so on a runtime with no working clock it must
// change literally nothing.
async function frozenClock(files: Map<string, string>, positions: Position[], level: string) {
  const realNow = Date.now;
  const FROZEN = realNow();
  Date.now = () => FROZEN;
  try {
    console.log("frozen clock (Workers / Durable Object): node cap is the only abort\n");
    // The DO clamps every house budget to HOUSE_SEARCH_CEILING_MS (80), so this
    // is the real range that path ever sees.
    for (const b of [10, 25, 80]) {
      console.log(`budget asked = ${b}ms`);
      for (const name of ["cur", "tight"]) {
        const s = await run(files.get(name)!, positions.slice(0, 9), level, b, 1);
        const nodes = s.map((x) => x.nodes);
        const ms = s.map((x) => x.ms);
        console.log(
          `  ${name.padEnd(6)} terminated ${s.length}/${s.length}  nodes mean ${Math.round(
            mean(nodes),
          )} max ${Math.max(...nodes)}  (cap ${b * 2 * 1000})  ` +
            `real wall mean ${r1(mean(ms))}ms max ${r1(Math.max(...ms))}ms  depth mean ${r1(
              mean(s.map((x) => x.depth)),
            )}`,
        );
      }
      console.log("");
    }
  } finally {
    Date.now = realNow;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, dflt: string) => {
    const i = args.indexOf(k);
    return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
  };
  const budgets = arg("--budgets", "60,700,2000").split(",").map(Number);
  const level = arg("--level", "hard");
  const repeats = Number(arg("--repeats", "3"));

  rmSync(TMP, { recursive: true, force: true });
  const variants: Variant[] = [
    { name: "cur", soft: 1, hard: 2 }, // today
    { name: "tight", soft: 1, hard: 1 }, // hard deadline == what the caller asked
  ];
  const files = new Map(variants.map((v) => [v.name, buildVariant(v)]));

  const positions = await buildPositions();
  console.log(
    `A16 deadline bench: level=${level}, ${positions.length} positions x ${repeats} repeats, node ${process.version}\n`,
  );

  if (args.includes("--frozen")) {
    await frozenClock(files, positions, level);
    rmSync(TMP, { recursive: true, force: true });
    return;
  }

  for (const b of budgets) {
    console.log(`budget asked = ${b}ms`);
    report(`cur (hard 2x) @${b}`, b, await run(files.get("cur")!, positions, level, b, repeats));
    report(`tight (hard 1x) @${b}`, b, await run(files.get("tight")!, positions, level, b, repeats));
    // Equal-ceiling comparison: both of these may spend at most 2*b.
    report(
      `tight @${2 * b} (= ${b} ceil)`,
      2 * b,
      await run(files.get("tight")!, positions, level, 2 * b, repeats),
    );
    console.log("");
  }
  rmSync(TMP, { recursive: true, force: true });
}

void main();
