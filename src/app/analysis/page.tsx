"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Download,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { Board } from "@/components/Board";
import { SiteHeader } from "@/components/SiteHeader";
import { EVAL_LADDER_ANALYSIS, EvalBar, evalLabel, useBoardEval } from "@/components/EvalBar";
import {
  CLASS_LABEL,
  CLASS_TONE,
  MoveMark,
  reviewTally,
  useLineReview,
  type ReviewRow,
  type ReviewState,
} from "@/components/MoveReview";
import { useZenHotkey } from "@/lib/useZenMode";
import { typingInField } from "@/lib/boardKeymap";
import { generateMoves, makeMove, moveToSAN, movesToSAN, moveToUCI } from "@/engine/board";
import { initialBoard } from "@/engine/board";
import { BoardState, Color, Move } from "@/engine/types";
import { START_FEN, boardToFen, fenToBoard } from "@/lib/fen";
import { gameToPGN } from "@/lib/pgn";
import { Button } from "@/components/ui/Button";

// One square per status class for the ?statusdemo=1 preview (0 = a1, 63 = h8).
const STATUS_DEMO_VISUAL = {
  frozenSquares: [1],
  effectTurns: { 1: 3, 6: 2, 9: 1 } as Record<number, number | null>,
  lockedSquares: [2],
  pawnClampSquares: [9],
  shieldedSquares: [3],
  kingSafeSquares: [4],
  wardSquares: [27],
  barredSquares: [28],
  bannedSquares: [36],
  doomSquares: [{ sq: 6, turns: 2 }],
  walnutSquares: [57],
  trapSquares: [{ sq: 35, kind: "mine", name: "Mine" }],
};

// Lichess-style analysis board: move pieces for both sides, navigate the
// line, and read the engine's eval bar and best move. Accepts ?fen=... or
// ?moves=e2e4,e7e5,... so other pages can deep-link a position.

function replayFrom(start: BoardState, moves: Move[], ply: number): BoardState {
  let b = start;
  for (let i = 0; i < Math.min(ply, moves.length); i++) b = makeMove(b, moves[i]);
  return b;
}

// evalPercent / evalLabel used to live here. They moved to components/EvalBar
// with the rest of the scale, because three other surfaces needed them and a
// second copy of a sigmoid is how two eval bars start disagreeing.

function AnalysisInner() {
  const params = useSearchParams();
  // Dev preview of the board status language (lib/boardStatus): ?statusdemo=1
  // paints one square per status class on the start position.
  const statusDemo = process.env.NODE_ENV !== "production" && params.get("statusdemo") === "1";
  const [startBoard, setStartBoard] = useState<BoardState>(() => initialBoard());
  const [customStart, setCustomStart] = useState(false);
  const [moves, setMoves] = useState<Move[]>([]);
  const [viewPly, setViewPly] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [engineOn, setEngineOn] = useState(true);
  const [fenInput, setFenInput] = useState("");
  const [fenError, setFenError] = useState(false);
  // Ply count at which a ?moves= deep link stopped replaying (a move the
  // plain board could not reproduce), or null when the whole line loaded.
  const [truncatedAt, setTruncatedAt] = useState<number | null>(null);

  // Deep links: ?fen= loads a position, ?moves= replays a UCI list.
  useEffect(() => {
    // Deferred off the synchronous effect body so the deep-link parse doesn't
    // cascade a render inline; runs on the same tick, before paint.
    queueMicrotask(() => {
      const fen = params.get("fen");
      const uciList = params.get("moves");
      if (fen) {
        const b = fenToBoard(fen);
        if (b) {
          setStartBoard(b);
          setCustomStart(boardToFen(b) !== START_FEN);
          setMoves([]);
          setViewPly(0);
          if (b.turn === "b") setFlipped(true);
          return;
        }
      }
      if (uciList) {
        let b = initialBoard();
        const parsed: Move[] = [];
        let stopped = false;
        for (const uci of uciList.split(/[,\s]+/).filter(Boolean)) {
          const m = generateMoves(b).find((x) => moveToUCI(x) === uci);
          if (!m) {
            stopped = true;
            break;
          }
          parsed.push(m);
          b = makeMove(b, m);
        }
        setMoves(parsed);
        setViewPly(parsed.length);
        setTruncatedAt(stopped ? parsed.length : null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const board = useMemo(() => replayFrom(startBoard, moves, viewPly), [startBoard, moves, viewPly]);
  const legal = useMemo(() => generateMoves(board), [board]);
  const lastMove = viewPly > 0 ? moves[viewPly - 1] : null;

  // SANs for the move list, computed once per line change.
  const sans = useMemo(() => movesToSAN(moves, startBoard), [moves, startBoard]);

  // Move numbers run off the starting position's counter, not the ply index: a
  // FEN with black to move opens on a black half-move, so index parity would
  // number every move in the line wrong.
  const moveNums = useMemo(() => {
    let num = startBoard.fullmove;
    return moves.map((m) => {
      const at = num;
      if (m.color === "b") num++;
      return at;
    });
  }, [moves, startBoard]);

  const onMove = useCallback(
    (m: Move) => {
      // Playing from an earlier position discards the rest of the line, like
      // lichess's analysis board without variation trees.
      const kept = moves.slice(0, viewPly);
      setMoves([...kept, m]);
      setViewPly(viewPly + 1);
    },
    [moves, viewPly],
  );

  // The engine still runs on the main thread, but no longer in one block. The
  // old call here was `analyzeBoard(board, 300)` behind a 120ms timeout, which
  // measured at ~600ms of blocked main thread after every move: negamax aborts
  // at `budget * 2`, and the deepening loop only checks the clock once a whole
  // depth has finished. useBoardEval climbs a ladder of short searches in idle
  // callbacks instead, publishing each rung as it lands.
  const current = useBoardEval(board, engineOn, EVAL_LADDER_ANALYSIS);

  // Arrow-key navigation through the line, plus `f` for the flip button beside
  // it. `f` is bound here rather than through useBoardKeys because this board's
  // orientation is LOCAL state, not the `flipBoard` setting: the keymap hook
  // writes the global preference, and pressing a key on the analysis board must
  // not reorient the player's games. Same key, same meaning, same table row
  // (boardKeymap.ts documents `f`), different owner.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typingInField(e.target)) return;
      if (e.key === "ArrowLeft") setViewPly((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowRight") setViewPly((p) => Math.min(moves.length, p + 1));
      else if (e.key === "ArrowUp") setViewPly(0);
      else if (e.key === "ArrowDown") setViewPly(moves.length);
      else if (e.key === "f" || e.key === "F") {
        // Ctrl/Cmd+F is the browser's find. Every other chord belongs to the
        // browser too, so a modifier means this is not our key.
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        setFlipped((v) => !v);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moves.length]);

  // A result belongs to the position it was searched from; useBoardEval
  // withholds a reading taken from any other board rather than re-signing it.
  const cpWhite = current ? current.cpWhite : 0;
  const bestSan = current?.best ? moveToSAN(current.best, board) : null;

  // Move classification (blunder / mistake / inaccuracy / good / best) over the
  // whole line. Explicitly started, because it is N+1 searches and the user
  // should decide when to spend them.
  const { state: review, start: startReview, reset: resetReview } = useLineReview(startBoard, moves);
  const rowByIndex = useMemo(() => {
    const map = new Map<number, ReviewRow>();
    for (const r of review.rows) map.set(r.index, r);
    return map;
  }, [review.rows]);

  const orientation: Color = flipped ? "b" : "w";
  const fen = boardToFen(board);

  const loadFen = () => {
    const b = fenToBoard(fenInput);
    if (!b) {
      setFenError(true);
      return;
    }
    setFenError(false);
    setStartBoard(b);
    setCustomStart(boardToFen(b) !== START_FEN);
    setMoves([]);
    setViewPly(0);
    setTruncatedAt(null);
  };

  const reset = () => {
    setStartBoard(initialBoard());
    setCustomStart(false);
    setMoves([]);
    setViewPly(0);
    setFenInput("");
    setFenError(false);
    setTruncatedAt(null);
  };

  const downloadPgn = () => {
    const pgn = gameToPGN({ moves, result: null, startBoard });
    const blob = new Blob([pgn], { type: "application/x-chess-pgn" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "analysis.pgn";
    a.click();
    URL.revokeObjectURL(url);
  };

  // 44px square on a coarse pointer, stepped DOWN to the compact 9-scale square
  // only where a mouse is driving. It used to be `h-9 w-9` outright, which is
  // 31.5px in both axes under this app's 14px root — the height was rescued on
  // phones by the max-width rule on .btn-ghost in globals.css, but that is a
  // width test, not a pointer test, and it never touched the width at all. So a
  // tablet got a 31.5px target and every device got a 31.5px-wide one.
  const navBtn =
    "btn-ghost press grid h-[44px] w-[44px] place-items-center disabled:opacity-30 " +
    "[@media(pointer:fine)]:h-9 [@media(pointer:fine)]:w-9";

  return (
    <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="mx-auto flex w-full max-w-[640px] gap-3">
          {/* Eval bar. The analysis board is the one surface where the number
              is honest without qualification: there are no nerfs, no buffs and
              no pocket here, so the position on screen really is the position
              the engine searched. `rules` is empty for exactly that reason. */}
          <EvalBar
            result={engineOn ? current : null}
            rules={[]}
            orientation={orientation}
            className="hidden sm:block"
          />

          <div className="min-w-0 flex-1">
            <Board
              board={board}
              legalMoves={legal}
              orientation={orientation}
              onMove={onMove}
              myColor={board.turn}
              lastMove={lastMove}
              visual={
                statusDemo
                  ? STATUS_DEMO_VISUAL
                  : engineOn && current?.best
                    ? { highlightSquares: [current.best.from, current.best.to] }
                    : undefined
              }
            />
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button className={navBtn} onClick={() => setViewPly(0)} disabled={viewPly === 0} aria-label="First move">
                <ChevronFirst size={16} />
              </button>
              <button className={navBtn} onClick={() => setViewPly((p) => Math.max(0, p - 1))} disabled={viewPly === 0} aria-label="Previous move">
                <ChevronLeft size={16} />
              </button>
              <button
                className={navBtn}
                onClick={() => setViewPly((p) => Math.min(moves.length, p + 1))}
                disabled={viewPly >= moves.length}
                aria-label="Next move"
              >
                <ChevronRight size={16} />
              </button>
              <button className={navBtn} onClick={() => setViewPly(moves.length)} disabled={viewPly >= moves.length} aria-label="Last move">
                <ChevronLast size={16} />
              </button>
              <button
                className={navBtn}
                onClick={() => setFlipped((f) => !f)}
                aria-label="Flip board"
                aria-pressed={flipped}
                title="Flip board (f)"
              >
                <RefreshCw size={15} />
              </button>
              <button className={navBtn} onClick={reset} aria-label="Reset board" title="Reset board">
                <RotateCcw size={15} />
              </button>
              <Button
                tone={engineOn ? "quiet" : "ghost"}
                size="sm"
                onClick={() => setEngineOn((v) => !v)}
                className={
                  "ml-auto " + (engineOn ? "bg-[color:var(--bg-raised)] text-gold-leaf" : "text-parchment-300")
                }
                title="Toggle engine"
              >
                <Cpu size={14} /> Engine
              </Button>
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <div className="plate p-4">
            <h1 className="font-display text-lg text-parchment-50">Analysis board</h1>
            {engineOn ? (
              <>
                <p className="mt-1 text-sm text-parchment-300">
                  <span className="font-mono text-parchment-50">{current ? evalLabel(cpWhite) : "…"}</span>
                  {bestSan && (
                    <span className="text-parchment-400">
                      {" "}
                      · best {bestSan} · depth {current?.depth}
                      {current && !current.settled ? " (deepening)" : ""}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-[12px] leading-snug text-parchment-500">
                  Plain chess. No nerfs, buffs or pocket drops here, so the number means what it
                  says. It will not, on a board that has rules on it.
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-parchment-400">Engine off.</p>
            )}
          </div>

          <MoveReviewPanel
            moves={moves}
            sans={sans}
            moveNums={moveNums}
            review={review}
            onStart={startReview}
            onReset={resetReview}
            onJump={(i) => setViewPly(i + 1)}
          />

          <div className="plate min-h-[120px] p-4">
            <div className="text-[12px] tracking-[0.04em] text-parchment-400">Moves</div>
            {truncatedAt != null && (
              <p role="status" className="mt-2 text-[13px] leading-snug text-oxblood-glow">
                Line truncated at move {Math.floor(truncatedAt / 2) + 1}: this game used cards the
                analysis board cannot replay.
              </p>
            )}
            {moves.length === 0 ? (
              <p className="mt-2 text-sm text-parchment-400">
                Play moves for either side, or load a FEN below.
              </p>
            ) : (
              <div className="mt-2 max-h-64 overflow-y-auto font-mono text-sm leading-7">
                {sans.map((san, i) => {
                  const isWhiteMove = moves[i].color === "w";
                  const row = rowByIndex.get(i);
                  return (
                    <span key={i}>
                      {(isWhiteMove || i === 0) && (
                        <span className="mr-1 text-parchment-500">
                          {moveNums[i]}
                          {isWhiteMove ? "." : "..."}
                        </span>
                      )}
                      <button
                        onClick={() => setViewPly(i + 1)}
                        title={row ? `${CLASS_LABEL[row.cls]} (depth ${row.depth})` : undefined}
                        className={
                          "mr-2 px-1 transition-colors hover:bg-[color:var(--bg-raised)] " +
                          (viewPly === i + 1 ? "bg-[color:var(--bg-raised)] text-gold-leaf" : "text-parchment-100")
                        }
                      >
                        {san}
                        <MoveMark cls={row?.cls} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="plate p-4">
            <div className="text-[12px] tracking-[0.04em] text-parchment-400">FEN</div>
            <input
              readOnly
              value={fen}
              onFocus={(e) => e.currentTarget.select()}
              // A read-only field is still focusable and still selects on focus,
              // which is the whole point of it: it is how you copy the position.
              className="mt-1.5 min-h-[44px] w-full border border-[color:var(--edge)] bg-[color:var(--bg-base)] px-2 py-1.5 font-mono text-[12px] text-parchment-300 [@media(pointer:fine)]:min-h-0"
            />
            <div className="mt-2 flex gap-2">
              <input
                value={fenInput}
                onChange={(e) => {
                  setFenInput(e.target.value);
                  setFenError(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && loadFen()}
                placeholder="Paste a FEN to set up a position"
                className={
                  "min-w-0 flex-1 border bg-[color:var(--bg-base)] px-2 py-1.5 font-mono text-[12px] text-parchment-100 " +
                  (fenError ? "border-oxblood-glow" : "border-[color:var(--edge)]")
                }
              />
              <Button tone="ghost" onClick={loadFen} className="shrink-0 px-3 py-1.5 text-sm">
                Load
              </Button>
            </div>
            {fenError && <p className="mt-1 text-xs text-oxblood-glow">Couldn&apos;t parse that FEN.</p>}
            {!customStart && moves.length > 0 && (
              <Button tone="ghost"
                onClick={downloadPgn}
                className="mt-3 flex px-3 py-1.5 text-sm">
                <Download size={14} /> Download PGN
              </Button>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

// Lichess's post-game accuracy report, with the two things it is not allowed to
// pretend. First: it is the same plain-chess search as the bar, so it is only
// offered here, on the one board that genuinely has no rules on it. Second: at
// the depth this reaches, "best" and "inaccuracy" are claims a 4-ply search
// cannot always support, so those grades are withheld below depth 3 and the
// panel says which grades it stood behind.
function MoveReviewPanel({
  moves,
  sans,
  moveNums,
  review,
  onStart,
  onReset,
  onJump,
}: {
  moves: Move[];
  sans: string[];
  moveNums: number[];
  review: ReviewState;
  onStart: () => void;
  onReset: () => void;
  onJump: (index: number) => void;
}) {
  const flagged = review.rows.filter(
    (r) => r.cls === "blunder" || r.cls === "mistake" || r.cls === "inaccuracy",
  );
  const white = reviewTally(review.rows, moves, "w");
  const black = reviewTally(review.rows, moves, "b");
  const pct = review.total > 0 ? Math.round((review.scored / review.total) * 100) : 0;

  return (
    <div className="plate p-4">
      <div className="text-[12px] tracking-[0.04em] text-parchment-400">Move review</div>
      {moves.length === 0 ? (
        <p className="mt-2 text-sm text-parchment-400">
          Play a line, or paste one in with ?moves=, then review it.
        </p>
      ) : !review.running && !review.done ? (
        <>
          <p className="mt-2 text-[13px] leading-snug text-parchment-400">
            Scores every position in the line and grades each move by how much of the win it gave
            away. {moves.length + 1} searches, run in idle time.
          </p>
          <Button tone="ghost" onClick={onStart} className="mt-3 px-3 py-1.5 text-sm">
            Review {moves.length} move{moves.length === 1 ? "" : "s"}
          </Button>
        </>
      ) : review.running ? (
        <>
          <p className="mt-2 text-sm text-parchment-300" role="status" aria-live="polite">
            Scoring position {review.scored} of {review.total}
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden border border-[color:var(--edge)] bg-[color:var(--bg-base)]">
            <div
              className="h-full bg-gold-leaf transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-parchment-500" />
            <dd className="text-parchment-400">White</dd>
            <dd className="text-parchment-400">Black</dd>
            {(["blunder", "mistake", "inaccuracy", "best"] as const).map((k) => (
              <TallyRow key={k} kind={k} white={white[k]} black={black[k]} />
            ))}
          </dl>
          {flagged.length > 0 && (
            <ul className="mt-3 space-y-1">
              {flagged.slice(0, 6).map((r) => (
                <li key={r.index}>
                  <button
                    onClick={() => onJump(r.index)}
                    className="flex min-h-[44px] w-full items-baseline gap-2 px-1 text-left text-[13px] transition-colors hover:bg-[color:var(--bg-raised)] [@media(pointer:fine)]:min-h-0"
                  >
                    <span className="font-mono text-parchment-300">
                      {moveNums[r.index]}
                      {moves[r.index].color === "w" ? "." : "..."} {sans[r.index]}
                    </span>
                    <span className={CLASS_TONE[r.cls]}>{CLASS_LABEL[r.cls]}</span>
                    <span className="ml-auto shrink-0 font-mono text-[12px] text-parchment-500">
                      -{r.lossPct.toFixed(0)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[12px] leading-snug text-parchment-500">
            Graded from the same plain-chess search as the bar, at depth 2 with capture sequences
            resolved. That finds hung pieces, losing trades and a takeable king; it does not judge
            quiet positional moves, so &ldquo;best&rdquo; here means the move that wins the tactics,
            not that no better move exists. Loss is win chance given away, not centipawns
            {white.unclear + black.unclear > 0
              ? `; ${white.unclear + black.unclear} of ${moves.length} moves came back at mismatched depths and are left ungraded.`
              : "."}
          </p>
          <Button tone="ghost" onClick={onReset} className="mt-3 px-3 py-1.5 text-sm">
            Clear review
          </Button>
        </>
      )}
    </div>
  );
}

function TallyRow({
  kind,
  white,
  black,
}: {
  kind: "blunder" | "mistake" | "inaccuracy" | "best";
  white: number;
  black: number;
}) {
  return (
    <>
      <dt className={"text-[13px] " + CLASS_TONE[kind]}>{CLASS_LABEL[kind]}</dt>
      <dd className="font-mono text-parchment-100">{white}</dd>
      <dd className="font-mono text-parchment-100">{black}</dd>
    </>
  );
}

export default function AnalysisPage() {
  // `z` already worked on both game pages and now on the saved-game replay.
  // Analysis is the same activity (a board you read rather than play), and
  // the exit control is global, so the binding is all this needs.
  useZenHotkey();
  return (
    <main className="min-h-screen">
      <SiteHeader active="/analysis" />
      <Suspense>
        <AnalysisInner />
      </Suspense>
    </main>
  );
}
