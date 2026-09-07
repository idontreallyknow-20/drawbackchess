// Web worker that runs the eval bar's position search off the main thread.
//
// The eval bar is a *decoration*: nobody is waiting on it, and a reading that
// arrives 200ms late is worth exactly as much as one that arrives instantly.
// What it must never do is cost a frame, because the surfaces that show it —
// the analysis board, a replay, a spectated game — are surfaces the viewer is
// actively driving with arrow keys.
//
// Everything the main thread previously did to make that affordable (idle
// callbacks, a ladder of deliberately tiny budgets, suspending on a hidden tab,
// lazily import()ing the engine so its parse cost missed first paint) was a
// mitigation of a cost that does not have to exist here at all. Off the main
// thread the cost stops being a frame problem and becomes a CPU-time problem,
// which is the one it always was.
//
// A bare BoardState in, {move, scoreCp, depth} out. No NerfGame, no nerfs, no
// buffs: `analyzeBoard` scores the plain-chess skeleton and EvalBar.tsx is
// where the honesty about that lives.
import { analyzeBoard } from "@/engine/ai";
import type { BoardState, Move } from "@/engine/types";

export type EvalWorkerRequest = {
  id: number;
  board: BoardState;
  /** Hard wall-clock deadline for this search — see negamax in engine/ai.ts. */
  budgetMs: number;
  maxDepth: number;
};

export type EvalWorkerResponse = {
  id: number;
  move: Move | null;
  scoreCp: number;
  /** Deepest fully completed depth; 0 means the budget expired first and the
   *  score is not a reading of anything. */
  depth: number;
  /** Wall time the search actually took, measured inside the worker. */
  costMs: number;
  error?: string;
};

const reply = (message: EvalWorkerResponse) => {
  (self as unknown as { postMessage: (m: EvalWorkerResponse) => void }).postMessage(message);
};

self.onmessage = (event: MessageEvent<EvalWorkerRequest>) => {
  const { id, board, budgetMs, maxDepth } = event.data;
  const t0 = performance.now();
  try {
    const r = analyzeBoard(board, budgetMs, maxDepth);
    reply({ id, move: r.move, scoreCp: r.scoreCp, depth: r.depth, costMs: performance.now() - t0 });
  } catch (err) {
    // A failed reading must still answer: the client keys results by request id
    // and would otherwise hold the ladder open until its watchdog fires.
    reply({ id, move: null, scoreCp: 0, depth: 0, costMs: performance.now() - t0, error: String(err) });
  }
};
