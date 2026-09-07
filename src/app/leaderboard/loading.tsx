// Route skeleton for /leaderboard: title, the two ladder tabs, the search
// field, then the standings as an open list on hairline dividers.
//
// The row shape is deliberately identical to the page's own LeaderboardSkeleton
// (rank, avatar dot, name, rating on a 44px row), so the route skeleton hands
// straight over to the data skeleton and then to real rows without the table
// changing height twice.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      <SkeletonHeader />
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="skeleton h-8 w-44" />
        {/* Ladder tabs: Nerf and Buff, on the shared underline bar. */}
        <div className="mt-5 flex items-stretch gap-5 border-b border-[color:var(--edge)]">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="skeleton mb-2.5 mt-1 h-4 w-20" />
          ))}
        </div>
        {/* The controls row above search holds only "Jump to my rank", which
            is conditional, so nothing is reserved for it: a placeholder that
            collapsed for most visitors would be the shift it is meant to
            prevent. */}
        <div className="skeleton mt-4 h-11 w-full max-w-sm sm:h-10" />
        <div className="mt-6 overflow-hidden border-y border-[color:var(--edge)]">
          <div className="border-b border-[color:var(--edge)] px-4 py-3">
            <div className="skeleton h-3 w-40" />
          </div>
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="flex min-h-[44px] items-center gap-3 border-b border-[color:var(--edge)] px-4 py-2.5"
            >
              <div className="skeleton h-4 w-5" />
              <div className="skeleton h-6 w-6 rounded-full" />
              <div className="skeleton h-4 w-full max-w-[160px]" />
              <div className="skeleton ml-auto h-4 w-12" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
