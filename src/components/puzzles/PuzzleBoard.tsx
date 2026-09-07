"use client";

// The puzzle board.
//
// Deliberately NOT src/components/Board.tsx. That component is the live match:
// premoves, drag ghosts, card VFX, effect popovers, spectator plumbing, roughly
// five thousand lines and the whole animation stack behind it. A puzzle needs a
// position, a click, and an answer, and pulling the match board in would drag
// framer-motion and the card database into a route whose entire job is to load
// fast for someone who came from a search result.
//
// It also gets to do one thing the match board cannot do yet: every square is a
// real focusable control with a spoken name, so this page is playable from the
// keyboard. `docs/lichess-parity-2026-09.md` X1 files that gap against
// Board.tsx; this component is not the fix, but it is not a new instance of it.
//
// Piece art, square colours and the highlight tints are the site's own
// (`Piece`, `.sq-light` / `.sq-dark`, `.sq-sel`, `.sq-last`, `.dot-target`),
// so the board reads as the same board a player sees in a game.

import { Piece } from "@/components/Pieces";
import { FILE, RANK, squareName, type BoardState, type Color, type PieceType } from "@/engine/types";

const PIECE_NAMES: Record<PieceType, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export interface BoardMarks {
  /** Squares the handicap forbids right now (from the rule's own `visual`). */
  banned?: number[];
  /** Squares the handicap wants the player to look at. */
  highlight?: number[];
}

export function PuzzleBoard({
  board,
  orientation,
  selected,
  destinations,
  lastMove,
  marks,
  disabled = false,
  onSquare,
}: {
  board: BoardState;
  orientation: Color;
  selected: number | null;
  /** Squares to dot for the selected piece. Empty means "show nothing", which
   *  is what the only-move format wants: the whole puzzle is which move the
   *  rule permits, so painting the answer would end it. */
  destinations: number[];
  lastMove: { from: number; to: number } | null;
  marks?: BoardMarks;
  disabled?: boolean;
  onSquare: (sq: number) => void;
}) {
  const banned = new Set(marks?.banned ?? []);
  const highlight = new Set(marks?.highlight ?? []);
  const dests = new Set(destinations);

  // Row 0 is the top of the board as drawn, which flips with orientation.
  const squares: number[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = orientation === "w" ? 7 - row : row;
      const file = orientation === "w" ? col : 7 - col;
      squares.push(rank * 8 + file);
    }
  }

  return (
    <div
      role="grid"
      aria-label="Puzzle board"
      className="grid aspect-square w-full grid-cols-8 grid-rows-8 select-none"
      style={{ outline: "1px solid var(--edge)" }}
    >
      {squares.map((sq, i) => {
        const piece = board.pieces[sq];
        const isLight = (FILE(sq) + RANK(sq)) % 2 === 1;
        const name = squareName(sq);
        const isSel = selected === sq;
        const isLast = lastMove ? lastMove.from === sq || lastMove.to === sq : false;
        const isDest = dests.has(sq);
        const label = piece
          ? `${name}, ${piece.color === "w" ? "white" : "black"} ${PIECE_NAMES[piece.type]}`
          : `${name}, empty`;
        const col = i % 8;
        const row = Math.floor(i / 8);
        return (
          <button
            key={sq}
            type="button"
            role="gridcell"
            disabled={disabled}
            aria-label={
              label +
              (banned.has(sq) ? ", barred by your rule" : "") +
              (isDest ? ", move here" : "")
            }
            aria-selected={isSel}
            onClick={() => onSquare(sq)}
            className={
              "relative flex items-center justify-center p-0 " +
              (isLight ? "sq-light" : "sq-dark") +
              (isSel ? " sq-sel" : "") +
              (isLast ? " sq-last" : "") +
              (banned.has(sq) ? " sq-rmb-mark text-[color:var(--accent-danger)]" : "") +
              (highlight.has(sq) && !banned.has(sq) ? " sq-rmb-mark text-[color:var(--sun)]" : "") +
              " focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--accent)]"
            }
            style={{ borderRadius: 0 }}
          >
            {piece && (
              <span className="pointer-events-none block h-[86%] w-[86%]">
                <Piece type={piece.type} color={piece.color} size="100%" />
              </span>
            )}
            {isDest && (
              <span aria-hidden className={piece ? "dot-capture" : "dot-target"} />
            )}
            {col === 0 && (
              <span
                aria-hidden
                className={
                  "pointer-events-none absolute left-1 top-0.5 font-mono text-[12px] font-semibold " +
                  (isLight ? "text-[color:var(--sq-dark)]" : "text-[color:var(--sq-light)]")
                }
              >
                {RANK(sq) + 1}
              </span>
            )}
            {row === 7 && (
              <span
                aria-hidden
                className={
                  "pointer-events-none absolute bottom-0.5 right-1 font-mono text-[12px] font-semibold " +
                  (isLight ? "text-[color:var(--sq-dark)]" : "text-[color:var(--sq-light)]")
                }
              >
                {"abcdefgh"[FILE(sq)]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
