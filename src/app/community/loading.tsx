// Branded route skeleton for /community: the two-column hub (main column of
// lists beside the community rail) in its final geometry while the page chunk
// loads. No spinners; just the plate shapes it settles into.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      <SkeletonHeader />
      <section className="mx-auto max-w-5xl px-5 py-6 sm:px-6 sm:py-8">
        <div className="skeleton h-10 w-52" />
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="plate p-4 sm:p-5">
                <div className="skeleton h-6 w-40" />
                <div className="mt-4 space-y-2.5">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <div key={j} className="skeleton h-8" />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rail-panel p-4">
                <div className="skeleton h-5 w-28" />
                <div className="mt-3 space-y-2.5">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <div key={j} className="skeleton h-7" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
