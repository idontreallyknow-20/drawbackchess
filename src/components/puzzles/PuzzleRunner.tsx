"use client";

// One puzzle, played.
//
// The rules are not re-implemented here. The component rebuilds the engine game
// the generator proved its claim against (`deserializeGame`) and asks the real
// `legalMoves` whether a click is allowed, so a move the handicap forbids is
// simply absent from the list and the page can say so in the rule's own words.
// The uniqueness of the answer was settled by exhaustive search at generation
// time, which is why a wrong-but-legal move can be rejected outright: every
// alternative at this node has already been played out and shown to fail.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, Lightbulb, RotateCcw, X } from "lucide-react";

import { PuzzleBoard } from "./PuzzleBoard";
import { Button, LinkButton } from "@/components/ui/Button";
import { generateMoves, moveToUCI } from "@/engine/board";
import { BUFF_BY_ID } from "@/engine/buffs/library";
import {
  currentHint,
  deserializeGame,
  legalMoves,
  makeContext,
  pickDraftCard,
  playMove,
  type NerfGame,
} from "@/engine/game";
import { cardPath } from "@/lib/cardCodex";
import {
  markSolved,
  solvedServerSnapshot,
  solvedSnapshot,
  subscribeSession,
} from "@/lib/puzzles/session";
import type { Puzzle } from "@/lib/puzzles/types";
import { TIER_LABEL } from "@/lib/tiers";
import { useReducedMotion } from "@/lib/useReducedMotion";
import type { Move } from "@/engine/types";

type Phase = "card" | "play" | "solved" | "revealed";
type Tone = "ok" | "warn" | "bad";

const GOAL: Record<Puzzle["format"], (p: Puzzle) => string> = {
  "king-hunt": (p) =>
    p.movesToWin === 1
      ? "Capture the king in one. Your rule allows exactly one way."
      : `Capture the king in ${p.movesToWin}, against every defence.`,
  "only-move": () => "Your rule leaves exactly one legal move. Play it.",
  "card-choice": (p) =>
    p.movesToWin === 1
      ? "Two cards are offered. One of them takes the king this turn."
      : `Two cards are offered. One of them forces the king in ${p.movesToWin}.`,
};

/**
 * One puzzle, played.
 *
 * The caller MUST key this by `puzzle.id`. Every piece of state here is seeded
 * from the puzzle in a lazy initializer rather than synced by an effect, which
 * is both faster (no throwaway first render, no cascading setState) and the
 * shape React asks for; a remount on key change is what makes the seeding
 * correct when the puzzle changes.
 */
export function PuzzleRunner({
  puzzle,
  nextHref,
  onSolved,
}: {
  puzzle: Puzzle;
  nextHref?: string;
  /** Fired once, when the puzzle is finished without the answer being shown. */
  onSolved?: () => void;
}) {
  const reduced = useReducedMotion();
  const rebuild = useCallback((): NerfGame => {
    const g = deserializeGame(puzzle.snapshot);
    if (!g) throw new Error("This puzzle's position could not be rebuilt.");
    return g;
  }, [puzzle]);

  const [game, setGame] = useState<NerfGame>(rebuild);
  const [phase, setPhase] = useState<Phase>(
    puzzle.format === "card-choice" ? "card" : "play",
  );
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [lastMove, setLastMove] = useState<{ from: number; to: number } | null>(null);
  const [feedback, setFeedback] = useState<{ tone: Tone; text: string } | null>(null);
  const [wrongCards, setWrongCards] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [busy, setBusy] = useState(false);
  const timers = useRef<number[]>([]);

  const heroPlies = useMemo(() => puzzle.line.filter((p) => p.by === "hero").length, [puzzle]);

  const reset = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    setGame(rebuild());
    setPhase(puzzle.format === "card-choice" ? "card" : "play");
    setStep(0);
    setSelected(null);
    setLastMove(null);
    setFeedback(null);
    setWrongCards([]);
    setMistakes(0);
    setBusy(false);
  }, [puzzle, rebuild]);

  // Timers only. Nothing here sets state on mount.
  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    },
    [],
  );

  const solved = useSyncExternalStore(subscribeSession, solvedSnapshot, solvedServerSnapshot);
  const solvedBefore = solved.includes(puzzle.id);

  // The rule's own board markings and its live hint, exactly as a match shows
  // them. A handicap with a rolled parameter ("no captures on a random rank")
  // is only fair to put in a puzzle because these are rendered.
  const ruleView = useMemo(() => {
    if (game.result) return { marks: {}, hint: null, progress: null };
    const slot = puzzle.hero === "w" ? game.white : game.black;
    const ctx = makeContext(game, puzzle.hero);
    let marks: { banned?: number[]; highlight?: number[] } = {};
    try {
      const v = slot.nerf.visual?.(slot.state, ctx);
      if (v) {
        marks = {
          banned: [...(v.bannedSquares ?? []), ...(v.waterSquares ?? [])],
          highlight: [
            ...(v.highlightSquares ?? []),
            ...(v.duckSquare != null ? [v.duckSquare] : []),
          ],
        };
      }
    } catch {
      marks = {};
    }
    let hint: { text: string; squares?: number[]; tone?: string } | null = null;
    try {
      hint = currentHint(game, puzzle.hero);
    } catch {
      hint = null;
    }
    let progress: { label: string } | null = null;
    try {
      progress = slot.nerf.progress?.(slot.state, ctx) ?? null;
    } catch {
      progress = null;
    }
    return { marks, hint, progress };
  }, [game, puzzle.hero]);

  const legal = useMemo(() => (game.result ? [] : legalMoves(game)), [game]);

  // Destination dots.
  //
  // Every format but one paints the REAL legal set, which is what a live board
  // does. `only-move` paints the plain chess moves instead: its entire subject
  // is which of them the rule permits, so dotting the legal set would hand over
  // the answer before the player has read the card.
  const destinations = useMemo(() => {
    if (selected == null || phase !== "play") return [];
    const source =
      puzzle.format === "only-move"
        ? generateMoves(game.board)
        : legal;
    return source.filter((m) => m.from === selected).map((m) => m.to);
  }, [selected, game, legal, phase, puzzle.format]);

  const finish = useCallback(() => {
    setPhase("solved");
    setSelected(null);
    markSolved(puzzle.id);
    onSolved?.();
  }, [puzzle.id, onSolved]);

  const applyMove = useCallback(
    (g: NerfGame, move: Move) => {
      playMove(g, move);
      setLastMove({ from: move.from, to: move.to });
    },
    [],
  );

  const attempt = useCallback(
    (from: number, to: number) => {
      if (phase !== "play" || busy) return;
      const expected = puzzle.line[step];
      if (!expected || expected.by !== "hero") return;

      const candidates = legal.filter((m) => m.from === from && m.to === to);
      if (!candidates.length) {
        const pseudo = generateMoves(game.board).some((m) => m.from === from && m.to === to);
        setSelected(null);
        if (pseudo) {
          setMistakes((n) => n + 1);
          setFeedback({
            tone: "bad",
            text: `${puzzle.rule.name} does not allow that move.`,
          });
        }
        return;
      }
      const move = candidates.find((m) => m.promotion === "q") ?? candidates[0];
      const uci = moveToUCI(move);
      setSelected(null);
      if (uci !== expected.uci) {
        setMistakes((n) => n + 1);
        setFeedback({
          tone: "warn",
          text:
            puzzle.format === "only-move"
              ? "Legal, but not the move this puzzle wants."
              : "That is legal, and it lets them off. Every other move here has been checked.",
        });
        return;
      }

      const next = deserializeGame(puzzle.snapshot);
      if (!next) return;
      // Replay from the snapshot rather than mutating in place, so the board a
      // player sees is always a state the engine produced from the stored line.
      for (let i = 0; i <= step; i++) {
        const ply = puzzle.line[i];
        if (puzzle.format === "card-choice" && i === 0) {
          const idx = (puzzle.cards ?? []).findIndex((c) => c.wins);
          pickDraftCard(next, puzzle.hero, idx);
        }
        const m = legalMoves(next).find((x) => moveToUCI(x) === ply.uci);
        if (!m) return;
        applyMove(next, m);
      }
      setGame(next);
      setFeedback({ tone: "ok", text: "Right." });

      const foePly = puzzle.line[step + 1];
      if (!foePly || foePly.by !== "foe") {
        setStep(step + 1);
        if (next.result || step + 1 >= puzzle.line.length) finish();
        return;
      }

      setBusy(true);
      const delay = reduced ? 0 : 320;
      const id = window.setTimeout(() => {
        const m = legalMoves(next).find((x) => moveToUCI(x) === foePly.uci);
        if (m) applyMove(next, m);
        setGame({ ...next });
        setStep(step + 2);
        setBusy(false);
        setFeedback({ tone: "ok", text: `They answer ${foePly.san}. Finish it.` });
        if (step + 2 >= puzzle.line.length) finish();
      }, delay);
      timers.current.push(id);
    },
    [game, phase, busy, puzzle, step, legal, reduced, applyMove, finish],
  );

  const onSquare = useCallback(
    (sq: number) => {
      if (phase !== "play" || busy) return;
      const piece = game.board.pieces[sq];
      if (selected == null) {
        if (piece && piece.color === puzzle.hero) setSelected(sq);
        return;
      }
      if (sq === selected) {
        setSelected(null);
        return;
      }
      if (piece && piece.color === puzzle.hero && !destinations.includes(sq)) {
        setSelected(sq);
        return;
      }
      attempt(selected, sq);
    },
    [game, phase, busy, selected, destinations, puzzle.hero, attempt],
  );

  const chooseCard = useCallback(
    (index: number) => {
      if (phase !== "card") return;
      const card = (puzzle.cards ?? [])[index];
      if (!card) return;
      if (!card.wins) {
        setMistakes((n) => n + 1);
        setWrongCards((prev) => (prev.includes(card.id) ? prev : [...prev, card.id]));
        setFeedback({
          tone: "bad",
          text: `${card.name} changes nothing here. Every follow-up was checked and none of them forces the king.`,
        });
        return;
      }
      const next = deserializeGame(puzzle.snapshot);
      if (!next) return;
      pickDraftCard(next, puzzle.hero, index);
      setGame(next);
      setPhase("play");
      setFeedback({ tone: "ok", text: `${card.name} taken. Now take the king.` });
    },
    [phase, puzzle],
  );

  const reveal = useCallback(() => {
    const next = deserializeGame(puzzle.snapshot);
    if (!next) return;
    if (puzzle.format === "card-choice") {
      const idx = (puzzle.cards ?? []).findIndex((c) => c.wins);
      pickDraftCard(next, puzzle.hero, idx);
    }
    let last: { from: number; to: number } | null = null;
    for (const ply of puzzle.line) {
      const m = legalMoves(next).find((x) => moveToUCI(x) === ply.uci);
      if (!m) break;
      playMove(next, m);
      last = { from: m.from, to: m.to };
    }
    setGame(next);
    setLastMove(last);
    setSelected(null);
    setPhase("revealed");
    setFeedback({ tone: "warn", text: "Answer shown. The line below is the proven one." });
  }, [puzzle]);

  const heroDone = puzzle.line.filter((p, i) => p.by === "hero" && i < step).length;
  const answered = phase === "solved" || phase === "revealed";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="mx-auto w-full max-w-[560px]">
        <PuzzleBoard
          board={game.board}
          orientation={puzzle.hero}
          selected={selected}
          destinations={destinations}
          lastMove={lastMove}
          marks={ruleView.marks}
          disabled={phase !== "play" || busy}
          onSquare={onSquare}
        />
        <p className="mt-2 text-[13px] text-parchment-400">
          {puzzle.hero === "w" ? "White" : "Black"} to move, from the bottom.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="plate p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-display text-[15px] font-semibold text-parchment-50">
              Your rule
            </h2>
            <span className="text-[12px] text-parchment-400">
              {TIER_LABEL[puzzle.rule.tier] ?? `Tier ${puzzle.rule.tier}`}
            </span>
          </div>
          <Link
            href={`/codex/nerf/${puzzle.rule.id}`}
            // 21px tall: a full-width block link whose height is its line box.
            // Both rule links are the route out of a puzzle into the card that
            // explains it, which is the one thing a stuck player reaches for.
            className="mt-1 flex min-h-[44px] items-center text-[14px] font-semibold text-gold-leaf hover:underline [@media(pointer:fine)]:min-h-0"
          >
            {puzzle.rule.name}
          </Link>
          <p className="mt-1 text-[13px] leading-relaxed text-parchment-200">
            {puzzle.rule.description}
          </p>
          {ruleView.progress && (
            <p className="mt-1.5 font-mono text-[12px] tabular-nums text-parchment-400">
              {ruleView.progress.label}
            </p>
          )}
          {ruleView.hint && (
            <p className="mt-1.5 text-[12px] text-parchment-300">{ruleView.hint.text}</p>
          )}
        </div>

        {puzzle.foeRule && (
          <div className="plate p-3">
            <h2 className="font-display text-[15px] font-semibold text-parchment-50">
              Their rule
            </h2>
            <Link
              href={`/codex/nerf/${puzzle.foeRule.id}`}
              // 21px tall: a full-width block link whose height is its line box.
            // Both rule links are the route out of a puzzle into the card that
            // explains it, which is the one thing a stuck player reaches for.
            className="mt-1 flex min-h-[44px] items-center text-[14px] font-semibold text-gold-leaf hover:underline [@media(pointer:fine)]:min-h-0"
            >
              {puzzle.foeRule.name}
            </Link>
            <p className="mt-1 text-[13px] leading-relaxed text-parchment-200">
              {puzzle.foeRule.description}
            </p>
          </div>
        )}

        <div className="plate p-3">
          <h2 className="font-display text-[15px] font-semibold text-parchment-50">
            {phase === "card" ? "Pick a card" : "Goal"}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-parchment-200">
            {GOAL[puzzle.format](puzzle)}
          </p>
          {puzzle.format !== "only-move" && phase === "play" && (
            <p className="mt-1.5 font-mono text-[12px] tabular-nums text-parchment-400">
              {heroDone} of {heroPlies} moves played
            </p>
          )}
        </div>

        {phase === "card" && (
          <div className="grid gap-2">
            {(puzzle.cards ?? []).map((card, i) => {
              const rejected = wrongCards.includes(card.id);
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => chooseCard(i)}
                  disabled={rejected}
                  className={
                    "plate plate-hover min-h-[44px] p-3 text-left [@media(pointer:fine)]:min-h-0 " +
                    (rejected ? "opacity-50" : "")
                  }
                  // Opacity only, per design-system section 6. `.plate-hover`
                  // owns the hover lift; this is just the fade a rejected card
                  // takes when it is struck out.
                  style={{
                    transition: reduced ? "none" : "opacity var(--dur-2) var(--ease-out)",
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-display text-[14px] font-semibold text-parchment-50">
                      {card.name}
                    </span>
                    <span
                      className={`tier-bg-${card.tier} shrink-0 border px-1.5 py-0.5 text-[12px] tier-${card.tier}`}
                      style={{ borderRadius: 3 }}
                    >
                      {TIER_LABEL[card.tier] ?? `Tier ${card.tier}`}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-parchment-300">
                    {card.description}
                  </p>
                  {rejected && (
                    <p className="mt-1 text-[12px] text-[color:var(--accent-danger)]">
                      Checked: this one does not force anything.
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div
          role="status"
          aria-live="polite"
          className="min-h-[44px] px-1 text-[13px] leading-relaxed"
          style={{
            transition: reduced ? "none" : "opacity var(--dur-2) var(--ease-out)",
            opacity: feedback || answered ? 1 : 0.001,
          }}
        >
          {phase === "solved" ? (
            <span className="inline-flex items-center gap-1.5 text-[color:var(--pos)]">
              <Check size={15} aria-hidden />
              Solved{mistakes === 0 ? " first time." : ` after ${mistakes} wrong ${mistakes === 1 ? "try" : "tries"}.`}
            </span>
          ) : feedback ? (
            <span
              className={
                "inline-flex items-start gap-1.5 " +
                (feedback.tone === "ok"
                  ? "text-[color:var(--pos)]"
                  : feedback.tone === "bad"
                    ? "text-[color:var(--accent-danger)]"
                    : "text-parchment-200")
              }
            >
              {feedback.tone === "ok" ? (
                <Check size={15} className="mt-0.5 shrink-0" aria-hidden />
              ) : (
                <X size={15} className="mt-0.5 shrink-0" aria-hidden />
              )}
              {feedback.text}
            </span>
          ) : (
            <span className="text-parchment-400">
              {solvedBefore ? "You have solved this one before." : " "}
            </span>
          )}
        </div>

        {answered && (
          <div className="plate p-3">
            <h2 className="font-display text-[15px] font-semibold text-parchment-50">
              The proven line
            </h2>
            <ol className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[13px] tabular-nums text-parchment-200">
              {puzzle.line.map((ply, i) => (
                <li
                  key={`${ply.uci}-${i}`}
                  className={ply.by === "hero" ? "text-gold-leaf" : "text-parchment-400"}
                >
                  {ply.san}
                </li>
              ))}
            </ol>
            {puzzle.cards && (
              <p className="mt-2 text-[13px] text-parchment-300">
                The winning card was{" "}
                {(() => {
                  const winner = puzzle.cards.find((c) => c.wins)!;
                  const def = BUFF_BY_ID[winner.id];
                  return def ? (
                    <Link href={cardPath(def)} className="text-gold-leaf hover:underline">
                      {winner.name}
                    </Link>
                  ) : (
                    winner.name
                  );
                })()}
                .
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!answered && (
            <Button tone="default" size="sm" onClick={reveal}>
              <Lightbulb size={15} aria-hidden />
              Show the answer
            </Button>
          )}
          <Button tone="default" size="sm" onClick={reset}>
            <RotateCcw size={15} aria-hidden />
            {answered ? "Play it again" : "Start over"}
          </Button>
          {answered && nextHref && (
            <LinkButton tone="primary" size="sm" href={nextHref}>
              Next puzzle
            </LinkButton>
          )}
        </div>
      </div>
    </div>
  );
}
