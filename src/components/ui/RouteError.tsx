"use client";

// The shared body of every route-level error boundary.
//
// Design system section 8 spells out what an error state owes the player: what
// failed in plain words, a Retry, and a way out. Never a dead end. The three
// halves are easy to get wrong once per route, so they are authored once here
// and each `error.tsx` supplies only the sentence that is actually specific to
// it ("The leaderboard could not load"), which is the part a generic boundary
// can never say.
//
// Retry is wired to Next's `retry()`, not `reset()`. `reset()` re-renders the
// boundary's children with whatever it already has; `retry()` re-fetches them
// first, which is what a player pressing a button labelled Retry means. Both
// props are passed to an error component (next 16.3; `retry` went stable in
// 16.3.0), and the root boundary still uses `reset` because it sits above the
// data.
//
// No SiteHeader here on purpose: the nav is rendered by each page rather than
// by a layout, so a failed segment has no shell to keep, and the header does
// its own fetching (session, challenges, notifications) which may be exactly
// what just broke. The way-out link carries the navigation instead.

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui/Button";

export function RouteError({
  error,
  retry,
  title,
  detail,
  back = { href: "/lobby", label: "Back to lobby" },
}: {
  error: Error & { digest?: string };
  retry: () => void;
  /** What failed, as a short sentence fragment. Sentence case (section 11). */
  title: string;
  /** One plain-words line on what it means and what to try. */
  detail: string;
  /** The way out. Defaults to the lobby, which is the site's home base. */
  back?: { href: string; label: string };
}) {
  useEffect(() => {
    // Surfaced for the browser console and any attached reporter. The digest
    // is the only handle a player can quote back, so it is shown below too.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-6">
      <div className="plate w-full max-w-md p-5 sm:p-6" role="alert">
        <div className="text-[12px] text-parchment-400">Something went wrong</div>
        <h1 className="page-title mt-1">{title}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-parchment-300">{detail}</p>
        {error.digest && (
          <p className="mt-2 font-mono text-[12px] text-parchment-500">
            Reference {error.digest}
          </p>
        )}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button tone="primary" onClick={retry}>
            Retry
          </Button>
          <LinkButton tone="default" href={back.href}>
            {back.label}
          </LinkButton>
        </div>
      </div>
    </main>
  );
}
