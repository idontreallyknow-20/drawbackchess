"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Board } from "@/components/Board";
import { generateMoves, makeMove } from "@/engine/board";
import { BoardState, Color, Move, PieceType, SQ } from "@/engine/types";
import { Button } from "@/components/ui/Button";

function blankBoard(turn: Color = "w"): BoardState {
  return {
    pieces: Array(64).fill(null),
    turn,
    castling: { wk: false, wq: false, bk: false, bq: false },
    epTarget: null,
    halfmove: 0,
    fullmove: 1,
    history: [],
  };
}

function place(b: BoardState, sq: number, type: PieceType, color: Color) {
  b.pieces[sq] = { type, color };
}

interface Step {
  title: string;
  intro: string;
  setup: () => BoardState;
  goalText: string;
  isComplete: (move: Move, board: BoardState) => boolean;
  closing: string;
}

const STEPS: Step[] = [
  {
    title: "I. Capture the king.",
    intro:
      "There is no checkmate. The king is just another piece on the board: when you can take him, you take him. Your white rook stands on e1. The black king awaits on e4.",
    setup: () => {
      const b = blankBoard("w");
      place(b, SQ(4, 0), "r", "w"); // e1
      place(b, SQ(4, 3), "k", "b"); // e4
      place(b, SQ(0, 0), "k", "w"); // a1
      return b;
    },
    goalText: "Move the rook to e4 and capture the king.",
    isComplete: (m) => m.captured === "k",
    closing:
      "The game ends the instant a king is captured. No mate, no stalemate; only the king leaving the board.",
  },
  {
    title: "II. Castle through anything.",
    intro:
      "Standard chess forbids castling through check. Nerf Chess does not. Your kingside is being raked by a black rook. Castle anyway.",
    setup: () => {
      const b = blankBoard("w");
      place(b, SQ(4, 0), "k", "w"); // e1
      place(b, SQ(7, 0), "r", "w"); // h1
      place(b, SQ(0, 0), "r", "w"); // a1
      place(b, SQ(4, 7), "k", "b"); // e8
      place(b, SQ(5, 6), "r", "b"); // f7 attacks f1
      b.castling.wk = true;
      return b;
    },
    goalText: "Castle kingside (O-O). The king strolls through fire.",
    isComplete: (m) => m.castle === "k",
    closing:
      "His majesty walked through an attacked square. In any other variant, that is illegal. Here, it is simply a risk.",
  },
  {
    title: "III. Step into check.",
    intro:
      "Kings are not protected by check rules. If a square is attacked, your king can still move there; the danger is that your opponent may capture him next.",
    setup: () => {
      const b = blankBoard("w");
      place(b, SQ(4, 0), "k", "w"); // e1
      place(b, SQ(4, 6), "r", "b"); // e7 attacks e2
      place(b, SQ(4, 7), "k", "b"); // e8
      return b;
    },
    goalText: "Move the white king to e2, even though the black rook attacks that square.",
    isComplete: (m) => m.piece === "k" && m.to === SQ(4, 1),
    closing:
      "That move would be illegal in standard chess. Here, danger is allowed; capture is what ends the game. On top of this, a draft deals cards every 5 moves: hexes and boons in Nerf mode, buffs in Buff mode.",
  },
];

export default function TutorialWalkthroughPage() {
  const [stepIx, setStepIx] = useState(0);
  const [board, setBoard] = useState<BoardState>(() => STEPS[0].setup());
  const [done, setDone] = useState(false);

  const step = STEPS[stepIx];

  const moves = useMemo(() => {
    if (done) return [];
    return generateMoves(board).filter((m) => step.isComplete(m, board));
  }, [board, done, step]);

  const onMove = (m: Move) => {
    if (!step.isComplete(m, board)) return;
    setBoard(makeMove(board, m));
    setDone(true);
  };

  const nextStep = () => {
    const i = stepIx + 1;
    if (i >= STEPS.length) {
      window.location.href = "/play";
      return;
    }
    setStepIx(i);
    setBoard(STEPS[i].setup());
    setDone(false);
  };

  const restart = () => {
    setBoard(step.setup());
    setDone(false);
  };

  return (
    <main className="min-h-screen pb-20">
      <nav className="flex items-center justify-between gap-3 px-5 sm:px-10 py-6 sm:py-7">
        <Link href="/" className="font-display text-2xl tracking-tight shrink-0">
          nerf<span className="text-gold-leaf">chess</span>
        </Link>
        <Link href="/tutorial" className="shrink-0 px-3 py-1.5 rounded-[1px] text-sm font-display hover:bg-white/5 text-parchment">
          Back to house rules
        </Link>
      </nav>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-[12px] text-parchment-400">
          interactive walkthrough - step {stepIx + 1} of {STEPS.length}
        </div>
        <h1 className="page-title">{step.title}</h1>
        <p className="mt-3 max-w-2xl text-parchment-200 leading-relaxed">{step.intro}</p>
        <div className="mt-4 plate p-3 px-4 inline-block border-gold/50 bg-gold/10">
          <span className="font-display text-[15px] text-gold-leaf">{step.goalText}</span>
        </div>

        <div className="mt-6 grid lg:grid-cols-[1fr_320px] gap-6">
          <Board
            board={board}
            legalMoves={done ? [] : moves}
            orientation={board.turn}
            onMove={onMove}
            myColor={board.turn}
            disabled={done}
          />
          <aside className="space-y-3">
            {done && (
              <div className="plate p-5 border-verdigris-glow/50 bg-verdigris/10">
                <div className="text-[12px] text-verdigris-glow">well played</div>
                <p className="mt-2 text-parchment leading-relaxed">{step.closing}</p>
                <Button tone="leaf"
                  onClick={nextStep}
                  className="mt-4 w-full py-3">
                  {stepIx + 1 < STEPS.length ? "Next lesson" : "Play a real game"}
                </Button>
              </div>
            )}
            {!done && (
              <div className="plate p-5">
                <div className="text-[12px] text-parchment-400">hint</div>
                <p className="mt-2 text-parchment-200 text-sm leading-relaxed">
                  The board only highlights moves that complete this lesson.
                  Click a piece, then its destination.
                </p>
                <Button tone="ghost"
                  onClick={restart}
                  className="mt-4 w-full py-2 text-sm">
                  Reset the position
                </Button>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
