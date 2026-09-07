// Branded route skeleton for /u/[username]: avatar, name, rating cards, and
// the game history panel as shimmer blocks while the profile chunk loads.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      {/* No h1 here, deliberately, and it is not an oversight: the page
          component's own ProfileSkeleton carries one, and sampling the
          arrival frame by frame shows that skeleton mounts alongside this
          fallback rather than after it. Two identical sr-only headings were
          live at once, which breaks the one-h1 rule the route sweep checks.
          The component's heading is the one to keep: it also covers
          client-side navigation, where this file never renders at all. */}
      <SkeletonHeader />
      <section className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
        <div className="flex items-center gap-4">
          <div className="skeleton h-16 w-16 shrink-0 rounded-full" style={{ borderRadius: "50%" }} />
          <div className="min-w-0">
            <div className="skeleton h-8 w-48 max-w-full rounded-none" style={{ borderRadius: 2 }} />
            <div className="skeleton mt-2 h-4 w-32 rounded-none" style={{ borderRadius: 2 }} />
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="plate flex items-center gap-3 p-4">
              <div className="skeleton h-10 w-10 shrink-0 rounded-none" style={{ borderRadius: 2 }} />
              <div className="min-w-0 flex-1">
                <div className="skeleton h-4 w-20 rounded-none" style={{ borderRadius: 2 }} />
                <div className="skeleton mt-2 h-6 w-16 rounded-none" style={{ borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </div>
        <div className="plate mt-4 p-5">
          <div className="skeleton h-5 w-28 rounded-none" style={{ borderRadius: 2 }} />
          <div className="mt-4 space-y-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-9 rounded-none" style={{ borderRadius: 2 }} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
