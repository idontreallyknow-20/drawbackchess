/**
 * A25: size the search's node cap against MEASURED throughput, not an estimate.
 *
 * On Cloudflare Workers `Date.now()` does not advance during synchronous
 * compute, so the wall-clock abort inside `negamax` never fires and the node
 * cap is the ONLY thing that stops a search. That is the Durable Object
 * `exceededCpu` blowup of 2026-07-08/-10.
 *
 * The cap is `budgetMs * 2 * NODES_PER_MS` = 2000 nodes per millisecond of
 * budget. `NODES_PER_MS = 1000` was chosen on 2026-07-10 from a throughput of
 * ~450 nodes/ms, deliberately overshooting about 2x so that on a runtime with
 * a working clock the clock always fires first and playing strength is
 * untouched. The cost of that overshoot is paid only where the clock is
 * frozen: 2000 nodes per ms-of-budget at ~450 nodes/ms real throughput is
 * about 4.4x the budget's worth of real CPU, which is why an 80ms ask was
 * measured burning 0.96 to 1.98 seconds on the DO path.
 *
 * Two engine changes since have a claim on that 450: round 8 moved buff
 * augmentation inside `genMoves`, making every node more expensive, and round 9
 * turned the clock abort from `budget * 2` into a hard `budget`. So re-measure
 * throughput on the current code, across levels and positions, and print what
 * the constant should be.
 *
 * The constant is bounded on both sides and the two bounds fight:
 *   - it must exceed the FASTEST observed throughput, or the cap bites before
 *     the clock on an ordinary runtime and costs playing strength;
 *   - it must be small enough that cap / SLOWEST throughput is an acceptable
 *     CPU multiple on the frozen-clock path.
 * The spread between fastest and slowest is therefore the floor on how tight
 * this can ever be, and that spread is the real output of this script.
 *
 * Run: npx tsx scripts/bench-node-throughput.ts
 */

const LINES: string[][] = [
  "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d4 e5d4 c3d4 c5b4 c1d2 b4d2 b1d2 d7d5 e4d5 f6d5 d1b3 c6e7 e1g1 e8g8 f1e1 c7c6"
    .split(" "),
  "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 h7h6 g5h4 b7b6 c4d5 f6d5 h4e7 d8e7 c3d5 e6d5 a1c1 c8e6 f1d3 c7c5"
    .split(" "),
  "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5 d4b3 f8e7 f2f3 e8g8 d1d2 b8c6 e1c1 c8e6 g2g4 b7b5 g4g5 f6d7"
    .split(" "),
];
const FIRST_PLY = 8;
const STRIDE = 2;

// The budgets that actually reach the frozen-clock path: the engine service
// ceiling, the house-bot band, and the small asks the DO fallback makes.
const BUDGETS = [40, 80, 200, 700, 1800];

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

async function main() {
  const game = await import("../src/engine/game");
  const board = await import("../src/engine/board");
  const ai = await import("../src/engine/ai");

  const games: { label: string; game: unknown }[] = [];
  for (let li = 0; li < LINES.length; li++) {
    for (let n = FIRST_PLY; n <= LINES[li].length; n += STRIDE) {
      let g = game.newGame(game.UNRESTRICTED_NERF, game.UNRESTRICTED_NERF, 7 + li);
      for (let i = 0; i < n; i++) {
        const mv = board.moveFromUCI(g.board, LINES[li][i]);
        if (!mv) throw new Error(`line ${li}: illegal uci ${LINES[li][i]} at ply ${i}`);
        g = game.playMove(g, mv);
      }
      games.push({ label: `L${li}p${n}`, game: g });
    }
  }

  // `pickAIMove` is the entry point the bots and the DO fallback use, and it
  // reports nodes through an out-param rather than a return value.
  type Stats = { depth: number; rootMoves: number; nodes?: number };
  const call = (g: unknown, budget: number, level: string): Stats => {
    const st: Stats = { depth: 0, rootMoves: 0, nodes: 0 };
    (ai as unknown as {
      pickAIMove: (g: unknown, l: string, b?: number, w?: unknown, s?: Stats) => unknown;
    }).pickAIMove(g, level, budget, undefined, st);
    return st;
  };

  // Warm the JIT and throw the result away: the first pass through this path
  // pays for compilation that no later pass does, and counting it would report
  // a throughput no real search ever sees.
  for (const g of games.slice(0, 4)) call(g.game, 60, "hard");

  console.log(
    `A25: measured search throughput on the current engine, ${games.length} middlegame positions, node ${process.version}\n`,
  );
  console.log("level  budget   samples   nodes/ms  p05     p50     p95     max     (cap bites at 2000/ms of budget)");

  const all: number[] = [];
  for (const level of ["medium", "hard"]) {
    for (const budget of BUDGETS) {
      const rates: number[] = [];
      for (const g of games) {
        const t0 = performance.now();
        const st = call(g.game, budget, level);
        const ms = performance.now() - t0;
        const n = st.nodes ?? 0;
        if (ms > 1 && n > 0) rates.push(n / ms);
      }
      if (!rates.length) continue;
      rates.sort((a, b) => a - b);
      all.push(...rates);
      console.log(
        `${level.padEnd(7)}${String(budget).padStart(5)}ms ${String(rates.length).padStart(8)}   ` +
          `${quantile(rates, 0.05).toFixed(0).padStart(8)}${quantile(rates, 0.5).toFixed(0).padStart(8)}` +
          `${quantile(rates, 0.95).toFixed(0).padStart(8)}${rates[rates.length - 1].toFixed(0).padStart(8)}`,
      );
    }
  }

  all.sort((a, b) => a - b);
  const slow = quantile(all, 0.05);
  const fast = quantile(all, 0.95);
  const max = all[all.length - 1];
  console.log(
    `\nacross everything: p05 ${slow.toFixed(0)}  p50 ${quantile(all, 0.5).toFixed(0)}  ` +
      `p95 ${fast.toFixed(0)}  max ${max.toFixed(0)} nodes/ms, spread ${(max / slow).toFixed(2)}x`,
  );

  // What the cap is worth today, and what it could be.
  const CURRENT = 2000;
  console.log(
    `\ncap today: ${CURRENT} nodes per ms-of-budget.\n` +
      `  never bites on a working clock (needs > ${max.toFixed(0)}): ${CURRENT > max ? "yes" : "NO"}\n` +
      `  frozen-clock CPU at the SLOWEST position: ${(CURRENT / slow).toFixed(2)}x the budget\n` +
      `  frozen-clock CPU at the median position : ${(CURRENT / quantile(all, 0.5)).toFixed(2)}x the budget`,
  );
  // A cap must clear the fastest position with margin, or it costs strength on
  // ordinary runtimes. 1.25x of the observed max is the margin used here, and
  // it is a judgement call rather than a measurement: it is roughly the spread
  // between this box and a fast desktop.
  const proposed = Math.ceil((max * 1.25) / 50) * 50;
  console.log(
    `\nproposed cap: ${proposed} nodes per ms-of-budget (1.25x the fastest observed ${max.toFixed(0)}).\n` +
      `  frozen-clock CPU at the SLOWEST position: ${(proposed / slow).toFixed(2)}x the budget  ` +
      `(today ${(CURRENT / slow).toFixed(2)}x)\n` +
      `  frozen-clock CPU at the median position : ${(proposed / quantile(all, 0.5)).toFixed(2)}x the budget  ` +
      `(today ${(CURRENT / quantile(all, 0.5)).toFixed(2)}x)\n` +
      `  an 80ms ask on the DO path would burn up to ${((80 * proposed) / slow / 1000).toFixed(2)}s ` +
      `(today ${((80 * CURRENT) / slow / 1000).toFixed(2)}s)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

export {};
