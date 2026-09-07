// Branded route skeleton for /clubs and /clubs/[slug]: the create-club panel
// beside a directory of row-shaped shimmer blocks while the page chunk loads.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      <SkeletonHeader />
      <section className="mx-auto max-w-6xl px-5 pt-6 sm:px-6 sm:pt-8">
        <div className="skeleton h-10 w-36 rounded-none" style={{ borderRadius: 1 }} />
        <div className="skeleton mt-2 h-4 w-80 max-w-full rounded-none" style={{ borderRadius: 1 }} />
        <div className="mt-6 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="plate h-fit p-5">
            <div className="skeleton h-6 w-32 rounded-none" style={{ borderRadius: 1 }} />
            <div className="skeleton mt-4 h-9 w-full rounded-none" style={{ borderRadius: 1 }} />
            <div className="skeleton mt-3 h-24 w-full rounded-none" style={{ borderRadius: 1 }} />
            <div className="skeleton mt-4 h-10 w-full rounded-none" style={{ borderRadius: 1 }} />
          </div>
          <div className="plate overflow-hidden">
            <div className="border-b border-[color:var(--edge)] px-5 py-3">
              <div className="skeleton h-4 w-20 rounded-none" style={{ borderRadius: 1 }} />
            </div>
            <div className="divide-y divide-[color:var(--edge)]">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="skeleton h-[44px] w-[44px] shrink-0 rounded-none" style={{ borderRadius: 1 }} />
                  <div className="min-w-0 flex-1">
                    <div className="skeleton h-5 w-40 max-w-full rounded-none" style={{ borderRadius: 1 }} />
                    <div className="skeleton mt-2 h-3.5 w-3/5 rounded-none" style={{ borderRadius: 1 }} />
                  </div>
                  <div className="skeleton h-4 w-10 shrink-0 rounded-none" style={{ borderRadius: 1 }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
