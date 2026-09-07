// Route skeleton for /lobby: mirrors the lobby layout (compact header, flat
// boxes and rows, sticky player column) so the page chunk swaps in without
// anything jumping.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      <SkeletonHeader />
      <section className="mx-auto max-w-7xl px-5 sm:px-6">
        {/* Header: one compact row, the page name beside the status pills. */}
        <div className="mt-3 sm:mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="skeleton h-8 w-36" />
            <div className="flex gap-2">
              <div className="skeleton h-7 w-28" />
              <div className="skeleton hidden h-7 w-24 sm:block" />
            </div>
          </div>
        </div>
        {/* Tab bar (Play / Watch & Friends). */}
        <div className="mt-4 flex flex-wrap gap-1.5 border-b border-[color:var(--edge)] pb-px" aria-hidden>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-20 sm:w-28" />
          ))}
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="min-w-0 space-y-5">
            {/* Quick pairing: the header row, the nine time-control tiles,
                one primary button. */}
            <div className="plate p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="skeleton h-5 w-32" />
                <div className="skeleton h-8 w-32" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="skeleton h-14" />
                ))}
              </div>
              <div className="skeleton mt-3 h-12 w-full" />
            </div>
            {/* Secondary play-mode cards. */}
            <div className="grid gap-2.5 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton h-20" />
              ))}
            </div>
          </div>
          <div className="h-fit space-y-5">
            <div className="plate p-4">
              <div className="skeleton h-5 w-28" />
              <div className="mt-4 space-y-2.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton h-8" />
                ))}
              </div>
            </div>
            <div className="plate p-4">
              <div className="skeleton h-5 w-32" />
              <div className="mt-4 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton h-12" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
