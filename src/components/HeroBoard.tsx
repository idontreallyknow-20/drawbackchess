"use client";

import { useMemo } from "react";
import { Piece } from "./Pieces";
import { FILE, RANK, type BoardState, type Color, type Move, type PieceType } from "@/engine/types";

// This is the homepage's board. It must stay lightweight: NEVER import from
// "./Board" or "./effects/*". Those pull the full in-game effects stack
// (~24k lines + framer-motion) into the landing route bundle, which is exactly
// the lag this component exists to avoid. It is a non-interactive TV preview —
// no move logic, no animation, no effects.
//
// A quiet, non-interactive board for the landing hero. With no `board` prop it
// shows a real static position (Giuoco Piano, after 3...Bc5) so the page reads
// as "a game in progress" the instant it loads — the board sells the site, not
// copy. When a live/replay `board` is passed it renders that instead.
// White is at the bottom; cells are laid out rank 8 → 1, file a → h, which
// matches FEN reading order exactly, so we can render straight from the FEN.
const FEN = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R";

// Row-major indices (row 0 = rank 8, col 0 = file a) of black's last move,
// Bf8–c5, so the board carries a lit last-move trail like a live game.
const DEMO_LAST_MOVE = new Set([5, 26]);

type Cell = { type: PieceType; color: Color } | null;

function parseFen(fen: string): Cell[] {
  const cells: Cell[] = [];
  for (const ch of fen) {
    if (ch === "/") continue;
    if (ch >= "1" && ch <= "8") {
      for (let i = 0; i < Number(ch); i++) cells.push(null);
    } else {
      const color: Color = ch === ch.toUpperCase() ? "w" : "b";
      cells.push({ type: ch.toLowerCase() as PieceType, color });
    }
  }
  return cells;
}

// Engine square (0..63, rank 0 = white's first rank) → grid index (row 0 =
// rank 8, col 0 = file a). Displayed rank 8-row maps to engine rank 7-row.
const gridIndexOf = (sq: number) => (7 - RANK(sq)) * 8 + FILE(sq);

// A BoardState's 64 pieces, in the hero grid's row-major order.
function cellsFromBoard(board: BoardState): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < 64; i++) {
    const sq = (7 - Math.floor(i / 8)) * 8 + (i % 8);
    const p = board.pieces[sq];
    cells.push(p ? { type: p.type, color: p.color } : null);
  }
  return cells;
}

type HeroBoardProps = {
  /** Live/replay position; falls back to the built-in demo FEN when absent. */
  board?: BoardState;
  /** Highlights from/to with the same .sq-last treatment as the demo. */
  lastMove?: Move | null;
};

export function HeroBoard({ board, lastMove }: HeroBoardProps = {}) {
  const cells = useMemo(
    () => (board ? cellsFromBoard(board) : parseFen(FEN)),
    [board],
  );
  const lastMoveSquares = useMemo(() => {
    if (!board) return DEMO_LAST_MOVE;
    if (!lastMove) return new Set<number>();
    return new Set<number>([gridIndexOf(lastMove.from), gridIndexOf(lastMove.to)]);
  }, [board, lastMove]);

  return (
    // The edge is a 1px outline mixed from the board's own dark square, so it
    // reads on every site theme (no black halo on light, no doubled border
    // inside the .tv-frame gutter on dark).
    <div
      className="hero-board w-full max-w-[560px] mx-auto aspect-square"
      style={{ outline: "1px solid color-mix(in srgb, var(--sq-dark) 60%, black)" }}
    >
      <div className="grid grid-cols-8 grid-rows-8 w-full h-full" aria-hidden>
        {cells.map((cell, i) => {
          const row = Math.floor(i / 8);
          const col = i % 8;
          const isLight = (row + col) % 2 === 0;
          const file = "abcdefgh"[col];
          const rank = 8 - row;
          return (
            <div
              key={i}
              className={
                "relative flex items-center justify-center " +
                (isLight ? "sq-light" : "sq-dark") +
                (lastMoveSquares.has(i) ? " sq-last" : "")
              }
            >
              {cell && (
                <div className="w-[86%] h-[86%]">
                  <Piece type={cell.type} color={cell.color} size="100%" />
                </div>
              )}
              {col === 0 && (
                <span
                  className={
                    "absolute top-0.5 left-1 text-[12px] font-mono font-semibold pointer-events-none " +
                    // Coord tint = the OPPOSITE square colour (board tokens via
                    // --sq-light/--sq-dark), so labels always contrast with the
                    // active board theme instead of using fixed hexes.
                    (isLight ? "text-[color:var(--sq-dark)]" : "text-[color:var(--sq-light)]")
                  }
                >
                  {rank}
                </span>
              )}
              {row === 7 && (
                <span
                  className={
                    "absolute bottom-0.5 right-1 text-[12px] font-mono font-semibold pointer-events-none " +
                    // Coord tint = the OPPOSITE square colour (board tokens via
                    // --sq-light/--sq-dark), so labels always contrast with the
                    // active board theme instead of using fixed hexes.
                    (isLight ? "text-[color:var(--sq-dark)]" : "text-[color:var(--sq-light)]")
                  }
                >
                  {file}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
