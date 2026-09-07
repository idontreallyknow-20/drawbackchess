"use client";

import { motion } from "framer-motion";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { Piece } from "./Pieces";
import type { Color, PieceType } from "@/engine/types";

const PIECE_LABEL: Record<PieceType, string> = {
  p: "Pawn",
  n: "Knight",
  b: "Bishop",
  r: "Rook",
  q: "Queen",
  k: "King",
};

/** The only piece types a pocket can ever hold: real, droppable pieces. A king
 * is never bankable, and there is no such thing as a masked pocket entry (the
 * inventory is authoritative per-seat), so anything outside this set is not a
 * real granted piece and is never rendered as a face-down / hidden placeholder. */
const DROPPABLE: readonly PieceType[] = ["p", "n", "b", "r", "q"];

export interface PocketEntry {
  type: PieceType;
  count: number;
}

interface Props {
  /** The viewer's banked pieces (count > 0). Empty renders nothing. */
  entries: PocketEntry[];
  /** Whose pieces these are: the tray always shows the viewer's own colour. */
  color: Color;
  /** The piece type currently armed for a drop (drop mode), or null. */
  activeType: PieceType | null;
  /** Whether a drop can be started right now (viewer's own turn, nothing
   * pending). Off = the tray reads but the pieces are not clickable. */
  canDrop: boolean;
  /** Toggle drop mode for a pocket piece; the same type again cancels. */
  onSelect: (type: PieceType) => void;
  /** Tray caption; defaults to "Pocket". The opponent's read-only tray passes
   * "Their pocket". */
  label?: string;
}

/**
 * Crazyhouse-style pocket tray for the viewer. Lists each banked piece type
 * with its count using the board's own piece art; clicking one arms a drop, and
 * the board then highlights every square where that drop is legal (via the
 * shared pickSquares plumbing). Renders nothing when the pocket is empty.
 *
 * The tray is authoritative: it always paints the ACTUAL piece each inventory
 * slot holds, never a masked or face-down placeholder. The inventory is a
 * per-seat synced record of real piece types, so any entry that is not a real
 * droppable piece (a stray masked value, a zero count, a king) is filtered out
 * rather than shown as a "hidden card". A held pocket piece therefore always
 * reads as exactly the piece you will drop.
 *
 * Look: 1px corners, no gradients/glow/shadow. Mint marks the armed /
 * actionable piece; the count chip rides in coral so it reads at a glance.
 */
export function Pocket({ entries, color, activeType, canDrop, onSelect, label = "Pocket" }: Props) {
  const reduceMotion = useReducedMotion();
  // Authoritative filter: only real, held, droppable pieces ever reach the
  // tray, so a masked value can never surface as a hidden tile.
  const shown = entries.filter(
    (e) => DROPPABLE.includes(e.type) && e.count > 0,
  );
  if (shown.length === 0) return null;
  return (
    <div className="plate flex items-center gap-3 rounded-[1px] px-3 py-2.5">
      <span className="shrink-0 text-[12px] text-parchment-400">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        {shown.map(({ type, count }) => {
          const active = activeType === type;
          return (
            <motion.button
              key={type}
              type="button"
              whileTap={reduceMotion ? undefined : { scale: 0.9 }}
              onClick={() => onSelect(type)}
              disabled={!canDrop && !active}
              aria-pressed={active}
              aria-label={`${PIECE_LABEL[type]} in your pocket, ${count} held`}
              title={
                canDrop || active
                  ? active
                    ? `Cancel ${PIECE_LABEL[type]} drop`
                    : `Drop a ${PIECE_LABEL[type]}`
                  : "Your turn only"
              }
              className={
                "relative flex h-14 w-14 items-center justify-center rounded-[1px] border transition-colors duration-100 " +
                (active
                  ? "border-mint/70 bg-mint/15 "
                  : canDrop
                  ? "cursor-pointer border-white/12 bg-white/[0.03] hover:border-mint/45 hover:bg-mint/10 "
                  : "cursor-not-allowed border-white/10 bg-white/[0.02] opacity-60 ")
              }
            >
              {active && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-[1px] ring-1 ring-inset ring-mint/70 animate-flicker"
                />
              )}
              <Piece type={type} color={color} size={44} />
              <span
                className={
                  "absolute -bottom-1.5 -right-1.5 min-w-[18px] rounded-[1px] border px-1 py-px text-center font-mono text-[12px] font-bold tabular-nums " +
                  (active
                    ? "border-mint/60 bg-ink-950 text-mint-glow"
                    : "border-coral/45 bg-ink-950 text-coral-glow")
                }
              >
                {count}
              </span>
            </motion.button>
          );
        })}
      </div>
      {activeType && (
        <span className="ml-auto hidden shrink-0 text-[12px] text-mint-glow sm:block">
          Pick a square · Esc
        </span>
      )}
    </div>
  );
}
