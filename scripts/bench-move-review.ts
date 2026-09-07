/**
 * A26: does MoveReview's 60ms budget still buy an EVEN depth?
 *
 * `classifyLoss` refuses to grade an odd or shallower-than-2 search
 * (`depth < 2 || depth % 2 !== 0` returns "unclear"), because an odd-depth
 * search hands the side to move the last word and the loss figure it produces
 * is not comparable between the two positions being differenced. That guard is
 * correct, so a budget that is too small does NOT produce a wrong grade. It
 * produces a review that quietly says nothing.
 *
 * Round 9 turned the search's abort from `budget * 2` into a hard `budget`, so
 * `REVIEW_BUDGET_MS = 60` now buys about half the wall time it used to buy.
 * The comment above the constant claims depth 2 completes "in 6ms typical,
 * 40ms worst" over 40 middlegame positions, but that measurement predates
 * round 8, which put buff augmentation inside `genMoves` and so made every
 * node more expensive. This measures the thing the panel actually depends on:
 * the share of positions that come back at depth 2, at the budget as shipped
 * and at the budget the old 2x abort effectively granted.
 *
 * Run: npx tsx scripts/bench-move-review.ts
 */

// Same three lines and the same sampling as scripts/bench-search-deadline.ts,
// so the two benchmarks are talking about the same positions.
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
const FIRST_PLY = 8;
const STRIDE = 1; // every ply: a review grades every move, not every other one.

// The two numbers MoveReview.tsx ships.
const REVIEW_BUDGET_MS = 60;
const REVIEW_TARGET_DEPTH = 2;
// What the old `budget * 2` abort effectively granted for the same ask.
const OLD_EFFECTIVE_MS = REVIEW_BUDGET_MS * 2;

type Row = { label: string; ms: number; depth: number };

function pct(n: number, d: number) {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

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

  const positions: { label: string; board: unknown }[] = [];
  for (let li = 0; li < LINES.length; li++) {
    for (let n = FIRST_PLY; n <= LINES[li].length; n += STRIDE) {
      let g = game.newGame(game.UNRESTRICTED_NERF, game.UNRESTRICTED_NERF, 7 + li);
      for (let i = 0; i < n; i++) {
        const mv = board.moveFromUCI(g.board, LINES[li][i]);
        if (!mv) throw new Error(`line ${li}: illegal uci ${LINES[li][i]} at ply ${i}`);
        g = game.playMove(g, mv);
      }
      positions.push({ label: `L${li}p${n}`, board: g.board });
    }
  }

  // A warm pass that is thrown away: the first call through this code path pays
  // for JIT that every later call does not, and counting it would blame the
  // budget for a cost the browser pays once per session.
  for (const p of positions.slice(0, 5)) {
    ai.analyzeBoard(p.board as never, REVIEW_BUDGET_MS, REVIEW_TARGET_DEPTH);
  }

  const measure = (budget: number): Row[] =>
    positions.map((p) => {
      const t0 = performance.now();
      const r = ai.analyzeBoard(p.board as never, budget, REVIEW_TARGET_DEPTH);
      return { label: p.label, ms: performance.now() - t0, depth: r.depth };
    });

  const report = (name: string, rows: Row[]) => {
    const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
    const even = rows.filter((r) => r.depth >= 2 && r.depth % 2 === 0).length;
    const graded = pct(even, rows.length);
    const worst = rows.reduce((a, b) => (b.ms > a.ms ? b : a));
    console.log(
      `${name.padEnd(22)} depth2 reached ${String(even).padStart(3)}/${rows.length} (${graded.padStart(6)})  ` +
        `ms p50 ${quantile(ms, 0.5).toFixed(1).padStart(6)}  p95 ${quantile(ms, 0.95).toFixed(1).padStart(6)}  ` +
        `max ${worst.ms.toFixed(1).padStart(6)} (${worst.label})`,
    );
    const shallow = rows.filter((r) => r.depth < 2 || r.depth % 2 !== 0);
    if (shallow.length) {
      console.log(
        `${" ".repeat(22)} ungraded, so shown as "unclear": ` +
          shallow
            .slice(0, 8)
            .map((r) => `${r.label}@d${r.depth}/${r.ms.toFixed(0)}ms`)
            .join(" "),
      );
    }
    return { even, total: rows.length, p95: quantile(ms, 0.95), max: worst.ms };
  };

  console.log(
    `A26: MoveReview at target depth ${REVIEW_TARGET_DEPTH}, ${positions.length} middlegame positions, node ${process.version}\n`,
  );

  const now = report(`shipped (${REVIEW_BUDGET_MS}ms)`, measure(REVIEW_BUDGET_MS));
  const before = report(`old 2x (${OLD_EFFECTIVE_MS}ms)`, measure(OLD_EFFECTIVE_MS));
  // What it would take to never degrade, so the fix has a number attached
  // rather than a guess.
  const generous = report(`headroom (300ms)`, measure(300));

  console.log("");
  if (now.even === now.total) {
    console.log(
      `OK: every position reaches an even depth inside the shipped ${REVIEW_BUDGET_MS}ms budget, ` +
        `with p95 ${now.p95.toFixed(1)}ms and a worst case of ${now.max.toFixed(1)}ms. ` +
        `The hard deadline did not cost the review anything: the budget was never the binding constraint at depth 2.`,
    );
  } else {
    const lost = now.total - now.even;
    console.log(
      `DEGRADED: ${lost}/${now.total} positions (${pct(lost, now.total)}) no longer reach an even depth at ` +
        `${REVIEW_BUDGET_MS}ms, so classifyLoss returns "unclear" for them and the panel grades nothing. ` +
        `At the old effective ${OLD_EFFECTIVE_MS}ms it was ${before.total - before.even}/${before.total}; ` +
        `at 300ms it is ${generous.total - generous.even}/${generous.total}. ` +
        `The budget needs raising to about ${Math.ceil(now.max / 10) * 10}ms, which is what the worst position here costs.`,
    );
  }
  process.exit(now.even === now.total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

export {};
