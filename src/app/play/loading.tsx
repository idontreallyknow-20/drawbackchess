// Route skeleton for /play: the bot-setup card in its final geometry, the
// title and the Play online door above it.
//
// The four option groups are `grid-flow-col auto-cols-fr` rows of 44px pills,
// so the skeleton uses the same grid rather than a stack of bars; the two time
// sliders and the full-width Start button close it out. The page's existing
// Suspense fallback was an empty <main>, which held the scroll position but
// showed nothing.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen">
      <SkeletonHeader />
      <section className="mx-auto max-w-2xl px-6 py-5">
        <div>
          <div className="skeleton h-8 w-56" />
          <div className="skeleton mt-1.5 h-4 w-64 max-w-full" />
        </div>
        {/* The door into the online lobby. */}
        <div className="plate mt-4 flex items-center gap-3 p-3">
          <div className="skeleton h-11 w-11 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="skeleton h-5 w-32" />
            <div className="skeleton mt-1.5 h-4 w-48 max-w-full" />
          </div>
        </div>
        <div className="plate mt-6 space-y-6 p-6 sm:p-7">
          {/* Game type, bot strength, colour: three-up option rows. */}
          {Array.from({ length: 3 }).map((_, g) => (
            <div key={g}>
              <div className="skeleton mb-2 h-3.5 w-24" />
              <div className="grid auto-cols-fr grid-flow-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton h-11" />
                ))}
              </div>
            </div>
          ))}
          <div className="space-y-4">
            <div>
              <div className="skeleton mb-2 h-3.5 w-24" />
              <div className="grid auto-cols-fr grid-flow-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton h-11" />
                ))}
              </div>
            </div>
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i}>
                <div className="skeleton mb-2 h-3.5 w-28" />
                <div className="skeleton h-8 w-full" />
              </div>
            ))}
          </div>
          <div className="skeleton h-14 w-full" />
        </div>
      </section>
    </main>
  );
}
