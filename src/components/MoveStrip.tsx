"use client";

import { movesToSAN } from "@/engine/board";
import { Move } from "@/engine/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

/**
 * The phone move list, Lichess col1 style: one horizontal row of numbered
 * moves under the board that scrolls sideways, kept scrolled to the current
 * ply, with a previous / next button at either end. The desktop rail keeps
 * the two-column MoveList; this is the same data at phone density.
 */
export function MoveStrip({
  moves,
  currentPly = moves.length,
  onPlyChange,
  minPly = 0,
}: {
  moves: Move[];
  currentPly?: number;
  onPlyChange?: (ply: number) => void;
  /** Earliest reviewable ply (see MoveList.minPly). */
  minPly?: number;
}) {
  const sans = useMemo(() => movesToSAN(moves), [moves]);
  // Number by actual move colour, not index parity: extra-move cards let one
  // side move twice, which shifts every later number if you halve the ply.
  const cells = useMemo(() => {
    const out: Array<{ ply: number; san: string; num: number | null }> = [];
    let num = 0;
    let lastColor: "w" | "b" | null = null;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const opensRow = m.color === "w" || lastColor === null || lastColor === "b";
      if (opensRow && m.color === "w") num++;
      if (opensRow && m.color === "b") num++;
      out.push({ ply: i + 1, san: sans[i], num: opensRow ? num : null });
      lastColor = m.color;
    }
    return out;
  }, [moves, sans]);

  const maxPly = moves.length;
  const floorPly = Math.max(0, Math.min(minPly, maxPly));
  const canBack = currentPly > floorPly;
  const canForward = currentPly < maxPly;
  const rowRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const el = activeRef.current;
    // Live head: keep the newest move in view. Reviewing: centre the pick.
    // No active cell at the start of the line (ply 0, or the review floor):
    // rest at the left edge rather than the far right.
    if (!el) {
      row.scrollLeft = currentPly <= floorPly ? 0 : row.scrollWidth;
      return;
    }
    const target = el.offsetLeft - row.clientWidth / 2 + el.offsetWidth / 2;
    row.scrollTo({ left: Math.max(0, target), behavior: "auto" });
  }, [currentPly, floorPly, moves.length]);

  return (
    // 44px, spelled in pixels. `h-11` is 2.75rem, which is 44px only under
    // Tailwind's assumed 16px root; this interface roots at 14px (globals.css),
    // so `h-11` was rendering 38.5px and the two arrows measured 37x39 against
    // the 44px hit floor in design-system.md section 10.
    <div className="flex h-[44px] items-stretch border-y border-[color:var(--edge)] bg-[color:var(--bg-panel)]">
      <button
        type="button"
        aria-label="Previous move"
        disabled={!canBack}
        onClick={() => onPlyChange?.(Math.max(floorPly, currentPly - 1))}
        className="flex w-[44px] shrink-0 items-center justify-center text-parchment-300 transition-colors active:bg-white/[0.06] disabled:opacity-30"
      >
        <ChevronLeft size={18} />
      </button>
      <div
        ref={rowRef}
        className="scrollbar-none flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap px-1 font-mono text-[13px]"
        style={{ scrollbarWidth: "none" }}
      >
        {cells.length === 0 && (
          <span className="mx-auto text-parchment-400">No moves yet</span>
        )}
        {cells.map((c) => {
          const selected = c.ply === currentPly;
          const reachable = c.ply >= floorPly;
          return (
            <span key={c.ply} className="inline-flex items-center">
              {c.num != null && (
                <span className="px-1 text-parchment-400">{c.num}.</span>
              )}
              <button
                ref={selected ? activeRef : undefined}
                type="button"
                disabled={!reachable}
                onClick={() => onPlyChange?.(c.ply)}
                className={
                  // Fill the strip so the ply itself is the target, not a
                  // 36px band inside a 44px row.
                  "min-h-[44px] px-1.5 tabular-nums transition-colors " +
                  (selected
                    ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
                    : "text-parchment-100 active:bg-white/[0.06] disabled:opacity-40")
                }
              >
                {c.san}
              </button>
            </span>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="Next move"
        disabled={!canForward}
        onClick={() => onPlyChange?.(Math.min(maxPly, currentPly + 1))}
        className="flex w-[44px] shrink-0 items-center justify-center text-parchment-300 transition-colors active:bg-white/[0.06] disabled:opacity-30"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
