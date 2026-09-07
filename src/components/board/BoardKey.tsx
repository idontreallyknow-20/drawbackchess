"use client";

// The board key: the eleven status classes with their colour, glyph and
// two-word meaning, so a new player can read any mark on the board. Lives in
// the side rail (collapsed by default) and under the board on small screens.

import { BOARD_STATUS, BOARD_STATUS_ORDER, type BoardStatus } from "@/lib/boardStatus";
import { StatusGlyph } from "./StatusGlyph";

export function BoardKey({ only, className }: { only?: BoardStatus[]; className?: string }) {
  const rows = only && only.length ? BOARD_STATUS_ORDER.filter((s) => only.includes(s)) : BOARD_STATUS_ORDER;
  return (
    <div className={"board-key " + (className ?? "")} role="list" aria-label="Board key">
      {rows.map((s) => {
        const d = BOARD_STATUS[s];
        return (
          <div key={s} className="board-key__row" role="listitem" title={d.plain}>
            <span className="board-key__swatch" style={{ ["--st" as string]: d.color }}>
              <StatusGlyph status={s} size={12} />
            </span>
            <span className="board-key__label">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Collapsible wrapper for the rail. */
export function BoardKeyDetails() {
  return (
    <details className="group border-t border-[color:var(--edge)] px-1 pt-2 text-[12px]">
      {/* The block is 12px because the key itself is a legend, which is a set
          of labels. The summary is not: it is the disclosure control, so its
          own text sits at the 13px interactive floor. */}
      <summary className="inline-flex min-h-[44px] cursor-pointer select-none list-none items-center text-[13px] text-parchment-400 hover:text-parchment-200 [@media(pointer:fine)]:min-h-0">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
        Board key
      </summary>
      <BoardKey className="mt-2" />
    </details>
  );
}
