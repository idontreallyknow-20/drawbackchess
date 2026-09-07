// Main-thread client for `evalWorker`.
//
// One worker is shared by every eval bar on the page and reference-counted, so
// a page with a bar in two places does not run two search threads and a page
// that never shows a bar never starts one. The thread is torn down when the
// last consumer releases it.
//
// Failure is a first-class path here, not an exception: workers are absent in
// SSR, blocked by some CSPs, and can wedge. Every failure resolves to "no
// worker", and the caller (useBoardEval) runs the search on the main thread
// instead, at a rung budget small enough not to cost a frame.
import type { BoardState } from "@/engine/types";
import type { EvalWorkerRequest, EvalWorkerResponse } from "./evalWorker";

export type EvalWorkerResult = {
  move: EvalWorkerResponse["move"];
  scoreCp: number;
  depth: number;
  costMs: number;
};

type Waiter = {
  resolve: (r: EvalWorkerResult) => void;
  reject: (e: Error) => void;
  timer: number;
};

let worker: Worker | null = null;
let refs = 0;
let nextId = 1;
// Set once construction or the worker itself fails. Sticky: a browser that
// cannot run this worker will not start being able to halfway through a
// session, and retrying per request would spawn a thread per position.
let broken = false;
const waiting = new Map<number, Waiter>();

/** A wedged worker must not hold a rung open forever. The search's deadline is
 *  hard (engine/ai.ts), so anything past the budget plus this much means the
 *  thread is not coming back. The slack is generous because the FIRST request
 *  also pays for fetching, compiling and starting the worker, and condemning a
 *  perfectly good thread over a slow cold start would drop the whole session
 *  onto the main thread. */
const WATCHDOG_SLACK_MS = 8000;

function failAll(reason: string) {
  broken = true;
  for (const [, w] of waiting) {
    window.clearTimeout(w.timer);
    w.reject(new Error(reason));
  }
  waiting.clear();
  worker?.terminate();
  worker = null;
}

function ensureWorker(): Worker | null {
  if (broken) return null;
  if (worker) return worker;
  if (typeof Worker === "undefined") {
    broken = true;
    return null;
  }
  try {
    const w = new Worker(new URL("./evalWorker", import.meta.url));
    w.addEventListener("message", (event: MessageEvent<EvalWorkerResponse>) => {
      const d = event.data;
      const pending = waiting.get(d.id);
      if (!pending) return; // a reading for a position nobody is holding
      waiting.delete(d.id);
      window.clearTimeout(pending.timer);
      if (d.error) pending.reject(new Error(d.error));
      else pending.resolve({ move: d.move, scoreCp: d.scoreCp, depth: d.depth, costMs: d.costMs });
    });
    w.addEventListener("error", () => failAll("eval worker error"));
    worker = w;
    return w;
  } catch {
    broken = true;
    return null;
  }
}

/** Claim the shared worker. Returns false when this browser cannot run one, in
 *  which case the caller must search on the main thread instead. */
export function acquireEvalWorker(): boolean {
  const w = ensureWorker();
  if (!w) return false;
  refs++;
  return true;
}

/** Release a claim taken by `acquireEvalWorker`. */
export function releaseEvalWorker() {
  refs = Math.max(0, refs - 1);
  if (refs > 0 || !worker) return;
  for (const [, pending] of waiting) window.clearTimeout(pending.timer);
  waiting.clear();
  worker.terminate();
  worker = null;
}

/**
 * Search one position on the worker. Rejects if no worker is available or the
 * thread stops answering — the caller then falls back rather than waiting.
 *
 * There is no cancel. A search that is no longer wanted is simply not awaited:
 * its budget is a hard deadline, so it frees the thread on its own within the
 * time it was given, and its answer is dropped by id.
 */
export function requestEval(
  board: BoardState,
  budgetMs: number,
  maxDepth: number,
): Promise<EvalWorkerResult> {
  const w = ensureWorker();
  if (!w) return Promise.reject(new Error("no eval worker"));
  const id = nextId++;
  return new Promise<EvalWorkerResult>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      waiting.delete(id);
      failAll("eval worker timed out");
    }, budgetMs + WATCHDOG_SLACK_MS);
    waiting.set(id, { resolve, reject, timer });
    try {
      w.postMessage({ id, board, budgetMs, maxDepth } satisfies EvalWorkerRequest);
    } catch (err) {
      waiting.delete(id);
      window.clearTimeout(timer);
      // A board that will not structured-clone is a bug, not a wedged thread:
      // fail this request without condemning the worker.
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Test seam: forget the sticky failure and drop any live thread. */
export function resetEvalWorkerForTests() {
  broken = false;
  refs = 0;
  worker?.terminate();
  worker = null;
  waiting.clear();
}
