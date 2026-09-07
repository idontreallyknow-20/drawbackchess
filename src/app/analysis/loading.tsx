// Route skeleton for /analysis: the board column (eval bar beside a square
// board and the move-navigation row) with the analysis rail to its right.
//
// The analysis page ships the board, the move list, and the engine bridge, so
// the chunk is one of the heavier ones on the site. Without this the route sat
// on a blank screen and then dropped a full board into it.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen">
      <SkeletonHeader />
      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="mx-auto flex w-full max-w-[640px] gap-3">
            {/* Eval bar: a 24px column that only exists from `sm`. */}
            <div className="skeleton hidden w-6 shrink-0 sm:block" />
            <div className="min-w-0 flex-1">
              <div className="skeleton aspect-square w-full" />
              {/* Six 36px icon controls plus the engine toggle. */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton h-9 w-9" />
                ))}
                <div className="skeleton ml-auto h-9 w-24" />
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <div className="plate p-4">
              <div className="skeleton h-6 w-40" />
              <div className="skeleton mt-2 h-4 w-32" />
            </div>
            <div className="plate min-h-[120px] p-4">
              <div className="skeleton h-3.5 w-16" />
              <div className="mt-3 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton h-5" />
                ))}
              </div>
            </div>
            {/* FEN: the read-only field, then the paste row with its button. */}
            <div className="plate p-4">
              <div className="skeleton h-3.5 w-10" />
              <div className="skeleton mt-1.5 h-7 w-full" />
              <div className="mt-2 flex gap-2">
                <div className="skeleton h-9 min-w-0 flex-1" />
                <div className="skeleton h-9 w-16 shrink-0" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
