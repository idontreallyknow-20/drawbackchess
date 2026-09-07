// The shared skeleton for a single codex card page (/codex/buff/[id] and its
// nerf, hex, and boon siblings).
//
// All four render through InfoPageLayout, so they are one geometry: breadcrumb,
// title, intro paragraph, then a stack of plate sections. Without this they
// inherited /codex/loading.tsx, whose search bar over a nine-card grid is the
// shape of the library, not of a card.
//
// A card page is prerendered, so this is usually a single frame. It still has
// to be the right frame: the whole point of the skeleton contract is that
// nothing moves when the real content lands.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export function CardPageSkeleton() {
  return (
    <main className="min-h-screen pb-20">
      <SkeletonHeader />
      <section className="mx-auto max-w-[1100px] px-6 pt-4 sm:px-8">
        <div className="skeleton mb-3 h-4 w-64 max-w-full" />
        <div className="skeleton h-8 w-72 max-w-full" />
        <div className="skeleton mt-3 h-5 w-full max-w-3xl" />
        <div className="mt-9 space-y-4">
          {/* At a glance, How it works, History, Related cards. */}
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="plate p-6 sm:p-7">
              <div className="skeleton h-6 w-40" />
              <div className="mt-3 max-w-3xl space-y-3">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="skeleton h-4" />
                ))}
              </div>
            </div>
          ))}
          {/* Previous / next within the family. */}
          <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="skeleton h-14" />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
