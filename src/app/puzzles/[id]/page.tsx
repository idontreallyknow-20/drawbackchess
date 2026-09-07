"use client";

// A single puzzle by id: the shareable, linkable form of everything the daily
// serves. The archive on /puzzles links here, and "Next puzzle" walks the
// corpus from wherever you are.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";

import { PuzzleRunner } from "@/components/puzzles/PuzzleRunner";
import {
  PuzzleConnectionNotice,
  PuzzleSkeleton,
  PuzzleStates,
} from "../_components/PuzzleStates";
import { SiteHeader } from "@/components/SiteHeader";
import { EmptyState } from "@/components/EmptyState";
import type { Puzzle, PuzzleFormat } from "@/lib/puzzles/types";
import { usePuzzleCorpus } from "@/lib/puzzles/useCorpus";

const TITLE: Record<PuzzleFormat, (p: Puzzle) => string> = {
  "king-hunt": (p) =>
    p.movesToWin === 1 ? "Capture the king in one" : `Capture the king in ${p.movesToWin}`,
  "only-move": () => "Find the only move your rule allows",
  "card-choice": () => "Two cards. Which one wins?",
};

export default function PuzzleByIdPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const corpus = usePuzzleCorpus();

  const index = useMemo(
    () => corpus.puzzles.findIndex((p) => p.id === id),
    [corpus.puzzles, id],
  );
  const puzzle = index >= 0 ? corpus.puzzles[index] : null;
  const next =
    corpus.puzzles.length > 1
      ? corpus.puzzles[(Math.max(0, index) + 1) % corpus.puzzles.length]
      : null;

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader active="/lobby" />
      <section className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
        <p className="text-[13px] text-parchment-400">
          <Link href="/puzzles" className="hover:text-gold-leaf">
            Daily puzzle
          </Link>
        </p>
        <h1 className="page-title mt-1">
          {puzzle ? TITLE[puzzle.format](puzzle) : "Puzzle"}
        </h1>
        {puzzle && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-parchment-300">
            {puzzle.tags.map((t) => (
              <span key={t}>{t}</span>
            ))}
            <span className="font-mono tabular-nums text-parchment-400">
              Difficulty {puzzle.difficulty}/5
            </span>
          </p>
        )}

        <div className="mt-4">
          <PuzzleConnectionNotice corpus={corpus} />
          {corpus.status !== "ready" ? (
            <PuzzleStates corpus={corpus} />
          ) : puzzle ? (
            <PuzzleRunner
              key={puzzle.id}
              puzzle={puzzle}
              nextHref={next ? `/puzzles/${next.id}` : undefined}
            />
          ) : id ? (
            <EmptyState
              glyph="♞"
              title="No puzzle with that id"
              body="Puzzles are regenerated in batches, so an old link can stop resolving. Today's is always one click away."
              action={{ href: "/puzzles", label: "Today's puzzle" }}
              secondary={{ href: "/play", label: "Play the computer" }}
            />
          ) : (
            <PuzzleSkeleton />
          )}
        </div>
      </section>
    </main>
  );
}
