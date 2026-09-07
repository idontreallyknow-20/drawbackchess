// Route skeleton for /achievements: the trophy-wall header (name beside the
// earned count, the rarity progress bar, the difficulty chips) above the card
// grid, in the geometry the page settles into.
//
// The wall itself is `grid-cols-2 / md:3 / xl:4` of 132px plates, which is the
// same shape the page's own in-flight CardSkeleton uses, so the route skeleton
// and the data skeleton hand over to each other without a jump.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      <SkeletonHeader />
      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="skeleton h-4 w-24" />
            {/* The title is 26px on phones and 32px from `sm`, leading-none. */}
            <div className="skeleton mt-1 h-[26px] w-56 max-w-full sm:h-8" />
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <div className="skeleton h-8 w-24" />
            <div className="skeleton mt-1 h-4 w-12" />
          </div>
        </div>
        {/* The rarity progress bar is a 6px strip, not a panel. */}
        <div className="skeleton mt-3 h-1.5 w-full" />
        <div className="skeleton mt-3 h-4 w-4/5 max-w-xl" />
        {/* Difficulty filter: All plus one chip per rarity, 32px tall. */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-8 w-20" />
          ))}
        </div>
        <div className="mt-8 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-[132px]" />
          ))}
        </div>
      </section>
    </main>
  );
}
