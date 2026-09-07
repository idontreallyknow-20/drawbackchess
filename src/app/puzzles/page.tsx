"use client";

// The daily puzzle.
//
// This is the one surface in the product that works with nobody else online,
// which is the whole reason `docs/improvement-roadmap.md` puts it first: the
// lobby has shown "2 players online", and a puzzle gives someone a reason to
// open the site anyway.
//
// The puzzle of the day is a pure function of the UTC date and the corpus (see
// src/lib/puzzles/daily.ts), so there is nothing to ask a server for and every
// player worldwide is on the same one at the same instant. `?date=YYYY-MM-DD`
// opens an earlier day, which is also how the selection is checked by hand.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { PuzzleRunner } from "@/components/puzzles/PuzzleRunner";
import { PuzzleConnectionNotice, PuzzleSkeleton, PuzzleStates } from "./_components/PuzzleStates";
import { SiteHeader } from "@/components/SiteHeader";
import { Button, LinkButton } from "@/components/ui/Button";
import {
  dailyIndex,
  dayNumber,
  puzzleNumber,
  readableDate,
  shiftDay,
  utcDateKey,
} from "@/lib/puzzles/daily";
import {
  recordDaily,
  solvedServerSnapshot,
  solvedSnapshot,
  streakServerSnapshot,
  streakSnapshot,
  subscribeSession,
} from "@/lib/puzzles/session";
import type { Puzzle, PuzzleFormat } from "@/lib/puzzles/types";
import { usePuzzleCorpus } from "@/lib/puzzles/useCorpus";

const FORMAT_LABEL: Record<PuzzleFormat, string> = {
  "king-hunt": "Capture the king",
  "only-move": "The only legal move",
  "card-choice": "Which card wins",
};

const FORMAT_BLURB: Record<PuzzleFormat, string> = {
  "king-hunt": "A forced sequence that ends with the king off the board.",
  "only-move": "Your handicap leaves one legal move. Reading the rule is the puzzle.",
  "card-choice": "Two cards are offered mid-game. Only one of them wins from here.",
};

// The "what day is it" store.
//
// A date is external state as far as React is concerned, and it can change
// under a page that is left open across UTC midnight, so it is subscribed to
// rather than sampled once. The snapshot is a string that only changes when the
// day does, which keeps it referentially stable between renders.
function subscribeDay(onChange: () => void): () => void {
  const id = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(id);
}
function todaySnapshot(): string {
  return utcDateKey();
}
function serverDaySnapshot(): string | null {
  return null;
}

export default function PuzzlesPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <PuzzlesView />
    </Suspense>
  );
}

function PuzzlesView() {
  const corpus = usePuzzleCorpus();
  const searchParams = useSearchParams();

  // The date is read on the CLIENT only.
  //
  // Deriving it during render would bake the build date into the prerendered
  // HTML and then disagree with the browser on hydration, which is the classic
  // way a "daily" anything ends up showing yesterday. `useSyncExternalStore`
  // says exactly that: the server snapshot is null, the client snapshot is
  // today, and React swaps them without a cascading setState.
  const today = useSyncExternalStore(subscribeDay, todaySnapshot, serverDaySnapshot);

  const requested = searchParams.get("date");
  const dateKey =
    requested && dayNumber(requested) != null && today && requested <= today
      ? requested
      : today;

  const puzzle = useMemo(() => {
    if (!dateKey || !corpus.puzzles.length) return null;
    return corpus.puzzles[dailyIndex(dateKey, corpus.puzzles.length)];
  }, [dateKey, corpus.puzzles]);

  const nextPuzzle = useMemo(() => {
    if (!dateKey || corpus.puzzles.length < 2) return null;
    const i = dailyIndex(dateKey, corpus.puzzles.length);
    return corpus.puzzles[(i + 1) % corpus.puzzles.length];
  }, [dateKey, corpus.puzzles]);

  // The streak reads from storage and is only WRITTEN on the event of solving
  // today's puzzle. recordDaily is a no-op for a day already recorded, so
  // replaying today cannot inflate it.
  const streak = useSyncExternalStore(subscribeSession, streakSnapshot, streakServerSnapshot);
  const handleSolved = useCallback(() => {
    if (!dateKey || dateKey !== today) return;
    recordDaily(dateKey, shiftDay(dateKey, -1));
  }, [dateKey, today]);

  const isToday = dateKey != null && dateKey === today;

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader active="/lobby" />
      <section className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
        <header className="mb-4">
          <h1 className="page-title">Daily puzzle</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-parchment-300">
            There is no checkmate in this game, so a puzzle here ends with the king
            taken. Every one of them was proved by playing out every alternative:
            the answer is the only answer.
          </p>
        </header>

        {dateKey && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <LinkButton
              tone="default"
              size="sm"
              href={`/puzzles?date=${shiftDay(dateKey, -1)}`}
              aria-label="Previous day's puzzle"
            >
              <ChevronLeft size={15} aria-hidden />
              Previous
            </LinkButton>
            <span className="font-mono text-[13px] tabular-nums text-parchment-200">
              Puzzle {puzzleNumber(dateKey)}
            </span>
            <span className="text-[13px] text-parchment-400">{readableDate(dateKey)}</span>
            {!isToday && (
              <LinkButton tone="default" size="sm" href="/puzzles">
                Today
                <ChevronRight size={15} aria-hidden />
              </LinkButton>
            )}
            {streak.days > 1 && (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--pos)]">
                <Check size={14} aria-hidden />
                {streak.days} days in a row
              </span>
            )}
          </div>
        )}

        <PuzzleConnectionNotice corpus={corpus} />

        {corpus.status !== "ready" ? (
          <PuzzleStates corpus={corpus} />
        ) : puzzle && dateKey ? (
          <PuzzleRunner
            key={puzzle.id}
            puzzle={puzzle}
            nextHref={nextPuzzle ? `/puzzles/${nextPuzzle.id}` : undefined}
            onSolved={handleSolved}
          />
        ) : (
          <PuzzleSkeleton status="Picking today's puzzle" />
        )}

        {corpus.status === "ready" && <Archive puzzles={corpus.puzzles} />}
      </section>
    </main>
  );
}

/** Everything past today, folded away. The daily is the one primary thing on
 *  this page (design-system section 4), so the rest is a labelled disclosure
 *  with a count rather than a second wall of cards. */
function Archive({ puzzles }: { puzzles: Puzzle[] }) {
  const [open, setOpen] = useState(false);
  const solved = useSyncExternalStore(subscribeSession, solvedSnapshot, solvedServerSnapshot);

  const groups = useMemo(() => {
    const out = new Map<PuzzleFormat, Puzzle[]>();
    for (const p of puzzles) {
      const list = out.get(p.format) ?? [];
      list.push(p);
      out.set(p.format, list);
    }
    return out;
  }, [puzzles]);

  return (
    <section className="mt-8">
      <Button
        tone="default"
        size="sm"
        block
        align="start"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="font-display text-[15px] font-semibold">Every puzzle</span>
        <span className="ml-auto flex items-center gap-2 text-[13px] text-parchment-400">
          {puzzles.length}
          <ChevronDown
            size={16}
            aria-hidden
            style={{ transform: open ? "rotate(180deg)" : "none" }}
          />
        </span>
      </Button>

      {open && (
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {(["king-hunt", "card-choice", "only-move"] as PuzzleFormat[]).map((format) => {
            const list = groups.get(format) ?? [];
            return (
              <div key={format} className="plate p-3">
                <h2 className="font-display text-[15px] font-semibold text-parchment-50">
                  {FORMAT_LABEL[format]}
                </h2>
                <p className="mt-1 text-[13px] leading-relaxed text-parchment-400">
                  {FORMAT_BLURB[format]}
                </p>
                {list.length === 0 ? (
                  <p className="mt-3 text-[13px] text-parchment-400">
                    None in this build.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-[color:var(--edge)]">
                    {list.map((p) => (
                      <li key={p.id}>
                        <Link
                          href={`/puzzles/${p.id}`}
                          className="flex min-h-[44px] items-center justify-between gap-2 text-[13px] text-parchment-200 hover:text-gold-leaf [@media(pointer:fine)]:min-h-[40px]"
                        >
                          <span className="truncate">{p.rule.name}</span>
                          <span className="flex shrink-0 items-center gap-2 text-parchment-400">
                            {solved.includes(p.id) && (
                              <Check
                                size={14}
                                className="text-[color:var(--pos)]"
                                aria-label="Solved"
                              />
                            )}
                            <span
                              className="font-mono tabular-nums"
                              title="Difficulty out of 5"
                            >
                              {p.difficulty}/5
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
