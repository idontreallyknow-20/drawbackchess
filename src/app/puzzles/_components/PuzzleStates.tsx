"use client";

// The five system states around the puzzle corpus, in one place.
//
// Design-system section 8 asks every async surface for loading, empty, error,
// disconnected and recovered, and `/tv` is the reference implementation. Both
// puzzle routes load the same file and owe the same five answers, so they are
// written once here instead of twice and slightly differently.
//
// Route-private (`_components/`, the same shape as src/app/codex/_components)
// rather than in src/components: these screens are this section's chrome, not a
// reusable widget. The board and the runner, which another surface could
// plausibly want one day, live in src/components/puzzles instead.

import { Radio, WifiOff } from "lucide-react";

import { Button, LinkButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/EmptyState";
import type { Corpus } from "@/lib/puzzles/useCorpus";

/** Loading: the board's exact geometry as shimmer, never a spinner page. */
export function PuzzleSkeleton({ status = "Loading the puzzle" }: { status?: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="relative aspect-square w-full overflow-hidden border border-[color:var(--edge)]">
          <div className="grid h-full w-full grid-cols-8 grid-rows-8" aria-hidden>
            {Array.from({ length: 64 }).map((_, i) => {
              const isLight = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
              return <div key={i} className={isLight ? "sq-light" : "sq-dark"} />;
            })}
          </div>
          <div className="skeleton absolute inset-0" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-[color:var(--bg-base)] px-3 py-2">
            <Radio size={14} className="animate-flicker text-gold-leaf" aria-hidden />
            <p role="status" aria-live="polite" className="text-[12px] text-parchment-200">
              {status}
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="plate p-3">
            <div className="skeleton h-4 w-24" style={{ borderRadius: 1 }} />
            <div className="skeleton mt-2 h-3 w-full" style={{ borderRadius: 1 }} />
            <div className="skeleton mt-1.5 h-3 w-2/3" style={{ borderRadius: 1 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Everything except the ready state.
 *
 * Returns null when there is nothing to say, so a page can render this above
 * its content and let it stay out of the way while the puzzle is playable.
 */
export function PuzzleStates({ corpus }: { corpus: Corpus }) {
  if (corpus.status === "loading") return <PuzzleSkeleton />;

  if (corpus.status === "disconnected") {
    return (
      <div className="plate flex flex-col items-center gap-3 px-6 py-10 text-center" role="status">
        <WifiOff size={22} className="text-parchment-400" aria-hidden />
        <div>
          <h2 className="font-display text-lg font-semibold text-parchment-50">
            You are offline
          </h2>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-parchment-300">
            The puzzles are one small file and they load once. This page will pick
            itself up as soon as the connection is back.
          </p>
        </div>
        <Button tone="default" size="sm" onClick={corpus.retry}>
          Try now
        </Button>
      </div>
    );
  }

  if (corpus.status === "error") {
    return (
      <div className="plate p-5" role="alert">
        <h2 className="font-display text-lg font-semibold text-parchment-50">
          The puzzles could not load
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-parchment-300">
          {corpus.error ?? "The puzzle file could not be read."} Nothing else on the
          site is affected.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button tone="primary" size="sm" onClick={corpus.retry}>
            Retry
          </Button>
          <LinkButton tone="default" size="sm" href="/lobby">
            Back to lobby
          </LinkButton>
        </div>
      </div>
    );
  }

  if (corpus.status === "empty") {
    return (
      <EmptyState
        glyph="♞"
        title="No puzzles published yet"
        body="The generator has not produced a checked corpus for this build. A game against the computer is the next best thing while nobody is online."
        action={{ href: "/play", label: "Play the computer" }}
        secondary={{ href: "/codex", label: "Read the card library" }}
      />
    );
  }

  return null;
}

/** The two non-blocking notices: a live outage, and a recovery worth saying. */
export function PuzzleConnectionNotice({ corpus }: { corpus: Corpus }) {
  if (corpus.status !== "ready") return null;
  if (corpus.offline) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="mb-3 flex items-center gap-2 border border-[color:var(--edge)] bg-[color:var(--bg-panel)] px-3 py-2 text-[13px] text-parchment-200"
        style={{ borderRadius: "var(--ui-roundness)" }}
      >
        <WifiOff size={14} className="shrink-0 text-parchment-400" aria-hidden />
        Offline. The puzzle is already loaded, so it keeps working.
      </p>
    );
  }
  if (corpus.recovered) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="mb-3 border border-[color:var(--edge)] bg-[color:var(--bg-panel)] px-3 py-2 text-[13px] text-[color:var(--pos)]"
        style={{ borderRadius: "var(--ui-roundness)" }}
      >
        Back online.
      </p>
    );
  }
  return null;
}
