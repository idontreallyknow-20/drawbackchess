// Branded route skeleton for /history and /history/[id]: a stack of
// game-row shimmer blocks while the archive page chunk loads.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      <SkeletonHeader />
      <section className="mx-auto max-w-5xl px-5 py-8 sm:px-6">
        <div className="skeleton h-10 w-44 rounded-none" style={{ borderRadius: 1 }} />
        <div className="skeleton mt-2 h-4 w-64 max-w-full rounded-none" style={{ borderRadius: 1 }} />
        <div className="plate mt-6 overflow-hidden">
          <div className="divide-y divide-[color:var(--edge)]">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                <div className="skeleton h-9 w-9 shrink-0 rounded-none" style={{ borderRadius: 1 }} />
                <div className="min-w-0 flex-1">
                  <div className="skeleton h-4 w-52 max-w-full rounded-none" style={{ borderRadius: 1 }} />
                  <div className="skeleton mt-2 h-3 w-32 rounded-none" style={{ borderRadius: 1 }} />
                </div>
                <div className="skeleton h-4 w-12 shrink-0 rounded-none" style={{ borderRadius: 1 }} />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
