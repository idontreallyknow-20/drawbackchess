// Search cost before and after the A13 buff-aware search.
//
//   npx tsx scripts/bench-search-buffs.ts <beforeEngineDir>
//
// The "before" engine is a copy of src/engine with ai.ts and game.ts reverted
// to the pre-A13 versions and given the SAME node-count instrumentation, so
// both sides are measured with the same ruler. Without an argument only the
// current engine is measured.
//
// The question this has to answer is not "is it slower" (per-node work was
// added, so of course it is) but "does it get SHALLOWER at a fixed budget",
// because a search that trades depth for buff visibility has swapped one kind
// of blindness for another.

import { pickAIMove as pickAfter, type SearchStats } from "../src/engine/ai";
import {
  UNRESTRICTED_NERF as NERF_AFTER,
  acquireBuff as acquireAfter,
  enableDraftMode as draftAfter,
  newGame as newAfter,
  playMove as playAfter,
} from "../src/engine/game";
import { moveFromUCI as uciAfter } from "../src/engine/board";
import { BUFF_BY_ID } from "../src/engine/buffs/library";

const OPENING = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "d2d3", "f8c5", "b1c3", "d7d6"];
const REPEATS = 15;

type Engine = {
  label: string;
  pick: (game: any, level: any, budget?: number, weaken?: any, stats?: SearchStats) => unknown;
  build: (card: string | null) => unknown;
};

function makeEngine(
  label: string,
  mod: { ai: any; game: any; board: any },
): Engine {
  return {
    label,
    pick: mod.ai.pickAIMove,
    build: (card) => {
      const g = mod.game.newGame(mod.game.UNRESTRICTED_NERF, mod.game.UNRESTRICTED_NERF, 7);
      mod.game.enableDraftMode(g, 7, { mode: "buff" });
      for (const uci of OPENING) mod.game.playMove(g, mod.board.moveFromUCI(g.board, uci)!);
      if (card) mod.game.acquireBuff(g, "w", card, BUFF_BY_ID[card]!.tier);
      return g;
    },
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Result = { depth: number; nodes: number; ms: number; rootMoves: number };

function measure(e: Engine, card: string | null, level: "medium" | "hard", budget: number): Result {
  const depths: number[] = [];
  const nodes: number[] = [];
  const times: number[] = [];
  let rootMoves = 0;
  for (let i = 0; i < REPEATS; i++) {
    const g = e.build(card);
    const stats: SearchStats = { depth: 0, rootMoves: 0, nodes: 0 };
    const t0 = process.hrtime.bigint();
    e.pick(g, level, budget, undefined, stats);
    const t1 = process.hrtime.bigint();
    depths.push(stats.depth);
    nodes.push(stats.nodes ?? 0);
    times.push(Number(t1 - t0) / 1e6);
    rootMoves = stats.rootMoves;
  }
  return {
    depth: median(depths),
    nodes: Math.round(median(nodes)),
    ms: Math.round(median(times) * 10) / 10,
    rootMoves,
  };
}

async function main() {
  const beforeDir = process.argv[2];
  const engines: Engine[] = [];
  if (beforeDir) {
    const [ai, game, board] = await Promise.all([
      import(`${beforeDir}/ai.ts`),
      import(`${beforeDir}/game.ts`),
      import(`${beforeDir}/board.ts`),
    ]);
    engines.push(makeEngine("before", { ai, game, board }));
  }
  engines.push(
    makeEngine("after", {
      ai: { pickAIMove: pickAfter },
      game: {
        newGame: newAfter,
        enableDraftMode: draftAfter,
        playMove: playAfter,
        acquireBuff: acquireAfter,
        UNRESTRICTED_NERF: NERF_AFTER,
      },
      board: { moveFromUCI: uciAfter },
    }),
  );

  const cases: { card: string | null; level: "medium" | "hard"; budget: number }[] = [
    // 60ms is the floor `aiBudgetMs` clamps to — the fastest the bot ever
    // thinks, and the budget the win-rate harness nominally runs at (though
    // that harness freezes the clock, so it always reaches its full depth).
    { card: null, level: "medium", budget: 60 },
    { card: "amazon_army", level: "medium", budget: 60 },
    { card: null, level: "medium", budget: 700 },
    { card: "amazon_army", level: "medium", budget: 700 },
    { card: null, level: "hard", budget: 2000 },
    { card: "amazon_army", level: "hard", budget: 2000 },
  ];

  console.log(`search cost, median of ${REPEATS} runs, same position\n`);
  const pad = (s: string, n: number) => String(s).padEnd(n);
  console.log(
    pad("card", 14) + pad("level", 8) + pad("budget", 8) + pad("engine", 9) +
      pad("root", 6) + pad("depth", 7) + pad("nodes", 10) + "ms",
  );
  console.log("-".repeat(72));
  for (const c of cases) {
    const results = engines.map((e) => ({ e, r: measure(e, c.card, c.level, c.budget) }));
    for (const { e, r } of results) {
      console.log(
        pad(c.card ?? "(none)", 14) + pad(c.level, 8) + pad(`${c.budget}ms`, 8) + pad(e.label, 9) +
          pad(String(r.rootMoves), 6) + pad(String(r.depth), 7) + pad(String(r.nodes), 10) + r.ms,
      );
    }
    if (results.length === 2) {
      const [b, a] = results;
      const dd = a.r.depth - b.r.depth;
      const dn = b.r.nodes ? ((a.r.nodes / b.r.nodes - 1) * 100).toFixed(0) : "n/a";
      console.log(
        `${pad("", 14)}${pad("", 8)}${pad("", 8)}${pad("delta", 9)}` +
          `${pad("", 6)}${pad(dd >= 0 ? `+${dd}` : String(dd), 7)}${pad(`${dn}%`, 10)}` +
          `${(a.r.ms - b.r.ms).toFixed(1)}`,
      );
    }
    console.log();
  }

  // Fixed depth, budget far above what the search needs, so nothing times out.
  // This separates the two halves of the cost: `nodes` grows because the tree
  // really is wider once every ply sees the granted moves (that width is the
  // bug being fixed, not overhead), while us/node grows only by the price of
  // the augment call itself.
  if (engines.length === 2) {
    console.log("fixed depth, no timeout: where the extra time goes\n");
    console.log(
      pad("card", 14) + pad("depth", 7) + pad("engine", 9) + pad("nodes", 10) +
        pad("ms", 9) + "us/node",
    );
    console.log("-".repeat(60));
    for (const card of [null, "amazon_army"]) {
      for (const d of [3, 4]) {
        const rows = engines.map((e) => {
          const times: number[] = [];
          const nodes: number[] = [];
          for (let i = 0; i < REPEATS; i++) {
            const g = e.build(card);
            const stats: SearchStats = { depth: 0, rootMoves: 0, nodes: 0 };
            const t0 = process.hrtime.bigint();
            e.pick(
              g, "hard", 600_000,
              { params: { maxDepth: d, extendedEval: true, topK: 1, temperatureCp: 0, sampleWindowCp: 0, evalNoiseCp: 0 },
                random: (n: number) => n >> 1 },
              stats,
            );
            times.push(Number(process.hrtime.bigint() - t0) / 1e6);
            nodes.push(stats.nodes ?? 0);
          }
          return { e, ms: median(times), nodes: Math.round(median(nodes)) };
        });
        for (const r of rows) {
          console.log(
            pad(card ?? "(none)", 14) + pad(String(d), 7) + pad(r.e.label, 9) +
              pad(String(r.nodes), 10) + pad(r.ms.toFixed(1), 9) +
              ((r.ms * 1000) / Math.max(1, r.nodes)).toFixed(2),
          );
        }
        const [b, a] = rows;
        console.log(
          `${pad("", 14)}${pad("", 7)}${pad("ratio", 9)}` +
            `${pad(`${(a.nodes / Math.max(1, b.nodes)).toFixed(2)}x`, 10)}` +
            `${pad(`${(a.ms / Math.max(0.001, b.ms)).toFixed(2)}x`, 9)}` +
            `${((a.ms / Math.max(1, a.nodes)) / (b.ms / Math.max(1, b.nodes))).toFixed(2)}x`,
        );
        console.log();
      }
    }
  }
}

main();
