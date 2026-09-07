"use client";

import { movesToSAN } from "@/engine/board";
import { BoardState, Move } from "@/engine/types";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { type MutableRefObject, type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";

export function MoveList({
  moves,
  currentPly = moves.length,
  onPlyChange,
  minPly = 0,
  compact = false,
  showHeader = true,
  footer,
  startBoard,
  navBlocked = false,
}: {
  moves: Move[];
  currentPly?: number;
  onPlyChange?: (ply: number) => void;
  /** Earliest ply navigation may reach. Cards can rewrite the board outside
   * move history (summons, removals, teleports), and positions before the
   * last faithful snapshot can't be rebuilt by replaying the move list — the
   * game pages pass the first replayable ply here so the back controls stop
   * at it (with a notice) instead of silently showing a wrong or live board. */
  minPly?: number;
  compact?: boolean;
  showHeader?: boolean;
  footer?: ReactNode;
  /** Position the move list starts from, when it isn't the standard opening
   *  (the analysis board can be set up from an arbitrary FEN). Only used to
   *  disambiguate the notation. */
  startBoard?: BoardState;
  /** Something else owns the board (result panel, buff targeting, a draft
   *  front-and-center): the global arrow-key navigation stays off, matching
   *  the wheel navigation the game pages gate the same way. */
  navBlocked?: boolean;
}) {
  // Notation is disambiguated by replaying the line ("Nbd2" vs "Nfd2"), which
  // costs one replay per list change rather than one per render.
  const sans = useMemo(() => movesToSAN(moves, startBoard), [moves, startBoard]);
  // Build rows by ACTUAL move color, not index parity. This variant lets a
  // player move twice in a row (extra-move buffs like Onslaught), so pairing
  // moves[i]/moves[i+1] as white/black shifts every later move into the wrong
  // column and desyncs the numbers. Rule: a black move always closes its row;
  // a second white move opens a new one. Consecutive same-color moves each get
  // their own row, and a row holding only a black move shows "..." where white
  // would be. Plies are the real 1-based indices so navigation stays correct.
  type Cell = { san: string; ply: number } | null;
  const rows: { num: number; w: Cell; b: Cell }[] = [];
  {
    let num = 1;
    let cur: { num: number; w: Cell; b: Cell } = { num, w: null, b: null };
    for (let i = 0; i < moves.length; i++) {
      const cell: Cell = { san: sans[i], ply: i + 1 };
      if (moves[i].color === "w") {
        if (cur.w) {
          rows.push(cur);
          cur = { num: ++num, w: null, b: null };
        }
        cur.w = cell;
      } else {
        cur.b = cell;
        rows.push(cur);
        cur = { num: ++num, w: null, b: null };
      }
    }
    if (cur.w || cur.b) rows.push(cur);
  }
  const maxPly = moves.length;
  // The reachable floor: never past the head (a fully locked history passes
  // minPly === maxPly, which disables every control below).
  const floorPly = Math.max(0, Math.min(minPly, maxPly));
  const canBack = currentPly > floorPly;
  const canForward = currentPly < maxPly;
  const jumpTo = useCallback(
    (ply: number) => onPlyChange?.(Math.max(floorPly, Math.min(ply, maxPly))),
    [onPlyChange, floorPly, maxPly],
  );
  const rootClass = compact ? "plate p-2 min-h-0 h-full flex flex-col" : "plate p-4";
  const titleClass = compact
    ? "text-[12px] text-parchment-400 truncate"
    : "text-[12px] text-parchment-400";
  const selectedMoveRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedMoveRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentPly]);

  useEffect(() => {
    if (!onPlyChange || navBlocked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isTyping) return;
      if (event.key === "ArrowLeft" && canBack) {
        event.preventDefault();
        jumpTo(currentPly - 1);
      } else if (event.key === "ArrowRight" && canForward) {
        event.preventDefault();
        jumpTo(currentPly + 1);
      } else if (event.key === "ArrowUp" && canBack) {
        event.preventDefault();
        jumpTo(floorPly);
      } else if (event.key === "ArrowDown" && canForward) {
        event.preventDefault();
        jumpTo(maxPly);
      } else if (event.key === "Escape" && canForward) {
        // Escape always bails out of review back to the live position. No
        // preventDefault: other Escape listeners (dismissing the result
        // panel, clearing board drawings) still get their turn.
        jumpTo(maxPly);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canBack, canForward, currentPly, floorPly, jumpTo, maxPly, navBlocked, onPlyChange]);

  return (
    <div className={rootClass + (compact ? " overflow-hidden" : "")}>
      {showHeader && (
        <div className="flex shrink-0 items-center justify-between gap-2 mb-2">
          <div className={titleClass}>{compact ? "History" : "Move history"}</div>
          <div className="font-mono text-[12px] text-parchment-400 tabular-nums">
            {currentPly}/{moves.length}
          </div>
        </div>
      )}
      <div className="grid shrink-0 grid-cols-4 gap-1 mb-2">
        <HistoryButton label="To start" disabled={!canBack} onClick={() => jumpTo(floorPly)}>
          <ChevronsLeft size={15} />
        </HistoryButton>
        <HistoryButton label="Previous move" disabled={!canBack} onClick={() => jumpTo(currentPly - 1)}>
          <ChevronLeft size={15} />
        </HistoryButton>
        <HistoryButton label="Next move" disabled={!canForward} onClick={() => jumpTo(currentPly + 1)}>
          <ChevronRight size={15} />
        </HistoryButton>
        <HistoryButton label="To latest" disabled={!canForward} onClick={() => jumpTo(moves.length)}>
          <ChevronsRight size={15} />
        </HistoryButton>
      </div>
      {floorPly > 0 && moves.length > 0 && (
        <p className="shrink-0 mb-2 text-[12px] leading-snug text-parchment-400">
          {floorPly >= maxPly
            ? "Earlier positions can't be replayed: a card rewrote the board mid-game."
            : "Positions before this point can't be replayed: a card rewrote the board."}
        </p>
      )}
      {rows.length === 0 && (
        <div className="min-h-0 text-parchment-400 text-sm">No moves yet.</div>
      )}
      <div
        className={
          "font-mono space-y-0.5 overflow-y-auto pr-1 " +
          (compact ? "min-h-0 flex-1 text-[13px]" : "max-h-72 text-[13px]")
        }
      >
        {rows.map((row, i) => (
          <div
            key={i}
            className={
              "grid gap-1 " +
              (compact ? "grid-cols-[1.6rem_minmax(0,1fr)_minmax(0,1fr)]" : "grid-cols-[2.2rem_1fr_1fr]")
            }
          >
            <span className="text-parchment-400">{row.num}.</span>
            {row.w ? (
              <MoveCell
                ply={row.w.ply}
                selected={currentPly === row.w.ply}
                onSelect={onPlyChange ? jumpTo : undefined}
                selectedRef={selectedMoveRef}
              >
                {row.w.san}
              </MoveCell>
            ) : (
              <span className="px-1 py-0.5 text-parchment-500 select-none">...</span>
            )}
            {row.b ? (
              <MoveCell
                ply={row.b.ply}
                selected={currentPly === row.b.ply}
                onSelect={onPlyChange ? jumpTo : undefined}
                selectedRef={selectedMoveRef}
              >
                {row.b.san}
              </MoveCell>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {footer && <div className="shrink-0 mt-3 pt-3 border-t border-parchment-300/10">{footer}</div>}
    </div>
  );
}

function HistoryButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="h-11 sm:h-7 inline-flex items-center justify-center border border-parchment-300/10 bg-white/[0.03] text-parchment-200 hover:border-gold/50 hover:text-gold-leaf disabled:opacity-35 disabled:cursor-not-allowed transition"
    >
      {children}
    </button>
  );
}

function MoveCell({
  ply,
  selected,
  onSelect,
  selectedRef,
  children,
}: {
  ply: number;
  selected: boolean;
  onSelect?: (ply: number) => void;
  selectedRef?: MutableRefObject<HTMLButtonElement | null>;
  children: string;
}) {
  if (!children) return <span />;
  return (
    <button
      ref={selected ? selectedRef : undefined}
      type="button"
      onClick={() => onSelect?.(ply)}
      className={
        "min-w-0 text-left px-1 py-0.5 truncate transition " +
        (selected
          ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
          : "text-parchment hover:bg-white/[0.04]")
      }
    >
      {children}
    </button>
  );
}
