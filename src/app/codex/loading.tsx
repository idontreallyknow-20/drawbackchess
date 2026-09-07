// Branded route skeleton for /codex: search bar plus a grid of card-shaped
// shimmer blocks, mirroring the rule library while the page chunk loads.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      <SkeletonHeader />
      <section className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
        <div className="skeleton h-10 w-40 rounded-none" style={{ borderRadius: 1 }} />
        <div className="skeleton mt-2 h-4 w-72 max-w-full rounded-none" style={{ borderRadius: 1 }} />
        <div className="skeleton mt-6 h-11 w-full rounded-none" style={{ borderRadius: 1 }} />
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="plate p-4">
              <div className="skeleton h-5 w-2/3 rounded-none" style={{ borderRadius: 1 }} />
              <div className="skeleton mt-2.5 h-3.5 w-full rounded-none" style={{ borderRadius: 1 }} />
              <div className="skeleton mt-1.5 h-3.5 w-4/5 rounded-none" style={{ borderRadius: 1 }} />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
